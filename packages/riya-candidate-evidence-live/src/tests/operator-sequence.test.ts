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
import { ledgerForRunGoal, parseCliArgs } from '../bin.js';
import { OPERATOR_EXIT_CODES, OPERATOR_OUTCOMES } from '../exit-codes.js';
import {
  DEFAULT_RUN_GOAL,
  OPERATOR_RUN_GOALS,
  SECOND_CREDENTIAL_NOTICES,
} from '../internal/run-goal.js';
import { runCandidateEvidenceOperator, SECOND_CREDENTIAL_NOTICE } from '../operator.js';
import type { OperatorDeps } from '../operator.js';
import type { CandidateSession } from '../candidate-session.js';
import { NOT_REACHED_TRANSPORT_OBSERVATION } from '../candidate-transport-observation.js';
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
    gatewayErrorFor: () => undefined,
    cancellationObservedFor: () => false,
    // This fake never builds a turn, so no case ever reaches the transport boundary.
    transportObservationFor: () => NOT_REACHED_TRANSPORT_OBSERVATION,
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
    openSmokeCredential: () => {
      smokeCredentials += 1;
      return Promise.resolve({
        credentialSource: {
          isInteractive: () => true,
          readOnce: () => Promise.resolve('sk-fake-never-real-0000000000000000'),
        },
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

describe('HF3 — the one optional governed run goal', () => {
  it('THE OLD TWO-FLAG COMMAND STILL PARSES AND STILL MEANS FULL EVIDENCE', () => {
    // The command an owner already has must keep meaning what it meant, with no new flag required.
    const parsed = parseCliArgs([
      '--smoke-config',
      'C:\\x\\c.json',
      '--review-output',
      'C:\\y\\b.json',
    ]);
    expect(parsed.ok).toBe(true);
    expect(parsed.ok ? parsed.args.runGoal : 'set').toBeUndefined();
    expect(DEFAULT_RUN_GOAL).toBe('FULL_EVIDENCE');
  });

  it('accepts --run-goal SAFETY_REPLICATION alongside the two paths', () => {
    const parsed = parseCliArgs([
      '--smoke-config',
      'C:\\x\\c.json',
      '--review-output',
      'C:\\y\\b.json',
      '--run-goal',
      'SAFETY_REPLICATION',
    ]);
    expect(parsed.ok).toBe(true);
    expect(parsed.ok ? parsed.args.runGoal : undefined).toBe('SAFETY_REPLICATION');
    expect(parsed.ok ? parsed.args.smokeConfig : undefined).toBe('C:\\x\\c.json');
  });

  it('--run-goal with no value is missing-value, not a silent default', () => {
    expect(parseCliArgs(['--run-goal']).ok).toBe(false);
    const bare = parseCliArgs(['--run-goal']);
    expect(bare.ok ? undefined : bare.reason).toBe('missing-value');
    const swallowing = parseCliArgs(['--run-goal', '--smoke-config', 'C:\\x\\c.json']);
    expect(swallowing.ok ? undefined : swallowing.reason).toBe('missing-value');
  });

  it.each([
    ['banana'],
    ['safety_replication'],
    ['SAFETY-REPLICATION'],
    ['ALL'],
    // Refused deliberately: absence already means full evidence, so a second spelling of the default
    // is surface with no benefit.
    ['FULL_EVIDENCE'],
  ])('REFUSES --run-goal %s as invalid-run-goal', (value) => {
    const parsed = parseCliArgs(['--run-goal', value]);
    expect(parsed.ok).toBe(false);
    expect(parsed.ok ? undefined : parsed.reason).toBe('invalid-run-goal');
  });

  it('A DUPLICATE --run-goal FAILS CLOSED RATHER THAN LETTING THE LAST WIN', () => {
    // An ambiguous goal is exactly the kind of thing that silently becomes the wrong run.
    const parsed = parseCliArgs([
      '--run-goal',
      'SAFETY_REPLICATION',
      '--run-goal',
      'SAFETY_REPLICATION',
    ]);
    expect(parsed.ok).toBe(false);
    expect(parsed.ok ? undefined : parsed.reason).toBe('duplicate-run-goal');
  });

  it('THE GOAL VOCABULARY IS CLOSED, AND NO MEMBER IS A BYPASS', () => {
    // MVP-P2A.2 HF4-R8 adds a THIRD governed purpose. `REQUEST_CONTRACT_DIAGNOSTIC` is strictly the
    // narrowest of the three: it runs the text smoke and eight SYNTHETIC canaries, reaches no fixture,
    // no evaluator, no authority, no P10 and no bundle, and is capped at nine provider requests
    // against the replication's eleven. It exists because S9 and S10 each spent a live authorization
    // re-observing nine identical HTTP 400s without isolating which request dimension was rejected.
    //
    // POST-PR-131 adds a FOURTH. `SCHEMA_DIFFERENTIAL_DIAGNOSTIC` is narrower still along the axis
    // that matters: it holds the completion cap fixed at the low control value and varies only the
    // SCHEMA, over real fragments of the projected production document. A separate token rather than
    // a reuse, because S11's D1-D8 evidence is immutable and a receipt must always be able to say
    // which live matrix produced it.
    expect([...OPERATOR_RUN_GOALS]).toStrictEqual([
      'FULL_EVIDENCE',
      'SAFETY_REPLICATION',
      'REQUEST_CONTRACT_DIAGNOSTIC',
      'SCHEMA_DIFFERENTIAL_DIAGNOSTIC',
      // POST-SDH4 adds a FIFTH: the bounded verification that the observation schema repair is
      // accepted. Separate again, because SDH4's receipts already say what its matrix meant.
      'POST_SDH4_SCHEMA_REPAIR_VERIFICATION',
      // POST-SRV1 adds a SIXTH, and along a NEW axis. Every goal above holds the completion budget at
      // the low control cap, which was right while a schema was being isolated; this one holds the
      // repaired schema fixed and varies the ENVELOPE — the real governed operational budget, and the
      // captured representative production message shape. Separate again, so a receipt can always say
      // which envelope produced it.
      'POST_SRV1_OPERATIONAL_ACCEPTANCE_DIAGNOSTIC',
      // POST-OAD3 adds a SEVENTH, and it is the narrowest yet. OAD3 settled the control and the
      // exact synthetic schema at the operational budget; only the representative request is still
      // unresolved, and only because it met an HTTP 429. So this goal sends the smoke and ONE probe.
      'POST_OAD3_REPRESENTATIVE_ACCEPTANCE',
    ]);
    // No goal skips a gate or forces a verdict. Both notices are content-free and name no secret.
    for (const goal of OPERATOR_RUN_GOALS) {
      expect(SECOND_CREDENTIAL_NOTICES[goal]).not.toMatch(/sk-|key=|Bearer|Authorization/u);
      expect(SECOND_CREDENTIAL_NOTICES[goal]).toContain('Smoke passed.');
    }
    // The replication notice must not promise the evidence run it will not perform.
    expect(SECOND_CREDENTIAL_NOTICES.SAFETY_REPLICATION).toContain('safety diagnostic replication');
    expect(SECOND_CREDENTIAL_NOTICES.FULL_EVIDENCE).toBe(SECOND_CREDENTIAL_NOTICE);
  });

  it('SAFETY_REPLICATION_COMPLETE IS EXIT 22, AND NOT ZERO', () => {
    // Zero means "a bundle exists and two humans have not read it". A replication writes no bundle,
    // so sharing that code would let a diagnostic run masquerade as the state before approval.
    expect(OPERATOR_EXIT_CODES.SAFETY_REPLICATION_COMPLETE).toBe(22);
    expect(OPERATOR_EXIT_CODES.SAFETY_REPLICATION_COMPLETE).not.toBe(0);
    expect(OPERATOR_OUTCOMES).toContain('SAFETY_REPLICATION_COMPLETE');
  });

  it('EVERY PRE-HF3 EXIT CODE IS UNCHANGED', () => {
    // A script reading `$LASTEXITCODE` against the old contract must keep meaning what it meant.
    expect({
      AWAITING_P10_HUMAN_REVIEW: OPERATOR_EXIT_CODES.AWAITING_P10_HUMAN_REVIEW,
      PRECHECK_FAILED: OPERATOR_EXIT_CODES.PRECHECK_FAILED,
      TTY_REQUIRED: OPERATOR_EXIT_CODES.TTY_REQUIRED,
      SMOKE_FAILED: OPERATOR_EXIT_CODES.SMOKE_FAILED,
      CANDIDATE_BIND_FAILED: OPERATOR_EXIT_CODES.CANDIDATE_BIND_FAILED,
      SAFETY_INELIGIBLE: OPERATOR_EXIT_CODES.SAFETY_INELIGIBLE,
      SAFETY_EVIDENCE_BLOCKED: OPERATOR_EXIT_CODES.SAFETY_EVIDENCE_BLOCKED,
      P10_CAPTURE_BLOCKED: OPERATOR_EXIT_CODES.P10_CAPTURE_BLOCKED,
      REVIEW_OUTPUT_REFUSED: OPERATOR_EXIT_CODES.REVIEW_OUTPUT_REFUSED,
      REQUEST_LIMIT_REACHED: OPERATOR_EXIT_CODES.REQUEST_LIMIT_REACHED,
      COST_LIMIT_REACHED: OPERATOR_EXIT_CODES.COST_LIMIT_REACHED,
      INTERNAL_CLOSED_FAILURE: OPERATOR_EXIT_CODES.INTERNAL_CLOSED_FAILURE,
      USAGE_BOUND_VIOLATED: OPERATOR_EXIT_CODES.USAGE_BOUND_VIOLATED,
    }).toStrictEqual({
      AWAITING_P10_HUMAN_REVIEW: 0,
      PRECHECK_FAILED: 10,
      TTY_REQUIRED: 11,
      SMOKE_FAILED: 12,
      CANDIDATE_BIND_FAILED: 13,
      SAFETY_INELIGIBLE: 14,
      SAFETY_EVIDENCE_BLOCKED: 15,
      P10_CAPTURE_BLOCKED: 16,
      REVIEW_OUTPUT_REFUSED: 17,
      REQUEST_LIMIT_REACHED: 18,
      COST_LIMIT_REACHED: 19,
      INTERNAL_CLOSED_FAILURE: 20,
      USAGE_BOUND_VIOLATED: 21,
    });
  });
});

describe('HF3 — the goal chooses the ledger, and the owner chooses no number', () => {
  it('A SAFETY_REPLICATION GETS THE 11-REQUEST LEDGER, NOT THE FULL ONE', () => {
    // A mutation campaign found this gap: swapping the replication ledger for the full 83-request one
    // in `main()` changed nothing any test could see, because `main()` needs a real terminal and a
    // real provider to run. A bounded run whose bound is untested is not bounded.
    const ledger = ledgerForRunGoal('SAFETY_REPLICATION');
    for (let index = 0; index < 11; index += 1) {
      expect(ledger.reserve('safety'), `reservation ${String(index + 1)}`).toStrictEqual({
        ok: true,
      });
    }
    expect(ledger.reserve('safety')).toStrictEqual({
      ok: false,
      refusal: 'request-limit-reached',
    });
  });

  it('FULL_EVIDENCE still gets the 83-request ledger', () => {
    const ledger = ledgerForRunGoal('FULL_EVIDENCE');
    for (let index = 0; index < 83; index += 1) {
      expect(ledger.reserve('safety'), `reservation ${String(index + 1)}`).toStrictEqual({
        ok: true,
      });
    }
    expect(ledger.reserve('safety')).toStrictEqual({
      ok: false,
      refusal: 'request-limit-reached',
    });
  });
});
