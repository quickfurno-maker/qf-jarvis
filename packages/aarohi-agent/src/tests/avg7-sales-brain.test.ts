/**
 * AVG-7 — the Aarohi sales brain (ADR-0124).
 *
 * The claim under test is narrow: Aarohi can decide what KIND of reply would be safe to think about
 * next, and can do none of the things a reader might assume follow. Nothing here writes a sentence,
 * quotes a price, calls a model, confirms a registration or sends anything.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  AAROHI_AVG7_CONTRACT_VERSION,
  AAROHI_AVG7_INTERPRETATION_SOURCE_POSTURE,
  AAROHI_SALES_BRAIN_POSTURE,
  AAROHI_SALES_CONVERSATION_INTENTS,
  AAROHI_SALES_OBJECTION_KINDS,
  AAROHI_SALES_STRATEGIES,
  CORE_PARTY_STATUSES,
  appendInstagramInboundObservation,
  createAarohiSalesBrainInterpretation,
  createEnrichmentClaim,
  createInstagramConversation,
  evaluateAarohiSalesTurn,
  parseAarohiSalesBrainInterpretation,
  parseAarohiSalesTurnPlan,
  parseInstagramInboundObservation,
  salesBrainInterpretationSchema,
  salesBrainPostureSchema,
  salesReplyBriefSchema,
  salesTurnPlanSchema,
} from '../index.js';
import type {
  AarohiSalesBrainInterpretation,
  AarohiSalesConversationIntent,
  AarohiSalesObjectionKind,
  AarohiSalesStrategy,
  CorePartyStatus,
  InstagramConversationSnapshot,
} from '../index.js';

const SRC = fileURLToPath(new URL('../', import.meta.url));

/**
 * Every primitive leaf of an object, and every key on the way down.
 *
 * The specs below scan values and keys rather than `JSON.stringify` output, because a serialized
 * blob cannot tell `communicationRequestCreated: false` apart from a communication request. That
 * distinction is the whole point of a posture: these fields are DECLARATIONS OF ABSENCE, and a
 * substring scan reads them as presence. AVG-5 and AVG-6 learned the same lesson in containment.
 */
function walkValues(value: unknown): readonly unknown[] {
  if (Array.isArray(value)) return value.flatMap(walkValues);
  if (typeof value === 'object' && value !== null) {
    return Object.values(value).flatMap(walkValues);
  }
  return [value];
}

function walkKeys(value: unknown): readonly string[] {
  if (Array.isArray(value)) return value.flatMap(walkKeys);
  if (typeof value === 'object' && value !== null) {
    return Object.entries(value).flatMap(([key, nested]) => [key, ...walkKeys(nested)]);
  }
  return [];
}

/** Widened to `string` so instant comparisons in the specs are evaluated rather than folded. */
function canonicalInstant(value: string): string {
  return value;
}

const PROSPECT = 'prospect.avg7.alpha';
const OTHER_PROSPECT = 'prospect.avg7.beta';
const CONVERSATION = 'ig.conversation.alpha';
const OTHER_CONVERSATION = 'ig.conversation.beta';
const THREAD = 'ig.thread.alpha';
const OTHER_THREAD = 'ig.thread.beta';
const IG_PARTICIPANT = 'ig.participant.alpha';
const OTHER_IG_PARTICIPANT = 'ig.participant.beta';
const MESSAGE = 'ig.message.001';
const NEWER_MESSAGE = 'ig.message.002';
const AT = '2026-08-27T09:00:00Z';
const LATER = '2026-08-27T09:05:00Z';
const LATEST = '2026-08-27T09:10:00Z';

function emptyConversation(over: Record<string, unknown> = {}): InstagramConversationSnapshot {
  const built = createInstagramConversation({
    prospectRef: PROSPECT,
    instagramConversationRef: CONVERSATION,
    instagramThreadRef: THREAD,
    instagramParticipantRef: IG_PARTICIPANT,
    ...over,
  });
  if (!built.ok) throw new Error(`conversation fixture refused: ${built.refusal}`);
  return built.conversation;
}

function inboundTurn(over: Record<string, unknown> = {}): unknown {
  const built = parseInstagramInboundObservation({
    prospectRef: PROSPECT,
    instagramConversationRef: CONVERSATION,
    instagramThreadRef: THREAD,
    instagramParticipantRef: IG_PARTICIPANT,
    instagramMessageRef: MESSAGE,
    body: 'Hello',
    observedAt: AT,
    ...over,
  });
  if (!built.ok) throw new Error(`observation fixture refused: ${built.refusal}`);
  return built.observation;
}

/**
 * A canonical AVG-5 conversation whose bindings are whatever the caller says.
 *
 * The conversation binding and the turn binding must agree, so the override is applied to both —
 * which is also how AVG-5 itself is used, and why a single override object is the honest fixture.
 */
function upstreamConversation(over: Record<string, unknown>): InstagramConversationSnapshot {
  const { instagramMessageRef = MESSAGE, ...binding } = over;
  const built = createInstagramConversation({
    prospectRef: PROSPECT,
    instagramConversationRef: CONVERSATION,
    instagramThreadRef: THREAD,
    instagramParticipantRef: IG_PARTICIPANT,
    ...binding,
  });
  if (!built.ok) throw new Error(`AVG-5 refused the conversation binding: ${built.refusal}`);
  const turn = parseInstagramInboundObservation({
    prospectRef: PROSPECT,
    instagramConversationRef: CONVERSATION,
    instagramThreadRef: THREAD,
    instagramParticipantRef: IG_PARTICIPANT,
    ...binding,
    instagramMessageRef,
    body: 'Hello',
    observedAt: AT,
  });
  if (!turn.ok) throw new Error(`AVG-5 refused the turn: ${turn.refusal}`);
  const appended = appendInstagramInboundObservation(built.conversation, turn.observation);
  if (!appended.ok) throw new Error(`append refused: ${appended.refusal}`);
  return appended.conversation;
}

/** A conversation carrying the given turns, appended through AVG-5's own builder. */
function conversationWith(
  turns: readonly unknown[],
  over: Record<string, unknown> = {},
): InstagramConversationSnapshot {
  let conversation = emptyConversation(over);
  for (const turn of turns) {
    const appended = appendInstagramInboundObservation(conversation, turn);
    if (!appended.ok) throw new Error(`append refused: ${appended.refusal}`);
    conversation = appended.conversation;
  }
  return conversation;
}

/** The ordinary one-turn conversation almost every spec below starts from. */
function conversation(over: Record<string, unknown> = {}): InstagramConversationSnapshot {
  return conversationWith([inboundTurn()], over);
}

function interpretationInput(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    interpretationRef: 'interp.001',
    conversation: conversation(),
    intent: 'GENERAL_INFORMATION',
    objectionKind: 'NONE',
    interpretedAt: LATER,
    ...over,
  };
}

function interpretation(over: Record<string, unknown> = {}): AarohiSalesBrainInterpretation {
  const built = createAarohiSalesBrainInterpretation(interpretationInput(over));
  if (!built.ok) throw new Error(`interpretation fixture refused: ${built.refusal}`);
  return built.interpretation;
}

/** A hand-written interpretation, built the way a caller would rather than by the builder. */
function forgedInterpretation(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    contractVersion: AAROHI_AVG7_CONTRACT_VERSION,
    interpretationRef: 'interp.001',
    prospectRef: PROSPECT,
    instagramConversationRef: CONVERSATION,
    instagramThreadRef: THREAD,
    instagramParticipantRef: IG_PARTICIPANT,
    instagramMessageRef: MESSAGE,
    intent: 'GENERAL_INFORMATION',
    objectionKind: 'NONE',
    interpretedAt: LATER,
    sourcePosture: AAROHI_AVG7_INTERPRETATION_SOURCE_POSTURE,
    ...over,
  };
}

function observation(status: CorePartyStatus, prospectRef = PROSPECT): unknown {
  return {
    prospectRef,
    coreLookupRef: `lookup-${status.toLowerCase().replace(/_/gu, '-')}`,
    status,
  };
}

function turnInput(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    planRef: 'plan.alpha',
    conversation: conversation(),
    interpretation: interpretation(),
    coreObservation: observation('NOT_REGISTERED'),
    plannedAt: LATEST,
    ...over,
  };
}

/** The plan for one pair of signals, or a thrown fixture error. Used by the precedence matrix. */
function planFor(
  intent: AarohiSalesConversationIntent,
  objectionKind: AarohiSalesObjectionKind,
): ReturnType<typeof evaluateAarohiSalesTurn> {
  return evaluateAarohiSalesTurn(
    turnInput({ interpretation: interpretation({ intent, objectionKind }) }),
  );
}

function strategyFor(
  intent: AarohiSalesConversationIntent,
  objectionKind: AarohiSalesObjectionKind,
): AarohiSalesStrategy {
  const built = planFor(intent, objectionKind);
  if (!built.ok) throw new Error(`plan refused for ${intent}/${objectionKind}: ${built.refusal}`);
  return built.plan.brief.strategy;
}

// ===========================================================================
// The vocabularies.
// ===========================================================================

