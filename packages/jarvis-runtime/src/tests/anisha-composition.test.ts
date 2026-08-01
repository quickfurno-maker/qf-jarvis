/**
 * S3-D-B — Anisha composed into the authoritative runtime (ADR-0071).
 *
 * Every case drives the REAL composition root: `createJarvisRuntime(...).processInbound(envelope)`.
 * Nothing here calls `decideAnishaTurn`, `behaviourMux`, `orchestrateInbound` or `runAgentTurn`
 * directly, because the claim under test is that Anisha is reachable through the one authoritative
 * path — and, just as importantly, that Riya is NOT reachable from a vendor turn and vice versa.
 *
 * Every fake counts its own calls, so "the other agent's input was never read" is an observed zero
 * rather than an argument.
 */
import { describe, expect, it } from 'vitest';

import { createVendorJourneyContext } from '@qf-jarvis/anisha-agent';
import type { VendorJourneyContext, VendorJourneySignals } from '@qf-jarvis/anisha-agent';
import type { CoreDecisionTransport } from '@qf-jarvis/core-decision-adapter';
import { scriptedCoreTransport } from '@qf-jarvis/core-decision-adapter/testing';
import type { ModelGatewayInvoker } from '@qf-jarvis/model-reply-adapter';
import { scriptedGatewayInvoker, structuredReply } from '@qf-jarvis/model-reply-adapter/testing';

import { createJarvisRuntime } from '../composition/create-jarvis-runtime.js';
import type { JarvisRuntimeConfig } from '../contracts/runtime-config.js';
import type { JarvisRuntimeResult } from '../contracts/runtime-result.js';
import type { ConversationControlState } from '../contracts/authoritative-state.js';
import type {
  ClientSalesBehaviourInput,
  ClientSalesBehaviourInputPort,
} from '../contracts/behaviour-input.js';
import type {
  VendorJourneyBehaviourInput,
  VendorJourneyBehaviourInputPort,
} from '../contracts/vendor-journey-behaviour-input.js';
import {
  clearControlState,
  mutableAuthoritativeState,
  scriptedAuthoritativeState,
} from '../testing/deterministic-authoritative-state.js';
import {
  syntheticInboundEnvelope,
  syntheticRuntimeConfig,
  syntheticSignals,
} from '../testing/deterministic-runtime-fixture.js';

// ---------------------------------------------------------------------------
// Local counting fakes. Deliberately local: the shipped `./testing` subpath is public API and is not
// widened for a spec's convenience.
// ---------------------------------------------------------------------------

interface Counted {
  readonly count: () => number;
}

const VENDOR_PROMPT_REF = 'prompt.anisha.vendor.v1';
const CLIENT_PROMPT_REF = 'prompt.riya.sales.v1';

function countingInvoker(): ModelGatewayInvoker & Counted {
  const inner = scriptedGatewayInvoker(structuredReply({ citations: [] }));
  return { count: (): number => inner.invoked(), invoke: inner.invoke.bind(inner) };
}

type WireCommand = Readonly<Record<string, unknown>>;

function recordingCoreTransport(): CoreDecisionTransport & {
  readonly last: () => WireCommand | undefined;
  readonly count: () => number;
} {
  const inner = scriptedCoreTransport('ACCEPTED');
  let last: WireCommand | undefined;
  let calls = 0;
  return {
    last: (): WireCommand | undefined => last,
    count: (): number => calls,
    send(serializedCommand: string): Promise<string> {
      calls += 1;
      last = JSON.parse(serializedCommand) as WireCommand;
      return inner.send(serializedCommand);
    },
  };
}

function intentOf(command: WireCommand | undefined): Readonly<Record<string, unknown>> {
  return (command?.['structuredIntent'] ?? {}) as Readonly<Record<string, unknown>>;
}

/** Synthetic closed vendor-journey signals; override any field for a specific test. */
function vendorSignals(over: Partial<VendorJourneySignals> = {}): VendorJourneySignals {
  return {
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
    ...over,
  };
}

function vendorInput(
  signals: Partial<VendorJourneySignals>,
  context?: VendorJourneyContext,
): VendorJourneyBehaviourInput {
  return {
    signals: vendorSignals(signals),
    ...(context === undefined ? {} : { context }),
    promptRef: VENDOR_PROMPT_REF,
  };
}

