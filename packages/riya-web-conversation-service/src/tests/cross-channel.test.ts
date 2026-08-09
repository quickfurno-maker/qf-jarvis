/**
 * RWC-P8 — cross-channel continuity, logical-turn idempotency and one-in-flight (ADR-0104).
 *
 * Three properties, and each is the kind that is invisible until it is wrong in production:
 *
 * - **WEB and WHATSAPP are one Riya.** Same reducer, same continuity row, same everything — and the
 *   linkage comes from the caller's canonical `(tenantId, conversationId)` and from nothing else.
 *   Jarvis never guesses that a browser session and a chat number are the same person.
 * - **A spent logical message never runs again.** Not after a fresh transport request, not after a
 *   replica restart, and not when the same identifiers arrive carrying different words.
 * - **One conversation runs one text turn at a time**, and everything that is refused costs zero
 *   downstream work.
 */
import { scriptedAvailabilityReader } from '@qf-jarvis/core-service-availability-read/testing';
import { describe, expect, it } from 'vitest';

import { RiyaWebConversationError } from '../contracts/errors.js';
import { createRiyaWebConversationService } from '../service/create-service.js';
import type { RiyaConversationTurnV1 } from '../contracts/channel-turn.js';
import { InMemoryContinuityStore } from './fakes/in-memory-continuity-store.js';
import { scriptedRuntime } from './fakes/scripted-runtime.js';
import type { ScriptedTurnCoordinatorOptions } from './fakes/scripted-turn-coordinator.js';
import { scriptedTurnCoordinator } from './fakes/scripted-turn-coordinator.js';

const SET = (field: string, value: string) =>
  ({ field, operation: 'SET', value, provenance: 'user_stated' }) as never;

function harness(
  over: {
    readonly store?: InMemoryContinuityStore;
    readonly coordinator?: ReturnType<typeof scriptedTurnCoordinator>;
    readonly observations?: readonly unknown[];
    readonly coordinatorOptions?: ScriptedTurnCoordinatorOptions;
  } = {},
) {
  const store = over.store ?? new InMemoryContinuityStore();
  const coordinator = over.coordinator ?? scriptedTurnCoordinator(over.coordinatorOptions ?? {});
  const runtime = scriptedRuntime('CORE_ACCEPTED', {
    ...(over.observations === undefined ? {} : { observations: over.observations as never }),
  });
  const reader = scriptedAvailabilityReader();
  const svc = createRiyaWebConversationService({
    runtime,
    continuityStore: store,
    availabilityReader: reader,
    turnCoordinator: coordinator,
    runtimeId: 'rt.1',
  });
  return { svc, store, coordinator, runtime, reader };
}

function turn(over: Partial<RiyaConversationTurnV1> = {}): RiyaConversationTurnV1 {
  const messageId = over.messageId ?? 'msg.1';
  return {
    version: 1,
    channel: 'WEB',
    tenantId: 'tenant.a',
    conversationId: 'conv.1',
    messageId,
    receivedAt: '2026-08-01T09:00:00Z',
    channelTurnRef: `src.${messageId}`,
    dataClass: 'HOSTED_ALLOWED',
    ...over,
  };
}

const code = async (run: () => Promise<unknown>): Promise<string> => {
  try {
    await run();
  } catch (error: unknown) {
    return error instanceof RiyaWebConversationError ? error.code : 'not-a-service-error';
  }
  return 'no-error';
};

// ---------------------------------------------------------------------------
// One Riya, two surfaces.
// ---------------------------------------------------------------------------

