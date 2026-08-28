/**
 * AVG-11 — analytics, admin read and dashboard offline domain (ADR-0128).
 *
 * The suite is organised around the one claim the stage has to survive: **a workflow step is not a
 * business outcome**. Everything else — determinism, dedup, bounds, strictness — protects that
 * claim from the ordinary ways a counting function goes wrong.
 *
 * Every positive case builds evidence through the CERTIFIED shape its owning stage publishes, so a
 * fixture cannot pass a test that the real artifact would fail.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  AAROHI_ACQUISITION_FUNNEL_OUTCOME,
  AAROHI_ANALYTICS_EVIDENCE_KINDS,
  AAROHI_ANALYTICS_POSTURE,
  AAROHI_ANALYTICS_REFUSALS,
  AAROHI_AVG10_CONTRACT_VERSION,
  AAROHI_AVG11_CONTRACT_VERSION,
  AAROHI_AVG11_EVIDENCE_SOURCE_POSTURE,
  AAROHI_AVG4_CONTRACT_VERSION,
  AAROHI_AVG8_CONTRACT_VERSION,
  AAROHI_AVG9_CONTRACT_VERSION,
  AAROHI_COMMERCIAL_FACTS_POSTURE,
  AAROHI_EVIDENCE_SOURCE_STATES,
  AAROHI_FUNNEL_STAGES,
  AAROHI_METRIC_AUTHORITIES,
  AAROHI_METRIC_UNAVAILABLE_REASONS,
  AAROHI_PAYMENT_FOLLOWUP_POSTURE,
  AAROHI_REGISTRATION_ASSISTANCE_POSTURE,
  AAROHI_STAGE_AUTHORITY,
  ACQUISITION_CASE_STATES,
  ACTIVATION_AUTHORITIES,
  CORE_COMMERCIAL_FACTS_OUTCOME,
  CORE_PARTY_STATUSES,
  CORE_PAYMENT_FOLLOWUP_OUTCOME,
  CORE_REGISTRATION_ASSISTANCE_OUTCOME,
  MAX_AAROHI_ANALYTICS_EVIDENCE,
  aarohiAcquisitionFunnelReportSchema,
  appendInstagramInboundObservation,
  buildAarohiAcquisitionFunnelReport,
  createInstagramConversation,
  parseAarohiAcquisitionFunnelReport,
  parseInstagramInboundObservation,
} from '../index.js';
import type {
  AarohiAcquisitionFunnelReport,
  AarohiAcquisitionFunnelReportResult,
  AarohiFunnelMetric,
  AarohiFunnelStage,
} from '../index.js';

// ---------------------------------------------------------------------------
// Fixtures. Every one is the CERTIFIED shape its owning stage publishes.
// ---------------------------------------------------------------------------

const PROSPECT_A = 'PROSPECT-A';
const PROSPECT_B = 'PROSPECT-B';
const OBSERVED_AT = '2026-08-20T08:00:00.000Z';
const PREPARED_AT = '2026-08-20T09:00:00.000Z';
const REPORT_AT = '2026-08-20T10:00:00.000Z';

const prospectIdentity = (prospectRef: string): unknown => ({
  prospectRef,
  discoverySource: 'PUBLIC_DIRECTORY',
});

const eligibilityObservation = (
  prospectRef: string,
  coreLookupRef: string,
  status = 'NOT_REGISTERED',
): unknown => ({ prospectRef, coreLookupRef, status });

const outreachDraft = (prospectRef: string, draftRef: string): unknown => ({
  contractVersion: AAROHI_AVG4_CONTRACT_VERSION,
  draftRef,
  prospectRef,
  revision: 1,
  state: 'OPEN',
  body: 'A drafted introduction, held for a human to weigh.',
  changedByRef: 'OPERATOR-ONE',
  changedAt: PREPARED_AT,
});

const conversation = (prospectRef: string, conversationRef: string): unknown => {
  const created = createInstagramConversation({
    prospectRef,
    instagramConversationRef: conversationRef,
    instagramThreadRef: 'THREAD-ONE',
    instagramParticipantRef: 'PARTICIPANT-ONE',
  });
  if (!created.ok) throw new Error('fixture: conversation did not build');
  return created.conversation;
};

const conversationWithTurnAt = (prospectRef: string, at: string): unknown => {
  const observation = parseInstagramInboundObservation({
    prospectRef,
    instagramConversationRef: 'CONVO-LATE',
    instagramThreadRef: 'THREAD-ONE',
    instagramParticipantRef: 'PARTICIPANT-ONE',
    instagramMessageRef: 'MESSAGE-ONE',
    body: 'Hello, tell me more.',
    observedAt: at,
  });
  if (!observation.ok) throw new Error('fixture: observation did not build');
  const appended = appendInstagramInboundObservation(
    conversation(prospectRef, 'CONVO-LATE'),
    observation.observation,
  );
  if (!appended.ok) throw new Error('fixture: conversation turn did not append');
  return appended.conversation;
};

const commercialBrief = (prospectRef: string, briefRef: string): unknown => ({
  contractVersion: AAROHI_AVG8_CONTRACT_VERSION,
  briefRef,
  catalogSnapshotRef: 'CATALOG-ONE',
  prospectRef,
  salesPlanRef: 'PLAN-ONE',
  interpretationRef: 'READING-ONE',
  catalogObservedAt: OBSERVED_AT,
  scope: 'AVAILABLE_PACKAGE_CATALOG',
  packages: [
    {
      id: 'PKG-STARTER',
      name: 'Starter',
      lead_count: 10,
      total_price: 100,
      display_price: 120,
      validity_days: 30,
      is_active: true,
    },
  ],
  preparedAt: PREPARED_AT,
  outcome: CORE_COMMERCIAL_FACTS_OUTCOME,
  posture: AAROHI_COMMERCIAL_FACTS_POSTURE,
});

const registrationBrief = (
  prospectRef: string,
  briefRef: string,
  preparedAt: string = PREPARED_AT,
): unknown => ({
  contractVersion: AAROHI_AVG9_CONTRACT_VERSION,
  briefRef,
  prospectRef,
  salesPlanRef: 'PLAN-ONE',
  interpretationRef: 'READING-ONE',
  coreLookupRef: 'LOOKUP-ONE',
  processContextRef: 'PROCESS-ONE',
  coreRegistrationProcessRef: 'CORE-PROCESS-ONE',
  processContextObservedAt: OBSERVED_AT,
  preparedAt,
  outcome: CORE_REGISTRATION_ASSISTANCE_OUTCOME,
  posture: AAROHI_REGISTRATION_ASSISTANCE_POSTURE,
});

const paymentBrief = (prospectRef: string, briefRef: string): unknown => ({
  contractVersion: AAROHI_AVG10_CONTRACT_VERSION,
  briefRef,
  prospectRef,
  salesPlanRef: 'PLAN-ONE',
  interpretationRef: 'READING-ONE',
  coreLookupRef: 'LOOKUP-ONE',
  paymentContextRef: 'PAYMENT-ONE',
  corePaymentContextRef: 'CORE-PAYMENT-ONE',
  paymentContextObservedAt: OBSERVED_AT,
  preparedAt: PREPARED_AT,
  outcome: CORE_PAYMENT_FOLLOWUP_OUTCOME,
  posture: AAROHI_PAYMENT_FOLLOWUP_POSTURE,
});

const handoffEvidence = (
  prospectRef: string,
  overrides: {
    readonly caseRef?: string;
    readonly caseState?: string;
    readonly authority?: string;
    readonly active?: boolean;
    readonly attestationProspectRef?: string;
  } = {},
): unknown => ({
  acquisitionCase: {
    caseRef: overrides.caseRef ?? 'CASE-ONE',
    prospectRef,
    state: overrides.caseState ?? 'AWAITING_CORE_ACTIVATION',
  },
  activationAttestation: {
    prospectRef: overrides.attestationProspectRef ?? prospectRef,
    coreAttestationRef: 'CORE-ATTEST-ONE',
    authority: overrides.authority ?? 'QUICKFURNO_CORE',
    active: overrides.active ?? true,
  },
});

const bothObserved = { jarvisWorkflow: 'OBSERVED', coreAuthoritative: 'OBSERVED' } as const;

const build = (
  evidence: readonly unknown[],
  sources: unknown = bothObserved,
  preparedAt: string = REPORT_AT,
): AarohiAcquisitionFunnelReportResult =>
  buildAarohiAcquisitionFunnelReport({
    reportRef: 'REPORT-ONE',
    preparedAt,
    evidenceSources: sources,
    evidence,
  });

const reportOf = (result: AarohiAcquisitionFunnelReportResult): AarohiAcquisitionFunnelReport => {
  if (!result.ok) throw new Error(`expected a report, got refusal ${result.refusal}`);
  return result.report;
};

const metricFor = (
  report: AarohiAcquisitionFunnelReport,
  stage: AarohiFunnelStage,
): AarohiFunnelMetric => {
  const metric = report.metrics.find((one) => one.stage === stage);
  if (metric === undefined) throw new Error(`report is missing stage ${stage}`);
  return metric;
};

const countAt = (report: AarohiAcquisitionFunnelReport, stage: AarohiFunnelStage): number => {
  const metric = metricFor(report, stage);
  if (metric.authority === 'AUTHORITY_UNAVAILABLE') {
    throw new Error(`stage ${stage} is unavailable and carries no count`);
  }
  return metric.distinctProspects;
};

/**
 * One item of every kind, all for one prospect. Proves each is recognised by exactly one parser.
 *
 * Every artifact reference is scoped by `tag`, because an artifact identity belongs to one prospect
 * and reusing one across two is exactly the conflict this stage refuses. A separate spec drives that
 * refusal deliberately.
 */
