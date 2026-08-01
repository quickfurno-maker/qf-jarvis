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
import { clearControlState } from '../testing/deterministic-authoritative-state.js';
import {
  syntheticInboundEnvelope,
  syntheticRuntimeConfig,
} from '../testing/deterministic-runtime-fixture.js';

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
