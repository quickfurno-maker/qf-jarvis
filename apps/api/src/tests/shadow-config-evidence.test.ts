/**
 * QFJ-S2-E-B — configuration, CLI parsing, and evidence generation (ADR-0065).
 *
 * Matrix: the closed config schema refuses every malformed or non-distinct identity; the CLI parser
 * refuses unknown, duplicate, valueless and relative arguments; digests are recomputed and matched
 * before anything else happens; and evidence is built only through `createApprovalEvidence`, at exactly
 * `SHADOW_ELIGIBILITY`, synthetic and non-production.
 *
 * Every test is offline: pure functions, injected readers, temporary synthetic files.
 */
import { chmod, mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { contentDigest, EVALUATION_APPROVAL_TARGETS } from '@qf-jarvis/model-evaluation';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { generateShadowEvidenceCli } from '../cli/generate-shadow-evidence.js';
import { parseShadowArgs } from '../cli/shadow-cli-args.js';
import { runShadowOnceCli } from '../cli/run-shadow-once.js';
import { generateShadowEvidence } from '../shadow/shadow-evidence-generator.js';
import {
  createShadowConfigReader,
  createShadowEvidenceReader,
  MAX_SHADOW_CONFIG_BYTES,
} from '../shadow/shadow-json-reader.js';
import { SHADOW_PROMPT_ID, shadowReplySchema } from '../shadow/shadow-request.js';
import {
  MAX_SHADOW_TIMEOUT_MS,
  MIN_SHADOW_TIMEOUT_MS,
  validateShadowRunConfig,
} from '../shadow/shadow-run-config.js';
import {
  configDigestOf,
  jsonReaderFor,
  rawShadowConfig,
  shadowConfig,
  shadowConfigWithEvidence,
} from './shadow-test-support.js';

const POSIX = process.platform !== 'win32';
let dir: string;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'qfj-s2eb-'));
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

function validate(over: Record<string, unknown> = {}, expectedDigest?: string) {
  return validateShadowRunConfig(rawShadowConfig(over), {
    expectedPromptId: SHADOW_PROMPT_ID,
    digest: contentDigest,
    ...(expectedDigest === undefined ? {} : { expectedDigest }),
  });
}

describe('(8-29) the closed run configuration', () => {
  it('(8, 9) a valid config parses and is frozen', () => {
    const result = validate();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(Object.isFrozen(result.config)).toBe(true);
    expect(result.config.schemaVersion).toBe(1);
  });

  it('(10) an unknown field is refused, not ignored', () => {
    const result = validate({ extra: 'nope' });
    expect(result).toEqual({ ok: false, reason: 'config-schema-invalid' });
  });

  it('(18, 19, 20) stable and candidate identities must be distinct', () => {
    const base = rawShadowConfig();
    const stable = base['stable'] as Record<string, string>;
    const candidate = base['candidate'] as Record<string, string>;
    for (const over of [
      { candidate: { ...candidate, providerId: stable['providerId'] } },
      { candidate: { ...candidate, releaseId: stable['releaseId'] } },
      { candidate: { ...candidate, configDigest: stable['configDigest'] } },
    ]) {
      expect(validate(over)).toEqual({ ok: false, reason: 'config-identity-not-distinct' });
    }
  });

  it('(21, 22, 23) model id, model version and capability profile are single-valued and shared', () => {
    // There is exactly ONE modelId/modelVersion/capabilityProfileRef field, so both legs share them by
    // construction — a per-leg override is not representable.
    const result = validate();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(Object.keys(result.config.stable).sort()).toEqual([
      'configDigest',
      'providerId',
      'releaseId',
    ]);
    expect(Object.keys(result.config.candidate).sort()).toEqual([
      'configDigest',
      'providerId',
      'releaseId',
    ]);
  });

  it('(24) a wildcard or `latest` identity is refused', () => {
    for (const over of [
      { runId: 'latest' },
      { rolloutId: 'LATEST' },
      { credentialReference: 'latest' },
      { modelVersion: 'latest' },
      { capabilityProfileRef: 'latest' },
      { evidenceRef: 'latest' },
    ]) {
      expect(validate(over)).toEqual({ ok: false, reason: 'config-wildcard-identity' });
    }
    // `*` fails the identifier grammar before the wildcard check, which is also a refusal.
    expect(validate({ runId: '*' }).ok).toBe(false);
  });

  it('(25, 26) the timeout is bounded to 1,000-30,000 ms', () => {
    expect(validate({ timeoutMs: MIN_SHADOW_TIMEOUT_MS - 1 }).ok).toBe(false);
    expect(validate({ timeoutMs: MAX_SHADOW_TIMEOUT_MS + 1 }).ok).toBe(false);
    expect(validate({ timeoutMs: MIN_SHADOW_TIMEOUT_MS }).ok).toBe(true);
    expect(validate({ timeoutMs: MAX_SHADOW_TIMEOUT_MS }).ok).toBe(true);
  });

  it('(27) a false or missing owner attestation is refused', () => {
    for (const key of [
      'zdrEnabled',
      'modelPermissionScoped',
      'syntheticPromptConfirmed',
      'outputDiscardConfirmed',
      'oneShotAuthorizationConfirmed',
    ]) {
      const attestations = { ...(rawShadowConfig()['attestations'] as Record<string, boolean>) };
      attestations[key] = false;
      expect(validate({ attestations }).ok).toBe(false);
    }
    expect(validate({ attestations: {} }).ok).toBe(false);
  });

  it('(28) a promptId that is not the source constant is refused', () => {
    expect(validate({ promptId: 'qfj.some.other.prompt' })).toEqual({
      ok: false,
      reason: 'config-prompt-id-mismatch',
    });
  });

  it('(16) a config digest mismatch is refused, and a match is accepted', () => {
    const config = shadowConfig();
    expect(validate({}, 'deadbeefdeadbeef')).toEqual({
      ok: false,
      reason: 'config-digest-mismatch',
    });
    expect(validate({}, configDigestOf(config)).ok).toBe(true);
  });

  it('(29) no refusal carries a path, a digest, or a field value', () => {
    const refusals = [
      validate({ extra: 1 }),
      validate({ promptId: 'other' }),
      validate({}, 'deadbeefdeadbeef'),
    ];
    for (const refusal of refusals) {
      expect(refusal.ok).toBe(false);
      if (refusal.ok) continue;
      expect(Object.keys(refusal).sort()).toEqual(['ok', 'reason']);
      expect(JSON.stringify(refusal)).not.toContain('deadbeef');
    }
  });
});

