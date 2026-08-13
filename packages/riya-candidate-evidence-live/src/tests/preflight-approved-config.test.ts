/**
 * MVP-P2A.2 HF1 — the regression that would have caught the live failure.
 *
 * ### What went wrong, and why nothing caught it
 *
 * Every existing preflight test built its smoke config by hand and hashed whatever bytes it had just
 * written, so the comparison always succeeded — the test manufactured both sides of it. Nothing ever
 * ran preflight against the file the OWNER actually has: the one
 * `scripts/generate-groq-staging-smoke-config.mjs` emits. That file is 888 pretty-printed bytes
 * hashing to `60bd0fa4…`, while the governed approval digest `4f97ef1e…` is over the 709-byte
 * canonical payload with `release.configDigest` excluded. Preflight compared the two and refused the
 * correct configuration, on the first real run, before reaching anything.
 *
 * So this file uses the REAL generator to produce the REAL approved bytes, writes them to a temporary
 * directory OUTSIDE the repository, and runs the REAL `runPreflight`. No hand-written fixture, no
 * digest computed by the test. It fails against the merged implementation and passes against the fix,
 * which is the only property that makes it worth having.
 *
 * The owner's own configuration at `C:\\Users\\…\\qfj-staging\\groq-smoke-config.json` is never read,
 * hashed or touched. It does not need to be: the generator reproduces it exactly, and the
 * `groq-staging-smoke` cross-proof pins all four of the owner-observed numbers.
 *
 * No Groq call, no credential, no network.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { EXPECTED_SMOKE_CONFIG_DIGEST, runPreflight } from '../preflight.js';

const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const GENERATOR_PATH = join(REPO_ROOT, 'scripts', 'generate-groq-staging-smoke-config.mjs');

const generator = (await import(pathToFileURL(GENERATOR_PATH).href)) as {
  buildSmokeConfig: (payload?: unknown) => Record<string, unknown>;
  serialiseConfig: (config: unknown) => string;
};

/** Outside the repository, exactly as the operator requires of a real review output. */
let workspace: string;

beforeAll(() => {
  workspace = mkdtempSync(join(tmpdir(), 'qfj-hf1-preflight-'));
});

afterAll(() => {
  rmSync(workspace, { recursive: true, force: true });
});

let sequence = 0;

/**
 * Write a smoke config and run the REAL preflight against it.
 *
 * The review output path is external and deliberately does not exist; its parent does. Interactive is
 * true so the TTY gate — which is last, and correctly so — never masks a digest result.
 */
function preflightFor(config: Record<string, unknown>): ReturnType<typeof runPreflight> {
  sequence += 1;
  const smokeConfigPath = join(workspace, `smoke-${String(sequence)}.json`);
  writeFileSync(smokeConfigPath, generator.serialiseConfig(config), 'utf8');
  return runPreflight({
    smokeConfigPath,
    reviewOutputPath: join(workspace, `review-${String(sequence)}.json`),
    repoRoot: REPO_ROOT,
    interactive: true,
  });
}

describe('THE REAL GENERATED APPROVED CONFIG PASSES PREFLIGHT', () => {
  it('accepts the exact bytes the approved generator emits', () => {
    // The load-bearing assertion. Against the merged implementation this returned
    // `smoke-config-digest-mismatch`, because the file's own SHA-256 can never equal the digest of a
    // payload that excludes the field carrying it.
    expect(preflightFor(generator.buildSmokeConfig())).toStrictEqual({ ok: true });
  });

  it('the passing config carries the approved digest semantically AND embedded', () => {
    const config = generator.buildSmokeConfig();
    expect((config['release'] as Record<string, unknown>)['configDigest']).toBe(
      EXPECTED_SMOKE_CONFIG_DIGEST,
    );
    expect(EXPECTED_SMOKE_CONFIG_DIGEST).toBe(
      '4f97ef1e9e46905db253912bd56dab8aea4f38e4d606dfe93b16fc024f0c2be1',
    );
  });
});

