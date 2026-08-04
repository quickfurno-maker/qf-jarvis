#!/usr/bin/env node
/**
 * Jarvis OS authentication bootstrap (JOS-01C, ADR-0087).
 *
 * Creates the uncommitted auth JSON that `QFJ_JOS_AUTH_CONFIG_FILE` points at.
 *
 * ### Why a CLI rather than a signup page
 *
 * A signup route is a permanently-reachable way to create an identity, and this control plane has
 * exactly one operator who already exists. A one-shot local tool has no HTTP surface, no
 * enumeration risk and nothing to rate-limit — and it forces the credential to be created by
 * someone with shell access to the host, which is the correct authority for "who may operate this".
 *
 * ### The passphrase never touches argv or the environment
 *
 * `--password` would put the credential in shell history, in `ps` output, and in any process
 * listing a container tool produces. An environment variable would put it in `/proc` and in crash
 * dumps. So it is read interactively with echo disabled, confirmed, and never printed back.
 *
 * Usage:
 *   pnpm --filter @qf-jarvis/jarvis-os auth:bootstrap -- --output /run/secrets/qf-jarvis-os-auth.json
 *   pnpm --filter @qf-jarvis/jarvis-os auth:bootstrap -- --output ./local-auth.json --mode LOCAL_DEVELOPMENT
 */
import { argon2 } from 'node:crypto';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { stdin, stdout, argv, exit } from 'node:process';

const ARGON2_MEMORY_KIB = 19_456;
const ARGON2_PASSES = 2;
const ARGON2_PARALLELISM = 1;
const MIN_PASSPHRASE_LENGTH = 16;

function fail(message) {
  stdout.write(`\n  ERROR  ${message}\n\n`);
  exit(1);
}

function parseArgs() {
  const args = argv.slice(2);
  const options = { mode: 'PRODUCTION', operatorId: 'owner', displayName: 'Owner' };
  for (let i = 0; i < args.length; i += 1) {
    const flag = args[i];
    const value = args[i + 1];
    if (flag === '--output') {
      options.output = value;
      i += 1;
    } else if (flag === '--mode') {
      options.mode = value;
      i += 1;
    } else if (flag === '--operator-id') {
      options.operatorId = value;
      i += 1;
    } else if (flag === '--display-name') {
      options.displayName = value;
      i += 1;
    } else if (flag === '--allow-create-parent') {
      options.allowCreateParent = true;
    } else if (flag === '--i-understand-this-is-inside-the-repository') {
      options.allowInsideRepository = true;
    } else if (flag === '--password' || flag === '--passphrase') {
      // Named explicitly so the refusal is a clear message rather than "unknown flag".
      fail('the passphrase may not be supplied on the command line: it would enter shell history');
    } else {
      fail(`unknown argument: ${String(flag)}`);
    }
  }
  if (options.output === undefined) {
    fail('--output <path> is required');
  }
  if (options.mode !== 'PRODUCTION' && options.mode !== 'LOCAL_DEVELOPMENT') {
    fail('--mode must be PRODUCTION or LOCAL_DEVELOPMENT');
  }
  return options;
}

/** Read a line with echo disabled. Falls back to a clear refusal if the TTY cannot be muted. */
function readSecret(prompt) {
  return new Promise((resolveSecret) => {
    if (!stdin.isTTY) {
      fail('a TTY is required: this tool will not read a passphrase from a pipe');
    }
    stdout.write(prompt);
    const rl = createInterface({ input: stdin, output: stdout, terminal: true });
    const previousWrite = stdout.write.bind(stdout);
    // Suppress echo for the duration of the prompt.
    stdout.write = () => true;
    rl.question('', (answer) => {
      stdout.write = previousWrite;
      stdout.write('\n');
      rl.close();
      resolveSecret(answer);
    });
  });
}

function base32Encode(buffer) {
  const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      out += ALPHABET[(value >>> bits) & 31];
    }
  }
  if (bits > 0) {
    out += ALPHABET[(value << (5 - bits)) & 31];
  }
  return out;
}

function deriveArgon2id(password, salt) {
  return new Promise((resolveTag, rejectTag) => {
    argon2(
      'argon2id',
      {
        message: Buffer.from(password.normalize('NFC'), 'utf8'),
        nonce: salt,
        parallelism: ARGON2_PARALLELISM,
        tagLength: 32,
        memory: ARGON2_MEMORY_KIB,
        passes: ARGON2_PASSES,
      },
      (error, tag) => {
        if (error) {
          rejectTag(error);
          return;
        }
        resolveTag(Buffer.from(tag.buffer, tag.byteOffset, tag.byteLength));
      },
    );
  });
}