describe('WEB and WHATSAPP share ONE continuity, when the caller says they do', () => {
  it('a WEB turn evolves the state and a WHATSAPP turn sees it', async () => {
    const { svc, store, runtime } = harness({ observations: [SET('location', 'Indiranagar')] });
    const web = await svc.handleChannelTurn(turn({ channel: 'WEB', messageId: 'msg.web' }));
    expect(web.continuity.discovery.locationRef).toBe('Indiranagar');
    expect(web.continuity.continuityRevision).toBe(1);

    const whatsapp = await svc.handleChannelTurn(
      turn({ channel: 'WHATSAPP', messageId: 'msg.wa' }),
    );
    // The SAME state, not a fresh one. One row, one Riya.
    expect(whatsapp.continuity.discovery.locationRef).toBe('Indiranagar');
    expect(store.size).toBe(1);
    // And the WhatsApp turn reached the SAME runtime capability. There is no second reducer, no
    // second prompt and no channel branch anywhere downstream.
    expect(runtime.invoked()).toBe(2);
    expect(runtime.lastEnvelope()?.channel).toBe('WHATSAPP');
    expect(runtime.lastEnvelope()?.partyType).toBe('CLIENT');
    expect(runtime.lastEnvelope()?.direction).toBe('INBOUND');
  });

  it('the reverse direction works identically', async () => {
    const { svc, store } = harness({ observations: [SET('budget', 'around 8 lakh')] });
    const first = await svc.handleChannelTurn(turn({ channel: 'WHATSAPP', messageId: 'm.1' }));
    expect(first.continuity.discovery.budgetNote).toBe('around 8 lakh');
    const second = await svc.handleChannelTurn(turn({ channel: 'WEB', messageId: 'm.2' }));
    expect(second.continuity.discovery.budgetNote).toBe('around 8 lakh');
    expect(store.size).toBe(1);
  });

  it('the channel reaches the ENVELOPE and nothing else', async () => {
    const { svc, runtime } = harness();
    await svc.handleChannelTurn(turn({ channel: 'WHATSAPP' }));
    expect(runtime.lastEnvelope()?.providerMessageRef).toBe('src.msg.1');
    // Continuity is channel-FREE, and RWC-P8 does not change that. A channel there would be the
    // beginning of a second Riya.
    const stored = JSON.stringify(runtime.lastContinuity());
    expect(stored).not.toContain('WHATSAPP');
    expect(stored).not.toContain('channel');
  });
});