/** A vendor input port that counts reads and answers with a fixed value. */
function countingVendorInput(
  value: VendorJourneyBehaviourInput | undefined,
): VendorJourneyBehaviourInputPort & Counted {
  let calls = 0;
  return {
    count: (): number => calls,
    read: (): Promise<VendorJourneyBehaviourInput | undefined> => {
      calls += 1;
      return Promise.resolve(value);
    },
  };
}

/** A vendor input port that counts reads and then rejects. */
function rejectingVendorInput(): VendorJourneyBehaviourInputPort & Counted {
  let calls = 0;
  return {
    count: (): number => calls,
    read: (): Promise<VendorJourneyBehaviourInput | undefined> => {
      calls += 1;
      return Promise.reject(new Error('synthetic vendor input failure'));
    },
  };
}

/** A client-sales input port that counts reads — used to prove it is NEVER read on a vendor turn. */
function countingClientInput(
  value: ClientSalesBehaviourInput | undefined,
): ClientSalesBehaviourInputPort & Counted {
  let calls = 0;
  return {
    count: (): number => calls,
    read: (): Promise<ClientSalesBehaviourInput | undefined> => {
      calls += 1;
      return Promise.resolve(value);
    },
  };
}

function rejectingClientInput(): ClientSalesBehaviourInputPort & Counted {
  let calls = 0;
  return {
    count: (): number => calls,
    read: (): Promise<ClientSalesBehaviourInput | undefined> => {
      calls += 1;
      return Promise.reject(new Error('synthetic client input failure'));
    },
  };
}

const validClientInput = (): ClientSalesBehaviourInput => ({
  signals: syntheticSignals({ providedRequirementDetail: true }),
  promptRef: CLIENT_PROMPT_REF,
});

const sufficientContext = (): VendorJourneyContext =>
  createVendorJourneyContext({
    vendorStageRef: 'stage.active',
    completeness: 'SUFFICIENT_FOR_CORE_REVIEW',
  });

const humanReviewContext = (): VendorJourneyContext =>
  createVendorJourneyContext({ completeness: 'HUMAN_REVIEW_REQUIRED' });

/** Run one VENDOR turn through the real composition root. */
async function runVendor(
  over: Partial<JarvisRuntimeConfig> = {},
  envelopeOver: Parameters<typeof syntheticInboundEnvelope>[0] = {},
): Promise<{ result: JarvisRuntimeResult; models: number }> {
  const invoker = countingInvoker();
  const config = syntheticRuntimeConfig({
    authoritativeState: scriptedAuthoritativeState(clearControlState({ partyType: 'VENDOR' })),
    gatewayInvoker: invoker,
    ...over,
  });
  const result = await createJarvisRuntime(config).processInbound(
    syntheticInboundEnvelope({ partyType: 'VENDOR', ...envelopeOver }),
  );
  return { result, models: invoker.count() };
}

// ---------------------------------------------------------------------------
// (A) Basic VENDOR/ANISHA selection.
// ---------------------------------------------------------------------------

describe('(A) a VENDOR turn reaches Anisha through the authoritative path', () => {
  it('is assigned to ANISHA, reads vendor input once, and completes with one model and one Core call', async () => {
    const vendor = countingVendorInput(vendorInput({ askedRoutineQuestion: true }));
    const core = recordingCoreTransport();
    const { result, models } = await runVendor({
      vendorJourneyBehaviourInput: vendor,
      coreTransport: core,
    });

    expect(result.assignedActor).toBe('ANISHA');
    expect(vendor.count()).toBe(1);
    expect(models).toBe(1);
    expect(core.count()).toBe(1);
    expect(result.outcome).toBe('CORE_ACCEPTED');
    expect(result.proposalId).toMatch(/^proposal\.[0-9a-f]{32}$/);

    expect(result.provenance?.actor).toBe('ANISHA');
    expect(result.provenance?.authority).toBe('QUICKFURNO_CORE');
    expect(result.provenance?.modelOutputRetention).toBe('DISCARDED');
    expect(result.runId).toBe('rt.1');
    expect(result.provenance?.correlationId).toBe('msg.1');
  });
});

// ---------------------------------------------------------------------------
// (B, Q, R, S) Cross-agent isolation — the invariant the mux exists to hold.
// ---------------------------------------------------------------------------