const oneOfEveryKind = (prospectRef: string, tag = 'ONE'): readonly unknown[] =>
  Object.freeze([
    prospectIdentity(prospectRef),
    eligibilityObservation(prospectRef, `LOOKUP-${tag}`),
    outreachDraft(prospectRef, `DRAFT-${tag}`),
    conversation(prospectRef, `CONVO-${tag}`),
    commercialBrief(prospectRef, `BRIEF-COMMERCIAL-${tag}`),
    registrationBrief(prospectRef, `BRIEF-REGISTRATION-${tag}`),
    paymentBrief(prospectRef, `BRIEF-PAYMENT-${tag}`),
    handoffEvidence(prospectRef, { caseRef: `CASE-${tag}` }),
  ]);

// ---------------------------------------------------------------------------

describe('the AVG-11 contract is pinned', () => {
  it('states its version, posture and outcome as fixed values', () => {
    expect(AAROHI_AVG11_CONTRACT_VERSION).toBe(1);
    expect(AAROHI_AVG11_EVIDENCE_SOURCE_POSTURE).toBe('INJECTED_OFFLINE_AAROHI_WORKFLOW_EVIDENCE');
    expect(AAROHI_ACQUISITION_FUNNEL_OUTCOME).toBe(
      'AAROHI_ACQUISITION_FUNNEL_READY_FOR_GOVERNED_READ_SURFACE',
    );
    expect(Object.isFrozen(AAROHI_ANALYTICS_POSTURE)).toBe(true);
  });

  it('declares every non-effect as a literal falsehood rather than as prose', () => {
    const posture = AAROHI_ANALYTICS_POSTURE as unknown as Readonly<Record<string, unknown>>;
    for (const field of [
      'evidenceSourceAuthenticated',
      'unknownReportedAsZero',
      'conversionRateCalculated',
      'revenueReported',
      'businessOutcomeClaimed',
      'registrationConfirmed',
      'paymentConfirmed',
      'activationConfirmed',
      'vendorActivated',
      'anishaHandoffExecuted',
      'acquisitionCaseMutated',
      'registrationMutated',
      'paymentMutated',
      'activationMutated',
      'marketplaceMutated',
      'packageOrderCreated',
      'creditsMutated',
      'modelCallExecuted',
      'promptResolved',
      'retrievalExecuted',
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
      'persisted',
      'adminWriteExposed',
      'productionMutation',
      'businessEffect',
    ]) {
      expect(posture[field], field).toBe(false);
    }
    expect(posture['readOnlyAnalytics']).toBe(true);
    expect(posture['requiresCoreAuthorityForAnyBusinessOutcome']).toBe(true);
    expect(posture['requiresActivatingAdrBeforeRuntimeUse']).toBe(true);
  });

  it('keeps the three closed vocabularies closed', () => {
    expect([...AAROHI_METRIC_AUTHORITIES]).toStrictEqual([
      'JARVIS_WORKFLOW_DERIVED',
      'CORE_AUTHORITATIVE',
      'AUTHORITY_UNAVAILABLE',
    ]);
    expect([...AAROHI_EVIDENCE_SOURCE_STATES]).toStrictEqual(['OBSERVED', 'NOT_OBSERVED']);
    expect([...AAROHI_METRIC_UNAVAILABLE_REASONS]).toStrictEqual(['EVIDENCE_SOURCE_NOT_OBSERVED']);
    expect(AAROHI_ANALYTICS_EVIDENCE_KINDS).toHaveLength(8);
  });
});

