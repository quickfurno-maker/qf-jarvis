/**
 * RWC-P2D — Core-authorized web reply materialization (ADR-0096).
 *
 * The property under test is a boundary, not a feature: ordinary `processInbound` must stay
 * content-free even on the happy path, and the ONLY way to obtain client-facing text must be the
 * explicitly named capability, and only after QuickFurno Core actually authorized that exact
 * proposal.
 *
 * Every case uses a SENTINEL body. A sentinel is what turns "no text leaked" from a claim about the
 * shape of a type into a claim about the bytes that exist in an object, an event or a serialization.
 */
import { createInboundEnvelope } from '@qf-jarvis/agent-runtime';
import type { OrchestrationProposal } from '@qf-jarvis/agent-runtime';
import type { CoreDecisionTransport } from '@qf-jarvis/core-decision-adapter';
import { scriptedCoreTransport } from '@qf-jarvis/core-decision-adapter/testing';
import type { ModelGatewayInvoker } from '@qf-jarvis/model-reply-adapter';
import {
  rawStructuredGatewayInvoker,
  scriptedGatewayInvoker,
  structuredReply,
} from '@qf-jarvis/model-reply-adapter/testing';
import { createNeedDiscovery } from '@qf-jarvis/riya-agent';
import type { ClientSalesSignals, NeedDiscovery } from '@qf-jarvis/riya-agent';
import { describe, expect, it } from 'vitest';

import { createJarvisRuntime } from '../composition/create-jarvis-runtime.js';
import { materializeCoreAuthorizedReply } from '../composition/materialize-core-authorized-reply.js';
import type { ConversationControlState } from '../contracts/authoritative-state.js';
import type { ClientSalesBehaviourInput } from '../contracts/behaviour-input.js';
import type { JarvisRuntimeEvent } from '../contracts/observability.js';
import type { JarvisRuntimeConfig } from '../contracts/runtime-config.js';
import type { JarvisRuntimeResult } from '../contracts/runtime-result.js';
import {
  clearControlState,
  mutableAuthoritativeState,
} from '../testing/deterministic-authoritative-state.js';
import {
  scriptedBehaviourInput,
  syntheticInboundEnvelope,
  syntheticRuntimeConfig,
  syntheticSignals,
} from '../testing/deterministic-runtime-fixture.js';

/**
 * The one string this whole file is about.
 *
 * Deliberately unlike any fixture default, so finding it anywhere is evidence rather than a
 * coincidental substring match.
 */
const SENTINEL = 'SENTINEL-P2D-4b81f0c7-client-facing-answer-text';

/** The exact own-key set of `JarvisRuntimeResult`, locked. A new key here is a review decision. */
const RUNTIME_RESULT_KEYS = [
  'assignedActor',
  'boundRevision',
  'conversationId',
  'coreConsulted',
  'modelDrafted',
  'outcome',
  'proposalId',
  'provenance',
  'refusalReason',
  'runId',
] as const;

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

/** Discovery complete enough for Core review — the precondition for a FOLLOW_UP proposal. */
const sufficientDiscovery = (): NeedDiscovery =>
  createNeedDiscovery({
    serviceInterestRef: 'svc.ref.1',
    locationRef: 'loc.ref.1',
    completeness: 'SUFFICIENT_FOR_CORE_REVIEW',
  });

/** A gateway invoker that answers with the sentinel body and counts its own invocations. */
function sentinelInvoker(): ModelGatewayInvoker & { invoked(): number } {
  return scriptedGatewayInvoker(structuredReply({ replyBody: SENTINEL, citations: [] }));
}

/**
 * Drop the Core transport entirely.
 *
 * `exactOptionalPropertyTypes` makes `coreTransport: undefined` a different thing from an absent
 * key, and only the absent key means "no Core wired".
 */
function withoutCoreTransport(config: JarvisRuntimeConfig): JarvisRuntimeConfig {
  const copy: Record<string, unknown> = { ...config };
  delete copy['coreTransport'];
  return copy as unknown as JarvisRuntimeConfig;
}