describe('but drift in EITHER claim is still refused', () => {
  it('SEMANTIC DRIFT FAILS EVEN WHEN THE EMBEDDED DIGEST STILL SAYS APPROVED', () => {
    // `timeoutMs` 30000 -> 30001. Parses cleanly, embedded digest untouched. Only recomputation can
    // see this, which is why trusting the embedded value alone is not enough.
    const config = generator.buildSmokeConfig();
    config['timeoutMs'] = 30_001;
    expect((config['release'] as Record<string, unknown>)['configDigest']).toBe(
      EXPECTED_SMOKE_CONFIG_DIGEST,
    );
    expect(preflightFor(config)).toStrictEqual({
      ok: false,
      failure: 'smoke-config-digest-mismatch',
    });
  });

  it('EMBEDDED DIGEST DRIFT FAILS EVEN WHEN EVERY APPROVED VALUE IS CORRECT', () => {
    // The mirror case. Recomputation is blind to `release.configDigest` by construction, so only the
    // independent equality check can see this.
    const config = generator.buildSmokeConfig();
    (config['release'] as Record<string, unknown>)['configDigest'] =
      '0000000000000000000000000000000000000000000000000000000000000000';
    expect(preflightFor(config)).toStrictEqual({
      ok: false,
      failure: 'smoke-config-digest-mismatch',
    });
  });

  it('a raw-file digest is NOT accepted as the approved identity', () => {
    // Guards the tempting "fix" of setting the governed constant to the file hash. The 888-byte file
    // hashes to `60bd0fa4…`; that value must never be an approved embedded digest.
    const config = generator.buildSmokeConfig();
    (config['release'] as Record<string, unknown>)['configDigest'] =
      '60bd0fa496088cfe158312500ce88e315d22d2583052b42e1f49ae2fa7af1363';
    expect(preflightFor(config)).toStrictEqual({
      ok: false,
      failure: 'smoke-config-digest-mismatch',
    });
  });
});

describe('serialization is not identity, but the closed schema still is', () => {
  it('MINIFIED AND REORDERED BYTES DESCRIBE THE SAME APPROVED CONFIG AND PASS', () => {
    const config = generator.buildSmokeConfig();
    const reverseKeysDeep = (value: unknown): unknown => {
      if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        return value;
      }
      const out: Record<string, unknown> = {};
      for (const key of Object.keys(value).sort().reverse()) {
        out[key] = reverseKeysDeep((value as Record<string, unknown>)[key]);
      }
      return out;
    };

    sequence += 1;
    const minifiedPath = join(workspace, `smoke-min-${String(sequence)}.json`);
    // No indentation and no trailing newline: different bytes, same configuration.
    writeFileSync(minifiedPath, JSON.stringify(config), 'utf8');
    expect(
      runPreflight({
        smokeConfigPath: minifiedPath,
        reviewOutputPath: join(workspace, `review-min-${String(sequence)}.json`),
        repoRoot: REPO_ROOT,
        interactive: true,
      }),
    ).toStrictEqual({ ok: true });

    expect(preflightFor(reverseKeysDeep(config) as Record<string, unknown>)).toStrictEqual({
      ok: true,
    });
  });

  it('AN EXTRA UNAPPROVED FIELD FAILS CLOSED BEFORE APPROVAL IS CONSIDERED', () => {
    // `smoke-config-unreadable`, not a digest mismatch: closed parsing refuses it first. Accepting
    // formatting variation did not widen what the operator will run.
    const config = generator.buildSmokeConfig();
    config['unapprovedField'] = 'anything';
    expect(preflightFor(config)).toStrictEqual({ ok: false, failure: 'smoke-config-unreadable' });

    const withSecretShapedKey = generator.buildSmokeConfig();
    (withSecretShapedKey['release'] as Record<string, unknown>)['apiKey'] = 'anything';
    expect(preflightFor(withSecretShapedKey)).toStrictEqual({
      ok: false,
      failure: 'smoke-config-unreadable',
    });
  });
});