describe('the AVG-7 vocabulary is a conversation vocabulary, not an authority vocabulary', () => {
  it('is version 1 and names the interpretation for what it is', () => {
    expect(AAROHI_AVG7_CONTRACT_VERSION).toBe(1);
    expect(AAROHI_AVG7_INTERPRETATION_SOURCE_POSTURE).toBe(
      'INJECTED_OFFLINE_SALES_BRAIN_INTERPRETATION',
    );
  });

  it('closes the intent vocabulary, and excludes every business STATE', () => {
    expect([...AAROHI_SALES_CONVERSATION_INTENTS]).toStrictEqual([
      'GENERAL_INFORMATION',
      'SERVICE_FIT',
      'LEAD_QUALITY',
      'COMMERCIAL_TERMS',
      'REGISTRATION_PROCESS',
      'PAYMENT_OR_ACTIVATION',
      'REJECTION_OR_STOP',
      'OTHER_OR_UNCLEAR',
    ]);
    // A conversation cannot become a business state by being read a particular way.
    for (const forbidden of [
      'APPROVED_TO_CONTACT',
      'CONSENT_GRANTED',
      'VENDOR_ACTIVE',
      'PAYMENT_CONFIRMED',
      'REGISTRATION_CONFIRMED',
      'PACKAGE_ELIGIBLE',
      'DISCOUNT_ELIGIBLE',
      'READY_TO_SEND',
    ]) {
      expect(AAROHI_SALES_CONVERSATION_INTENTS as readonly string[], forbidden).not.toContain(
        forbidden,
      );
    }
  });

  it('closes the objection vocabulary', () => {
    expect([...AAROHI_SALES_OBJECTION_KINDS]).toStrictEqual([
      'NONE',
      'PRICE_OR_PACKAGE',
      'LEAD_QUALITY',
      'LEAD_VOLUME_OR_ROI',
      'TRUST_OR_VERIFICATION',
      'TIMING_OR_NOT_READY',
      'PRIVACY_OR_CONTACT',
      'OTHER',
    ]);
  });

  it('closes the strategy vocabulary, and none of its members is a reply', () => {
    expect([...AAROHI_SALES_STRATEGIES]).toStrictEqual([
      'PREPARE_NONCOMMERCIAL_REPLY_BRIEF',
      'PREPARE_CLARIFYING_REPLY_BRIEF',
      'REQUEST_CORE_COMMERCIAL_CONTEXT',
      'REQUEST_CORE_PROCESS_CONTEXT',
      'REQUEST_CORE_CONTACT_POLICY_REVIEW',
      'REQUEST_HUMAN_REVIEW',
    ]);
    for (const forbidden of ['SEND', 'SENT', 'APPROVED', 'AUTHORIZED', 'DRAFTED', 'ANSWER']) {
      for (const strategy of AAROHI_SALES_STRATEGIES) {
        expect(strategy, forbidden).not.toContain(forbidden);
      }
    }
  });
});

// ===========================================================================
// The interpretation binds the CURRENT turn, and the conversation decides which one that is.
// ===========================================================================

describe('an interpretation is a reading of one canonical current message', () => {
  it('binds every reference from the conversation, and stamps the posture', () => {
    const built = interpretation();
    expect(built.contractVersion).toBe(1);
    expect(built.prospectRef).toBe(PROSPECT);
    expect(built.instagramConversationRef).toBe(CONVERSATION);
    expect(built.instagramThreadRef).toBe(THREAD);
    expect(built.instagramParticipantRef).toBe(IG_PARTICIPANT);
    expect(built.instagramMessageRef).toBe(MESSAGE);
    expect(built.sourcePosture).toBe('INJECTED_OFFLINE_SALES_BRAIN_INTERPRETATION');
    expect(Object.isFrozen(built)).toBe(true);
  });

  it('gives the caller no way to name a message, an index or a "latest" flag', () => {
    // Every one of these is the caller trying to decide which turn is current. The conversation
    // decides, which is the only definition that cannot be argued with.
    for (const forged of [
      { instagramMessageRef: NEWER_MESSAGE },
      { prospectRef: OTHER_PROSPECT },
      { instagramConversationRef: OTHER_CONVERSATION },
      { instagramThreadRef: OTHER_THREAD },
      { instagramParticipantRef: OTHER_IG_PARTICIPANT },
      { turnIndex: 0 },
      { latest: true },
      { bodyHash: 'abc' },
      { sourcePosture: 'CORE_VERIFIED' },
      { contractVersion: 2 },
    ]) {
      const built = createAarohiSalesBrainInterpretation(interpretationInput(forged));
      expect(built.ok, JSON.stringify(forged)).toBe(false);
      if (!built.ok) expect(built.refusal, JSON.stringify(forged)).toBe('SALES_INPUT_INVALID');
    }
  });

  it('reads the LAST turn of the canonical order, not the first', () => {
    const two = conversationWith([
      inboundTurn(),
      inboundTurn({ instagramMessageRef: NEWER_MESSAGE, observedAt: LATER }),
    ]);
    const built = createAarohiSalesBrainInterpretation(
      interpretationInput({ conversation: two, interpretedAt: LATEST }),
    );
    expect(built.ok).toBe(true);
    if (built.ok) expect(built.interpretation.instagramMessageRef).toBe(NEWER_MESSAGE);
  });

  it('refuses a conversation with no inbound turn at all', () => {
    const built = createAarohiSalesBrainInterpretation(
      interpretationInput({ conversation: emptyConversation() }),
    );
    expect(built.ok).toBe(false);
    if (!built.ok) expect(built.refusal).toBe('CONVERSATION_HAS_NO_INBOUND_TURN');

    const planned = evaluateAarohiSalesTurn(turnInput({ conversation: emptyConversation() }));
    expect(planned.ok).toBe(false);
    if (!planned.ok) expect(planned.refusal).toBe('CONVERSATION_HAS_NO_INBOUND_TURN');
  });

  it('refuses a conversation it cannot certify, including a forged mixed-prospect one', () => {
    for (const bad of [undefined, null, {}, { inboundTurns: [] }]) {
      expect(
        createAarohiSalesBrainInterpretation(interpretationInput({ conversation: bad })).ok,
        JSON.stringify(bad),
      ).toBe(false);
      expect(
        evaluateAarohiSalesTurn(turnInput({ conversation: bad })).ok,
        JSON.stringify(bad),
      ).toBe(false);
    }

    // AVG-5's aggregate gate, inherited. The turn is individually canonical; the conversation is not.
    const forgedConversation = {
      ...conversation(),
      inboundTurns: [inboundTurn({ prospectRef: OTHER_PROSPECT })],
    };
    const built = evaluateAarohiSalesTurn(turnInput({ conversation: forgedConversation }));
    expect(built.ok).toBe(false);
    if (!built.ok) expect(built.refusal).toBe('CONVERSATION_INVALID');
  });
});

describe('a stale reading cannot be replayed over a conversation that has moved on', () => {
  it('refuses an interpretation of an earlier turn once a newer one exists', () => {
    // Read the first message honestly, then the prospect says something else. The reading is now
    // about a message that is no longer the one in front of anybody.
    const first = conversation();
    const stale = interpretation({ conversation: first });
    expect(stale.instagramMessageRef).toBe(MESSAGE);

    const moved = conversationWith([
      inboundTurn(),
      inboundTurn({ instagramMessageRef: NEWER_MESSAGE, observedAt: LATER }),
    ]);
    const built = evaluateAarohiSalesTurn(
      turnInput({ conversation: moved, interpretation: stale, plannedAt: LATEST }),
    );
    expect(built.ok).toBe(false);
    if (!built.ok) expect(built.refusal).toBe('INTERPRETATION_NOT_FOR_LATEST_TURN');

    // A reading of the NEW message over the same conversation is fine, so the refusal above is the
    // staleness check rather than the evaluator having stopped accepting conversations.
    expect(
      evaluateAarohiSalesTurn(
        turnInput({
          conversation: moved,
          interpretation: interpretation({ conversation: moved, interpretedAt: LATER }),
          plannedAt: LATEST,
        }),
      ).ok,
    ).toBe(true);
  });

  it('refuses a matching message reference that agrees about nothing else', () => {
    // References are opaque and channel-local. Two conversations may legitimately use the same local
    // name, so a matching message reference on its own proves nothing at all.
    for (const [label, over] of [
      ['another prospect', { prospectRef: OTHER_PROSPECT }],
      ['another conversation', { instagramConversationRef: OTHER_CONVERSATION }],
      ['another thread', { instagramThreadRef: OTHER_THREAD }],
      ['another participant', { instagramParticipantRef: OTHER_IG_PARTICIPANT }],
    ] as const) {
      const built = evaluateAarohiSalesTurn(
        turnInput({ interpretation: forgedInterpretation(over) }),
      );
      expect(built.ok, label).toBe(false);
      if (!built.ok) expect(built.refusal, label).toBe('INTERPRETATION_BINDING_MISMATCH');
    }

    // And the mirror: every binding right, message reference wrong.
    const wrongMessage = evaluateAarohiSalesTurn(
      turnInput({ interpretation: forgedInterpretation({ instagramMessageRef: NEWER_MESSAGE }) }),
    );
    expect(wrongMessage.ok).toBe(false);
    if (!wrongMessage.ok) {
      expect(wrongMessage.refusal).toBe('INTERPRETATION_NOT_FOR_LATEST_TURN');
    }
  });

  it('refuses a malformed interpretation rather than half-reading it', () => {
    for (const bad of [undefined, null, {}, { intent: 'GENERAL_INFORMATION' }]) {
      const built = evaluateAarohiSalesTurn(turnInput({ interpretation: bad }));
      expect(built.ok, JSON.stringify(bad)).toBe(false);
      if (!built.ok) expect(built.refusal).toBe('INTERPRETATION_INVALID');
    }
  });
});