/** One turn through the real composition root, via the CONTENT-BEARING capability. */
async function runDetailed(
  over: Partial<JarvisRuntimeConfig> = {},
  dropCore = false,
): ReturnType<ReturnType<typeof createJarvisRuntime>['processInboundForCoreAuthorizedReply']> {
  const base = syntheticRuntimeConfig({
    gatewayInvoker: sentinelInvoker(),
    ...over,
  });
  const config = dropCore ? withoutCoreTransport(base) : base;
  return createJarvisRuntime(config).processInboundForCoreAuthorizedReply(
    syntheticInboundEnvelope(),
  );
}

/** One turn through the real composition root, via the ORDINARY content-free entry point. */
async function runOrdinary(over: Partial<JarvisRuntimeConfig> = {}): Promise<JarvisRuntimeResult> {
  return createJarvisRuntime(
    syntheticRuntimeConfig({ gatewayInvoker: sentinelInvoker(), ...over }),
  ).processInbound(syntheticInboundEnvelope());
}

/** Every string reachable from a value, however nested. Used to hunt the sentinel. */
function allStrings(value: unknown, found: string[] = []): string[] {
  if (typeof value === 'string') {
    found.push(value);
  } else if (Array.isArray(value)) {
    for (const item of value) {
      allStrings(item, found);
    }
  } else if (typeof value === 'object' && value !== null) {
    for (const item of Object.values(value)) {
      allStrings(item, found);
    }
  }
  return found;
}

// ---------------------------------------------------------------------------
// (1, 17) The ordinary entry point stays exactly what it was.
// ---------------------------------------------------------------------------

describe('(1, 17) ordinary processInbound remains content-free', () => {
  it('(1) a fully successful CORE_ACCEPTED turn exposes the body nowhere at all', async () => {
    const result = await runOrdinary();
    expect(result.outcome).toBe('CORE_ACCEPTED');
    expect(result.modelDrafted).toBe(true);

    // Not in any own value, at any depth, including the provenance record.
    expect(allStrings(result).some((s) => s.includes(SENTINEL))).toBe(false);
    // Not in a whole-object serialization -- the shape a logger or a trace span would capture.
    expect(JSON.stringify(result)).not.toContain(SENTINEL);
    // And no key that could hold one has appeared.
    for (const forbidden of ['replyText', 'replyBody', 'draft', 'prompt', 'authorizedReply']) {
      expect(Object.hasOwn(result, forbidden)).toBe(false);
    }
  });

  it('(17) the result own-key set is unchanged by RWC-P2D', async () => {
    const result = await runOrdinary();
    expect(Object.keys(result).sort()).toEqual([...RUNTIME_RESULT_KEYS]);
  });

  it('(1) the SAME run through the explicit capability does carry the sentinel', async () => {
    // The contrast is the point: the text existed, and the ordinary path still did not surface it.
    const detailed = await runDetailed();
    expect(detailed.authorizedReply?.replyBody).toBe(SENTINEL);
    expect(JSON.stringify(detailed.runtimeResult)).not.toContain(SENTINEL);
  });
});

// ---------------------------------------------------------------------------
// (2, 3, 15) Positive materialization.
// ---------------------------------------------------------------------------

describe('(2, 3, 15) an accepted text-carrying proposal materializes exactly', () => {
  it('(2, 15) ACCEPTED REPLY materializes the exact body under the run identity', async () => {
    const { runtimeResult, authorizedReply } = await runDetailed();
    expect(runtimeResult.outcome).toBe('CORE_ACCEPTED');
    expect(authorizedReply).toBeDefined();
    expect(authorizedReply?.version).toBe(1);
    expect(authorizedReply?.proposalKind).toBe('REPLY');
    // Byte-for-byte. Not trimmed, not re-wrapped, not paraphrased, not templated.
    expect(authorizedReply?.replyBody).toBe(SENTINEL);
    expect(authorizedReply?.replyBody).toHaveLength(SENTINEL.length);
    // Identity ties the text to the run that produced it.
    expect(authorizedReply?.proposalId).toBe(runtimeResult.proposalId);
    expect(authorizedReply?.boundRevision).toBe(runtimeResult.boundRevision);
    expect(Object.isFrozen(authorizedReply)).toBe(true);
  });

  it('(3) ACCEPTED FOLLOW_UP materializes too — the second Core text-carrying kind', async () => {
    const { runtimeResult, authorizedReply } = await runDetailed({
      behaviourInput: scriptedBehaviourInput(
        behaviourInput({ requestedQuoteOrConsultation: true }, sufficientDiscovery()),
      ),
    });
    expect(runtimeResult.outcome).toBe('CORE_ACCEPTED');
    expect(authorizedReply?.proposalKind).toBe('FOLLOW_UP');
    expect(authorizedReply?.replyBody).toBe(SENTINEL);
  });
});