async function main() {
  const options = parseArgs();
  const output = resolve(options.output);

  // Refuse to overwrite. Silently replacing a credential file is how an operator locks themselves
  // out of a running system with one careless re-run.
  if (existsSync(output)) {
    fail(`refusing to overwrite an existing file: ${output}`);
  }

  // Refuse to write inside the repository unless explicitly forced. A secret under a tracked path
  // is one `git add` away from being published forever.
  const repositoryRoot = resolve(
    new URL('../../../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/u, '$1'),
  );
  if (output.startsWith(repositoryRoot) && options.allowInsideRepository !== true) {
    fail(
      `refusing to write a secret inside the repository (${repositoryRoot}).\n` +
        '         Choose a path outside it, or pass --i-understand-this-is-inside-the-repository\n' +
        '         and confirm the file is gitignored and untracked before you continue.',
    );
  }

  const parent = dirname(output);
  if (!existsSync(parent)) {
    if (options.allowCreateParent !== true) {
      fail(`parent directory does not exist: ${parent} (pass --allow-create-parent to create it)`);
    }
    mkdirSync(parent, { recursive: true, mode: 0o700 });
  }

  stdout.write('\n  Jarvis OS — authentication bootstrap\n');
  stdout.write(`  mode: ${options.mode}   operator: ${options.operatorId}\n\n`);

  const passphrase = await readSecret(
    `  Passphrase (min ${MIN_PASSPHRASE_LENGTH} chars, not echoed): `,
  );
  if (passphrase.normalize('NFC').length < MIN_PASSPHRASE_LENGTH) {
    fail(`passphrase must be at least ${MIN_PASSPHRASE_LENGTH} characters`);
  }
  if (Buffer.byteLength(passphrase, 'utf8') > 256) {
    fail('passphrase must be at most 256 UTF-8 bytes');
  }
  const confirmation = await readSecret('  Confirm passphrase: ');
  if (passphrase !== confirmation) {
    fail('the two passphrases did not match');
  }

  const salt = randomBytes(16);
  const digest = await deriveArgon2id(passphrase, salt);
  const totpSecretBytes = randomBytes(20);
  const totpSecret = base32Encode(totpSecretBytes);
  const sessionKey = randomBytes(32);
  const keyId = `${new Date().toISOString().slice(0, 7)}-${randomBytes(2).toString('hex')}`;

  const config = {
    version: 1,
    mode: options.mode,
    operator: { id: options.operatorId, displayName: options.displayName, role: 'OWNER' },
    passwordVerifier: {
      algorithm: 'ARGON2ID_V19',
      memoryKiB: ARGON2_MEMORY_KIB,
      passes: ARGON2_PASSES,
      parallelism: ARGON2_PARALLELISM,
      salt: salt.toString('base64url'),
      digest: digest.toString('base64url'),
    },
    totp: {
      required: true,
      algorithm: 'SHA1',
      digits: 6,
      periodSeconds: 30,
      allowedDriftSteps: 1,
      secret: totpSecret,
    },
    session: {
      revision: 1,
      absoluteTtlSeconds: 3600,
      primaryKeyId: keyId,
      keys: [{ id: keyId, status: 'PRIMARY', key: sessionKey.toString('base64url') }],
    },
  };

  // 0600: owner read/write only. The loader refuses a group- or world-readable file on Linux.
  writeFileSync(output, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });

  const label = `${encodeURIComponent('Jarvis OS')}:${encodeURIComponent(options.operatorId)}`;
  const uri =
    `otpauth://totp/${label}?secret=${totpSecret}&issuer=${encodeURIComponent('Jarvis OS')}` +
    '&algorithm=SHA1&digits=6&period=30';

  stdout.write(`\n  Written: ${output}  (mode 0600)\n`);
  stdout.write(
    '\n  ENROL YOUR AUTHENTICATOR NOW. This secret is shown once and is not recoverable.\n',
  );
  stdout.write(`\n    manual entry key : ${totpSecret}\n`);
  stdout.write(`    otpauth URI      : ${uri}\n`);
  stdout.write('\n  Your terminal scrollback and any screen recording now contain this secret.\n');
  stdout.write('  Clear the scrollback when you are done enrolling.\n');
  stdout.write('\n  Next:\n');
  stdout.write(`    export QFJ_JOS_AUTH_CONFIG_FILE=${output}\n`);
  stdout.write('    (never commit this file; never place it under a tracked path)\n\n');
  // The passphrase, the derived digest and the session key are deliberately never printed.
}

await main();