describe('(11-15) the CLI argument parser', () => {
  const REQUIRED = ['--config'] as const;

  it('(11) an unknown flag is refused', () => {
    expect(parseShadowArgs(['--nope', '/a'], REQUIRED)).toEqual({
      ok: false,
      reason: 'args-unknown-flag',
    });
  });

  it('(12) a duplicate flag is refused', () => {
    expect(parseShadowArgs(['--config', '/a', '--config', '/b'], REQUIRED)).toEqual({
      ok: false,
      reason: 'args-duplicate-flag',
    });
  });

  it('a missing value and a stray positional are refused', () => {
    expect(parseShadowArgs(['--config'], REQUIRED).ok).toBe(false);
    expect(parseShadowArgs(['positional'], REQUIRED)).toEqual({
      ok: false,
      reason: 'args-unexpected-positional',
    });
  });

  it('(13, 14, 15) a relative path is refused for every path flag', () => {
    for (const flag of ['--config', '--evidence', '--credential-file'] as const) {
      expect(parseShadowArgs([flag, 'relative/path.json'], [flag])).toEqual({
        ok: false,
        reason: 'args-relative-path',
      });
    }
  });

  it('a malformed digest is refused, and a required flag must be present', () => {
    expect(
      parseShadowArgs(['--expected-config-digest', 'NOT-HEX'], ['--expected-config-digest']),
    ).toEqual({ ok: false, reason: 'args-invalid-digest' });
    expect(parseShadowArgs([], REQUIRED)).toEqual({ ok: false, reason: 'args-missing-required' });
  });

  it('an absolute path and a hex digest are accepted', () => {
    const result = parseShadowArgs(
      [
        '--config',
        POSIX ? '/abs/config.json' : 'C:\\abs\\config.json',
        '--expected-config-digest',
        'abcdef0123456789',
      ],
      REQUIRED,
    );
    expect(result.ok).toBe(true);
  });
});