// ===========================================================================
// Time causality, by instant rather than by spelling.
// ===========================================================================

describe('a reading cannot predate the message it is a reading of', () => {
  it('refuses an interpretation stamped before the latest message', () => {
    const built = createAarohiSalesBrainInterpretation(
      interpretationInput({
        conversation: conversationWith([inboundTurn({ observedAt: LATER })]),
        interpretedAt: AT,
      }),
    );
    expect(built.ok).toBe(false);
    if (!built.ok) expect(built.refusal).toBe('INTERPRETATION_BEFORE_MESSAGE');

    // And the evaluator asks again, so a hand-built interpretation cannot skip the builder.
    const forged = evaluateAarohiSalesTurn(
      turnInput({
        conversation: conversationWith([inboundTurn({ observedAt: LATER })]),
        interpretation: forgedInterpretation({ interpretedAt: AT }),
        plannedAt: LATEST,
      }),
    );
    expect(forged.ok).toBe(false);
    if (!forged.ok) expect(forged.refusal).toBe('INTERPRETATION_BEFORE_MESSAGE');
  });

  it('allows the same instant and any instant after it', () => {
    for (const interpretedAt of [AT, '2026-08-27T09:00:00.000Z', LATER]) {
      expect(
        createAarohiSalesBrainInterpretation(interpretationInput({ interpretedAt })).ok,
        interpretedAt,
      ).toBe(true);
    }
  });

  it('compares the instant a timestamp means, not the way it is spelled', () => {
    const halfPast = canonicalInstant('2026-08-27T09:00:00.500Z');
    const wholeSecond = canonicalInstant('2026-08-27T09:00:00Z');
    // As STRINGS `.500Z` sorts before `Z`, so a lexicographic check reaches both of the answers
    // below backwards. Each direction is asserted, because only one of them is wrong per comparison.
    expect(halfPast < wholeSecond).toBe(true);

    // Message half a second AFTER the reading: refused, though the strings say otherwise.
    expect(
      createAarohiSalesBrainInterpretation(
        interpretationInput({
          conversation: conversationWith([inboundTurn({ observedAt: halfPast })]),
          interpretedAt: wholeSecond,
        }),
      ).ok,
    ).toBe(false);

    // The mirror: message on the whole second, reading half a second later. Coherent, though a
    // lexicographic check would refuse it.
    expect(
      createAarohiSalesBrainInterpretation(
        interpretationInput({
          conversation: conversationWith([inboundTurn({ observedAt: wholeSecond })]),
          interpretedAt: halfPast,
        }),
      ).ok,
    ).toBe(true);

    // Two spellings of one moment are one moment.
    expect(
      createAarohiSalesBrainInterpretation(
        interpretationInput({
          conversation: conversationWith([inboundTurn({ observedAt: wholeSecond })]),
          interpretedAt: canonicalInstant('2026-08-27T09:00:00.000Z'),
        }),
      ).ok,
    ).toBe(true);
  });

  it('refuses a timestamp that is not a real instant', () => {
    for (const bad of [
      '2026-02-30T09:00:00Z',
      '2026-13-01T09:00:00Z',
      '2026-08-27T24:00:00Z',
      '2026-08-27T09:00:00',
      '2026-08-27T09:00:00+05:30',
      '2026-08-27 09:00:00Z',
    ]) {
      expect(
        createAarohiSalesBrainInterpretation(interpretationInput({ interpretedAt: bad })).ok,
        bad,
      ).toBe(false);
    }
  });
});

describe('a plan cannot predate the reading it rests on', () => {
  it('refuses a plan stamped before its interpretation, and allows equal or later', () => {
    const early = evaluateAarohiSalesTurn(turnInput({ plannedAt: '2026-08-27T09:04:59Z' }));
    expect(early.ok).toBe(false);
    if (!early.ok) expect(early.refusal).toBe('PLAN_BEFORE_INTERPRETATION');

    expect(evaluateAarohiSalesTurn(turnInput({ plannedAt: LATER })).ok).toBe(true);
    expect(evaluateAarohiSalesTurn(turnInput({ plannedAt: LATEST })).ok).toBe(true);
  });

  it('compares plan instants semantically too', () => {
    const halfPast = canonicalInstant('2026-08-27T09:05:00.500Z');
    const wholeSecond = canonicalInstant('2026-08-27T09:05:00Z');

    // Interpretation half a second after the plan: refused, though the strings sort the other way.
    const backwards = evaluateAarohiSalesTurn(
      turnInput({
        interpretation: interpretation({ interpretedAt: halfPast }),
        plannedAt: wholeSecond,
      }),
    );
    expect(backwards.ok).toBe(false);
    if (!backwards.ok) expect(backwards.refusal).toBe('PLAN_BEFORE_INTERPRETATION');

    expect(
      evaluateAarohiSalesTurn(
        turnInput({
          interpretation: interpretation({ interpretedAt: wholeSecond }),
          plannedAt: halfPast,
        }),
      ).ok,
    ).toBe(true);
    // Equivalent spellings are one instant.
    expect(
      evaluateAarohiSalesTurn(
        turnInput({
          interpretation: interpretation({ interpretedAt: wholeSecond }),
          plannedAt: canonicalInstant('2026-08-27T09:05:00.000Z'),
        }),
      ).ok,
    ).toBe(true);
  });
});

// ===========================================================================
// A reading carries categories. It carries no content, no arithmetic and no authority.
// ===========================================================================

describe('an interpretation has nowhere to put content, confidence or authority', () => {
  const FORBIDDEN_FIELDS: readonly Record<string, unknown>[] = [
    // Content.
    { body: 'Sure, our basic plan is fine for you' },
    { text: 'anything' },
    { message: 'anything' },
    { reply: 'anything' },
    { replyText: 'anything' },
    { explanation: 'because they seemed keen' },
    { reasoning: 'step one' },
    { chainOfThought: 'step one' },
    // Arithmetic dressed as judgement.
    { confidence: 0.99 },
    { score: 90 },
    { probability: 0.5 },
    // Commercial truth, which is AVG-8's and Core's.
    { price: 1 },
    { amount: 1 },
    { currency: 'INR' },
    { packageName: 'anything' },
    { discount: 10 },
    { offer: 'anything' },
    { coupon: 'anything' },
    { guarantee: true },
    { leadVolume: 100 },
    { revenue: 1 },
    { conversion: 1 },
    { urgency: true },
    { scarcity: true },
    { socialProof: 'anything' },
    // Consent and suppression, which are Core's.
    { consent: true },
    { optedIn: true },
    { optedOut: true },
    { doNotContact: false },
    { suppressed: false },
    // Business state, which is Core's.
    { registered: true },
    { active: true },
    { paymentReceived: true },
    { verified: true },
    { vendorId: 'v1' },
    { coreVendorId: 'v1' },
    // Destinations, providers and models.
    { phone: '919812345678' },
    { email: 'someone@example.com' },
    { destination: 'anything' },
    { token: 'anything' },
    { accessToken: 'anything' },
    { provider: 'meta' },
    { modelId: 'anything' },
    // Verdicts the caller does not get to state.
    { strategy: 'PREPARE_NONCOMMERCIAL_REPLY_BRIEF' },
    { approved: true },
    { authorized: true },
    { executionIntent: 'anything' },
    { sendNow: true },
  ];

  it('refuses every one of them on the builder input', () => {
    for (const extra of FORBIDDEN_FIELDS) {
      const built = createAarohiSalesBrainInterpretation(interpretationInput(extra));
      expect(built.ok, JSON.stringify(extra)).toBe(false);
      if (!built.ok) expect(built.refusal, JSON.stringify(extra)).toBe('SALES_INPUT_INVALID');
    }
  });

  it('refuses every one of them on the public parser and schema', () => {
    for (const extra of FORBIDDEN_FIELDS) {
      const forged = forgedInterpretation(extra);
      expect(salesBrainInterpretationSchema.safeParse(forged).success, JSON.stringify(extra)).toBe(
        false,
      );
      expect(parseAarohiSalesBrainInterpretation(forged), JSON.stringify(extra)).toBeUndefined();
    }
  });

  it('declares exactly eleven fields, so a schema cannot be widened quietly', () => {
    // `.strict()` refuses keys the schema does not KNOW about. It says nothing about the keys the
    // schema does know about, so a field added here later would be a field a hand-built artifact may
    // legitimately carry. The three public schemas therefore have their field lists asserted.
    expect(Object.keys(salesBrainInterpretationSchema.shape).sort()).toStrictEqual([
      'contractVersion',
      'instagramConversationRef',
      'instagramMessageRef',
      'instagramParticipantRef',
      'instagramThreadRef',
      'intent',
      'interpretationRef',
      'interpretedAt',
      'objectionKind',
      'prospectRef',
      'sourcePosture',
    ]);
    expect(Object.keys(salesTurnPlanSchema.shape).sort()).toStrictEqual([
      'brief',
      'contractVersion',
      'coreLookupRef',
      'coreStatus',
      'instagramConversationRef',
      'instagramMessageRef',
      'instagramParticipantRef',
      'instagramThreadRef',
      'interpretationRef',
      'planRef',
      'plannedAt',
      'posture',
      'prospectRef',
    ]);
    expect(Object.keys(salesReplyBriefSchema.shape).sort()).toStrictEqual([
      'futureModelDraftEligible',
      'intent',
      'objectionKind',
      'requiresClarification',
      'requiresCoreCommercialContext',
      'requiresCoreConsentRevalidation',
      'requiresCoreContactPolicyRevalidation',
      'requiresCoreProcessContext',
      'requiresHumanReview',
      'stopSalesPendingCoreReview',
      'strategy',
    ]);
  });

  it('carries no field whose NAME could hold content or a commercial fact', () => {
    const keys = Object.keys(interpretation()).map((key) => key.toLowerCase());
    for (const forbidden of [
      'body',
      'text',
      'message',
      'reply',
      'explanation',
      'reasoning',
      'confidence',
      'score',
      'price',
      'amount',
      'discount',
      'offer',
      'consent',
      'verified',
      'token',
      'model',
    ]) {
      // `instagramMessageRef` is a REFERENCE and legitimately contains "message"; nothing else may.
      const offenders = keys.filter(
        (key) => key.includes(forbidden) && key !== 'instagrammessageref',
      );
      expect(offenders, forbidden).toStrictEqual([]);
    }
  });

  it('refuses a reference that could carry a destination', () => {
    for (const destination of [
      '919812345678',
      '+919812345678',
      'someone@example.com',
      'https://example.com/x',
      'www.example.com',
      '@someone',
    ]) {
      expect(
        createAarohiSalesBrainInterpretation(
          interpretationInput({ interpretationRef: destination }),
        ).ok,
        destination,
      ).toBe(false);
      expect(evaluateAarohiSalesTurn(turnInput({ planRef: destination })).ok, destination).toBe(
        false,
      );
    }
  });
});