describe('(B) with BOTH inputs configured, exactly one is ever read', () => {
  it('a VENDOR turn reads vendor input once and client input zero times', async () => {
    const vendor = countingVendorInput(vendorInput({ askedRoutineQuestion: true }));
    const client = countingClientInput(validClientInput());
    const { result } = await runVendor({
      vendorJourneyBehaviourInput: vendor,
      behaviourInput: client,
    });
    expect(vendor.count()).toBe(1);
    expect(client.count()).toBe(0);
    expect(result.assignedActor).toBe('ANISHA');
  });

  it('a CLIENT turn reads client input once and vendor input zero times', async () => {
    const vendor = countingVendorInput(vendorInput({ askedRoutineQuestion: true }));
    const client = countingClientInput(validClientInput());
    const result = await createJarvisRuntime(
      syntheticRuntimeConfig({
        vendorJourneyBehaviourInput: vendor,
        behaviourInput: client,
      }),
    ).processInbound(syntheticInboundEnvelope());
    expect(client.count()).toBe(1);
    expect(vendor.count()).toBe(0);
    expect(result.assignedActor).toBe('RIYA');
  });

  it('an UNKNOWN turn reads neither input', async () => {
    const vendor = countingVendorInput(vendorInput({ askedRoutineQuestion: true }));
    const client = countingClientInput(validClientInput());
    const result = await createJarvisRuntime(
      syntheticRuntimeConfig({
        authoritativeState: scriptedAuthoritativeState(clearControlState({ partyType: 'UNKNOWN' })),
        vendorJourneyBehaviourInput: vendor,
        behaviourInput: client,
      }),
    ).processInbound(syntheticInboundEnvelope({ partyType: 'UNKNOWN' }));
    expect(vendor.count()).toBe(0);
    expect(client.count()).toBe(0);
    expect(result.assignedActor).toBe('JARVIS');
  });

  it('(Q) a selected vendor input returning undefined never falls back to Riya', async () => {
    const vendor = countingVendorInput(undefined);
    const client = countingClientInput(validClientInput());
    const core = recordingCoreTransport();
    const { result, models } = await runVendor({
      vendorJourneyBehaviourInput: vendor,
      behaviourInput: client,
      coreTransport: core,
    });
    expect(vendor.count()).toBe(1);
    expect(client.count()).toBe(0);
    // The legacy default: a REPLY drafted by the model, exactly as before any agent existed.
    expect(models).toBe(1);
    expect(core.last()?.['proposalKind']).toBe('REPLY');
    expect(intentOf(core.last())).toEqual({
      taskClass: 'RESPONSE_GENERATION',
      replyKind: 'REPLY',
    });
    expect(result.outcome).toBe('CORE_ACCEPTED');
  });

  it('(Q) a selected client input returning undefined never falls back to Anisha', async () => {
    const vendor = countingVendorInput(vendorInput({ askedRoutineQuestion: true }));
    const client = countingClientInput(undefined);
    const result = await createJarvisRuntime(
      syntheticRuntimeConfig({ vendorJourneyBehaviourInput: vendor, behaviourInput: client }),
    ).processInbound(syntheticInboundEnvelope());
    expect(client.count()).toBe(1);
    expect(vendor.count()).toBe(0);
    expect(result.outcome).toBe('CORE_ACCEPTED');
  });

  it('(R) a rejecting vendor input refuses and never calls Riya', async () => {
    const vendor = rejectingVendorInput();
    const client = countingClientInput(validClientInput());
    const core = recordingCoreTransport();
    const { result, models } = await runVendor({
      vendorJourneyBehaviourInput: vendor,
      behaviourInput: client,
      coreTransport: core,
    });
    expect(vendor.count()).toBe(1);
    expect(client.count()).toBe(0);
    expect(models).toBe(0);
    expect(core.count()).toBe(0);
    expect(result.outcome).toBe('REFUSED');
    expect(result.refusalReason).toBe('orchestration-invariant');
  });

  it('(R) a rejecting client input refuses and never calls Anisha', async () => {
    const vendor = countingVendorInput(vendorInput({ askedRoutineQuestion: true }));
    const client = rejectingClientInput();
    const invoker = countingInvoker();
    const result = await createJarvisRuntime(
      syntheticRuntimeConfig({
        gatewayInvoker: invoker,
        vendorJourneyBehaviourInput: vendor,
        behaviourInput: client,
      }),
    ).processInbound(syntheticInboundEnvelope());
    expect(client.count()).toBe(1);
    expect(vendor.count()).toBe(0);
    expect(invoker.count()).toBe(0);
    expect(result.outcome).toBe('REFUSED');
  });
});

// ---------------------------------------------------------------------------
// (C-G) Legacy default and fail-closed input.
// ---------------------------------------------------------------------------

