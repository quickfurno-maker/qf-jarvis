/**
 * QFJ-P08-B1 — the authoritative state source is addressed by tenant AND conversation (ADR-0076).
 *
 * The property under test is that cross-tenant addressing is *unrepresentable*, not merely
 * detectable. Before this, every entry point took a bare `conversationId`: the inbound path could at
 * least compare the tenant after the read, but the operator control and query paths had nothing to
 * compare against, so a future persistent store could have answered them from another tenant's row.
 *
 * The sharpest case here is the one a bare-id lookup cannot survive: the SAME `conversationId` under
 * two different tenants, each with its own control state. Nothing in tracked governance guarantees
 * conversation ids are globally unique, so the runtime may not assume it.
 */
import { describe, expect, it } from 'vitest';

import type { ModelGatewayInvoker } from '@qf-jarvis/model-reply-adapter';
import { scriptedGatewayInvoker, structuredReply } from '@qf-jarvis/model-reply-adapter/testing';
import type { ConversationControlCommandInput } from '@qf-jarvis/conversation-control';

import { createJarvisRuntime } from '../composition/create-jarvis-runtime.js';
import type {
  AuthoritativeConversationStatePort,
  ConversationControlState,
  ConversationStateKey,
} from '../contracts/authoritative-state.js';
import type { VendorJourneySignals } from '@qf-jarvis/anisha-agent';
import { scriptedCoreTransport } from '@qf-jarvis/core-decision-adapter/testing';

import type {
  ClientSalesBehaviourInput,
  ClientSalesBehaviourInputPort,
  ClientSalesBehaviourInputRequest,
} from '../contracts/behaviour-input.js';
import type {
  VendorJourneyBehaviourInput,
  VendorJourneyBehaviourInputPort,
  VendorJourneyBehaviourInputRequest,
} from '../contracts/vendor-journey-behaviour-input.js';
import { clearControlState } from '../testing/deterministic-authoritative-state.js';
import {
  syntheticInboundEnvelope,
  syntheticPromptDefinition,
  syntheticPromptRegistry,
  syntheticRuntimeConfig,
  syntheticSignals,
} from '../testing/deterministic-runtime-fixture.js';

/** A VENDOR-scoped prompt, since a definition is scope-bound (ADR-0073). */
const VENDOR_PROMPT = syntheticPromptDefinition('reply.vendor', 'VENDOR');

const AT = '2026-08-01T00:00:00.000Z';
const SHARED_CONVERSATION = 'conv.shared';

interface Counted {
  readonly count: () => number;
}
function countingInvoker(): ModelGatewayInvoker & Counted {
  const inner = scriptedGatewayInvoker(structuredReply({ citations: [] }));
  const counter = { n: 0 };
  return {
    invoke: (request) => {
      counter.n += 1;
      return inner.invoke(request);
    },
    count: () => counter.n,
  };
}

/**
 * A source holding TWO conversations that share one id under different tenants.
 *
 * Every method records the exact key it was handed, so "the lookup was scoped" is an observed fact
 * rather than an inference from the answer.
 */
function twoTenantSource(seed: {
  readonly a: Partial<ConversationControlState>;
  readonly b: Partial<ConversationControlState>;
}) {
  const rows = new Map<string, ConversationControlState>([
    [
      'tenant.a',
      clearControlState({ tenantId: 'tenant.a', conversationId: SHARED_CONVERSATION, ...seed.a }),
    ],
    [
      'tenant.b',
      clearControlState({ tenantId: 'tenant.b', conversationId: SHARED_CONVERSATION, ...seed.b }),
    ],
  ]);
  const keys: ConversationStateKey[] = [];
  const port = {
    read: (key: ConversationStateKey): Promise<ConversationControlState> => {
      keys.push(key);
      const row = rows.get(key.tenantId);
      if (row?.conversationId !== key.conversationId) {
        return Promise.reject(new Error('no such conversation'));
      }
      return Promise.resolve(row);
    },
  };
  return { port, keys: (): readonly ConversationStateKey[] => keys };
}

