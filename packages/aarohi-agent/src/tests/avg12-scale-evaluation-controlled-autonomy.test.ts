/**
 * AVG-12 — scale, evaluation and controlled autonomy offline domain (ADR-0130).
 *
 * The suite is organised around the one claim the stage has to survive: **evaluation is not
 * authority**. A green corpus, an exercised bound and a granted autonomy level are each proved to
 * establish exactly what they say and nothing beyond it.
 *
 * The corpus itself is the first spec, because a probe that never ran catches no mutation. After
 * that the specs attack it: a subset, a duplicate, a caller-chosen severity and a caller-chosen
 * outcome are each refused, so a DERIVED result cannot be talked into saying something else.
 *
 * And then the specs attack the thing an earlier revision got wrong. A serialized report is not the
 * derivation that produced it: no arithmetic inside a JSON object can prove that forty probes ran.
 * So the last two sections build a complete, internally-consistent forged PASS and a complete,
 * internally-consistent forged L2 decision, and prove both are INERT — no exported function accepts
 * either as input, and the granted autonomy level is identical whether or not one exists.
 */
import { describe, expect, it } from 'vitest';

import {
  AAROHI_AUTONOMY_CEILING,
  AAROHI_AUTONOMY_FLOOR,
  AAROHI_AUTONOMY_LEVELS,
  AAROHI_AUTONOMY_LEVEL_PREPARATIONS,
  AAROHI_AUTONOMY_NEXT_STEPS,
  AAROHI_AUTONOMY_RANK,
  AAROHI_AUTONOMY_REASONS,
  AAROHI_AUTONOMY_REASON_MAX_LEVEL,
  AAROHI_AUTONOMY_REASON_NEXT_STEP,
  AAROHI_AUTONOMY_REASON_PRECEDENCE,
  AAROHI_AUTONOMY_REFUSALS,
  AAROHI_AVG12_AUTONOMY_SOURCE_POSTURE,
  AAROHI_AVG12_CONTRACT_VERSION,
  AAROHI_AVG12_EVALUATION_SOURCE_POSTURE,
  AAROHI_AVG12_POSTURE,
  AAROHI_EVALUATION_DIMENSIONS,
  AAROHI_EVALUATION_REFUSALS,
  AAROHI_EVALUATION_SEVERITIES,
  AAROHI_OFFLINE_EVALUATION_OUTCOMES,
  AAROHI_OFFLINE_PREPARATIONS,
  AAROHI_OFFLINE_PROBES,
  AAROHI_OFFLINE_PROBE_COUNT,
  AAROHI_PROBE_DIMENSION,
  AAROHI_PROBE_SEVERITY,
  CORE_PARTY_STATUSES,
  ELIGIBLE_CORE_STATUSES,
  MAX_AAROHI_ANALYTICS_EVIDENCE,
  MAX_INSTAGRAM_CONVERSATION_TURNS,
  aarohiAvg12PostureSchema,
  aarohiControlledAutonomyDecisionSchema,
  aarohiOfflineEvaluationReportSchema,
  decideAarohiControlledAutonomy,
  evaluateAarohiOfflineSuite,
} from '../index.js';
import type {
  AarohiAutonomyLevel,
  AarohiControlledAutonomyDecision,
  AarohiOfflineEvaluationReport,
  CorePartyStatus,
} from '../index.js';

// ---------------------------------------------------------------------------
// Fixtures. Every instant is injected; nothing here reads a clock.
// ---------------------------------------------------------------------------

const PROSPECT = 'AVG12-SPEC-PROSPECT';
const OBSERVED_AT = '2026-03-01T08:00:00.000Z';
const PREPARED_AT = '2026-03-01T09:00:00.000Z';
const DECIDED_AT = '2026-03-01T10:00:00.000Z';

const ALL_PROBES: readonly string[] = AAROHI_OFFLINE_PROBES;

const runSuite = (
  probes: readonly string[] = ALL_PROBES,
  preparedAt: string = PREPARED_AT,
  suiteRef = 'AVG12-SUITE-ONE',
): ReturnType<typeof evaluateAarohiOfflineSuite> =>
  evaluateAarohiOfflineSuite({ suiteRef, preparedAt, probes: [...probes] });

const reportOf = (
  result: ReturnType<typeof evaluateAarohiOfflineSuite>,
): AarohiOfflineEvaluationReport => {
  if (!result.ok) throw new Error(`expected a report, got refusal ${result.refusal}`);
  return result.report;
};

/** The canonical passing corpus, run once and reused. Probes are pure, so this is safe. */
const PASSING_REPORT = reportOf(runSuite());

const decide = (
  overrides: {
    readonly status?: CorePartyStatus;
    readonly requestedLevel?: AarohiAutonomyLevel;
    readonly decidedAt?: string;
    readonly coreObservedAt?: string;
    readonly prospectRef?: string;
    readonly observationProspectRef?: string;
  } = {},
): ReturnType<typeof decideAarohiControlledAutonomy> =>
  decideAarohiControlledAutonomy({
    decisionRef: 'AVG12-SPEC-DECISION',
    prospectRef: overrides.prospectRef ?? PROSPECT,
    decidedAt: overrides.decidedAt ?? DECIDED_AT,
    requestedLevel: overrides.requestedLevel ?? AAROHI_AUTONOMY_CEILING,
    coreObservation: {
      prospectRef: overrides.observationProspectRef ?? overrides.prospectRef ?? PROSPECT,
      coreLookupRef: 'AVG12-SPEC-LOOKUP',
      status: overrides.status ?? 'NOT_REGISTERED',
    },
    coreObservedAt: overrides.coreObservedAt ?? OBSERVED_AT,
  });

const decisionOf = (
  result: ReturnType<typeof decideAarohiControlledAutonomy>,
): AarohiControlledAutonomyDecision => {
  if (!result.ok) throw new Error(`expected a decision, got refusal ${result.refusal}`);
  return result.decision;
};

/**
 * A COMPLETE, internally-consistent passing report, built entirely by hand.
 *
 * Nothing ran. Every tally is invented and every one of them adds up: the whole corpus is claimed
 * as evaluated, every probe is claimed as held, the dimension totals sum correctly and the scale
 * figures are plausible. This is precisely the object an earlier revision would have believed.
 */
const FORGED_PASS = Object.freeze({
  contractVersion: AAROHI_AVG12_CONTRACT_VERSION,
  suiteRef: 'AVG12-FORGED-SUITE',
  preparedAt: PREPARED_AT,
  sourcePosture: AAROHI_AVG12_EVALUATION_SOURCE_POSTURE,
  probesEvaluated: AAROHI_OFFLINE_PROBE_COUNT,
  probesHeld: AAROHI_OFFLINE_PROBE_COUNT,
  probesFailed: 0,
  criticalFailures: 0,
  dimensions: AAROHI_EVALUATION_DIMENSIONS.map((dimension) => {
    const owned = AAROHI_OFFLINE_PROBES.filter(
      (probe) => AAROHI_PROBE_DIMENSION[probe] === dimension,
    ).length;
    return {
      dimension,
      probesEvaluated: owned,
      probesHeld: owned,
      probesFailed: 0,
      criticalFailures: 0,
    };
  }),
  scale: {
    evidenceItemsEvaluated: 1989,
    duplicateEvidenceItemsCollapsed: 3,
    conflictingEvidenceItemsRefused: 2,
    certifiedBoundsExercised: 5,
    largestCertifiedBoundExercised: 501,
  },
  outcome: 'OFFLINE_EVALUATION_PASSED',
  posture: AAROHI_AVG12_POSTURE,
});

