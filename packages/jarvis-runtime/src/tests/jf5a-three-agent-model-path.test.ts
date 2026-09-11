/**
 * JF-5A — all three agents reach the model gateway, each under its own prompt, and count exactly once.
 *
 * ### What changed, and what this measures
 *
 * ADR-0150 §41 recorded Aarohi's honest residue: she was routed, decided and grounded, and a
 * model-eligible acquisition turn then failed closed because `MODEL_AGENT_SCOPES` and
 * `PROMPT_AGENT_SCOPES` could not name `PROSPECT`. JF-5A adds that scope to both (and to the evaluation
 * mirror), and gives Anisha and Aarohi the governed prompts neither had.
 *
 * So this file measures the thing that was impossible before: a real `processInbound` for each of the
 * three agents, through the real per-scope prompt bindings, resolving each agent's OWN production
 * prompt, against a counting fake gateway. Call counts are asserted as EXACT figures, not bounds — a
 * regression that started calling a model for a no-model strategy would fail here rather than slip
 * under a `<= 1`.
 *
 * ### What is real and what is a double
 *
 * Real: `assignAgent`, the behaviour mux, `decideAnishaTurn`, `evaluateAarohiSalesTurn` over artifacts
 * built by the AVG-5/AVG-7 constructors themselves, the per-scope prompt bindings, the three production
 * prompt registries, the prompt resolver and its digest check, and the composed runtime.
 *
 * A double: the gateway invoker and the Core transport, both deterministic and both counted. That is
 * the point — no provider is contacted, no credential exists, and the figures below are measurements of
 * OUR code, not of a model.
 */
import { createVendorJourneyContext } from '@qf-jarvis/anisha-agent';
import {
  appendInstagramInboundObservation,
  createAarohiSalesBrainInterpretation,
  createInstagramConversation,
  parseInstagramInboundObservation,
} from '@qf-jarvis/aarohi-agent';
import {
  AAROHI_ACQUISITION_PROMPT_V1,
  createAarohiPromptRegistryV1,
} from '@qf-jarvis/aarohi-prompts';
import {
  ANISHA_VENDOR_JOURNEY_PROMPT_V1,
  createAnishaPromptRegistryV1,
} from '@qf-jarvis/anisha-prompts';
import { scriptedCoreTransport } from '@qf-jarvis/core-decision-adapter/testing';
import { scriptedGatewayInvoker, structuredReply } from '@qf-jarvis/model-reply-adapter/testing';
import { createPromptRegistry } from '@qf-jarvis/prompt-registry';
import type { PromptDefinition } from '@qf-jarvis/prompt-registry';
import { RIYA_CLIENT_SALES_EVOLUTION_PROMPT_V1 } from '@qf-jarvis/riya-prompts';
import { describe, expect, it } from 'vitest';

import { createJarvisRuntime } from '../composition/create-jarvis-runtime.js';
import type { AarohiAcquisitionBehaviourInputPort } from '../contracts/aarohi-acquisition-behaviour-input.js';
import type { ConversationControlState } from '../contracts/authoritative-state.js';
import type { JarvisRuntimeConfig } from '../contracts/runtime-config.js';
import type { VendorJourneyBehaviourInputPort } from '../contracts/vendor-journey-behaviour-input.js';
import {
  clearControlState,
  mutableAuthoritativeState,
  syntheticInboundEnvelope,
  syntheticPromptDefinition,
  syntheticRuntimeConfig,
} from '../testing/index.js';

const TENANT = 'tenant.a';
const CONVERSATION_ID = 'conv.1';

// ---------------------------------------------------------------------------
// The AVG-5 / AVG-7 artifacts, built by the domain's OWN constructors.
// ---------------------------------------------------------------------------

const PROSPECT_REF = 'prospect.jf5a.alpha';
const IG_CONVERSATION = 'ig.conversation.jf5a';
const IG_THREAD = 'ig.thread.jf5a';
const IG_PARTICIPANT = 'ig.participant.jf5a';
const IG_MESSAGE = 'ig.message.jf5a.001';
const OBSERVED_AT = '2026-09-11T09:00:00Z';
const INTERPRETED_AT = '2026-09-11T09:05:00Z';
const PLANNED_AT = '2026-09-11T09:10:00Z';