function commandInput(
  over: Partial<ConversationControlCommandInput> = {},
): ConversationControlCommandInput {
  return {
    commandId: 'ctrl.1',
    conversationId: SHARED_CONVERSATION,
    expectedRevision: 1,
    action: 'TAKE_OWNERSHIP',
    operatorRef: 'operator.synthetic.1',
    issuedAt: AT,
    ...over,
  };
}

// ---------------------------------------------------------------------------
// The same conversation id under two tenants.
// ---------------------------------------------------------------------------

describe('the same conversationId under two tenants is two conversations', () => {
  it('inbound reads the ENVELOPE tenant at every awaited gate', async () => {
    const { port, keys } = twoTenantSource({ a: {}, b: { partyType: 'VENDOR' } });
    const invoker = countingInvoker();
    const runtime = createJarvisRuntime(
      syntheticRuntimeConfig({ authoritativeState: port, gatewayInvoker: invoker }),
    );

    const result = await runtime.processInbound(
      syntheticInboundEnvelope({
        tenantId: 'tenant.a',
        conversationId: SHARED_CONVERSATION,
        partyType: 'CLIENT',
      }),
    );
    expect(result.outcome).not.toBe('REFUSED');
    expect(result.assignedActor).toBe('RIYA');

    // EVERY gate — M2 context, M4 pre/post, M3 pre/post, privacy — used the same scoped key. Not one
    // of them addressed the conversation without its tenant.
    expect(keys().length).toBeGreaterThan(1);
    for (const key of keys()) {
      expect(key).toEqual({ tenantId: 'tenant.a', conversationId: SHARED_CONVERSATION });
    }
  });

  it('routes the OTHER tenant independently, on the same conversation id', async () => {
    const { port, keys } = twoTenantSource({ a: {}, b: { partyType: 'VENDOR' } });
    const runtime = createJarvisRuntime(syntheticRuntimeConfig({ authoritativeState: port }));

    const result = await runtime.processInbound(
      syntheticInboundEnvelope({
        tenantId: 'tenant.b',
        conversationId: SHARED_CONVERSATION,
        partyType: 'VENDOR',
      }),
    );
    // The isolation proof: a bare-id lookup would have served tenant.a's CLIENT row, and the envelope
    // check would then have refused with `orchestration-envelope-invalid`. Getting PAST that proves
    // tenant.b's VENDOR row was the one served. (The turn then refuses further down only because this
    // fixture's prompt registry is CLIENT-scoped, which is not what this case is about.)
    expect(result.refusalReason).not.toBe('orchestration-envelope-invalid');
    for (const key of keys()) {
      expect(key.tenantId).toBe('tenant.b');
    }
  });

  it('takes ownership in one tenant WITHOUT touching the other', async () => {
    // The isolation claim, stated as two observable rows rather than one comparison.
    const applied: ConversationStateKey[] = [];
    const rows = new Map<string, ConversationControlState>([
      [
        'tenant.a',
        clearControlState({ tenantId: 'tenant.a', conversationId: SHARED_CONVERSATION }),
      ],
      [
        'tenant.b',
        clearControlState({ tenantId: 'tenant.b', conversationId: SHARED_CONVERSATION }),
      ],
    ]);
    const port = {
      read: (key: ConversationStateKey) => Promise.resolve(rows.get(key.tenantId)),
      applyControlCommand: (key: ConversationStateKey) => {
        applied.push(key);
        const row = rows.get(key.tenantId);
        if (row === undefined) {
          return Promise.reject(new Error('no such tenant'));
        }
        const next = { ...row, revision: row.revision + 1, humanTakeover: true, aiPaused: true };
        rows.set(key.tenantId, next);
        return Promise.resolve({
          outcome: 'APPLIED',
          reason: 'applied',
          nextState: {
            conversationId: key.conversationId,
            revision: next.revision,
            humanTakeover: true,
            aiPaused: true,
          },
          auditRecord: {
            recordVersion: 1,
            commandId: 'ctrl.1',
            conversationId: key.conversationId,
            action: 'TAKE_OWNERSHIP',
            operatorRef: 'operator.synthetic.1',
            expectedRevision: 1,
            observedRevision: 1,
            outcome: 'APPLIED',
            reason: 'applied',
            resultingRevision: next.revision,
            humanTakeover: true,
            aiPaused: true,
            issuedAt: AT,
          },
        });
      },
    } as unknown as AuthoritativeConversationStatePort;

    const runtime = createJarvisRuntime(syntheticRuntimeConfig({ authoritativeState: port }));
    const result = await runtime.applyConversationControlCommand({
      tenantId: 'tenant.a',
      command: commandInput(),
    });
    expect(result.ok).toBe(true);
    expect(applied).toEqual([{ tenantId: 'tenant.a', conversationId: SHARED_CONVERSATION }]);

    expect(rows.get('tenant.a')?.humanTakeover).toBe(true);
    // The whole point.
    expect(rows.get('tenant.b')?.humanTakeover).toBe(false);
    expect(rows.get('tenant.b')?.revision).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Returned-identity checks.
// ---------------------------------------------------------------------------

describe('a source answering about the wrong scope fails closed', () => {
  function runtimeReturning(state: ConversationControlState) {
    const port = { read: () => Promise.resolve(state) } as AuthoritativeConversationStatePort;
    return createJarvisRuntime(syntheticRuntimeConfig({ authoritativeState: port }));
  }

  it('refuses a state record belonging to another TENANT', async () => {
    // The right conversation id under the wrong tenant is the exact answer a bare-id lookup would
    // have produced, and it must not be usable.
    const runtime = runtimeReturning(
      clearControlState({ tenantId: 'tenant.OTHER', conversationId: 'conv.1' }),
    );
    const result = await runtime.processInbound(
      syntheticInboundEnvelope({ tenantId: 'tenant.a', conversationId: 'conv.1' }),
    );
    expect(result.outcome).toBe('REFUSED');
    expect(result.modelDrafted).toBe(false);
  });

  it('refuses a state record belonging to another CONVERSATION', async () => {
    const runtime = runtimeReturning(
      clearControlState({ tenantId: 'tenant.a', conversationId: 'conv.OTHER' }),
    );
    const result = await runtime.processInbound(
      syntheticInboundEnvelope({ tenantId: 'tenant.a', conversationId: 'conv.1' }),
    );
    expect(result.outcome).toBe('REFUSED');
  });

  it('refuses an operations projection whose nested state names another tenant', async () => {
    const port = {
      read: () => Promise.resolve(clearControlState()),
      readOperationsProjection: () =>
        Promise.resolve({
          state: clearControlState({ tenantId: 'tenant.OTHER', conversationId: 'conv.1' }),
          conversationState: 'ACTIVE_AI',
          lastActivityAt: AT,
          escalationStatus: 'none',
          followUpStatus: 'none',
          deliveryStatePlaceholder: 'not-implemented',
          auditRef: 'audit.1',
        }),
    } as unknown as AuthoritativeConversationStatePort;
    const runtime = createJarvisRuntime(syntheticRuntimeConfig({ authoritativeState: port }));
    const result = await runtime.readConversationOperationsSnapshot({
      tenantId: 'tenant.a',
      conversationId: 'conv.1',
    });
    expect(result).toEqual({ ok: false, reason: 'operations-invalid-result' });
  });
});

// ---------------------------------------------------------------------------
// Tenant validation at the operator surfaces.
// ---------------------------------------------------------------------------

describe('operator surfaces validate the tenant before touching the source', () => {
  const BAD_TENANTS = ['', 'has space', 'a'.repeat(129), '*', 'tenant.*', 'latest', 'LATEST'];

  function countingSource() {
    const counter = { apply: 0, project: 0 };
    const port = {
      read: () => Promise.resolve(clearControlState()),
      applyControlCommand: () => {
        counter.apply += 1;
        return Promise.reject(new Error('should not be reached'));
      },
      readOperationsProjection: () => {
        counter.project += 1;
        return Promise.reject(new Error('should not be reached'));
      },
    } as unknown as AuthoritativeConversationStatePort;
    return { port, counter };
  }

  it('rejects an invalid tenant on control with control-invalid-command and zero source calls', async () => {
    const { port, counter } = countingSource();
    const runtime = createJarvisRuntime(syntheticRuntimeConfig({ authoritativeState: port }));
    for (const tenantId of BAD_TENANTS) {
      const result = await runtime.applyConversationControlCommand({
        tenantId,
        command: commandInput({ conversationId: 'conv.1' }),
      });
      expect(result, tenantId).toEqual({ ok: false, reason: 'control-invalid-command' });
    }
    expect(counter.apply).toBe(0);
  });

  it('rejects an invalid tenant on the query with the existing closed reason and zero source calls', async () => {
    // No second reason is introduced: the caller's remedy is identical either way.
    const { port, counter } = countingSource();
    const runtime = createJarvisRuntime(syntheticRuntimeConfig({ authoritativeState: port }));
    for (const tenantId of BAD_TENANTS) {
      const result = await runtime.readConversationOperationsSnapshot({
        tenantId,
        conversationId: 'conv.1',
      });
      expect(result, tenantId).toEqual({ ok: false, reason: 'operations-invalid-conversation' });
    }
    expect(counter.project).toBe(0);
  });

  it('rejects a non-object control input without reaching the source', async () => {
    const { port, counter } = countingSource();
    const runtime = createJarvisRuntime(syntheticRuntimeConfig({ authoritativeState: port }));
    for (const bad of ['x', 7, null, undefined, []]) {
      const result = await runtime.applyConversationControlCommand(
        bad as unknown as Parameters<typeof runtime.applyConversationControlCommand>[0],
      );
      expect(result).toEqual({ ok: false, reason: 'control-invalid-command' });
    }
    expect(counter.apply).toBe(0);
  });

  it('keeps the tenant OUT of the pure command and its audit record', async () => {
    // `@qf-jarvis/conversation-control` stays tenant-neutral: tenancy is an addressing concern of
    // this composition and the future store, not a field of the reducer's evidence.
    const seen: unknown[] = [];
    const port = {
      read: () => Promise.resolve(clearControlState()),
      applyControlCommand: (_key: ConversationStateKey, command: unknown) => {
        seen.push(command);
        return Promise.reject(new Error('inspected only'));
      },
    } as unknown as AuthoritativeConversationStatePort;
    const runtime = createJarvisRuntime(syntheticRuntimeConfig({ authoritativeState: port }));
    await runtime.applyConversationControlCommand({
      tenantId: 'tenant.a',
      command: commandInput({ conversationId: 'conv.1' }),
    });
    expect(seen).toHaveLength(1);
    expect(Object.keys(seen[0] as Record<string, unknown>)).not.toContain('tenantId');
  });
});

// ---------------------------------------------------------------------------
// Behaviour input seams (QFJ-P08-B1 final review).
//
// These two ports are where Core-owned, already-validated business facts enter the composition. They
// are conversation-keyed external reads, so ADR-0076's rule applies to them too: a supplier handed
// only a conversation id cannot select the right tenant's facts, and two tenants sharing one
// conversation id would receive each other's signals.
// ---------------------------------------------------------------------------

/** A client-sales supplier that records every request and answers per tenant. */
function recordingClientInput(byTenant: Readonly<Record<string, ClientSalesBehaviourInput>>) {
  const requests: ClientSalesBehaviourInputRequest[] = [];
  const port: ClientSalesBehaviourInputPort = {
    read(request: ClientSalesBehaviourInputRequest) {
      // A supplier must never be asked without a tenant; throwing here makes the omission loud
      // rather than a silently-wrong answer.
      if (typeof request.tenantId !== 'string' || request.tenantId.length === 0) {
        throw new Error('behaviour-request-missing-tenant');
      }
      requests.push(request);
      return Promise.resolve(byTenant[request.tenantId]);
    },
  };
  return { port, requests: (): readonly ClientSalesBehaviourInputRequest[] => requests };
}

/** A vendor-journey supplier that records every request and answers per tenant. */
function recordingVendorInput(byTenant: Readonly<Record<string, VendorJourneyBehaviourInput>>) {
  const requests: VendorJourneyBehaviourInputRequest[] = [];
  const port: VendorJourneyBehaviourInputPort = {
    read(request: VendorJourneyBehaviourInputRequest) {
      if (typeof request.tenantId !== 'string' || request.tenantId.length === 0) {
        throw new Error('behaviour-request-missing-tenant');
      }
      requests.push(request);
      return Promise.resolve(byTenant[request.tenantId]);
    },
  };
  return { port, requests: (): readonly VendorJourneyBehaviourInputRequest[] => requests };
}

const CLIENT_ESCALATE: ClientSalesBehaviourInput = {
  signals: syntheticSignals({ requestedHumanAssistance: true }),
  promptRef: 'prompt.riya.sales.v1',
};
/** Ordinary sales facts: Riya continues discovery, which drafts a reply through the model. */
const CLIENT_REPLY: ClientSalesBehaviourInput = {
  signals: syntheticSignals({ providedRequirementDetail: true }),
  promptRef: 'prompt.riya.sales.v1',
};

function vendorInput(over: Partial<VendorJourneySignals>): VendorJourneyBehaviourInput {
  return {
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
      ...over,
    },
    promptRef: 'prompt.anisha.vendor.v1',
  };
}

/** A source serving exactly one tenant's row, so the behaviour seam is the thing under test. */
function oneTenantSource(state: ConversationControlState): AuthoritativeConversationStatePort {
  return {
    read: (key: ConversationStateKey) =>
      state.tenantId === key.tenantId && state.conversationId === key.conversationId
        ? Promise.resolve(state)
        : Promise.reject(new Error('no such conversation')),
  };
}

describe('the behaviour input seams are tenant-scoped', () => {
  it('(A) the Riya request carries the envelope tenant, conversation and bound revision', async () => {
    const supplied = recordingClientInput({ 'tenant.a': CLIENT_ESCALATE });
    const runtime = createJarvisRuntime(
      syntheticRuntimeConfig({
        authoritativeState: oneTenantSource(
          clearControlState({
            tenantId: 'tenant.a',
            conversationId: SHARED_CONVERSATION,
            revision: 7,
          }),
        ),
        behaviourInput: supplied.port,
      }),
    );
    await runtime.processInbound(
      syntheticInboundEnvelope({
        tenantId: 'tenant.a',
        conversationId: SHARED_CONVERSATION,
        partyType: 'CLIENT',
      }),
    );
    expect(supplied.requests()).toEqual([
      { tenantId: 'tenant.a', conversationId: SHARED_CONVERSATION, revision: 7 },
    ]);
  });

  it('(B) the Anisha request carries the envelope tenant, conversation and bound revision', async () => {
    const supplied = recordingVendorInput({
      'tenant.b': vendorInput({ requestedHumanAssistance: true }),
    });
    const runtime = createJarvisRuntime(
      syntheticRuntimeConfig({
        authoritativeState: oneTenantSource(
          clearControlState({
            tenantId: 'tenant.b',
            conversationId: SHARED_CONVERSATION,
            partyType: 'VENDOR',
            revision: 4,
          }),
        ),
        vendorJourneyBehaviourInput: supplied.port,
      }),
    );
    await runtime.processInbound(
      syntheticInboundEnvelope({
        tenantId: 'tenant.b',
        conversationId: SHARED_CONVERSATION,
        partyType: 'VENDOR',
      }),
    );
    expect(supplied.requests()).toEqual([
      { tenantId: 'tenant.b', conversationId: SHARED_CONVERSATION, revision: 4 },
    ]);
  });

  it('(C) each tenant receives ONLY its own Riya facts on the same conversation id', async () => {
    // The two data sets produce observably different, both-valid dispositions. A supplier handed only
    // the conversation id could not tell these apart, and would answer one tenant with the other's.
    const supplied = recordingClientInput({
      // tenant.a asks for a human -> Riya escalates, and NO model runs.
      'tenant.a': CLIENT_ESCALATE,
      // tenant.b's facts lead to an ordinary reply -> exactly ONE model call.
      'tenant.b': CLIENT_REPLY,
    });
    const runFor = async (tenantId: string) => {
      const invoker = countingInvoker();
      const result = await createJarvisRuntime(
        syntheticRuntimeConfig({
          authoritativeState: oneTenantSource(
            clearControlState({ tenantId, conversationId: SHARED_CONVERSATION }),
          ),
          behaviourInput: supplied.port,
          gatewayInvoker: invoker,
        }),
      ).processInbound(
        syntheticInboundEnvelope({
          tenantId,
          conversationId: SHARED_CONVERSATION,
          partyType: 'CLIENT',
        }),
      );
      return { result, models: invoker.count() };
    };

    const a = await runFor('tenant.a');
    const b = await runFor('tenant.b');

    expect(supplied.requests().map((r) => r.tenantId)).toEqual(['tenant.a', 'tenant.b']);
    // The tenant-specific facts drove genuinely different behaviour, not just different bookkeeping.
    expect(a.models).toBe(0);
    expect(b.models).toBe(1);
    expect(a.result.modelDrafted).toBe(false);
    expect(b.result.modelDrafted).toBe(true);
  });

  it('(D) each tenant receives ONLY its own Anisha facts on the same conversation id', async () => {
    const supplied = recordingVendorInput({
      // tenant.a asks for a human -> Anisha escalates, and NO model runs.
      'tenant.a': vendorInput({ requestedHumanAssistance: true }),
      // tenant.b asks a routine question -> a drafted reply, so exactly ONE model call.
      'tenant.b': vendorInput({ askedRoutineQuestion: true }),
    });
    const runFor = async (tenantId: string) => {
      const invoker = countingInvoker();
      const result = await createJarvisRuntime(
        syntheticRuntimeConfig({
          authoritativeState: oneTenantSource(
            clearControlState({
              tenantId,
              conversationId: SHARED_CONVERSATION,
              partyType: 'VENDOR',
            }),
          ),
          vendorJourneyBehaviourInput: supplied.port,
          gatewayInvoker: invoker,
          promptFamily: VENDOR_PROMPT.promptId,
          promptVersion: VENDOR_PROMPT.promptVersion,
          promptRegistry: syntheticPromptRegistry('reply.vendor', 'VENDOR'),
          evaluationPromptDigest: VENDOR_PROMPT.contentDigest,
        }),
      ).processInbound(
        syntheticInboundEnvelope({
          tenantId,
          conversationId: SHARED_CONVERSATION,
          partyType: 'VENDOR',
        }),
      );
      return { result, models: invoker.count() };
    };

    const a = await runFor('tenant.a');
    const b = await runFor('tenant.b');

    expect(supplied.requests().map((r) => r.tenantId)).toEqual(['tenant.a', 'tenant.b']);
    // The tenant-specific facts drove genuinely different behaviour, not just different bookkeeping.
    expect(a.models).toBe(0);
    expect(b.models).toBe(1);
    expect(a.result.modelDrafted).toBe(false);
    expect(b.result.modelDrafted).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// The behaviour adapters' own state reread.
// ---------------------------------------------------------------------------

/**
 * A source that answers correctly for the first `n` reads and then hands back a foreign record.
 *
 * This is the case the four general projections already cover but the behaviour adapters did not: a
 * structural source may be right at the first gate, wrong during the behaviour read, and right again
 * afterwards. Only a check at the behaviour read itself catches it.
 */
function poisonedAfter(
  n: number,
  good: ConversationControlState,
  poisoned: ConversationControlState,
): AuthoritativeConversationStatePort {
  const counter = { n: 0 };
  return {
    read: () => {
      counter.n += 1;
      return Promise.resolve(counter.n > n ? poisoned : good);
    },
  };
}

describe('the behaviour adapters validate their own state reread', () => {
  function countingGateway() {
    const inner = scriptedGatewayInvoker(structuredReply({ citations: [] }));
    const counter = { n: 0 };
    return {
      invoke: (request: Parameters<typeof inner.invoke>[0]) => {
        counter.n += 1;
        return inner.invoke(request);
      },
      count: () => counter.n,
    };
  }

  it('(E) a WRONG-TENANT state during the Riya behaviour read fails the turn closed', async () => {
    const invoker = countingGateway();
    const core = scriptedCoreTransport('ACCEPTED');
    const coreCalls = { n: 0 };
    const runtime = createJarvisRuntime(
      syntheticRuntimeConfig({
        authoritativeState: poisonedAfter(
          1,
          clearControlState({ tenantId: 'tenant.a', conversationId: SHARED_CONVERSATION }),
          clearControlState({ tenantId: 'tenant.OTHER', conversationId: SHARED_CONVERSATION }),
        ),
        behaviourInput: { read: () => Promise.resolve(CLIENT_ESCALATE) },
        gatewayInvoker: invoker,
        coreTransport: {
          send: (serialized) => {
            coreCalls.n += 1;
            return core.send(serialized);
          },
        },
      }),
    );

    const result = await runtime.processInbound(
      syntheticInboundEnvelope({
        tenantId: 'tenant.a',
        conversationId: SHARED_CONVERSATION,
        partyType: 'CLIENT',
      }),
    );
    expect(result.outcome).toBe('REFUSED');
    expect(result.proposalId).toBeUndefined();
    // The foreign state never reached a model call, a Core call, or a proposal.
    expect(invoker.count()).toBe(0);
    expect(coreCalls.n).toBe(0);
  });

  it('(F) a WRONG-TENANT state during the Anisha behaviour read fails the turn closed', async () => {
    const invoker = countingGateway();
    const runtime = createJarvisRuntime(
      syntheticRuntimeConfig({
        authoritativeState: poisonedAfter(
          1,
          clearControlState({
            tenantId: 'tenant.b',
            conversationId: SHARED_CONVERSATION,
            partyType: 'VENDOR',
          }),
          clearControlState({
            tenantId: 'tenant.OTHER',
            conversationId: SHARED_CONVERSATION,
            partyType: 'VENDOR',
          }),
        ),
        vendorJourneyBehaviourInput: {
          read: () => Promise.resolve(vendorInput({ requestedHumanAssistance: true })),
        },
        gatewayInvoker: invoker,
      }),
    );

    const result = await runtime.processInbound(
      syntheticInboundEnvelope({
        tenantId: 'tenant.b',
        conversationId: SHARED_CONVERSATION,
        partyType: 'VENDOR',
      }),
    );
    expect(result.outcome).toBe('REFUSED');
    expect(result.proposalId).toBeUndefined();
    expect(invoker.count()).toBe(0);
  });

  it('(G) a WRONG-CONVERSATION state during the behaviour read fails the turn closed', async () => {
    const invoker = countingGateway();
    const runtime = createJarvisRuntime(
      syntheticRuntimeConfig({
        authoritativeState: poisonedAfter(
          1,
          clearControlState({ tenantId: 'tenant.a', conversationId: SHARED_CONVERSATION }),
          clearControlState({ tenantId: 'tenant.a', conversationId: 'conv.OTHER' }),
        ),
        behaviourInput: { read: () => Promise.resolve(CLIENT_ESCALATE) },
        gatewayInvoker: invoker,
      }),
    );

    const result = await runtime.processInbound(
      syntheticInboundEnvelope({
        tenantId: 'tenant.a',
        conversationId: SHARED_CONVERSATION,
        partyType: 'CLIENT',
      }),
    );
    expect(result.outcome).toBe('REFUSED');
    expect(invoker.count()).toBe(0);
  });
});