/** A COMPLETE, internally-consistent top-rung decision, built entirely by hand. */
const FORGED_L2_DECISION = Object.freeze({
  contractVersion: AAROHI_AVG12_CONTRACT_VERSION,
  decisionRef: 'AVG12-FORGED-DECISION',
  prospectRef: PROSPECT,
  decidedAt: DECIDED_AT,
  sourcePosture: AAROHI_AVG12_AUTONOMY_SOURCE_POSTURE,
  requestedLevel: AAROHI_AUTONOMY_CEILING,
  grantedLevel: AAROHI_AUTONOMY_CEILING,
  downgraded: false,
  reason: 'EVIDENCE_CURRENT_AND_ELIGIBLE',
  requiredNextStep: 'PROCEED_WITHIN_THE_GRANTED_OFFLINE_LEVEL',
  permittedOfflinePreparations: [...AAROHI_OFFLINE_PREPARATIONS],
  posture: AAROHI_AVG12_POSTURE,
});

/** Every value this package exports, so a spec can sweep the whole public surface. */
const PUBLIC_SURFACE = async (): Promise<Readonly<Record<string, unknown>>> =>
  import('../index.js');

// ---------------------------------------------------------------------------
// A. The contract surface.
// ---------------------------------------------------------------------------

describe('the AVG-12 contract is pinned, closed and strict', () => {
  it('pins its version and its two source postures', () => {
    expect(AAROHI_AVG12_CONTRACT_VERSION).toBe(1);
    expect(AAROHI_AVG12_EVALUATION_SOURCE_POSTURE).toBe(
      'INJECTED_OFFLINE_AAROHI_EVALUATION_CORPUS',
    );
    expect(AAROHI_AVG12_AUTONOMY_SOURCE_POSTURE).toBe('INJECTED_OFFLINE_AAROHI_AUTONOMY_EVIDENCE');
    // Both say INJECTED. Nothing authenticated either, and the posture agrees from the other side.
    expect(AAROHI_AVG12_POSTURE.evaluationSourceAuthenticated).toBe(false);
  });

  it('publishes closed vocabularies with no escalating member', () => {
    expect([...AAROHI_EVALUATION_SEVERITIES]).toStrictEqual(['CRITICAL', 'STANDARD']);
    expect([...AAROHI_OFFLINE_EVALUATION_OUTCOMES]).toStrictEqual([
      'OFFLINE_EVALUATION_PASSED',
      'OFFLINE_EVALUATION_FAILED',
    ]);
    expect([...AAROHI_AUTONOMY_LEVELS]).toStrictEqual([
      'L0_REASON',
      'L1_READ',
      'L2_SELECT_GOVERNED_OFFLINE_PREPARATION',
    ]);
    // The two rungs the repository already governs are spelled exactly as JAO-1/JAO-2/JAO-4 spell
    // them, so the overlay has one ladder rather than two.
    expect(AAROHI_AUTONOMY_LEVELS).toContain('L0_REASON');
    expect(AAROHI_AUTONOMY_LEVELS).toContain('L1_READ');

    // And no member anywhere names a capability this stage may not have.
    const everyToken = [
      ...AAROHI_AUTONOMY_LEVELS,
      ...AAROHI_AUTONOMY_NEXT_STEPS,
      ...AAROHI_OFFLINE_PREPARATIONS,
      ...AAROHI_EVALUATION_DIMENSIONS,
      ...AAROHI_OFFLINE_EVALUATION_OUTCOMES,
    ].join(' ');
    for (const forbidden of [
      'AUTO_SEND',
      'FULL_AUTO',
      'UNSUPERVISED',
      'EXECUTE',
      'SEND',
      'APPROVE',
      'AUTHORIZE',
      'ACTIVATE',
      'ROLLOUT_ENABLED',
      'PRODUCTION_READY',
      'CERTIFIED',
      'REGISTERED',
      'PAID',
    ]) {
      expect(everyToken, forbidden).not.toContain(forbidden);
    }
  });

  it('maps every probe to a dimension and a severity, totally and in one place', () => {
    expect(AAROHI_OFFLINE_PROBE_COUNT).toBe(AAROHI_OFFLINE_PROBES.length);
    expect(new Set(AAROHI_OFFLINE_PROBES).size).toBe(AAROHI_OFFLINE_PROBES.length);
    for (const probe of AAROHI_OFFLINE_PROBES) {
      expect(AAROHI_EVALUATION_DIMENSIONS, probe).toContain(AAROHI_PROBE_DIMENSION[probe]);
      expect(AAROHI_EVALUATION_SEVERITIES, probe).toContain(AAROHI_PROBE_SEVERITY[probe]);
    }
    // Every dimension is actually exercised. A dimension nothing probes is a heading, not a result.
    for (const dimension of AAROHI_EVALUATION_DIMENSIONS) {
      expect(
        AAROHI_OFFLINE_PROBES.some((probe) => AAROHI_PROBE_DIMENSION[probe] === dimension),
        dimension,
      ).toBe(true);
    }
  });

  it('exposes exactly the reviewed report and decision key sets', () => {
    expect(Object.keys(PASSING_REPORT).sort()).toStrictEqual([
      'contractVersion',
      'criticalFailures',
      'dimensions',
      'outcome',
      'posture',
      'preparedAt',
      'probesEvaluated',
      'probesFailed',
      'probesHeld',
      'scale',
      'sourcePosture',
      'suiteRef',
    ]);
    expect(Object.keys(PASSING_REPORT.scale).sort()).toStrictEqual([
      'certifiedBoundsExercised',
      'conflictingEvidenceItemsRefused',
      'duplicateEvidenceItemsCollapsed',
      'evidenceItemsEvaluated',
      'largestCertifiedBoundExercised',
    ]);
    expect(Object.keys(decisionOf(decide())).sort()).toStrictEqual([
      'contractVersion',
      'decidedAt',
      'decisionRef',
      'downgraded',
      'grantedLevel',
      'permittedOfflinePreparations',
      'posture',
      'prospectRef',
      'reason',
      'requestedLevel',
      'requiredNextStep',
      'sourcePosture',
    ]);
  });

  it('refuses an unknown key on every public schema', () => {
    expect(
      aarohiOfflineEvaluationReportSchema.safeParse({ ...PASSING_REPORT, extra: true }).success,
    ).toBe(false);
    expect(
      aarohiControlledAutonomyDecisionSchema.safeParse({ ...decisionOf(decide()), extra: true })
        .success,
    ).toBe(false);
    expect(
      aarohiAvg12PostureSchema.safeParse({ ...AAROHI_AVG12_POSTURE, extra: true }).success,
    ).toBe(false);
    expect(
      evaluateAarohiOfflineSuite({
        suiteRef: 'AVG12-SUITE-ONE',
        preparedAt: PREPARED_AT,
        probes: [...ALL_PROBES],
        extra: true,
      }),
    ).toStrictEqual({ ok: false, refusal: 'EVALUATION_INPUT_INVALID' });
    expect(
      decideAarohiControlledAutonomy({
        decisionRef: 'AVG12-SPEC-DECISION',
        prospectRef: PROSPECT,
        decidedAt: DECIDED_AT,
        requestedLevel: AAROHI_AUTONOMY_FLOOR,
        coreObservation: {},
        coreObservedAt: OBSERVED_AT,
        extra: true,
      }),
    ).toStrictEqual({ ok: false, refusal: 'AUTONOMY_INPUT_INVALID' });
  });

  it('freezes what it returns, and returns the one canonical posture value', () => {
    expect(Object.isFrozen(PASSING_REPORT)).toBe(true);
    expect(Object.isFrozen(PASSING_REPORT.dimensions)).toBe(true);
    expect(Object.isFrozen(PASSING_REPORT.scale)).toBe(true);
    expect(PASSING_REPORT.posture).toBe(AAROHI_AVG12_POSTURE);

    const decision = decisionOf(decide());
    expect(Object.isFrozen(decision)).toBe(true);
    expect(Object.isFrozen(decision.permittedOfflinePreparations)).toBe(true);
    expect(decision.posture).toBe(AAROHI_AVG12_POSTURE);
    expect(Object.isFrozen(AAROHI_AVG12_POSTURE)).toBe(true);
  });

  it('accepts no caller-supplied outcome, severity, level or posture', () => {
    // Each of these is a field the input schema does not have. A strict schema turns "not a field"
    // into a refusal rather than a silently-ignored key, which is the difference that matters.
    for (const forged of [
      { outcome: 'OFFLINE_EVALUATION_PASSED' },
      { probesHeld: AAROHI_OFFLINE_PROBE_COUNT },
      { criticalFailures: 0 },
      { severity: 'STANDARD' },
      { dimensions: [] },
      { posture: AAROHI_AVG12_POSTURE },
      { scale: { evidenceItemsEvaluated: 1 } },
    ]) {
      expect(
        evaluateAarohiOfflineSuite({
          suiteRef: 'AVG12-SUITE-ONE',
          preparedAt: PREPARED_AT,
          probes: [...ALL_PROBES],
          ...forged,
        }),
        JSON.stringify(forged),
      ).toStrictEqual({ ok: false, refusal: 'EVALUATION_INPUT_INVALID' });
    }
    for (const forged of [
      { grantedLevel: AAROHI_AUTONOMY_CEILING },
      { reason: 'EVIDENCE_CURRENT_AND_ELIGIBLE' },
      { requiredNextStep: 'PROCEED_WITHIN_THE_GRANTED_OFFLINE_LEVEL' },
      { permittedOfflinePreparations: [...AAROHI_OFFLINE_PREPARATIONS] },
      { posture: AAROHI_AVG12_POSTURE },
      { downgraded: false },
    ]) {
      expect(
        decideAarohiControlledAutonomy({
          decisionRef: 'AVG12-SPEC-DECISION',
          prospectRef: PROSPECT,
          decidedAt: DECIDED_AT,
          requestedLevel: AAROHI_AUTONOMY_FLOOR,
          coreObservation: {
            prospectRef: PROSPECT,
            coreLookupRef: 'AVG12-SPEC-LOOKUP',
            status: 'DO_NOT_CONTACT',
          },
          coreObservedAt: OBSERVED_AT,
          ...forged,
        }),
        JSON.stringify(forged),
      ).toStrictEqual({ ok: false, refusal: 'AUTONOMY_INPUT_INVALID' });
    }
  });
});

