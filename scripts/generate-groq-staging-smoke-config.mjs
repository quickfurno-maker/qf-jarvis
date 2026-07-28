/**
 * Compute the deterministic Groq staging-smoke `configDigest`, and — only when explicitly asked —
 * emit the secret-free smoke configuration to a path OUTSIDE this repository.
 *
 * QFJ-S1C. The digest exists so a staging run can prove WHICH approved configuration it exercised.
 * It is derived from the owner-approved non-secret values by a fixed canonicalisation, so it cannot
 * drift from them and cannot be mistyped: change any approved value and the digest changes.
 *
 * What this script deliberately CANNOT do:
 *   - read, request, validate, display, or store a credential — there is no secret input at all;
 *   - read the process environment, read standard input, or prompt for anything;
 *   - perform any network, database, or provider call;
 *   - import any provider transport, database, or secret-resolver module (it imports only
 *     `node:crypto`, `node:fs`, `node:path`, and `node:url`);
 *   - write anywhere inside this repository.
 *
 * Usage:
 *   node scripts/generate-groq-staging-smoke-config.mjs
 *       Print the configDigest, and nothing else.
 *
 *   node scripts/generate-groq-staging-smoke-config.mjs --emit-config <PATH_OUTSIDE_REPO> [--force]
 *       Atomically write the secret-free smoke configuration there. Refuses a repository-internal
 *       path, and refuses to overwrite an existing file unless --force is given.
 */

import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The repository root. Nothing may be written at or below it. */
export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * The owner-approved, NON-SECRET digest payload (QFJ-S1C, approved 2026-07-28).
 *
 * This object is the digest input EXACTLY as approved: it excludes `configDigest` itself, because a
 * digest cannot be an input to its own computation. Every value is an identifier, a bound, or a
 * boolean — there is no credential, no account identifier, and no endpoint. The authoritative record
 * is `docs/approvals/groq-staging-smoke-v1/`; a test asserts these constants agree with it.
 */
export const APPROVED_DIGEST_PAYLOAD = Object.freeze({
  capabilityProfileRef: 'cap.groq.openai-gpt-oss-20b.strict-json.2026-07-28',
  credentialReference: 'groq.qfj.staging.smoke.v1',
  dataClass: 'HOSTED_ALLOWED',
  dataControlsAttestationRef: 'att.groq.qfj-staging.global-zdr.2026-07-28',
  dataControlsAttested: true,
  evaluationRef: 'eval.qfj.synthetic-connectivity-smoke.v1',
  maxCompletionTokens: 256,
  maxInputTokens: 512,
  promptFamily: 'qfj.s1a.synthetic.smoke',
  promptVersion: 1,
  release: Object.freeze({
    executionClass: 'HOSTED',
    modelId: 'openai/gpt-oss-20b',
    modelVersion: 'groq-catalog-snapshot-2026-07-28',
    providerId: 'groq',
    releaseId: 'rel.groq.qfj.staging.smoke.v1',
  }),
  schemaRevision: 'qfj.s1a.synthetic.smoke.schema.v1',
  supportsStrictJsonSchema: true,
  timeoutMs: 30_000,
});

/**
 * The closed set of key paths this script may ever produce.
 *
 * The ALLOW-LIST IS CHECKED FIRST and the credential-shaped scan below applies only to keys that
 * already failed it. Doing it the other way round produces false positives that matter here:
 * `maxCompletionTokens` contains "token" while carrying nothing secret, and `credentialReference`
 * is an identifier, not a credential.
 */
const ALLOWED_KEY_PATHS = new Set([
  'capabilityProfileRef',
  'credentialReference',
  'dataClass',
  'dataControlsAttestationRef',
  'dataControlsAttested',
  'evaluationRef',
  'maxCompletionTokens',
  'maxInputTokens',
  'promptFamily',
  'promptVersion',
  'release',
  'release.configDigest',
  'release.executionClass',
  'release.modelId',
  'release.modelVersion',
  'release.providerId',
  'release.releaseId',
  'schemaRevision',
  'supportsStrictJsonSchema',
  'timeoutMs',
]);

