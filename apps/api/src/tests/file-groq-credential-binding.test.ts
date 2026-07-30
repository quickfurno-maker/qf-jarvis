/**
 * QFJ-S2-D-B — the production credential binding (ADR-0064).
 *
 * Matrix: construction reads nothing; only the configured reference is answered; the file adapter
 * refuses every unsafe target; exactly one terminal newline is normalised and everything else refused;
 * the first resolve is single-flight; refresh forces one read and keeps last-known-good on failure; and
 * no surface can carry the value, the path, the reference, or a backend message.
 *
 * Every test is offline and synthetic. The credential values are unmistakable fakes, written to a
 * temporary directory this suite creates and removes. **No real credential, no environment read, no
 * network, no provider, no database.**
 */
import { chmod, mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createGroqApiKey } from '@qf-jarvis/model-gateway';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  CREDENTIAL_FAILURE_CODES,
  CredentialBindingError,
  isCredentialBindingError,
} from '../secrets/credential-errors.js';
import {
  MAX_CREDENTIAL_FILE_BYTES,
  modeIsGroupOrOtherAccessible,
  type CredentialFileRead,
  type CredentialFileReader,
} from '../secrets/credential-file-reader.js';
import {
  createFileGroqCredentialBinding,
  normalizeCredentialFileText,
  type FileGroqCredentialBinding,
} from '../secrets/file-groq-credential-binding.js';

/** An unmistakable fake. It satisfies the local validator and nothing else. */
const FAKE_CREDENTIAL = 'FAKE_QFJ_CREDENTIAL_DO_NOT_USE_0001';
const FAKE_CREDENTIAL_ROTATED = 'FAKE_QFJ_CREDENTIAL_DO_NOT_USE_0002';
const REFERENCE = { ref: 'qfj.production.groq.v1' } as const;

/** POSIX mode bits are synthetic on Windows; the adapter skips them and so must these specs. */
const POSIX = process.platform !== 'win32';

let dir: string;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'qfj-s2db-'));
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

/** Write a synthetic credential file with owner-only permissions where the platform supports them. */
async function writeCredentialFile(name: string, contents: string): Promise<string> {
  const path = join(dir, name);
  await writeFile(path, contents, 'utf8');
  if (POSIX) {
    await chmod(path, 0o600);
  }
  return path;
}

function bindingFor(path: string, over: Record<string, unknown> = {}): FileGroqCredentialBinding {
  return createFileGroqCredentialBinding({
    credentialReference: REFERENCE,
    absoluteFilePath: path,
    ...over,
  });
}

/** A scripted reader that counts reads — the seam for laziness, single-flight and refresh specs. */
function countingReader(
  script: readonly CredentialFileRead[],
): CredentialFileReader & { readonly reads: () => number } {
  const state = { n: 0 };
  return {
    read: () => {
      const index = Math.min(state.n, script.length - 1);
      state.n += 1;
      const next = script[index];
      if (next === undefined) {
        throw new Error('the scripted reader must be given at least one outcome');
      }
      return Promise.resolve(next);
    },
    reads: () => state.n,
  };
}

const okRead = (text: string): CredentialFileRead => ({ ok: true, text });
const failRead = (code: (typeof CREDENTIAL_FAILURE_CODES)[number]): CredentialFileRead => ({
  ok: false,
  code,
});

/** Capture a rejection's closed code without letting the error escape into an assertion message. */
async function codeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
    return 'resolved';
  } catch (error: unknown) {
    return isCredentialBindingError(error) ? error.code : 'not-a-credential-error';
  }
}