// ===========================================================================
// The CURRENT Core gate.
// ===========================================================================

describe('conversational reading is never acquisition permission', () => {
  it('re-runs the current Core gate, and only NOT_REGISTERED proceeds', () => {
    for (const status of CORE_PARTY_STATUSES) {
      const built = evaluateAarohiSalesTurn(turnInput({ coreObservation: observation(status) }));
      if (status === 'NOT_REGISTERED') {
        expect(built.ok, status).toBe(true);
        continue;
      }
      expect(built.ok, status).toBe(false);
      if (!built.ok) expect(built.refusal, status).toBe('CORE_GATE_REFUSED');
    }
  });

  it('lets no interpretation or objection category bypass it', () => {
    // Every pair of signals, against every suppressing status. Interest is not an input to the gate.
    for (const status of ['DO_NOT_CONTACT', 'REGISTERED', 'ACTIVE', 'UNKNOWN'] as const) {
      for (const intent of AAROHI_SALES_CONVERSATION_INTENTS) {
        for (const objectionKind of AAROHI_SALES_OBJECTION_KINDS) {
          const built = evaluateAarohiSalesTurn(
            turnInput({
              interpretation: interpretation({ intent, objectionKind }),
              coreObservation: observation(status),
            }),
          );
          expect(built.ok, `${status}/${intent}/${objectionKind}`).toBe(false);
        }
      }
    }
  });

  it('fails closed on an observation about somebody else, and on a malformed one', () => {
    for (const bad of [
      observation('NOT_REGISTERED', OTHER_PROSPECT),
      undefined,
      null,
      {},
      { prospectRef: PROSPECT, status: 'NOT_REGISTERED' },
    ]) {
      const built = evaluateAarohiSalesTurn(turnInput({ coreObservation: bad }));
      expect(built.ok, JSON.stringify(bad)).toBe(false);
      if (!built.ok) expect(built.refusal).toBe('CORE_GATE_REFUSED');
    }
  });

  it('gives a stale earlier eligibility nothing at all', () => {
    // The same conversation, the same reading, the same everything — except that Core now says stop.
    const input = turnInput();
    expect(evaluateAarohiSalesTurn(input).ok).toBe(true);
    const suppressed = evaluateAarohiSalesTurn({
      ...input,
      coreObservation: observation('DO_NOT_CONTACT'),
    });
    expect(suppressed.ok).toBe(false);
    if (!suppressed.ok) {
      expect(suppressed.refusal).toBe('CORE_GATE_REFUSED');
      if (suppressed.refusal === 'CORE_GATE_REFUSED') {
        expect(suppressed.coreReason).toBe('CORE_SUPPRESSED');
      }
    }
  });
});

// ===========================================================================
// Precedence. The whole matrix, and the reasons for its shape.
// ===========================================================================

describe('a rejection outranks every other thing a message might also be', () => {
  it('stops selling on a rejection, whatever else the message was about', () => {
    for (const objectionKind of AAROHI_SALES_OBJECTION_KINDS) {
      expect(strategyFor('REJECTION_OR_STOP', objectionKind), objectionKind).toBe(
        'REQUEST_CORE_CONTACT_POLICY_REVIEW',
      );
    }
  });

  it('stops selling on a contact-privacy concern, whatever the message was asking', () => {
    for (const intent of AAROHI_SALES_CONVERSATION_INTENTS) {
      expect(strategyFor(intent, 'PRIVACY_OR_CONTACT'), intent).toBe(
        'REQUEST_CORE_CONTACT_POLICY_REVIEW',
      );
    }
  });

  it('does not let the commercial branch win a mixed signal', () => {
    // The exact case the precedence exists for: a message that is commercially interesting AND asks
    // not to be contacted is a message asking not to be contacted.
    expect(strategyFor('COMMERCIAL_TERMS', 'PRIVACY_OR_CONTACT')).toBe(
      'REQUEST_CORE_CONTACT_POLICY_REVIEW',
    );
    expect(strategyFor('REJECTION_OR_STOP', 'PRICE_OR_PACKAGE')).toBe(
      'REQUEST_CORE_CONTACT_POLICY_REVIEW',
    );
  });

  it('fails safe locally without claiming anything about consent', () => {
    const built = planFor('REJECTION_OR_STOP', 'NONE');
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const brief = built.plan.brief;
    expect(brief.stopSalesPendingCoreReview).toBe(true);
    expect(brief.requiresCoreContactPolicyRevalidation).toBe(true);
    expect(brief.requiresCoreConsentRevalidation).toBe(true);
    expect(brief.futureModelDraftEligible).toBe(false);

    // The brain refuses to keep selling. It does NOT record that the prospect opted out — consent
    // and suppression are Core's, and reading a message is not a way to change them.
    expect(built.plan.posture.consentEstablished).toBe(false);
    expect(built.plan.posture.suppressionMutated).toBe(false);
    const serialized = JSON.stringify(built.plan);
    for (const forbidden of ['optedOut', 'doNotContact', 'suppressed', 'consentGranted']) {
      expect(serialized, forbidden).not.toContain(forbidden);
    }
  });
});

describe('commercial questions stop at "Core facts required"', () => {
  it('routes commercial terms and price objections to Core commercial context', () => {
    expect(strategyFor('COMMERCIAL_TERMS', 'NONE')).toBe('REQUEST_CORE_COMMERCIAL_CONTEXT');
    expect(strategyFor('GENERAL_INFORMATION', 'PRICE_OR_PACKAGE')).toBe(
      'REQUEST_CORE_COMMERCIAL_CONTEXT',
    );
    expect(strategyFor('COMMERCIAL_TERMS', 'PRICE_OR_PACKAGE')).toBe(
      'REQUEST_CORE_COMMERCIAL_CONTEXT',
    );
  });

  it('marks the commercial branch as needing Core, and never draftable without it', () => {
    const built = planFor('COMMERCIAL_TERMS', 'PRICE_OR_PACKAGE');
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.plan.brief.requiresCoreCommercialContext).toBe(true);
    // A model asked to answer a price question whose facts are missing will supply them.
    expect(built.plan.brief.futureModelDraftEligible).toBe(false);
    expect(built.plan.posture.priceOriginatedByBrain).toBe(false);
    expect(built.plan.posture.discountOriginatedByBrain).toBe(false);
    expect(built.plan.posture.commercialTruthOriginatedByBrain).toBe(false);
  });

  it('carries no commercial value anywhere in the plan, under any name', () => {
    const built = planFor('COMMERCIAL_TERMS', 'PRICE_OR_PACKAGE');
    expect(built.ok).toBe(true);
    if (!built.ok) return;

    // The strongest available statement: the ONLY number anywhere in a plan is the contract
    // version. A price, an amount, a discount percentage, a lead count and a revenue figure are all
    // numbers, so counting them is a tighter check than naming the fields they might arrive in.
    expect(walkValues(built.plan).filter((one) => typeof one === 'number')).toStrictEqual([1]);

    // And no key outside the posture could hold one either.
    //
    // The posture is excluded by NAME rather than by pattern, because `discountOriginatedByBrain`
    // and `guaranteeLeadVolume` are declarations that no discount was invented and no lead volume
    // was guaranteed — the exact opposite of the fields being looked for. Those are asserted present
    // and false in the posture specs, which is a stronger statement than their absence would be.
    const declarations = new Set(Object.keys(AAROHI_SALES_BRAIN_POSTURE));
    const keys = walkKeys(built.plan)
      .filter((key) => !declarations.has(key))
      .map((key) => key.toLowerCase());
    for (const forbidden of [
      'price',
      'amount',
      'currency',
      'packagename',
      'discount',
      'offer',
      'coupon',
      'tier',
      'leadvolume',
      'revenue',
      'guarantee',
    ]) {
      expect(
        keys.filter((key) => key.includes(forbidden)),
        forbidden,
      ).toStrictEqual([]);
    }
  });
});

