/**
 * S3-C-B — Riya composed into the authoritative runtime (ADR-0068).
 *
 * Every case drives the REAL composition root: `createJarvisRuntime(...).processInbound(envelope)`.
 * Nothing here calls `decideRiyaTurn`, `orchestrateInbound` or `runAgentTurn` directly, because the
 * claim under test is that Riya is reachable through the one authoritative path — not that the pieces
 * work in isolation, which S3-C-A already proved.
 *
 * The model port is a counting fake, so "zero model calls" is an observed count rather than an
 * argument, and the behaviour input port counts its own reads, so "a gate refused before any business
 * state was touched" is observable too.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { createNeedDiscovery } from '@qf-jarvis/riya-agent';
import type { ClientSalesSignals, NeedDiscovery } from '@qf-jarvis/riya-agent';
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
// Counting fakes. Each wraps a shipped `./testing` fake rather than re-implementing it.
// ---------------------------------------------------------------------------

interface Counted {
  readonly count: () => number;
}

/** A gateway invoker that counts invocations and returns one valid structured REPLY. */
function countingInvoker(): ModelGatewayInvoker & Counted {
  const inner = scriptedGatewayInvoker(structuredReply({ citations: [] }));
  return { count: (): number => inner.invoked(), invoke: inner.invoke.bind(inner) };
}

