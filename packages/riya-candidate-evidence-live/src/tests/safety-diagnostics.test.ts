/**
 * MVP-P2A.2 HF2 — the content-free safety diagnostics helper, in isolation.
 *
 * The operator-level proof lives in `success-path.test.ts`, driven through the real evaluator. This
 * file pins the two properties that are easiest to lose in a refactor and hardest to notice
 * afterwards: that the ceiling printed is the REAL configured tolerance rather than a hard-coded
 * zero, and that only the six closed `EvaluationCaseResult` fields are ever emitted. `SuiteResult`
 * has no content-bearing field, so there is nowhere here for a reply, a user turn or governed
 * knowledge to hide; the proof that real candidate content stays out of a real run lives in
 * `success-path.test.ts`, where actual model replies exist.
 *
 * No Groq, no credential, no filesystem, no network.
 */
import {
  createEvaluationBinding,
  createSuiteThresholds,
  type EvaluationCaseResult,
  type SuiteResult,
} from '@qf-jarvis/model-evaluation';
import { describe, expect, it } from 'vitest';

import {
  CANDIDATE_CAPABILITY_PROFILE_REF,
  CANDIDATE_RELEASE,
  RIYA_CLIENT_PROMPT_DIGEST,
} from '../candidate-release.js';
import { emitSafetyIneligibilityDiagnostics } from '../internal/safety-diagnostics.js';
import { createSafeConsole } from '../safe-console.js';

/** Sentinels that must never appear. Deliberately unmistakable. */
const REPLY_SENTINEL = 'SENTINEL-CANDIDATE-REPLY-MUST-NOT-PRINT';
const USER_SENTINEL = 'SENTINEL-SYNTHETIC-USER-MUST-NOT-PRINT';
const KNOWLEDGE_SENTINEL = 'SENTINEL-KNOWLEDGE-MUST-NOT-PRINT';

/** The real candidate binding, built through the real constructor. Nothing here is a cast. */
const BINDING = createEvaluationBinding({
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
});

/** Reasons come from the CLOSED `EvaluationReason` vocabulary — there is no free-text field here. */
function caseOf(
  scenarioId: string,
  outcome: EvaluationCaseResult['outcome'],
  category: EvaluationCaseResult['category'],
  reason: EvaluationCaseResult['reason'],
): EvaluationCaseResult {
  return { scenarioId, scenarioVersion: 2, category, severity: 'HIGH', outcome, reason };
}

/** A minimal EVALUATED-shaped result. Only the fields the helper reads need to be real. */
function suiteWith(args: {
  readonly caseResults: readonly EvaluationCaseResult[];
  readonly failuresByCategory: Partial<SuiteResult['failuresByCategory']>;
  readonly thresholdBreaches: SuiteResult['thresholdBreaches'];
  readonly counts?: Partial<SuiteResult['countsByOutcome']>;
}): SuiteResult {
  return {
    binding: BINDING,
    caseResults: args.caseResults,
    countsByOutcome: {
      PASS: 0,
      FAIL: 0,
      INCONCLUSIVE: 0,
      NOT_APPLICABLE: 0,
      ...args.counts,
    },
    failuresByCategory: {
      PRIVACY_AND_DATA_CLASS: 0,
      AGENT_SCOPE_SEPARATION: 0,
      BUSINESS_AUTHORITY: 0,
      SECRET_AND_PII_LEAKAGE: 0,
      PROMPT_INJECTION_RESISTANCE: 0,
      TOOL_INTENT_SAFETY: 0,
      REFUSAL_AND_ESCALATION: 0,
      HUMAN_HANDOVER_RESPECT: 0,
      KNOWLEDGE_FRESHNESS: 0,
      CITATION_AND_GROUNDING: 0,
      STRUCTURED_OUTPUT: 0,
      RELIABILITY_AND_ERROR_HANDLING: 0,
      ...args.failuresByCategory,
    } as SuiteResult['failuresByCategory'],
    criticalFailures: 0,
    blockingInconclusive: 0,
    mandatoryCovered: true,
    missingMandatory: [],
    thresholdBreaches: args.thresholdBreaches,
    caseSetDigest: 'c'.repeat(64),
  };
}

function capture(
  suiteResult: SuiteResult,
  thresholds = createSuiteThresholds({
    thresholdsId: 'thresholds.riya.safety.v1',
    thresholdsVersion: 1,
  }),
): string[] {
  const lines: string[] = [];
  emitSafetyIneligibilityDiagnostics(
    createSafeConsole((line) => lines.push(line)),
    suiteResult,
    thresholds,
  );
  return lines;
}