describe('Jarvis never INFERS that two channels are one conversation', () => {
  it('the same subjectRef in two conversations stays two conversations', async () => {
    const { svc, store } = harness({ observations: [SET('location', 'Indiranagar')] });
    await svc.handleChannelTurn(
      turn({ channel: 'WEB', conversationId: 'conv.1', messageId: 'a', subjectRef: 'subject.1' }),
    );
    const other = await svc.handleChannelTurn(
      turn({
        channel: 'WHATSAPP',
        conversationId: 'conv.2',
        messageId: 'b',
        subjectRef: 'subject.1',
      }),
    );
    // `subjectRef` is NOT a linking key. Identity resolution is the QuickFurno handshake's job, and
    // a wrong guess here would attach one person's project to another person's chat.
    expect(store.size).toBe(2);
    expect(other.continuity.continuityRevision).toBe(1);
    expect(other.continuity.conversationId).toBe('conv.2');
  });

  it('the same conversationId under two tenants stays two conversations', async () => {
    const { svc, store } = harness();
    await svc.handleChannelTurn(turn({ tenantId: 'tenant.a', messageId: 'a' }));
    await svc.handleChannelTurn(turn({ tenantId: 'tenant.b', messageId: 'b' }));
    expect(store.size).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Logical-turn idempotency.
// ---------------------------------------------------------------------------

describe('a spent logical message never runs again', () => {
  it('an exact repeat is REPLAYED, with no second model turn and no cached reply', async () => {
    const { svc, runtime, coordinator } = harness();
    const first = await svc.handleChannelTurn(turn());
    expect(first.authorizedReply).toBeDefined();
    expect(runtime.invoked()).toBe(1);

    expect(await code(() => svc.handleChannelTurn(turn()))).toBe('turn-replayed');
    // Not one more runtime call, and no reply text: the ledger stores no model output, and
    // fabricating one would make a replay indistinguishable from a fresh answer.
    expect(runtime.invoked()).toBe(1);
    expect(coordinator.begins()).toBe(2);
    expect(coordinator.starts()).toBe(1);
  });

  it('CHANGED TEXT under the same identity is replayed, and the new text is NOT processed', async () => {
    // Deliberate and fail-closed. The ledger stores no message and no digest of a message -- a hash
    // of a sentence is still a durable fingerprint of what a person wrote. The consequence is that
    // reusing identifiers with new words is a replay; a caller with new words mints a new messageId
    // and a new channelTurnRef.
    const { svc, runtime } = harness();
    await svc.handleChannelTurn(turn({ normalizedText: 'kitchen please' }));
    expect(
      await code(() => svc.handleChannelTurn(turn({ normalizedText: 'actually a wardrobe' }))),
    ).toBe('turn-replayed');
    expect(runtime.invoked()).toBe(1);
    expect(runtime.lastEnvelope()?.normalizedText).toBe('kitchen please');
  });

  const conflicts: Record<string, Partial<RiyaConversationTurnV1>> = {
    'a different source reference under the same message id': { channelTurnRef: 'src.other' },
    'a later receivedAt': { receivedAt: '2026-08-01T09:00:01Z' },
    'a changed data class': { dataClass: 'LOCAL_ONLY' },
    'an added subject reference': { subjectRef: 'subject.9' },
    'a different channel': { channel: 'WHATSAPP' },
  };
  for (const [label, over] of Object.entries(conflicts)) {
    it(`refuses ${label} as a CONFLICT, with no second turn`, async () => {
      const { svc, runtime } = harness();
      await svc.handleChannelTurn(turn());
      expect(await code(() => svc.handleChannelTurn(turn(over)))).toBe('turn-conflict');
      expect(runtime.invoked()).toBe(1);
    });
  }

  it('refuses the same SOURCE reference under a NEW message id', async () => {
    // What a redelivery given a fresh message id looks like. Treating it as new would run the same
    // turn twice.
    const { svc, runtime } = harness();
    await svc.handleChannelTurn(turn({ messageId: 'msg.1' }));
    expect(
      await code(() =>
        svc.handleChannelTurn(turn({ messageId: 'msg.2', channelTurnRef: 'src.msg.1' })),
      ),
    ).toBe('turn-conflict');
    expect(runtime.invoked()).toBe(1);
  });

  it('the same source string on a DIFFERENT channel is a different source', async () => {
    const { svc, runtime } = harness();
    await svc.handleChannelTurn(turn({ channel: 'WEB', messageId: 'a', channelTurnRef: 'ref.1' }));
    await svc.handleChannelTurn(
      turn({ channel: 'WHATSAPP', messageId: 'b', channelTurnRef: 'ref.1' }),
    );
    expect(runtime.invoked()).toBe(2);
  });

  it('the same message id in another conversation or tenant is independent', async () => {
    const { svc, runtime } = harness();
    await svc.handleChannelTurn(turn({ conversationId: 'conv.1' }));
    await svc.handleChannelTurn(turn({ conversationId: 'conv.2' }));
    await svc.handleChannelTurn(turn({ tenantId: 'tenant.b' }));
    expect(runtime.invoked()).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// The coordinator is told metadata, and only metadata.
// ---------------------------------------------------------------------------

describe('the coordinator is never handed a client message', () => {
  it('begin receives exactly the eight non-content fields', async () => {
    const { svc, coordinator } = harness();
    await svc.handleChannelTurn(
      turn({ subjectRef: 'subject.1', normalizedText: 'a sentence about my kitchen' }),
    );
    const seen = coordinator.seenBeginInputs()[0];
    expect(Object.keys(seen ?? {}).sort()).toStrictEqual([
      'channel',
      'channelTurnRef',
      'conversationId',
      'dataClass',
      'messageId',
      'receivedAt',
      'subjectRef',
      'tenantId',
    ]);
    // The property that matters, asserted directly rather than trusted: no word the client wrote.
    expect('normalizedText' in (seen ?? {})).toBe(false);
    expect(JSON.stringify(seen)).not.toContain('kitchen');
  });
});

// ---------------------------------------------------------------------------
// One in flight, and zero downstream work when refused.
// ---------------------------------------------------------------------------

describe('one text turn per conversation, and a refusal costs nothing', () => {
  it('a BUSY conversation reaches no store, no authority and no runtime', async () => {
    const coordinator = scriptedTurnCoordinator();
    coordinator.holdConversation('tenant.a', 'conv.1');
    const { svc, store, reader, runtime } = harness({ coordinator });
    expect(await code(() => svc.handleChannelTurn(turn()))).toBe('turn-in-flight');
    expect(store.calls.load).toBe(0);
    expect(store.calls.createInitialIfAbsent).toBe(0);
    expect(store.calls.compareAndSet).toBe(0);
    expect(reader.calls()).toBe(0);
    expect(runtime.invoked()).toBe(0);
  });

  it('two concurrent turns on one conversation run at most one model turn', async () => {
    const { svc, runtime, coordinator } = harness();
    const outcomes = await Promise.allSettled([
      svc.handleChannelTurn(turn({ messageId: 'msg.1' })),
      svc.handleChannelTurn(turn({ messageId: 'msg.2' })),
    ]);
    expect(runtime.invoked()).toBe(1);
    expect(coordinator.begins()).toBe(2);
    expect(coordinator.starts()).toBe(1);
    const rejected = outcomes.filter(
      (one): one is PromiseRejectedResult => one.status === 'rejected',
    );
    expect(rejected).toHaveLength(1);
    expect(rejected[0]?.reason).toMatchObject({
      code: 'turn-in-flight',
    });
  });

  it('the loser may be presented again once the first turn finishes, and sees FRESH continuity', async () => {
    const { svc, store, runtime } = harness({ observations: [SET('location', 'Indiranagar')] });
    await svc.handleChannelTurn(turn({ messageId: 'msg.1' }));
    // No automatic retry lives in the service. This is an explicit second presentation.
    const second = await svc.handleChannelTurn(turn({ messageId: 'msg.2' }));
    expect(second.continuity.discovery.locationRef).toBe('Indiranagar');
    expect(runtime.invoked()).toBe(2);
    expect(store.size).toBe(1);
  });

  it('an unavailable coordinator fails CLOSED, and leaks nothing', async () => {
    const { svc, store, reader, runtime } = harness({ coordinatorOptions: { beginRejects: true } });
    let message = '';
    try {
      await svc.handleChannelTurn(turn());
    } catch (error: unknown) {
      message = (error as Error).message;
      expect((error as RiyaWebConversationError).code).toBe('turn-coordinator-unavailable');
    }
    expect(message).not.toContain('10.0.0.5');
    expect(message).not.toContain('hunter2');
    expect(store.calls.load).toBe(0);
    expect(reader.calls()).toBe(0);
    expect(runtime.invoked()).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// The staged lifecycle.
// ---------------------------------------------------------------------------

describe('a claim is written immediately before the runtime, and never earlier', () => {
  it('a safe PRE-START failure writes no claim and stays retryable', async () => {
    // An unprovable availability answer happens before any model, Core call or write. A ledger row
    // written at `begin` would have marked this message spent when nothing ran.
    const store = new InMemoryContinuityStore();
    const coordinator = scriptedTurnCoordinator();
    const runtime = scriptedRuntime('CORE_ACCEPTED');
    const svc = createRiyaWebConversationService({
      runtime,
      continuityStore: store,
      availabilityReader: scriptedAvailabilityReader({ rejects: true }),
      turnCoordinator: coordinator,
      runtimeId: 'rt.1',
    });
    const outcome = await svc.handleChannelTurn(turn());
    expect(outcome.disposition).toBe('NOT_READY');
    expect(coordinator.starts()).toBe(0);
    expect(coordinator.releases()).toBe(1);
    expect(coordinator.claimState('tenant.a', 'conv.1', 'msg.1')).toBeUndefined();
    expect(runtime.invoked()).toBe(0);

    // ...and the SAME logical message is still presentable.
    const retried = harness({ store });
    void retried;
    const again = await createRiyaWebConversationService({
      runtime,
      continuityStore: store,
      availabilityReader: scriptedAvailabilityReader(),
      turnCoordinator: coordinator,
      runtimeId: 'rt.1',
    }).handleChannelTurn(turn());
    expect(again.disposition).toBe('PROCESSED');
    expect(coordinator.starts()).toBe(1);
  });

  it('an ambiguous claim write makes NO runtime call', async () => {
    const { svc, runtime, coordinator } = harness({ coordinatorOptions: { startRejects: true } });
    expect(await code(() => svc.handleChannelTurn(turn()))).toBe('turn-indeterminate');
    expect(runtime.invoked()).toBe(0);
    expect(coordinator.starts()).toBe(1);
  });

  it('an ambiguous finalization WITHHOLDS the body, and the next attempt is indeterminate', async () => {
    const { svc, runtime, coordinator } = harness({
      coordinatorOptions: { completeRejects: true },
    });
    expect(await code(() => svc.handleChannelTurn(turn()))).toBe('turn-indeterminate');
    // The turn ran once. Nothing is re-run, and no body reached the caller.
    expect(runtime.invoked()).toBe(1);
    expect(coordinator.claimState('tenant.a', 'conv.1', 'msg.1')).toBe('PROCESSING');

    // A later claim of the same message finds PROCESSING and marks it spent rather than re-running.
    expect(await code(() => svc.handleChannelTurn(turn()))).toBe('turn-indeterminate');
    expect(runtime.invoked()).toBe(1);
    expect(coordinator.claimState('tenant.a', 'conv.1', 'msg.1')).toBe('INDETERMINATE');
  });

  it('a runtime failure after the start line marks the claim indeterminate ONCE', async () => {
    const store = new InMemoryContinuityStore();
    const coordinator = scriptedTurnCoordinator();
    const svc = createRiyaWebConversationService({
      runtime: scriptedRuntime('CORE_ACCEPTED', { throws: true }),
      continuityStore: store,
      availabilityReader: scriptedAvailabilityReader(),
      turnCoordinator: coordinator,
      runtimeId: 'rt.1',
    });
    // The caller keeps the ORIGINAL bounded reason -- rewriting every post-start failure would tell
    // a caller less than the service knows.
    expect(await code(() => svc.handleChannelTurn(turn()))).toBe('runtime-unavailable');
    expect(coordinator.indeterminates()).toBe(1);
    expect(coordinator.claimState('tenant.a', 'conv.1', 'msg.1')).toBe('INDETERMINATE');
    // And that message is spent, whatever the caller was told.
    expect(await code(() => svc.handleChannelTurn(turn()))).toBe('turn-indeterminate');
  });
});

// ---------------------------------------------------------------------------
// The WEB contract is untouched.
// ---------------------------------------------------------------------------

describe('the existing WEB capability is a thin wrapper and is unchanged', () => {
  it('handleTurn still takes webTurnRef and still returns a V2 result', async () => {
    const { svc, coordinator, runtime } = harness();
    const result = await svc.handleTurn({
      version: 1,
      tenantId: 'tenant.a',
      conversationId: 'conv.1',
      messageId: 'msg.1',
      receivedAt: '2026-08-01T09:00:00Z',
      webTurnRef: 'web.turn.opaque.ref',
      dataClass: 'HOSTED_ALLOWED',
    });
    expect(result.version).toBe(2);
    expect(Object.keys(result).sort()).toStrictEqual([
      'authorizedReply',
      'continuity',
      'conversationId',
      'disposition',
      'messageId',
      'reason',
      'tenantId',
      'version',
    ]);
    // WEB is fixed by the wrapper, and `webTurnRef` becomes the channel reference.
    expect(runtime.lastEnvelope()?.channel).toBe('WEB');
    expect(coordinator.seenBeginInputs()[0]?.channel).toBe('WEB');
    expect(coordinator.seenBeginInputs()[0]?.channelTurnRef).toBe('web.turn.opaque.ref');
  });

  it('a channel-neutral turn refuses INTERNAL and every field a caller may not state', async () => {
    const { svc } = harness();
    for (const forged of [
      { channel: 'INTERNAL' },
      { channel: 'SMS' },
      { partyType: 'VENDOR' },
      { direction: 'OUTBOUND' },
      { runtimeId: 'rt.evil' },
      { webTurnRef: 'x' },
      { consentGranted: true },
      { canSubmit: true },
    ]) {
      expect(
        await code(() => svc.handleChannelTurn({ ...turn(), ...forged } as never)),
        JSON.stringify(forged),
      ).toBe('invalid-input');
    }
  });
});