describe('the funnel vocabulary cannot name a business outcome', () => {
  it('contains no registered, paid, active or converted stage', () => {
    const stages: readonly string[] = AAROHI_FUNNEL_STAGES;
    for (const forbidden of [
      'REGISTERED',
      'PAID',
      'ACTIVE',
      'CONVERTED',
      'WON',
      'CHURNED',
      'CONTACTED',
      'DELIVERED',
      'REPLIED',
      'QUALIFIED',
      'AWAITING_CORE_ACTIVATION',
      'PAYMENT_CONFIRMED',
      'REGISTRATION_CONFIRMED',
    ]) {
      expect(stages, forbidden).not.toContain(forbidden);
    }
    // The two stages that come closest each say ASSISTANCE, and say it in their own token.
    expect(stages).toContain('REGISTRATION_ASSISTANCE_PREPARED');
    expect(stages).toContain('PAYMENT_FOLLOWUP_ASSISTANCE_PREPARED');
  });

  it('names Core as the authority for exactly one stage, and derives it from the stage', () => {
    const coreOwned = AAROHI_FUNNEL_STAGES.filter(
      (stage) => AAROHI_STAGE_AUTHORITY[stage] === 'CORE_AUTHORITATIVE',
    );
    expect([...coreOwned]).toStrictEqual(['CORE_ACTIVE_HANDOFF_CONFIRMED']);
    // Total over the vocabulary: no stage can arrive without an authority.
    for (const stage of AAROHI_FUNNEL_STAGES) {
      expect(AAROHI_STAGE_AUTHORITY[stage], stage).toBeDefined();
    }
  });

  it('reports every stage exactly once, in the canonical order, however evidence arrives', () => {
    const report = reportOf(build(oneOfEveryKind(PROSPECT_A)));
    expect(report.metrics.map((metric) => metric.stage)).toStrictEqual([...AAROHI_FUNNEL_STAGES]);
  });
});