describe('registration, payment and activation stop at "Core process truth required"', () => {
  it('routes both process intents to Core process context', () => {
    expect(strategyFor('REGISTRATION_PROCESS', 'NONE')).toBe('REQUEST_CORE_PROCESS_CONTEXT');
    expect(strategyFor('PAYMENT_OR_ACTIVATION', 'NONE')).toBe('REQUEST_CORE_PROCESS_CONTEXT');
  });

  it('claims no registration, no payment and no activation', () => {
    for (const intent of ['REGISTRATION_PROCESS', 'PAYMENT_OR_ACTIVATION'] as const) {
      const built = planFor(intent, 'NONE');
      expect(built.ok, intent).toBe(true);
      if (!built.ok) continue;
      expect(built.plan.brief.requiresCoreProcessContext, intent).toBe(true);
      expect(built.plan.brief.futureModelDraftEligible, intent).toBe(false);
      expect(built.plan.posture.registrationMutated, intent).toBe(false);
      expect(built.plan.posture.paymentMutated, intent).toBe(false);
      expect(built.plan.posture.activationMutated, intent).toBe(false);
      expect(built.plan.posture.anishaHandoffExecuted, intent).toBe(false);
      // The Core status on the plan is the one that was observed, and it is the only one that
      // proceeds. Somebody typing "I already paid" does not move it.
      expect(built.plan.coreStatus, intent).toBe('NOT_REGISTERED');
      // Read the VALUES. `NOT_REGISTERED` contains `REGISTERED` as a substring and means its
      // opposite, which is exactly the kind of confusion a scan over serialized text invites.
      const values = walkValues(built.plan).filter((one) => typeof one === 'string');
      for (const forbidden of [
        'REGISTERED',
        'ACTIVE',
        'PAID',
        'PAYMENT_RECEIVED',
        'HANDED_OFF_TO_ANISHA',
        'AWAITING_CORE_ACTIVATION',
      ]) {
        expect(values, `${intent}/${forbidden}`).not.toContain(forbidden);
      }
    }
  });
});

describe('unclear and uncategorised messages get a closed answer, not a guess', () => {
  it('sends an uncategorised objection to a person', () => {
    expect(strategyFor('GENERAL_INFORMATION', 'OTHER')).toBe('REQUEST_HUMAN_REVIEW');
    expect(strategyFor('OTHER_OR_UNCLEAR', 'OTHER')).toBe('REQUEST_HUMAN_REVIEW');
  });

  it('asks a clarifying question when nobody could tell what was asked', () => {
    expect(strategyFor('OTHER_OR_UNCLEAR', 'NONE')).toBe('PREPARE_CLARIFYING_REPLY_BRIEF');
  });

  it('has no free-form fallback anywhere in either branch', () => {
    for (const objectionKind of ['OTHER', 'NONE'] as const) {
      const built = planFor('OTHER_OR_UNCLEAR', objectionKind);
      expect(built.ok, objectionKind).toBe(true);
      if (!built.ok) continue;
      expect(Object.keys(built.plan.brief).sort()).toStrictEqual([
        'futureModelDraftEligible',
        'intent',
        'objectionKind',
        'requiresClarification',
        'requiresCoreCommercialContext',
        'requiresCoreConsentRevalidation',
        'requiresCoreContactPolicyRevalidation',
        'requiresCoreProcessContext',
        'requiresHumanReview',
        'stopSalesPendingCoreReview',
        'strategy',
      ]);
    }
  });
});

describe('ordinary acquisition questions become a bounded brief and nothing more', () => {
  it('routes every ordinary pair to a non-commercial reply brief', () => {
    for (const intent of ['GENERAL_INFORMATION', 'SERVICE_FIT', 'LEAD_QUALITY'] as const) {
      for (const objectionKind of [
        'NONE',
        'LEAD_QUALITY',
        'LEAD_VOLUME_OR_ROI',
        'TRUST_OR_VERIFICATION',
        'TIMING_OR_NOT_READY',
      ] as const) {
        expect(strategyFor(intent, objectionKind), `${intent}/${objectionKind}`).toBe(
          'PREPARE_NONCOMMERCIAL_REPLY_BRIEF',
        );
      }
    }
  });

  it('lets a later governed composition draft, and guarantees nothing in the meantime', () => {
    // Eligibility to DRAFT later is not permission to CLAIM anything. The ROI objection is the one
    // where a fluent system would reassure with a number.
    const built = planFor('LEAD_QUALITY', 'LEAD_VOLUME_OR_ROI');
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.plan.brief.futureModelDraftEligible).toBe(true);
    expect(built.plan.brief.requiresCoreCommercialContext).toBe(false);
    expect(built.plan.posture.guaranteeLeadVolume).toBe(false);
    expect(built.plan.posture.guaranteeRevenue).toBe(false);
    expect(built.plan.posture.guaranteeConversion).toBe(false);
    // And eligibility is not a call: nothing was asked of a model here.
    expect(built.plan.posture.modelCallExecuted).toBe(false);
    expect(built.plan.posture.promptResolved).toBe(false);
    expect(built.plan.posture.retrievalExecuted).toBe(false);
  });

  it('claims no verification status on a trust objection', () => {
    const built = planFor('SERVICE_FIT', 'TRUST_OR_VERIFICATION');
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.plan.brief.strategy).toBe('PREPARE_NONCOMMERCIAL_REPLY_BRIEF');
    expect(built.plan.posture.identityMutated).toBe(false);
    expect(JSON.stringify(built.plan)).not.toContain('verified');
  });
});

describe('the strategy is a total function of two closed signals', () => {
  it('produces exactly one strategy for every pair, and the expected one', () => {
    // The expectation is restated here independently of the implementation's class maps, so a change
    // to either has to be a change to both.
    const contactRisk = (i: AarohiSalesConversationIntent, o: AarohiSalesObjectionKind): boolean =>
      i === 'REJECTION_OR_STOP' || o === 'PRIVACY_OR_CONTACT';
    const commercial = (i: AarohiSalesConversationIntent, o: AarohiSalesObjectionKind): boolean =>
      i === 'COMMERCIAL_TERMS' || o === 'PRICE_OR_PACKAGE';
    const process = (i: AarohiSalesConversationIntent): boolean =>
      i === 'REGISTRATION_PROCESS' || i === 'PAYMENT_OR_ACTIVATION';

    let pairs = 0;
    for (const intent of AAROHI_SALES_CONVERSATION_INTENTS) {
      for (const objectionKind of AAROHI_SALES_OBJECTION_KINDS) {
        pairs += 1;
        const expected: AarohiSalesStrategy = contactRisk(intent, objectionKind)
          ? 'REQUEST_CORE_CONTACT_POLICY_REVIEW'
          : commercial(intent, objectionKind)
            ? 'REQUEST_CORE_COMMERCIAL_CONTEXT'
            : process(intent)
              ? 'REQUEST_CORE_PROCESS_CONTEXT'
              : objectionKind === 'OTHER'
                ? 'REQUEST_HUMAN_REVIEW'
                : intent === 'OTHER_OR_UNCLEAR'
                  ? 'PREPARE_CLARIFYING_REPLY_BRIEF'
                  : 'PREPARE_NONCOMMERCIAL_REPLY_BRIEF';
        expect(strategyFor(intent, objectionKind), `${intent}/${objectionKind}`).toBe(expected);
      }
    }
    expect(pairs).toBe(64);
  });

  it('never marks a strategy that is waiting on Core as draftable', () => {
    for (const intent of AAROHI_SALES_CONVERSATION_INTENTS) {
      for (const objectionKind of AAROHI_SALES_OBJECTION_KINDS) {
        const built = planFor(intent, objectionKind);
        expect(built.ok).toBe(true);
        if (!built.ok) continue;
        const brief = built.plan.brief;
        const waiting =
          brief.requiresCoreCommercialContext ||
          brief.requiresCoreProcessContext ||
          brief.requiresCoreContactPolicyRevalidation ||
          brief.requiresHumanReview;
        if (waiting) {
          expect(brief.futureModelDraftEligible, `${intent}/${objectionKind}`).toBe(false);
        }
      }
    }
  });
});

