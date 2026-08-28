/**
 * AVG-10 — payment, activation and the Anisha handoff (ADR-0127).
 *
 * Two claims under test, and the second is the one the stage exists for.
 *
 * Aarohi can record that Core holds payment-follow-up context for an acquisition — and can do
 * nothing else about money: it cannot take a payment, record one, confirm one, create an order,
 * grant a credit or invent a payment state Core does not own.
 *
 * And **payment is not activation**. No payment fact, no provider receipt, no model reading, no
 * conversation claim and no local case state ends Aarohi's mandate. Only QuickFurno Core
 * authoritatively confirming ACTIVE, through `completeCoreActiveHandoff`, moves ownership to Anisha
 * — and this stage adds no second route to it.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  AAROHI_AVG10_CONTRACT_VERSION,
  AAROHI_AVG10_PAYMENT_SOURCE_POSTURE,
  AAROHI_PAYMENT_FOLLOWUP_POSTURE,
  ACQUISITION_CASE_STATES,
  ACQUISITION_CASE_TRANSITIONS,
  ACTIVATION_AUTHORITIES,
  CORE_PARTY_STATUSES,
  CORE_PAYMENT_CONTEXT_AVAILABILITIES,
  CORE_PAYMENT_FOLLOWUP_OUTCOME,
  CORE_STATUS_ROLE,
  ELIGIBLE_CORE_STATUSES,
  HANDOFF_REJECTED_AUTHORITIES,
  HANDOFF_TRUSTED_AUTHORITY,
  PAYMENT_FOLLOWUP_REFUSALS,
  TERMINAL_ACQUISITION_CASE_STATES,
  aarohiPaymentFollowupBriefSchema,
  aarohiPaymentFollowupPostureSchema,
  appendInstagramInboundObservation,
  canTransition,
  completeCoreActiveHandoff,
  corePaymentFollowupContextSchema,
  createAarohiSalesBrainInterpretation,
  createCorePaymentFollowupContext,
  createInstagramConversation,
  evaluateAarohiSalesTurn,
  openAcquisitionCase,
  parseAarohiPaymentFollowupBrief,
  parseCorePaymentFollowupContext,
  parseInstagramInboundObservation,
  prepareAarohiPaymentFollowupBrief,
  transitionAcquisitionCase,
} from '../index.js';
import type {
  AarohiSalesBrainInterpretation,
  AarohiSalesConversationIntent,
  AarohiSalesObjectionKind,
  AarohiSalesTurnPlan,
  AcquisitionCase,
  CorePartyStatus,
  CorePaymentFollowupContext,
  InstagramConversationSnapshot,
} from '../index.js';

const SRC = fileURLToPath(new URL('../', import.meta.url));

/** Widened to `string` so instant comparisons in the specs are evaluated rather than folded. */
function canonicalInstant(value: string): string {
  return value;
}

const PROSPECT = 'prospect.avg10.alpha';
const CONVERSATION = 'ig.conversation.alpha';
const THREAD = 'ig.thread.alpha';
const IG_PARTICIPANT = 'ig.participant.alpha';
const MESSAGE = 'ig.message.001';
const LOOKUP = 'core.lookup.alpha';
const CASE = 'case.avg10.alpha';

const AT = '2026-08-28T09:00:00Z';
const INTERPRETED = '2026-08-28T09:05:00Z';
const PLANNED = '2026-08-28T09:10:00Z';
const OBSERVED = '2026-08-28T09:15:00Z';
const PREPARED = '2026-08-28T09:20:00Z';

/** Core's own payment-follow-up material, named opaquely. Never read, never followed. */
const CORE_PAYMENT = 'core.payment.context.v2';

// ===========================================================================
// Fixtures.
// ===========================================================================

function conversationWith(
  turns: readonly { readonly ref: string; readonly at: string }[],
  prospectRef: string = PROSPECT,
): InstagramConversationSnapshot {
  const built = createInstagramConversation({
    prospectRef,
    instagramConversationRef: CONVERSATION,
    instagramThreadRef: THREAD,
    instagramParticipantRef: IG_PARTICIPANT,
  });
  if (!built.ok) throw new Error(`conversation fixture refused: ${built.refusal}`);

  let snapshot = built.conversation;
  for (const turn of turns) {
    const observed = parseInstagramInboundObservation({
      prospectRef,
      instagramConversationRef: CONVERSATION,
      instagramThreadRef: THREAD,
      instagramParticipantRef: IG_PARTICIPANT,
      instagramMessageRef: turn.ref,
      body: 'I want to pay and go live. How does that work?',
      observedAt: turn.at,
    });
    if (!observed.ok) throw new Error(`turn fixture refused: ${observed.refusal}`);
    const appended = appendInstagramInboundObservation(snapshot, observed.observation);
    if (!appended.ok) throw new Error(`append refused: ${appended.refusal}`);
    snapshot = appended.conversation;
  }
  return snapshot;
}

const CONVERSATION_FIXTURE = conversationWith([{ ref: MESSAGE, at: AT }]);

/** The same conversation after a newer turn arrives. Every earlier reading is now stale. */
const CONVERSATION_MOVED_ON = conversationWith([
  { ref: MESSAGE, at: AT },
  { ref: 'ig.message.002', at: '2026-08-28T09:02:00Z' },
]);

function interpretation(
  intent: AarohiSalesConversationIntent = 'PAYMENT_OR_ACTIVATION',
  objectionKind: AarohiSalesObjectionKind = 'NONE',
  conversation: InstagramConversationSnapshot = CONVERSATION_FIXTURE,
): AarohiSalesBrainInterpretation {
  const built = createAarohiSalesBrainInterpretation({
    interpretationRef: 'interp.001',
    conversation,
    intent,
    objectionKind,
    interpretedAt: INTERPRETED,
  });
  if (!built.ok) throw new Error(`interpretation fixture refused: ${built.refusal}`);
  return built.interpretation;
}

function observation(
  status: CorePartyStatus = 'NOT_REGISTERED',
  over: Record<string, unknown> = {},
): unknown {
  return { prospectRef: PROSPECT, coreLookupRef: LOOKUP, status, ...over };
}

/** An honestly evaluated AVG-7 plan for the given signals. */
function salesPlan(
  intent: AarohiSalesConversationIntent = 'PAYMENT_OR_ACTIVATION',
  objectionKind: AarohiSalesObjectionKind = 'NONE',
): AarohiSalesTurnPlan {
  const built = evaluateAarohiSalesTurn({
    planRef: 'plan.alpha',
    conversation: CONVERSATION_FIXTURE,
    interpretation: interpretation(intent, objectionKind),
    coreObservation: observation(),
    plannedAt: PLANNED,
  });
  if (!built.ok) throw new Error(`plan fixture refused: ${built.refusal}`);
  return built.plan;
}

function paymentContextInput(over: Record<string, unknown> = {}): Record<string, unknown> {
  const merged: Record<string, unknown> = {
    paymentContextRef: 'payment.ctx.alpha',
    prospectRef: PROSPECT,
    coreLookupRef: LOOKUP,
    availability: 'CORE_AUTHORED_PAYMENT_CONTEXT_AVAILABLE',
    corePaymentContextRef: CORE_PAYMENT,
    observedAt: OBSERVED,
    ...over,
  };
  // An explicit `undefined` DROPS the key rather than stating it: a strict discriminated union
  // refuses a key the chosen variant does not declare whatever its value.
  return Object.fromEntries(Object.entries(merged).filter(([, value]) => value !== undefined));
}

function paymentContext(over: Record<string, unknown> = {}): CorePaymentFollowupContext {
  const built = createCorePaymentFollowupContext(paymentContextInput(over));
  if (!built.ok) throw new Error(`payment context fixture refused: ${built.refusal}`);
  return built.paymentContext;
}

function briefInput(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    briefRef: 'brief.alpha',
    conversation: CONVERSATION_FIXTURE,
    interpretation: interpretation(),
    coreObservation: observation(),
    salesPlan: salesPlan(),
    paymentContext: paymentContext(),
    preparedAt: PREPARED,
    ...over,
  };
}

/** A case sitting exactly at the handoff boundary. Built directly: no transition reaches it. */
function caseAwaitingActivation(prospectRef = PROSPECT): AcquisitionCase {
  return Object.freeze({
    caseRef: CASE,
    prospectRef,
    state: 'AWAITING_CORE_ACTIVATION' as const,
  });
}