describe('(1-6) factory, reference, and handle shape', () => {
  it('(1) construction performs ZERO reads', () => {
    const reader = countingReader([okRead(FAKE_CREDENTIAL)]);
    bindingFor(join(dir, 'unused'), { fileReader: reader });
    expect(reader.reads()).toBe(0);
  });

  it('(2) the returned handle is frozen and exposes only three members', () => {
    const binding = bindingFor(join(dir, 'unused'), {
      fileReader: countingReader([okRead(FAKE_CREDENTIAL)]),
    });
    expect(Object.isFrozen(binding)).toBe(true);
    expect(Object.keys(binding).sort()).toEqual(['refresh', 'resolver', 'snapshot']);
    expect(Object.isFrozen(binding.resolver)).toBe(true);
    const surface = binding as unknown as Record<string, unknown>;
    for (const forbidden of [
      'path',
      'absoluteFilePath',
      'credentialReference',
      'current',
      'cache',
      'reader',
      'provider',
      'activate',
      'value',
      'key',
    ]) {
      expect(surface[forbidden]).toBeUndefined();
    }
  });

  it('(3) the resolver answers the configured reference', async () => {
    const binding = bindingFor(join(dir, 'unused'), {
      fileReader: countingReader([okRead(FAKE_CREDENTIAL)]),
    });
    const key = await binding.resolver.resolve(REFERENCE);
    expect(key.authorizationHeaderValue()).toBe(`Bearer ${FAKE_CREDENTIAL}`);
  });

  it('(4, 5) a different reference fails closed with only the closed code', async () => {
    const reader = countingReader([okRead(FAKE_CREDENTIAL)]);
    const binding = bindingFor(join(dir, 'unused'), { fileReader: reader });
    for (const ref of [{ ref: 'some.other.reference' }, { ref: '*' }, { ref: 'latest' }]) {
      expect(await codeOf(binding.resolver.resolve(ref))).toBe('credential-reference-invalid');
    }
    // A refused reference must not even reach the backend.
    expect(reader.reads()).toBe(0);
    const thrown = new CredentialBindingError('credential-reference-invalid');
    expect(thrown.message).toBe(
      'The supplied credential reference is not the configured reference.',
    );
    expect((thrown as { cause?: unknown }).cause).toBeUndefined();
  });

  it('a malformed CONFIGURED reference is refused at construction', () => {
    for (const ref of ['', '*', 'latest', 'LATEST', 'has space', '/etc/passwd', 'x'.repeat(129)]) {
      expect(() =>
        createFileGroqCredentialBinding({
          credentialReference: { ref },
          absoluteFilePath: join(dir, 'unused'),
        }),
      ).toThrow(CredentialBindingError);
    }
  });

  it('(6) the snapshot carries no reference, path, value or message', async () => {
    const path = await writeCredentialFile('snapshot.key', FAKE_CREDENTIAL);
    const binding = bindingFor(path);
    await binding.resolver.resolve(REFERENCE);
    const snapshot = binding.snapshot();
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.keys(snapshot).sort()).toEqual([
      'authority',
      'backendType',
      'hasCurrentCredential',
      'lastOutcome',
      'refreshAttempts',
      'refreshSuccesses',
      'resolveAttempts',
      'resolveSuccesses',
      'stale',
    ]);
    const surface = JSON.stringify(snapshot);
    expect(surface).not.toContain(FAKE_CREDENTIAL);
    expect(surface).not.toContain(REFERENCE.ref);
    expect(surface).not.toContain(path);
    expect(surface).not.toContain(dir);
    expect(surface).not.toContain('.key');
    expect(surface).not.toMatch(
      /length|prefix|suffix|hash|inode|mode|uid|gid|mtime|message|stack/i,
    );
    expect(snapshot.backendType).toBe('file');
    expect(snapshot.authority).toBe('QUICKFURNO_CORE');
  });
});