// ===========================================================================
// The sales-ethics posture, on every plan the policy can produce.
// ===========================================================================

describe('every plan states the sales-ethics prohibitions as literals', () => {
  const FALSE_DECLARATIONS = [
    'commercialCommitmentCreated',
    'commercialTruthOriginatedByBrain',
    'priceOriginatedByBrain',
    'discountOriginatedByBrain',
    'guaranteeLeadVolume',
    'guaranteeRevenue',
    'guaranteeConversion',
    'inventedUrgency',
    'inventedScarcity',
    'unsupportedSocialProof',
    // The canonical ceiling's own wording: no HIDDEN material package limitation.
    'materialPackageLimitationHidden',
    'contractualCommitmentCreated',
    'consentEstablished',
    'suppressionMutated',
    'identityMutated',
    'registrationMutated',
    'paymentMutated',
    'activationMutated',
    'acquisitionCaseMutated',
    'anishaHandoffExecuted',
    'communicationRequestCreated',
    'approvalRequestCreated',
    'approvalDecisionCreated',
    'communicationAuthorizationCreated',
    'executionIntentCreated',
    'modelCallExecuted',
    'promptResolved',
    'retrievalExecuted',
    'n8nExecutionRequested',
    'providerSendRequested',
    'channelSendRequested',
    'sent',
    'delivered',
    'productionMutation',
    'businessEffect',
  ] as const;

  it('holds every declaration false on every reachable plan', () => {
    for (const intent of AAROHI_SALES_CONVERSATION_INTENTS) {
      for (const objectionKind of AAROHI_SALES_OBJECTION_KINDS) {
        const built = planFor(intent, objectionKind);
        expect(built.ok).toBe(true);
        if (!built.ok) continue;
        const posture = built.plan.posture as unknown as Readonly<Record<string, unknown>>;
        expect(posture['planOnly']).toBe(true);
        for (const declared of FALSE_DECLARATIONS) {
          expect(posture[declared], `${intent}/${objectionKind}/${declared}`).toBe(false);
        }
      }
    }
  });

  it('machine-represents every prohibition the canonical ceiling names', () => {
    // The ceiling in ADR-0085 binds Aarohi to Anisha's sales ethics. This slice's value is making
    // those prohibitions machine-visible, so the list is asserted against the ceiling rather than
    // against whatever the posture happens to contain.
    const posture = AAROHI_SALES_BRAIN_POSTURE as unknown as Readonly<Record<string, unknown>>;
    for (const [prohibition, field] of [
      ['guaranteed lead volume', 'guaranteeLeadVolume'],
      ['guaranteed revenue', 'guaranteeRevenue'],
      ['guaranteed conversion', 'guaranteeConversion'],
      ['invented discount', 'discountOriginatedByBrain'],
      ['invented price change', 'priceOriginatedByBrain'],
      ['invented urgency', 'inventedUrgency'],
      ['invented scarcity', 'inventedScarcity'],
      ['hidden material package limitation', 'materialPackageLimitationHidden'],
      ['unsupported social proof', 'unsupportedSocialProof'],
      ['binding contractual commitment', 'contractualCommitmentCreated'],
    ] as const) {
      expect(Object.hasOwn(posture, field), `${prohibition} -> ${field}`).toBe(true);
      expect(posture[field], `${prohibition} -> ${field}`).toBe(false);
    }
    // "No contact after rejection/opt-out" is the one the ceiling names that is enforced by
    // PRECEDENCE rather than by a literal, because it is a decision about what happens next rather
    // than a claim about what was done. It is asserted in the precedence specs above.
    expect(
      planFor('REJECTION_OR_STOP', 'NONE').ok &&
        strategyFor('REJECTION_OR_STOP', 'NONE') === 'REQUEST_CORE_CONTACT_POLICY_REVIEW',
    ).toBe(true);
  });

  it('does not turn the package-limitation declaration into commercial knowledge', () => {
    // `materialPackageLimitationHidden: false` is an ethics declaration, not a commercial fact. It
    // does not mean AVG-7 knows the limitations or may describe a package, and the commercial branch
    // is still undraftable without Core.
    const built = planFor('COMMERCIAL_TERMS', 'PRICE_OR_PACKAGE');
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.plan.posture.materialPackageLimitationHidden).toBe(false);
    expect(built.plan.brief.strategy).toBe('REQUEST_CORE_COMMERCIAL_CONTEXT');
    expect(built.plan.brief.requiresCoreCommercialContext).toBe(true);
    expect(built.plan.brief.futureModelDraftEligible).toBe(false);
    expect(walkValues(built.plan).filter((one) => typeof one === 'number')).toStrictEqual([1]);
  });

  it('fails to construct a posture that says otherwise', () => {
    for (const declared of FALSE_DECLARATIONS) {
      expect(
        salesBrainPostureSchema.safeParse({ ...AAROHI_SALES_BRAIN_POSTURE, [declared]: true })
          .success,
        declared,
      ).toBe(false);
    }
    expect(
      salesBrainPostureSchema.safeParse({ ...AAROHI_SALES_BRAIN_POSTURE, planOnly: false }).success,
    ).toBe(false);
    expect(
      salesBrainPostureSchema.safeParse({ ...AAROHI_SALES_BRAIN_POSTURE, extra: true }).success,
    ).toBe(false);
  });

  it('refuses a hand-built plan carrying any of them as true', () => {
    const built = evaluateAarohiSalesTurn(turnInput());
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    for (const declared of FALSE_DECLARATIONS) {
      const forged = {
        ...built.plan,
        posture: { ...built.plan.posture, [declared]: true },
      };
      expect(salesTurnPlanSchema.safeParse(forged).success, declared).toBe(false);
      expect(parseAarohiSalesTurnPlan(forged), declared).toBeUndefined();
    }
  });
});

// ===========================================================================
// The public parser certifies exactly what the evaluator produces.
// ===========================================================================

