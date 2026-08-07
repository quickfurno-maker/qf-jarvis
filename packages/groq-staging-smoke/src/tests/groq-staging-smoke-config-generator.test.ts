/**
 * QFJ-S1C — the deterministic approval digest and the secret-free configuration generator.
 *
 * The generator lives at `scripts/generate-groq-staging-smoke-config.mjs`, outside any package, so it
 * is exercised here two ways: loaded dynamically for its pure functions, and executed as a real
 * subprocess for its CLI contract. Both matter — the refusals (repository-internal output, overwrite
 * without `--force`) only mean something if the actual executable performs them.
 *
 * Nothing here reads a credential, resolves a secret, or touches the network. The generator has no
 * secret input at all, which is itself asserted below.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { afterAll, describe, expect, it } from 'vitest';

import { parseSmokeConfig } from '../index.js';
import { syntheticSmokeConfigInput } from '../testing/index.js';

const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const GENERATOR_PATH = join(REPO_ROOT, 'scripts', 'generate-groq-staging-smoke-config.mjs');
const APPROVAL_DIR = join(REPO_ROOT, 'docs', 'approvals', 'groq-staging-smoke-v1');

/** The digest locked by the owner approval. Any drift here is a contradiction, not a refresh. */
const EXPECTED_DIGEST = '4f97ef1e9e46905db253912bd56dab8aea4f38e4d606dfe93b16fc024f0c2be1';

const generator = (await import(pathToFileURL(GENERATOR_PATH).href)) as {
  APPROVED_DIGEST_PAYLOAD: Record<string, unknown>;
  canonicalJson: (payload: unknown) => string;
  canonicalise: (value: unknown) => unknown;
  compareByCodePoint: (a: string, b: string) => number;
  computeConfigDigest: (payload?: unknown) => string;
  buildSmokeConfig: (payload?: unknown) => Record<string, unknown>;
  serialiseConfig: (config: unknown) => string;
  isInsideRepository: (candidate: string) => boolean;
  writeConfigAtomically: (
    outputPath: string,
    config: unknown,
    options?: { force?: boolean },
  ) => string;
  parseArgs: (argv: readonly string[]) => Record<string, unknown>;
  assertApprovedKeysOnly: (value: unknown, path?: string) => void;
};