describe('(7-17) file safety', () => {
  it('(7) a relative path is refused before any read', async () => {
    const binding = bindingFor('relative/credential.key');
    expect(await codeOf(binding.resolver.resolve(REFERENCE))).toBe('credential-unavailable');
  });

  it('(8) a missing file is credential-not-found', async () => {
    const binding = bindingFor(join(dir, 'does-not-exist.key'));
    expect(await codeOf(binding.resolver.resolve(REFERENCE))).toBe('credential-not-found');
  });

  it('(9) a directory target is refused', async () => {
    const path = join(dir, 'a-directory');
    await mkdir(path, { recursive: true });
    const binding = bindingFor(path);
    expect(await codeOf(binding.resolver.resolve(REFERENCE))).toBe('credential-unavailable');
  });

  it('(10) a symlink is refused — Kubernetes-style projected mounts are out of scope', async () => {
    const target = await writeCredentialFile('symlink-target.key', FAKE_CREDENTIAL);
    const link = join(dir, 'symlink.key');
    let created = true;
    try {
      await symlink(target, link);
    } catch {
      // Windows without developer mode cannot create a symlink; the adapter's lstat guard is still
      // exercised on POSIX, which is the platform the guard exists for.
      created = false;
    }
    if (!created) {
      expect(POSIX).toBe(false);
      return;
    }
    const binding = bindingFor(link);
    expect(await codeOf(binding.resolver.resolve(REFERENCE))).toBe('credential-unavailable');
  });

  it('(11) an oversized file is refused, and the bound is derived not guessed', async () => {
    // 512 (the Groq maximum) + one CRLF.
    expect(MAX_CREDENTIAL_FILE_BYTES).toBe(514);
    const path = await writeCredentialFile(
      'oversized.key',
      'a'.repeat(MAX_CREDENTIAL_FILE_BYTES + 1),
    );
    const binding = bindingFor(path);
    expect(await codeOf(binding.resolver.resolve(REFERENCE))).toBe('credential-unavailable');
  });

  it('(12, 13, 14, 15, 16) POSIX permission bits are enforced where they mean something', async () => {
    // The pure predicate holds on every platform.
    expect(modeIsGroupOrOtherAccessible(0o400)).toBe(false);
    expect(modeIsGroupOrOtherAccessible(0o600)).toBe(false);
    expect(modeIsGroupOrOtherAccessible(0o640)).toBe(true);
    expect(modeIsGroupOrOtherAccessible(0o604)).toBe(true);
    expect(modeIsGroupOrOtherAccessible(0o666)).toBe(true);

    if (!POSIX) {
      // (16) Deterministic on Windows, and it does NOT pretend the mode bits are a control there.
      const path = await writeCredentialFile('windows.key', FAKE_CREDENTIAL);
      expect(await codeOf(bindingFor(path).resolver.resolve(REFERENCE))).toBe('resolved');
      return;
    }
    for (const mode of [0o400, 0o600]) {
      const path = join(dir, `mode-${mode.toString(8)}.key`);
      await writeFile(path, FAKE_CREDENTIAL, 'utf8');
      await chmod(path, mode);
      expect(await codeOf(bindingFor(path).resolver.resolve(REFERENCE))).toBe('resolved');
    }
    for (const mode of [0o640, 0o604, 0o660, 0o666]) {
      const path = join(dir, `bad-mode-${mode.toString(8)}.key`);
      await writeFile(path, FAKE_CREDENTIAL, 'utf8');
      await chmod(path, mode);
      expect(await codeOf(bindingFor(path).resolver.resolve(REFERENCE))).toBe(
        'credential-unavailable',
      );
    }
  });

  it('(17) no filesystem message or path ever surfaces', async () => {
    const path = join(dir, 'absent-for-message-check.key');
    let thrown: unknown;
    try {
      await bindingFor(path).resolver.resolve(REFERENCE);
    } catch (error: unknown) {
      thrown = error;
    }
    expect(isCredentialBindingError(thrown)).toBe(true);
    const surface = `${(thrown as Error).message}\n${JSON.stringify({ code: (thrown as CredentialBindingError).code })}`;
    expect(surface).not.toContain(path);
    expect(surface).not.toContain(dir);
    expect(surface).not.toContain('ENOENT');
    expect(surface).not.toContain('no such file');
    expect((thrown as { cause?: unknown }).cause).toBeUndefined();
  });
});