describe('a workflow artifact never becomes a business outcome', () => {
  it('counts an AVG-9 brief as registration ASSISTANCE and never as a registration', () => {
    const report = reportOf(build([registrationBrief(PROSPECT_A, 'BRIEF-REGISTRATION')]));
    expect(countAt(report, 'REGISTRATION_ASSISTANCE_PREPARED')).toBe(1);
    // Every other stage is a genuine zero, and the terminal Core stage above all.
    expect(countAt(report, 'CORE_ACTIVE_HANDOFF_CONFIRMED')).toBe(0);
    expect(metricFor(report, 'REGISTRATION_ASSISTANCE_PREPARED').authority).toBe(
      'JARVIS_WORKFLOW_DERIVED',
    );
    expect(JSON.stringify(report)).not.toContain('REGISTERED');
  });

  it('counts an AVG-10 brief as payment ASSISTANCE and never as a payment or an activation', () => {
    const report = reportOf(build([paymentBrief(PROSPECT_A, 'BRIEF-PAYMENT')]));
    expect(countAt(report, 'PAYMENT_FOLLOWUP_ASSISTANCE_PREPARED')).toBe(1);
    expect(countAt(report, 'CORE_ACTIVE_HANDOFF_CONFIRMED')).toBe(0);
    expect(metricFor(report, 'PAYMENT_FOLLOWUP_ASSISTANCE_PREPARED').authority).toBe(
      'JARVIS_WORKFLOW_DERIVED',
    );
  });

  it('never lets a case AWAITING_CORE_ACTIVATION count as ACTIVE without Core saying so', () => {
    // The case is exactly at the boundary and the attestation is the ONLY thing missing.
    const refused = build([
      handoffEvidence(PROSPECT_A, { authority: 'AGENT_CASE_STATE' }),
    ]) as Extract<AarohiAcquisitionFunnelReportResult, { ok: false }>;
    expect(refused.ok).toBe(false);
    expect(refused.refusal).toBe('CORE_ACTIVE_HANDOFF_NOT_CONFIRMED');
  });

  it('refuses every substitute activation authority, one at a time', () => {
    for (const authority of ACTIVATION_AUTHORITIES.filter((one) => one !== 'QUICKFURNO_CORE')) {
      const result = build([handoffEvidence(PROSPECT_A, { authority })]);
      expect(result.ok, authority).toBe(false);
      if (result.ok) continue;
      expect(result.refusal, authority).toBe('CORE_ACTIVE_HANDOFF_NOT_CONFIRMED');
      if (result.refusal !== 'CORE_ACTIVE_HANDOFF_NOT_CONFIRMED') continue;
      expect(result.handoffRefusal, authority).toBe('AUTHORITY_NOT_CORE');
    }
  });

  it('refuses Core asserting NOT active, and says which half failed', () => {
    const result = build([handoffEvidence(PROSPECT_A, { active: false })]);
    expect(result.ok).toBe(false);
    if (result.ok || result.refusal !== 'CORE_ACTIVE_HANDOFF_NOT_CONFIRMED') {
      throw new Error('expected a handoff refusal');
    }
    expect(result.handoffRefusal).toBe('CORE_DID_NOT_CONFIRM_ACTIVE');
  });

  it('refuses a caller-supplied case that is already terminal, rather than believing it', () => {
    // The exact shortcut AVG-11 must not take: "the case says HANDED_OFF_TO_ANISHA, so count it".
    const result = build([handoffEvidence(PROSPECT_A, { caseState: 'HANDED_OFF_TO_ANISHA' })]);
    expect(result.ok).toBe(false);
    if (result.ok || result.refusal !== 'CORE_ACTIVE_HANDOFF_NOT_CONFIRMED') {
      throw new Error('expected a handoff refusal');
    }
    expect(result.handoffRefusal).toBe('CASE_NOT_AWAITING_ACTIVATION');
  });

  it('refuses every non-boundary case state, so no state stands in for Core', () => {
    for (const state of ACQUISITION_CASE_STATES.filter(
      (one) => one !== 'AWAITING_CORE_ACTIVATION',
    )) {
      const result = build([handoffEvidence(PROSPECT_A, { caseState: state })]);
      expect(result.ok, state).toBe(false);
    }
  });

  it('counts a confirmed Core handoff, and only under CORE_AUTHORITATIVE', () => {
    const report = reportOf(build([handoffEvidence(PROSPECT_A)]));
    expect(countAt(report, 'CORE_ACTIVE_HANDOFF_CONFIRMED')).toBe(1);
    expect(metricFor(report, 'CORE_ACTIVE_HANDOFF_CONFIRMED').authority).toBe('CORE_AUTHORITATIVE');
    // And nothing else moved: a Core fact about a party is not Aarohi having done the work.
    expect(countAt(report, 'PROSPECT_IDENTIFIED')).toBe(0);
  });

  it('does not mutate the acquisition case it was handed', () => {
    const evidence = handoffEvidence(PROSPECT_A) as {
      readonly acquisitionCase: Record<string, unknown>;
    };
    const before = JSON.stringify(evidence.acquisitionCase);
    expect(reportOf(build([evidence])).metrics).toBeDefined();
    expect(JSON.stringify(evidence.acquisitionCase)).toBe(before);
    expect(evidence.acquisitionCase['state']).toBe('AWAITING_CORE_ACTIVATION');
  });

  it('lets a conversation say anything at all and still establish nothing', () => {
    // AVG-5 carries the words; AVG-11 carries a count of conversations. Neither carries a claim.
    const report = reportOf(build([conversation(PROSPECT_A, 'CONVO-ONE')]));
    expect(countAt(report, 'CONVERSATION_OBSERVED')).toBe(1);
    expect(countAt(report, 'REGISTRATION_ASSISTANCE_PREPARED')).toBe(0);
    expect(countAt(report, 'PAYMENT_FOLLOWUP_ASSISTANCE_PREPARED')).toBe(0);
    expect(countAt(report, 'CORE_ACTIVE_HANDOFF_CONFIRMED')).toBe(0);
  });

  it('re-derives the AVG-1 gate rather than believing an eligibility claim', () => {
    const blocked = CORE_PARTY_STATUSES.filter((one) => one !== 'NOT_REGISTERED');
    for (const status of blocked) {
      const report = reportOf(build([eligibilityObservation(PROSPECT_A, 'LOOKUP-ONE', status)]));
      // Evaluated, yes. Eligible, no — and the caller had no field in which to say otherwise.
      expect(countAt(report, 'ELIGIBILITY_EVALUATED'), status).toBe(1);
      expect(countAt(report, 'ELIGIBLE_NET_NEW'), status).toBe(0);
    }

    const eligible = reportOf(build([eligibilityObservation(PROSPECT_A, 'LOOKUP-ONE')]));
    expect(countAt(eligible, 'ELIGIBILITY_EVALUATED')).toBe(1);
    expect(countAt(eligible, 'ELIGIBLE_NET_NEW')).toBe(1);
  });
});