/**
 * Fragments that mark an UNAPPROVED key as credential-bearing. A digest is only trustworthy if the
 * thing it commits to is provably secret-free, so this is enforced rather than assumed: a payload
 * carrying such a key is a hard error, not a warning.
 */
const CREDENTIAL_KEY_FRAGMENTS = [
  'apikey',
  'key',
  'secret',
  'token',
  'bearer',
  'authorization',
  'auth',
  'password',
  'passphrase',
  'credentialvalue',
  'signature',
];

function normaliseKey(key) {
  return key.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Compare two strings by Unicode CODE POINT, not by UTF-16 code unit.
 *
 * `Array.prototype.sort()` orders by code unit, which disagrees with code-point order outside the
 * BMP. Every approved key is ASCII, where the two agree — but the canonicalisation is specified in
 * code points, so it is implemented in code points. A rule that only happens to hold for today's
 * inputs is not the rule.
 */
export function compareByCodePoint(a, b) {
  const left = [...a];
  const right = [...b];
  const shared = Math.min(left.length, right.length);
  for (let i = 0; i < shared; i += 1) {
    const x = left[i].codePointAt(0);
    const y = right[i].codePointAt(0);
    if (x !== y) {
      return x < y ? -1 : 1;
    }
  }
  return left.length - right.length;
}

/** Recursively sort object keys by code point. Array ORDER is preserved; only objects are reordered. */
export function canonicalise(value) {
  if (Array.isArray(value)) {
    return value.map((item) => canonicalise(item));
  }
  if (value !== null && typeof value === 'object') {
    const sorted = {};
    for (const key of Object.keys(value).sort(compareByCodePoint)) {
      sorted[key] = canonicalise(value[key]);
    }
    return sorted;
  }
  return value;
}

/**
 * Reject any key outside the approved set, at any depth. A key that is also credential-shaped gets
 * the more specific message. Throws on the first hit; the offending VALUE is never read or quoted.
 */
export function assertApprovedKeysOnly(value, path = '') {
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      assertApprovedKeysOnly(item, `${path}[${String(index)}]`);
    });
    return;
  }
  if (value === null || typeof value !== 'object') {
    return;
  }
  for (const key of Object.keys(value)) {
    const here = path === '' ? key : `${path}.${key}`;
    if (!ALLOWED_KEY_PATHS.has(here)) {
      const normalised = normaliseKey(key);
      if (CREDENTIAL_KEY_FRAGMENTS.some((fragment) => normalised.includes(fragment))) {
        throw new Error(`A credential-bearing field is not permitted: ${here}`);
      }
      throw new Error(`An unapproved field is not permitted: ${here}`);
    }
    assertApprovedKeysOnly(value[key], here);
  }
}

/**
 * The canonical digest input: keys sorted by code point, arrays untouched, `JSON.stringify` with no
 * indentation. UTF-8, no BOM, no trailing newline.
 */
export function canonicalJson(payload) {
  return JSON.stringify(canonicalise(payload));
}

/** The 64-character lowercase hex SHA-256 of the canonical digest input. */
export function computeConfigDigest(payload = APPROVED_DIGEST_PAYLOAD) {
  assertApprovedKeysOnly(payload);
  if (Object.prototype.hasOwnProperty.call(payload, 'configDigest')) {
    throw new Error('configDigest must not be an input to its own computation.');
  }
  return createHash('sha256')
    .update(Buffer.from(canonicalJson(payload), 'utf8'))
    .digest('hex');
}

/**
 * Build the emitted smoke configuration: every approved field, in the shape the merged
 * groq-staging-smoke parser accepts, with the computed digest as `release.configDigest`.
 */