function attestation(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    prospectRef: PROSPECT,
    coreAttestationRef: 'core.attestation.alpha',
    authority: 'QUICKFURNO_CORE',
    active: true,
    ...over,
  };
}

/** A copy of an object without one key. Rebuilt rather than deleted from. */
function without(value: object, dropped: string): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([key]) => key !== dropped));
}

/** Every key of an object, however deep. */
function walkKeys(value: unknown): readonly string[] {
  if (Array.isArray(value)) return value.flatMap(walkKeys);
  if (typeof value === 'object' && value !== null) {
    return Object.entries(value).flatMap(([key, nested]) => [key, ...walkKeys(nested)]);
  }
  return [];
}

/** Every string leaf, paired with the key that holds it. */
function walkStringEntries(value: unknown): readonly (readonly [string, string])[] {
  if (typeof value !== 'object' || value === null) return [];
  return Object.entries(value).flatMap(([key, nested]) =>
    typeof nested === 'string' ? [[key, nested] as const] : walkStringEntries(nested),
  );
}

const avg10Source = (): string =>
  readFileSync(join(SRC, 'contracts', 'avg10-payment-activation-handoff.ts'), 'utf8');

const codeOnly = (text: string): string =>
  text
    .replace(/\/\*[\s\S]*?\*\//gu, '')
    .split('\n')
    .filter((line) => !/^\s*\/\//u.test(line))
    .join('\n');

// ===========================================================================
// A. The base contract.
// ===========================================================================

describe('AVG-10 carries a reference to Core payment context, never a payment', () => {
  it('is version 1, and names the observation for what it is', () => {
    expect(AAROHI_AVG10_CONTRACT_VERSION).toBe(1);
    expect(AAROHI_AVG10_PAYMENT_SOURCE_POSTURE).toBe('INJECTED_OFFLINE_CORE_PAYMENT_CONTEXT');
    for (const forbidden of [
      'LIVE',
      'AUTHENTICATED',
      'PRODUCTION',
      'VERIFIED',
      'RECONCILED',
      'AUTHORITATIVE',
    ]) {
      expect(AAROHI_AVG10_PAYMENT_SOURCE_POSTURE, forbidden).not.toContain(forbidden);
    }
    expect(CORE_PAYMENT_FOLLOWUP_OUTCOME).toBe(
      'CORE_PAYMENT_FOLLOWUP_CONTEXT_READY_FOR_FUTURE_GOVERNED_ASSISTANCE',
    );
  });

  it('offers three availability tokens, and not one of them is a payment or activation state', () => {
    expect([...CORE_PAYMENT_CONTEXT_AVAILABILITIES]).toStrictEqual([
      'CORE_AUTHORED_PAYMENT_CONTEXT_AVAILABLE',
      'CORE_AUTHORED_PAYMENT_CONTEXT_UNAVAILABLE',
      'CORE_PAYMENT_CONTEXT_UNKNOWN',
    ]);
    // Availability, never state. QuickFurno's order rows carry `payment_status` and
    // `activation_status` as unconstrained free text nothing advances; a vocabulary mirroring them
    // would be a lifecycle Aarohi imagined.
    for (const one of CORE_PAYMENT_CONTEXT_AVAILABILITIES) {
      for (const forbidden of [
        'PAID',
        'PENDING',
        'FAILED',
        'REFUND',
        'SETTLED',
        'COMPLETED',
        'ACTIVE',
        'ACTIVATION',
        'READY',
        'DUE',
      ]) {
        expect(one, forbidden).not.toContain(forbidden);
      }
    }
  });

  it('accepts exactly the stated and stamped payment-context fields, read from the source', () => {
    const source = avg10Source();
    const stated = /const PAYMENT_CONTEXT_STATED_FIELDS = \{([\s\S]*?)\n\} as const;/u.exec(source);
    const stamped = /const PAYMENT_CONTEXT_STAMPED_FIELDS = \{([\s\S]*?)\n\} as const;/u.exec(
      source,
    );
    expect(stated).not.toBeNull();
    expect(stamped).not.toBeNull();
    expect(
      [...(stated?.[1] ?? '').matchAll(/^ {2}(\w+):/gmu)].map((match) => match[1]).sort(),
    ).toStrictEqual(['coreLookupRef', 'observedAt', 'paymentContextRef', 'prospectRef']);
    expect(
      [...(stamped?.[1] ?? '').matchAll(/^ {2}(\w+):/gmu)].map((match) => match[1]).sort(),
    ).toStrictEqual(['contractVersion', 'sourcePosture']);
  });

  it('accepts exactly seven brief input fields, so no override can be added quietly', () => {
    const block = /const paymentBriefInputSchema = z\s*\.object\(\{([\s\S]*?)\}\)/u.exec(
      avg10Source(),
    );
    expect(block).not.toBeNull();
    const fields = [...(block?.[1] ?? '').matchAll(/^ {4}(\w+):/gmu)].map((match) => match[1]);
    expect(fields.sort()).toStrictEqual([
      'briefRef',
      'conversation',
      'coreObservation',
      'interpretation',
      'paymentContext',
      'preparedAt',
      'salesPlan',
    ]);
  });

  it('locks the accepted key surface of a built payment context, in both directions', () => {
    const available = paymentContext();
    expect(Object.keys(available).sort()).toStrictEqual([
      'availability',
      'contractVersion',
      'coreLookupRef',
      'corePaymentContextRef',
      'observedAt',
      'paymentContextRef',
      'prospectRef',
      'sourcePosture',
    ]);
    for (const key of Object.keys(available)) {
      expect(corePaymentFollowupContextSchema.safeParse(without(available, key)).success, key).toBe(
        false,
      );
    }
    const absent = paymentContext({
      availability: 'CORE_AUTHORED_PAYMENT_CONTEXT_UNAVAILABLE',
      corePaymentContextRef: undefined,
    });
    expect(Object.keys(absent).sort()).toStrictEqual([
      'availability',
      'contractVersion',
      'coreLookupRef',
      'observedAt',
      'paymentContextRef',
      'prospectRef',
      'sourcePosture',
    ]);
  });

  it('locks the accepted key surface of a brief, in both directions', () => {
    const built = prepareAarohiPaymentFollowupBrief(briefInput());
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(Object.keys(built.brief).sort()).toStrictEqual([
      'briefRef',
      'contractVersion',
      'coreLookupRef',
      'corePaymentContextRef',
      'interpretationRef',
      'outcome',
      'paymentContextObservedAt',
      'paymentContextRef',
      'posture',
      'preparedAt',
      'prospectRef',
      'salesPlanRef',
    ]);
    for (const key of Object.keys(built.brief)) {
      expect(
        aarohiPaymentFollowupBriefSchema.safeParse(without(built.brief, key)).success,
        key,
      ).toBe(false);
    }
    // A key nobody reviewed cannot join either artifact — least of all one carrying money or
    // an activation claim.
    for (const extra of ['amountDue', 'paymentStatus', 'paidAt', 'active', 'authority', 'note']) {
      expect(
        aarohiPaymentFollowupBriefSchema.safeParse({ ...built.brief, [extra]: 'x' }).success,
        extra,
      ).toBe(false);
      expect(
        corePaymentFollowupContextSchema.safeParse({ ...paymentContext(), [extra]: 'x' }).success,
        extra,
      ).toBe(false);
    }
  });

  it('names thirteen refusals, and keeps materially different failures apart', () => {
    expect([...PAYMENT_FOLLOWUP_REFUSALS]).toStrictEqual([
      'PAYMENT_INPUT_INVALID',
      'SALES_PLAN_INVALID',
      'SALES_PLAN_NOT_REDERIVABLE',
      'SALES_PLAN_POLICY_MISMATCH',
      'SALES_PLAN_NOT_CORE_PROCESS_CONTEXT',
      'SALES_PLAN_NOT_PAYMENT_OR_ACTIVATION',
      'PAYMENT_CONTEXT_INVALID',
      'PAYMENT_CONTEXT_BINDING_MISMATCH',
      'CORE_PAYMENT_CONTEXT_NOT_AVAILABLE',
      'CORE_PAYMENT_CONTEXT_UNRESOLVED',
      'PAYMENT_CONTEXT_STALE_FOR_PLAN',
      'PAYMENT_BRIEF_BEFORE_PAYMENT_CONTEXT',
      'PAYMENT_BRIEF_INVALID',
    ]);
    expect(new Set(PAYMENT_FOLLOWUP_REFUSALS).size).toBe(PAYMENT_FOLLOWUP_REFUSALS.length);
  });

  it('imports nothing but zod and the two contracts it re-derives through', () => {
    const code = codeOnly(avg10Source());
    const imports = [...code.matchAll(/from '([^']+)'/gu)].map((match) => match[1]);
    // Note what is NOT here: `./active-handoff.js`. AVG-10 does not import, wrap or compose the
    // canonical handoff, which is the strongest form the "no second route" proof can take.
    expect(imports.sort()).toStrictEqual([
      './avg7-sales-brain.js',
      './avg7-sales-brain.js',
      './existing-vendor-gate.js',
      'zod',
    ]);
  });

  it('returns frozen, detached values', () => {
    const built = prepareAarohiPaymentFollowupBrief(briefInput());
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(Object.isFrozen(built)).toBe(true);
    expect(Object.isFrozen(built.brief)).toBe(true);
    expect(Object.isFrozen(built.brief.posture)).toBe(true);
    expect(Object.isFrozen(paymentContext())).toBe(true);

    const reparsed = parseAarohiPaymentFollowupBrief(built.brief);
    expect(reparsed).toBeDefined();
    expect(reparsed).not.toBe(built.brief);
    expect(reparsed).toStrictEqual(built.brief);
  });

  it('stamps the version and the posture, and refuses a caller who states them', () => {
    const context = paymentContext();
    expect(context.contractVersion).toBe(AAROHI_AVG10_CONTRACT_VERSION);
    expect(context.sourcePosture).toBe(AAROHI_AVG10_PAYMENT_SOURCE_POSTURE);

    for (const stated of [
      { contractVersion: 1 },
      { contractVersion: 2 },
      { sourcePosture: AAROHI_AVG10_PAYMENT_SOURCE_POSTURE },
      { sourcePosture: 'LIVE_CORE_READ' },
      { sourcePosture: 'AUTHENTICATED_CORE' },
      { sourcePosture: 'PRODUCTION_VERIFIED' },
    ]) {
      const built = createCorePaymentFollowupContext({ ...paymentContextInput(), ...stated });
      expect(built.ok, JSON.stringify(stated)).toBe(false);
      if (!built.ok) expect(built.refusal).toBe('PAYMENT_INPUT_INVALID');
    }
  });

  it('refuses a payment context that names a reference it says Core does not hold', () => {
    for (const availability of [
      'CORE_AUTHORED_PAYMENT_CONTEXT_UNAVAILABLE',
      'CORE_PAYMENT_CONTEXT_UNKNOWN',
    ]) {
      const built = createCorePaymentFollowupContext(paymentContextInput({ availability }));
      expect(built.ok, availability).toBe(false);
    }
  });

  it('rebuilds a parsed observation rather than trusting the object it was shown', () => {
    expect(parseCorePaymentFollowupContext(paymentContext())).toBeDefined();
    expect(parseCorePaymentFollowupContext({ ...paymentContext(), rogue: 1 })).toBeUndefined();
    expect(Object.isFrozen(parseCorePaymentFollowupContext(paymentContext()))).toBe(true);
  });
});

// ===========================================================================
// B. Routing. AVG-9 holds the other side of the same door.
// ===========================================================================

describe('only a payment-or-activation question reaches AVG-10', () => {
  it('prepares a brief from an honest payment-or-activation plan', () => {
    const built = prepareAarohiPaymentFollowupBrief(briefInput());
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.brief.outcome).toBe(CORE_PAYMENT_FOLLOWUP_OUTCOME);
    expect(built.brief.prospectRef).toBe(PROSPECT);
    expect(built.brief.salesPlanRef).toBe('plan.alpha');
    expect(built.brief.interpretationRef).toBe('interp.001');
    expect(built.brief.coreLookupRef).toBe(LOOKUP);
    expect(built.brief.corePaymentContextRef).toBe(CORE_PAYMENT);
    expect(built.brief.paymentContextObservedAt).toBe(OBSERVED);
  });

  it('refuses REGISTRATION_PROCESS even though it reaches the same AVG-7 strategy', () => {
    // The mirror image of AVG-9's spec, and the reason both stages check the INTENT. AVG-7 routes
    // registration and payment/activation to one strategy; the two stages hold that door from
    // opposite sides, and a strategy check alone would let each do the other's work.
    const plan = salesPlan('REGISTRATION_PROCESS');
    expect(plan.brief.strategy).toBe('REQUEST_CORE_PROCESS_CONTEXT');
    expect(plan.brief.intent).toBe('REGISTRATION_PROCESS');

    const built = prepareAarohiPaymentFollowupBrief(
      briefInput({
        interpretation: interpretation('REGISTRATION_PROCESS'),
        salesPlan: plan,
      }),
    );
    expect(built.ok).toBe(false);
    if (built.ok) return;
    expect(built.refusal).toBe('SALES_PLAN_NOT_PAYMENT_OR_ACTIVATION');
  });

  it('refuses every other strategy, and says which boundary was crossed', () => {
    const cases: readonly {
      readonly intent: AarohiSalesConversationIntent;
      readonly objectionKind: AarohiSalesObjectionKind;
      readonly strategy: string;
    }[] = [
      {
        intent: 'GENERAL_INFORMATION',
        objectionKind: 'NONE',
        strategy: 'PREPARE_NONCOMMERCIAL_REPLY_BRIEF',
      },
      {
        intent: 'LEAD_QUALITY',
        objectionKind: 'NONE',
        strategy: 'PREPARE_NONCOMMERCIAL_REPLY_BRIEF',
      },
      {
        intent: 'OTHER_OR_UNCLEAR',
        objectionKind: 'NONE',
        strategy: 'PREPARE_CLARIFYING_REPLY_BRIEF',
      },
      {
        intent: 'COMMERCIAL_TERMS',
        objectionKind: 'NONE',
        strategy: 'REQUEST_CORE_COMMERCIAL_CONTEXT',
      },
      {
        intent: 'REJECTION_OR_STOP',
        objectionKind: 'NONE',
        strategy: 'REQUEST_CORE_CONTACT_POLICY_REVIEW',
      },
      { intent: 'GENERAL_INFORMATION', objectionKind: 'OTHER', strategy: 'REQUEST_HUMAN_REVIEW' },
    ];

    for (const one of cases) {
      const plan = salesPlan(one.intent, one.objectionKind);
      expect(plan.brief.strategy, one.intent).toBe(one.strategy);
      const built = prepareAarohiPaymentFollowupBrief(
        briefInput({
          interpretation: interpretation(one.intent, one.objectionKind),
          salesPlan: plan,
        }),
      );
      expect(built.ok, one.intent).toBe(false);
      if (built.ok) continue;
      expect(built.refusal, one.intent).toBe('SALES_PLAN_NOT_CORE_PROCESS_CONTEXT');
    }
  });

  it('refuses a payment question that a contact-risk or commercial signal outranks', () => {
    // AVG-7's precedence, inherited whole. Somebody asking about paying who also asks not to be
    // contacted is asking not to be contacted; a price objection alongside stops at Core commercial
    // context. Neither reaches a payment-follow-up brief.
    for (const objectionKind of ['PRIVACY_OR_CONTACT', 'PRICE_OR_PACKAGE'] as const) {
      const plan = salesPlan('PAYMENT_OR_ACTIVATION', objectionKind);
      expect(plan.brief.strategy, objectionKind).not.toBe('REQUEST_CORE_PROCESS_CONTEXT');
      const built = prepareAarohiPaymentFollowupBrief(
        briefInput({
          interpretation: interpretation('PAYMENT_OR_ACTIVATION', objectionKind),
          salesPlan: plan,
        }),
      );
      expect(built.ok, objectionKind).toBe(false);
      if (built.ok) continue;
      expect(built.refusal, objectionKind).toBe('SALES_PLAN_NOT_CORE_PROCESS_CONTEXT');
    }
  });
});

// ===========================================================================
// C / D. The CURRENT turn, and re-derivation.
// ===========================================================================

describe('the AVG-7 plan is re-derived from scratch, never believed', () => {
  it('refuses a reading of a turn that is no longer the latest', () => {
    const built = prepareAarohiPaymentFollowupBrief(
      briefInput({ conversation: CONVERSATION_MOVED_ON }),
    );
    expect(built.ok).toBe(false);
    if (built.ok) return;
    expect(built.refusal).toBe('SALES_PLAN_NOT_REDERIVABLE');
    if (built.refusal !== 'SALES_PLAN_NOT_REDERIVABLE') return;
    expect(built.salesRefusal).toBe('INTERPRETATION_NOT_FOR_LATEST_TURN');
  });

  it('refuses an interpretation bound to another prospect, conversation, thread or participant', () => {
    for (const field of [
      'prospectRef',
      'instagramConversationRef',
      'instagramThreadRef',
      'instagramParticipantRef',
    ]) {
      const built = prepareAarohiPaymentFollowupBrief(
        briefInput({ interpretation: { ...interpretation(), [field]: 'other.handle' } }),
      );
      expect(built.ok, field).toBe(false);
      if (built.ok) continue;
      expect(built.refusal, field).toBe('SALES_PLAN_NOT_REDERIVABLE');
      if (built.refusal !== 'SALES_PLAN_NOT_REDERIVABLE') continue;
      expect(built.salesRefusal, field).toBe('INTERPRETATION_BINDING_MISMATCH');
    }
  });

  it('refuses a malformed plan as a shape failure, apart from every provenance failure', () => {
    for (const forged of [
      undefined,
      {},
      { planRef: 'plan.alpha' },
      { ...salesPlan(), coreStatus: 'ACTIVE' },
      { ...salesPlan(), brief: { ...salesPlan().brief, requiresCoreProcessContext: false } },
      { ...salesPlan(), extraField: 'x' },
    ]) {
      const built = prepareAarohiPaymentFollowupBrief(briefInput({ salesPlan: forged }));
      expect(built.ok, JSON.stringify(forged)).toBe(false);
      if (built.ok) continue;
      expect(built.refusal, JSON.stringify(forged)).toBe('SALES_PLAN_INVALID');
    }
  });

  it('refuses a well-formed plan the CURRENT evidence does not reproduce', () => {
    for (const field of [
      'prospectRef',
      'instagramConversationRef',
      'instagramThreadRef',
      'instagramParticipantRef',
      'instagramMessageRef',
      'interpretationRef',
      'coreLookupRef',
    ]) {
      const built = prepareAarohiPaymentFollowupBrief(
        briefInput({ salesPlan: { ...salesPlan(), [field]: 'forged.handle' } }),
      );
      expect(built.ok, field).toBe(false);
      if (built.ok) continue;
      expect(built.refusal, field).toBe('SALES_PLAN_POLICY_MISMATCH');
    }
  });

  it('refuses a plan wearing another turn’s brief, even a perfectly consistent one', () => {
    // Both plans carry strategy REQUEST_CORE_PROCESS_CONTEXT and identical top-level fields; only
    // the nested brief differs, and AVG-7's plan schema cannot object because the brief is
    // internally consistent. Only re-deriving and comparing the whole artifact catches it — which
    // makes a strategy-only comparison provably insufficient at this boundary too.
    const payment = salesPlan('PAYMENT_OR_ACTIVATION');
    const registration = salesPlan('REGISTRATION_PROCESS');
    expect(payment.brief.strategy).toBe(registration.brief.strategy);

    const disguised = { ...registration, brief: payment.brief };
    const built = prepareAarohiPaymentFollowupBrief(
      briefInput({
        interpretation: interpretation('REGISTRATION_PROCESS'),
        salesPlan: disguised,
      }),
    );
    expect(built.ok).toBe(false);
    if (built.ok) return;
    expect(built.refusal).toBe('SALES_PLAN_POLICY_MISMATCH');

    const swapped = { ...payment, brief: registration.brief };
    const other = prepareAarohiPaymentFollowupBrief(briefInput({ salesPlan: swapped }));
    expect(other.ok).toBe(false);
    if (other.ok) return;
    expect(other.refusal).toBe('SALES_PLAN_POLICY_MISMATCH');
  });

  it('compares the whole artifact structurally, and reads the derived values', () => {
    const source = codeOnly(avg10Source());
    expect(source).toContain('function sameCanonicalValue');
    expect(source).toContain('if (!sameSalesTurnPlan(reDerived.plan, suppliedPlan))');
    expect(source).toContain("if (reDerived.plan.brief.intent !== 'PAYMENT_OR_ACTIVATION')");
    // No enumerated field list, and the supplied plan is never the one read for a decision.
    expect(source).not.toContain('left.instagramThreadRef === right.instagramThreadRef');
    expect(source).not.toContain('suppliedPlan.brief.intent');
    expect(source).not.toContain('suppliedPlan.brief.strategy');
  });

  it('gives the caller no way to state a payment, an outcome or a posture', () => {
    for (const forged of [
      { paymentStatus: 'Paid' },
      { paid: true },
      { amount: 4999 },
      { transactionId: 'txn-1' },
      { provider: 'someprovider' },
      { outcome: CORE_PAYMENT_FOLLOWUP_OUTCOME },
      { posture: AAROHI_PAYMENT_FOLLOWUP_POSTURE },
      { attestation: attestation() },
      { acquisitionCase: caseAwaitingActivation() },
      { skipRederivation: true },
    ]) {
      const built = prepareAarohiPaymentFollowupBrief(briefInput(forged));
      expect(built.ok, JSON.stringify(forged)).toBe(false);
      if (built.ok) continue;
      expect(built.refusal, JSON.stringify(forged)).toBe('PAYMENT_INPUT_INVALID');
    }
  });

  it('does not rewrite the AVG-7 plan it rested on', () => {
    const plan = salesPlan();
    expect(prepareAarohiPaymentFollowupBrief(briefInput({ salesPlan: plan })).ok).toBe(true);
    expect(plan.brief.requiresCoreProcessContext).toBe(true);
    expect(plan.brief.futureModelDraftEligible).toBe(false);
    expect(plan.posture.paymentMutated).toBe(false);
    expect(plan.posture.activationMutated).toBe(false);
  });
});

// ===========================================================================
// The CURRENT Core gate, unchanged and unwidened.
// ===========================================================================

describe('the CURRENT Core gate runs again, and the cold gate is not widened', () => {
  it('drives every governed Core status through the brief builder', () => {
    for (const status of CORE_PARTY_STATUSES) {
      const built = prepareAarohiPaymentFollowupBrief(
        briefInput({ coreObservation: observation(status) }),
      );
      if (status === 'NOT_REGISTERED') {
        expect(built.ok, status).toBe(true);
        continue;
      }
      expect(built.ok, status).toBe(false);
      if (built.ok) continue;
      expect(built.refusal, status).toBe('SALES_PLAN_NOT_REDERIVABLE');
      if (built.refusal !== 'SALES_PLAN_NOT_REDERIVABLE') continue;
      expect(built.salesRefusal, status).toBe('CORE_GATE_REFUSED');
      if (built.salesRefusal !== 'CORE_GATE_REFUSED') continue;
      const role = CORE_STATUS_ROLE[status];
      const expected =
        role === 'EXISTING_RELATIONSHIP'
          ? 'EXISTING_CORE_RELATIONSHIP'
          : role === 'SUPPRESSED'
            ? 'CORE_SUPPRESSED'
            : 'CORE_TRUTH_UNRESOLVED';
      expect(built.coreReason, status).toBe(expected);
    }
  });

  it('leaves the cold-acquisition allowlist at exactly one status', () => {
    // The load-bearing distinction. AVG-10 does NOT solve post-registration continuation by making
    // REGISTERED eligible to cold-acquire; ADR-0127 records that the continuation boundary does not
    // exist yet and that this stage did not invent one.
    expect([...ELIGIBLE_CORE_STATUSES]).toStrictEqual(['NOT_REGISTERED']);
    expect(CORE_STATUS_ROLE.REGISTERED).toBe('EXISTING_RELATIONSHIP');
    expect(CORE_STATUS_ROLE.ACTIVE).toBe('EXISTING_RELATIONSHIP');
    const code = codeOnly(avg10Source());
    for (const forbidden of [
      'ELIGIBLE_CORE_STATUSES',
      'CORE_STATUS_ROLE',
      'BLOCKED_CORE_STATUSES',
      'evaluateAcquisitionEligibility',
    ]) {
      expect(code, `AVG-10 must not touch ${forbidden}`).not.toContain(forbidden);
    }
  });

  it('refuses an observation about another prospect, and a malformed one', () => {
    for (const forged of [
      observation('NOT_REGISTERED', { prospectRef: 'prospect.other' }),
      { prospectRef: PROSPECT, status: 'NOT_REGISTERED' },
      { prospectRef: PROSPECT, coreLookupRef: LOOKUP, status: 'MADE_UP' },
      undefined,
    ]) {
      const built = prepareAarohiPaymentFollowupBrief(briefInput({ coreObservation: forged }));
      expect(built.ok, JSON.stringify(forged)).toBe(false);
      if (built.ok) continue;
      expect(built.refusal).toBe('SALES_PLAN_NOT_REDERIVABLE');
      if (built.refusal !== 'SALES_PLAN_NOT_REDERIVABLE') continue;
      expect(built.salesRefusal).toBe('CORE_GATE_REFUSED');
      if (built.salesRefusal !== 'CORE_GATE_REFUSED') continue;
      expect(built.coreReason).toBe('OBSERVATION_INVALID');
    }
  });
});

// ===========================================================================
// D. Payment context.
// ===========================================================================

describe('Core payment context is carried by reference, and never invented', () => {
  it('refuses a malformed observation', () => {
    for (const forged of [
      undefined,
      {},
      { paymentContextRef: 'payment.ctx.alpha' },
      { ...paymentContext(), availability: 'CORE_PAYMENT_CONTEXT_PAID' },
      { ...paymentContext(), observedAt: 'yesterday' },
      { ...paymentContext(), sourcePosture: 'LIVE_CORE_READ' },
      { ...paymentContext(), contractVersion: 2 },
    ]) {
      const built = prepareAarohiPaymentFollowupBrief(briefInput({ paymentContext: forged }));
      expect(built.ok, JSON.stringify(forged)).toBe(false);
      if (built.ok) continue;
      expect(built.refusal, JSON.stringify(forged)).toBe('PAYMENT_CONTEXT_INVALID');
    }
  });

  it('refuses an observation bound to another prospect or another Core lookup', () => {
    for (const over of [
      { prospectRef: 'prospect.other' },
      { coreLookupRef: 'core.lookup.other' },
    ]) {
      const built = prepareAarohiPaymentFollowupBrief(
        briefInput({ paymentContext: paymentContext(over) }),
      );
      expect(built.ok, JSON.stringify(over)).toBe(false);
      if (built.ok) continue;
      expect(built.refusal, JSON.stringify(over)).toBe('PAYMENT_CONTEXT_BINDING_MISMATCH');
    }
  });

  it('refuses to guess when Core holds no payment context, and says which absence it was', () => {
    for (const one of [
      {
        availability: 'CORE_AUTHORED_PAYMENT_CONTEXT_UNAVAILABLE',
        refusal: 'CORE_PAYMENT_CONTEXT_NOT_AVAILABLE',
      },
      {
        availability: 'CORE_PAYMENT_CONTEXT_UNKNOWN',
        refusal: 'CORE_PAYMENT_CONTEXT_UNRESOLVED',
      },
    ]) {
      const built = prepareAarohiPaymentFollowupBrief(
        briefInput({
          paymentContext: paymentContext({
            availability: one.availability,
            corePaymentContextRef: undefined,
          }),
        }),
      );
      expect(built.ok, one.availability).toBe(false);
      if (built.ok) continue;
      expect(built.refusal, one.availability).toBe(one.refusal);
    }
  });

  it('has nowhere to put an amount, a transaction, a provider or a payment state', () => {
    for (const forged of [
      { amount: 4999 },
      { currency: 'INR' },
      { paymentStatus: 'Paid' },
      { activationStatus: 'activated' },
      { paidAt: OBSERVED },
      { activatedAt: OBSERVED },
      { orderId: 'ord-1' },
      { transactionId: 'txn-1' },
      { providerPaymentId: 'pay-1' },
      { paymentMethod: 'manual' },
      { packageId: 'pkg-1' },
      { creditsIncluded: 25 },
      { active: true },
      { authority: 'QUICKFURNO_CORE' },
      { coreAttestationRef: 'core.attestation.alpha' },
    ]) {
      const built = createCorePaymentFollowupContext({ ...paymentContextInput(), ...forged });
      expect(built.ok, JSON.stringify(forged)).toBe(false);
      if (built.ok) continue;
      expect(built.refusal, JSON.stringify(forged)).toBe('PAYMENT_INPUT_INVALID');
    }
  });

  it('screens the references AVG-10 invents, and leaves inherited grammars alone', () => {
    // A pay-here link is the shape that matters most in this domain, and it is refused by SHAPE
    // rather than by a list of provider names.
    for (const forged of [
      'www.quickfurno.com',
      'quickfurno.com/pay',
      'billing@quickfurno.co',
      '919812345678',
      '4111111111111111',
      '9_1_9_8_1_2_3_4_5_6_7_8',
    ]) {
      expect(
        createCorePaymentFollowupContext(paymentContextInput({ corePaymentContextRef: forged })).ok,
        forged,
      ).toBe(false);
      expect(prepareAarohiPaymentFollowupBrief(briefInput({ briefRef: forged })).ok, forged).toBe(
        false,
      );
    }

    // An INHERITED reference keeps the grammar its owner certified. Narrowing it here would be a
    // downstream stage re-judging a grammar it does not own — ADR-0124's correction.
    for (const token of ['919812345678', 'www.example.com']) {
      const conversation = conversationWith([{ ref: MESSAGE, at: AT }], token);
      const reading = createAarohiSalesBrainInterpretation({
        interpretationRef: 'interp.001',
        conversation,
        intent: 'PAYMENT_OR_ACTIVATION',
        objectionKind: 'NONE',
        interpretedAt: INTERPRETED,
      });
      expect(reading.ok, token).toBe(true);
      if (!reading.ok) continue;
      const coreObservation = {
        prospectRef: token,
        coreLookupRef: token,
        status: 'NOT_REGISTERED',
      };
      const plan = evaluateAarohiSalesTurn({
        planRef: 'plan.alpha',
        conversation,
        interpretation: reading.interpretation,
        coreObservation,
        plannedAt: PLANNED,
      });
      expect(plan.ok, token).toBe(true);
      if (!plan.ok) continue;
      const built = prepareAarohiPaymentFollowupBrief({
        briefRef: 'brief.alpha',
        conversation,
        interpretation: reading.interpretation,
        coreObservation,
        salesPlan: plan.plan,
        paymentContext: paymentContext({ prospectRef: token, coreLookupRef: token }),
        preparedAt: PREPARED,
      });
      expect(built.ok, token).toBe(true);
      if (!built.ok) continue;
      expect(built.brief.prospectRef, token).toBe(token);
      expect(built.brief.coreLookupRef, token).toBe(token);
    }
  });
});

// ===========================================================================
// H. Causality.
// ===========================================================================

describe('the causal chain holds, by instant and never by spelling', () => {
  it('accepts the whole chain, message to brief', () => {
    const built = prepareAarohiPaymentFollowupBrief(briefInput());
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const chain = [AT, INTERPRETED, PLANNED, OBSERVED, PREPARED].map((one) => Date.parse(one));
    expect(chain).toStrictEqual([...chain].sort((left, right) => left - right));
    expect(Date.parse(built.brief.paymentContextObservedAt)).toBeGreaterThanOrEqual(
      Date.parse(PLANNED),
    );
    expect(Date.parse(built.brief.preparedAt)).toBeGreaterThanOrEqual(
      Date.parse(built.brief.paymentContextObservedAt),
    );
  });

  it('refuses a payment-context observation older than the plan that asked for it', () => {
    const built = prepareAarohiPaymentFollowupBrief(
      briefInput({ paymentContext: paymentContext({ observedAt: '2026-08-28T09:09:59Z' }) }),
    );
    expect(built.ok).toBe(false);
    if (built.ok) return;
    expect(built.refusal).toBe('PAYMENT_CONTEXT_STALE_FOR_PLAN');
  });

  it('allows the same instant and any instant after it', () => {
    for (const observedAt of [PLANNED, '2026-08-28T09:10:00.000Z', '2026-08-28T09:10:00.001Z']) {
      expect(
        prepareAarohiPaymentFollowupBrief(
          briefInput({ paymentContext: paymentContext({ observedAt }) }),
        ).ok,
        observedAt,
      ).toBe(true);
    }
  });

  it('refuses a brief that claims to predate its own payment-context observation', () => {
    const built = prepareAarohiPaymentFollowupBrief(
      briefInput({ preparedAt: '2026-08-28T09:14:59Z' }),
    );
    expect(built.ok).toBe(false);
    if (built.ok) return;
    expect(built.refusal).toBe('PAYMENT_BRIEF_BEFORE_PAYMENT_CONTEXT');

    for (const preparedAt of [OBSERVED, '2026-08-28T09:15:00.000Z']) {
      expect(prepareAarohiPaymentFollowupBrief(briefInput({ preparedAt })).ok, preparedAt).toBe(
        true,
      );
    }
  });

  it('compares the instant a timestamp MEANS, not the way it is spelled', () => {
    const late = canonicalInstant('2026-08-28T09:10:00.500Z');
    const early = canonicalInstant('2026-08-28T09:10:00Z');
    expect(late < early).toBe(true);
    expect(Date.parse(late)).toBeGreaterThan(Date.parse(early));

    const planned = evaluateAarohiSalesTurn({
      planRef: 'plan.alpha',
      conversation: CONVERSATION_FIXTURE,
      interpretation: interpretation(),
      coreObservation: observation(),
      plannedAt: late,
    });
    expect(planned.ok).toBe(true);
    if (!planned.ok) return;

    const built = prepareAarohiPaymentFollowupBrief(
      briefInput({
        salesPlan: planned.plan,
        paymentContext: paymentContext({ observedAt: early }),
      }),
    );
    expect(built.ok).toBe(false);
    if (built.ok) return;
    expect(built.refusal).toBe('PAYMENT_CONTEXT_STALE_FOR_PLAN');
  });

  it('inherits both earlier links of the chain from AVG-7, in both wrong directions', () => {
    const beforeMessage = prepareAarohiPaymentFollowupBrief(
      briefInput({
        interpretation: { ...interpretation(), interpretedAt: '2026-08-28T08:59:59Z' },
      }),
    );
    expect(beforeMessage.ok).toBe(false);
    if (beforeMessage.ok) return;
    expect(beforeMessage.refusal).toBe('SALES_PLAN_NOT_REDERIVABLE');
    if (beforeMessage.refusal !== 'SALES_PLAN_NOT_REDERIVABLE') return;
    expect(beforeMessage.salesRefusal).toBe('INTERPRETATION_BEFORE_MESSAGE');

    const beforeInterpretation = prepareAarohiPaymentFollowupBrief(
      briefInput({ salesPlan: { ...salesPlan(), plannedAt: '2026-08-28T09:04:59Z' } }),
    );
    expect(beforeInterpretation.ok).toBe(false);
    if (beforeInterpretation.ok) return;
    expect(beforeInterpretation.refusal).toBe('SALES_PLAN_NOT_REDERIVABLE');
    if (beforeInterpretation.refusal !== 'SALES_PLAN_NOT_REDERIVABLE') return;
    expect(beforeInterpretation.salesRefusal).toBe('PLAN_BEFORE_INTERPRETATION');
  });

  it('refuses a hand-built brief that predates its own observation, at the parser too', () => {
    const built = prepareAarohiPaymentFollowupBrief(briefInput());
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(
      parseAarohiPaymentFollowupBrief({ ...built.brief, preparedAt: '2026-08-28T09:14:59Z' }),
    ).toBeUndefined();
    for (const preparedAt of [OBSERVED, '2026-08-28T09:15:00.000Z']) {
      expect(
        parseAarohiPaymentFollowupBrief({ ...built.brief, preparedAt }),
        preparedAt,
      ).toBeDefined();
    }
  });

  it('refuses a timestamp that is not a real instant', () => {
    for (const instant of [
      '2026-02-30T09:15:00Z',
      '2026-08-28T25:00:00Z',
      '2026-08-28 09:15:00Z',
      '2026-08-28T09:15:00+05:30',
    ]) {
      expect(
        createCorePaymentFollowupContext(paymentContextInput({ observedAt: instant })).ok,
        instant,
      ).toBe(false);
      expect(
        prepareAarohiPaymentFollowupBrief(briefInput({ preparedAt: instant })).ok,
        instant,
      ).toBe(false);
    }
  });
});

// ===========================================================================
// E / F. Core authority. PAYMENT IS NOT ACTIVATION.
// ===========================================================================

describe('payment is not activation, and the brief cannot pretend otherwise', () => {
  it('is not an activation attestation, and cannot be used as one', () => {
    // The single most important spec in this file. A payment-follow-up brief handed to the canonical
    // handoff in place of a Core attestation is refused as a malformed attestation — it has no
    // `authority`, no `active` and no `coreAttestationRef`, and there is nothing to add that would
    // make it one.
    const built = prepareAarohiPaymentFollowupBrief(briefInput());
    expect(built.ok).toBe(true);
    if (!built.ok) return;

    const handoff = completeCoreActiveHandoff(caseAwaitingActivation(), built.brief);
    expect(handoff.ok).toBe(false);
    if (handoff.ok) return;
    expect(handoff.reason).toBe('ATTESTATION_INVALID');

    const keys = new Set(walkKeys(built.brief));
    for (const forbidden of ['authority', 'active', 'coreAttestationRef', 'attestation', 'state']) {
      expect(keys.has(forbidden), forbidden).toBe(false);
    }
  });

  it('cannot be turned into an attestation by adding what it lacks', () => {
    const built = prepareAarohiPaymentFollowupBrief(briefInput());
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    // Even decorated with an authority and an active flag, the brief's own extra keys make it a
    // non-attestation: the attestation schema is strict and knows four fields.
    const dressed = { ...built.brief, authority: 'QUICKFURNO_CORE', active: true };
    const handoff = completeCoreActiveHandoff(caseAwaitingActivation(), dressed);
    expect(handoff.ok).toBe(false);
    if (handoff.ok) return;
    expect(handoff.reason).toBe('ATTESTATION_INVALID');
  });

  it('holds no payment truth however loudly the conversation claims one', () => {
    // The message body says "I want to pay". AVG-5 carries the words, AVG-7 reads an intent from
    // them, and neither becomes a payment. The brief that results declares as much.
    const built = prepareAarohiPaymentFollowupBrief(briefInput());
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.brief.posture.paymentConfirmedByAarohi).toBe(false);
    expect(built.brief.posture.paymentMutated).toBe(false);
    expect(built.brief.posture.requiresCorePaymentTruth).toBe(true);
    // And a conversation claim is a named, refused activation authority.
    expect(HANDOFF_REJECTED_AUTHORITIES).toContain('CONVERSATION_CLAIM');
  });

  it('never infers ACTIVE from a payment context, however available', () => {
    const built = prepareAarohiPaymentFollowupBrief(briefInput());
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.brief.posture.activationInferred).toBe(false);
    expect(built.brief.posture.activationMutated).toBe(false);
    expect(built.brief.posture.vendorActivated).toBe(false);
    expect(built.brief.posture.anishaHandoffExecuted).toBe(false);
    expect(built.brief.posture.requiresCoreActivationTruth).toBe(true);
    // The two truths are declared separately, which is the distinction this stage exists to hold.
    expect(built.brief.posture.requiresCorePaymentTruth).toBe(true);
  });
});