describe('(18-30) value handling', () => {
  it('(18) a valid synthetic value resolves to a redacting GroqApiKey', async () => {
    const path = await writeCredentialFile('valid.key', FAKE_CREDENTIAL);
    const key = await bindingFor(path).resolver.resolve(REFERENCE);
    // Branded and redacting, exactly like a key built by the gateway factory itself.
    expect(String(key)).toBe('[REDACTED_GROQ_API_KEY]');
    expect(JSON.stringify({ key })).not.toContain(FAKE_CREDENTIAL);
    expect(key.authorizationHeaderValue()).toBe(
      createGroqApiKey(FAKE_CREDENTIAL).authorizationHeaderValue(),
    );
  });

  const LF = String.fromCharCode(10);
  const CR = String.fromCharCode(13);
  const NUL = String.fromCharCode(0);

  it('(19, 20) exactly one terminal LF or CRLF is accepted and removed', () => {
    for (const suffix of [LF, `${CR}${LF}`]) {
      const normalized = normalizeCredentialFileText(`${FAKE_CREDENTIAL}${suffix}`);
      expect(normalized?.value).toBe(FAKE_CREDENTIAL);
    }
    expect(normalizeCredentialFileText(FAKE_CREDENTIAL)?.value).toBe(FAKE_CREDENTIAL);
  });

  it('(21-26) a second newline, whitespace, embedded CR/LF and NUL are all refused', () => {
    const rejected = [
      `${FAKE_CREDENTIAL}${LF}${LF}`,
      `${FAKE_CREDENTIAL}${CR}${LF}${CR}${LF}`,
      ` ${FAKE_CREDENTIAL}`,
      `\t${FAKE_CREDENTIAL}`,
      `${FAKE_CREDENTIAL} `,
      `${FAKE_CREDENTIAL}\t${LF}`,
      `FAKE_QFJ${LF}CREDENTIAL_DO_NOT_USE`,
      `FAKE_QFJ${CR}CREDENTIAL_DO_NOT_USE`,
      `FAKE_QFJ${NUL}CREDENTIAL_DO_NOT_USE`,
      '',
      LF,
    ];
    for (const text of rejected) {
      expect(normalizeCredentialFileText(text)).toBeUndefined();
    }
  });

  it('(27, 28) the existing gateway validator owns the final bounds, and empty is refused', async () => {
    const empty = await writeCredentialFile('empty.key', '');
    expect(await codeOf(bindingFor(empty).resolver.resolve(REFERENCE))).toBe(
      'credential-value-invalid',
    );
    const newlineOnly = await writeCredentialFile('newline-only.key', LF);
    expect(await codeOf(bindingFor(newlineOnly).resolver.resolve(REFERENCE))).toBe(
      'credential-value-invalid',
    );
    // 513 characters: within the file bound, beyond the gateway's 512-character key bound.
    const tooLong = await writeCredentialFile('too-long.key', 'a'.repeat(513));
    expect(await codeOf(bindingFor(tooLong).resolver.resolve(REFERENCE))).toBe(
      'credential-value-invalid',
    );
  });

  it('(29, 30) neither the raw value nor its length reaches any surface', async () => {
    const path = await writeCredentialFile('leak-probe.key', `${FAKE_CREDENTIAL}${LF}`);
    const binding = bindingFor(path);
    await binding.resolver.resolve(REFERENCE);
    await binding.refresh();
    const surfaces = [
      JSON.stringify(binding.snapshot()),
      JSON.stringify(await binding.refresh()),
      binding.snapshot().lastOutcome,
    ];
    for (const surface of surfaces) {
      expect(surface).not.toContain(FAKE_CREDENTIAL);
      expect(surface).not.toContain('FAKE_QFJ');
      expect(surface).not.toContain(String(FAKE_CREDENTIAL.length));
      expect(surface).not.toContain('Bearer');
      expect(surface.toLowerCase()).not.toContain('authorization');
    }
  });
});