describe('unknown is not zero', () => {
  it('gives an unobserved class metrics with no count key at all', () => {
    const report = reportOf(
      build(oneOfEveryKind(PROSPECT_A).slice(0, 7), {
        jarvisWorkflow: 'OBSERVED',
        coreAuthoritative: 'NOT_OBSERVED',
      }),
    );
    const terminal = metricFor(report, 'CORE_ACTIVE_HANDOFF_CONFIRMED');
    expect(terminal.authority).toBe('AUTHORITY_UNAVAILABLE');
    // The property that makes the lie unrepresentable rather than merely discouraged.
    expect(Object.hasOwn(terminal, 'distinctProspects')).toBe(false);
    expect(Object.keys(terminal).sort()).toStrictEqual([
      'authority',
      'expectedAuthority',
      'stage',
      'unavailableReason',
    ]);
    if (terminal.authority !== 'AUTHORITY_UNAVAILABLE') throw new Error('narrowing failed');
    expect(terminal.expectedAuthority).toBe('CORE_AUTHORITATIVE');
    expect(terminal.unavailableReason).toBe('EVIDENCE_SOURCE_NOT_OBSERVED');
    // The Jarvis half was genuinely read, so it still carries numbers.
    expect(countAt(report, 'REGISTRATION_ASSISTANCE_PREPARED')).toBe(1);
  });

  it('marks every stage unavailable when nothing was read, and never all-zero', () => {
    const report = reportOf(
      build([], { jarvisWorkflow: 'NOT_OBSERVED', coreAuthoritative: 'NOT_OBSERVED' }),
    );
    expect(report.metrics).toHaveLength(AAROHI_FUNNEL_STAGES.length);
    for (const metric of report.metrics) {
      expect(metric.authority, metric.stage).toBe('AUTHORITY_UNAVAILABLE');
      expect(Object.hasOwn(metric, 'distinctProspects'), metric.stage).toBe(false);
    }
    // A serialized unavailable report contains no zero to be misread.
    expect(JSON.stringify(report.metrics)).not.toContain('distinctProspects');
  });

  it('distinguishes an observed empty source from an unread one', () => {
    const observedEmpty = reportOf(build([]));
    const notObserved = reportOf(
      build([], { jarvisWorkflow: 'NOT_OBSERVED', coreAuthoritative: 'NOT_OBSERVED' }),
    );
    // Both had no evidence. Only one of them is entitled to say zero.
    expect(countAt(observedEmpty, 'PROSPECT_IDENTIFIED')).toBe(0);
    expect(metricFor(notObserved, 'PROSPECT_IDENTIFIED').authority).toBe('AUTHORITY_UNAVAILABLE');
    expect(JSON.stringify(observedEmpty)).not.toBe(JSON.stringify(notObserved));
  });

  it('refuses evidence for a class the caller said it had not read', () => {
    const result = build([registrationBrief(PROSPECT_A, 'BRIEF-REGISTRATION')], {
      jarvisWorkflow: 'NOT_OBSERVED',
      coreAuthoritative: 'OBSERVED',
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.refusal).toBe('EVIDENCE_SUPPLIED_FOR_UNOBSERVED_SOURCE');

    const coreSide = build([handoffEvidence(PROSPECT_A)], {
      jarvisWorkflow: 'OBSERVED',
      coreAuthoritative: 'NOT_OBSERVED',
    });
    expect(coreSide.ok).toBe(false);
    if (coreSide.ok) return;
    expect(coreSide.refusal).toBe('EVIDENCE_SUPPLIED_FOR_UNOBSERVED_SOURCE');
  });
});

describe('no rate is produced, from any denominator', () => {
  it('carries no rate, ratio, percentage, conversion or trend anywhere it reports a figure', () => {
    const report = reportOf(build(oneOfEveryKind(PROSPECT_A)));

    // Scanned as KEYS rather than as a serialized blob: `registration` contains `ratio`, and a
    // substring scan that has to be weakened to pass is not proving anything.
    const keys = [
      ...Object.keys(report).filter((key) => key !== 'posture'),
      ...report.metrics.flatMap((metric) => Object.keys(metric)),
      ...Object.keys(report.evidenceSources),
    ];
    for (const key of keys) {
      expect(key, key).not.toMatch(
        /rate|ratio|percent|conversion|trend|series|revenue|cac|ltv|roi|average|median|growth|cohort|since|until|window/iu,
      );
    }

    // And the posture, which NAMES the two it pins, states them as literal falsehoods.
    expect(report.posture.conversionRateCalculated).toBe(false);
    expect(report.posture.revenueReported).toBe(false);
  });

  it('exposes no function that could compute one', async () => {
    const barrel = (await import('../index.js')) as unknown as Record<string, unknown>;
    const avg11 = Object.keys(barrel).filter((name) => /AVG11|Funnel|Analytics|Metric/u.test(name));
    for (const name of avg11) {
      expect(name.toLowerCase(), name).not.toMatch(/rate|ratio|percent|convert/u);
    }
  });
});

describe('counting is deterministic', () => {
  it('gives the same report whatever order the evidence arrives in', () => {
    const evidence = [...oneOfEveryKind(PROSPECT_A, 'A'), ...oneOfEveryKind(PROSPECT_B, 'B')];
    const forwards = reportOf(build(evidence));
    const backwards = reportOf(build([...evidence].reverse()));
    // A fixed non-trivial permutation as well, so the test is not just reverse-symmetry.
    const rotated = reportOf(build([...evidence.slice(5), ...evidence.slice(0, 5)]));

    expect(JSON.stringify(backwards)).toBe(JSON.stringify(forwards));
    expect(JSON.stringify(rotated)).toBe(JSON.stringify(forwards));
  });

  it('does not inflate a stage when the same artifact arrives twice', () => {
    const brief = registrationBrief(PROSPECT_A, 'BRIEF-REGISTRATION');
    const report = reportOf(build([brief, brief, structuredClone(brief)]));
    expect(countAt(report, 'REGISTRATION_ASSISTANCE_PREPARED')).toBe(1);
  });

  it('does not inflate a stage when two different artifacts describe one prospect', () => {
    const report = reportOf(
      build([
        registrationBrief(PROSPECT_A, 'BRIEF-REGISTRATION-ONE'),
        registrationBrief(PROSPECT_A, 'BRIEF-REGISTRATION-TWO'),
      ]),
    );
    expect(countAt(report, 'REGISTRATION_ASSISTANCE_PREPARED')).toBe(1);
  });

  it('counts two prospects as two', () => {
    const report = reportOf(
      build([
        registrationBrief(PROSPECT_A, 'BRIEF-REGISTRATION-ONE'),
        registrationBrief(PROSPECT_B, 'BRIEF-REGISTRATION-TWO'),
      ]),
    );
    expect(countAt(report, 'REGISTRATION_ASSISTANCE_PREPARED')).toBe(2);
  });

  it('reports the same handoff refusal whichever failing envelope came first', () => {
    const wrongAuthority = handoffEvidence(PROSPECT_A, {
      caseRef: 'CASE-ONE',
      authority: 'PROVIDER_RECEIPT',
    });
    const offBoundary = handoffEvidence(PROSPECT_B, {
      caseRef: 'CASE-TWO',
      caseState: 'ELIGIBLE_NET_NEW',
    });
    const forwards = build([wrongAuthority, offBoundary]);
    const backwards = build([offBoundary, wrongAuthority]);
    expect(JSON.stringify(backwards)).toBe(JSON.stringify(forwards));
  });
});

describe('mixed identity is refused rather than merged', () => {
  it('refuses one evidence identity presented for two prospects', () => {
    const result = build([
      registrationBrief(PROSPECT_A, 'BRIEF-SHARED'),
      registrationBrief(PROSPECT_B, 'BRIEF-SHARED'),
    ]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.refusal).toBe('EVIDENCE_IDENTITY_CONFLICT');
  });

  it('refuses one Core lookup claimed for two prospects', () => {
    const result = build([
      eligibilityObservation(PROSPECT_A, 'LOOKUP-SHARED'),
      eligibilityObservation(PROSPECT_B, 'LOOKUP-SHARED'),
    ]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.refusal).toBe('EVIDENCE_IDENTITY_CONFLICT');
  });

  it('refuses an attestation about a different prospect than the case', () => {
    const result = build([handoffEvidence(PROSPECT_A, { attestationProspectRef: PROSPECT_B })]);
    expect(result.ok).toBe(false);
    if (result.ok || result.refusal !== 'CORE_ACTIVE_HANDOFF_NOT_CONFIRMED') {
      throw new Error('expected a handoff refusal');
    }
    expect(result.handoffRefusal).toBe('ATTESTATION_INVALID');
  });

  it('does not treat one reference string shared across KINDS as a conflict', () => {
    // A draft and a conversation that happen to share a reference are two identities, not one.
    const report = reportOf(
      build([outreachDraft(PROSPECT_A, 'SHARED-REF'), conversation(PROSPECT_B, 'SHARED-REF')]),
    );
    expect(countAt(report, 'OUTREACH_WORKSPACE_PREPARED')).toBe(1);
    expect(countAt(report, 'CONVERSATION_OBSERVED')).toBe(1);
  });
});

describe('the boundaries hold', () => {
  it('refuses a value no certified stage recognises, rather than counting it as other', () => {
    for (const stranger of [
      { prospectRef: PROSPECT_A },
      { anything: 'at all' },
      'PROSPECT-A',
      42,
      null,
      [],
    ]) {
      const result = build([stranger]);
      expect(result.ok, JSON.stringify(stranger)).toBe(false);
      if (result.ok) continue;
      expect(result.refusal, JSON.stringify(stranger)).toBe('EVIDENCE_UNRECOGNISED');
    }
  });

  it('refuses more evidence than one report may consider', () => {
    const many = Array.from({ length: MAX_AAROHI_ANALYTICS_EVIDENCE + 1 }, (_unused, index) =>
      prospectIdentity(`PROSPECT-${String(index)}`),
    );
    const result = build(many);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.refusal).toBe('EVIDENCE_LIMIT_EXCEEDED');
  });

  it('refuses a report that claims to predate the evidence it counts', () => {
    const late = build([registrationBrief(PROSPECT_A, 'BRIEF-LATE', '2026-08-21T09:00:00.000Z')]);
    expect(late.ok).toBe(false);
    if (late.ok) return;
    expect(late.refusal).toBe('REPORT_PREDATES_EVIDENCE');

    // The same rule over a conversation, whose instant is its newest inbound turn.
    const lateTurn = build([conversationWithTurnAt(PROSPECT_A, '2026-08-21T09:00:00.000Z')]);
    expect(lateTurn.ok).toBe(false);
    if (lateTurn.ok) return;
    expect(lateTurn.refusal).toBe('REPORT_PREDATES_EVIDENCE');
  });

  it('refuses an envelope that names anything a caller may not choose', () => {
    for (const extra of [
      { stage: 'PROSPECT_IDENTIFIED' },
      { authority: 'CORE_AUTHORITATIVE' },
      { metrics: [] },
      { posture: AAROHI_ANALYTICS_POSTURE },
      { outcome: AAROHI_ACQUISITION_FUNNEL_OUTCOME },
      { conversionRate: 0.5 },
      { since: OBSERVED_AT },
    ]) {
      const result = buildAarohiAcquisitionFunnelReport({
        reportRef: 'REPORT-ONE',
        preparedAt: REPORT_AT,
        evidenceSources: bothObserved,
        evidence: [],
        ...extra,
      });
      expect(result.ok, JSON.stringify(extra)).toBe(false);
      if (result.ok) continue;
      expect(result.refusal, JSON.stringify(extra)).toBe('REPORT_INPUT_INVALID');
    }
  });

  it('refuses a report reference that carries a destination', () => {
    for (const bad of [
      'reports@quickfurno.example',
      'https://reports.example/funnel',
      'www.reports.example',
      'REPORT-9876543',
    ]) {
      const result = buildAarohiAcquisitionFunnelReport({
        reportRef: bad,
        preparedAt: REPORT_AT,
        evidenceSources: bothObserved,
        evidence: [],
      });
      expect(result.ok, bad).toBe(false);
    }
  });

  it('names every refusal it can return, and returns only those', () => {
    expect([...AAROHI_ANALYTICS_REFUSALS]).toStrictEqual([
      'REPORT_INPUT_INVALID',
      'EVIDENCE_LIMIT_EXCEEDED',
      'EVIDENCE_UNRECOGNISED',
      'EVIDENCE_AMBIGUOUS',
      'EVIDENCE_SUPPLIED_FOR_UNOBSERVED_SOURCE',
      'CORE_ACTIVE_HANDOFF_NOT_CONFIRMED',
      'EVIDENCE_IDENTITY_CONFLICT',
      'REPORT_PREDATES_EVIDENCE',
    ]);
  });
});