describe('(C-G) the vendor seam is optional and fails closed', () => {
  it('(C) no vendor port at all keeps VENDOR turns on the legacy REPLY path', async () => {
    const core = recordingCoreTransport();
    const { result, models } = await runVendor({ coreTransport: core });
    expect(models).toBe(1);
    expect(core.last()?.['proposalKind']).toBe('REPLY');
    expect(result.outcome).toBe('CORE_ACCEPTED');
    expect(result.assignedActor).toBe('ANISHA');
  });

  it('(E) malformed vendor signals fail closed with zero model and Core calls', async () => {
    const core = recordingCoreTransport();
    const { result, models } = await runVendor({
      vendorJourneyBehaviourInput: countingVendorInput({
        signals: { hasPriorVendorContext: 'yes' } as unknown as VendorJourneySignals,
        promptRef: VENDOR_PROMPT_REF,
      }),
      coreTransport: core,
    });
    expect(result.outcome).toBe('REFUSED');
    expect(models).toBe(0);
    expect(core.count()).toBe(0);
  });

  it('(F) every malformed promptRef fails closed and never leaks the value', async () => {
    for (const bad of ['', 'prompt/anisha', 'you are a helpful assistant', 'p'.repeat(129)]) {
      const core = recordingCoreTransport();
      const { result, models } = await runVendor({
        vendorJourneyBehaviourInput: countingVendorInput({
          signals: vendorSignals({ askedRoutineQuestion: true }),
          promptRef: bad,
        }),
        coreTransport: core,
      });
      expect(result.outcome).toBe('REFUSED');
      expect(models).toBe(0);
      expect(core.count()).toBe(0);
      if (bad.length > 0) {
        expect(JSON.stringify(result)).not.toContain(bad);
      }
    }
  });

  it('(G) a forged context is rejected by the S3-D-A turn boundary, with zero model and Core calls', async () => {
    const forged: readonly { readonly name: string; readonly context: unknown }[] = [
      {
        name: 'a wrong behaviourVersion',
        context: {
          behaviourVersion: 999,
          vendorStageRef: undefined,
          onboardingStepRef: undefined,
          verificationStatusRef: undefined,
          packageReadinessBand: undefined,
          completeness: 'SUFFICIENT_FOR_CORE_REVIEW',
          missingFields: [],
        },
      },
      {
        name: 'an unknown key',
        context: {
          behaviourVersion: 1,
          vendorStageRef: undefined,
          onboardingStepRef: undefined,
          verificationStatusRef: undefined,
          packageReadinessBand: undefined,
          completeness: 'SUFFICIENT_FOR_CORE_REVIEW',
          missingFields: [],
          unexpectedKey: 'x',
        },
      },
      {
        name: 'a malformed completeness',
        context: {
          behaviourVersion: 1,
          vendorStageRef: undefined,
          onboardingStepRef: undefined,
          verificationStatusRef: undefined,
          packageReadinessBand: undefined,
          completeness: 'MAYBE',
          missingFields: [],
        },
      },
    ];

    for (const scenario of forged) {
      const core = recordingCoreTransport();
      const { result, models } = await runVendor({
        vendorJourneyBehaviourInput: countingVendorInput({
          signals: vendorSignals({ askedRoutineQuestion: true }),
          context: scenario.context as VendorJourneyContext,
          promptRef: VENDOR_PROMPT_REF,
        }),
        coreTransport: core,
      });
      expect(result.outcome).toBe('REFUSED');
      expect(models).toBe(0);
      expect(core.count()).toBe(0);
    }
  });

  it('(G) a signal/context readiness-band disagreement fails closed', async () => {
    const core = recordingCoreTransport();
    const { result, models } = await runVendor({
      vendorJourneyBehaviourInput: countingVendorInput({
        signals: vendorSignals({
          askedAboutPackageOrRecharge: true,
          packageReadinessBand: 'low',
        }),
        context: createVendorJourneyContext({
          completeness: 'SUFFICIENT_FOR_CORE_REVIEW',
          packageReadinessBand: 'critical',
        }),
        promptRef: VENDOR_PROMPT_REF,
      }),
      coreTransport: core,
    });
    expect(result.outcome).toBe('REFUSED');
    expect(models).toBe(0);
    expect(core.count()).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// (H) First-gate isolation.
// ---------------------------------------------------------------------------

describe('(H) every first-gate refusal reads neither behaviour input', () => {
  const gates: readonly {
    readonly name: string;
    readonly state: Partial<ConversationControlState>;
  }[] = [
    { name: 'cancelled', state: { cancelled: true } },
    { name: 'human takeover', state: { humanTakeover: true } },
    { name: 'AI paused', state: { aiPaused: true } },
    { name: 'subject blocked', state: { subjectRef: 'subj.1', subjectStatus: 'erased' } },
    { name: 'HUMAN_ONLY data class', state: { dataClass: 'HUMAN_ONLY' } },
  ];

  for (const gate of gates) {
    it(`${gate.name}: vendor 0, client 0, model 0, Core 0, no proposal`, async () => {
      const vendor = countingVendorInput(vendorInput({ askedRoutineQuestion: true }));
      const client = countingClientInput(validClientInput());
      const core = recordingCoreTransport();
      const invoker = countingInvoker();
      const result = await createJarvisRuntime(
        syntheticRuntimeConfig({
          authoritativeState: scriptedAuthoritativeState(
            clearControlState({ partyType: 'VENDOR', ...gate.state }),
          ),
          gatewayInvoker: invoker,
          coreTransport: core,
          vendorJourneyBehaviourInput: vendor,
          behaviourInput: client,
        }),
      ).processInbound(syntheticInboundEnvelope({ partyType: 'VENDOR' }));

      expect(result.outcome).toBe('REFUSED');
      expect(vendor.count()).toBe(0);
      expect(client.count()).toBe(0);
      expect(invoker.count()).toBe(0);
      expect(core.count()).toBe(0);
      expect(result.proposalId).toBeUndefined();
    });
  }

  it('an envelope that does not match the context reads neither input', async () => {
    const vendor = countingVendorInput(vendorInput({ askedRoutineQuestion: true }));
    const client = countingClientInput(validClientInput());
    const { result } = await runVendor(
      { vendorJourneyBehaviourInput: vendor, behaviourInput: client },
      { conversationId: 'conv.other' },
    );
    expect(result.outcome).toBe('REFUSED');
    expect(vendor.count()).toBe(0);
    expect(client.count()).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// (I, J) The double gate, on both the model and no-model paths.
// ---------------------------------------------------------------------------

describe('(I, J) the second gate still runs on both vendor paths', () => {
  /** A state source that applies `mutate` from the Nth read onward. */
  function driftingState(
    base: ConversationControlState,
    fromRead: number,
    mutate: (current: ConversationControlState) => ConversationControlState,
  ): ReturnType<typeof mutableAuthoritativeState> {
    let reads = 0;
    return mutableAuthoritativeState((): ConversationControlState => {
      reads += 1;
      return reads >= fromRead ? mutate(base) : base;
    });
  }

  it('(I) revision drift after the model draft refuses with no proposal', async () => {
    const vendor = countingVendorInput(vendorInput({ askedRoutineQuestion: true }));
    const core = recordingCoreTransport();
    const invoker = countingInvoker();
    // Reads: 1 first gate, 2 adapter control, 3-4 M4 reply state, 5 second gate.
    const state = driftingState(clearControlState({ partyType: 'VENDOR' }), 5, (c) => ({
      ...c,
      revision: c.revision + 1,
    }));
    const result = await createJarvisRuntime(
      syntheticRuntimeConfig({
        authoritativeState: state,
        gatewayInvoker: invoker,
        coreTransport: core,
        vendorJourneyBehaviourInput: vendor,
      }),
    ).processInbound(syntheticInboundEnvelope({ partyType: 'VENDOR' }));

    expect(result.outcome).toBe('REFUSED');
    expect(result.refusalReason).toBe('orchestration-stale-revision');
    expect(result.proposalId).toBeUndefined();
    expect(vendor.count()).toBe(1);
    expect(invoker.count()).toBe(1);
    expect(core.count()).toBe(0);
  });

  it('(J) cancellation seen only at the second read refuses on the NO-MODEL path', async () => {
    const vendor = countingVendorInput(vendorInput({ requestedHumanAssistance: true }));
    const core = recordingCoreTransport();
    const invoker = countingInvoker();
    // Reads: 1 first gate, 2 adapter control, 3 second gate (no model path, so no reply-state read).
    const state = driftingState(clearControlState({ partyType: 'VENDOR' }), 3, (c) => ({
      ...c,
      cancelled: true,
    }));
    const result = await createJarvisRuntime(
      syntheticRuntimeConfig({
        authoritativeState: state,
        gatewayInvoker: invoker,
        coreTransport: core,
        vendorJourneyBehaviourInput: vendor,
      }),
    ).processInbound(syntheticInboundEnvelope({ partyType: 'VENDOR' }));

    expect(result.outcome).toBe('REFUSED');
    expect(result.refusalReason).toBe('orchestration-cancelled');
    expect(invoker.count()).toBe(0);
    expect(core.count()).toBe(0);
    expect(result.proposalId).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// (K, L, M, N, O) Every disposition, its call counts, reply body and intent.
// ---------------------------------------------------------------------------

describe('(K-O) every Anisha disposition maps exactly through the composition', () => {
  const cases: readonly {
    readonly name: string;
    readonly input: VendorJourneyBehaviourInput;
    readonly kind: string;
    readonly disposition: string;
    readonly intent: string;
    readonly models: number;
    readonly replyBody: boolean;
  }[] = [
    {
      name: 'DRAFT_REPLY -> REPLY',
      input: vendorInput({ askedRoutineQuestion: true }),
      kind: 'REPLY',
      disposition: 'DRAFT_REPLY',
      intent: 'ROUTINE_VENDOR_QUERY',
      models: 1,
      replyBody: true,
    },
    {
      name: 'CONTINUE_CLARIFICATION -> REPLY',
      input: vendorInput({}),
      kind: 'REPLY',
      disposition: 'CONTINUE_CLARIFICATION',
      intent: 'INSUFFICIENT_CONTEXT',
      models: 1,
      replyBody: true,
    },
    {
      name: 'PROPOSE_VENDOR_FOLLOW_UP -> FOLLOW_UP',
      input: vendorInput({ askedAboutPackageOrRecharge: true }, sufficientContext()),
      kind: 'FOLLOW_UP',
      disposition: 'PROPOSE_VENDOR_FOLLOW_UP',
      intent: 'PACKAGE_OR_RECHARGE_READINESS',
      models: 1,
      replyBody: true,
    },
    {
      name: 'REQUEST_VENDOR_ESCALATION -> ESCALATE_TO_HUMAN',
      input: vendorInput({ requestedHumanAssistance: true }),
      kind: 'ESCALATE_TO_HUMAN',
      disposition: 'REQUEST_VENDOR_ESCALATION',
      intent: 'HUMAN_VENDOR_SUPPORT_REQUEST',
      models: 0,
      replyBody: false,
    },
    {
      name: 'REFUSE -> NO_ACTION',
      input: vendorInput({ outOfVendorScope: true }),
      kind: 'NO_ACTION',
      disposition: 'REFUSE',
      intent: 'UNSUPPORTED_NON_VENDOR_REQUEST',
      models: 0,
      replyBody: false,
    },
  ];

  for (const scenario of cases) {
    it(scenario.name, async () => {
      const core = recordingCoreTransport();
      const vendor = countingVendorInput(scenario.input);
      const { result, models } = await runVendor({
        vendorJourneyBehaviourInput: vendor,
        coreTransport: core,
      });

      expect(vendor.count()).toBe(1);
      expect(models).toBe(scenario.models);
      expect(core.count()).toBe(1);
      expect(core.last()?.['proposalKind']).toBe(scenario.kind);
      expect(core.last()?.['assignedActor']).toBe('ANISHA');
      expect(core.last()?.['partyType']).toBe('VENDOR');

      if (scenario.replyBody) {
        expect(typeof core.last()?.['proposedReplyBody']).toBe('string');
      } else {
        expect(core.last()?.['proposedReplyBody']).toBeNull();
      }

      const intent = intentOf(core.last());
      expect(intent['disposition']).toBe(scenario.disposition);
      expect(intent['vendorJourneyIntent']).toBe(scenario.intent);
      expect(intent['replyKind']).toBe(scenario.kind);
      expect(result.modelDrafted).toBe(scenario.models === 1);
    });
  }

  it('every disposition is reachable, and all five map to distinct-or-intended kinds', async () => {
    const kinds = new Set<unknown>();
    for (const scenario of cases) {
      const core = recordingCoreTransport();
      await runVendor({
        vendorJourneyBehaviourInput: countingVendorInput(scenario.input),
        coreTransport: core,
      });
      kinds.add(core.last()?.['proposalKind']);
    }
    // DRAFT_REPLY and CONTINUE_CLARIFICATION intentionally share REPLY.
    expect([...kinds].sort()).toEqual(['ESCALATE_TO_HUMAN', 'FOLLOW_UP', 'NO_ACTION', 'REPLY']);
  });

  it('(O) structuredIntent carries exactly the permitted keys, with and without context', async () => {
    const withoutContext = recordingCoreTransport();
    await runVendor({
      vendorJourneyBehaviourInput: countingVendorInput(vendorInput({ askedRoutineQuestion: true })),
      coreTransport: withoutContext,
    });
    expect(Object.keys(intentOf(withoutContext.last())).sort()).toEqual([
      'behaviourVersion',
      'disposition',
      'replyKind',
      'taskClass',
      'vendorJourneyIntent',
    ]);

    const withContext = recordingCoreTransport();
    await runVendor({
      vendorJourneyBehaviourInput: countingVendorInput(
        vendorInput({ askedAboutPackageOrRecharge: true }, sufficientContext()),
      ),
      coreTransport: withContext,
    });
    expect(Object.keys(intentOf(withContext.last())).sort()).toEqual([
      'behaviourVersion',
      'contextCompleteness',
      'disposition',
      'replyKind',
      'taskClass',
      'vendorJourneyIntent',
    ]);
    expect(intentOf(withContext.last())['contextCompleteness']).toBe('SUFFICIENT_FOR_CORE_REVIEW');

    // Nothing Core owns, and nothing money-adjacent, reaches the proposal.
    const serialized = JSON.stringify(withContext.last());
    for (const forbidden of [
      VENDOR_PROMPT_REF,
      'packageReadinessBand',
      'vendorStageRef',
      'onboardingStepRef',
      'verificationStatusRef',
      'missingFields',
      'critical',
      'wallet',
      'balance',
      'payment',
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it('(N) the FOLLOW_UP guard uses the canonical decision context, not the supplier object', async () => {
    // A package turn whose context is NOT sufficient must not become a FOLLOW_UP.
    const core = recordingCoreTransport();
    await runVendor({
      vendorJourneyBehaviourInput: countingVendorInput(
        vendorInput(
          { askedAboutPackageOrRecharge: true },
          createVendorJourneyContext({
            completeness: 'MORE_CONTEXT_REQUIRED',
            missingFields: ['VENDOR_STAGE'],
          }),
        ),
      ),
      coreTransport: core,
    });
    expect(core.last()?.['proposalKind']).toBe('REPLY');
    expect(intentOf(core.last())['disposition']).toBe('CONTINUE_CLARIFICATION');

    // A human-review context escalates instead, with no model call.
    const escalating = recordingCoreTransport();
    const { models } = await runVendor({
      vendorJourneyBehaviourInput: countingVendorInput(
        vendorInput({ askedAboutPackageOrRecharge: true }, humanReviewContext()),
      ),
      coreTransport: escalating,
    });
    expect(escalating.last()?.['proposalKind']).toBe('ESCALATE_TO_HUMAN');
    expect(models).toBe(0);
  });

  it('a no-model vendor disposition with no Core transport reports NO_ACTION', async () => {
    const invoker = countingInvoker();
    const base = syntheticRuntimeConfig({
      authoritativeState: scriptedAuthoritativeState(clearControlState({ partyType: 'VENDOR' })),
      gatewayInvoker: invoker,
      vendorJourneyBehaviourInput: countingVendorInput(
        vendorInput({ requestedHumanAssistance: true }),
      ),
    });
    const copy: Record<string, unknown> = { ...base };
    delete copy['coreTransport'];
    const result = await createJarvisRuntime(copy as unknown as JarvisRuntimeConfig).processInbound(
      syntheticInboundEnvelope({ partyType: 'VENDOR' }),
    );
    expect(result.outcome).toBe('NO_ACTION');
    expect(result.modelDrafted).toBe(false);
    expect(invoker.count()).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// (T, U, V, W) Provenance, correlation and bounded identifiers.
// ---------------------------------------------------------------------------

describe('(T-W) provenance, correlation and identifier bounds', () => {
  it('(T) the default runtimeRef names this composition, and an explicit one is used verbatim', async () => {
    const { result } = await runVendor({
      vendorJourneyBehaviourInput: countingVendorInput(vendorInput({ askedRoutineQuestion: true })),
    });
    expect(result.provenance?.runtimeRef).toBe('qfj.jarvis-runtime.s3db');

    const custom = await runVendor({
      vendorJourneyBehaviourInput: countingVendorInput(vendorInput({ askedRoutineQuestion: true })),
      provenanceRefs: { runtimeRef: 'runtime.custom.1' },
    });
    expect(custom.result.provenance?.runtimeRef).toBe('runtime.custom.1');
  });

  it('(U) the per-turn vendor promptRef never enters provenance', async () => {
    const { result } = await runVendor({
      vendorJourneyBehaviourInput: countingVendorInput(vendorInput({ askedRoutineQuestion: true })),
    });
    expect(result.provenance?.promptRef).toBeUndefined();
    expect(JSON.stringify(result.provenance)).not.toContain(VENDOR_PROMPT_REF);
  });

  it('(V) provenance correlation is the messageId, independent of the Core adapter correlationId', async () => {
    const { result } = await runVendor({
      vendorJourneyBehaviourInput: countingVendorInput(vendorInput({ askedRoutineQuestion: true })),
      correlationId: 'core.adapter.correlation.1',
    });
    expect(result.provenance?.correlationId).toBe('msg.1');
    expect(result.provenance?.correlationId).not.toBe('core.adapter.correlation.1');
    expect(result.provenance?.correlationId).not.toBe(result.runId);
  });

  it('(refusal) a first-gate refusal still carries provenance attributed to SYSTEM', async () => {
    const { result } = await runVendor({
      authoritativeState: scriptedAuthoritativeState(
        clearControlState({ partyType: 'VENDOR', aiPaused: true }),
      ),
      vendorJourneyBehaviourInput: countingVendorInput(vendorInput({ askedRoutineQuestion: true })),
    });
    expect(result.outcome).toBe('REFUSED');
    expect(result.provenance?.actor).toBe('SYSTEM');
  });

  it('(W) a maximum-length vendor turn completes with every identifier bounded', async () => {
    const MAX_RT = 'r'.repeat(128);
    const MAX_ID = 'c'.repeat(128);
    const MAX_MSG = 'm'.repeat(128);
    const core = recordingCoreTransport();
    const invoker = countingInvoker();

    const result = await createJarvisRuntime(
      syntheticRuntimeConfig({
        authoritativeState: scriptedAuthoritativeState(
          clearControlState({ partyType: 'VENDOR', conversationId: MAX_ID }),
        ),
        gatewayInvoker: invoker,
        coreTransport: core,
        vendorJourneyBehaviourInput: countingVendorInput(
          vendorInput({ askedRoutineQuestion: true }),
        ),
      }),
    ).processInbound(
      syntheticInboundEnvelope({
        partyType: 'VENDOR',
        runtimeId: MAX_RT,
        conversationId: MAX_ID,
        messageId: MAX_MSG,
      }),
    );

    expect(result.outcome).toBe('CORE_ACCEPTED');
    expect(invoker.count()).toBe(1);
    expect(core.count()).toBe(1);
    expect(result.runId).toBe(MAX_RT);
    expect(result.runId).toHaveLength(128);
    expect(result.provenance?.correlationId).toBe(MAX_MSG);
    expect(result.proposalId).toMatch(/^proposal\.[0-9a-f]{32}$/);
    expect(String(core.last()?.['commandId']).length).toBeLessThanOrEqual(256);
  });

  it('(W) a maximum-length NO-MODEL vendor escalation is equally bounded', async () => {
    const MAX_RT = 'r'.repeat(128);
    const MAX_ID = 'c'.repeat(128);
    const MAX_MSG = 'm'.repeat(128);
    const core = recordingCoreTransport();
    const invoker = countingInvoker();

    const result = await createJarvisRuntime(
      syntheticRuntimeConfig({
        authoritativeState: scriptedAuthoritativeState(
          clearControlState({ partyType: 'VENDOR', conversationId: MAX_ID }),
        ),
        gatewayInvoker: invoker,
        coreTransport: core,
        vendorJourneyBehaviourInput: countingVendorInput(
          vendorInput({ matterRequiresEscalation: true }),
        ),
      }),
    ).processInbound(
      syntheticInboundEnvelope({
        partyType: 'VENDOR',
        runtimeId: MAX_RT,
        conversationId: MAX_ID,
        messageId: MAX_MSG,
      }),
    );

    expect(result.outcome).toBe('CORE_ACCEPTED');
    expect(invoker.count()).toBe(0);
    expect(core.last()?.['proposalKind']).toBe('ESCALATE_TO_HUMAN');
    expect(result.runId).toHaveLength(128);
    expect(String(core.last()?.['commandId']).length).toBeLessThanOrEqual(256);
  });
});