/**
 * One canonical AVG-5 conversation with one inbound turn.
 *
 * Built through `createInstagramConversation` + `parseInstagramInboundObservation` +
 * `appendInstagramInboundObservation` rather than hand-written, because AVG-7 re-certifies the whole
 * aggregate and a hand-written snapshot would be refused — correctly, and for reasons that have nothing
 * to do with what this file is measuring.
 */
function aarohiConversation(): unknown {
  const built = createInstagramConversation({
    prospectRef: PROSPECT_REF,
    instagramConversationRef: IG_CONVERSATION,
    instagramThreadRef: IG_THREAD,
    instagramParticipantRef: IG_PARTICIPANT,
  });
  if (!built.ok) {
    throw new Error(`AVG-5 refused the conversation fixture: ${built.refusal}`);
  }
  const turn = parseInstagramInboundObservation({
    prospectRef: PROSPECT_REF,
    instagramConversationRef: IG_CONVERSATION,
    instagramThreadRef: IG_THREAD,
    instagramParticipantRef: IG_PARTICIPANT,
    instagramMessageRef: IG_MESSAGE,
    body: 'Hello, I run a carpentry workshop and wanted to understand how this works.',
    observedAt: OBSERVED_AT,
  });
  if (!turn.ok) {
    throw new Error(`AVG-5 refused the turn fixture: ${turn.refusal}`);
  }
  const appended = appendInstagramInboundObservation(built.conversation, turn.observation);
  if (!appended.ok) {
    throw new Error(`AVG-5 refused the append: ${appended.refusal}`);
  }
  return appended.conversation;
}

const AAROHI_CONVERSATION = aarohiConversation();

/** One AVG-7 interpretation, bound to that exact latest turn. */
function aarohiInterpretation(intent: string, objectionKind: string): unknown {
  const built = createAarohiSalesBrainInterpretation({
    interpretationRef: 'interp.jf5a.001',
    conversation: AAROHI_CONVERSATION,
    intent,
    objectionKind,
    interpretedAt: INTERPRETED_AT,
  });
  if (!built.ok) {
    throw new Error(`AVG-7 refused the interpretation fixture: ${built.refusal}`);
  }
  return built.interpretation;
}

/**
 * The certified artifacts for one acquisition turn.
 *
 * `NOT_REGISTERED` is the ONE Core status AVG-1's gate permits, so it is the only value under which
 * Aarohi may act at all. That is the domain's rule and this fixture obeys it rather than working
 * around it.
 */
function aarohiInput(intent: string, objectionKind = 'NONE'): unknown {
  return {
    planRef: 'plan.jf5a.alpha',
    conversation: AAROHI_CONVERSATION,
    interpretation: aarohiInterpretation(intent, objectionKind),
    coreObservation: {
      prospectRef: PROSPECT_REF,
      coreLookupRef: 'lookup-not-registered',
      status: 'NOT_REGISTERED',
    },
    plannedAt: PLANNED_AT,
    promptRef: 'prompt.jf5a.aarohi',
  };
}

/** A counting Aarohi acquisition input port. */
function aarohiPort(input: unknown): AarohiAcquisitionBehaviourInputPort & {
  readonly reads: () => number;
} {
  let reads = 0;
  return {
    reads: () => reads,
    read: () => {
      reads += 1;
      return Promise.resolve(input as never);
    },
  };
}

/** A counting Anisha vendor-journey input port. */
function anishaPort(input: unknown): VendorJourneyBehaviourInputPort & {
  readonly reads: () => number;
} {
  let reads = 0;
  return {
    reads: () => reads,
    read: () => {
      reads += 1;
      return Promise.resolve(input as never);
    },
  };
}

// ---------------------------------------------------------------------------
// One composed runtime per scenario, with counted collaborators.
// ---------------------------------------------------------------------------