describe('completeCoreActiveHandoff remains the only route to Anisha ownership', () => {
  it('accepts exactly QuickFurno Core asserting ACTIVE at the boundary', () => {
    const handoff = completeCoreActiveHandoff(caseAwaitingActivation(), attestation());
    expect(handoff.ok).toBe(true);
    if (!handoff.ok) return;
    expect(handoff.next.state).toBe('HANDED_OFF_TO_ANISHA');
    expect(handoff.next.prospectRef).toBe(PROSPECT);
    expect(handoff.next.caseRef).toBe(CASE);
    expect(Object.isFrozen(handoff.next)).toBe(true);
  });

  it('drives every activation authority, and refuses the four substitutes', () => {
    expect(HANDOFF_TRUSTED_AUTHORITY).toBe('QUICKFURNO_CORE');
    for (const authority of ACTIVATION_AUTHORITIES) {
      const handoff = completeCoreActiveHandoff(
        caseAwaitingActivation(),
        attestation({ authority }),
      );
      if (authority === 'QUICKFURNO_CORE') {
        expect(handoff.ok, authority).toBe(true);
        continue;
      }
      expect(handoff.ok, authority).toBe(false);
      if (handoff.ok) continue;
      expect(handoff.reason, authority).toBe('AUTHORITY_NOT_CORE');
    }
    // Named individually, because these four are the substitutes the overlay rules out by name.
    expect([...HANDOFF_REJECTED_AUTHORITIES].sort()).toStrictEqual([
      'AGENT_CASE_STATE',
      'CONVERSATION_CLAIM',
      'MODEL_INFERENCE',
      'PROVIDER_RECEIPT',
    ]);
  });

  it('refuses Core saying not-active, another prospect, and a malformed attestation', () => {
    const notActive = completeCoreActiveHandoff(
      caseAwaitingActivation(),
      attestation({ active: false }),
    );
    expect(notActive.ok).toBe(false);
    if (!notActive.ok) expect(notActive.reason).toBe('CORE_DID_NOT_CONFIRM_ACTIVE');

    const otherProspect = completeCoreActiveHandoff(
      caseAwaitingActivation(),
      attestation({ prospectRef: 'prospect.other' }),
    );
    expect(otherProspect.ok).toBe(false);
    if (!otherProspect.ok) expect(otherProspect.reason).toBe('ATTESTATION_INVALID');

    for (const forged of [
      undefined,
      {},
      without(attestation(), 'authority'),
      without(attestation(), 'active'),
      { ...attestation(), extra: 'x' },
      { ...attestation(), authority: 'SOMEBODY_ELSE' },
    ]) {
      const handoff = completeCoreActiveHandoff(caseAwaitingActivation(), forged);
      expect(handoff.ok, JSON.stringify(forged)).toBe(false);
      if (handoff.ok) continue;
      expect(handoff.reason, JSON.stringify(forged)).toBe('ATTESTATION_INVALID');
    }
  });

  it('refuses a case that never reached the boundary, even with a perfect attestation', () => {
    for (const state of ACQUISITION_CASE_STATES) {
      if (state === 'AWAITING_CORE_ACTIVATION') continue;
      const handoff = completeCoreActiveHandoff(
        Object.freeze({ caseRef: CASE, prospectRef: PROSPECT, state }),
        attestation(),
      );
      expect(handoff.ok, state).toBe(false);
      if (handoff.ok) continue;
      expect(handoff.reason, state).toBe('CASE_NOT_AWAITING_ACTIVATION');
    }
    // Including every terminal state: a handed-off case does not hand off again.
    for (const state of TERMINAL_ACQUISITION_CASE_STATES) {
      const handoff = completeCoreActiveHandoff(
        Object.freeze({ caseRef: CASE, prospectRef: PROSPECT, state }),
        attestation(),
      );
      expect(handoff.ok, state).toBe(false);
    }
  });

  it('keeps the generic transition unable to reach the terminal state', () => {
    for (const from of ACQUISITION_CASE_STATES) {
      expect(canTransition(from, 'HANDED_OFF_TO_ANISHA'), from).toBe(false);
      expect(ACQUISITION_CASE_TRANSITIONS[from], from).not.toContain('HANDED_OFF_TO_ANISHA');
      const moved = transitionAcquisitionCase(
        Object.freeze({ caseRef: CASE, prospectRef: PROSPECT, state: from }),
        'HANDED_OFF_TO_ANISHA',
      );
      expect(moved.ok, from).toBe(false);
    }
  });

  it('adds no second route: AVG-10 names no handoff of its own', () => {
    const code = codeOnly(avg10Source());
    for (const forbidden of [
      'completeCoreActiveHandoff',
      'completeAvg10Handoff',
      'forceHandoff',
      'handoffToAnisha',
      'transitionToAnisha',
      'HANDED_OFF_TO_ANISHA',
      'AWAITING_CORE_ACTIVATION',
      'ActivationAttestation',
      'activationAttestationSchema',
      'ACTIVATION_AUTHORITIES',
      'QUICKFURNO_CORE',
      'transitionAcquisitionCase',
      'openAcquisitionCase',
      'active-handoff',
      'acquisition-case',
    ]) {
      expect(code, `AVG-10 must not name ${forbidden}`).not.toContain(forbidden);
    }
  });
});