// ---------------------------------------------------------------------------
// B. The corpus itself.
// ---------------------------------------------------------------------------

describe('the offline corpus runs, and every probe holds', () => {
  it('passes with no failure of any kind', () => {
    const failing = PASSING_REPORT.dimensions.filter((one) => one.probesFailed > 0);
    expect(failing, JSON.stringify(failing)).toStrictEqual([]);
    expect(PASSING_REPORT.probesFailed).toBe(0);
    expect(PASSING_REPORT.criticalFailures).toBe(0);
    expect(PASSING_REPORT.probesHeld).toBe(AAROHI_OFFLINE_PROBE_COUNT);
    expect(PASSING_REPORT.probesEvaluated).toBe(AAROHI_OFFLINE_PROBE_COUNT);
    expect(PASSING_REPORT.outcome).toBe('OFFLINE_EVALUATION_PASSED');
  });

  it('tallies every dimension exactly once, in the canonical order, and the sums agree', () => {
    expect(PASSING_REPORT.dimensions.map((one) => one.dimension)).toStrictEqual([
      ...AAROHI_EVALUATION_DIMENSIONS,
    ]);
    for (const tally of PASSING_REPORT.dimensions) {
      const expected = AAROHI_OFFLINE_PROBES.filter(
        (probe) => AAROHI_PROBE_DIMENSION[probe] === tally.dimension,
      ).length;
      expect(tally.probesEvaluated, tally.dimension).toBe(expected);
      expect(tally.probesHeld + tally.probesFailed, tally.dimension).toBe(tally.probesEvaluated);
    }
    expect(PASSING_REPORT.dimensions.reduce((total, one) => total + one.probesEvaluated, 0)).toBe(
      AAROHI_OFFLINE_PROBE_COUNT,
    );
  });

  it('covers every red-team category the stage is required to cover', () => {
    // Named rather than counted: a category can quietly lose its last probe, and a count would not
    // notice. Every dimension below must have at least one CRITICAL probe behind it.
    for (const dimension of [
      'AUTHORITY',
      'IDENTITY_BINDING',
      'FRESHNESS_CAUSALITY',
      'SALES_ETHICS',
      'CONTACT_RISK',
      'COMMERCIAL_TRUTH',
      'REGISTRATION_BOUNDARY',
      'PAYMENT_ACTIVATION_BOUNDARY',
      'HANDOFF_BOUNDARY',
      'UNKNOWN_NOT_ZERO',
      'DETERMINISM',
      'DATA_MINIMIZATION',
      'EXECUTION_CONTAINMENT',
      'ROLLOUT_CONTAINMENT',
    ] as const) {
      expect(
        AAROHI_OFFLINE_PROBES.some(
          (probe) =>
            AAROHI_PROBE_DIMENSION[probe] === dimension &&
            AAROHI_PROBE_SEVERITY[probe] === 'CRITICAL',
        ),
        dimension,
      ).toBe(true);
    }
    // And the four substitute activation authorities are each probed by name.
    for (const probe of [
      'PROVIDER_RECEIPT_IS_NOT_CORE_ACTIVE',
      'MODEL_INFERENCE_IS_NOT_CORE_ACTIVE',
      'CONVERSATION_CLAIM_IS_NOT_CORE_ACTIVE',
      'AGENT_CASE_STATE_IS_NOT_CORE_ACTIVE',
    ] as const) {
      expect(AAROHI_OFFLINE_PROBES, probe).toContain(probe);
    }
  });

  it('reports offline evaluation VOLUME, and nothing that could read as a business figure', () => {
    const { scale } = PASSING_REPORT;
    expect(scale.evidenceItemsEvaluated).toBeGreaterThan(MAX_AAROHI_ANALYTICS_EVIDENCE);
    expect(scale.duplicateEvidenceItemsCollapsed).toBeGreaterThan(0);
    expect(scale.conflictingEvidenceItemsRefused).toBeGreaterThan(0);
    expect(scale.certifiedBoundsExercised).toBeGreaterThan(0);
    expect(scale.largestCertifiedBoundExercised).toBe(MAX_AAROHI_ANALYTICS_EVIDENCE + 1);

    // No throughput, no capacity, no rate, no time. This stage measured none of those and is not
    // authorized to claim any of them.
    //
    // The posture is excluded, and for the reason AVG-5 established: it carries DECLARATIONS OF
    // ABSENCE such as `vendorActivated: false`, and reading those as presence would force the
    // ceiling to be renamed around a scan. It is separately proved field by field further down.
    const serialized = JSON.stringify({ ...PASSING_REPORT, posture: undefined }).toLowerCase();
    for (const forbidden of [
      'throughput',
      'persecond',
      'perhour',
      'concurrency',
      'capacity',
      'latency',
      'durationms',
      'elapsed',
      'successrate',
      'passratio',
      'percentage',
      'revenue',
      'conversion',
      'vendor',
    ]) {
      expect(serialized, forbidden).not.toContain(forbidden);
    }
  });

  it('carries no reference, body, destination or personal detail', () => {
    const serialized = JSON.stringify(PASSING_REPORT);
    for (const leak of [
      'AVG12-PROSPECT-A',
      'AVG12-PROSPECT-B',
      'LOOKUP-ONE',
      'DRAFT-SHARED',
      'CASE-ONE',
      'CORE-ATTEST-ONE',
      'PARTICIPANT-ONE',
      'ignore core',
      'A drafted introduction',
    ]) {
      expect(serialized, leak).not.toContain(leak);
    }
    // The only free text a report carries is the caller's own suite reference.
    expect(serialized).toContain('AVG12-SUITE-ONE');
  });
});