describe('the diagnostics report exactly what the suite measured', () => {
  it('emits the aggregate, then every non-PASS case, then every breach', () => {
    const lines = capture(
      suiteWith({
        caseResults: [
          caseOf('riya.safety.ok', 'PASS', 'REFUSAL_AND_ESCALATION', 'contract-ok'),
          caseOf('riya.safety.malformed-structured', 'FAIL', 'STRUCTURED_OUTPUT', 'schema-invalid'),
        ],
        failuresByCategory: { STRUCTURED_OUTPUT: 1 },
        thresholdBreaches: ['STRUCTURED_OUTPUT'],
        counts: { PASS: 16, FAIL: 1 },
      }),
    );

    expect(lines).toHaveLength(3);
    expect(lines[0]).toBe(
      'phase=safety status=SUMMARY pass=16 fail=1 inconclusive=0 notApplicable=0 criticalFailures=0 blockingInconclusive=0',
    );
    expect(lines[1]).toBe(
      'phase=safety status=CASE caseId=riya.safety.malformed-structured version=2 category=STRUCTURED_OUTPUT severity=HIGH outcome=FAIL reason=schema-invalid',
    );
    expect(lines[2]).toBe(
      'phase=safety status=THRESHOLD_BREACH category=STRUCTURED_OUTPUT failures=1 maxAllowed=0',
    );
  });

  it('says nothing about a case that passed', () => {
    const lines = capture(
      suiteWith({
        caseResults: [caseOf('riya.safety.ok', 'PASS', 'REFUSAL_AND_ESCALATION', 'contract-ok')],
        failuresByCategory: {},
        thresholdBreaches: [],
        counts: { PASS: 17 },
      }),
    );
    expect(lines).toHaveLength(1);
    expect(lines.join('\n')).not.toContain('riya.safety.ok');
  });

  it('reports INCONCLUSIVE and NOT_APPLICABLE too, not only FAIL', () => {
    // An owner diagnosing a blocked threshold needs to see a case that could not be judged just as
    // much as one that was judged badly.
    const lines = capture(
      suiteWith({
        caseResults: [
          caseOf(
            'riya.safety.unclear',
            'INCONCLUSIVE',
            'CITATION_AND_GROUNDING',
            'citation-missing',
          ),
          caseOf('riya.safety.skipped', 'NOT_APPLICABLE', 'KNOWLEDGE_FRESHNESS', 'not-applicable'),
        ],
        failuresByCategory: {},
        thresholdBreaches: [],
        counts: { PASS: 15, INCONCLUSIVE: 1, NOT_APPLICABLE: 1 },
      }),
    );
    expect(lines.join('\n')).toContain('outcome=INCONCLUSIVE');
    expect(lines.join('\n')).toContain('outcome=NOT_APPLICABLE');
  });
});

describe('THE CEILING IS READ FROM THE REAL THRESHOLDS', () => {
  it('PRINTS A NON-ZERO maxAllowed WHEN THE CATEGORY HAS A TOLERANCE', () => {
    // The mutation guard. A hard-coded zero prints the right number today by coincidence — the CLI
    // configures no overrides — and would silently lie the first time a category is given a
    // tolerance. Only a non-zero tolerance can tell the two implementations apart.
    const thresholds = createSuiteThresholds({
      thresholdsId: 'thresholds.riya.safety.v1',
      thresholdsVersion: 1,
      maxFailuresByCategory: { STRUCTURED_OUTPUT: 3 },
    });
    const lines = capture(
      suiteWith({
        caseResults: [
          caseOf('riya.safety.malformed-structured', 'FAIL', 'STRUCTURED_OUTPUT', 'schema-invalid'),
        ],
        failuresByCategory: { STRUCTURED_OUTPUT: 4 },
        thresholdBreaches: ['STRUCTURED_OUTPUT'],
        counts: { PASS: 13, FAIL: 4 },
      }),
      thresholds,
    );
    expect(lines[lines.length - 1]).toBe(
      'phase=safety status=THRESHOLD_BREACH category=STRUCTURED_OUTPUT failures=4 maxAllowed=3',
    );
  });
});

describe('NOTHING CONTENT-BEARING CAN REACH THE CONSOLE', () => {
  it('carries no credential, URL or stack shape', () => {
    // Scoped honestly. `SuiteResult` has no content-bearing field, so there is nowhere in this
    // helper's input for a reply, a user turn or governed knowledge to hide — which is why the
    // sentinels below cannot appear rather than merely happening not to. The proof that real
    // candidate content stays out of a real run is the operator-level test in `success-path.test.ts`,
    // where actual model replies exist; this one guards the shapes an accidental refactor might
    // introduce here.
    const lines = capture(
      suiteWith({
        caseResults: [
          caseOf('riya.safety.malformed-structured', 'FAIL', 'STRUCTURED_OUTPUT', 'schema-invalid'),
        ],
        failuresByCategory: { STRUCTURED_OUTPUT: 1 },
        thresholdBreaches: ['STRUCTURED_OUTPUT'],
        counts: { PASS: 16, FAIL: 1 },
      }),
    );
    const output = lines.join('\n');
    for (const forbidden of [
      REPLY_SENTINEL,
      USER_SENTINEL,
      KNOWLEDGE_SENTINEL,
      'Authorization',
      'Bearer',
      'apiKey',
      'GROQ_API_KEY',
      'sk-',
      'https://',
      'at Object.',
    ]) {
      expect(output, `diagnostics must not contain ${forbidden}`).not.toContain(forbidden);
    }
  });

  it('emits ONLY the six closed fields per case, and nothing else', () => {
    // Whitelist rather than blacklist: a future field added to EvaluationCaseResult must be reviewed
    // before it can be printed, instead of arriving here by default.
    const lines = capture(
      suiteWith({
        caseResults: [
          caseOf('riya.safety.malformed-structured', 'FAIL', 'STRUCTURED_OUTPUT', 'schema-invalid'),
        ],
        failuresByCategory: { STRUCTURED_OUTPUT: 1 },
        thresholdBreaches: ['STRUCTURED_OUTPUT'],
        counts: { PASS: 16, FAIL: 1 },
      }),
    );
    const caseLine = lines.find((line) => line.includes('status=CASE'));
    expect(caseLine).toBeDefined();
    const keys = (caseLine ?? '').split(' ').map((pair) => pair.split('=')[0]);
    expect(keys).toStrictEqual([
      'phase',
      'status',
      'caseId',
      'version',
      'category',
      'severity',
      'outcome',
      'reason',
    ]);
  });
});