describe('a hand-built plan cannot claim a strategy the policy would not reach', () => {
  it('accepts what the evaluator produced, for every pair', () => {
    for (const intent of AAROHI_SALES_CONVERSATION_INTENTS) {
      for (const objectionKind of AAROHI_SALES_OBJECTION_KINDS) {
        const built = planFor(intent, objectionKind);
        expect(built.ok).toBe(true);
        if (!built.ok) continue;
        expect(parseAarohiSalesTurnPlan(built.plan), `${intent}/${objectionKind}`).toBeDefined();
      }
    }
  });

  it('refuses a strategy that does not follow from the two signals', () => {
    const built = evaluateAarohiSalesTurn(
      turnInput({
        interpretation: interpretation({ intent: 'REJECTION_OR_STOP', objectionKind: 'NONE' }),
      }),
    );
    expect(built.ok).toBe(true);
    if (!built.ok) return;

    // A rejection re-labelled as an ordinary reply brief. Every field is individually well-formed.
    for (const strategy of AAROHI_SALES_STRATEGIES) {
      const forged = {
        ...built.plan,
        brief: { ...built.plan.brief, strategy },
      };
      const expected = strategy === 'REQUEST_CORE_CONTACT_POLICY_REVIEW';
      expect(salesTurnPlanSchema.safeParse(forged).success, strategy).toBe(expected);
    }
  });

  it('refuses a self-consistent brief whose strategy does not follow from the signals', () => {
    const rejection = planFor('REJECTION_OR_STOP', 'NONE');
    const ordinary = planFor('GENERAL_INFORMATION', 'NONE');
    expect(rejection.ok && ordinary.ok).toBe(true);
    if (!rejection.ok || !ordinary.ok) return;

    // A rejection wearing an ordinary reply brief, obligations and all. Every field is individually
    // well-formed and every flag agrees with the strategy it names -- the ONLY thing wrong with it
    // is that the policy would never have produced it for these two signals.
    const relabelled = {
      ...rejection.plan,
      brief: {
        ...ordinary.plan.brief,
        intent: rejection.plan.brief.intent,
        objectionKind: rejection.plan.brief.objectionKind,
      },
    };
    expect(salesReplyBriefSchema.safeParse(relabelled.brief).success).toBe(false);
    expect(salesTurnPlanSchema.safeParse(relabelled).success).toBe(false);
    expect(parseAarohiSalesTurnPlan(relabelled)).toBeUndefined();

    // The mirror, for every pair: swapping in another pair's whole brief is refused unless the two
    // pairs genuinely share a strategy.
    for (const intent of AAROHI_SALES_CONVERSATION_INTENTS) {
      for (const objectionKind of AAROHI_SALES_OBJECTION_KINDS) {
        const built = planFor(intent, objectionKind);
        if (!built.ok) continue;
        const swapped = {
          ...built.plan,
          brief: { ...ordinary.plan.brief, intent, objectionKind },
        };
        const shouldParse = built.plan.brief.strategy === ordinary.plan.brief.strategy;
        expect(salesTurnPlanSchema.safeParse(swapped).success, `${intent}/${objectionKind}`).toBe(
          shouldParse,
        );
      }
    }
  });

  it('refuses an obligation flag that contradicts its own strategy', () => {
    const commercial = planFor('COMMERCIAL_TERMS', 'NONE');
    const contact = planFor('REJECTION_OR_STOP', 'NONE');
    const ordinary = planFor('GENERAL_INFORMATION', 'NONE');
    expect(commercial.ok && contact.ok && ordinary.ok).toBe(true);
    if (!commercial.ok || !contact.ok || !ordinary.ok) return;

    for (const [label, forged] of [
      [
        'commercial without Core context',
        {
          ...commercial.plan,
          brief: { ...commercial.plan.brief, requiresCoreCommercialContext: false },
        },
      ],
      [
        'commercial declared draftable',
        { ...commercial.plan, brief: { ...commercial.plan.brief, futureModelDraftEligible: true } },
      ],
      [
        'contact policy without a stop',
        { ...contact.plan, brief: { ...contact.plan.brief, stopSalesPendingCoreReview: false } },
      ],
      [
        'contact policy declared draftable',
        { ...contact.plan, brief: { ...contact.plan.brief, futureModelDraftEligible: true } },
      ],
      [
        'contact policy without consent revalidation',
        {
          ...contact.plan,
          brief: { ...contact.plan.brief, requiresCoreConsentRevalidation: false },
        },
      ],
      [
        'ordinary brief demanding a human',
        { ...ordinary.plan, brief: { ...ordinary.plan.brief, requiresHumanReview: true } },
      ],
      [
        'ordinary brief claiming Core process context',
        { ...ordinary.plan, brief: { ...ordinary.plan.brief, requiresCoreProcessContext: true } },
      ],
    ] as const) {
      expect(salesReplyBriefSchema.safeParse(forged.brief).success, label).toBe(false);
      expect(salesTurnPlanSchema.safeParse(forged).success, label).toBe(false);
      expect(parseAarohiSalesTurnPlan(forged), label).toBeUndefined();
    }
  });

  it('refuses a plan carrying content, a commercial value or a non-eligible Core status', () => {
    const built = evaluateAarohiSalesTurn(turnInput());
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    for (const extra of [
      { body: 'anything' },
      { replyText: 'anything' },
      { message: 'anything' },
      { price: 1 },
      { discount: 1 },
      { promptText: 'anything' },
      { modelId: 'anything' },
      { coreStatus: 'ACTIVE' },
      { coreStatus: 'REGISTERED' },
    ]) {
      expect(
        salesTurnPlanSchema.safeParse({ ...built.plan, ...extra }).success,
        JSON.stringify(extra),
      ).toBe(false);
    }
  });

  it('returns frozen, detached objects', () => {
    const built = evaluateAarohiSalesTurn(turnInput());
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(Object.isFrozen(built)).toBe(true);
    expect(Object.isFrozen(built.plan)).toBe(true);
    expect(Object.isFrozen(built.plan.brief)).toBe(true);
    expect(Object.isFrozen(built.plan.posture)).toBe(true);

    const reparsed = parseAarohiSalesTurnPlan(built.plan);
    expect(reparsed).toBeDefined();
    if (reparsed === undefined) return;
    expect(Object.isFrozen(reparsed.brief)).toBe(true);
    expect(reparsed.brief).not.toBe(built.plan.brief);
  });
});

// ===========================================================================
// Threat tests: the tempting designs, proved impossible.
// ===========================================================================

describe('the tempting shortcuts are structurally unavailable', () => {
  it('cannot answer a price question from itself', () => {
    // There is no path from "they asked about price" to a number, because there is no number.
    const built = planFor('COMMERCIAL_TERMS', 'PRICE_OR_PACKAGE');
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.plan.brief.strategy).toBe('REQUEST_CORE_COMMERCIAL_CONTEXT');
    expect(built.plan.brief.futureModelDraftEligible).toBe(false);
  });

  it('cannot be told that the prospect already paid, or registered, or is active', () => {
    for (const claim of [
      { paymentReceived: true },
      { registered: true },
      { active: true },
      { verified: true },
      { consent: true },
    ]) {
      expect(
        createAarohiSalesBrainInterpretation(interpretationInput(claim)).ok,
        JSON.stringify(claim),
      ).toBe(false);
      expect(
        parseAarohiSalesBrainInterpretation(forgedInterpretation(claim)),
        JSON.stringify(claim),
      ).toBeUndefined();
    }
  });

  it('cannot be handed a strategy, an outcome or a confidence by its caller', () => {
    for (const forged of [
      { strategy: 'PREPARE_NONCOMMERCIAL_REPLY_BRIEF' },
      { outcome: 'READY_TO_SEND' },
      { confidence: 0.99 },
      { futureModelDraftEligible: true },
    ]) {
      expect(
        createAarohiSalesBrainInterpretation(interpretationInput(forged)).ok,
        JSON.stringify(forged),
      ).toBe(false);
      expect(evaluateAarohiSalesTurn(turnInput(forged)).ok, JSON.stringify(forged)).toBe(false);
    }
  });

  it('refuses everything when Core says stop, however the conversation reads', () => {
    for (const [intent, objectionKind] of [
      ['GENERAL_INFORMATION', 'NONE'],
      ['SERVICE_FIT', 'TIMING_OR_NOT_READY'],
      ['COMMERCIAL_TERMS', 'PRICE_OR_PACKAGE'],
    ] as const) {
      for (const status of ['ACTIVE', 'DO_NOT_CONTACT'] as const) {
        const built = evaluateAarohiSalesTurn(
          turnInput({
            interpretation: interpretation({ intent, objectionKind }),
            coreObservation: observation(status),
          }),
        );
        expect(built.ok, `${intent}/${status}`).toBe(false);
        if (!built.ok) expect(built.refusal).toBe('CORE_GATE_REFUSED');
      }
    }
  });
});

// ===========================================================================
// Nothing downstream happens, and the source says so structurally.
// ===========================================================================

