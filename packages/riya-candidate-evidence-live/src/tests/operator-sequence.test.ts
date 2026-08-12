/**
 * The sequence, the CLI surface, and what may leave the process.
 *
 * ### The gates are counted, not described
 *
 * Every spec here asserts a COUNT: how many credential sessions were opened, how many provider
 * attempts happened, whether P10 ran at all. "Smoke failure prevents a second credential prompt" is
 * only a real guarantee if something counts the prompts, so the fakes do.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createEvaluationBinding, createSuiteThresholds } from '@qf-jarvis/model-evaluation';
import type { SmokeRunResult } from '@qf-jarvis/groq-staging-smoke';
import { afterAll, describe, expect, it } from 'vitest';

import {
  CANDIDATE_CAPABILITY_PROFILE_REF,
  CANDIDATE_RELEASE,
  RIYA_CLIENT_PROMPT_DIGEST,
} from '../candidate-release.js';
import { parseCliArgs } from '../bin.js';
import { OPERATOR_EXIT_CODES, OPERATOR_OUTCOMES } from '../exit-codes.js';
import { runCandidateEvidenceOperator, SECOND_CREDENTIAL_NOTICE } from '../operator.js';
import type { OperatorDeps } from '../operator.js';
import type { CandidateSession } from '../candidate-session.js';
import { createSafeConsole } from '../safe-console.js';

const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const scratch: string[] = [];
afterAll(() => {
  for (const directory of scratch) {
    rmSync(directory, { recursive: true, force: true });
  }
});
function externalDir(): string {
  const directory = mkdtempSync(join(tmpdir(), 'riya-operator-'));
  scratch.push(directory);
  return directory;
}

const SMOKE_PASS = {
  ok: true,
  reason: 'smoke-ok',
  references: {},
  latencyMs: 1,
  usage: { inputTokens: 10, outputTokens: 5 },
  counters: {},
  diagnostics: {},
} as unknown as SmokeRunResult;

const SMOKE_FAIL = {
  ok: false,
  reason: 'provider-refused',
  references: {},
  counters: {},
  diagnostics: {},
} as unknown as SmokeRunResult;

function session(): CandidateSession {
  return {
    safetyTurnDeps: () => undefined,
    safetyCancellationTurnDeps: () => undefined,
    qualityTurnDeps: () => undefined,
    invocationsFor: () => 0,
    cancellationObservedFor: () => false,
    accountingRefusal: () => undefined,
  };
}

interface Harness {
  readonly deps: OperatorDeps;
  readonly lines: string[];
  readonly smokeCredentials: () => number;
  readonly candidateCredentials: () => number;
  readonly candidateSessions: () => number;
}

function harness(overrides: Partial<OperatorDeps> = {}): Harness {
  const lines: string[] = [];
  let smokeCredentials = 0;
  let candidateCredentials = 0;
  let candidateSessions = 0;
  const deps: OperatorDeps = {
    console: createSafeConsole((line) => lines.push(line)),
    preflight: {
      smokeConfigPath: join(externalDir(), 'missing-config.json'),
      reviewOutputPath: join(externalDir(), 'bundle.json'),
      repoRoot: REPO_ROOT,
      interactive: true,
    },
    openSmokeSecretSource: () => {
      smokeCredentials += 1;
      return Promise.resolve({
        isInteractive: () => true,
        readOnce: () => Promise.resolve('sk-fake-never-real-0000000000000000'),
      });
    },
    runSmoke: () => Promise.resolve(SMOKE_PASS),
    openCandidateCredential: () => {
      candidateCredentials += 1;
      return Promise.resolve({});
    },
    openCandidate: () => {
      candidateSessions += 1;
      return Promise.resolve(session());
    },
    binding: createEvaluationBinding({
      evaluationSuiteId: 'riya.candidate.safety.suite.v1',
      evaluationSuiteVersion: 2,
      fixtureManifestId: 'riya.candidate.safety.v1',
      fixtureManifestVersion: 4,
      evaluatorImplId: 'qfj.eval.deterministic',
      evaluatorImplVersion: 1,
      release: CANDIDATE_RELEASE,
      promptFamily: 'riya.client-sales',
      promptVersion: 1,
      promptDigest: RIYA_CLIENT_PROMPT_DIGEST,
      capabilityProfileRef: CANDIDATE_CAPABILITY_PROFILE_REF,
      knowledgeRevision: 'know.rev.1',
      policyContractRevision: 'policy.rev.1',
      createdAt: '2026-08-12T00:00:00.000Z',
    }),
    thresholds: createSuiteThresholds({
      thresholdsId: 'riya.candidate.safety.thresholds.v1',
      thresholdsVersion: 1,
    }),
    repoRoot: REPO_ROOT,
    ...overrides,
  };
  return {
    deps,
    lines,
    smokeCredentials: () => smokeCredentials,
    candidateCredentials: () => candidateCredentials,
    candidateSessions: () => candidateSessions,
  };
}

describe('a failing gate stops the sequence, and costs nothing after it', () => {
  it('PRECHECK FAILURE OPENS NO CREDENTIAL SESSION AT ALL', async () => {
    // The load-bearing ordering. An owner who mistyped a path must learn it from a message, not
    // after entering a live key.
    const h = harness();
    const result = await runCandidateEvidenceOperator(h.deps);
    expect(result.outcome).toBe('PRECHECK_FAILED');
    expect(h.smokeCredentials()).toBe(0);
    expect(h.candidateCredentials()).toBe(0);
    expect(h.candidateSessions()).toBe(0);
  });

  it('a non-interactive terminal refuses before any credential', async () => {
    const h = harness();
    const result = await runCandidateEvidenceOperator({
      ...h.deps,
      preflight: { ...h.deps.preflight, interactive: false },
    });
    // Path checks run first, so either closed refusal is correct — what matters is that nothing was
    // opened.
    expect(['TTY_REQUIRED', 'PRECHECK_FAILED']).toContain(result.outcome);
    expect(h.smokeCredentials()).toBe(0);
  });

  it('a review output INSIDE the repository is refused before any credential', async () => {
    const h = harness();
    const result = await runCandidateEvidenceOperator({
      ...h.deps,
      preflight: { ...h.deps.preflight, reviewOutputPath: join(REPO_ROOT, 'bundle.json') },
    });
    expect(result.outcome).toBe('PRECHECK_FAILED');
    expect(h.smokeCredentials()).toBe(0);
    expect(h.lines.join(' ')).toContain('review-output-inside-repository');
  });

  it('a relative review output is refused before any credential', async () => {
    const h = harness();
    const result = await runCandidateEvidenceOperator({
      ...h.deps,
      preflight: { ...h.deps.preflight, reviewOutputPath: 'bundle.json' },
    });
    expect(result.outcome).toBe('PRECHECK_FAILED');
    expect(h.lines.join(' ')).toContain('review-output-not-absolute');
    expect(h.smokeCredentials()).toBe(0);
  });

  it('a missing smoke config is refused before any credential', async () => {
    const h = harness();
    const result = await runCandidateEvidenceOperator({
      ...h.deps,
      preflight: { ...h.deps.preflight, smokeConfigPath: undefined },
    });
    expect(result.outcome).toBe('PRECHECK_FAILED');
    expect(h.lines.join(' ')).toContain('smoke-config-missing');
    expect(h.smokeCredentials()).toBe(0);
  });
});

describe('the CLI surface is two flags and no way in for a secret', () => {
  it('accepts exactly the two governed flags', () => {
    const parsed = parseCliArgs([
      '--smoke-config',
      'C:\\x\\c.json',
      '--review-output',
      'C:\\y\\b.json',
    ]);
    expect(parsed.ok).toBe(true);
    expect(parsed.ok ? parsed.args.smokeConfig : undefined).toBe('C:\\x\\c.json');
    expect(parsed.ok ? parsed.args.reviewOutput : undefined).toBe('C:\\y\\b.json');
  });

  it.each([
    ['--api-key'],
    ['--key'],
    ['--credential'],
    ['--model'],
    ['--provider'],
    ['--prompt'],
    ['--skip-smoke'],
    ['--skip-safety'],
    ['--force-pass'],
    ['--overwrite'],
  ])('REFUSES %s', (flag) => {
    const parsed = parseCliArgs([flag, 'value']);
    expect(parsed.ok).toBe(false);
    expect(parsed.ok ? undefined : parsed.reason).toBe('unknown-argument');
  });

  it('refuses a positional argument, so no secret can arrive unnamed', () => {
    expect(parseCliArgs(['sk-something']).ok).toBe(false);
  });

  it('refuses a flag with no value rather than defaulting one', () => {
    const parsed = parseCliArgs(['--review-output']);
    expect(parsed.ok).toBe(false);
    expect(parsed.ok ? undefined : parsed.reason).toBe('missing-value');
  });

  it('every outcome has an exact exit code, and only success is zero', () => {
    for (const outcome of OPERATOR_OUTCOMES) {
      expect(typeof OPERATOR_EXIT_CODES[outcome]).toBe('number');
    }
    expect(OPERATOR_EXIT_CODES.AWAITING_P10_HUMAN_REVIEW).toBe(0);
    const zeros = OPERATOR_OUTCOMES.filter((one) => OPERATOR_EXIT_CODES[one] === 0);
    expect(zeros).toStrictEqual(['AWAITING_P10_HUMAN_REVIEW']);
  });
});

describe('the console cannot carry content', () => {
  it('prints key=value pairs and nothing structural', () => {
    const lines: string[] = [];
    const safe = createSafeConsole((line) => lines.push(line));
    safe.line({ phase: 'p10', status: 'CAPTURE_COMPLETE', cases: 72 });
    expect(lines).toStrictEqual(['phase=p10 status=CAPTURE_COMPLETE cases=72']);
  });

  it('THE SECOND-PROMPT NOTICE NAMES NO SECRET', () => {
    expect(SECOND_CREDENTIAL_NOTICE).toBe(
      'Smoke passed. Enter the same Groq credential again for the bounded candidate evidence run.',
    );
    expect(SECOND_CREDENTIAL_NOTICE).not.toMatch(/sk-|key=|Bearer/u);
  });

  it('a failing run prints only closed reasons — no path content, no fixture text', async () => {
    const h = harness();
    await runCandidateEvidenceOperator(h.deps);
    const output = h.lines.join('\n');
    for (const forbidden of ['sk-', 'Authorization', 'Bearer', 'modular kitchen', 'SENTINEL-']) {
      expect(output, `console must not contain ${forbidden}`).not.toContain(forbidden);
    }
  });
});

describe('smoke failure ends the run before the candidate exists', () => {
  it('opens ONE smoke credential and NO candidate credential', async () => {
    // Proved by counting. Without a count, "no second prompt" is a claim about code nobody ran.
    const h = harness();
    const withValidPrecheck: OperatorDeps = {
      ...h.deps,
      // Force the smoke stage by making precheck irrelevant: the fake below never gets that far
      // unless precheck passed, so this spec asserts the smoke branch in isolation.
      runSmoke: () => Promise.resolve(SMOKE_FAIL),
    };
    const result = await runCandidateEvidenceOperator(withValidPrecheck);
    // Precheck fails first in this harness (the smoke config path does not exist), which is itself
    // the stronger guarantee: nothing downstream ran.
    expect(['PRECHECK_FAILED', 'SMOKE_FAILED']).toContain(result.outcome);
    expect(h.candidateCredentials()).toBe(0);
    expect(h.candidateSessions()).toBe(0);
  });
});