// ===========================================================================
// G. The pre-handoff bridge, deliberately NOT added.
// ===========================================================================

describe('the AWAITING_CORE_ACTIVATION bridge remains future work, and is documented as such', () => {
  it('has no inbound transition today, and AVG-10 did not invent one', () => {
    // ADR-0127 records the reason: QuickFurno exposes no prospect-facing fact that could justify
    // entering the boundary. Every per-party payment or activation read is keyed by a Core VENDOR
    // ID, which Aarohi structurally does not hold. Manufacturing a bridge on an invented readiness
    // fact is exactly what this stage refused to do.
    for (const from of ACQUISITION_CASE_STATES) {
      expect(ACQUISITION_CASE_TRANSITIONS[from], from).not.toContain('AWAITING_CORE_ACTIVATION');
      expect(canTransition(from, 'AWAITING_CORE_ACTIVATION'), from).toBe(false);
    }
    // And `CONTACT_APPROVED` stays equally unreachable: the authority-shaped states are unchanged.
    for (const from of ACQUISITION_CASE_STATES) {
      expect(canTransition(from, 'CONTACT_APPROVED'), from).toBe(false);
    }
  });

  it('leaves the certified AVG-1 lifecycle byte-for-byte alone', () => {
    // The two files AVG-10 was permitted to touch only on a proved need, and did not.
    const lifecycle = readFileSync(join(SRC, 'contracts', 'acquisition-case.ts'), 'utf8');
    const handoff = readFileSync(join(SRC, 'contracts', 'active-handoff.ts'), 'utf8');
    expect(lifecycle).toContain('AWAITING_CORE_ACTIVATION: Object.freeze([');
    expect(handoff).toContain('export function completeCoreActiveHandoff');
    // A case still starts where it always started, and no AVG-10 builder moves it.
    const opened = openAcquisitionCase({ caseRef: CASE, prospectRef: PROSPECT });
    expect(opened?.state).toBe('DISCOVERED');
    const built = prepareAarohiPaymentFollowupBrief(briefInput());
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.brief.posture.acquisitionCaseMutated).toBe(false);
  });
});