describe('AVG-7 stops at the plan', () => {
  const avg7 = readFileSync(join(SRC, 'contracts', 'avg7-sales-brain.ts'), 'utf8');
  const code = avg7
    .replace(/\/\*[\s\S]*?\*\//gu, '')
    .split('\n')
    .filter((line) => !/^\s*\/\//u.test(line))
    .join('\n');

  it('never reaches a workspace draft, an outbound candidate or a channel handoff', () => {
    for (const forbidden of [
      // AVG-4, AVG-5 and AVG-6 builders. Composition is a later, separately reviewed decision.
      'createOutreachDraft',
      'reviseOutreachDraft',
      'evaluateWorkspaceApprovalReadiness',
      'prepareInstagramOutboundCandidate',
      'prepareWhatsAppChannelHandoffCandidate',
      // Acquisition ownership, which is not this domain's to move.
      'completeCoreActiveHandoff',
      'transitionAcquisitionCase',
      'openAcquisitionCase',
      'HANDED_OFF_TO_ANISHA',
      'AWAITING_CORE_ACTIVATION',
      'CONTACT_APPROVED',
      // The governed model and prompt waists. Future composition, not this slice.
      'model-gateway',
      'model-reply-adapter',
      'prompt-registry',
      '@mastra',
      'ModelReplyPort',
      'renderPrompt',
      'embedding',
      'vectorStore',
      'retrieve(',
    ]) {
      expect(code, `AVG-7 must not name ${forbidden}`).not.toContain(forbidden);
    }
  });

  it('imports only AVG-5 and the AVG-1 gate', () => {
    const imports = [...code.matchAll(/from '([^']+)'/gu)].map((match) => match[1]);
    expect(imports.sort()).toStrictEqual([
      './avg5-instagram-conversation.js',
      './existing-vendor-gate.js',
      './existing-vendor-gate.js',
      'zod',
    ]);
  });

  it('produces nothing but a plan, and the plan names no downstream artifact', () => {
    const built = evaluateAarohiSalesTurn(turnInput());
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(Object.keys(built).sort()).toStrictEqual(['ok', 'plan']);

    // Every reference a plan carries, listed exactly. A downstream artifact would have to arrive as
    // one of these, and adding one fails here rather than in review. Scanning for the SUBSTRING
    // `communicationRequest` would instead have matched `communicationRequestCreated: false` — a
    // declaration that no such request exists — and reported the absence as the presence.
    const references = walkKeys(built.plan).filter((key) => key.endsWith('Ref'));
    expect(references.sort()).toStrictEqual([
      'coreLookupRef',
      'instagramConversationRef',
      'instagramMessageRef',
      'instagramParticipantRef',
      'instagramThreadRef',
      'interpretationRef',
      'planRef',
      'prospectRef',
    ]);
    for (const forbidden of [
      'draftRef',
      'candidateRef',
      'authorizationRef',
      'workflowRef',
      'providerRef',
      'promptRef',
      'modelRef',
      'templateRef',
    ]) {
      expect(references, forbidden).not.toContain(forbidden);
    }
  });
});

// ===========================================================================
// AVG-7 preserves certified upstream opaque bindings while separately protecting
// its own new local artifact refs.
//
// Two roles, two grammars, and the specs below are about the difference between them.
// ===========================================================================

describe('an inherited binding stays whatever the upstream stage certified', () => {
  /** Opaque identifiers AVG-1 and AVG-5 accept today, and which look alarming out of context. */
  const UPSTREAM_TOKENS = ['919812345678', '1234567', 'www.example.com'] as const;

  it('accepts a canonical AVG-5 conversation whose bindings are numeric', () => {
    // Provider-native identifiers are frequently numeric. A numeric `instagramMessageRef` is an ID,
    // not a phone number, and AVG-5 -- which owns that grammar -- has already said so.
    for (const token of UPSTREAM_TOKENS) {
      for (const field of [
        'instagramMessageRef',
        'instagramParticipantRef',
        'instagramConversationRef',
        'instagramThreadRef',
        'prospectRef',
      ] as const) {
        const conversation = upstreamConversation({ [field]: token });
        const built = createAarohiSalesBrainInterpretation(interpretationInput({ conversation }));
        expect(built.ok, `${field}=${token}`).toBe(true);
        if (built.ok) {
          expect(built.interpretation[field], `${field}=${token}`).toBe(token);
        }
      }
    }
  });

  it('accepts a canonical Core observation whose lookup reference is numeric', () => {
    for (const token of UPSTREAM_TOKENS) {
      const built = evaluateAarohiSalesTurn(
        turnInput({
          coreObservation: {
            prospectRef: PROSPECT,
            coreLookupRef: token,
            status: 'NOT_REGISTERED',
          },
        }),
      );
      expect(built.ok, token).toBe(true);
      if (built.ok) expect(built.plan.coreLookupRef, token).toBe(token);
    }
  });

  it('carries a numeric upstream binding end to end, into a plan', () => {
    const conversation = upstreamConversation({
      instagramParticipantRef: '919812345678',
      instagramMessageRef: '1234567',
    });
    const built = evaluateAarohiSalesTurn(
      turnInput({
        conversation,
        interpretation: interpretation({ conversation }),
        coreObservation: {
          prospectRef: PROSPECT,
          coreLookupRef: '919812345678',
          status: 'NOT_REGISTERED',
        },
      }),
    );
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.plan.instagramParticipantRef).toBe('919812345678');
    expect(built.plan.instagramMessageRef).toBe('1234567');
    expect(parseAarohiSalesTurnPlan(built.plan)).toBeDefined();
  });

  it('does not re-judge a destination-LOOKING upstream token as a destination', () => {
    // `www.example.com` is a canonical opaque identifier under the upstream grammar. AVG-7 does not
    // own that grammar and may not reinterpret the token; nothing here could dial or fetch it, and
    // narrowing it would mean a conversation AVG-5 calls canonical is refused downstream.
    const conversation = upstreamConversation({ instagramParticipantRef: 'www.example.com' });
    expect(createAarohiSalesBrainInterpretation(interpretationInput({ conversation })).ok).toBe(
      true,
    );
    // And the same string as AVG-7's OWN artifact identity is refused, which is the whole point of
    // there being two roles.
    expect(
      createAarohiSalesBrainInterpretation(
        interpretationInput({ interpretationRef: 'www.example.com' }),
      ).ok,
    ).toBe(false);
  });

  it('agrees with AVG-5 on the opaque grammar itself and on the canonical instant', () => {
    for (const value of ['ok.ref-1', 'A:B_c', 'x'.repeat(128)]) {
      const accepted = parseInstagramInboundObservation({
        prospectRef: PROSPECT,
        instagramConversationRef: CONVERSATION,
        instagramThreadRef: THREAD,
        instagramParticipantRef: IG_PARTICIPANT,
        instagramMessageRef: value,
        body: 'Hello',
        observedAt: AT,
      }).ok;
      expect(accepted, value).toBe(true);
      expect(
        createAarohiSalesBrainInterpretation(
          interpretationInput({
            conversation: upstreamConversation({ instagramMessageRef: value }),
          }),
        ).ok,
        value,
      ).toBe(true);
    }
    for (const value of ['', 'x'.repeat(129), 'has space', 'has/slash', 'has@at']) {
      expect(
        createAarohiSalesBrainInterpretation(interpretationInput({ interpretationRef: value })).ok,
        value,
      ).toBe(false);
    }
    for (const instant of ['2026-08-27T09:00:00Z', '2026-08-27T09:00:00.000Z']) {
      expect(
        parseInstagramInboundObservation({
          prospectRef: PROSPECT,
          instagramConversationRef: CONVERSATION,
          instagramThreadRef: THREAD,
          instagramParticipantRef: IG_PARTICIPANT,
          instagramMessageRef: MESSAGE,
          body: 'Hello',
          observedAt: instant,
        }).ok,
        instant,
      ).toBe(true);
      expect(
        createAarohiSalesBrainInterpretation(interpretationInput({ interpretedAt: instant })).ok,
        instant,
      ).toBe(true);
    }
  });
});

describe("AVG-7's own artifact identities carry no destination", () => {
  /** Every separator the opaque class permits, and the bare form. */
  const SMUGGLED = [
    '919812345678',
    '9_1_9_8_1_2_3_4_5_6_7_8',
    '91:98:12:34:56:78',
    'avg7:91_9812_345678',
    'plan.91.98.12.34.56.78',
    'ref9x1y9z8a1b2c3d4e5f6g7h8',
    'someone@example.com',
    'https://example.com/x',
    'www.example.com',
  ] as const;

  it('refuses a destination in interpretationRef, however it is punctuated', () => {
    for (const ref of SMUGGLED) {
      const built = createAarohiSalesBrainInterpretation(
        interpretationInput({ interpretationRef: ref }),
      );
      expect(built.ok, ref).toBe(false);
      if (!built.ok) expect(built.refusal, ref).toBe('SALES_INPUT_INVALID');
    }
  });

  it('refuses a destination in planRef, however it is punctuated', () => {
    for (const ref of SMUGGLED) {
      const built = evaluateAarohiSalesTurn(turnInput({ planRef: ref }));
      expect(built.ok, ref).toBe(false);
      if (!built.ok) expect(built.refusal, ref).toBe('SALES_INPUT_INVALID');
    }
  });

  it('stops at seven digits, not at digits', () => {
    // Six is the boundary: the shortest number anybody would recognise as dialable is seven.
    for (const ref of [
      'interp.001',
      'plan.alpha',
      'avg7.ref-A1',
      'interp.123456',
      'a1b2c3d4e5f6',
    ]) {
      expect(
        createAarohiSalesBrainInterpretation(interpretationInput({ interpretationRef: ref })).ok,
        ref,
      ).toBe(true);
      expect(evaluateAarohiSalesTurn(turnInput({ planRef: ref })).ok, ref).toBe(true);
    }
  });

  it('refuses them at the public parser boundary too', () => {
    const plan = evaluateAarohiSalesTurn(turnInput());
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    for (const ref of SMUGGLED) {
      expect(
        parseAarohiSalesBrainInterpretation(forgedInterpretation({ interpretationRef: ref })),
        ref,
      ).toBeUndefined();
      expect(salesTurnPlanSchema.safeParse({ ...plan.plan, planRef: ref }).success, ref).toBe(
        false,
      );
      expect(
        salesTurnPlanSchema.safeParse({ ...plan.plan, interpretationRef: ref }).success,
        ref,
      ).toBe(false);
    }
  });

  it('agrees with AVG-2 on what a contact shape is, for its own refs', () => {
    // AVG-2 screens enrichment labels for the same shapes. If the two disagreed, a destination
    // refused by one package could enter through the other -- as an AVG-7 artifact identity.
    for (const destination of [
      'someone@example.com',
      'https://example.com/x',
      'www.example.com',
      '919812345678',
      '98 1234 5678',
    ]) {
      expect(
        createEnrichmentClaim({
          prospectRef: PROSPECT,
          attribute: 'BUSINESS_DISPLAY_NAME',
          value: destination,
          source: { kind: 'MANUAL_REVIEW', sourceRef: 'avg7-drift' },
          observedAt: AT,
          evidenceQuality: 'UNVERIFIED_OPERATOR_ENTERED',
        }).ok,
        destination,
      ).toBe(false);
      expect(
        createAarohiSalesBrainInterpretation(
          interpretationInput({ interpretationRef: destination }),
        ).ok,
        destination,
      ).toBe(false);
    }
  });
});

// ===========================================================================
// The canonical roadmap must not contradict itself.
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

  it('records AVG-0 through AVG-6 as certified and AVG-7 as a defined proof', () => {
    expect(overlay).toContain('AVG-0 through AVG-6 — implemented as certified offline domains');
    expect(overlay).toContain('ADR-0124');
    expect(overlay).not.toContain('everything after it is planned and unimplemented');
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
    expect(overlay).toContain('PLANNED / DISABLED');
  });
});