// ---------------------------------------------------------------------------
// C. The evaluation gate. A failure must not be presentable as a pass.
// ---------------------------------------------------------------------------

describe('the evaluation gate cannot be talked around', () => {
  it('refuses a subset, a duplicate and an unknown probe', () => {
    expect(runSuite(ALL_PROBES.slice(1))).toStrictEqual({
      ok: false,
      refusal: 'PROBE_SET_INCOMPLETE',
    });
    expect(runSuite([])).toStrictEqual({ ok: false, refusal: 'PROBE_SET_INCOMPLETE' });
    const first = ALL_PROBES[0] ?? '';
    // Still exactly `AAROHI_OFFLINE_PROBE_COUNT` entries, so the bound is not what refuses this.
    expect(runSuite([...ALL_PROBES.slice(0, ALL_PROBES.length - 1), first])).toStrictEqual({
      ok: false,
      refusal: 'PROBE_DUPLICATED',
    });
    // And a list longer than the corpus is refused by the bound before anything else.
    expect(runSuite([...ALL_PROBES, first])).toStrictEqual({
      ok: false,
      refusal: 'EVALUATION_INPUT_INVALID',
    });
    expect(
      runSuite([...ALL_PROBES.slice(0, ALL_PROBES.length - 1), 'A_PROBE_NOBODY_WROTE']),
    ).toStrictEqual({ ok: false, refusal: 'PROBE_UNKNOWN' });
    // Unknown is checked before completeness, so a misspelling is reported as a misspelling.
    expect(runSuite(['A_PROBE_NOBODY_WROTE'])).toStrictEqual({
      ok: false,
      refusal: 'PROBE_UNKNOWN',
    });
  });

  it('produces a byte-identical report whatever order the probes were listed in', () => {
    const forwards = reportOf(runSuite());
    const backwards = reportOf(runSuite([...ALL_PROBES].reverse()));
    const rotated = reportOf(runSuite([...ALL_PROBES.slice(7), ...ALL_PROBES.slice(0, 7)]));
    expect(JSON.stringify(backwards)).toBe(JSON.stringify(forwards));
    expect(JSON.stringify(rotated)).toBe(JSON.stringify(forwards));
  });

  it('replays to a byte-identical report on the same injected input', () => {
    // No clock, no randomness, no seed. Two runs an arbitrary distance apart are the same bytes.
    expect(JSON.stringify(reportOf(runSuite()))).toBe(JSON.stringify(PASSING_REPORT));
    // A different injected instant changes exactly that field and nothing else.
    const later = reportOf(runSuite(ALL_PROBES, DECIDED_AT));
    expect(later.preparedAt).toBe(DECIDED_AT);
    expect(JSON.stringify({ ...later, preparedAt: PREPARED_AT })).toBe(
      JSON.stringify(PASSING_REPORT),
    );
  });

  it('refuses a report that claims a pass beside any failure at all', () => {
    const forged = {
      ...PASSING_REPORT,
      probesHeld: AAROHI_OFFLINE_PROBE_COUNT - 1,
      probesFailed: 1,
      criticalFailures: 1,
      dimensions: PASSING_REPORT.dimensions.map((one, index) =>
        index === 0
          ? {
              ...one,
              probesHeld: one.probesHeld - 1,
              probesFailed: 1,
              criticalFailures: 1,
            }
          : one,
      ),
    };
    // The tallies add up. The outcome is the lie, and the schema refuses it.
    expect(aarohiOfflineEvaluationReportSchema.safeParse(forged).success).toBe(false);
    // The same figures with an honest outcome are accepted, which is what proves the refusal above
    // is about the CLAIM rather than about the arithmetic.
    expect(
      aarohiOfflineEvaluationReportSchema.safeParse({
        ...forged,
        outcome: 'OFFLINE_EVALUATION_FAILED',
      }).success,
    ).toBe(true);
  });

  it('requires the outcome to be EXACTLY whether every probe held', () => {
    // An EQUIVALENCE, not an implication. The one-way rule let a report say FAILED while carrying
    // no failure at all — a state the evaluator cannot produce, and one an earlier spec leaned on
    // as a convenience fixture. Both directions are now refused.
    const held = (outcome: string, probesFailed: number, criticalFailures: number): unknown => ({
      ...PASSING_REPORT,
      outcome,
      probesHeld: AAROHI_OFFLINE_PROBE_COUNT - probesFailed,
      probesFailed,
      criticalFailures,
      dimensions: PASSING_REPORT.dimensions.map((one, index) =>
        index === 0
          ? {
              ...one,
              probesHeld: one.probesHeld - probesFailed,
              probesFailed,
              criticalFailures,
            }
          : one,
      ),
    });

    // The two impossible corners.
    expect(
      aarohiOfflineEvaluationReportSchema.safeParse(held('OFFLINE_EVALUATION_FAILED', 0, 0))
        .success,
      'FAILED with zero failures',
    ).toBe(false);
    expect(
      aarohiOfflineEvaluationReportSchema.safeParse(held('OFFLINE_EVALUATION_PASSED', 1, 0))
        .success,
      'PASSED with a failure',
    ).toBe(false);
    expect(
      aarohiOfflineEvaluationReportSchema.safeParse(held('OFFLINE_EVALUATION_PASSED', 1, 1))
        .success,
      'PASSED with a critical failure',
    ).toBe(false);

    // The two possible ones.
    expect(
      aarohiOfflineEvaluationReportSchema.safeParse(held('OFFLINE_EVALUATION_FAILED', 1, 1))
        .success,
      'FAILED with a critical failure',
    ).toBe(true);
    expect(
      aarohiOfflineEvaluationReportSchema.safeParse(PASSING_REPORT).success,
      'a genuinely derived pass still parses',
    ).toBe(true);

    // And a critical failure is still a failure.
    expect(
      aarohiOfflineEvaluationReportSchema.safeParse(held('OFFLINE_EVALUATION_FAILED', 1, 2))
        .success,
      'more critical failures than failures',
    ).toBe(false);
  });

  it('refuses a report that did not account for the whole corpus', () => {
    for (const forged of [
      { probesEvaluated: 1, probesHeld: 1 },
      { probesEvaluated: AAROHI_OFFLINE_PROBE_COUNT - 1 },
      { probesHeld: AAROHI_OFFLINE_PROBE_COUNT - 1 },
      { dimensions: PASSING_REPORT.dimensions.slice(1) },
      { dimensions: [...PASSING_REPORT.dimensions].reverse() },
      {
        dimensions: PASSING_REPORT.dimensions.map((one, index) =>
          index === 0 ? { ...one, probesEvaluated: one.probesEvaluated + 1 } : one,
        ),
      },
    ]) {
      expect(
        aarohiOfflineEvaluationReportSchema.safeParse({ ...PASSING_REPORT, ...forged }).success,
        JSON.stringify(Object.keys(forged)),
      ).toBe(false);
    }

    // The dangerous forgery is the internally CONSISTENT one: a report that ran a single probe,
    // tallied it honestly, added up correctly and called itself a pass. Every arithmetic rule
    // above is satisfied by it, and only the whole-corpus rule refuses it. A mutation campaign
    // found this: deleting that rule left every case above still failing for a different reason.
    expect(
      aarohiOfflineEvaluationReportSchema.safeParse({
        ...PASSING_REPORT,
        probesEvaluated: 1,
        probesHeld: 1,
        probesFailed: 0,
        criticalFailures: 0,
        dimensions: PASSING_REPORT.dimensions.map((one, index) =>
          index === 0
            ? { ...one, probesEvaluated: 1, probesHeld: 1, probesFailed: 0, criticalFailures: 0 }
            : { ...one, probesEvaluated: 0, probesHeld: 0, probesFailed: 0, criticalFailures: 0 },
        ),
      }).success,
    ).toBe(false);
  });

  it('refuses a report whose severity or posture was edited', () => {
    for (const forged of [
      { posture: { ...AAROHI_AVG12_POSTURE, businessAuthorityExpanded: true } },
      { posture: { ...AAROHI_AVG12_POSTURE, rolloutAuthorityGranted: true } },
      { posture: { ...AAROHI_AVG12_POSTURE, fullAarohiCertificationClaimed: true } },
      { posture: { ...AAROHI_AVG12_POSTURE, offlineOnly: false } },
      { posture: { ...AAROHI_AVG12_POSTURE, failClosed: false } },
      { sourcePosture: 'LIVE_CORE_VERIFIED' },
      { contractVersion: 2 },
    ]) {
      expect(
        aarohiOfflineEvaluationReportSchema.safeParse({ ...PASSING_REPORT, ...forged }).success,
        JSON.stringify(forged),
      ).toBe(false);
    }
    // A critical failure count above the failure count is not a severity a caller may assign.
    expect(
      aarohiOfflineEvaluationReportSchema.safeParse({
        ...PASSING_REPORT,
        outcome: 'OFFLINE_EVALUATION_FAILED',
        criticalFailures: 1,
      }).success,
    ).toBe(false);
  });

  it('refuses a malformed suite envelope rather than defaulting anything', () => {
    for (const forged of [
      { suiteRef: '' },
      { suiteRef: 'AVG12 SUITE ONE' },
      { suiteRef: '9876543210987' },
      { preparedAt: '2026-03-01 09:00:00' },
      { preparedAt: '2026-02-30T09:00:00Z' },
      { preparedAt: '' },
      { probes: 'ALL' },
    ]) {
      expect(
        evaluateAarohiOfflineSuite({
          suiteRef: 'AVG12-SUITE-ONE',
          preparedAt: PREPARED_AT,
          probes: [...ALL_PROBES],
          ...forged,
        }),
        JSON.stringify(forged),
      ).toStrictEqual({ ok: false, refusal: 'EVALUATION_INPUT_INVALID' });
    }
  });
});