// ===========================================================================
// I / J / K / L / M. The ceiling, as literals and as absences.
// ===========================================================================

describe('every brief pins the authority ceiling as literals', () => {
  const DECLARED_FALSE = [
    'paymentContextSourceAuthenticated',

    'paymentMutated',
    'paymentConfirmedByAarohi',
    'paymentLifecycleInvented',
    'packageOrderCreated',
    'creditsMutated',

    'activationMutated',
    'activationInferred',
    'vendorActivated',
    'anishaHandoffExecuted',

    'registrationMutated',
    'acquisitionCaseMutated',
    'marketplaceMutated',

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

    'productionMutation',
    'businessEffect',
  ] as const;

  const DECLARED_TRUE = [
    'assistanceContextOnly',
    'requiresCorePaymentTruth',
    'requiresCoreActivationTruth',
    'requiresCoreStatusRevalidationBeforeFutureOutboundUse',
  ] as const;

  const posture = AAROHI_PAYMENT_FOLLOWUP_POSTURE as unknown as Readonly<Record<string, unknown>>;

  it('holds every declaration on every reachable brief', () => {
    const built = prepareAarohiPaymentFollowupBrief(briefInput());
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const carried = built.brief.posture as unknown as Readonly<Record<string, unknown>>;
    for (const declared of DECLARED_FALSE) expect(carried[declared], declared).toBe(false);
    for (const declared of DECLARED_TRUE) expect(carried[declared], declared).toBe(true);
    expect(carried).toBe(AAROHI_PAYMENT_FOLLOWUP_POSTURE);
  });

  it('is complete: the list and the posture agree, in both directions', () => {
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
    expect(Object.keys(posture)).toHaveLength(DECLARED_FALSE.length + DECLARED_TRUE.length);
  });

  it('fails to construct a posture that says otherwise', () => {
    for (const forged of [
      { paymentMutated: true },
      { paymentConfirmedByAarohi: true },
      { paymentLifecycleInvented: true },
      { packageOrderCreated: true },
      { creditsMutated: true },
      { activationMutated: true },
      { activationInferred: true },
      { vendorActivated: true },
      { anishaHandoffExecuted: true },
      { acquisitionCaseMutated: true },
      { marketplaceMutated: true },
      { paymentContextSourceAuthenticated: true },
      { productionMutation: true },
      { businessEffect: true },
      { assistanceContextOnly: false },
      { requiresCorePaymentTruth: false },
      { requiresCoreActivationTruth: false },
      { requiresCoreStatusRevalidationBeforeFutureOutboundUse: false },
    ]) {
      expect(
        aarohiPaymentFollowupPostureSchema.safeParse({ ...posture, ...forged }).success,
        JSON.stringify(forged),
      ).toBe(false);
    }
    expect(
      aarohiPaymentFollowupPostureSchema.safeParse({ ...posture, paymentReceived: false }).success,
    ).toBe(false);
  });

  it('refuses a hand-built brief carrying any of them wrong', () => {
    const built = prepareAarohiPaymentFollowupBrief(briefInput());
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    for (const forged of [
      { paymentMutated: true },
      { activationInferred: true },
      { anishaHandoffExecuted: true },
      { requiresCoreActivationTruth: false },
    ]) {
      expect(
        aarohiPaymentFollowupBriefSchema.safeParse({
          ...built.brief,
          posture: { ...built.brief.posture, ...forged },
        }).success,
        JSON.stringify(forged),
      ).toBe(false);
    }
  });
});

