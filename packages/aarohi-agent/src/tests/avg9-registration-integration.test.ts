/**
 * AVG-9 — registration integration (ADR-0126).
 *
 * The claim under test is narrow, and the second half is the one worth proving: Aarohi can record
 * that a genuinely unregistered prospect asked about registration and that Core holds process
 * context for it — and can do none of the things a reader might assume follow. Nothing here
 * registers anybody, invents a signup step, advances an acquisition case, takes a payment, activates
 * a vendor, hands off to Anisha, calls a model or reaches QuickFurno.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  AAROHI_AVG9_CONTRACT_VERSION,
  AAROHI_AVG9_REGISTRATION_PROCESS_SOURCE_POSTURE,
  AAROHI_REGISTRATION_ASSISTANCE_POSTURE,
  AAROHI_SALES_BRAIN_POSTURE,
  CORE_PARTY_STATUSES,
  CORE_REGISTRATION_ASSISTANCE_OUTCOME,
  CORE_REGISTRATION_PROCESS_AVAILABILITIES,
  CORE_STATUS_ROLE,
  REGISTRATION_ASSISTANCE_REFUSALS,
  aarohiRegistrationAssistanceBriefSchema,
  aarohiRegistrationAssistancePostureSchema,
  appendInstagramInboundObservation,
  coreRegistrationProcessContextSchema,
  createAarohiSalesBrainInterpretation,
  createCoreRegistrationProcessContext,
  createInstagramConversation,
  evaluateAarohiSalesTurn,
  parseAarohiRegistrationAssistanceBrief,
  parseAarohiSalesTurnPlan,
  parseCoreRegistrationProcessContext,
  parseInstagramInboundObservation,
  prepareAarohiRegistrationAssistanceBrief,
  salesBrainPostureSchema,
} from '../index.js';
import type {
  AarohiSalesBrainInterpretation,
  AarohiSalesConversationIntent,
  AarohiSalesObjectionKind,
  AarohiSalesTurnPlan,
  CorePartyStatus,
  CoreRegistrationProcessContext,
  InstagramConversationSnapshot,
} from '../index.js';

const SRC = fileURLToPath(new URL('../', import.meta.url));

/** Widened to `string` so instant comparisons in the specs are evaluated rather than folded. */
function canonicalInstant(value: string): string {
  return value;
}

const PROSPECT = 'prospect.avg9.alpha';
const CONVERSATION = 'ig.conversation.alpha';
const THREAD = 'ig.thread.alpha';
const IG_PARTICIPANT = 'ig.participant.alpha';
const MESSAGE = 'ig.message.001';
const LOOKUP = 'core.lookup.alpha';

const AT = '2026-08-27T09:00:00Z';
const INTERPRETED = '2026-08-27T09:05:00Z';
const PLANNED = '2026-08-27T09:10:00Z';
const OBSERVED = '2026-08-27T09:15:00Z';
const PREPARED = '2026-08-27T09:20:00Z';

/** Core's own registration material, named opaquely. Never read, never followed. */
const CORE_PROCESS = 'core.registration.process.v4';

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
      body: 'How do I sign up?',
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
  { ref: 'ig.message.002', at: '2026-08-27T09:02:00Z' },
]);

function interpretation(
  intent: AarohiSalesConversationIntent = 'REGISTRATION_PROCESS',
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
  intent: AarohiSalesConversationIntent = 'REGISTRATION_PROCESS',
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

function processContextInput(over: Record<string, unknown> = {}): Record<string, unknown> {
  const merged: Record<string, unknown> = {
    processContextRef: 'process.ctx.alpha',
    prospectRef: PROSPECT,
    coreLookupRef: LOOKUP,
    availability: 'CORE_AUTHORED_PROCESS_CONTEXT_AVAILABLE',
    coreRegistrationProcessRef: CORE_PROCESS,
    observedAt: OBSERVED,
    ...over,
  };
  // An explicit `undefined` DROPS the key rather than stating it. A strict discriminated union
  // refuses a key the chosen variant does not declare whatever its value, which is the behaviour
  // under test elsewhere and would only be noise here.
  return Object.fromEntries(Object.entries(merged).filter(([, value]) => value !== undefined));
}

/** A copy of an object without one key. Rebuilt rather than deleted from. */
function without(value: object, dropped: string): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([key]) => key !== dropped));
}

function processContext(over: Record<string, unknown> = {}): CoreRegistrationProcessContext {
  const built = createCoreRegistrationProcessContext(processContextInput(over));
  if (!built.ok) throw new Error(`process context fixture refused: ${built.refusal}`);
  return built.processContext;
}

function briefInput(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    briefRef: 'brief.alpha',
    conversation: CONVERSATION_FIXTURE,
    interpretation: interpretation(),
    coreObservation: observation(),
    salesPlan: salesPlan(),
    registrationProcessContext: processContext(),
    preparedAt: PREPARED,
    ...over,
  };
}

/** Every key of an object, however deep, for scans that read values rather than text. */
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

const avg9Source = (): string =>
  readFileSync(join(SRC, 'contracts', 'avg9-registration-integration.ts'), 'utf8');