describe('(31-36) lazy initial resolution and single flight', () => {
  it('(31, 32, 34) zero reads before the first resolve, exactly one for it, none after', async () => {
    const reader = countingReader([okRead(FAKE_CREDENTIAL)]);
    const binding = bindingFor(join(dir, 'unused'), { fileReader: reader });
    expect(reader.reads()).toBe(0);
    // Inspecting the snapshot must not trigger a read either.
    binding.snapshot();
    expect(reader.reads()).toBe(0);

    await binding.resolver.resolve(REFERENCE);
    expect(reader.reads()).toBe(1);
    await binding.resolver.resolve(REFERENCE);
    await binding.resolver.resolve(REFERENCE);
    expect(reader.reads()).toBe(1);
  });

  it('(33, 35) concurrent first resolves share ONE read and receive the same object', async () => {
    const reader = countingReader([okRead(FAKE_CREDENTIAL)]);
    const binding = bindingFor(join(dir, 'unused'), { fileReader: reader });
    const [a, b, c] = await Promise.all([
      binding.resolver.resolve(REFERENCE),
      binding.resolver.resolve(REFERENCE),
      binding.resolver.resolve(REFERENCE),
    ]);
    expect(reader.reads()).toBe(1);
    expect(a).toBe(b);
    expect(b).toBe(c);
  });

  it('a failed first read does not poison later attempts', async () => {
    const reader = countingReader([failRead('credential-not-found'), okRead(FAKE_CREDENTIAL)]);
    const binding = bindingFor(join(dir, 'unused'), { fileReader: reader });
    expect(await codeOf(binding.resolver.resolve(REFERENCE))).toBe('credential-not-found');
    expect(await codeOf(binding.resolver.resolve(REFERENCE))).toBe('resolved');
    expect(reader.reads()).toBe(2);
  });

  it('(36) no global mutable cache: two bindings share no state', async () => {
    const first = countingReader([okRead(FAKE_CREDENTIAL)]);
    const second = countingReader([okRead(FAKE_CREDENTIAL_ROTATED)]);
    const a = bindingFor(join(dir, 'unused'), { fileReader: first });
    const b = bindingFor(join(dir, 'unused'), { fileReader: second });
    await a.resolver.resolve(REFERENCE);
    expect(b.snapshot().hasCurrentCredential).toBe(false);
    const keyB = await b.resolver.resolve(REFERENCE);
    expect(keyB.authorizationHeaderValue()).toContain(FAKE_CREDENTIAL_ROTATED);
  });
});