/**
 * Every prompt a three-agent deployment binds, in ONE registry.
 *
 * Riya's CLIENT entry is the fixture's synthetic definition rather than her production one, and that is
 * not a shortcut. `RIYA_PRODUCTION_PROMPTS` are bound to her three DEDICATED task classes
 * (`RIYA_CONVERSATION_EVOLUTION`, `RIYA_GROUNDED_CONVERSATION_EVOLUTION`, `RIYA_GROUNDED_REPLY`), which
 * her own RWC-P4B/P7 capability resolves and which its own specs already exercise. The generic
 * `RESPONSE_GENERATION` path this file measures is a different path, and putting her production prompt
 * on it would claim a binding her runtime does not make. Her column here proves she is UNCHANGED.
 *
 * Anisha's and Aarohi's production prompts ARE at `RESPONSE_GENERATION`, because that is the task class
 * their serving paths actually resolve.
 */
function threeAgentRegistry(clientPrompt: PromptDefinition) {
  return createPromptRegistry([
    clientPrompt,
    ANISHA_VENDOR_JOURNEY_PROMPT_V1,
    AAROHI_ACQUISITION_PROMPT_V1,
  ]);
}

/**
 * The per-scope prompt bindings, one per agent, each naming that agent's OWN identity and digest.
 *
 * This IS the deterministic actor-bound prompt policy (ADR-0073, extended by JF-5A): the runtime picks
 * the binding for the actor `assignAgent` chose, and there is no field through which a caller could
 * name another agent's. Every binding carries an evaluation reference and the prompt's exact digest,
 * because a model-backed draft requires an evaluated prompt.
 */
const clientBinding = (prompt: PromptDefinition) => ({
  promptFamily: prompt.promptId,
  promptVersion: prompt.promptVersion,
  evaluationRef: 'evref-riya01',
  evaluationPromptDigest: prompt.contentDigest,
});

const bindingsFor = (clientPrompt: PromptDefinition) => ({
  CLIENT: clientBinding(clientPrompt),
  VENDOR: {
    promptFamily: ANISHA_VENDOR_JOURNEY_PROMPT_V1.promptId,
    promptVersion: ANISHA_VENDOR_JOURNEY_PROMPT_V1.promptVersion,
    evaluationRef: 'evref-anisha1',
    evaluationPromptDigest: ANISHA_VENDOR_JOURNEY_PROMPT_V1.contentDigest,
  },
  PROSPECT: {
    promptFamily: AAROHI_ACQUISITION_PROMPT_V1.promptId,
    promptVersion: AAROHI_ACQUISITION_PROMPT_V1.promptVersion,
    evaluationRef: 'evref-aarohi1',
    evaluationPromptDigest: AAROHI_ACQUISITION_PROMPT_V1.contentDigest,
  },
});

type Party = 'CLIENT' | 'VENDOR' | 'PROSPECT';

interface Scenario {
  readonly party: Party;
  readonly behaviourInput?: JarvisRuntimeConfig['behaviourInput'];
  readonly vendorInput?: VendorJourneyBehaviourInputPort;
  readonly aarohiInput?: AarohiAcquisitionBehaviourInputPort;
  readonly state?: Partial<ConversationControlState>;
}

function run(scenario: Scenario) {
  const gatewayInvoker = scriptedGatewayInvoker(structuredReply({ citations: [] }));
  const coreTransport = scriptedCoreTransport('ACCEPTED');
  const state = clearControlState({
    tenantId: TENANT,
    conversationId: CONVERSATION_ID,
    partyType: scenario.party,
    ...scenario.state,
  });
  const base = syntheticRuntimeConfig({
    authoritativeState: mutableAuthoritativeState(() => state),
    promptRegistry: threeAgentRegistry(syntheticPromptDefinition()),
    gatewayInvoker,
    coreTransport,
  });
  // The legacy single identity and the per-scope bindings are mutually exclusive, so the legacy fields
  // the fixture supplies are removed rather than overridden.
  const {
    promptFamily: _family,
    promptVersion: _version,
    evaluationRef: _ref,
    evaluationPromptDigest: _digest,
    ...rest
  } = base;
  const config: JarvisRuntimeConfig = {
    ...rest,
    promptBindings: bindingsFor(syntheticPromptDefinition()),
    ...(scenario.vendorInput === undefined
      ? {}
      : { vendorJourneyBehaviourInput: scenario.vendorInput }),
    ...(scenario.aarohiInput === undefined
      ? {}
      : { aarohiAcquisitionBehaviourInput: scenario.aarohiInput }),
  };
  return {
    runtime: createJarvisRuntime(config),
    gatewayCalls: () => gatewayInvoker.invoked(),
    coreCalls: () => coreTransport.invoked(),
  };
}