const codeOnly = (text: string): string =>
  text
    .replace(/\/\*[\s\S]*?\*\//gu, '')
    .split('\n')
    .filter((line) => !/^\s*\/\//u.test(line))
    .join('\n');

// ===========================================================================
// A. The base contract.
// ===========================================================================

describe('AVG-9 carries a reference to Core process context, never a process', () => {
  it('is version 1, and names the observation for what it is', () => {
    expect(AAROHI_AVG9_CONTRACT_VERSION).toBe(1);
    expect(AAROHI_AVG9_REGISTRATION_PROCESS_SOURCE_POSTURE).toBe(
      'INJECTED_OFFLINE_CORE_REGISTRATION_PROCESS_CONTEXT',
    );
    // The token says injected and offline. It does not say live, authenticated or verified.
    for (const forbidden of ['LIVE', 'AUTHENTICATED', 'PRODUCTION', 'VERIFIED', 'AUTHORITATIVE']) {
      expect(AAROHI_AVG9_REGISTRATION_PROCESS_SOURCE_POSTURE, forbidden).not.toContain(forbidden);
    }
    expect(CORE_REGISTRATION_ASSISTANCE_OUTCOME).toBe(
      'CORE_REGISTRATION_PROCESS_CONTEXT_READY_FOR_FUTURE_GOVERNED_ASSISTANCE',
    );
  });

  it('offers exactly three availability tokens, and none of them describes a workflow', () => {
    expect([...CORE_REGISTRATION_PROCESS_AVAILABILITIES]).toStrictEqual([
      'CORE_AUTHORED_PROCESS_CONTEXT_AVAILABLE',
      'CORE_AUTHORED_PROCESS_CONTEXT_UNAVAILABLE',
      'CORE_PROCESS_CONTEXT_UNKNOWN',
    ]);
    // Availability, never content. A member naming a step, a requirement or a readiness would be a
    // claim about a registration process this repository has never read.
    for (const one of CORE_REGISTRATION_PROCESS_AVAILABILITIES) {
      for (const forbidden of ['STEP', 'REQUIREMENT', 'DOCUMENT', 'KYC', 'READY', 'SIGNUP']) {
        expect(one, forbidden).not.toContain(forbidden);
      }
    }
  });

  it('accepts exactly the stated and stamped process-context fields, read from the source', () => {
    // Read from the source rather than from a list somebody maintains here, for the reason ADR-0125
    // records: `.strict()` refuses keys a schema does not KNOW about, and a key added to the schema
    // is a key it knows. A tenth field fails this spec before it could ever carry a signup step.
    const source = avg9Source();
    const stated = /const PROCESS_CONTEXT_STATED_FIELDS = \{([\s\S]*?)\n\} as const;/u.exec(source);
    const stamped = /const PROCESS_CONTEXT_STAMPED_FIELDS = \{([\s\S]*?)\n\} as const;/u.exec(
      source,
    );
    expect(stated).not.toBeNull();
    expect(stamped).not.toBeNull();
    expect(
      [...(stated?.[1] ?? '').matchAll(/^ {2}(\w+):/gmu)].map((match) => match[1]).sort(),
    ).toStrictEqual(['coreLookupRef', 'observedAt', 'processContextRef', 'prospectRef']);
    expect(
      [...(stamped?.[1] ?? '').matchAll(/^ {2}(\w+):/gmu)].map((match) => match[1]).sort(),
    ).toStrictEqual(['contractVersion', 'sourcePosture']);
  });

  it('accepts exactly seven brief input fields, so no override can be added quietly', () => {
    const source = avg9Source();
    const block = /const registrationBriefInputSchema = z\s*\.object\(\{([\s\S]*?)\}\)/u.exec(
      source,
    );
    expect(block).not.toBeNull();
    const fields = [...(block?.[1] ?? '').matchAll(/^ {4}(\w+):/gmu)].map((match) => match[1]);
    expect(fields.sort()).toStrictEqual([
      'briefRef',
      'conversation',
      'coreObservation',
      'interpretation',
      'preparedAt',
      'registrationProcessContext',
      'salesPlan',
    ]);
  });

  it('locks the accepted key surface of a built process context, in both directions', () => {
    const available = processContext();
    expect(Object.keys(available).sort()).toStrictEqual([
      'availability',
      'contractVersion',
      'coreLookupRef',
      'coreRegistrationProcessRef',
      'observedAt',
      'processContextRef',
      'prospectRef',
      'sourcePosture',
    ]);
    // Every key is load-bearing: removing any one refuses.
    for (const key of Object.keys(available)) {
      expect(
        coreRegistrationProcessContextSchema.safeParse(without(available, key)).success,
        key,
      ).toBe(false);
    }
    const absent = processContext({
      availability: 'CORE_AUTHORED_PROCESS_CONTEXT_UNAVAILABLE',
      coreRegistrationProcessRef: undefined,
    });
    expect(Object.keys(absent).sort()).toStrictEqual([
      'availability',
      'contractVersion',
      'coreLookupRef',
      'observedAt',
      'processContextRef',
      'prospectRef',
      'sourcePosture',
    ]);
  });

  it('locks the accepted key surface of a brief, in both directions', () => {
    const built = prepareAarohiRegistrationAssistanceBrief(briefInput());
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(Object.keys(built.brief).sort()).toStrictEqual([
      'briefRef',
      'contractVersion',
      'coreLookupRef',
      'coreRegistrationProcessRef',
      'interpretationRef',
      'outcome',
      'posture',
      'preparedAt',
      'processContextObservedAt',
      'processContextRef',
      'prospectRef',
      'salesPlanRef',
    ]);
    for (const key of Object.keys(built.brief)) {
      expect(
        aarohiRegistrationAssistanceBriefSchema.safeParse(without(built.brief, key)).success,
        key,
      ).toBe(false);
    }
    // And a key nobody reviewed cannot join either artifact.
    for (const extra of ['steps', 'requirements', 'registrationUrl', 'note', 'body']) {
      expect(
        aarohiRegistrationAssistanceBriefSchema.safeParse({ ...built.brief, [extra]: 'x' }).success,
        extra,
      ).toBe(false);
      expect(
        coreRegistrationProcessContextSchema.safeParse({ ...processContext(), [extra]: 'x' })
          .success,
        extra,
      ).toBe(false);
    }
  });

  it('names thirteen refusals, and keeps materially different failures apart', () => {
    expect([...REGISTRATION_ASSISTANCE_REFUSALS]).toStrictEqual([
      'REGISTRATION_INPUT_INVALID',
      'SALES_PLAN_INVALID',
      'SALES_PLAN_NOT_REDERIVABLE',
      'SALES_PLAN_POLICY_MISMATCH',
      'SALES_PLAN_NOT_CORE_PROCESS_CONTEXT',
      'SALES_PLAN_NOT_REGISTRATION_PROCESS',
      'REGISTRATION_PROCESS_CONTEXT_INVALID',
      'REGISTRATION_PROCESS_CONTEXT_BINDING_MISMATCH',
      'CORE_REGISTRATION_PROCESS_CONTEXT_NOT_AVAILABLE',
      'CORE_REGISTRATION_PROCESS_CONTEXT_UNRESOLVED',
      'REGISTRATION_PROCESS_CONTEXT_STALE_FOR_PLAN',
      'REGISTRATION_BRIEF_BEFORE_PROCESS_CONTEXT',
      'REGISTRATION_BRIEF_INVALID',
    ]);
    expect(new Set(REGISTRATION_ASSISTANCE_REFUSALS).size).toBe(
      REGISTRATION_ASSISTANCE_REFUSALS.length,
    );
  });

  it('imports nothing but zod and the two contracts it re-derives through', () => {
    const code = codeOnly(avg9Source());
    // It imports zod, AVG-7 (value and type) and AVG-1's refusal type. Nothing else, in particular
    // nothing that could register, order, pay, activate or send.
    const imports = [...code.matchAll(/from '([^']+)'/gu)].map((match) => match[1]);
    expect(imports.sort()).toStrictEqual([
      './avg7-sales-brain.js',
      './avg7-sales-brain.js',
      './existing-vendor-gate.js',
      'zod',
    ]);
  });

  it('returns frozen, detached values', () => {
    const built = prepareAarohiRegistrationAssistanceBrief(briefInput());
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(Object.isFrozen(built)).toBe(true);
    expect(Object.isFrozen(built.brief)).toBe(true);
    expect(Object.isFrozen(built.brief.posture)).toBe(true);
    expect(Object.isFrozen(processContext())).toBe(true);

    const reparsed = parseAarohiRegistrationAssistanceBrief(built.brief);
    expect(reparsed).toBeDefined();
    expect(reparsed).not.toBe(built.brief);
    expect(reparsed).toStrictEqual(built.brief);
  });

  it('stamps the version and the posture, and refuses a caller who states them', () => {
    const context = processContext();
    expect(context.contractVersion).toBe(AAROHI_AVG9_CONTRACT_VERSION);
    expect(context.sourcePosture).toBe(AAROHI_AVG9_REGISTRATION_PROCESS_SOURCE_POSTURE);

    for (const stated of [
      { contractVersion: 1 },
      { contractVersion: 2 },
      { sourcePosture: AAROHI_AVG9_REGISTRATION_PROCESS_SOURCE_POSTURE },
      { sourcePosture: 'LIVE_CORE_READ' },
      { sourcePosture: 'CORE_AUTHENTICATED' },
      { sourcePosture: 'PRODUCTION_VERIFIED' },
      { sourcePosture: 'AUTHORITATIVE_LIVE_CORE' },
    ]) {
      const built = createCoreRegistrationProcessContext({
        processContextRef: 'process.ctx.alpha',
        prospectRef: PROSPECT,
        coreLookupRef: LOOKUP,
        availability: 'CORE_AUTHORED_PROCESS_CONTEXT_AVAILABLE',
        coreRegistrationProcessRef: CORE_PROCESS,
        observedAt: OBSERVED,
        ...stated,
      });
      expect(built.ok, JSON.stringify(stated)).toBe(false);
      if (!built.ok) expect(built.refusal).toBe('REGISTRATION_INPUT_INVALID');
    }
  });

  it('refuses a process context that names a reference it says Core does not hold', () => {
    for (const availability of [
      'CORE_AUTHORED_PROCESS_CONTEXT_UNAVAILABLE',
      'CORE_PROCESS_CONTEXT_UNKNOWN',
    ]) {
      const built = createCoreRegistrationProcessContext({
        processContextRef: 'process.ctx.alpha',
        prospectRef: PROSPECT,
        coreLookupRef: LOOKUP,
        availability,
        coreRegistrationProcessRef: CORE_PROCESS,
        observedAt: OBSERVED,
      });
      expect(built.ok, availability).toBe(false);
    }
  });
});

// ===========================================================================
// B. Registration only. The AVG-8 and AVG-10 boundaries, both of which are adjacent.
// ===========================================================================

describe('only a registration question reaches AVG-9', () => {
  it('prepares a brief from an honest registration-process plan', () => {
    const built = prepareAarohiRegistrationAssistanceBrief(briefInput());
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.brief.outcome).toBe(CORE_REGISTRATION_ASSISTANCE_OUTCOME);
    expect(built.brief.prospectRef).toBe(PROSPECT);
    expect(built.brief.salesPlanRef).toBe('plan.alpha');
    expect(built.brief.interpretationRef).toBe('interp.001');
    expect(built.brief.coreLookupRef).toBe(LOOKUP);
    expect(built.brief.coreRegistrationProcessRef).toBe(CORE_PROCESS);
    expect(built.brief.processContextObservedAt).toBe(OBSERVED);
  });

  it('refuses PAYMENT_OR_ACTIVATION even though it reaches the same AVG-7 strategy', () => {
    // The whole point of this spec. AVG-7 routes registration AND payment/activation to
    // REQUEST_CORE_PROCESS_CONTEXT, so a strategy check alone would let AVG-10's work walk in
    // through a door AVG-9 shares with it.
    const plan = salesPlan('PAYMENT_OR_ACTIVATION');
    expect(plan.brief.strategy).toBe('REQUEST_CORE_PROCESS_CONTEXT');
    expect(plan.brief.intent).toBe('PAYMENT_OR_ACTIVATION');

    const built = prepareAarohiRegistrationAssistanceBrief(
      briefInput({
        interpretation: interpretation('PAYMENT_OR_ACTIVATION'),
        salesPlan: plan,
      }),
    );
    expect(built.ok).toBe(false);
    if (built.ok) return;
    expect(built.refusal).toBe('SALES_PLAN_NOT_REGISTRATION_PROCESS');
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
        intent: 'SERVICE_FIT',
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
      const built = prepareAarohiRegistrationAssistanceBrief(
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

  it('refuses a registration question that a contact-risk or commercial signal outranks', () => {
    // AVG-7's precedence, inherited whole. A registration question asked by somebody who also said
    // stop is a message that says stop; one asked alongside a price objection stops at Core
    // commercial context. Neither reaches a registration brief.
    for (const objectionKind of ['PRIVACY_OR_CONTACT', 'PRICE_OR_PACKAGE'] as const) {
      const plan = salesPlan('REGISTRATION_PROCESS', objectionKind);
      expect(plan.brief.strategy, objectionKind).not.toBe('REQUEST_CORE_PROCESS_CONTEXT');
      const built = prepareAarohiRegistrationAssistanceBrief(
        briefInput({
          interpretation: interpretation('REGISTRATION_PROCESS', objectionKind),
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
// C. The CURRENT turn.
// ===========================================================================

describe('the brief rests on the conversation as it is now', () => {
  it('refuses a reading of a turn that is no longer the latest', () => {
    const built = prepareAarohiRegistrationAssistanceBrief(
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
      const built = prepareAarohiRegistrationAssistanceBrief(
        briefInput({ interpretation: { ...interpretation(), [field]: 'other.handle' } }),
      );
      expect(built.ok, field).toBe(false);
      if (built.ok) continue;
      expect(built.refusal, field).toBe('SALES_PLAN_NOT_REDERIVABLE');
      if (built.refusal !== 'SALES_PLAN_NOT_REDERIVABLE') continue;
      expect(built.salesRefusal, field).toBe('INTERPRETATION_BINDING_MISMATCH');
    }
  });

  it('refuses an interpretation that names a different message of this conversation', () => {
    const built = prepareAarohiRegistrationAssistanceBrief(
      briefInput({
        interpretation: { ...interpretation(), instagramMessageRef: 'ig.message.999' },
      }),
    );
    expect(built.ok).toBe(false);
    if (built.ok) return;
    expect(built.refusal).toBe('SALES_PLAN_NOT_REDERIVABLE');
    if (built.refusal !== 'SALES_PLAN_NOT_REDERIVABLE') return;
    expect(built.salesRefusal).toBe('INTERPRETATION_NOT_FOR_LATEST_TURN');
  });

  it('refuses a malformed conversation and a malformed interpretation, distinguishably', () => {
    for (const one of [
      { over: { conversation: { prospectRef: PROSPECT } }, expected: 'CONVERSATION_INVALID' },
      {
        over: { interpretation: { interpretationRef: 'interp.001' } },
        expected: 'INTERPRETATION_INVALID',
      },
    ]) {
      const built = prepareAarohiRegistrationAssistanceBrief(briefInput(one.over));
      expect(built.ok, one.expected).toBe(false);
      if (built.ok) continue;
      expect(built.refusal, one.expected).toBe('SALES_PLAN_NOT_REDERIVABLE');
      if (built.refusal !== 'SALES_PLAN_NOT_REDERIVABLE') continue;
      expect(built.salesRefusal, one.expected).toBe(one.expected);
    }
  });
});

// ===========================================================================
// D. Re-derivation.
// ===========================================================================

describe('the AVG-7 plan is re-derived from scratch, never believed', () => {
  it('refuses a malformed plan as a shape failure, apart from every provenance failure', () => {
    for (const forged of [
      undefined,
      {},
      { planRef: 'plan.alpha' },
      { ...salesPlan(), coreStatus: 'REGISTERED' },
      { ...salesPlan(), brief: { ...salesPlan().brief, requiresCoreProcessContext: false } },
      { ...salesPlan(), posture: { ...AAROHI_SALES_BRAIN_POSTURE, registrationMutated: true } },
      { ...salesPlan(), extraField: 'x' },
    ]) {
      const built = prepareAarohiRegistrationAssistanceBrief(briefInput({ salesPlan: forged }));
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
      const built = prepareAarohiRegistrationAssistanceBrief(
        briefInput({ salesPlan: { ...salesPlan(), [field]: 'forged.handle' } }),
      );
      expect(built.ok, field).toBe(false);
      if (built.ok) continue;
      expect(built.refusal, field).toBe('SALES_PLAN_POLICY_MISMATCH');
    }
  });

  it('refuses a plan wearing another turn’s brief, even a perfectly consistent one', () => {
    // The AVG-8 lesson, and the case that makes a strategy-only comparison provably insufficient.
    // Both plans carry strategy REQUEST_CORE_PROCESS_CONTEXT and identical top-level fields; only
    // the nested brief differs, and AVG-7's own plan schema cannot object because the brief is
    // internally consistent. Only re-deriving and comparing the whole artifact catches it.
    const registration = salesPlan('REGISTRATION_PROCESS');
    const payment = salesPlan('PAYMENT_OR_ACTIVATION');
    expect(registration.brief.strategy).toBe(payment.brief.strategy);

    const swapped = { ...registration, brief: payment.brief };
    const built = prepareAarohiRegistrationAssistanceBrief(briefInput({ salesPlan: swapped }));
    expect(built.ok).toBe(false);
    if (built.ok) return;
    expect(built.refusal).toBe('SALES_PLAN_POLICY_MISMATCH');

    // And the other direction: a payment conversation cannot be dressed as a registration one.
    const disguised = { ...payment, brief: registration.brief };
    const other = prepareAarohiRegistrationAssistanceBrief(
      briefInput({
        interpretation: interpretation('PAYMENT_OR_ACTIVATION'),
        salesPlan: disguised,
      }),
    );
    expect(other.ok).toBe(false);
    if (other.ok) return;
    expect(other.refusal).toBe('SALES_PLAN_POLICY_MISMATCH');
  });

  it('compares the whole artifact structurally, so a new AVG-7 field cannot be ignored', () => {
    // The comparison walks the recomputed object's own keys rather than a list written here, which
    // is what makes the previous spec generalise. A plan with an extra key is refused before the
    // comparison by AVG-7's strict schema; a plan MISSING a key it should carry is caught by the
    // comparison itself, and both directions matter.
    const plan = salesPlan();
    const source = codeOnly(avg9Source());
    expect(source).toContain('function sameCanonicalValue');
    // No enumerated field list: the comparison must not name AVG-7's fields one by one.
    expect(source).not.toContain('left.instagramThreadRef === right.instagramThreadRef');

    const stripped: Record<string, unknown> = { ...plan };
    delete stripped['coreLookupRef'];
    const built = prepareAarohiRegistrationAssistanceBrief(briefInput({ salesPlan: stripped }));
    expect(built.ok).toBe(false);
    if (built.ok) return;
    // AVG-7's own schema refuses it first, which is the correct order and is asserted so the
    // comparison is not credited with a guard the parser already provides.
    expect(built.refusal).toBe('SALES_PLAN_INVALID');
  });

  it('gives the caller no way to state a strategy, an outcome or a posture', () => {
    for (const forged of [
      { strategy: 'REQUEST_CORE_PROCESS_CONTEXT' },
      { intent: 'REGISTRATION_PROCESS' },
      { outcome: CORE_REGISTRATION_ASSISTANCE_OUTCOME },
      { posture: AAROHI_REGISTRATION_ASSISTANCE_POSTURE },
      { skipRederivation: true },
      { coreRegistrationProcessRef: CORE_PROCESS },
      { registrationSteps: ['verify', 'pay'] },
    ]) {
      const built = prepareAarohiRegistrationAssistanceBrief(briefInput(forged));
      expect(built.ok, JSON.stringify(forged)).toBe(false);
      if (built.ok) continue;
      expect(built.refusal, JSON.stringify(forged)).toBe('REGISTRATION_INPUT_INVALID');
    }
  });

  it('does not rewrite the AVG-7 plan it rested on', () => {
    const plan = salesPlan();
    const built = prepareAarohiRegistrationAssistanceBrief(briefInput({ salesPlan: plan }));
    expect(built.ok).toBe(true);
    // The plan recorded that Core process facts were MISSING when it was made. That stays true.
    expect(plan.brief.requiresCoreProcessContext).toBe(true);
    expect(plan.brief.futureModelDraftEligible).toBe(false);
    expect(plan.posture.registrationMutated).toBe(false);
  });
});

// ===========================================================================
// E. The CURRENT Core status.
// ===========================================================================

describe('the CURRENT Core gate runs again, and only NOT_REGISTERED proceeds', () => {
  it('drives every governed Core status through the brief builder', () => {
    for (const status of CORE_PARTY_STATUSES) {
      const built = prepareAarohiRegistrationAssistanceBrief(
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
      // AVG-1's role map decides the reason, and AVG-9 does not restate it.
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

  it('names the four statuses AVG-9 exists to keep apart', () => {
    // Spelled out rather than left to the loop above, because these four are the ones a reader of
    // ADR-0126 will come here to check.
    for (const one of [
      { status: 'REGISTERED' as const, reason: 'EXISTING_CORE_RELATIONSHIP' },
      { status: 'ACTIVE' as const, reason: 'EXISTING_CORE_RELATIONSHIP' },
      { status: 'DO_NOT_CONTACT' as const, reason: 'CORE_SUPPRESSED' },
      { status: 'UNKNOWN' as const, reason: 'CORE_TRUTH_UNRESOLVED' },
    ]) {
      const built = prepareAarohiRegistrationAssistanceBrief(
        briefInput({ coreObservation: observation(one.status) }),
      );
      expect(built.ok, one.status).toBe(false);
      if (built.ok) continue;
      expect(built.refusal, one.status).toBe('SALES_PLAN_NOT_REDERIVABLE');
      if (built.refusal !== 'SALES_PLAN_NOT_REDERIVABLE') continue;
      expect(built.salesRefusal, one.status).toBe('CORE_GATE_REFUSED');
      if (built.salesRefusal !== 'CORE_GATE_REFUSED') continue;
      expect(built.coreReason, one.status).toBe(one.reason);
    }
  });

  it('refuses an observation about another prospect, and a malformed one', () => {
    for (const forged of [
      observation('NOT_REGISTERED', { prospectRef: 'prospect.other' }),
      { prospectRef: PROSPECT, status: 'NOT_REGISTERED' },
      { prospectRef: PROSPECT, coreLookupRef: LOOKUP, status: 'MADE_UP' },
      undefined,
    ]) {
      const built = prepareAarohiRegistrationAssistanceBrief(
        briefInput({ coreObservation: forged }),
      );
      expect(built.ok, JSON.stringify(forged)).toBe(false);
      if (built.ok) continue;
      expect(built.refusal).toBe('SALES_PLAN_NOT_REDERIVABLE');
      if (built.refusal !== 'SALES_PLAN_NOT_REDERIVABLE') continue;
      expect(built.salesRefusal).toBe('CORE_GATE_REFUSED');
      if (built.salesRefusal !== 'CORE_GATE_REFUSED') continue;
      expect(built.coreReason).toBe('OBSERVATION_INVALID');
    }
  });

  it('accepts no interest, enthusiasm or identity evidence as an override', () => {
    // There is no field through which any of those could be supplied, and the strict input schema
    // is where that is proved: the seven accepted fields are locked above, and not one of them is a
    // score, a priority, an identity recommendation, a package choice or a gate override.
    for (const forged of [
      { priority: 'HIGH' },
      { prospectPriority: 90 },
      { commercialInterest: true },
      { identityLinkRecommendation: { linked: true } },
      { packageChoice: 'starter' },
      { overrideCoreGate: true },
      { coreStatus: 'NOT_REGISTERED' },
    ]) {
      const built = prepareAarohiRegistrationAssistanceBrief(briefInput(forged));
      expect(built.ok, JSON.stringify(forged)).toBe(false);
      if (built.ok) continue;
      expect(built.refusal, JSON.stringify(forged)).toBe('REGISTRATION_INPUT_INVALID');
    }
  });
});

// ===========================================================================
// F. Core process context.
// ===========================================================================

describe('Core process context is carried by reference, and never invented', () => {
  it('refuses a malformed observation', () => {
    for (const forged of [
      undefined,
      {},
      { processContextRef: 'process.ctx.alpha' },
      { ...processContext(), availability: 'MADE_UP' },
      { ...processContext(), observedAt: 'yesterday' },
      { ...processContext(), sourcePosture: 'LIVE_CORE_READ' },
      { ...processContext(), contractVersion: 2 },
    ]) {
      const built = prepareAarohiRegistrationAssistanceBrief(
        briefInput({ registrationProcessContext: forged }),
      );
      expect(built.ok, JSON.stringify(forged)).toBe(false);
      if (built.ok) continue;
      expect(built.refusal, JSON.stringify(forged)).toBe('REGISTRATION_PROCESS_CONTEXT_INVALID');
    }
  });

  it('refuses an observation bound to another prospect or another Core lookup', () => {
    for (const over of [
      { prospectRef: 'prospect.other' },
      { coreLookupRef: 'core.lookup.other' },
    ]) {
      const built = prepareAarohiRegistrationAssistanceBrief(
        briefInput({ registrationProcessContext: processContext(over) }),
      );
      expect(built.ok, JSON.stringify(over)).toBe(false);
      if (built.ok) continue;
      expect(built.refusal, JSON.stringify(over)).toBe(
        'REGISTRATION_PROCESS_CONTEXT_BINDING_MISMATCH',
      );
    }
  });

  it('refuses to guess when Core holds no process context, and says which absence it was', () => {
    for (const one of [
      {
        availability: 'CORE_AUTHORED_PROCESS_CONTEXT_UNAVAILABLE',
        refusal: 'CORE_REGISTRATION_PROCESS_CONTEXT_NOT_AVAILABLE',
      },
      {
        availability: 'CORE_PROCESS_CONTEXT_UNKNOWN',
        refusal: 'CORE_REGISTRATION_PROCESS_CONTEXT_UNRESOLVED',
      },
    ]) {
      const built = prepareAarohiRegistrationAssistanceBrief(
        briefInput({
          registrationProcessContext: processContext({
            availability: one.availability,
            coreRegistrationProcessRef: undefined,
          }),
        }),
      );
      expect(built.ok, one.availability).toBe(false);
      if (built.ok) continue;
      expect(built.refusal, one.availability).toBe(one.refusal);
    }
  });

  it('has nowhere to put a registration step, a requirement or an endpoint', () => {
    for (const forged of [
      { steps: ['verify mobile', 'upload GST'] },
      { requirements: ['gst'] },
      { documents: ['pan'] },
      { registrationUrl: 'quickfurno.com' },
      { signupEndpoint: 'register' },
      { otp: '123456' },
      { password: 'hunter2' },
      { gstNumber: '27AAAAA0000A1Z5' },
      { email: 'a.b' },
      { verificationRequired: true },
      { estimatedMinutes: 10 },
    ]) {
      const built = createCoreRegistrationProcessContext({
        processContextRef: 'process.ctx.alpha',
        prospectRef: PROSPECT,
        coreLookupRef: LOOKUP,
        availability: 'CORE_AUTHORED_PROCESS_CONTEXT_AVAILABLE',
        coreRegistrationProcessRef: CORE_PROCESS,
        observedAt: OBSERVED,
        ...forged,
      });
      expect(built.ok, JSON.stringify(forged)).toBe(false);
      if (built.ok) continue;
      expect(built.refusal, JSON.stringify(forged)).toBe('REGISTRATION_INPUT_INVALID');
    }
  });

  it('screens the references AVG-9 invents, and leaves inherited grammars alone', () => {
    // The three local references carry the contact shapes AND the digit count. A signup URL cannot
    // enter under any punctuation, and neither can an address or a dialable run.
    for (const forged of [
      'www.quickfurno.com',
      'quickfurno.com/register',
      'register@quickfurno.co',
      '919812345678',
      '9_1_9_8_1_2_3_4_5_6_7_8',
    ]) {
      expect(
        createCoreRegistrationProcessContext({
          processContextRef: 'process.ctx.alpha',
          prospectRef: PROSPECT,
          coreLookupRef: LOOKUP,
          availability: 'CORE_AUTHORED_PROCESS_CONTEXT_AVAILABLE',
          coreRegistrationProcessRef: forged,
          observedAt: OBSERVED,
        }).ok,
        forged,
      ).toBe(false);
      expect(
        prepareAarohiRegistrationAssistanceBrief(briefInput({ briefRef: forged })).ok,
        forged,
      ).toBe(false);
    }

    // And an INHERITED reference keeps the grammar its owner certified. A numeric provider-native
    // identifier is an identifier; narrowing it here would be a downstream stage re-judging a
    // grammar it does not own, which is exactly what ADR-0124 corrected.
    const numericLookup = '919812345678';
    const rebuilt = createCoreRegistrationProcessContext({
      processContextRef: 'process.ctx.alpha',
      prospectRef: PROSPECT,
      coreLookupRef: numericLookup,
      availability: 'CORE_AUTHORED_PROCESS_CONTEXT_AVAILABLE',
      coreRegistrationProcessRef: CORE_PROCESS,
      observedAt: OBSERVED,
    });
    expect(rebuilt.ok).toBe(true);
  });

  it('rebuilds a parsed observation rather than trusting the object it was shown', () => {
    const built = parseCoreRegistrationProcessContext({
      contractVersion: AAROHI_AVG9_CONTRACT_VERSION,
      processContextRef: 'process.ctx.alpha',
      prospectRef: PROSPECT,
      coreLookupRef: LOOKUP,
      availability: 'CORE_AUTHORED_PROCESS_CONTEXT_AVAILABLE',
      coreRegistrationProcessRef: CORE_PROCESS,
      observedAt: OBSERVED,
      sourcePosture: AAROHI_AVG9_REGISTRATION_PROCESS_SOURCE_POSTURE,
    });
    expect(built).toBeDefined();
    expect(Object.isFrozen(built)).toBe(true);
    expect(parseCoreRegistrationProcessContext({ ...processContext(), rogue: 1 })).toBeUndefined();
  });
});

// ===========================================================================
// G. Causality.
// ===========================================================================

describe('the causal chain holds, by instant and never by spelling', () => {
  it('accepts the whole chain, message to brief', () => {
    const built = prepareAarohiRegistrationAssistanceBrief(briefInput());
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const chain = [AT, INTERPRETED, PLANNED, OBSERVED, PREPARED].map((one) => Date.parse(one));
    expect(chain).toStrictEqual([...chain].sort((left, right) => left - right));
    expect(Date.parse(built.brief.processContextObservedAt)).toBeGreaterThanOrEqual(
      Date.parse(PLANNED),
    );
    expect(Date.parse(built.brief.preparedAt)).toBeGreaterThanOrEqual(
      Date.parse(built.brief.processContextObservedAt),
    );
  });

  it('refuses a process-context observation older than the plan that asked for it', () => {
    const built = prepareAarohiRegistrationAssistanceBrief(
      briefInput({
        registrationProcessContext: processContext({ observedAt: '2026-08-27T09:09:59Z' }),
      }),
    );
    expect(built.ok).toBe(false);
    if (built.ok) return;
    expect(built.refusal).toBe('REGISTRATION_PROCESS_CONTEXT_STALE_FOR_PLAN');
  });

  it('allows the same instant and any instant after it', () => {
    for (const observedAt of [PLANNED, '2026-08-27T09:10:00.000Z', '2026-08-27T09:10:00.001Z']) {
      const built = prepareAarohiRegistrationAssistanceBrief(
        briefInput({ registrationProcessContext: processContext({ observedAt }) }),
      );
      expect(built.ok, observedAt).toBe(true);
    }
  });

  it('refuses a brief that claims to predate its own process-context observation', () => {
    const built = prepareAarohiRegistrationAssistanceBrief(
      briefInput({ preparedAt: '2026-08-27T09:14:59Z' }),
    );
    expect(built.ok).toBe(false);
    if (built.ok) return;
    expect(built.refusal).toBe('REGISTRATION_BRIEF_BEFORE_PROCESS_CONTEXT');

    for (const preparedAt of [OBSERVED, '2026-08-27T09:15:00.000Z']) {
      expect(
        prepareAarohiRegistrationAssistanceBrief(briefInput({ preparedAt })).ok,
        preparedAt,
      ).toBe(true);
    }
  });

  it('compares the instant a timestamp MEANS, not the way it is spelled', () => {
    // `09:10:00.500Z` sorts BEFORE `09:10:00Z` as a string, while being half a second later. A
    // comparator that compared the strings would accept an observation made before the plan.
    const late = canonicalInstant('2026-08-27T09:10:00.500Z');
    const early = canonicalInstant('2026-08-27T09:10:00Z');
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

    const built = prepareAarohiRegistrationAssistanceBrief(
      briefInput({
        salesPlan: planned.plan,
        registrationProcessContext: processContext({ observedAt: early }),
      }),
    );
    expect(built.ok).toBe(false);
    if (built.ok) return;
    expect(built.refusal).toBe('REGISTRATION_PROCESS_CONTEXT_STALE_FOR_PLAN');
  });

  it('inherits both earlier links of the chain from AVG-7, in both wrong directions', () => {
    const beforeMessage = prepareAarohiRegistrationAssistanceBrief(
      briefInput({
        interpretation: { ...interpretation(), interpretedAt: '2026-08-27T08:59:59Z' },
      }),
    );
    expect(beforeMessage.ok).toBe(false);
    if (beforeMessage.ok) return;
    expect(beforeMessage.refusal).toBe('SALES_PLAN_NOT_REDERIVABLE');
    if (beforeMessage.refusal !== 'SALES_PLAN_NOT_REDERIVABLE') return;
    expect(beforeMessage.salesRefusal).toBe('INTERPRETATION_BEFORE_MESSAGE');

    const beforeInterpretation = prepareAarohiRegistrationAssistanceBrief(
      briefInput({ salesPlan: { ...salesPlan(), plannedAt: '2026-08-27T09:04:59Z' } }),
    );
    expect(beforeInterpretation.ok).toBe(false);
    if (beforeInterpretation.ok) return;
    expect(beforeInterpretation.refusal).toBe('SALES_PLAN_NOT_REDERIVABLE');
    if (beforeInterpretation.refusal !== 'SALES_PLAN_NOT_REDERIVABLE') return;
    expect(beforeInterpretation.salesRefusal).toBe('PLAN_BEFORE_INTERPRETATION');
  });

  it('refuses a timestamp that is not a real instant', () => {
    for (const instant of [
      '2026-02-30T09:15:00Z',
      '2026-08-27T25:00:00Z',
      '2026-08-27 09:15:00Z',
      '2026-08-27T09:15:00+05:30',
      '2026-08-27T09:15:00.1234Z',
    ]) {
      expect(
        createCoreRegistrationProcessContext({
          processContextRef: 'process.ctx.alpha',
          prospectRef: PROSPECT,
          coreLookupRef: LOOKUP,
          availability: 'CORE_AUTHORED_PROCESS_CONTEXT_AVAILABLE',
          coreRegistrationProcessRef: CORE_PROCESS,
          observedAt: instant,
        }).ok,
        instant,
      ).toBe(false);
      expect(
        prepareAarohiRegistrationAssistanceBrief(briefInput({ preparedAt: instant })).ok,
        instant,
      ).toBe(false);
    }
  });
});

// ===========================================================================
// H..L. The authority ceiling, as literals.
// ===========================================================================

describe('every brief pins the authority ceiling as literals', () => {
  const DECLARED_FALSE = [
    'processContextSourceAuthenticated',

    'registrationProcessInvented',
    'registrationConfirmed',
    'vendorRecordCreated',
    'registrationMutated',

    'marketplaceMutated',
    'acquisitionCaseMutated',
    'paymentMutated',
    'activationMutated',
    'anishaHandoffExecuted',

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
    'requiresCoreRegistrationExecution',
    'registrationProcessContextReadyForFutureGovernedAssistance',
    'requiresCoreStatusRevalidationBeforeFutureOutboundUse',
  ] as const;

  const posture = AAROHI_REGISTRATION_ASSISTANCE_POSTURE as unknown as Readonly<
    Record<string, unknown>
  >;

  it('holds every declaration on every reachable brief', () => {
    const built = prepareAarohiRegistrationAssistanceBrief(briefInput());
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const carried = built.brief.posture as unknown as Readonly<Record<string, unknown>>;
    for (const declared of DECLARED_FALSE) {
      expect(carried[declared], declared).toBe(false);
    }
    for (const declared of DECLARED_TRUE) {
      expect(carried[declared], declared).toBe(true);
    }
    expect(carried).toBe(AAROHI_REGISTRATION_ASSISTANCE_POSTURE);
  });

  it('is complete: the list and the posture agree, in both directions', () => {
    // A governance list that can quietly lose a member is a list that eventually will.
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
      { registrationMutated: true },
      { registrationConfirmed: true },
      { registrationProcessInvented: true },
      { vendorRecordCreated: true },
      { acquisitionCaseMutated: true },
      { marketplaceMutated: true },
      { paymentMutated: true },
      { activationMutated: true },
      { anishaHandoffExecuted: true },
      { modelCallExecuted: true },
      { executionIntentCreated: true },
      { channelSendRequested: true },
      { processContextSourceAuthenticated: true },
      { productionMutation: true },
      { businessEffect: true },
      { assistanceContextOnly: false },
      { requiresCoreRegistrationExecution: false },
      { requiresCoreStatusRevalidationBeforeFutureOutboundUse: false },
    ]) {
      expect(
        aarohiRegistrationAssistancePostureSchema.safeParse({ ...posture, ...forged }).success,
        JSON.stringify(forged),
      ).toBe(false);
    }
    // And a posture with a field nobody reviewed is not a posture.
    expect(
      aarohiRegistrationAssistancePostureSchema.safeParse({
        ...posture,
        registrationStarted: false,
      }).success,
    ).toBe(false);
  });

  it('refuses a hand-built brief carrying any of them wrong', () => {
    const built = prepareAarohiRegistrationAssistanceBrief(briefInput());
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    for (const forged of [
      { registrationMutated: true },
      { acquisitionCaseMutated: true },
      { anishaHandoffExecuted: true },
      { requiresCoreRegistrationExecution: false },
    ]) {
      expect(
        aarohiRegistrationAssistanceBriefSchema.safeParse({
          ...built.brief,
          posture: { ...built.brief.posture, ...forged },
        }).success,
        JSON.stringify(forged),
      ).toBe(false);
    }
  });
});

describe('AVG-9 carries no content, no destination and no secret', () => {
  it('carries no key that could hold a sentence, a step or a destination', () => {
    const built = prepareAarohiRegistrationAssistanceBrief(briefInput());
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const declarations = new Set(Object.keys(AAROHI_REGISTRATION_ASSISTANCE_POSTURE));
    const keys = walkKeys(built.brief)
      .filter((key) => !declarations.has(key))
      // `context` is removed before the scan because it CONTAINS `text`, and a field named
      // `processContextRef` is the opposite of a field holding free text. Every other token below
      // is matched against the whole key.
      .map((key) => key.toLowerCase().split('context').join(''));
    for (const forbidden of [
      // Content.
      'body',
      'message',
      'text',
      'reply',
      'pitch',
      'copy',
      'script',
      'instruction',
      'guidance',
      'explanation',
      'summary',
      'reason',
      'description',
      // A workflow.
      'step',
      'stage',
      'requirement',
      'document',
      'checklist',
      'kyc',
      'verification',
      // A destination or a secret.
      'url',
      'link',
      'endpoint',
      'phone',
      'mobile',
      'whatsapp',
      'email',
      'recipient',
      'destination',
      'password',
      'otp',
      'token',
      'secret',
      'credential',
      'apikey',
    ]) {
      expect(
        keys.filter((key) => key.includes(forbidden)),
        forbidden,
      ).toStrictEqual([]);
    }
  });

  it('carries only opaque references and canonical instants as values', () => {
    const built = prepareAarohiRegistrationAssistanceBrief(briefInput());
    expect(built.ok).toBe(true);
    if (!built.ok) return;

    // Instants are separated from references before the destination screens run, because a
    // canonical UTC instant IS a long run of digits with separators in it and would trip the
    // dialable-run shape every time. They are checked against the canonical grammar instead, which
    // is the stronger statement for a timestamp: it is exactly a date, and cannot be anything else.
    for (const [key, value] of walkStringEntries(built.brief)) {
      if (key.endsWith('At')) {
        expect(value, key).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u);
        continue;
      }
      // No address, no scheme, no bare host, and no dialable run in any reference or token.
      expect(value, key).not.toMatch(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/u);
      expect(value, key).not.toMatch(/(?:[A-Za-z][A-Za-z0-9+.-]*:)?\/\//u);
      expect(value.toLowerCase(), key).not.toContain('www.');
      expect(value, key).not.toMatch(/(?:\d[\s().+-]{0,2}){7,}/u);
    }
  });
});

describe('AVG-9 reaches no Core write, no execution path and no model', () => {
  const code = (): string => codeOnly(avg9Source());

  it('never names QuickFurno registration, payment or activation write path', () => {
    for (const forbidden of [
      // The one function in QuickFurno that actually registers a vendor, and its input type.
      'registerVendor',
      'VendorRegistrationInput',
      'vendorService',
      'createVendor',
      'updateVendor',
      'activateVendor',
      'vendorAuthService',
      'vendorAccessService',
      // AVG-10's territory, in every spelling.
      'completeCoreActiveHandoff',
      'purchasePackage',
      'createVendorPackageOrder',
      'createManualPayment',
      'markPaymentPaid',
      'assignPackageToVendor',
      'grantCredits',
      'processPayment',
      // Acquisition-case ownership, which AVG-9 does not touch.
      'transitionAcquisitionCase',
      'openAcquisitionCase',
      'REGISTRATION_STARTED',
      'PAYMENT_PENDING',
      'HANDED_OFF_TO_ANISHA',
      'AWAITING_CORE_ACTIVATION',
      'activationAttestation',
      // AVG-8's commercial engine, which AVG-9 neither calls nor reinterprets.
      'prepareAarohiCommercialFactsBrief',
      'parseCoreCommercialCatalogSnapshot',
    ]) {
      expect(code(), `AVG-9 must not name ${forbidden}`).not.toContain(forbidden);
    }
  });

  it('opens no network, database, model, prompt or retrieval path', () => {
    const lowered = code().toLowerCase();
    for (const forbidden of [
      'supabase',
      'adminclient',
      'servicerole',
      'createclient',
      '.from(',
      '.select(',
      '.rpc(',
      'process.env',
      'fetch(',
      'axios',
      'node:http',
      'node:fs',
      'model-gateway',
      'prompt-registry',
      '@mastra',
      'openai',
      'anthropic',
      'embedding',
      'systemprompt',
      'quickfurno-marketplace',
    ]) {
      expect(lowered, `AVG-9 must not name ${forbidden}`).not.toContain(forbidden);
    }
    expect(code()).not.toMatch(/https?:\/\//u);
  });

  it('creates no communication, approval, authorization or execution artifact', () => {
    for (const forbidden of [
      'CommunicationRequestV1',
      'ApprovalRequestV1',
      'ApprovalDecisionV1',
      'CommunicationAuthorization',
      'ExecutionIntent',
      'createCommunicationRequest',
      'createApprovalRequest',
      'prepareInstagramOutboundCandidate',
      'prepareWhatsAppChannelHandoffCandidate',
      'createOutreachDraft',
    ]) {
      expect(code(), `AVG-9 must not name ${forbidden}`).not.toContain(forbidden);
    }
    // The declarations of absence are separately present and false, which is the stronger check.
    const posture = AAROHI_REGISTRATION_ASSISTANCE_POSTURE as unknown as Readonly<
      Record<string, unknown>
    >;
    for (const declared of [
      'communicationRequestCreated',
      'approvalRequestCreated',
      'approvalDecisionCreated',
      'communicationAuthorizationCreated',
      'executionIntentCreated',
      'n8nExecutionRequested',
      'providerSendRequested',
      'channelSendRequested',
    ]) {
      expect(posture[declared], declared).toBe(false);
    }
  });

  it('persists nothing and allocates no schema change', () => {
    const lowered = code().toLowerCase();
    for (const forbidden of [
      'create table',
      'alter table',
      'insert into',
      'delete from',
      'primary key',
      'migration',
      '.sql',
      'repository',
      'createstore',
    ]) {
      expect(lowered, `AVG-9 must not contain ${forbidden}`).not.toContain(forbidden);
    }
  });
});

// ===========================================================================
// What the mutation campaign found. Each spec here exists because a mutation
// survived without it, and ADR-0126 records which.
// ===========================================================================

describe('the proofs the mutation campaign asked for', () => {
  it('refuses a hand-built brief that claims to predate its own process-context observation', () => {
    // The builder checks this and returns REGISTRATION_BRIEF_BEFORE_PROCESS_CONTEXT. The public
    // PARSER is a second entrance, and a brief arriving through it had no builder to stop it — so
    // the schema carries the same rule, and this is what proves the schema carries it. Removing
    // the refine survived every other spec.
    const built = prepareAarohiRegistrationAssistanceBrief(briefInput());
    expect(built.ok).toBe(true);
    if (!built.ok) return;

    expect(
      parseAarohiRegistrationAssistanceBrief({
        ...built.brief,
        preparedAt: '2026-08-27T09:14:59Z',
      }),
    ).toBeUndefined();
    expect(
      parseAarohiRegistrationAssistanceBrief({
        ...built.brief,
        processContextObservedAt: '2026-08-27T09:21:00Z',
      }),
    ).toBeUndefined();
    // The boundary is inclusive, in both canonical spellings of the same moment.
    for (const preparedAt of [OBSERVED, '2026-08-27T09:15:00.000Z']) {
      expect(
        parseAarohiRegistrationAssistanceBrief({ ...built.brief, preparedAt }),
        preparedAt,
      ).toBeDefined();
    }
  });

  it('carries an upstream identity grammar end to end without narrowing it', () => {
    // ADR-0124's correction, at the next boundary that could repeat it. `919812345678` is a
    // canonical provider-native identifier and `www.example.com` is a canonical opaque token; both
    // belong to grammars AVG-1 and AVG-5 own. Screening them HERE would mean an artifact those
    // stages certified is refused downstream, which is a cross-stage incompatibility rather than a
    // safety measure. Narrowing the inherited fields survived every other spec.
    for (const token of ['919812345678', 'www.example.com']) {
      const conversation = conversationWith([{ ref: MESSAGE, at: AT }], token);
      const reading = createAarohiSalesBrainInterpretation({
        interpretationRef: 'interp.001',
        conversation,
        intent: 'REGISTRATION_PROCESS',
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

      const built = prepareAarohiRegistrationAssistanceBrief({
        briefRef: 'brief.alpha',
        conversation,
        interpretation: reading.interpretation,
        coreObservation,
        salesPlan: plan.plan,
        registrationProcessContext: processContext({ prospectRef: token, coreLookupRef: token }),
        preparedAt: PREPARED,
      });
      expect(built.ok, token).toBe(true);
      if (!built.ok) continue;
      expect(built.brief.prospectRef, token).toBe(token);
      expect(built.brief.coreLookupRef, token).toBe(token);
    }
  });

  it('compares two plans whose key sets one parser fixes, and says so', () => {
    // A mutation dropping the key-set agreement check survives, and ADR-0126 reports it as
    // structurally unreachable rather than deleting the check. The claim is verified here: both
    // operands of the comparison come from `parseAarohiSalesTurnPlan` / `evaluateAarohiSalesTurn`,
    // which build from a strict schema and therefore emit exactly these thirteen keys — so the two
    // key sets cannot differ today. The check is kept for the day AVG-7 adds a fourteenth.
    const plan = salesPlan();
    const reparsed = parseAarohiSalesTurnPlan(plan);
    expect(reparsed).toBeDefined();
    expect(Object.keys(reparsed ?? {}).sort()).toStrictEqual([
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
    expect(Object.keys(reparsed ?? {}).sort()).toStrictEqual(Object.keys(plan).sort());
  });

  it('cannot tell two plans apart by their posture, and this is why', () => {
    // A mutation making plan equality ignore the nested POSTURE survives, and ADR-0126 reports it
    // as structurally unreachable rather than quietly deleting the comparison. That claim is
    // verified here rather than asserted: AVG-7's posture schema admits exactly one value, so every
    // plan that parses carries the identical frozen constant and the comparison cannot change an
    // outcome today. It is kept because the day AVG-7 relaxes a literal is the day it starts to.
    const posture = AAROHI_SALES_BRAIN_POSTURE as unknown as Readonly<Record<string, unknown>>;
    for (const [key, value] of Object.entries(posture)) {
      expect(
        salesBrainPostureSchema.safeParse({ ...posture, [key]: !(value as boolean) }).success,
        key,
      ).toBe(false);
      expect(salesBrainPostureSchema.safeParse(without(posture, key)).success, key).toBe(false);
    }
    expect(salesBrainPostureSchema.safeParse({ ...posture, extra: false }).success).toBe(false);
  });

  it('reads the RE-DERIVED intent, not the supplied one — and both guards are needed', () => {
    // Reading `suppliedPlan.brief.intent` instead of the re-derived one survives on its own,
    // because the equality proof has already made the two identical. That is a masked mutation
    // rather than a weak boundary, and the PROPERTY is what this spec pins: with equality degraded
    // AND the supplied value read, a forged payment plan would be admitted. Both are asserted.
    const source = codeOnly(avg9Source());
    expect(source).toContain("if (reDerived.plan.brief.intent !== 'REGISTRATION_PROCESS')");
    expect(source).toContain('if (!sameSalesTurnPlan(reDerived.plan, suppliedPlan))');
    expect(source).not.toContain('suppliedPlan.brief.intent');
    expect(source).not.toContain('suppliedPlan.brief.strategy');
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

  it('records the certified range and AVG-9 as a defined proof', () => {
    const certified = /AVG-0 through AVG-(\d+) — implemented as certified offline domains/u.exec(
      overlay,
    );
    expect(certified).not.toBeNull();
    // AVG-9's own line moves from "the defined proof" into the certified list as later stages
    // land, which is the roadmap working rather than breaking. What ENDURES is that the certified
    // range has reached AVG-9 and that ADR-0126 is the document defining it — both of which stay
    // true for every future stage, and both of which are false if somebody reverts the stage to
    // "planned and unimplemented".
    expect(Number(certified?.[1] ?? '0')).toBeGreaterThanOrEqual(9);
    expect(overlay).toContain(
      'ADR-0126-qfj-p12-avg9-aarohi-registration-integration-offline-domain.md',
    );
    expect(overlay).toContain('PLANNED / DISABLED');
  });

  it('keeps payment and activation authority with Core, wherever AVG-10 has reached', () => {
    // Which stages are still unimplemented changes as the overlay advances; that AVG-10's authority
    // belongs to Core does not, and neither does the existence of an unimplemented tail. Asserting
    // the enduring half keeps this spec honest after AVG-10 lands instead of one merge later.
    expect(overlay).toContain('### AVG-10 — Payment, Activation and Anisha Handoff');
    expect(overlay).toContain("activation authority are **Core's alone**");
    // The overlay used to carry an unimplemented tail and this spec asserted one existed. AVG-12
    // closed the sequence (ADR-0130), so the enduring half is asserted instead: the offline work
    // being finished is not the same thing as Aarohi being certified.
    expect(overlay).toMatch(/full Aarohi\s+certification is a SEPARATE owner closeout/u);
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