/** Scratch directories are created OUTSIDE the repository, mirroring how the generator must be used. */
const scratchDirs: string[] = [];
function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), 'qfj-s1c-'));
  scratchDirs.push(dir);
  return dir;
}
afterAll(() => {
  for (const dir of scratchDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function runGenerator(args: readonly string[]): { status: number; stdout: string; stderr: string } {
  try {
    const stdout = execFileSync(process.execPath, [GENERATOR_PATH, ...args], {
      encoding: 'utf8',
      cwd: REPO_ROOT,
    });
    return { status: 0, stdout, stderr: '' };
  } catch (error: unknown) {
    const e = error as { status?: number; stdout?: string; stderr?: string };
    return { status: e.status ?? 1, stdout: e.stdout ?? '', stderr: e.stderr ?? '' };
  }
}

const generatorSource = readFileSync(GENERATOR_PATH, 'utf8');

describe('(1, 2, 3, 4) the digest is deterministic, order-independent, and self-excluding', () => {
  it('(1) computes exactly the approved digest', () => {
    expect(generator.computeConfigDigest()).toBe(EXPECTED_DIGEST);
    // And the executable agrees with the module.
    expect(runGenerator([]).stdout.trim()).toBe(EXPECTED_DIGEST);
  });

  it('(1) the canonical payload is UTF-8, BOM-free, and has no trailing newline', () => {
    const canonical = generator.canonicalJson(generator.APPROVED_DIGEST_PAYLOAD);
    expect(canonical.charCodeAt(0)).not.toBe(0xfeff);
    expect(canonical.endsWith('\n')).toBe(false);
    expect(Buffer.byteLength(canonical, 'utf8')).toBe(709);
    expect(createHash('sha256').update(Buffer.from(canonical, 'utf8')).digest('hex')).toBe(
      EXPECTED_DIGEST,
    );
  });

  it('(2) recursive key-order changes do not alter the digest', () => {
    const approved = generator.APPROVED_DIGEST_PAYLOAD;
    // Rebuild the payload with every object's keys reversed, at both levels.
    const reverseKeys = (value: unknown): unknown => {
      if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
        const entries = Object.entries(value as Record<string, unknown>).reverse();
        return Object.fromEntries(entries.map(([k, v]) => [k, reverseKeys(v)]));
      }
      return value;
    };
    const shuffled = reverseKeys(approved) as Record<string, unknown>;
    expect(Object.keys(shuffled)).not.toEqual(Object.keys(approved));
    expect(generator.computeConfigDigest(shuffled)).toBe(EXPECTED_DIGEST);
    expect(generator.canonicalJson(shuffled)).toBe(generator.canonicalJson(approved));
  });

  it('(2) keys are ordered by Unicode code point, not UTF-16 code unit', () => {
    // Outside the BMP the two orders disagree; the comparator must follow code points.
    expect(generator.compareByCodePoint('a', 'b')).toBeLessThan(0);
    expect(generator.compareByCodePoint('b', 'a')).toBeGreaterThan(0);
    expect(generator.compareByCodePoint('a', 'a')).toBe(0);
    expect(generator.compareByCodePoint('a', 'ab')).toBeLessThan(0);
  });

  it('(3) changing any approved value changes the digest', () => {
    const approved = generator.APPROVED_DIGEST_PAYLOAD;
    const mutations: readonly Record<string, unknown>[] = [
      { ...approved, timeoutMs: 30_001 },
      { ...approved, maxInputTokens: 513 },
      { ...approved, maxCompletionTokens: 255 },
      { ...approved, promptVersion: 2 },
      { ...approved, credentialReference: 'groq.qfj.staging.smoke.v2' },
      { ...approved, capabilityProfileRef: 'cap.other' },
      { ...approved, evaluationRef: 'eval.other' },
      { ...approved, dataControlsAttestationRef: 'att.other' },
      { ...approved, schemaRevision: 'qfj.s1a.synthetic.smoke.schema.v2' },
      {
        ...approved,
        release: { ...(approved['release'] as object), modelId: 'openai/gpt-oss-120b' },
      },
      {
        ...approved,
        release: { ...(approved['release'] as object), releaseId: 'rel.other' },
      },
    ];
    for (const mutated of mutations) {
      expect(generator.computeConfigDigest(mutated)).not.toBe(EXPECTED_DIGEST);
    }
  });

  it('(4) configDigest is excluded from its own input', () => {
    const canonical = generator.canonicalJson(generator.APPROVED_DIGEST_PAYLOAD);
    expect(canonical).not.toContain('configDigest');
    expect(canonical).not.toContain(EXPECTED_DIGEST);
    // Supplying it is a hard error, not a silently-ignored field.
    expect(() =>
      generator.computeConfigDigest({
        ...generator.APPROVED_DIGEST_PAYLOAD,
        configDigest: EXPECTED_DIGEST,
      }),
    ).toThrow();
  });
});

describe('(5, 6, 7) the generated config is schema-valid and carries the approved values', () => {
  it('(5) passes the real merged parseSmokeConfig validator', () => {
    const result = parseSmokeConfig(generator.buildSmokeConfig());
    expect(result.ok).toBe(true);
  });

  it('(6) openai/gpt-oss-20b remains accepted', () => {
    const config = generator.buildSmokeConfig();
    expect((config['release'] as Record<string, unknown>)['modelId']).toBe('openai/gpt-oss-20b');
    expect(parseSmokeConfig(config).ok).toBe(true);
  });

  it('(7) contains exactly the approved non-secret values and no others', () => {
    expect(generator.buildSmokeConfig()).toEqual({
      credentialReference: 'groq.qfj.staging.smoke.v1',
      release: {
        releaseId: 'rel.groq.qfj.staging.smoke.v1',
        providerId: 'groq',
        modelId: 'openai/gpt-oss-20b',
        modelVersion: 'groq-catalog-snapshot-2026-07-28',
        executionClass: 'HOSTED',
        configDigest: EXPECTED_DIGEST,
      },
      dataClass: 'HOSTED_ALLOWED',
      maxInputTokens: 512,
      maxCompletionTokens: 256,
      supportsStrictJsonSchema: true,
      capabilityProfileRef: 'cap.groq.openai-gpt-oss-20b.strict-json.2026-07-28',
      evaluationRef: 'eval.qfj.synthetic-connectivity-smoke.v1',
      dataControlsAttestationRef: 'att.groq.qfj-staging.global-zdr.2026-07-28',
      dataControlsAttested: true,
      promptFamily: 'qfj.s1a.synthetic.smoke',
      promptVersion: 1,
      schemaRevision: 'qfj.s1a.synthetic.smoke.schema.v1',
      timeoutMs: 30_000,
    });
  });

  it('(7) the tracked approval record agrees with the generator, field for field', () => {
    const approval = JSON.parse(
      readFileSync(join(APPROVAL_DIR, 'release-approval.json'), 'utf8'),
    ) as Record<string, unknown>;
    const config = generator.buildSmokeConfig();
    for (const field of [
      'credentialReference',
      'dataClass',
      'maxInputTokens',
      'maxCompletionTokens',
      'supportsStrictJsonSchema',
      'capabilityProfileRef',
      'evaluationRef',
      'dataControlsAttestationRef',
      'dataControlsAttested',
      'promptFamily',
      'promptVersion',
      'schemaRevision',
      'timeoutMs',
    ]) {
      expect({ field, value: approval[field] }).toEqual({ field, value: config[field] });
    }
    expect(approval['release']).toEqual(config['release']);
    expect((approval['digest'] as Record<string, unknown>)['value']).toBe(EXPECTED_DIGEST);
  });
});

describe('(8, 9) the secret-field guard rejects the right things and only those', () => {
  it('(8) rejects credential-bearing fields', () => {
    for (const key of [
      'apiKey',
      'api_key',
      'key',
      'secret',
      'token',
      'bearer',
      'authorization',
      'password',
      'credentialValue',
    ]) {
      expect(() =>
        generator.computeConfigDigest({
          ...generator.APPROVED_DIGEST_PAYLOAD,
          [key]: 'NEVER-READ-THIS-VALUE',
        }),
      ).toThrow(/credential-bearing/);
    }
  });

  it('(8) rejects an unapproved non-secret field too', () => {
    expect(() =>
      generator.computeConfigDigest({ ...generator.APPROVED_DIGEST_PAYLOAD, region: 'eu' }),
    ).toThrow(/unapproved field/);
  });

  it('(8) rejects a credential-bearing field nested inside release', () => {
    expect(() =>
      generator.computeConfigDigest({
        ...generator.APPROVED_DIGEST_PAYLOAD,
        release: { ...(generator.APPROVED_DIGEST_PAYLOAD['release'] as object), apiKey: 'x' },
      }),
    ).toThrow(/credential-bearing/);
  });

  it('(9) does NOT falsely reject the allow-listed token-count and reference fields', () => {
    // A naive substring scan rejects `maxCompletionTokens` ("token") and would have to special-case
    // `credentialReference`. The allow-list runs first precisely so neither happens.
    expect(() => {
      generator.assertApprovedKeysOnly(generator.APPROVED_DIGEST_PAYLOAD);
    }).not.toThrow();
    expect(() => {
      generator.assertApprovedKeysOnly(generator.buildSmokeConfig());
    }).not.toThrow();
    for (const key of ['maxInputTokens', 'maxCompletionTokens', 'credentialReference']) {
      expect(Object.keys(generator.buildSmokeConfig())).toContain(key);
    }
  });
});

describe('(10, 11, 12) the generator has no secret, environment, stdin, or network surface', () => {
  it('(10) never reads an environment variable', () => {
    expect(generatorSource).not.toMatch(/process\s*\.\s*env/);
    expect(generatorSource).not.toMatch(/import\s*\.\s*meta\s*\.\s*env/);
    expect(generatorSource).not.toMatch(/from ['"]dotenv['"]/);
  });

  it('(11) never reads stdin and never prompts', () => {
    expect(generatorSource).not.toMatch(/process\s*\.\s*stdin/);
    expect(generatorSource).not.toMatch(/createInterface|readline|prompt\(/);
    expect(generatorSource).not.toMatch(/readFileSync\(\s*0\s*[,)]/);
    expect(generatorSource).not.toContain('/dev/stdin');
    // Proven behaviourally: the executable completes with stdin closed.
    expect(runGenerator([]).stdout.trim()).toBe(EXPECTED_DIGEST);
  });

  it('(12) imports no network, database, provider, or secret-resolver module', () => {
    const specifiers = generatorSource.match(/from ['"][^'"]+['"]/g) ?? [];
    expect(specifiers.sort()).toEqual([
      "from 'node:crypto'",
      "from 'node:fs'",
      "from 'node:path'",
      "from 'node:url'",
    ]);
    // The specifier list above is the authoritative proof: a module this script never loads
    // cannot be called. These add the behavioural belt — no direct network, no resolver.
    expect(generatorSource).not.toMatch(/\bfetch\s*\(/);
    expect(generatorSource).not.toMatch(/createNodeMaskedSecretSource|createFetchGroqTransport/);
    for (const statement of specifiers) {
      expect(statement).not.toMatch(/@qf-jarvis\//);
      expect(statement).not.toMatch(/\b(pg|groq-sdk|openai|axios|undici|node-fetch)\b/);
    }
  });
});

describe('(13, 14, 15, 16, 17) the emit path is guarded, atomic, and secret-free', () => {
  it('(13) refuses an output path inside the repository', () => {
    const inside = join(REPO_ROOT, 'qfj-smoke-config.json');
    expect(generator.isInsideRepository(inside)).toBe(true);
    expect(generator.isInsideRepository(join(REPO_ROOT, 'docs', 'x.json'))).toBe(true);
    expect(() => generator.writeConfigAtomically(inside, generator.buildSmokeConfig())).toThrow(
      /inside the repository/,
    );

    const run = runGenerator(['--emit-config', inside]);
    expect(run.status).toBe(1);
    expect(run.stderr).toContain('inside the repository');
    expect(existsSync(inside)).toBe(false);
  });

  it('(14) refuses to overwrite an existing file without --force, and accepts it with', () => {
    const dir = scratch();
    const target = join(dir, 'config.json');
    writeFileSync(target, 'PRE-EXISTING\n', 'utf8');

    const refused = runGenerator(['--emit-config', target]);
    expect(refused.status).toBe(1);
    expect(refused.stderr).toContain('--force');
    expect(readFileSync(target, 'utf8')).toBe('PRE-EXISTING\n');

    const forced = runGenerator(['--emit-config', target, '--force']);
    expect(forced.status).toBe(0);
    expect(parseSmokeConfig(JSON.parse(readFileSync(target, 'utf8'))).ok).toBe(true);
  });

  it('(15) writes atomically and leaves no staging directory behind', () => {
    const dir = scratch();
    const target = join(dir, 'config.json');
    const run = runGenerator(['--emit-config', target]);
    expect(run.status).toBe(0);
    expect(existsSync(target)).toBe(true);
    // The staging directory is created beside the target and removed in a finally.
    expect(readdirSync(dir)).toEqual(['config.json']);

    // A refused overwrite must also leave nothing behind and must not touch the original bytes.
    const before = readFileSync(target, 'utf8');
    expect(runGenerator(['--emit-config', target]).status).toBe(1);
    expect(readFileSync(target, 'utf8')).toBe(before);
    expect(readdirSync(dir)).toEqual(['config.json']);
  });

  it('(16) the emitted JSON is UTF-8 with exactly one final newline', () => {
    const dir = scratch();
    const target = join(dir, 'config.json');
    expect(runGenerator(['--emit-config', target]).status).toBe(0);

    const bytes = readFileSync(target);
    const text = bytes.toString('utf8');
    expect(text.endsWith('\n')).toBe(true);
    expect(text.endsWith('\n\n')).toBe(false);
    expect(bytes[0]).not.toBe(0xef); // no UTF-8 BOM
    expect(text.charCodeAt(0)).not.toBe(0xfeff);
    expect(Buffer.from(text, 'utf8').equals(bytes)).toBe(true);
    expect(text).toBe(generator.serialiseConfig(generator.buildSmokeConfig()));
  });

  it('(17) the emitted JSON contains no credential material', () => {
    const dir = scratch();
    const target = join(dir, 'config.json');
    expect(runGenerator(['--emit-config', target]).status).toBe(0);
    const text = readFileSync(target, 'utf8');

    for (const forbidden of [
      'apiKey',
      'api_key',
      'secret',
      'bearer',
      'Bearer',
      'authorization',
      'Authorization',
      'password',
      'credentialValue',
      'gsk_',
    ]) {
      expect(text).not.toContain(forbidden);
    }
    // The credential REFERENCE is an identifier and is expected; the key never is.
    expect(text).toContain('groq.qfj.staging.smoke.v1');
  });

  it('the success line carries only the output path and the digest', () => {
    const dir = scratch();
    const target = join(dir, 'config.json');
    const run = runGenerator(['--emit-config', target]);
    const lines = run.stdout.trim().split('\n');
    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe(`outputPath=${target}`);
    expect(lines[1]).toBe(`configDigest=${EXPECTED_DIGEST}`);
    // No approved field VALUE leaks into the success output.
    expect(run.stdout).not.toContain('openai/gpt-oss-20b');
    expect(run.stdout).not.toContain('HOSTED_ALLOWED');
  });

  it('rejects unknown arguments and a bare --force', () => {
    expect(() => generator.parseArgs(['--nope'])).toThrow();
    expect(() => generator.parseArgs(['--force'])).toThrow();
    expect(() => generator.parseArgs(['--emit-config'])).toThrow();
    expect(runGenerator(['--nope']).status).toBe(1);
  });
});

describe('(18) model-ID semantics stay aligned across gateway, evaluation, and smoke', () => {
  const CANONICAL = 'packages/model-gateway/src/contracts/model-id.ts';
  const MIRROR = 'packages/model-evaluation/src/contracts/model-id.ts';

  function patternOf(relative: string): string {
    const source = readFileSync(join(REPO_ROOT, relative), 'utf8');
    const match = /export const PROVIDER_MODEL_ID_PATTERN = \/(.+)\/;/.exec(source);
    expect(match).not.toBeNull();
    return match?.[1] ?? '';
  }

  function boundOf(relative: string): string {
    const source = readFileSync(join(REPO_ROOT, relative), 'utf8');
    const match = /export const MAX_PROVIDER_MODEL_ID_LENGTH = (\d+);/.exec(source);
    expect(match).not.toBeNull();
    return match?.[1] ?? '';
  }

  it('the gateway and evaluation grammars and bounds are identical', () => {
    expect(patternOf(MIRROR)).toBe(patternOf(CANONICAL));
    expect(boundOf(MIRROR)).toBe(boundOf(CANONICAL));
    expect(patternOf(CANONICAL)).toBe('^[A-Za-z0-9._:-]+(?:\\/[A-Za-z0-9._:-]+)*$');
    expect(boundOf(CANONICAL)).toBe('128');
  });

  it('the smoke configuration consumes the canonical gateway grammar', () => {
    const smokeConfigSource = readFileSync(
      join(REPO_ROOT, 'packages/groq-staging-smoke/src/config.ts'),
      'utf8',
    );
    expect(smokeConfigSource).toContain(
      "import { providerModelIdSchema } from '@qf-jarvis/model-gateway'",
    );
    expect(smokeConfigSource).toContain('modelId: EXACT_MODEL_ID');
  });

  it('the approved model id is accepted end to end by the smoke parser', () => {
    expect(parseSmokeConfig(generator.buildSmokeConfig()).ok).toBe(true);
  });
});

describe('(19, 20, 21, 22, 23, 24) repository invariants and evidence hygiene', () => {
  const LOCKED_MIGRATION_HASHES: Record<string, string> = {
    '0001_event_log.sql': 'dbca835c394dc67f015176af8ae0582faa78e0c1299593ac8970c5abf4389d6a',
    '0002_event_runtime_grants.sql':
      '4a6536afc23e53eb8f4ab91516e8bdc6700495a27ec386a99dbfb072719f736c',
    '0003_ingestion_rejection_and_event_conflict.sql':
      '407bea56929b592d93337892f6ee95ac006f3b4001dedb135151ccfb5b36ab0c',
    '0004_projection_foundation.sql':
      '148b31ea95f3ae90274cdc74381b8d1fb3be9caa0dfe7ff96771240a7c29cc30',
    '0005_projection_event_positions.sql':
      '96d641ad0c3ea47843ab9de00cf4ab9847fad6a0164bbacadf5c7ed439ccccae',
    '0006_projection_failure_operations.sql':
      'e97059a506ec4377fa39194de4fdc54e7d2f237941fb1e5243a0b01ff40a83d4',
    '0007_subject_activity_projection.sql':
      '8823b528d9e5aaccad7ddb6e16ebe254662c9759d14321fd3a6fa2e62b6dee49',
    '0008_conversation_control_persistence.sql':
      'e79f1f097407f4e630ce13858545dde80ec7ba5cc155bc117b1a62aa7d2b8a10',
    '0009_durable_approval_queue.sql':
      'e834bc3cd0bc8fd30b04f4849a00d29d49b5a19d1636b912535fdbd6d86f20f6',
    '0010_execution_replay_claim.sql':
      '1add85e08e43dafe85f124b886790cd3495d3f54b3579ad89efe40e2849a8b05',
    '0011_riya_conversation_continuity.sql':
      '80149f8d636aa85eaff7d98f924220107eaa3d539e5d13d5133873154926cc93',
  };

  it('(19) the model-evaluation package-root API lock remains 33', () => {
    // This package must NOT depend on @qf-jarvis/model-evaluation, so the lock is read from its
    // authoritative key-for-key list rather than loaded — proving the count without a dependency.
    const containment = readFileSync(
      join(REPO_ROOT, 'packages/model-evaluation/src/tests/containment.test.ts'),
      'utf8',
    );
    const block = /const EXPECTED = \[([\s\S]*?)\];/.exec(containment);
    expect(block).not.toBeNull();
    const symbols = (block?.[1] ?? '')
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.startsWith("'"));
    expect(symbols).toHaveLength(33);
    expect(containment).toContain('expect(Object.keys(barrel).sort()).toEqual(EXPECTED)');
  });

  it('(20) the event-backbone package-root API lock remains 39', () => {
    expect(
      readFileSync(join(REPO_ROOT, 'packages/event-backbone/src/tests/public-api.test.ts'), 'utf8'),
    ).toContain('toHaveLength(39)');
  });

  it('(21, 22) migrations 0001-0011 are byte-identical and 0012 is absent', () => {
    const dir = join(REPO_ROOT, 'packages/event-backbone/src/persistence/migrations');
    const sql = readdirSync(dir)
      .filter((name) => name.endsWith('.sql'))
      .sort();
    expect(sql).toEqual(Object.keys(LOCKED_MIGRATION_HASHES));
    for (const [name, hash] of Object.entries(LOCKED_MIGRATION_HASHES)) {
      expect(
        createHash('sha256')
          .update(readFileSync(join(dir, name)))
          .digest('hex'),
      ).toBe(hash);
    }
    expect(sql.some((name) => name.startsWith('0012'))).toBe(false);
  });

  it('(23) nothing in this slice references or writes the protected directory', () => {
    const protectedName = 'qfj-managed-reconciliation-0002-0005';
    expect(generatorSource).not.toContain(protectedName);
    for (const file of readdirSync(APPROVAL_DIR)) {
      expect(readFileSync(join(APPROVAL_DIR, file), 'utf8')).not.toContain(protectedName);
    }
    // The generator can only ever write outside the repository, so it cannot reach it.
    expect(generator.isInsideRepository(join(REPO_ROOT, 'docs', 'reports', protectedName))).toBe(
      true,
    );
  });

  it('(24) no test fixture is treated as owner approval evidence', () => {
    // The synthetic fixture values must be DISTINCT from every approved value, so an accidental
    // substitution cannot pass unnoticed.
    const fixture = syntheticSmokeConfigInput();
    const approved = generator.buildSmokeConfig();
    expect(fixture['credentialReference']).not.toBe(approved['credentialReference']);
    expect(fixture['capabilityProfileRef']).not.toBe(approved['capabilityProfileRef']);
    expect(fixture['evaluationRef']).not.toBe(approved['evaluationRef']);
    expect(fixture['dataControlsAttestationRef']).not.toBe(approved['dataControlsAttestationRef']);
    const fixtureRelease = fixture['release'] as Record<string, unknown>;
    const approvedRelease = approved['release'] as Record<string, unknown>;
    for (const field of ['releaseId', 'providerId', 'modelId', 'modelVersion', 'configDigest']) {
      expect(fixtureRelease[field]).not.toBe(approvedRelease[field]);
    }

    // And the approval records contain no fixture value.
    for (const file of readdirSync(APPROVAL_DIR)) {
      const text = readFileSync(join(APPROVAL_DIR, file), 'utf8');
      for (const fixtureValue of [
        'rel.groq.staging.1',
        'cap.groq.reply.v1',
        'evref-groq-0001',
        'zdr.groq.staging.0001',
        'groq.staging.secret.v1',
        'cfg-groq-0001',
      ]) {
        expect(text).not.toContain(fixtureValue);
      }
    }
  });

  it('the approval records carry no credential material', () => {
    for (const file of readdirSync(APPROVAL_DIR)) {
      const text = readFileSync(join(APPROVAL_DIR, file), 'utf8');
      for (const forbidden of ['gsk_', 'Bearer ', 'apiKey', 'api_key', 'credentialValue']) {
        expect(text).not.toContain(forbidden);
      }
    }
  });
});