/** A behaviour input port that counts reads and answers with a fixed value. */
function countingBehaviourInput(
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

/** The content-free command fields a test inspects, read off the canonical wire form. */
type WireCommand = Readonly<Record<string, unknown>>;

/**
 * A Core transport that captures the serialized command and delegates the decision to the shipped
 * `scriptedCoreTransport`. It parses the wire form rather than the in-memory object, so it proves what
 * Core would actually receive.
 */
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

/** Read the bounded intent record off a captured wire command. */
function intentOf(command: WireCommand | undefined): Readonly<Record<string, unknown>> {
  return (command?.['structuredIntent'] ?? {}) as Readonly<Record<string, unknown>>;
}

/** A state source that applies `mutate` from the Nth read onward. Drives double-gate drift cases. */
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

const PROMPT_REF = 'prompt.riya.sales.v1';

function behaviourInput(
  signals: Partial<ClientSalesSignals>,
  needDiscovery?: NeedDiscovery,
): ClientSalesBehaviourInput {
  return {
    signals: syntheticSignals(signals),
    ...(needDiscovery === undefined ? {} : { needDiscovery }),
    promptRef: PROMPT_REF,
  };
}

const sufficientDiscovery = (): NeedDiscovery =>
  createNeedDiscovery({
    serviceInterestRef: 'svc.ref.1',
    locationRef: 'loc.ref.1',
    completeness: 'SUFFICIENT_FOR_CORE_REVIEW',
  });

const incompleteDiscovery = (): NeedDiscovery =>
  createNeedDiscovery({
    completeness: 'MORE_DISCOVERY_REQUIRED',
    missingFields: ['budget', 'timeline'],
  });

/**
 * Drop the Core transport entirely.
 *
 * `exactOptionalPropertyTypes` makes `coreTransport: undefined` a different thing from an absent key,
 * and only the absent key means "no Core wired" — so the key is removed rather than blanked.
 */
function withoutCoreTransport(config: JarvisRuntimeConfig): JarvisRuntimeConfig {
  const copy: Record<string, unknown> = { ...config };
  delete copy['coreTransport'];
  return copy as unknown as JarvisRuntimeConfig;
}

/** Run one turn through the real composition root and hand back everything a case needs. */
async function run(
  over: Partial<JarvisRuntimeConfig> = {},
  dropCore = false,
): Promise<{ result: JarvisRuntimeResult; models: number }> {
  const invoker = countingInvoker();
  const base = syntheticRuntimeConfig({ gatewayInvoker: invoker, ...over });
  const config = dropCore ? withoutCoreTransport(base) : base;
  const result = await createJarvisRuntime(config).processInbound(syntheticInboundEnvelope());
  return { result, models: invoker.count() };
}

// ---------------------------------------------------------------------------
// (1) The corrected M2 proposal vocabulary.
// ---------------------------------------------------------------------------

describe('(1) the M2 orchestration proposal vocabulary', () => {
  it('is exactly the five expected kinds, in order', async () => {
    const { ORCHESTRATION_PROPOSAL_KINDS } = await import('@qf-jarvis/agent-runtime');
    expect([...ORCHESTRATION_PROPOSAL_KINDS]).toEqual([
      'REPLY',
      'FOLLOW_UP',
      'ESCALATE_TO_HUMAN',
      'REQUEST_CLARIFICATION',
      'NO_ACTION',
    ]);
  });

  it('the M1 vocabulary is untouched and still separate', async () => {
    const { RUNTIME_PROPOSAL_KINDS } = await import('@qf-jarvis/agent-runtime');
    expect([...RUNTIME_PROPOSAL_KINDS]).toEqual([
      'AGENT_ASSIGNMENT',
      'REPLY',
      'FOLLOW_UP',
      'ESCALATION',
      'TOOL_INTENT',
    ]);
  });
});

// ---------------------------------------------------------------------------
// (2-3) All five dispositions, reachable through createJarvisRuntime.
// ---------------------------------------------------------------------------

describe('(2, 3) every Riya disposition through the authoritative path', () => {
  it('DRAFT_REPLY -> REPLY, exactly one model call, reply body present', async () => {
    const core = recordingCoreTransport();
    const { result, models } = await run({
      behaviourInput: countingBehaviourInput(behaviourInput({ providedRequirementDetail: true })),
      coreTransport: core,
    });
    expect(result.outcome).toBe('CORE_ACCEPTED');
    expect(models).toBe(1);
    expect(result.modelDrafted).toBe(true);
    expect(core.last()?.['proposalKind']).toBe('REPLY');
    expect(typeof core.last()?.['proposedReplyBody']).toBe('string');
    expect(intentOf(core.last())['disposition']).toBe('DRAFT_REPLY');
    expect(intentOf(core.last())['salesIntent']).toBe('REQUIREMENT_DISCOVERY');
  });

  it('CONTINUE_DISCOVERY -> REPLY, exactly one model call, reply body present', async () => {
    const core = recordingCoreTransport();
    const { result, models } = await run({
      behaviourInput: countingBehaviourInput(
        behaviourInput({ requestedQuoteOrConsultation: true }, incompleteDiscovery()),
      ),
      coreTransport: core,
    });
    expect(result.outcome).toBe('CORE_ACCEPTED');
    expect(models).toBe(1);
    expect(core.last()?.['proposalKind']).toBe('REPLY');
    expect(typeof core.last()?.['proposedReplyBody']).toBe('string');
    expect(intentOf(core.last())['disposition']).toBe('CONTINUE_DISCOVERY');
    expect(intentOf(core.last())['discoveryCompleteness']).toBe('MORE_DISCOVERY_REQUIRED');
  });

  it('PROPOSE_SALES_FOLLOW_UP -> FOLLOW_UP, one model call, body preserved into the Core command', async () => {
    const core = recordingCoreTransport();
    const { result, models } = await run({
      behaviourInput: countingBehaviourInput(
        behaviourInput({ requestedQuoteOrConsultation: true }, sufficientDiscovery()),
      ),
      coreTransport: core,
    });
    expect(result.outcome).toBe('CORE_ACCEPTED');
    expect(models).toBe(1);
    expect(result.modelDrafted).toBe(true);
    expect(core.last()?.['proposalKind']).toBe('FOLLOW_UP');
    expect(typeof core.last()?.['proposedReplyBody']).toBe('string');
    expect(intentOf(core.last())['discoveryCompleteness']).toBe('SUFFICIENT_FOR_CORE_REVIEW');
    expect(core.last()?.['assignedActor']).toBe('RIYA');
    expect(core.last()?.['partyType']).toBe('CLIENT');
    expect(core.last()?.['expectedRevision']).toBe(1);
  });

  it('REQUEST_HUMAN_SALES_CONTACT -> ESCALATE_TO_HUMAN, ZERO model calls, no reply body', async () => {
    const core = recordingCoreTransport();
    const { result, models } = await run({
      behaviourInput: countingBehaviourInput(behaviourInput({ requestedHumanAssistance: true })),
      coreTransport: core,
    });
    expect(models).toBe(0);
    expect(result.modelDrafted).toBe(false);
    expect(core.count()).toBe(1);
    expect(core.last()?.['proposalKind']).toBe('ESCALATE_TO_HUMAN');
    expect(core.last()?.['proposedReplyBody']).toBeNull();
    expect(result.outcome).toBe('CORE_ACCEPTED');
  });

  it('REFUSE -> NO_ACTION, ZERO model calls, no reply body', async () => {
    const core = recordingCoreTransport();
    const { result, models } = await run({
      behaviourInput: countingBehaviourInput(behaviourInput({ outOfSalesScope: true })),
      coreTransport: core,
    });
    expect(models).toBe(0);
    expect(result.modelDrafted).toBe(false);
    expect(core.last()?.['proposalKind']).toBe('NO_ACTION');
    expect(core.last()?.['proposedReplyBody']).toBeNull();
    expect(intentOf(core.last())['salesIntent']).toBe('UNSUPPORTED_NON_SALES_REQUEST');
  });

  it('a no-model disposition with no Core transport reports NO_ACTION, not MODEL_DRAFTED', async () => {
    const { result, models } = await run(
      {
        behaviourInput: countingBehaviourInput(behaviourInput({ requestedHumanAssistance: true })),
      },
      true,
    );
    expect(models).toBe(0);
    expect(result.outcome).toBe('NO_ACTION');
    expect(result.modelDrafted).toBe(false);
    expect(result.coreConsulted).toBe(false);
  });

  it('a model-backed disposition with no Core transport still reports MODEL_DRAFTED', async () => {
    const { result, models } = await run(
      {
        behaviourInput: countingBehaviourInput(behaviourInput({ providedRequirementDetail: true })),
      },
      true,
    );
    expect(models).toBe(1);
    expect(result.outcome).toBe('MODEL_DRAFTED');
    expect(result.modelDrafted).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// (4) First-gate refusals: no behaviour read, no model, no Core, no proposal.
// ---------------------------------------------------------------------------

describe('(4) every first-gate refusal happens before any behaviour input is read', () => {
  const cases: readonly {
    name: string;
    config: Partial<JarvisRuntimeConfig>;
    envelope?: Parameters<typeof syntheticInboundEnvelope>[0];
  }[] = [
    {
      name: 'cancelled',
      config: {
        authoritativeState: scriptedAuthoritativeState(clearControlState({ cancelled: true })),
      },
    },
    {
      name: 'human takeover',
      config: {
        authoritativeState: scriptedAuthoritativeState(clearControlState({ humanTakeover: true })),
      },
    },
    {
      name: 'AI paused',
      config: {
        authoritativeState: scriptedAuthoritativeState(clearControlState({ aiPaused: true })),
      },
    },
    {
      name: 'subject blocked',
      config: {
        authoritativeState: scriptedAuthoritativeState(
          clearControlState({ subjectRef: 'subj.1', subjectStatus: 'erased' }),
        ),
      },
    },
    {
      name: 'HUMAN_ONLY data class',
      config: {
        authoritativeState: scriptedAuthoritativeState(
          clearControlState({ dataClass: 'HUMAN_ONLY' }),
        ),
      },
    },
    { name: 'envelope mismatch', config: {}, envelope: { conversationId: 'conv.other' } },
  ];

  for (const scenario of cases) {
    it(`${scenario.name}: behaviour input 0, model 0, Core 0, no proposal`, async () => {
      const invoker = countingInvoker();
      const behaviour = countingBehaviourInput(behaviourInput({ providedRequirementDetail: true }));
      const core = recordingCoreTransport();
      const config = syntheticRuntimeConfig({
        gatewayInvoker: invoker,
        behaviourInput: behaviour,
        coreTransport: core,
        ...scenario.config,
      });
      const result = await createJarvisRuntime(config).processInbound(
        syntheticInboundEnvelope(scenario.envelope ?? {}),
      );
      expect(result.outcome).toBe('REFUSED');
      expect(behaviour.count()).toBe(0);
      expect(invoker.count()).toBe(0);
      expect(core.count()).toBe(0);
      expect(result.proposalId).toBeUndefined();
      expect(result.modelDrafted).toBe(false);
    });
  }

  it('a VENDOR conversation never reads client-sales behaviour input', async () => {
    const behaviour = countingBehaviourInput(behaviourInput({ providedRequirementDetail: true }));
    const invoker = countingInvoker();
    const config = syntheticRuntimeConfig({
      gatewayInvoker: invoker,
      behaviourInput: behaviour,
      authoritativeState: scriptedAuthoritativeState(clearControlState({ partyType: 'VENDOR' })),
    });
    const result = await createJarvisRuntime(config).processInbound(
      syntheticInboundEnvelope({ partyType: 'VENDOR' }),
    );
    expect(behaviour.count()).toBe(0);
    expect(result.assignedActor === 'RIYA').toBe(false);
  });

  it('an eligible CLIENT turn is assigned to RIYA', async () => {
    const { result } = await run({
      behaviourInput: countingBehaviourInput(behaviourInput({ providedRequirementDetail: true })),
    });
    expect(result.assignedActor).toBe('RIYA');
  });
});

// ---------------------------------------------------------------------------
// (5-6) The legacy default and fail-closed behaviour input.
// ---------------------------------------------------------------------------

describe('(5, 6) the behaviour seam is optional and fails closed', () => {
  it('no behaviour port at all preserves the exact legacy REPLY path', async () => {
    const core = recordingCoreTransport();
    const { result, models } = await run({ coreTransport: core });
    expect(result.outcome).toBe('CORE_ACCEPTED');
    expect(models).toBe(1);
    expect(core.last()?.['proposalKind']).toBe('REPLY');
    expect(intentOf(core.last())).toEqual({
      taskClass: 'RESPONSE_GENERATION',
      replyKind: 'REPLY',
    });
  });

  it('a port that returns undefined preserves the exact legacy REPLY path', async () => {
    const core = recordingCoreTransport();
    const behaviour = countingBehaviourInput(undefined);
    const { result, models } = await run({ behaviourInput: behaviour, coreTransport: core });
    expect(behaviour.count()).toBe(1);
    expect(result.outcome).toBe('CORE_ACCEPTED');
    expect(models).toBe(1);
    expect(core.last()?.['proposalKind']).toBe('REPLY');
  });

  it('a rejecting port fails closed with zero model calls and no proposal', async () => {
    const core = recordingCoreTransport();
    const { result, models } = await run({
      behaviourInput: {
        read: (): Promise<ClientSalesBehaviourInput | undefined> =>
          Promise.reject(new Error('synthetic failure')),
      },
      coreTransport: core,
    });
    expect(result.outcome).toBe('REFUSED');
    expect(result.refusalReason).toBe('orchestration-invariant');
    expect(models).toBe(0);
    expect(core.count()).toBe(0);
    expect(result.proposalId).toBeUndefined();
  });

  it('malformed signals fail closed with zero model calls', async () => {
    const { result, models } = await run({
      behaviourInput: countingBehaviourInput({
        signals: { hasPriorSalesContext: 'yes' } as unknown as ClientSalesSignals,
        promptRef: PROMPT_REF,
      }),
    });
    expect(result.outcome).toBe('REFUSED');
    expect(models).toBe(0);
  });

  it('a malformed discovery snapshot fails closed', async () => {
    const { result, models } = await run({
      behaviourInput: countingBehaviourInput({
        signals: syntheticSignals({ requestedQuoteOrConsultation: true }),
        // The one combination that would be a lie: sufficient, yet fields still missing.
        needDiscovery: {
          behaviourVersion: 1,
          serviceInterestRef: undefined,
          locationRef: undefined,
          propertyTypeRef: undefined,
          scopeSummary: undefined,
          budgetNote: undefined,
          timelineNote: undefined,
          consultationPreferenceRef: undefined,
          completeness: 'SUFFICIENT_FOR_CORE_REVIEW',
          missingFields: ['budget'],
        },
        promptRef: PROMPT_REF,
      }),
    });
    expect(result.outcome).toBe('REFUSED');
    expect(models).toBe(0);
  });

  it('an invalid promptRef fails closed and never reaches an output', async () => {
    const { result, models } = await run({
      behaviourInput: countingBehaviourInput({
        signals: syntheticSignals({ providedRequirementDetail: true }),
        promptRef: 'you are a helpful sales assistant',
      }),
    });
    expect(result.outcome).toBe('REFUSED');
    expect(models).toBe(0);
    expect(JSON.stringify(result)).not.toContain('helpful sales assistant');
  });

  it('the opaque promptRef never enters the proposal intent, the Core command or provenance', async () => {
    const core = recordingCoreTransport();
    const { result } = await run({
      behaviourInput: countingBehaviourInput(behaviourInput({ providedRequirementDetail: true })),
      coreTransport: core,
    });
    expect(JSON.stringify(intentOf(core.last()))).not.toContain(PROMPT_REF);
    expect(JSON.stringify(core.last())).not.toContain(PROMPT_REF);
    expect(JSON.stringify(result.provenance)).not.toContain(PROMPT_REF);
  });
});

// ---------------------------------------------------------------------------
// (7) The second gate, on both the model and the no-model path.
// ---------------------------------------------------------------------------

describe('(7) the double gate still runs on both paths', () => {
  it('revision drift after a model draft refuses with no proposal', async () => {
    const core = recordingCoreTransport();
    const invoker = countingInvoker();
    // The M4 adapter has its own state gate and would catch a drift that lands DURING the draft, so
    // this case moves the revision strictly afterwards - the exact window the M2 second gate owns.
    // Reads: 1 first gate, 2 behaviour control, 3-4 M4 reply state, 5 second gate.
    const state = driftingState(clearControlState(), 5, (c) => ({
      ...c,
      revision: c.revision + 1,
    }));
    const result = await createJarvisRuntime(
      syntheticRuntimeConfig({
        authoritativeState: state,
        gatewayInvoker: invoker,
        coreTransport: core,
        behaviourInput: countingBehaviourInput(behaviourInput({ providedRequirementDetail: true })),
      }),
    ).processInbound(syntheticInboundEnvelope());
    expect(result.outcome).toBe('REFUSED');
    expect(result.refusalReason).toBe('orchestration-stale-revision');
    expect(result.proposalId).toBeUndefined();
    expect(core.count()).toBe(0);
    expect(invoker.count()).toBe(1);
  });

  it('cancellation observed only at the second read refuses on the NO-MODEL path', async () => {
    const core = recordingCoreTransport();
    const invoker = countingInvoker();
    // Reads: 1 first gate, 2 behaviour control read, 3 second gate (no model path, so no reply read).
    const state = driftingState(clearControlState(), 3, (c) => ({ ...c, cancelled: true }));
    const result = await createJarvisRuntime(
      syntheticRuntimeConfig({
        authoritativeState: state,
        gatewayInvoker: invoker,
        coreTransport: core,
        behaviourInput: countingBehaviourInput(behaviourInput({ requestedHumanAssistance: true })),
      }),
    ).processInbound(syntheticInboundEnvelope());
    expect(result.outcome).toBe('REFUSED');
    expect(result.refusalReason).toBe('orchestration-cancelled');
    expect(invoker.count()).toBe(0);
    expect(core.count()).toBe(0);
    expect(result.proposalId).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// (8) Provenance.
// ---------------------------------------------------------------------------

describe('(8) provenance is stamped through runAgentTurn', () => {
  it('a served Riya turn is attributed to RIYA with the two locked literals', async () => {
    const { result } = await run({
      behaviourInput: countingBehaviourInput(behaviourInput({ providedRequirementDetail: true })),
    });
    expect(result.provenance).toBeDefined();
    expect(result.provenance?.actor).toBe('RIYA');
    expect(result.provenance?.authority).toBe('QUICKFURNO_CORE');
    expect(result.provenance?.modelOutputRetention).toBe('DISCARDED');
  });

  it('a no-model Riya proposal is also attributed to RIYA', async () => {
    const { result } = await run({
      behaviourInput: countingBehaviourInput(behaviourInput({ requestedHumanAssistance: true })),
    });
    expect(result.provenance?.actor).toBe('RIYA');
  });

  it('a merged orchestration refusal still carries provenance, attributed to SYSTEM', async () => {
    const { result } = await run({
      authoritativeState: scriptedAuthoritativeState(clearControlState({ aiPaused: true })),
    });
    expect(result.outcome).toBe('REFUSED');
    expect(result.provenance).toBeDefined();
    expect(result.provenance?.actor).toBe('SYSTEM');
  });

  it('carries no reply body, model output, provider response, credential, PII or signal value', async () => {
    const { result } = await run({
      behaviourInput: countingBehaviourInput(behaviourInput({ providedRequirementDetail: true })),
    });
    const serialized = JSON.stringify(result.provenance);
    // The drafted reply BODY, not the letters "reply" — `releaseRef` is legitimately `rel.reply.1`.
    expect(serialized).not.toContain('Thank you for reaching out');
    for (const forbidden of [
      'hasPriorSalesContext',
      'requestedHumanAssistance',
      'Bearer',
      'gsk_',
      'phone',
      'email',
      '@',
      'http',
      'replyBody',
    ]) {
      expect(serialized.toLowerCase()).not.toContain(forbidden.toLowerCase());
    }
    expect(Object.keys(result.provenance ?? {}).sort()).toEqual([
      'actor',
      'authority',
      'configRef',
      'contractVersion',
      'correlationId',
      'modelOutputRetention',
      'modelRef',
      'occurredAt',
      'policyRef',
      'promptRef',
      'providerRef',
      'releaseRef',
      'runtimeRef',
    ]);
  });

  it('an unsafe modelRef such as openai/gpt-oss-20b is REJECTED, never silently normalized', async () => {
    const { result } = await run({
      provenanceRefs: { modelRef: 'openai/gpt-oss-20b' },
    });
    expect(result.outcome).toBe('REFUSED');
    expect(result.refusalReason).toBe('orchestration-invariant');
    expect(result.provenance).toBeUndefined();
    expect(JSON.stringify(result)).not.toContain('gpt-oss');
  });

  it('release.modelId is never used as a provenance reference', async () => {
    const { result } = await run({});
    expect(result.provenance?.modelRef).toBeUndefined();
    expect(result.provenance?.releaseRef).toBe('rel.reply.1');
    expect(result.provenance?.configRef).toBe('cfg00001');
  });
});

// ---------------------------------------------------------------------------
// (9) One pipeline, one proposal, no second path.
// ---------------------------------------------------------------------------

describe('(9) one turn, one orchestration, one proposal', () => {
  it('one turn invokes the model once and Core once - a second orchestration would double both', async () => {
    const core = recordingCoreTransport();
    const { result, models } = await run({
      behaviourInput: countingBehaviourInput(behaviourInput({ providedRequirementDetail: true })),
      coreTransport: core,
    });
    expect(models).toBe(1);
    expect(core.count()).toBe(1);
    // ADR-0069: a bounded derived identity, not `${runId}-reply`.
    expect(result.proposalId).toMatch(/^proposal\.[0-9a-f]{32}$/);
    expect(result.runId).toBe('rt.1');
  });

  it('createRiyaProposal is never reachable from the composed runtime source', () => {
    const root = fileURLToPath(new URL('../', import.meta.url));
    const files: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
        } else if (entry.name.endsWith('.ts') && !full.includes('tests')) {
          files.push(full);
        }
      }
    };
    walk(root);
    for (const file of files) {
      // Comments are stripped: prose may NAME the pipeline this composition deliberately does not
      // call, and a scan that cannot tell an explanation from a call site proves nothing.
      const code = readFileSync(file, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .split(String.fromCharCode(10))
        .filter((line) => !/^\s*\/\//.test(line))
        .join(String.fromCharCode(10));
      expect(code).not.toContain('createRiyaProposal');
      expect(code).not.toContain('proposalKindFor');
      // The composition must not reach past runAgentTurn into the pipeline it wraps.
      expect(code).not.toContain('orchestrateInbound');
    }
  });
});

// ---------------------------------------------------------------------------
// (10) Provenance correlation bounds — the final-review regression.
// ---------------------------------------------------------------------------

describe('(10) every derived identifier stays bounded at maximum-length input', () => {
  const MAX_RT = 'r'.repeat(128);
  const MAX_ID = 'c'.repeat(128);
  const MAX_MSG = 'm'.repeat(128);

  /** A max-length envelope: runtimeId, conversationId and messageId all at the 128-char ceiling. */
  function maxLengthRun(over: Partial<JarvisRuntimeConfig> = {}): Promise<JarvisRuntimeResult> {
    return createJarvisRuntime(
      syntheticRuntimeConfig({
        authoritativeState: scriptedAuthoritativeState(
          clearControlState({ conversationId: MAX_ID }),
        ),
        ...over,
      }),
    ).processInbound(
      syntheticInboundEnvelope({ runtimeId: MAX_RT, conversationId: MAX_ID, messageId: MAX_MSG }),
    );
  }

  it('a refused max-length turn keeps bounded provenance and the canonical run id', async () => {
    const invoker = countingInvoker();
    const result = await maxLengthRun({
      gatewayInvoker: invoker,
      authoritativeState: scriptedAuthoritativeState(
        clearControlState({ conversationId: MAX_ID, aiPaused: true }),
      ),
      behaviourInput: countingBehaviourInput(behaviourInput({ providedRequirementDetail: true })),
    });

    // The run id used to be `conversationId-messageId` — 257 characters, past every 128-character
    // bound it fed. It is now the envelope's own runtimeId (ADR-0069).
    expect(result.runId).toBe(MAX_RT);
    expect(result.runId).toHaveLength(128);
    expect(result.provenance).toBeDefined();
    expect(result.provenance?.correlationId).toBe(MAX_MSG);
    expect(result.provenance?.correlationId).toHaveLength(128);
    expect(result.outcome).toBe('REFUSED');
    expect(result.refusalReason).toBe('orchestration-ai-paused');
    expect(result.provenance?.actor).toBe('SYSTEM');
    expect(invoker.count()).toBe(0);
  });

  it('a max-length MODEL-BACKED served turn now completes end to end', async () => {
    const invoker = countingInvoker();
    const core = recordingCoreTransport();
    const result = await maxLengthRun({
      gatewayInvoker: invoker,
      coreTransport: core,
      behaviourInput: countingBehaviourInput(behaviourInput({ providedRequirementDetail: true })),
    });

    // Before ADR-0069 this exact envelope failed `orchestration-draft-invalid`, because the M4
    // draft's usageTraceId inherited the 257-character run id.
    expect(result.outcome).toBe('CORE_ACCEPTED');
    expect(result.refusalReason).toBeUndefined();
    expect(invoker.count()).toBe(1);
    expect(core.count()).toBe(1);

    expect(result.runId).toBe(MAX_RT);
    expect(result.runId).toHaveLength(128);
    expect(result.provenance).toBeDefined();
    expect(result.provenance?.correlationId).toBe(MAX_MSG);
    expect(result.provenance?.correlationId).toHaveLength(128);

    // The proposal id is a fixed-width derived identity, comfortably inside the 128-char bound.
    expect(result.proposalId).toMatch(/^proposal\.[0-9a-f]{32}$/);
    expect(result.proposalId?.length).toBe(41);
    expect(result.proposalId?.length).toBeLessThan(128);

    // The Core command concatenates a 128-char conversation id with the proposal id and a revision
    // suffix; the response schema caps commandId at 256.
    const commandId = core.last()?.['commandId'];
    expect(typeof commandId).toBe('string');
    expect(String(commandId).length).toBeLessThanOrEqual(256);
    expect(core.last()?.['proposalId']).toBe(result.proposalId);
    expect(typeof core.last()?.['proposedReplyBody']).toBe('string');
  });

  it('a max-length NO-MODEL served turn completes with zero model calls', async () => {
    const invoker = countingInvoker();
    const core = recordingCoreTransport();
    const result = await maxLengthRun({
      gatewayInvoker: invoker,
      coreTransport: core,
      behaviourInput: countingBehaviourInput(behaviourInput({ requestedHumanAssistance: true })),
    });

    expect(result.outcome).toBe('CORE_ACCEPTED');
    expect(invoker.count()).toBe(0);
    expect(core.count()).toBe(1);
    expect(result.modelDrafted).toBe(false);
    expect(result.runId).toBe(MAX_RT);
    expect(result.provenance?.correlationId).toBe(MAX_MSG);
    expect(result.proposalId).toMatch(/^proposal\.[0-9a-f]{32}$/);
    // Kind and reply-body rules are unchanged by the identifier repair.
    expect(core.last()?.['proposalKind']).toBe('ESCALATE_TO_HUMAN');
    expect(core.last()?.['proposedReplyBody']).toBeNull();
    expect(String(core.last()?.['commandId']).length).toBeLessThanOrEqual(256);
  });

  it('the run id is the runtimeId, never a concatenation of conversation and message ids', async () => {
    const core = recordingCoreTransport();
    const { result } = await run({
      coreTransport: core,
      behaviourInput: countingBehaviourInput(behaviourInput({ providedRequirementDetail: true })),
    });
    expect(result.runId).toBe('rt.1');
    expect(result.runId).not.toContain('conv.1-msg.1');
    // usageTraceId travels through the M4 draft as the same canonical value; a proposal exists, which
    // it could not if the draft had been rejected.
    expect(result.proposalId).toMatch(/^proposal\.[0-9a-f]{32}$/);
  });

  it('the proposal id is deterministic, and changes when the identity changes', async () => {
    const first = await maxLengthRun({
      behaviourInput: countingBehaviourInput(behaviourInput({ providedRequirementDetail: true })),
    });
    const again = await maxLengthRun({
      behaviourInput: countingBehaviourInput(behaviourInput({ providedRequirementDetail: true })),
    });
    expect(again.proposalId).toBe(first.proposalId);

    // A different message id is a different proposal identity.
    const otherMessage = await createJarvisRuntime(
      syntheticRuntimeConfig({
        authoritativeState: scriptedAuthoritativeState(
          clearControlState({ conversationId: MAX_ID }),
        ),
        behaviourInput: countingBehaviourInput(behaviourInput({ providedRequirementDetail: true })),
      }),
    ).processInbound(
      syntheticInboundEnvelope({
        runtimeId: MAX_RT,
        conversationId: MAX_ID,
        messageId: 'm'.repeat(127),
      }),
    );
    expect(otherMessage.proposalId).not.toBe(first.proposalId);

    // A different proposal KIND is a different proposal identity.
    const escalation = await maxLengthRun({
      behaviourInput: countingBehaviourInput(behaviourInput({ requestedHumanAssistance: true })),
    });
    expect(escalation.proposalId).not.toBe(first.proposalId);

    // The derived id leaks none of the raw identity it was derived from.
    for (const raw of [MAX_RT, MAX_ID, MAX_MSG, 'conv.1', 'msg.1', PROMPT_REF]) {
      expect(first.proposalId).not.toContain(raw);
    }
  });
});

describe('(11) the provenance correlation source is separate from every other identity', () => {
  const MAX_ID = 'c'.repeat(128);

  it('the provenance correlation is the messageId, never the Core adapter correlationId', async () => {
    const { result } = await run({
      correlationId: 'core.adapter.correlation.1',
      behaviourInput: countingBehaviourInput(behaviourInput({ providedRequirementDetail: true })),
    });
    // config.correlationId belongs to the M3 Core adapter and must not leak into the audit record.
    expect(result.provenance?.correlationId).toBe('msg.1');
    expect(result.provenance?.correlationId).not.toBe('core.adapter.correlation.1');
    // ...and it is not the run id either: four identities, four contracts (ADR-0069).
    expect(result.provenance?.correlationId).not.toBe(result.runId);
    expect(MAX_ID.length).toBe(128);
  });

  it('an explicitly supplied provenance correlationId is used verbatim', async () => {
    const { result } = await run({
      provenanceRefs: { correlationId: 'prov.correlation.7' },
      behaviourInput: countingBehaviourInput(behaviourInput({ providedRequirementDetail: true })),
    });
    expect(result.provenance?.correlationId).toBe('prov.correlation.7');
  });

  const unsafe: readonly { readonly name: string; readonly value: string }[] = [
    { name: 'a value containing a slash', value: 'tenant/abc' },
    { name: 'a value longer than 128', value: 'z'.repeat(129) },
  ];

  for (const scenario of unsafe) {
    it(`${scenario.name} fails the turn closed and is never normalized`, async () => {
      const core = recordingCoreTransport();
      const { result, models } = await run({
        provenanceRefs: { correlationId: scenario.value },
        coreTransport: core,
        behaviourInput: countingBehaviourInput(behaviourInput({ providedRequirementDetail: true })),
      });
      expect(result.outcome).toBe('REFUSED');
      expect(result.refusalReason).toBe('orchestration-invariant');
      expect(result.provenance).toBeUndefined();
      // Neither the raw value nor any repaired form of it appears anywhere in the result.
      expect(JSON.stringify(result)).not.toContain(scenario.value);
      expect(JSON.stringify(result)).not.toContain(scenario.value.replace('/', '-'));
      expect(JSON.stringify(result)).not.toContain(scenario.value.slice(0, 128));

      // HONEST ACCOUNTING: provenance is built by runAgentTurn AFTER orchestrateInbound returns, so
      // an unsafe reference is caught only once the pipeline has already run. The orchestration still
      // happens exactly once — there is no retry and no second run — and nothing was sent, persisted
      // or executed, but this path is NOT a zero-model path and is not claimed to be.
      expect(models).toBe(1);
      expect(core.count()).toBe(1);
    });
  }
});