describe('the report schema is strict and the report is detached', () => {
  it('refuses an unknown field on the report and on a metric', () => {
    const report = reportOf(build(oneOfEveryKind(PROSPECT_A)));

    const withExtra = { ...report, extra: true };
    expect(parseAarohiAcquisitionFunnelReport(withExtra)).toBeUndefined();

    const metrics = report.metrics.map((metric, index) =>
      index === 0 ? { ...metric, extra: true } : metric,
    );
    expect(parseAarohiAcquisitionFunnelReport({ ...report, metrics })).toBeUndefined();
  });

  it('refuses a metric claiming an authority its stage does not own', () => {
    const report = reportOf(build(oneOfEveryKind(PROSPECT_A)));
    const metrics = report.metrics.map((metric) =>
      metric.stage === 'REGISTRATION_ASSISTANCE_PREPARED'
        ? { ...metric, authority: 'CORE_AUTHORITATIVE' }
        : metric,
    );
    expect(parseAarohiAcquisitionFunnelReport({ ...report, metrics })).toBeUndefined();
  });

  it('refuses an unavailable metric that smuggles a count back in', () => {
    const report = reportOf(
      build([], { jarvisWorkflow: 'NOT_OBSERVED', coreAuthoritative: 'NOT_OBSERVED' }),
    );
    const metrics = report.metrics.map((metric, index) =>
      index === 0 ? { ...metric, distinctProspects: 0 } : metric,
    );
    expect(parseAarohiAcquisitionFunnelReport({ ...report, metrics })).toBeUndefined();
  });

  it('refuses metrics out of canonical order, or with a stage missing', () => {
    const report = reportOf(build(oneOfEveryKind(PROSPECT_A)));
    expect(
      parseAarohiAcquisitionFunnelReport({ ...report, metrics: [...report.metrics].reverse() }),
    ).toBeUndefined();
    expect(
      parseAarohiAcquisitionFunnelReport({ ...report, metrics: report.metrics.slice(1) }),
    ).toBeUndefined();
  });

  it('freezes the report and every metric in it', () => {
    const report = reportOf(build(oneOfEveryKind(PROSPECT_A)));
    expect(Object.isFrozen(report)).toBe(true);
    expect(Object.isFrozen(report.metrics)).toBe(true);
    for (const metric of report.metrics) {
      expect(Object.isFrozen(metric), metric.stage).toBe(true);
    }
    expect(report.posture).toBe(AAROHI_ANALYTICS_POSTURE);
  });

  it('accepts what it produces, on every path', () => {
    for (const sources of [
      bothObserved,
      { jarvisWorkflow: 'OBSERVED', coreAuthoritative: 'NOT_OBSERVED' },
      { jarvisWorkflow: 'NOT_OBSERVED', coreAuthoritative: 'OBSERVED' },
      { jarvisWorkflow: 'NOT_OBSERVED', coreAuthoritative: 'NOT_OBSERVED' },
    ]) {
      const evidence =
        sources.jarvisWorkflow === 'OBSERVED' && sources.coreAuthoritative === 'OBSERVED'
          ? oneOfEveryKind(PROSPECT_A)
          : [];
      const report = reportOf(build(evidence, sources));
      expect(aarohiAcquisitionFunnelReportSchema.safeParse(report).success).toBe(true);
      expect(parseAarohiAcquisitionFunnelReport(report)).toStrictEqual(report);
    }
  });
});