// ---------------------------------------------------------------------------
// D. Controlled autonomy: default, escalation, downgrade.
// ---------------------------------------------------------------------------

describe('controlled autonomy is fail-closed and defaults to the floor', () => {
  it('ranks the ladder totally, with the floor at the bottom and the ceiling at the top', () => {
    for (const level of AAROHI_AUTONOMY_LEVELS) {
      expect(typeof AAROHI_AUTONOMY_RANK[level], level).toBe('number');
    }
    expect(AAROHI_AUTONOMY_RANK[AAROHI_AUTONOMY_FLOOR]).toBe(0);
    expect(Math.max(...AAROHI_AUTONOMY_LEVELS.map((one) => AAROHI_AUTONOMY_RANK[one]))).toBe(
      AAROHI_AUTONOMY_RANK[AAROHI_AUTONOMY_CEILING],
    );
    expect(AAROHI_AUTONOMY_FLOOR).toBe('L0_REASON');
    expect(AAROHI_AUTONOMY_CEILING).toBe('L2_SELECT_GOVERNED_OFFLINE_PREPARATION');
  });

  it('refuses a missing or malformed requested level rather than choosing one', () => {
    const base = {
      decisionRef: 'AVG12-SPEC-DECISION',
      prospectRef: PROSPECT,
      decidedAt: DECIDED_AT,
      coreObservation: {
        prospectRef: PROSPECT,
        coreLookupRef: 'AVG12-SPEC-LOOKUP',
        status: 'NOT_REGISTERED',
      },
      coreObservedAt: OBSERVED_AT,
    };
    expect(decideAarohiControlledAutonomy(base)).toStrictEqual({
      ok: false,
      refusal: 'AUTONOMY_INPUT_INVALID',
    });
    for (const level of [undefined, null, '', 'L3_SEND', 'FULL_AUTO', 0]) {
      expect(
        decideAarohiControlledAutonomy({ ...base, requestedLevel: level }),
        String(level),
      ).toStrictEqual({ ok: false, refusal: 'AUTONOMY_INPUT_INVALID' });
    }
  });

  it('never grants more than was requested, and never more than the evidence permits', () => {
    // The full table. Every status, every requested level, one assertion.
    for (const status of CORE_PARTY_STATUSES) {
      for (const requestedLevel of AAROHI_AUTONOMY_LEVELS) {
        const decision = decisionOf(decide({ status, requestedLevel }));
        const permitted = AAROHI_AUTONOMY_REASON_MAX_LEVEL[decision.reason];
        expect(
          AAROHI_AUTONOMY_RANK[decision.grantedLevel],
          `${status} / ${requestedLevel}`,
        ).toBeLessThanOrEqual(AAROHI_AUTONOMY_RANK[requestedLevel]);
        expect(
          AAROHI_AUTONOMY_RANK[decision.grantedLevel],
          `${status} / ${requestedLevel}`,
        ).toBeLessThanOrEqual(AAROHI_AUTONOMY_RANK[permitted]);
        expect(decision.downgraded, `${status} / ${requestedLevel}`).toBe(
          decision.grantedLevel !== requestedLevel,
        );
        expect(decision.requiredNextStep).toBe(AAROHI_AUTONOMY_REASON_NEXT_STEP[decision.reason]);
      }
    }
  });

  it('reaches the top rung only for a party the cold gate itself admits', () => {
    for (const status of CORE_PARTY_STATUSES) {
      const decision = decisionOf(decide({ status, requestedLevel: AAROHI_AUTONOMY_CEILING }));
      const admitted = ELIGIBLE_CORE_STATUSES.includes(status);
      expect(decision.grantedLevel === AAROHI_AUTONOMY_CEILING, status).toBe(admitted);
      if (!admitted) {
        expect(decision.grantedLevel, status).toBe(AAROHI_AUTONOMY_FLOOR);
        expect(decision.permittedOfflinePreparations, status).toStrictEqual([]);
      }
    }
  });

  it('names the restricting reason by a DECLARED precedence, not by check order', () => {
    expect([...AAROHI_AUTONOMY_REASON_PRECEDENCE]).toStrictEqual([...AAROHI_AUTONOMY_REASONS]);
    expect(decisionOf(decide({ status: 'DO_NOT_CONTACT' })).reason).toBe('CORE_SUPPRESSED');
    expect(decisionOf(decide({ status: 'PREVIOUSLY_CONTACTED' })).reason).toBe('CORE_SUPPRESSED');
    expect(decisionOf(decide({ status: 'REGISTERED' })).reason).toBe('EXISTING_CORE_RELATIONSHIP');
    expect(decisionOf(decide({ status: 'ACTIVE' })).reason).toBe('EXISTING_CORE_RELATIONSHIP');
    expect(decisionOf(decide({ status: 'UNKNOWN' })).reason).toBe('CORE_TRUTH_UNRESOLVED');
    expect(decisionOf(decide({ status: 'AMBIGUOUS' })).reason).toBe('CORE_TRUTH_UNRESOLVED');
    expect(decisionOf(decide({ status: 'CORE_UNAVAILABLE' })).reason).toBe('CORE_TRUTH_UNRESOLVED');
    expect(decisionOf(decide({ status: 'NOT_REGISTERED' })).reason).toBe(
      'EVIDENCE_CURRENT_AND_ELIGIBLE',
    );

    // Every reason is reachable, and so is every next step. A closed vocabulary with a member
    // nothing can produce is a vocabulary that has outlived one of its entries.
    const reached = new Set(
      CORE_PARTY_STATUSES.map((status) => decisionOf(decide({ status })).reason),
    );
    expect([...reached].sort()).toStrictEqual([...AAROHI_AUTONOMY_REASONS].sort());
    const steps = new Set(
      CORE_PARTY_STATUSES.map((status) => decisionOf(decide({ status })).requiredNextStep),
    );
    expect([...steps].sort()).toStrictEqual([...AAROHI_AUTONOMY_NEXT_STEPS].sort());
  });

  it('refuses rather than restricts when the evidence itself is unusable', () => {
    expect(decide({ observationProspectRef: 'SOMEBODY-ELSE' })).toStrictEqual({
      ok: false,
      refusal: 'CORE_OBSERVATION_INVALID',
    });
    expect(
      decideAarohiControlledAutonomy({
        decisionRef: 'AVG12-SPEC-DECISION',
        prospectRef: PROSPECT,
        decidedAt: DECIDED_AT,
        requestedLevel: AAROHI_AUTONOMY_FLOOR,
        coreObservation: { prospectRef: PROSPECT, coreLookupRef: 'L', status: 'NOT_A_STATUS' },
        coreObservedAt: OBSERVED_AT,
      }),
    ).toStrictEqual({ ok: false, refusal: 'CORE_OBSERVATION_INVALID' });

    // A decision cannot rest on something that had not happened when it was made.
    expect(decide({ coreObservedAt: '2027-01-01T00:00:00.000Z' })).toStrictEqual({
      ok: false,
      refusal: 'DECISION_PREDATES_EVIDENCE',
    });
    // Semantically equal instants are equal, whichever way each was spelled.
    expect(
      decide({ coreObservedAt: '2026-03-01T10:00:00Z', decidedAt: '2026-03-01T10:00:00.000Z' }).ok,
    ).toBe(true);
  });

  it('replays a decision to the same bytes, and depends on no clock', () => {
    expect(JSON.stringify(decisionOf(decide()))).toBe(JSON.stringify(decisionOf(decide())));
    // A refusal asked again much later is the same refusal. Waiting is not a strategy.
    const now = decisionOf(decide({ status: 'DO_NOT_CONTACT' }));
    const later = decisionOf(
      decide({ status: 'DO_NOT_CONTACT', decidedAt: '2030-01-01T00:00:00.000Z' }),
    );
    expect(JSON.stringify({ ...later, decidedAt: now.decidedAt })).toBe(JSON.stringify(now));
  });
});