export function buildSmokeConfig(payload = APPROVED_DIGEST_PAYLOAD) {
  const configDigest = computeConfigDigest(payload);
  const config = {
    credentialReference: payload.credentialReference,
    release: {
      releaseId: payload.release.releaseId,
      providerId: payload.release.providerId,
      modelId: payload.release.modelId,
      modelVersion: payload.release.modelVersion,
      executionClass: payload.release.executionClass,
      configDigest,
    },
    dataClass: payload.dataClass,
    maxInputTokens: payload.maxInputTokens,
    maxCompletionTokens: payload.maxCompletionTokens,
    supportsStrictJsonSchema: payload.supportsStrictJsonSchema,
    capabilityProfileRef: payload.capabilityProfileRef,
    evaluationRef: payload.evaluationRef,
    dataControlsAttestationRef: payload.dataControlsAttestationRef,
    dataControlsAttested: payload.dataControlsAttested,
    promptFamily: payload.promptFamily,
    promptVersion: payload.promptVersion,
    schemaRevision: payload.schemaRevision,
    timeoutMs: payload.timeoutMs,
  };
  assertApprovedKeysOnly(config);
  return config;
}

/** True iff `candidate` resolves to the repository root or anything inside it. */
export function isInsideRepository(candidate, repoRoot = REPO_ROOT) {
  const rel = relative(repoRoot, resolve(candidate));
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

/** The exact bytes written for a given configuration: UTF-8 JSON with one final newline. */
export function serialiseConfig(config) {
  return `${JSON.stringify(config, null, 2)}\n`;
}

/**
 * Write the configuration atomically: render to a temporary file on the destination's own directory,
 * then rename over the target. A half-written configuration would be worse than none, because the
 * operator would not know which fields the harness actually read.
 */
export function writeConfigAtomically(outputPath, config, { force = false } = {}) {
  const target = resolve(outputPath);

  if (isInsideRepository(target)) {
    throw new Error('Refusing to write the smoke configuration inside the repository.');
  }
  if (existsSync(target) && !force) {
    throw new Error('Refusing to overwrite an existing file without --force.');
  }

  const bytes = Buffer.from(serialiseConfig(config), 'utf8');
  // Stage beside the destination so the rename stays on one volume; a cross-device rename would fail.
  const staging = mkdtempSync(join(dirname(target), '.qfj-smoke-config-'));
  const temporary = join(staging, 'config.json');
  try {
    writeFileSync(temporary, bytes, { mode: 0o600 });
    renameSync(temporary, target);
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
  return target;
}

/** Parse the argument list. Only `--emit-config <path>` and `--force` are recognised. */
export function parseArgs(argv) {
  if (argv.length === 0) {
    return { mode: 'digest' };
  }
  let outputPath;
  let force = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--force') {
      force = true;
      continue;
    }
    if (arg === '--emit-config') {
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('-')) {
        throw new Error('--emit-config requires a path.');
      }
      outputPath = next;
      i += 1;
      continue;
    }
    throw new Error('Unrecognised argument. Use --emit-config <path> [--force].');
  }
  if (outputPath === undefined) {
    throw new Error('--force is only meaningful with --emit-config.');
  }
  return { mode: 'emit', outputPath, force };
}

function main(argv) {
  const parsed = parseArgs(argv);
  const digest = computeConfigDigest();

  if (parsed.mode === 'digest') {
    // The default output is the digest and nothing else, so it can be piped or compared directly.
    process.stdout.write(`${digest}\n`);
    return;
  }

  const written = writeConfigAtomically(parsed.outputPath, buildSmokeConfig(), {
    force: parsed.force,
  });
  // Success output carries only the path and the digest — never a field value, never a credential.
  process.stdout.write(`outputPath=${written}\nconfigDigest=${digest}\n`);
}

// Run only when executed directly, so the module can be imported by tests without side effects.
if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : 'Unknown error.'}\n`);
    process.exitCode = 1;
  }
}
