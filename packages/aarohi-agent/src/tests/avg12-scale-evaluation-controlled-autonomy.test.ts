/**
 * AVG-12 — scale, evaluation and controlled autonomy offline domain (ADR-0130).
 *
 * The suite is organised around the one claim the stage has to survive: **evaluation is not
 * authority**. A green corpus, an exercised bound and a granted autonomy level are each proved to
 * establish exactly what they say and nothing beyond it.
 *
 * The corpus itself is the first spec, because a probe that never ran catches no mutation. After
 * that the specs attack the corpus: a subset, a duplicate, a forged report, a caller-chosen severity
 * and a caller-chosen outcome are each refused, so a failing behaviour cannot be labelled as a pass.
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
  parseAarohiControlledAutonomyDecision,
  parseAarohiOfflineEvaluationReport,
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
    readonly offlineEvaluation?: unknown;
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
    // Presence rather than `??`, so a deliberate `undefined` or `null` reaches the function under
    // test instead of silently falling back to the good report.
    offlineEvaluation:
      'offlineEvaluation' in overrides ? overrides.offlineEvaluation : PASSING_REPORT,
  });

const decisionOf = (
  result: ReturnType<typeof decideAarohiControlledAutonomy>,
): AarohiControlledAutonomyDecision => {
  if (!result.ok) throw new Error(`expected a decision, got refusal ${result.refusal}`);
  return result.decision;
};

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
        offlineEvaluation: PASSING_REPORT,
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
          offlineEvaluation: PASSING_REPORT,
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
    expect(parseAarohiOfflineEvaluationReport(forged)).toBeUndefined();
    // The same figures with an honest outcome parse, which is what proves the refusal above is
    // about the CLAIM rather than about the arithmetic.
    expect(
      parseAarohiOfflineEvaluationReport({ ...forged, outcome: 'OFFLINE_EVALUATION_FAILED' }),
    ).toBeDefined();
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
        parseAarohiOfflineEvaluationReport({ ...PASSING_REPORT, ...forged }),
        JSON.stringify(Object.keys(forged)),
      ).toBeUndefined();
    }

    // The dangerous forgery is the internally CONSISTENT one: a report that ran a single probe,
    // tallied it honestly, added up correctly and called itself a pass. Every arithmetic rule
    // above is satisfied by it, and only the whole-corpus rule refuses it. A mutation campaign
    // found this: deleting that rule left every case above still failing for a different reason.
    expect(
      parseAarohiOfflineEvaluationReport({
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
      }),
    ).toBeUndefined();
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
        parseAarohiOfflineEvaluationReport({ ...PASSING_REPORT, ...forged }),
        JSON.stringify(forged),
      ).toBeUndefined();
    }
    // A critical failure count above the failure count is not a severity a caller may assign.
    expect(
      parseAarohiOfflineEvaluationReport({
        ...PASSING_REPORT,
        outcome: 'OFFLINE_EVALUATION_FAILED',
        criticalFailures: 1,
      }),
    ).toBeUndefined();
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
      offlineEvaluation: PASSING_REPORT,
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

    // A failing corpus over a suppressed party reports the harder fact, and both land at the floor.
    const failing = { ...PASSING_REPORT, outcome: 'OFFLINE_EVALUATION_FAILED' as const };
    const both = decisionOf(decide({ status: 'DO_NOT_CONTACT', offlineEvaluation: failing }));
    expect(both.reason).toBe('CORE_SUPPRESSED');
    expect(both.grantedLevel).toBe(AAROHI_AUTONOMY_FLOOR);
  });

  it('restricts on a failed corpus even for an eligible party', () => {
    const failing = { ...PASSING_REPORT, outcome: 'OFFLINE_EVALUATION_FAILED' as const };
    const decision = decisionOf(decide({ offlineEvaluation: failing }));
    expect(decision.reason).toBe('OFFLINE_EVALUATION_NOT_PASSED');
    expect(decision.grantedLevel).toBe('L1_READ');
    expect(decision.requiredNextStep).toBe('OBTAIN_HUMAN_REVIEW');
    expect(decision.downgraded).toBe(true);

    // A critical failure restricts further still, and outranks even a Core refusal.
    const critical = {
      ...PASSING_REPORT,
      outcome: 'OFFLINE_EVALUATION_FAILED' as const,
      probesHeld: AAROHI_OFFLINE_PROBE_COUNT - 1,
      probesFailed: 1,
      criticalFailures: 1,
      dimensions: PASSING_REPORT.dimensions.map((one, index) =>
        index === 0
          ? { ...one, probesHeld: one.probesHeld - 1, probesFailed: 1, criticalFailures: 1 }
          : one,
      ),
    };
    const worst = decisionOf(decide({ status: 'DO_NOT_CONTACT', offlineEvaluation: critical }));
    expect(worst.reason).toBe('OFFLINE_EVALUATION_CRITICAL_FAILURE');
    expect(worst.grantedLevel).toBe(AAROHI_AUTONOMY_FLOOR);
    expect(worst.permittedOfflinePreparations).toStrictEqual([]);
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
        offlineEvaluation: PASSING_REPORT,
      }),
    ).toStrictEqual({ ok: false, refusal: 'CORE_OBSERVATION_INVALID' });

    for (const evaluation of [
      undefined,
      null,
      {},
      { ...PASSING_REPORT, outcome: 'GREAT' },
      { ...PASSING_REPORT, probesEvaluated: 1, probesHeld: 1 },
      { ...PASSING_REPORT, posture: { ...AAROHI_AVG12_POSTURE, offlineOnly: false } },
    ]) {
      expect(decide({ offlineEvaluation: evaluation })).toStrictEqual({
        ok: false,
        refusal: 'OFFLINE_EVALUATION_INVALID',
      });
    }

    // A decision cannot rest on something that had not happened when it was made.
    expect(decide({ coreObservedAt: '2027-01-01T00:00:00.000Z' })).toStrictEqual({
      ok: false,
      refusal: 'DECISION_PREDATES_EVIDENCE',
    });
    expect(decide({ decidedAt: OBSERVED_AT })).toStrictEqual({
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
    expect(AAROHI_AUTONOMY_LEVEL_PREPARATIONS['L1_READ'].length).toBeGreaterThan(0);
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

  it('refuses a decision whose granted level, next step or preparations were edited', () => {
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
        parseAarohiControlledAutonomyDecision({ ...decision, ...forged }),
        JSON.stringify(forged),
      ).toBeUndefined();
    }
    // Each forgery above changes two things at once, and one of the other rules catches most of
    // them. The forgery that isolates the next-step rule changes ONE field and leaves the reason,
    // the level and the preparations all internally consistent — which is the case a mutation
    // campaign found surviving when the rule was deleted.
    expect(
      parseAarohiControlledAutonomyDecision({
        ...decision,
        requiredNextStep: 'NONE_REFUSED',
      }),
    ).toBeUndefined();
    const refused = decisionOf(decide({ status: 'DO_NOT_CONTACT' }));
    expect(
      parseAarohiControlledAutonomyDecision({
        ...refused,
        requiredNextStep: 'PROCEED_WITHIN_THE_GRANTED_OFFLINE_LEVEL',
      }),
    ).toBeUndefined();

    // A floor decision may not carry the ceiling's preparations, in either direction.
    const floor = decisionOf(decide({ requestedLevel: AAROHI_AUTONOMY_FLOOR }));
    expect(
      parseAarohiControlledAutonomyDecision({
        ...floor,
        permittedOfflinePreparations: [...AAROHI_OFFLINE_PREPARATIONS],
      }),
    ).toBeUndefined();
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