describe('(37-48) refresh and last-known-good', () => {
  it('(37, 38) refresh forces one read and changes what future resolves return', async () => {
    const reader = countingReader([okRead(FAKE_CREDENTIAL), okRead(FAKE_CREDENTIAL_ROTATED)]);
    const binding = bindingFor(join(dir, 'unused'), { fileReader: reader });
    const before = await binding.resolver.resolve(REFERENCE);
    expect(before.authorizationHeaderValue()).toContain(FAKE_CREDENTIAL);
    expect(reader.reads()).toBe(1);

    expect(await binding.refresh()).toEqual({ ok: true });
    expect(reader.reads()).toBe(2);

    const after = await binding.resolver.resolve(REFERENCE);
    expect(after.authorizationHeaderValue()).toContain(FAKE_CREDENTIAL_ROTATED);
    expect(after).not.toBe(before);
    expect(binding.snapshot().refreshSuccesses).toBe(1);
    expect(binding.snapshot().stale).toBe(false);
  });

  it('(39) refresh exposes neither the old nor the new raw value', async () => {
    const reader = countingReader([okRead(FAKE_CREDENTIAL), okRead(FAKE_CREDENTIAL_ROTATED)]);
    const binding = bindingFor(join(dir, 'unused'), { fileReader: reader });
    await binding.resolver.resolve(REFERENCE);
    const surface = `${JSON.stringify(await binding.refresh())}\n${JSON.stringify(binding.snapshot())}`;
    expect(surface).not.toContain(FAKE_CREDENTIAL);
    expect(surface).not.toContain(FAKE_CREDENTIAL_ROTATED);
  });

  it('(40, 41, 42, 43) a failed refresh preserves last-known-good, marks stale, and keeps serving', async () => {
    const reader = countingReader([okRead(FAKE_CREDENTIAL), failRead('credential-unavailable')]);
    const binding = bindingFor(join(dir, 'unused'), { fileReader: reader });
    const original = await binding.resolver.resolve(REFERENCE);

    const result = await binding.refresh();
    expect(result).toEqual({ ok: false, code: 'credential-refresh-failed' });
    const snapshot = binding.snapshot();
    expect(snapshot.stale).toBe(true);
    expect(snapshot.hasCurrentCredential).toBe(true);
    expect(snapshot.lastOutcome).toBe('credential-refresh-failed');
    expect(snapshot.refreshSuccesses).toBe(0);

    // (43) The last-known-good keeps serving, and doing so triggers no further read.
    const readsAfterRefresh = reader.reads();
    const served = await binding.resolver.resolve(REFERENCE);
    expect(served).toBe(original);
    expect(reader.reads()).toBe(readsAfterRefresh);
  });

  it('(44) a failed refresh with NO current value returns the underlying initial failure', async () => {
    for (const code of ['credential-not-found', 'credential-unavailable'] as const) {
      const binding = bindingFor(join(dir, 'unused'), {
        fileReader: countingReader([failRead(code)]),
      });
      expect(await binding.refresh()).toEqual({ ok: false, code });
      // No last-known-good was invented.
      expect(binding.snapshot().hasCurrentCredential).toBe(false);
      expect(binding.snapshot().stale).toBe(false);
    }
  });

  it('(45) concurrent refreshes share ONE forced read — the locked policy', async () => {
    const reader = countingReader([okRead(FAKE_CREDENTIAL), okRead(FAKE_CREDENTIAL_ROTATED)]);
    const binding = bindingFor(join(dir, 'unused'), { fileReader: reader });
    await binding.resolver.resolve(REFERENCE);
    const [a, b, c] = await Promise.all([binding.refresh(), binding.refresh(), binding.refresh()]);
    expect([a, b, c]).toEqual([{ ok: true }, { ok: true }, { ok: true }]);
    // One initial read plus exactly one shared forced read.
    expect(reader.reads()).toBe(2);
    expect(binding.snapshot().refreshAttempts).toBe(3);
    expect(binding.snapshot().refreshSuccesses).toBe(1);
  });

  it('(46) a resolve DURING a refresh returns the current last-known-good without waiting', async () => {
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const state = { reads: 0 };
    const reader: CredentialFileReader = {
      read: async () => {
        state.reads += 1;
        if (state.reads > 1) {
          await gate;
          return okRead(FAKE_CREDENTIAL_ROTATED);
        }
        return okRead(FAKE_CREDENTIAL);
      },
    };
    const binding = bindingFor(join(dir, 'unused'), { fileReader: reader });
    const original = await binding.resolver.resolve(REFERENCE);

    const refreshing = binding.refresh();
    // Resolves while the forced read is still in flight: served immediately from last-known-good.
    const during = await binding.resolver.resolve(REFERENCE);
    expect(during).toBe(original);

    release?.();
    expect(await refreshing).toEqual({ ok: true });
    const after = await binding.resolver.resolve(REFERENCE);
    expect(after.authorizationHeaderValue()).toContain(FAKE_CREDENTIAL_ROTATED);
  });

  it('(47, 48) no automatic second refresh, timer, watcher or polling exists', async () => {
    const reader = countingReader([okRead(FAKE_CREDENTIAL), failRead('credential-unavailable')]);
    const binding = bindingFor(join(dir, 'unused'), { fileReader: reader });
    await binding.resolver.resolve(REFERENCE);
    await binding.refresh();
    const reads = reader.reads();
    // Nothing happens on its own: a macrotask turn later, the count is unchanged.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(reader.reads()).toBe(reads);
    expect(binding.snapshot().refreshAttempts).toBe(1);
  });
});