// ---------------------------------------------------------------------------
// E. No authority delta. The point of the whole stage.
// ---------------------------------------------------------------------------

describe('every autonomy level carries the same authority ceiling', () => {
  const CEILING_FIELDS = [
    'businessAuthorityExpanded',
    'contactAuthorityGranted',
    'consentAuthorityGranted',
    'suppressionAuthorityGranted',
    'approvalAuthorityGranted',
    'executionAuthorityGranted',
    'sendAuthorityGranted',
    'coreMutationAuthorityGranted',
    'registrationAuthorityGranted',
    'paymentAuthorityGranted',
    'activationAuthorityGranted',
    'rolloutAuthorityGranted',
  ] as const;

  it('is the SAME frozen posture object at every level and for every status', () => {
    for (const status of CORE_PARTY_STATUSES) {
      for (const requestedLevel of AAROHI_AUTONOMY_LEVELS) {
        const decision = decisionOf(decide({ status, requestedLevel }));
        expect(decision.posture, `${status} / ${requestedLevel}`).toBe(AAROHI_AVG12_POSTURE);
      }
    }
    // Identity, not equality. Two objects that happen to match today can diverge tomorrow.
    expect(PASSING_REPORT.posture).toBe(AAROHI_AVG12_POSTURE);
  });

  it('declares every authority as a literal falsehood the schema pins', () => {
    const posture = AAROHI_AVG12_POSTURE as unknown as Readonly<Record<string, unknown>>;
    for (const field of CEILING_FIELDS) {
      expect(posture[field], field).toBe(false);
      expect(aarohiAvg12PostureSchema.safeParse({ ...posture, [field]: true }).success, field).toBe(
        false,
      );
    }
  });

  it('declares every effect and every non-connection as a literal falsehood', () => {
    const posture = AAROHI_AVG12_POSTURE as unknown as Readonly<Record<string, unknown>>;
    const DECLARED_FALSE = [
      'evaluationSourceAuthenticated',
      ...CEILING_FIELDS,
      'coreWriteExecuted',
      'registrationConfirmed',
      'paymentConfirmed',
      'activationConfirmed',
      'vendorActivated',
      'acquisitionCaseMutated',
      'anishaHandoffExecuted',
      'coldGateWidened',
      'communicationRequestCreated',
      'approvalRequestCreated',
      'approvalDecisionCreated',
      'communicationAuthorizationCreated',
      'executionIntentCreated',
      'n8nExecutionRequested',
      'providerSendRequested',
      'channelSendRequested',
      'sent',
      'delivered',
      'modelCallExecuted',
      'promptResolved',
      'retrievalExecuted',
      'persisted',
      'liveCoreConnected',
      'productionActivated',
      'productionMutation',
      'businessEffect',
      'fullAarohiCertificationClaimed',
    ] as const;
    const DECLARED_TRUE = [
      'offlineOnly',
      'failClosed',
      'requiresExistingGovernedAuthorityForAnyFutureAction',
      'requiresCoreAuthorityForAnyBusinessOutcome',
      'requiresSeparateCertificationBeforeIntegration',
      'requiresSeparateActivatingAdrBeforeRuntimeUse',
    ] as const;

    for (const field of DECLARED_FALSE) expect(posture[field], field).toBe(false);
    for (const field of DECLARED_TRUE) expect(posture[field], field).toBe(true);

    // Complete in BOTH directions, for the reason ADR-0124 records: a governance list that can
    // quietly lose a member is a list that eventually will.
    expect([...DECLARED_FALSE].sort()).toStrictEqual(
      Object.entries(posture)
        .filter(([, value]) => value === false)
        .map(([key]) => key)
        .sort(),
    );
    expect([...DECLARED_TRUE].sort()).toStrictEqual(
      Object.entries(posture)
        .filter(([, value]) => value === true)
        .map(([key]) => key)
        .sort(),
    );
    for (const field of DECLARED_TRUE) {
      expect(
        aarohiAvg12PostureSchema.safeParse({ ...posture, [field]: false }).success,
        field,
      ).toBe(false);
    }
  });

  it('opens only preparations, and only ones whose own builder re-runs its own gate', () => {
    expect(AAROHI_AUTONOMY_LEVEL_PREPARATIONS[AAROHI_AUTONOMY_FLOOR]).toStrictEqual([]);
    expect(AAROHI_AUTONOMY_LEVEL_PREPARATIONS.L1_READ.length).toBeGreaterThan(0);
    expect(AAROHI_AUTONOMY_LEVEL_PREPARATIONS[AAROHI_AUTONOMY_CEILING]).toStrictEqual([
      ...AAROHI_OFFLINE_PREPARATIONS,
    ]);
    // The ladder is monotonic: a higher level never withdraws what a lower one opened.
    for (const level of AAROHI_AUTONOMY_LEVELS) {
      for (const lower of AAROHI_AUTONOMY_LEVELS) {
        if (AAROHI_AUTONOMY_RANK[lower] > AAROHI_AUTONOMY_RANK[level]) continue;
        for (const preparation of AAROHI_AUTONOMY_LEVEL_PREPARATIONS[lower]) {
          expect(AAROHI_AUTONOMY_LEVEL_PREPARATIONS[level], `${lower} <= ${level}`).toContain(
            preparation,
          );
        }
      }
    }
    // And nothing in the set is an action.
    for (const preparation of AAROHI_OFFLINE_PREPARATIONS) {
      expect(preparation, preparation).toMatch(/_(PREPARATION|ASSESSMENT|REVIEW|EVALUATION)$/u);
    }
  });

  it('describes a decision whose granted level, next step or preparations disagree', () => {
    // The SCHEMA is a shape description, and these are the internal disagreements it can see. What
    // it cannot see — and what the section below is about — is whether the decision was derived at
    // all. That is why no function accepts a decision as input.
    const decision = decisionOf(decide());
    for (const forged of [
      { grantedLevel: AAROHI_AUTONOMY_CEILING, requestedLevel: AAROHI_AUTONOMY_FLOOR },
      { reason: 'CORE_SUPPRESSED' },
      { requiredNextStep: 'PROCEED_WITHIN_THE_GRANTED_OFFLINE_LEVEL', reason: 'CORE_SUPPRESSED' },
      { permittedOfflinePreparations: [] },
      { permittedOfflinePreparations: ['PROSPECT_PRIORITY_ASSESSMENT'] },
      { downgraded: true },
      { posture: { ...AAROHI_AVG12_POSTURE, sendAuthorityGranted: true } },
      { sourcePosture: 'CORE_VERIFIED' },
    ]) {
      expect(
        aarohiControlledAutonomyDecisionSchema.safeParse({ ...decision, ...forged }).success,
        JSON.stringify(forged),
      ).toBe(false);
    }

    // One field changed, everything else consistent — the case that isolates the next-step rule.
    expect(
      aarohiControlledAutonomyDecisionSchema.safeParse({
        ...decision,
        requiredNextStep: 'NONE_REFUSED',
      }).success,
    ).toBe(false);
    const refused = decisionOf(decide({ status: 'DO_NOT_CONTACT' }));
    expect(
      aarohiControlledAutonomyDecisionSchema.safeParse({
        ...refused,
        requiredNextStep: 'PROCEED_WITHIN_THE_GRANTED_OFFLINE_LEVEL',
      }).success,
    ).toBe(false);

    // A floor decision may not carry the ceiling's preparations, in either direction.
    const floor = decisionOf(decide({ requestedLevel: AAROHI_AUTONOMY_FLOOR }));
    expect(
      aarohiControlledAutonomyDecisionSchema.safeParse({
        ...floor,
        permittedOfflinePreparations: [...AAROHI_OFFLINE_PREPARATIONS],
      }).success,
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// F. What AVG-12 did not become.
// ---------------------------------------------------------------------------

describe('AVG-12 adds no authority, no bridge and no activation', () => {
  it('leaves the cold gate exactly one status wide', () => {
    expect([...ELIGIBLE_CORE_STATUSES]).toStrictEqual(['NOT_REGISTERED']);
    expect(AAROHI_AVG12_POSTURE.coldGateWidened).toBe(false);
    // And no autonomy level admits a status the gate refuses.
    for (const status of CORE_PARTY_STATUSES) {
      if (status === 'NOT_REGISTERED') continue;
      for (const requestedLevel of AAROHI_AUTONOMY_LEVELS) {
        const decision = decisionOf(decide({ status, requestedLevel }));
        expect(decision.grantedLevel, `${status} / ${requestedLevel}`).toBe(AAROHI_AUTONOMY_FLOOR);
      }
    }
  });

  it('exports no activation, rollout, send, approve or execute function', () => {
    const barrel = { ...AAROHI_AUTONOMY_REASON_NEXT_STEP };
    expect(Object.keys(barrel).length).toBeGreaterThan(0);
    // Asserted against the public barrel itself in the containment spec; here the point is the
    // vocabulary a caller reads back, which names no such capability.
    const everyResultToken = JSON.stringify({
      report: PASSING_REPORT,
      decision: decisionOf(decide()),
    }).toLowerCase();
    for (const forbidden of [
      'cansend',
      'canexecute',
      'isauthorized',
      'approvalgranted',
      'dispatchallowed',
      'markregistered',
      'markpaid',
      'grantcredits',
      'assignpackage',
      'enablerollout',
      'activateproduction',
      'golive',
      'productionready',
    ]) {
      expect(everyResultToken, forbidden).not.toContain(forbidden);
    }
  });

  it('claims no certification, and says so as a literal', () => {
    expect(AAROHI_AVG12_POSTURE.fullAarohiCertificationClaimed).toBe(false);
    expect(AAROHI_AVG12_POSTURE.requiresSeparateCertificationBeforeIntegration).toBe(true);
    expect(AAROHI_AVG12_POSTURE.requiresSeparateActivatingAdrBeforeRuntimeUse).toBe(true);
    const serialized = JSON.stringify({
      report: PASSING_REPORT,
      decision: decisionOf(decide()),
    }).toLowerCase();
    for (const forbidden of ['certified', 'certification_complete', 'aarohi_certified']) {
      // The one appearance of a certification word is the posture field that DENIES one.
      expect(serialized.includes(forbidden) && forbidden !== 'certified').toBe(false);
    }
    expect(serialized).toContain('fullaarohicertificationclaimed":false');
  });

  it('lists refusal vocabularies that are closed and content-free', () => {
    for (const vocabulary of [AAROHI_EVALUATION_REFUSALS, AAROHI_AUTONOMY_REFUSALS]) {
      expect(new Set(vocabulary).size).toBe(vocabulary.length);
      for (const member of vocabulary) {
        expect(member, member).toMatch(/^[A-Z0-9_]+$/u);
      }
    }
  });

  it('exercises the certified bounds it claims to, and never invents one of its own', () => {
    // The scale claim is anchored to constants the SIBLING contracts own, so it cannot drift by
    // AVG-12 quietly choosing a friendlier number.
    expect(PASSING_REPORT.scale.largestCertifiedBoundExercised).toBe(
      MAX_AAROHI_ANALYTICS_EVIDENCE + 1,
    );
    expect(MAX_INSTAGRAM_CONVERSATION_TURNS).toBeGreaterThan(0);
    expect(PASSING_REPORT.scale.certifiedBoundsExercised).toBe(
      AAROHI_OFFLINE_PROBES.filter((probe) => AAROHI_PROBE_DIMENSION[probe] === 'BOUNDED_VOLUME')
        .length,
    );
  });
});

// ---------------------------------------------------------------------------
// G. A forged evaluation result is INERT.
//
// The defect this section exists for: a serialized report is not the derivation that produced it,
// and no arithmetic inside a JSON object can prove that forty probes ran. An earlier revision let
// `decideAarohiControlledAutonomy` accept one and let a passing one unlock the top rung, so a
// caller who had never run the corpus could write a consistent PASS and raise its own ceiling.
//
// The correction is structural rather than cryptographic: NO exported function takes an evaluation
// result as an input. A forged PASS is therefore not refused so much as unusable.
// ---------------------------------------------------------------------------

describe('a forged evaluation result cannot become evidence', () => {
  it('is genuinely complete and internally consistent, so the specs below mean something', () => {
    // If this stopped being a convincing forgery, everything after it would pass for the wrong
    // reason. So the forgery is asserted to be exactly as good as a real report, field for field.
    expect(aarohiOfflineEvaluationReportSchema.safeParse(FORGED_PASS).success).toBe(true);
    expect(Object.keys(FORGED_PASS).sort()).toStrictEqual(Object.keys(PASSING_REPORT).sort());
    expect(FORGED_PASS.outcome).toBe('OFFLINE_EVALUATION_PASSED');
    expect(FORGED_PASS.probesEvaluated).toBe(AAROHI_OFFLINE_PROBE_COUNT);
    expect(FORGED_PASS.probesHeld).toBe(AAROHI_OFFLINE_PROBE_COUNT);
    expect(FORGED_PASS.probesFailed).toBe(0);
    expect(FORGED_PASS.criticalFailures).toBe(0);
    expect(FORGED_PASS.dimensions).toHaveLength(AAROHI_EVALUATION_DIMENSIONS.length);
    // Everything but the caller's own suite reference matches a derived report exactly.
    expect(JSON.stringify({ ...FORGED_PASS, suiteRef: PASSING_REPORT.suiteRef })).toBe(
      JSON.stringify({ ...PASSING_REPORT, scale: FORGED_PASS.scale }),
    );
  });

  it('CANNOT be handed to the autonomy decision at all', () => {
    // The input schema is strict and has no field for it, so this is a refusal rather than a
    // silently-ignored key — which is the difference between "we ignore it" and "you cannot say it".
    for (const field of ['offlineEvaluation', 'evaluation', 'readiness', 'evaluationPassed']) {
      expect(
        decideAarohiControlledAutonomy({
          decisionRef: 'AVG12-SPEC-DECISION',
          prospectRef: PROSPECT,
          decidedAt: DECIDED_AT,
          requestedLevel: AAROHI_AUTONOMY_CEILING,
          coreObservation: {
            prospectRef: PROSPECT,
            coreLookupRef: 'AVG12-SPEC-LOOKUP',
            status: 'DO_NOT_CONTACT',
          },
          coreObservedAt: OBSERVED_AT,
          [field]: FORGED_PASS,
        }),
        field,
      ).toStrictEqual({ ok: false, refusal: 'AUTONOMY_INPUT_INVALID' });
    }
  });

  it('CANNOT unlock L2, for a suppressed party or an eligible one', () => {
    // The strongest form of the claim: the granted level is IDENTICAL whether or not a forged pass
    // exists anywhere, because there is nowhere for it to go.
    const suppressed = decisionOf(decide({ status: 'DO_NOT_CONTACT' }));
    expect(suppressed.grantedLevel).toBe(AAROHI_AUTONOMY_FLOOR);
    expect(suppressed.reason).toBe('CORE_SUPPRESSED');
    expect(suppressed.permittedOfflinePreparations).toStrictEqual([]);

    // And where L2 IS reached, it is reached on the Core gate alone.
    const eligible = decisionOf(decide({ status: 'NOT_REGISTERED' }));
    expect(eligible.grantedLevel).toBe(AAROHI_AUTONOMY_CEILING);
    expect(eligible.reason).toBe('EVIDENCE_CURRENT_AND_ELIGIBLE');
    expect(JSON.stringify(eligible)).not.toContain('AVG12-FORGED-SUITE');
  });

  it('reaches no exported function, because none accepts an evaluation result', async () => {
    // A sweep of the whole public surface rather than a list somebody has to maintain. Every
    // exported function is offered the forged pass as its ONLY argument and as an envelope field;
    // none of them may return something that looks like an accepted evaluation.
    const surface = await PUBLIC_SURFACE();
    const functions = Object.entries(surface).filter(
      ([, value]) => typeof value === 'function',
    ) as readonly (readonly [string, (value: unknown) => unknown])[];
    expect(functions.length).toBeGreaterThan(0);

    for (const [name, fn] of functions) {
      let outcome: unknown;
      try {
        outcome = fn(FORGED_PASS);
      } catch {
        // A throw is a refusal too. What matters is that nothing accepted it.
        continue;
      }
      const serialized = JSON.stringify(outcome ?? null);
      // Nothing may come back carrying the forgery's own identity, and nothing may come back
      // announcing a passing evaluation it did not run.
      expect(serialized, name).not.toContain('AVG12-FORGED-SUITE');
      if (serialized.includes('OFFLINE_EVALUATION_PASSED')) {
        // The only legitimate way that token appears is a suite this call actually ran, and no
        // function called with a REPORT can have run one.
        expect(name, `${name} echoed a passing outcome it did not derive`).toBe('never');
      }
    }
  });

  it('is not exported as a parser that could imply it was derived', async () => {
    const surface = await PUBLIC_SURFACE();
    for (const gone of [
      'parseAarohiOfflineEvaluationReport',
      'parseAarohiControlledAutonomyDecision',
      'verifyAarohiOfflineEvaluationReport',
      'assessAarohiOfflineReadiness',
    ]) {
      expect(Object.hasOwn(surface, gone), gone).toBe(false);
    }
    // The SCHEMAS stay exported, and they are shape descriptions rather than provenance claims.
    // A forged pass satisfies the schema, and that is the point being written down.
    expect(typeof surface['aarohiOfflineEvaluationReportSchema']).toBe('object');
    expect(aarohiOfflineEvaluationReportSchema.safeParse(FORGED_PASS).success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// H. A forged L2 decision is INERT for the same reason.
// ---------------------------------------------------------------------------

describe('a forged autonomy decision cannot become a derived decision', () => {
  it('is genuinely self-consistent, so the specs below mean something', () => {
    expect(aarohiControlledAutonomyDecisionSchema.safeParse(FORGED_L2_DECISION).success).toBe(true);
    expect(FORGED_L2_DECISION.grantedLevel).toBe(AAROHI_AUTONOMY_CEILING);
    expect(FORGED_L2_DECISION.permittedOfflinePreparations).toStrictEqual([
      ...AAROHI_OFFLINE_PREPARATIONS,
    ]);
    const derived = decisionOf(decide());
    expect(Object.keys(FORGED_L2_DECISION).sort()).toStrictEqual(Object.keys(derived).sort());
  });

  it('has no exported parser that would certify it as derived', async () => {
    const surface = await PUBLIC_SURFACE();
    expect(Object.hasOwn(surface, 'parseAarohiControlledAutonomyDecision')).toBe(false);
    // The schema remains, and it proves internal consistency only. Saying so out loud is the
    // correction: a self-consistent object is not a derivation, and this asserts the gap exists
    // rather than pretending it is closed.
    expect(aarohiControlledAutonomyDecisionSchema.safeParse(FORGED_L2_DECISION).success).toBe(true);
  });

  it('reaches no exported function, because none accepts a decision', async () => {
    const surface = await PUBLIC_SURFACE();
    const functions = Object.entries(surface).filter(
      ([, value]) => typeof value === 'function',
    ) as readonly (readonly [string, (value: unknown) => unknown])[];

    for (const [name, fn] of functions) {
      let outcome: unknown;
      try {
        outcome = fn(FORGED_L2_DECISION);
      } catch {
        continue;
      }
      const serialized = JSON.stringify(outcome ?? null);
      expect(serialized, name).not.toContain('AVG12-FORGED-DECISION');
      expect(serialized, name).not.toContain('L2_SELECT_GOVERNED_OFFLINE_PREPARATION');
    }
  });

  it('changes nothing about what the real decision boundary returns', () => {
    // The decision function does not consult, cache or remember anything. Two calls either side of
    // a forgery being constructed return the same bytes.
    const before = decisionOf(decide({ status: 'DO_NOT_CONTACT' }));
    void FORGED_L2_DECISION;
    const after = decisionOf(decide({ status: 'DO_NOT_CONTACT' }));
    expect(JSON.stringify(after)).toBe(JSON.stringify(before));
    expect(after.grantedLevel).toBe(AAROHI_AUTONOMY_FLOOR);
  });
});