describe('AVG-10 carries no money, no content, no destination and no secret', () => {
  it('carries no key that could hold an amount, a state, a sentence or a destination', () => {
    const built = prepareAarohiPaymentFollowupBrief(briefInput());
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const declarations = new Set(Object.keys(AAROHI_PAYMENT_FOLLOWUP_POSTURE));
    const keys = walkKeys(built.brief)
      .filter((key) => !declarations.has(key))
      // `context` is removed first because it CONTAINS `text`, and a field named
      // `paymentContextRef` is the opposite of a field holding free text.
      .map((key) => key.toLowerCase().split('context').join(''));
    for (const forbidden of [
      // Money.
      'amount',
      'price',
      'currency',
      'total',
      'discount',
      'invoice',
      'receipt',
      'transaction',
      'order',
      'credit',
      'method',
      'provider',
      'gateway',
      // A payment or activation STATE.
      'status',
      'paid',
      'pending',
      'settled',
      'activated',
      'active',
      // Content.
      'body',
      'message',
      'text',
      'reply',
      'reminder',
      'instruction',
      'explanation',
      'summary',
      // A destination or a secret.
      'url',
      'link',
      'endpoint',
      'phone',
      'email',
      'recipient',
      'destination',
      'password',
      'otp',
      'token',
      'secret',
      'card',
      'bank',
      'upi',
    ]) {
      expect(
        keys.filter((key) => key.includes(forbidden)),
        forbidden,
      ).toStrictEqual([]);
    }
  });

  it('carries only opaque references and canonical instants as values', () => {
    const built = prepareAarohiPaymentFollowupBrief(briefInput());
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    for (const [key, value] of walkStringEntries(built.brief)) {
      if (key.endsWith('At')) {
        expect(value, key).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u);
        continue;
      }
      expect(value, key).not.toMatch(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/u);
      expect(value, key).not.toMatch(/(?:[A-Za-z][A-Za-z0-9+.-]*:)?\/\//u);
      expect(value.toLowerCase(), key).not.toContain('www.');
      expect(value, key).not.toMatch(/(?:\d[\s().+-]{0,2}){7,}/u);
    }
    // And nothing in the artifact is a number at all: an amount cannot hide in a numeric field
    // when the only non-string value is the contract version.
    const numbers = Object.entries(built.brief)
      .filter(([, value]) => typeof value === 'number')
      .map(([key]) => key);
    expect(numbers).toStrictEqual(['contractVersion']);
  });

  it('names no QuickFurno payment or activation WRITE path', () => {
    // The exact function names discovered in the read-only Core audit at the commit ADR-0127
    // records. Banned by name rather than by generic word, because a generic ban is the one that
    // quietly stops matching when somebody renames a service.
    const code = codeOnly(avg10Source());
    for (const forbidden of [
      // packageService — the manual payment path.
      'createManualPayment',
      'markPaymentPaid',
      'assignPackageToVendor',
      'assignPackageAfterPayment',
      'assign_package_to_vendor',
      // vendorPackageOrderService — the order path.
      'createVendorPackageOrder',
      'listVendorPackageOrders',
      'getVendorCurrentPackageSummary',
      // vendorCreditWalletService — the credit path.
      'applyVendorCreditDelta',
      'grantVendorCredits',
      'grantCreditsForConfirmedPackagePurchase',
      'refundCreditForInvalidLead',
      // vendorAdminService — the activation path.
      'setVendorStatusAction',
      'updateVendorVisibility',
      'update_vendor_visibility',
      'updateVendorCredits',
      'updateVendorPackage',
      // Core tables and columns nothing here mirrors.
      'vendor_package_orders',
      'payment_status',
      'activation_status',
      'provider_payment_id',
      'provider_order_id',
    ]) {
      expect(code, `AVG-10 must not name ${forbidden}`).not.toContain(forbidden);
    }
  });

  it('opens no network, database, payment provider, model, prompt or retrieval path', () => {
    const lowered = codeOnly(avg10Source()).toLowerCase();
    for (const forbidden of [
      'supabase',
      'adminclient',
      'createclient',
      '.from(',
      '.select(',
      '.rpc(',
      'process.env',
      'fetch(',
      'axios',
      'node:http',
      'node:fs',
      'razorpay',
      'stripe',
      'cashfree',
      'payu',
      'paytm',
      'phonepe',
      'ccavenue',
      'billdesk',
      'checkout',
      'paymentgateway',
      'model-gateway',
      'prompt-registry',
      '@mastra',
      'openai',
      'anthropic',
      'embedding',
      'quickfurno-marketplace',
      'create table',
      'insert into',
      'migration',
      '.sql',
    ]) {
      expect(lowered, `AVG-10 must not name ${forbidden}`).not.toContain(forbidden);
    }
    expect(codeOnly(avg10Source())).not.toMatch(/https?:\/\//u);
  });

  it('creates no communication, approval, authorization or execution artifact', () => {
    const code = codeOnly(avg10Source());
    for (const forbidden of [
      'CommunicationRequestV1',
      'ApprovalRequestV1',
      'ApprovalDecisionV1',
      'CommunicationAuthorization',
      'ExecutionIntent',
      'prepareInstagramOutboundCandidate',
      'prepareWhatsAppChannelHandoffCandidate',
      'prepareAarohiCommercialFactsBrief',
      'prepareAarohiRegistrationAssistanceBrief',
    ]) {
      expect(code, `AVG-10 must not name ${forbidden}`).not.toContain(forbidden);
    }
  });
});

// ===========================================================================
// N. The roadmap overlay.
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

  it('records the certified range and AVG-10 as a defined proof', () => {
    const certified = /AVG-0 through AVG-(\d+) — implemented as certified offline domains/u.exec(
      overlay,
    );
    expect(certified).not.toBeNull();
    expect(Number(certified?.[1] ?? '0')).toBeGreaterThanOrEqual(9);
    expect(overlay).toContain('ADR-0127');
    expect(overlay).toContain('PLANNED / DISABLED');
    expect(overlay).toMatch(/AVG-10 — offline implementation proof defined by\s+\[ADR-0127\]/u);
  });

  it('keeps AVG-11 and AVG-12 planned and unimplemented', () => {
    expect(overlay).toMatch(/AVG-11 (?:through AVG-12|and AVG-12) — planned and unimplemented/u);
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
});