const envelopeFor = (party: Party) =>
  syntheticInboundEnvelope({
    channel: 'WEB',
    partyType: party,
    tenantId: TENANT,
    conversationId: CONVERSATION_ID,
    normalizedText: 'a question about what you offer',
  });

// ---------------------------------------------------------------------------
// D. Aarohi reaches the gateway exactly once, and only on an eligible strategy.
// ---------------------------------------------------------------------------

describe('JF-5A (D) Aarohi reaches the model gateway, once, under PROSPECT', () => {
  it('(D29) a model-eligible AVG-7 reply strategy makes EXACTLY ONE gateway call', async () => {
    // `GENERAL_INFORMATION` + `NONE` is the AVG-7 pair that yields
    // `PREPARE_NONCOMMERCIAL_REPLY_BRIEF`, the strategy the domain marks model-permitted.
    const port = aarohiPort(aarohiInput('GENERAL_INFORMATION'));
    const turn = run({ party: 'PROSPECT', aarohiInput: port });

    const result = await turn.runtime.processInbound(envelopeFor('PROSPECT'));

    // The proof the JF-4 residue is closed: this reached the gateway at all.
    expect(turn.gatewayCalls()).toBe(1);
    expect(result.assignedActor).toBe('AAROHI');
    expect(result.modelDrafted).toBe(true);
    expect(result.outcome).toBe('CORE_ACCEPTED');
    // One Core decision for one turn, and one domain read. No retry anywhere.
    expect(turn.coreCalls()).toBe(1);
    expect(port.reads()).toBe(1);
  });

  it('(D30) a clarifying reply strategy also makes exactly one call, because the domain permits it', async () => {
    // `OTHER_OR_UNCLEAR` yields `PREPARE_CLARIFYING_REPLY_BRIEF`. Eligibility comes from AVG-7; this
    // spec reads it rather than asserting it.
    const turn = run({
      party: 'PROSPECT',
      aarohiInput: aarohiPort(aarohiInput('OTHER_OR_UNCLEAR')),
    });
    await turn.runtime.processInbound(envelopeFor('PROSPECT'));
    expect(turn.gatewayCalls()).toBe(1);
  });

  it('(D31,D32) the two Core-context strategies make ZERO gateway calls', async () => {
    // `COMMERCIAL_TERMS` -> REQUEST_CORE_COMMERCIAL_CONTEXT, `REGISTRATION_PROCESS` ->
    // REQUEST_CORE_PROCESS_CONTEXT. Both map to NO_ACTION with no model. A prompt existing did not and
    // must not change that: waiting for Core is not a gap for a model to fill.
    for (const intent of ['COMMERCIAL_TERMS', 'REGISTRATION_PROCESS', 'PAYMENT_OR_ACTIVATION']) {
      const turn = run({ party: 'PROSPECT', aarohiInput: aarohiPort(aarohiInput(intent)) });
      const result = await turn.runtime.processInbound(envelopeFor('PROSPECT'));
      // ZERO calls, and the turn COMPLETES rather than failing. The outcome matters as much as the
      // count: a mutation that made one of these strategies model-eligible would trip the adapter's
      // own eligibility cross-check and refuse, which is also zero calls. Asserting the count alone
      // could not tell "correctly no model" from "broken, so no model".
      expect([intent, turn.gatewayCalls(), result.outcome, result.refusalReason]).toEqual([
        intent,
        0,
        'CORE_ACCEPTED',
        undefined,
      ]);
      expect(result.modelDrafted, intent).toBe(false);
    }
  });

  it('(D33) an escalation strategy makes ZERO gateway calls', async () => {
    // A privacy/contact objection reaches REQUEST_CORE_CONTACT_POLICY_REVIEW, and a rejection reaches
    // the same family of no-model outcomes. An escalation is not a slow reply.
    for (const [intent, objection] of [
      ['GENERAL_INFORMATION', 'PRIVACY_OR_CONTACT'],
      ['REJECTION_OR_STOP', 'NONE'],
    ] as const) {
      const turn = run({
        party: 'PROSPECT',
        aarohiInput: aarohiPort(aarohiInput(intent, objection)),
      });
      const result = await turn.runtime.processInbound(envelopeFor('PROSPECT'));
      const label = `${intent}/${objection}`;
      // Same reasoning as the Core-context strategies: zero calls AND a completed escalation.
      expect([label, turn.gatewayCalls(), result.outcome, result.refusalReason]).toEqual([
        label,
        0,
        'CORE_ACCEPTED',
        undefined,
      ]);
      expect(result.modelDrafted, label).toBe(false);
    }
  });

  it('(D34,D35) human takeover and AI pause make ZERO gateway calls and ZERO domain reads', async () => {
    for (const control of [{ humanTakeover: true }, { aiPaused: true }] as const) {
      const port = aarohiPort(aarohiInput('GENERAL_INFORMATION'));
      const turn = run({ party: 'PROSPECT', aarohiInput: port, state: control });
      await turn.runtime.processInbound(envelopeFor('PROSPECT'));
      expect(turn.gatewayCalls(), JSON.stringify(control)).toBe(0);
      // The gate runs BEFORE the behaviour port, so a blocked turn costs no acquisition read either.
      expect(port.reads(), JSON.stringify(control)).toBe(0);
    }
  });

  it('(D36) a HUMAN_ONLY data class makes ZERO gateway calls', async () => {
    const port = aarohiPort(aarohiInput('GENERAL_INFORMATION'));
    const turn = run({ party: 'PROSPECT', aarohiInput: port, state: { dataClass: 'HUMAN_ONLY' } });
    await turn.runtime.processInbound(envelopeFor('PROSPECT'));
    expect(turn.gatewayCalls()).toBe(0);
    expect(port.reads()).toBe(0);
  });

  it('(D37) malformed acquisition artifacts make ZERO gateway calls and fail closed', async () => {
    // The AVG-7 evaluator re-proves everything it is handed. A structurally-shaped input that is not
    // certified is refused there, and the refusal is the turn's answer.
    for (const bad of [
      {},
      { planRef: 'plan.x', conversation: {}, interpretation: {}, coreObservation: {} },
      { ...(aarohiInput('GENERAL_INFORMATION') as object), coreObservation: { status: 'ACTIVE' } },
    ]) {
      const turn = run({ party: 'PROSPECT', aarohiInput: aarohiPort(bad) });
      await turn.runtime.processInbound(envelopeFor('PROSPECT'));
      expect(turn.gatewayCalls(), JSON.stringify(bad).slice(0, 40)).toBe(0);
    }
  });

  it('(D38) an eligible Aarohi turn resolves HER prompt, not Riya’s or Anisha’s', async () => {
    // A registry holding only the OTHER two agents' prompts. The turn must refuse rather than borrow:
    // the resolver asks for `PROSPECT`, and neither definition serves it.
    const gatewayInvoker = scriptedGatewayInvoker(structuredReply({ citations: [] }));
    const state = clearControlState({
      tenantId: TENANT,
      conversationId: CONVERSATION_ID,
      partyType: 'PROSPECT',
    });
    const base = syntheticRuntimeConfig({
      authoritativeState: mutableAuthoritativeState(() => state),
      promptRegistry: createPromptRegistry([
        syntheticPromptDefinition(),
        ANISHA_VENDOR_JOURNEY_PROMPT_V1,
      ]),
      gatewayInvoker,
    });
    const {
      promptFamily: _f,
      promptVersion: _v,
      evaluationRef: _r,
      evaluationPromptDigest: _d,
      ...rest
    } = base;
    const runtime = createJarvisRuntime({
      ...rest,
      promptBindings: bindingsFor(syntheticPromptDefinition()),
      aarohiAcquisitionBehaviourInput: aarohiPort(aarohiInput('GENERAL_INFORMATION')),
    });
    const result = await runtime.processInbound(envelopeFor('PROSPECT'));
    expect(result.outcome).toBe('REFUSED');
    expect(gatewayInvoker.invoked()).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// C. Anisha's dispositions, counted.
// ---------------------------------------------------------------------------

describe('JF-5A (C) Anisha reaches the model gateway under VENDOR, once per turn', () => {
  /**
   * Vendor-journey input for one turn.
   *
   * `decideAnishaTurn` re-derives the disposition from these signals; the spec names the signals and
   * reads the count, never the disposition. Asserting a disposition here would be re-implementing
   * ADR-0070's decision in a test.
   */
  const vendorInput = (signals: Record<string, unknown>, over: Record<string, unknown> = {}) => ({
    signals: {
      hasPriorVendorContext: false,
      requestedHumanAssistance: false,
      raisedComplaint: false,
      askedAboutPackageOrRecharge: false,
      askedAboutOnboardingOrProfile: false,
      askedAboutLeadResponse: false,
      askedRoutineQuestion: false,
      matterRequiresEscalation: false,
      outOfVendorScope: false,
      missingContextFieldCount: 0,
      ...signals,
    },
    // A BUILT context, through the domain's own constructor. `SUFFICIENT_FOR_CORE_REVIEW` with nothing
    // listed missing is the one consistent pairing here: the contract refuses "sufficient" alongside a
    // field the record itself admits is absent, which is exactly the lie it exists to prevent.
    context: createVendorJourneyContext({
      vendorStageRef: 'stage.onboarding',
      onboardingStepRef: 'step.profile',
      verificationStatusRef: 'status.pending',
      completeness: 'SUFFICIENT_FOR_CORE_REVIEW',
    }),
    promptRef: 'prompt.jf5a.anisha',
    ...over,
  });

  it('(C19,C20,C21) a model-eligible vendor disposition makes EXACTLY ONE gateway call', async () => {
    for (const [label, signals] of [
      ['routine query', { askedRoutineQuestion: true }],
      ['onboarding guidance', { askedAboutOnboardingOrProfile: true }],
      ['package readiness', { askedAboutPackageOrRecharge: true }],
      ['lead response', { askedAboutLeadResponse: true }],
    ] as const) {
      const port = anishaPort(vendorInput(signals));
      const turn = run({ party: 'VENDOR', vendorInput: port });
      const result = await turn.runtime.processInbound(envelopeFor('VENDOR'));
      expect([label, turn.gatewayCalls(), result.outcome, result.refusalReason]).toEqual([
        label,
        1,
        'CORE_ACCEPTED',
        undefined,
      ]);
      expect(result.assignedActor, label).toBe('ANISHA');
      expect(port.reads(), label).toBe(1);
    }
  });

  it('(C22,C23) escalation and refusal make ZERO gateway calls', async () => {
    for (const [label, signals] of [
      ['escalation required', { matterRequiresEscalation: true }],
      ['human support requested', { requestedHumanAssistance: true }],
      ['out of vendor scope', { outOfVendorScope: true }],
    ] as const) {
      const turn = run({ party: 'VENDOR', vendorInput: anishaPort(vendorInput(signals)) });
      const result = await turn.runtime.processInbound(envelopeFor('VENDOR'));
      expect(turn.gatewayCalls(), label).toBe(0);
      expect(result.modelDrafted, label).toBe(false);
    }
  });

  it('(C24) a VENDOR turn cannot resolve the CLIENT or PROSPECT prompt', async () => {
    const gatewayInvoker = scriptedGatewayInvoker(structuredReply({ citations: [] }));
    const state = clearControlState({
      tenantId: TENANT,
      conversationId: CONVERSATION_ID,
      partyType: 'VENDOR',
    });
    const base = syntheticRuntimeConfig({
      authoritativeState: mutableAuthoritativeState(() => state),
      promptRegistry: createPromptRegistry([
        syntheticPromptDefinition(),
        AAROHI_ACQUISITION_PROMPT_V1,
      ]),
      gatewayInvoker,
    });
    const {
      promptFamily: _f,
      promptVersion: _v,
      evaluationRef: _r,
      evaluationPromptDigest: _d,
      ...rest
    } = base;
    const runtime = createJarvisRuntime({
      ...rest,
      promptBindings: bindingsFor(syntheticPromptDefinition()),
      vendorJourneyBehaviourInput: anishaPort(vendorInput({ askedRoutineQuestion: true })),
    });
    const result = await runtime.processInbound(envelopeFor('VENDOR'));
    expect(result.outcome).toBe('REFUSED');
    expect(gatewayInvoker.invoked()).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// B. Riya is unchanged.
// ---------------------------------------------------------------------------

describe('JF-5A (B) Riya is unchanged by the additions', () => {
  it('(B12) a CLIENT turn still completes with exactly one gateway call, under CLIENT', async () => {
    const turn = run({ party: 'CLIENT' });
    const result = await turn.runtime.processInbound(envelopeFor('CLIENT'));
    expect(result.outcome).toBe('CORE_ACCEPTED');
    expect(result.assignedActor).toBe('RIYA');
    expect(turn.gatewayCalls()).toBe(1);
    expect(turn.coreCalls()).toBe(1);
  });

  it('(B15) a CLIENT turn cannot resolve the VENDOR or PROSPECT prompt', async () => {
    const gatewayInvoker = scriptedGatewayInvoker(structuredReply({ citations: [] }));
    const state = clearControlState({
      tenantId: TENANT,
      conversationId: CONVERSATION_ID,
      partyType: 'CLIENT',
    });
    const base = syntheticRuntimeConfig({
      authoritativeState: mutableAuthoritativeState(() => state),
      promptRegistry: createPromptRegistry([
        ANISHA_VENDOR_JOURNEY_PROMPT_V1,
        AAROHI_ACQUISITION_PROMPT_V1,
      ]),
      gatewayInvoker,
    });
    const {
      promptFamily: _f,
      promptVersion: _v,
      evaluationRef: _r,
      evaluationPromptDigest: _d,
      ...rest
    } = base;
    const runtime = createJarvisRuntime({
      ...rest,
      promptBindings: bindingsFor(syntheticPromptDefinition()),
    });
    const result = await runtime.processInbound(envelopeFor('CLIENT'));
    expect(result.outcome).toBe('REFUSED');
    expect(gatewayInvoker.invoked()).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// The three registries stay separate, and each agent's prompt is its own.
// ---------------------------------------------------------------------------

describe('JF-5A each agent owns its prompt, and no two share an identity', () => {
  it('three distinct ids, three distinct digests, three distinct scopes', () => {
    const all = [
      RIYA_CLIENT_SALES_EVOLUTION_PROMPT_V1,
      ANISHA_VENDOR_JOURNEY_PROMPT_V1,
      AAROHI_ACQUISITION_PROMPT_V1,
    ];
    expect(new Set(all.map((d) => d.promptId)).size).toBe(3);
    expect(new Set(all.map((d) => d.contentDigest)).size).toBe(3);
    expect(all.map((d) => d.agentScope)).toEqual(['CLIENT', 'VENDOR', 'PROSPECT']);
  });

  it('each agent-owned registry resolves only its own agent', () => {
    for (const [label, registry, ownScope] of [
      ['anisha', createAnishaPromptRegistryV1(), 'VENDOR'],
      ['aarohi', createAarohiPromptRegistryV1(), 'PROSPECT'],
    ] as const) {
      expect(registry.definitions, label).toHaveLength(1);
      expect(registry.definitions[0]?.agentScope, label).toBe(ownScope);
    }
  });
});