// ---------------------------------------------------------------------------
// (4-13) The exhaustive non-authorized matrix. Nothing here may expose text.
// ---------------------------------------------------------------------------

describe('(4-13) no unauthorized outcome exposes the draft', () => {
  it('(4) MODEL_DRAFTED with no Core transport wired exposes nothing', async () => {
    // The strongest case in the file: a valid, complete model draft EXISTS and is not authorized.
    const { runtimeResult, authorizedReply } = await runDetailed({}, true);
    expect(runtimeResult.outcome).toBe('MODEL_DRAFTED');
    expect(runtimeResult.modelDrafted).toBe(true);
    expect(authorizedReply).toBeUndefined();
    expect(JSON.stringify(runtimeResult)).not.toContain(SENTINEL);
  });

  it.each([
    ['(5) CORE_REJECTED', 'REJECTED', 'CORE_REJECTED'],
    ['(6) HUMAN_REVIEW_REQUIRED', 'HUMAN_REVIEW_REQUIRED', 'HUMAN_REVIEW_REQUIRED'],
    ['(7) RETRY_LATER', 'RETRY_LATER', 'RETRY_LATER'],
    ['(8) STALE_REVISION', 'STALE_REVISION', 'STALE_REVISION'],
    ['(9) CORE_UNAVAILABLE', 'CORE_UNAVAILABLE', 'CORE_UNAVAILABLE'],
  ])('%s never materializes', async (_label, coreOutcome, expected) => {
    const { runtimeResult, authorizedReply } = await runDetailed({
      coreTransport: scriptedCoreTransport(
        coreOutcome as Parameters<typeof scriptedCoreTransport>[0],
      ),
    });
    expect(runtimeResult.outcome).toBe(expected);
    expect(authorizedReply).toBeUndefined();
    expect(JSON.stringify(runtimeResult)).not.toContain(SENTINEL);
  });

  it('(10) a state change while the Core Promise is pending blocks materialization', async () => {
    // The post-response gate, proved from the outside. Core genuinely answers ACCEPTED; the
    // conversation is cancelled while that answer is in flight; M3 downgrades to STALE_REVISION,
    // and the body must not appear. Intercepting the transport instead of reading the FINAL
    // decision is exactly the bug this proves absent.
    let cell = clearControlState();
    const inner = scriptedCoreTransport('ACCEPTED');
    const mutatingTransport: CoreDecisionTransport = {
      send: (serialized: string) => {
        cell = clearControlState({ cancelled: true });
        return inner.send(serialized);
      },
    };
    const { runtimeResult, authorizedReply } = await runDetailed({
      authoritativeState: mutableAuthoritativeState(() => cell),
      coreTransport: mutatingTransport,
    });
    expect(runtimeResult.outcome).toBe('STALE_REVISION');
    expect(authorizedReply).toBeUndefined();
  });

  it('(11) an ACCEPTED proposal with no reply body materializes nothing', async () => {
    // A human-assistance request makes the behaviour decision model-INELIGIBLE, so no draft is
    // requested at all: the proposal reaches Core carrying no body, and Core accepts it. This is
    // simultaneously the only end-to-end route to an accepted NON-text-carrying kind, since Riya's
    // escalation decisions never draft.
    const invoker = sentinelInvoker();
    const { runtimeResult, authorizedReply } = await runDetailed({
      gatewayInvoker: invoker,
      behaviourInput: scriptedBehaviourInput(behaviourInput({ requestedHumanAssistance: true })),
    });
    expect(runtimeResult.outcome).toBe('CORE_ACCEPTED');
    expect(runtimeResult.modelDrafted).toBe(false);
    expect(authorizedReply).toBeUndefined();
    // No model ran, so there was never a body to withhold.
    expect(invoker.invoked()).toBe(0);
  });

  it('(13) an invalid model result refuses and materializes nothing', async () => {
    const { runtimeResult, authorizedReply } = await runDetailed({
      gatewayInvoker: rawStructuredGatewayInvoker({ kind: 'REPLY', replyBody: SENTINEL, evil: 1 }),
    });
    expect(runtimeResult.outcome).toBe('REFUSED');
    expect(authorizedReply).toBeUndefined();
    expect(JSON.stringify(runtimeResult)).not.toContain(SENTINEL);
  });

  const BLOCKED: readonly (readonly [string, Partial<ConversationControlState>])[] = [
    ['human takeover', { humanTakeover: true }],
    ['AI paused', { aiPaused: true }],
    ['cancelled', { cancelled: true }],
    ['a privacy hold', { subjectStatus: 'erased' }],
    ['HUMAN_ONLY data', { dataClass: 'HUMAN_ONLY' }],
  ];

  it.each(BLOCKED)(
    'a conversation under %s refuses before any body exists',
    async (_label, over) => {
      const { runtimeResult, authorizedReply } = await runDetailed({
        authoritativeState: mutableAuthoritativeState(() => clearControlState(over)),
      });
      expect(runtimeResult.outcome).toBe('REFUSED');
      expect(authorizedReply).toBeUndefined();
      expect(JSON.stringify(runtimeResult)).not.toContain(SENTINEL);
    },
  );
});