describe('(59-66) the closed taxonomy and redaction', () => {
  it('(59) all six codes are closed, unique, and carry fixed messages', () => {
    expect(CREDENTIAL_FAILURE_CODES).toHaveLength(6);
    expect(new Set(CREDENTIAL_FAILURE_CODES).size).toBe(6);
    expect([...CREDENTIAL_FAILURE_CODES].sort()).toEqual([
      'credential-not-found',
      'credential-reference-invalid',
      'credential-refresh-failed',
      'credential-unavailable',
      'credential-value-invalid',
      'internal-invariant',
    ]);
    for (const code of CREDENTIAL_FAILURE_CODES) {
      const error = new CredentialBindingError(code);
      expect(error.code).toBe(code);
      expect(error.message.length).toBeGreaterThan(0);
      expect(new CredentialBindingError(code).message).toBe(error.message);
    }
  });

  it('(60) an unknown code normalises to internal-invariant, fail-closed', () => {
    const error = new CredentialBindingError('not-a-real-code' as never);
    expect(error.code).toBe('internal-invariant');
    expect(error.message).toBe('A credential binding invariant was violated.');
  });

  it('(61, 62, 63) an arbitrary backend Error, its cause and any path are all discarded', async () => {
    // A reader that throws a hostile, path-bearing error with a cause.
    const hostile: CredentialFileReader = {
      read: () => {
        const cause = new Error('inner: /etc/qfj/secret.key');
        throw Object.assign(new Error('EACCES: permission denied, open /etc/qfj/secret.key'), {
          cause,
          path: '/etc/qfj/secret.key',
        });
      },
    };
    const binding = bindingFor(join(dir, 'unused'), { fileReader: hostile });
    let thrown: unknown;
    try {
      await binding.resolver.resolve(REFERENCE);
    } catch (error: unknown) {
      thrown = error;
    }
    // Even a THROWING seam cannot leak: the binding discards the exception, its cause and its path,
    // and reports the closed fail-closed code instead.
    expect(isCredentialBindingError(thrown)).toBe(true);
    expect((thrown as CredentialBindingError).code).toBe('internal-invariant');
    const surface = `${(thrown as Error).message}\n${JSON.stringify(binding.snapshot())}`;
    expect(surface).not.toContain('/etc/qfj/secret.key');
    expect(surface).not.toContain('EACCES');
    expect(surface).not.toContain('permission denied');
    expect(surface).not.toContain('inner:');
    expect((thrown as { cause?: unknown }).cause).toBeUndefined();
    expect(binding.snapshot().hasCurrentCredential).toBe(false);
  });

  it('(64, 65, 66) diagnostics are frozen, low-cardinality, and carry no identity', async () => {
    const path = await writeCredentialFile('diagnostics.key', FAKE_CREDENTIAL);
    const binding = bindingFor(path);
    await binding.resolver.resolve(REFERENCE);
    const snapshot = binding.snapshot();
    expect(Object.isFrozen(snapshot)).toBe(true);
    for (const [key, value] of Object.entries(snapshot)) {
      expect(['string', 'number', 'boolean']).toContain(typeof value);
      if (typeof value === 'string') {
        // Every string field is a fixed token or a closed code — never free text.
        expect([
          'file',
          'QUICKFURNO_CORE',
          'not-attempted',
          'success',
          ...CREDENTIAL_FAILURE_CODES,
        ]).toContain(value);
      }
      // Exact forbidden field names, not substrings: `refreshAttempts` legitimately contains "ref".
      expect([
        'path',
        'filePath',
        'absoluteFilePath',
        'filename',
        'directory',
        'credentialReference',
        'ref',
        'value',
        'secret',
        'token',
        'length',
        'prefix',
        'suffix',
        'hash',
        'inode',
        'mode',
        'uid',
        'gid',
        'mtime',
        'message',
        'error',
        'stack',
      ]).not.toContain(key);
    }
  });
});