describe('the report carries aggregates and nothing else', () => {
  it('names no prospect, artifact, message or destination', () => {
    const report = reportOf(build(oneOfEveryKind(PROSPECT_A)));
    const serialized = JSON.stringify(report);
    for (const leaked of [
      PROSPECT_A,
      'DRAFT-ONE',
      'CONVO-ONE',
      'BRIEF-REGISTRATION',
      'BRIEF-PAYMENT',
      'BRIEF-COMMERCIAL',
      'LOOKUP-ONE',
      'CASE-ONE',
      'CORE-ATTEST-ONE',
      'PKG-STARTER',
      'Starter',
      'PARTICIPANT-ONE',
      'drafted introduction',
    ]) {
      expect(serialized, leaked).not.toContain(leaked);
    }
  });

  it('carries no field that could hold contact, payment or message data', () => {
    const report = reportOf(build(oneOfEveryKind(PROSPECT_A)));
    expect(Object.keys(report).sort()).toStrictEqual([
      'contractVersion',
      'evidenceSources',
      'metrics',
      'outcome',
      'posture',
      'preparedAt',
      'reportRef',
      'sourcePosture',
    ]);
    const serialized = JSON.stringify(report).toLowerCase();
    for (const forbidden of [
      'phone',
      'email',
      'whatsapp',
      'instagram',
      'handle',
      'gst',
      'address',
      'latitude',
      'longitude',
      'bank',
      'card',
      'upi',
      'amount',
      'currency',
      'price',
      'body',
      'message',
    ]) {
      expect(serialized, forbidden).not.toContain(forbidden);
    }
  });
});