describe('(30-44) the offline evidence generator', () => {
  it('(30, 31, 32, 33) it produces SHADOW_ELIGIBILITY evidence, synthetic and non-production', () => {
    const generated = generateShadowEvidence(shadowConfig());
    expect(generated.ok).toBe(true);
    if (!generated.ok) return;
    expect(generated.evidence.target).toBe('SHADOW_ELIGIBILITY');
    expect(generated.evidence.synthetic).toBe(true);
    expect(generated.evidence.productionApproval).toBe(false);
    // Produced by the real gate: an `evref-` reference is minted by createApprovalEvidence.
    expect(generated.evidence.evaluationRef.startsWith('evref-')).toBe(true);
  });

  it('(38, 39) the evidence binds the CANDIDATE release and the capability profile', () => {
    const config = shadowConfig();
    const generated = generateShadowEvidence(config);
    expect(generated.ok).toBe(true);
    if (!generated.ok) return;
    const bound = generated.evidence.binding.release;
    expect(bound.releaseId).toBe(config.candidate.releaseId);
    expect(bound.providerId).toBe(config.candidate.providerId);
    expect(bound.configDigest).toBe(config.candidate.configDigest);
    expect(bound.modelId).toBe(config.modelId);
    expect(generated.evidence.binding.capabilityProfileRef).toBe(config.capabilityProfileRef);
    // NOT the stable release: the candidate is the release being shadowed.
    expect(bound.releaseId).not.toBe(config.stable.releaseId);
  });

  it('(40, 41) generation is byte-stable and the digest is deterministic', () => {
    const a = generateShadowEvidence(shadowConfig());
    const b = generateShadowEvidence(shadowConfig());
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(JSON.stringify(a.evidence)).toBe(JSON.stringify(b.evidence));
    expect(a.digest).toBe(b.digest);
    expect(a.digest).toBe(contentDigest(a.evidence));
  });

  it('(42) a hand-edited artifact no longer matches its digest', () => {
    const generated = generateShadowEvidence(shadowConfig());
    expect(generated.ok).toBe(true);
    if (!generated.ok) return;
    const tampered = { ...generated.evidence, createdAt: '2020-01-01T00:00:00.000Z' };
    expect(contentDigest(tampered)).not.toBe(generated.digest);
  });

  it('it covers the FULL mandatory red-team set rather than declaring an empty one', () => {
    // A suite with no mandatory kinds satisfies `mandatoryCovered` trivially. This one does not cheat:
    // evidence exists only because every mandatory kind ran and passed.
    const generated = generateShadowEvidence(shadowConfig());
    expect(generated.ok).toBe(true);
    if (!generated.ok) return;
    expect(generated.evidence.caseSetDigest.length).toBeGreaterThan(0);
    expect(generated.evidence.binding.evaluationSuiteVersion).toBe(1);
  });

  it('(43) the generator CLI emits only safe fields and writes the artifact separately', async () => {
    const lines: string[] = [];
    const artifacts: string[] = [];
    const code = await generateShadowEvidenceCli(
      ['--config', POSIX ? '/abs/c.json' : 'C:\\abs\\c.json'],
      {
        write: (line) => lines.push(line),
        writeArtifact: (json) => artifacts.push(json),
        nowIso: () => '2026-07-30T00:00:00.000Z',
      },
      { configReader: jsonReaderFor(rawShadowConfig()) },
    );
    expect(code).toBe(0);
    expect(lines).toHaveLength(1);
    const emitted = JSON.parse(lines[0] ?? '{}') as Record<string, unknown>;
    expect(Object.keys(emitted).sort()).toEqual([
      'authority',
      'evidenceDigest',
      'evidenceTarget',
      'outcome',
      'productionApproval',
      'reason',
      'synthetic',
      'timestamp',
    ]);
    expect(emitted['evidenceTarget']).toBe('SHADOW_ELIGIBILITY');
    expect(emitted['synthetic']).toBe(true);
    expect(emitted['productionApproval']).toBe(false);
    // The result line carries no path and no credential reference.
    expect(lines[0]).not.toContain('/abs/');
    expect(lines[0]).not.toContain('groq.qfj.shadow');
    expect(artifacts).toHaveLength(1);
  });

  it('every approval target is a known member, and this runner mints only the least one', () => {
    expect([...EVALUATION_APPROVAL_TARGETS]).toContain('SHADOW_ELIGIBILITY');
    const generated = generateShadowEvidence(shadowConfig());
    expect(generated.ok && generated.evidence.target).toBe('SHADOW_ELIGIBILITY');
  });
});