// ---------------------------------------------------------------------------
// (12) The mandatory kind gate, exercised DIRECTLY.
// ---------------------------------------------------------------------------

describe('(12) only Core text-carrying proposal kinds materialize', () => {
  /** A proposal shaped exactly as M2 builds one, with the kind under test. */
  const proposalOfKind = (kind: OrchestrationProposal['kind']): OrchestrationProposal =>
    Object.freeze({
      proposalId: 'prop.kindgate.1',
      proposalVersion: 1,
      conversationId: 'conv.1',
      expectedRevision: 1,
      assignedActor: 'RIYA' as const,
      partyType: 'CLIENT' as const,
      kind,
      structuredIntent: Object.freeze({}),
      // The whole point: a body IS present on every one of these.
      replyBody: SENTINEL,
      citations: Object.freeze([]),
      authorityStatus: 'PENDING_CORE_VALIDATION' as const,
    });

  it.each(['REPLY', 'FOLLOW_UP'] as const)(
    'materializes for %s — the kinds M3 forwards to Core',
    (kind) => {
      const materialized = materializeCoreAuthorizedReply('CORE_ACCEPTED', proposalOfKind(kind), 1);
      expect(materialized?.replyBody).toBe(SENTINEL);
      expect(materialized?.proposalKind).toBe(kind);
    },
  );

  it.each(['ESCALATE_TO_HUMAN', 'REQUEST_CLARIFICATION', 'NO_ACTION'] as const)(
    'refuses %s even though the proposal object retained text',
    (kind) => {
      // M3's `buildCoreCommand` drops `proposedReplyBody` for these kinds, so Core never received
      // this string as a proposed reply. Materializing it would present unreviewed text as approved.
      expect(
        materializeCoreAuthorizedReply('CORE_ACCEPTED', proposalOfKind(kind), 1),
      ).toBeUndefined();
    },
  );

  it('refuses every non-accepted outcome regardless of kind', () => {
    for (const outcome of [
      'MODEL_DRAFTED',
      'CORE_REJECTED',
      'HUMAN_REVIEW_REQUIRED',
      'RETRY_LATER',
      'STALE_REVISION',
      'CORE_UNAVAILABLE',
      'REFUSED',
      'NO_ACTION',
    ] as const) {
      expect(materializeCoreAuthorizedReply(outcome, proposalOfKind('REPLY'), 1)).toBeUndefined();
    }
  });

  it('refuses an accepted REPLY whose body is absent or empty', () => {
    const withBody = (replyBody: string | undefined): OrchestrationProposal =>
      Object.freeze({ ...proposalOfKind('REPLY'), replyBody });
    expect(materializeCoreAuthorizedReply('CORE_ACCEPTED', withBody(undefined), 1)).toBeUndefined();
    expect(materializeCoreAuthorizedReply('CORE_ACCEPTED', withBody(''), 1)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// (14) One call, one run.
// ---------------------------------------------------------------------------

describe('(14) one inbound call performs exactly one agent turn', () => {
  it('the content-bearing capability makes ONE model call and ONE Core call', async () => {
    const invoker = sentinelInvoker();
    const transport = scriptedCoreTransport('ACCEPTED');
    const runtime = createJarvisRuntime(
      syntheticRuntimeConfig({ gatewayInvoker: invoker, coreTransport: transport }),
    );
    const { authorizedReply } = await runtime.processInboundForCoreAuthorizedReply(
      syntheticInboundEnvelope(),
    );
    expect(authorizedReply?.replyBody).toBe(SENTINEL);
    expect(invoker.invoked()).toBe(1);
    expect(transport.invoked()).toBe(1);
  });

  it('ordinary processInbound still makes ONE model call and ONE Core call', async () => {
    const invoker = sentinelInvoker();
    const transport = scriptedCoreTransport('ACCEPTED');
    const runtime = createJarvisRuntime(
      syntheticRuntimeConfig({ gatewayInvoker: invoker, coreTransport: transport }),
    );
    await runtime.processInbound(syntheticInboundEnvelope());
    // The refactor routes it through the same detailed primitive; it must not have doubled.
    expect(invoker.invoked()).toBe(1);
    expect(transport.invoked()).toBe(1);
  });

  it('the two methods report the SAME run shape for identical input', async () => {
    const build = (): ReturnType<typeof createJarvisRuntime> =>
      createJarvisRuntime(
        syntheticRuntimeConfig({
          gatewayInvoker: sentinelInvoker(),
          coreTransport: scriptedCoreTransport('ACCEPTED'),
        }),
      );
    const envelope = createInboundEnvelope({
      ...syntheticInboundEnvelope(),
      normalizedText: 'same input both ways',
    });
    const ordinary = await build().processInbound(envelope);
    const detailed = await build().processInboundForCoreAuthorizedReply(envelope);
    expect(detailed.runtimeResult).toEqual(ordinary);
  });
});

// ---------------------------------------------------------------------------
// (16) Observability stays content-free.
// ---------------------------------------------------------------------------

describe('(16) observability never sees the body', () => {
  it('no emitted event contains the sentinel, on the accepting path', async () => {
    const events: JarvisRuntimeEvent[] = [];
    const { authorizedReply } = await runDetailed({
      observability: {
        onEvent: (event: JarvisRuntimeEvent): void => {
          events.push(event);
        },
      },
    });
    // The body really was produced on this run...
    expect(authorizedReply?.replyBody).toBe(SENTINEL);
    // ...and the hook still saw none of it.
    expect(events.length).toBeGreaterThan(0);
    expect(JSON.stringify(events)).not.toContain(SENTINEL);
    for (const event of events) {
      expect(allStrings(event).some((s) => s.includes(SENTINEL))).toBe(false);
      expect(Object.hasOwn(event, 'replyBody')).toBe(false);
      expect(Object.hasOwn(event, 'authorizedReply')).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// Public surface.
// ---------------------------------------------------------------------------

describe('the materialization rule is not a public capability', () => {
  it('the root barrel exports no materializer and no new value export', async () => {
    const barrel = (await import('../index.js')) as Record<string, unknown>;
    expect(barrel['materializeCoreAuthorizedReply']).toBeUndefined();
    expect(barrel['composeAndProcessDetailed']).toBeUndefined();
    expect(barrel['composeAndProcess']).toBeUndefined();
    // Types erase at runtime, so a type-only export adds nothing here. The VALUE surface is the
    // one QFJ-M5 locked, unchanged.
    expect(Object.keys(barrel).sort()).toEqual([
      'JARVIS_RUNTIME_ERROR_CODES',
      'JARVIS_RUNTIME_EVENT_TYPES',
      'JARVIS_RUNTIME_OUTCOMES',
      'JarvisRuntimeError',
      'NOOP_JARVIS_RUNTIME_OBSERVABILITY',
      'createJarvisRuntime',
    ]);
  });

  it('the runtime exposes exactly the four expected methods', () => {
    const runtime = createJarvisRuntime(syntheticRuntimeConfig());
    expect(Object.keys(runtime).sort()).toEqual([
      'applyConversationControlCommand',
      'processInbound',
      'processInboundForCoreAuthorizedReply',
      'readConversationOperationsSnapshot',
    ]);
    // No send/deliver/execute crept in alongside the content-bearing method.
    for (const forbidden of ['send', 'deliver', 'dispatch', 'publish', 'execute', 'persist']) {
      expect(Object.hasOwn(runtime, forbidden)).toBe(false);
    }
  });
});