// ===========================================================================
// The roadmap overlay and the ADR.
// ===========================================================================

describe('the roadmap overlay stays true on both sides of a merge', () => {
  const overlay = readFileSync(
    fileURLToPath(
      new URL(
        '../../../../docs/architecture/aarohi-vendor-growth-roadmap-overlay.md',
        import.meta.url,
      ),
    ),
    'utf8',
  );

  it('records AVG-0 through AVG-10 as certified, and AVG-11 as a defined proof', () => {
    const certified = /AVG-0 through AVG-(\d+) — implemented as certified offline domains/u.exec(
      overlay,
    );
    expect(certified).not.toBeNull();
    expect(Number(certified?.[1] ?? '0')).toBeGreaterThanOrEqual(10);
    expect(overlay).toContain('ADR-0128');
    expect(overlay).toMatch(/AVG-11 — offline implementation proof defined by\s+\[ADR-0128\]/u);
    expect(overlay).toContain('### AVG-11 — Analytics, Admin APIs and Full Dashboard');
  });

  it('keeps AVG-12 planned and unimplemented, and the runtime PLANNED / DISABLED', () => {
    expect(overlay).toMatch(/AVG-12 — planned and unimplemented/u);
    expect(overlay).not.toMatch(/AVG-12 — offline implementation proof/u);
    expect(overlay).toContain('PLANNED / DISABLED');
    for (const forbidden of ['autonomy increase', 'auto outreach', 'self-optimis']) {
      expect(overlay.toLowerCase(), forbidden).not.toContain(`avg-11 ${forbidden}`);
    }
  });

  it('claims no reading, no rate and no business outcome for AVG-11', () => {
    const section = overlay.slice(
      overlay.indexOf('### AVG-11 — Analytics, Admin APIs and Full Dashboard'),
      overlay.indexOf('### AVG-12'),
    );
    expect(section).toContain('A workflow step is not a business outcome');
    expect(section).toContain('UNKNOWN is not ZERO');
    expect(section).toContain('No rate, and that is a decision');
    expect(section).toContain('remain gaps');
    expect(section).toContain('completeCoreActiveHandoff');
    // No stage a business outcome could hide in, in the document either.
    for (const forbidden of ['REGISTERED`', 'PAID`', 'conversion rate of']) {
      expect(section.includes(`stage \`${forbidden}`), forbidden).toBe(false);
    }
  });

  it('encodes no branch state, and claims no runtime activation', () => {
    const lowered = overlay.toLowerCase();
    for (const forbidden of [
      'not merged',
      'proposed in this branch',
      'current branch',
      'after merge',
      'this pr',
      'runtime activated',
      'runtime is active',
    ]) {
      expect(lowered, forbidden).not.toContain(forbidden);
    }
  });

  it('is defined by an ADR that records the boundaries this suite proves', () => {
    const adr = readFileSync(
      fileURLToPath(
        new URL(
          '../../../../docs/decisions/ADR-0128-qfj-p12-avg11-aarohi-analytics-admin-dashboard-offline-domain.md',
          import.meta.url,
        ),
      ),
      'utf8',
    );
    expect(adr).toContain('7bb65d785d8d7b81d87df91ab913500737e1dd56');
    expect(adr).toContain('JARVIS_WORKFLOW_DERIVED');
    expect(adr).toContain('CORE_AUTHORITATIVE');
    expect(adr).toContain('AUTHORITY_UNAVAILABLE');
    expect(adr).toContain('completeCoreActiveHandoff');
    expect(adr).toContain('PLANNED / DISABLED');
    // The two decisions a later reader will most want the reasoning for.
    expect(adr.toLowerCase()).toContain('no rate');
    expect(adr.toLowerCase()).toContain('unknown is not zero');
    // The wire additions are versioned, not edited into V1 (ADR-0086's change-control rule).
    expect(adr).toContain('ADR-0129');
    expect(adr).not.toContain('TIGHTENS V1');
  });

  it('records the contract V2 decision in its own ADR', () => {
    const v2 = readFileSync(
      fileURLToPath(
        new URL(
          '../../../../docs/decisions/ADR-0129-avg11-control-plane-read-contract-v2.md',
          import.meta.url,
        ),
      ),
      'utf8',
    );
    expect(v2).toContain('ADR-0086');
    expect(v2).toContain('7bb65d785d8d7b81d87df91ab913500737e1dd56');
    // The two claims a reviewer of a version bump most needs to find.
    expect(v2).toContain('V1 is frozen');
    expect(v2.toLowerCase()).toContain('golden');
    expect(v2).toContain('/api/control-plane/v2/snapshot');
    expect(v2).toContain('PLANNED / DISABLED');
  });
});