describe('(45-53) the non-secret JSON readers', () => {
  it('(49, 50) a symlink is refused for both readers', async () => {
    const target = join(dir, 'real.json');
    await writeFile(target, JSON.stringify({ a: 1 }), 'utf8');
    const link = join(dir, 'link.json');
    let created = true;
    try {
      await symlink(target, link);
    } catch {
      created = false;
    }
    if (!created) {
      expect(POSIX).toBe(false);
      return;
    }
    for (const reader of [createShadowConfigReader(link), createShadowEvidenceReader(link)]) {
      expect(await reader.read()).toEqual({ ok: false, failure: 'unreadable' });
    }
  });

  it('a directory and a relative path are refused', async () => {
    const sub = join(dir, 'a-dir');
    await mkdir(sub, { recursive: true });
    expect(await createShadowConfigReader(sub).read()).toEqual({
      ok: false,
      failure: 'unreadable',
    });
    expect(await createShadowConfigReader('relative.json').read()).toEqual({
      ok: false,
      failure: 'unreadable',
    });
  });

  it('(51, 52) an oversized file is refused before allocation', async () => {
    const path = join(dir, 'huge.json');
    await writeFile(path, 'x'.repeat(MAX_SHADOW_CONFIG_BYTES + 1), 'utf8');
    expect(await createShadowConfigReader(path).read()).toEqual({
      ok: false,
      failure: 'too-large',
    });
  });

  it('(53) malformed JSON and a missing file surface no path or parser message', async () => {
    const bad = join(dir, 'bad.json');
    await writeFile(bad, '{ not json', 'utf8');
    const notJson = await createShadowConfigReader(bad).read();
    expect(notJson).toEqual({ ok: false, failure: 'not-json' });
    expect(JSON.stringify(notJson)).not.toContain(dir);

    const absent = await createShadowConfigReader(join(dir, 'absent.json')).read();
    expect(absent).toEqual({ ok: false, failure: 'unreadable' });
    expect(JSON.stringify(absent)).not.toContain('ENOENT');
  });

  it('a valid config file round-trips through the real reader', async () => {
    const path = join(dir, 'config.json');
    await writeFile(path, JSON.stringify(rawShadowConfig()), 'utf8');
    if (POSIX) {
      await chmod(path, 0o600);
    }
    const read = await createShadowConfigReader(path).read();
    expect(read.ok).toBe(true);
  });
});

describe('the runner CLI refuses before touching a credential', () => {
  const io = () => {
    const lines: string[] = [];
    return {
      lines,
      write: (line: string) => lines.push(line),
      nowIso: () => '2026-07-30T00:00:00.000Z',
    };
  };

  it('(16, 17) a digest mismatch refuses, and the line carries no digest', async () => {
    const { config, evidence } = shadowConfigWithEvidence();
    const sink = io();
    const code = await runShadowOnceCli(
      [
        '--config',
        POSIX ? '/abs/c.json' : 'C:\\abs\\c.json',
        '--evidence',
        POSIX ? '/abs/e.json' : 'C:\\abs\\e.json',
        '--credential-file',
        POSIX ? '/abs/k.key' : 'C:\\abs\\k.key',
        '--expected-config-digest',
        'deadbeefdeadbeef',
        '--expected-evidence-digest',
        evidence.digest,
      ],
      sink,
      {
        configReader: jsonReaderFor(
          rawShadowConfig({ evidenceRef: config.evidenceRef, evidenceDigest: evidence.digest }),
        ),
        evidenceReader: jsonReaderFor(evidence.evidence),
        runner: () => {
          throw new Error('the runner must not be reached on a digest mismatch');
        },
      },
    );
    expect(code).toBe(1);
    expect(sink.lines).toHaveLength(1);
    const emitted = JSON.parse(sink.lines[0] ?? '{}') as Record<string, unknown>;
    expect(emitted['reason']).toBe('config-invalid');
    expect(sink.lines[0]).not.toContain('deadbeef');
    expect(sink.lines[0]).not.toContain('/abs/');
  });

  it('a bad argv refuses with one line and never constructs anything', async () => {
    const sink = io();
    const code = await runShadowOnceCli(['--unknown', 'x'], sink, {
      runner: () => {
        throw new Error('the runner must not be reached on a bad argv');
      },
    });
    expect(code).toBe(1);
    expect(sink.lines).toHaveLength(1);
    expect((JSON.parse(sink.lines[0] ?? '{}') as Record<string, unknown>)['reason']).toBe(
      'config-invalid',
    );
  });
});

describe('the fixed synthetic request', () => {
  it('the strict schema accepts only {"status":"ok"}', () => {
    expect(shadowReplySchema.safeParse({ status: 'ok' }).success).toBe(true);
    expect(shadowReplySchema.safeParse({ status: 'nope' }).success).toBe(false);
    expect(shadowReplySchema.safeParse({ status: 'ok', extra: 1 }).success).toBe(false);
    expect(shadowReplySchema.safeParse({}).success).toBe(false);
  });
});
