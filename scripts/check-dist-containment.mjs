/**
 * Structural containment check for @qf-jarvis/event-ingestion, run AFTER the build.
 *
 * It proves, against the actual emitted `dist/`, that:
 *   1. no `src/tests` file (no `.test.`, no `tests/`, no test fixture) is present in dist;
 *   2. no deterministic test seed or private-key fixture material is present in dist;
 *   3. the package `exports` map exposes only the approved root (`.`) — no deep path,
 *      and in particular no path into tests;
 *   4. the built root barrel exports exactly the approved runtime surface, and none of
 *      the test-only or internal names.
 *
 * Exits non-zero on any violation. Requires the package to have been built first
 * (`pnpm build`). Uses only Node built-ins.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const PKG = join(ROOT, 'packages', 'event-ingestion');
const DIST = join(PKG, 'dist');

const APPROVED_EXPORTS = [
  'DEFAULT_FRESHNESS_WINDOW_MS',
  'DOMAIN_SEPARATION_PREFIX',
  'EVENT_KEY_PURPOSE',
  'MAX_FRESHNESS_WINDOW_MS',
  'MAX_PUBLIC_KEY_RECORDS',
  'MAX_RAW_BODY_BYTES',
  'MIN_FRESHNESS_WINDOW_MS',
  'PublicKeyRegistry',
  'PublicKeyRegistryError',
  'SIGNATURE_VERIFICATION_REASONS',
  'SUPPORTED_ALGORITHM',
  'SignatureVerificationConfigError',
  // Stage 3.3.4 (ADR-0032): the full transactional ingest composition — the one new public symbol.
  // The primitives it composes (verifySignatureWithEvidence, prepare*, persist*, storeValidatedEvent,
  // recordIngestionRejection, recordEventConflict) stay internal and never reach this barrel.
  'createEventIngestor',
  'verifySignature',
];

const FORBIDDEN_NAMES = [
  'testPrivateKey',
  'testPublicKey',
  'altPrivateKey',
  'signEnvelope',
  'ComputedBodyDigest',
  'buildSigningInput',
  'parseSignatureEnvelope',
  'TEST_KEY_SEED_HEX',
  'TEST_PUBLIC_KEY_SPKI_B64',
  // Stage 3.3 slice 1 semantic-digest foundation is INTERNAL — the barrel must not export it
  // (ADR-0029). These names legitimately appear inside internal dist modules, so they are
  // checked against the exported barrel surface only, never against file contents.
  'computeSemanticEventDigest',
  'SemanticCanonicalisationError',
  'canonicaliseToJson',
];

// Distinctive substrings of the deterministic test key material — none may appear in dist.
const FORBIDDEN_CONTENT = [
  '0101010101010101010101010101010101010101010101010101010101010101',
  '0202020202020202020202020202020202020202020202020202020202020202',
  'createPrivateKey',
  'privateKeyFromSeedHex',
  'ED25519_PKCS8_DER_PREFIX',
  'signEnvelope',
];

const problems = [];

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...walk(full));
    } else {
      out.push(full);
    }
  }
  return out;
}

// 0. dist must exist.
let files = [];
try {
  files = walk(DIST);
} catch {
  console.error(
    `[containment] dist not found at ${relative(ROOT, DIST)} — run \`pnpm build\` first.`,
  );
  process.exit(1);
}

// 1. No test file path in dist.
for (const file of files) {
  const rel = relative(DIST, file);
  if (/(^|[/\\])tests([/\\]|$)/.test(rel) || /\.test\./.test(rel) || /test-keys/.test(rel)) {
    problems.push(`test file present in dist: ${rel}`);
  }
}

// 2. No test-key material in any dist file.
for (const file of files) {
  const text = readFileSync(file, 'utf8');
  for (const needle of FORBIDDEN_CONTENT) {
    if (text.includes(needle)) {
      problems.push(
        `forbidden test material "${needle}" found in dist file ${relative(DIST, file)}`,
      );
    }
  }
}

// 3. Package exports map exposes only the approved root.
const pkgJson = JSON.parse(readFileSync(join(PKG, 'package.json'), 'utf8'));
const exportKeys = Object.keys(pkgJson.exports ?? {});
if (exportKeys.length !== 1 || exportKeys[0] !== '.') {
  problems.push(`package exports must expose only "." — found: ${JSON.stringify(exportKeys)}`);
}

// 4. Built barrel exports exactly the approved runtime surface.
const barrel = await import(pathToFileURL(join(DIST, 'index.js')).href);
const runtime = Object.keys(barrel).sort();
const approved = [...APPROVED_EXPORTS].sort();
if (JSON.stringify(runtime) !== JSON.stringify(approved)) {
  problems.push(
    `built barrel exports differ from approved surface.\n  built:    ${runtime.join(', ')}\n  approved: ${approved.join(', ')}`,
  );
}
for (const name of FORBIDDEN_NAMES) {
  if (name in barrel) {
    problems.push(`built barrel leaks a forbidden name: ${name}`);
  }
}

if (problems.length > 0) {
  console.error('[containment] FAILED:');
  for (const problem of problems) {
    console.error(`  - ${problem}`);
  }
  process.exit(1);
}

console.log(
  '[containment] OK — dist is production-only; no test-key material; exports are the approved root surface.',
);
