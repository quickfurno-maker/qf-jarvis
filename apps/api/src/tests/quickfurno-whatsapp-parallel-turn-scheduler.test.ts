import { describe, expect, it } from 'vitest';

import { createQuickFurnoWhatsAppParallelScheduler } from '../quickfurno-whatsapp/parallel-turn-scheduler.js';
import type {
  QuickFurnoWhatsAppTurnClaimSelection,
  QuickFurnoWhatsAppTurnReference,
} from '../quickfurno-whatsapp/turn-processor.js';

type Agent = QuickFurnoWhatsAppTurnReference['assignedActor'];

function ref(
  agent: Agent,
  index: number,
  conversationIndex = index,
): QuickFurnoWhatsAppTurnReference {
  const suffix = String(index + 1).padStart(12, '0');
  const conversationSuffix = String(conversationIndex + 1).padStart(12, '0');
  return Object.freeze({
    conversationId: `22222222-2222-4222-8222-${conversationSuffix}`,
    conversationRevision: index + 1,
    inboundMessageId: `33333333-3333-4333-8333-${suffix}`,
    assignedActor: agent,
    subjectType: agent === 'RIYA' ? 'client' : agent === 'ANISHA' ? 'vendor' : 'prospect',
  });
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function until(predicate: () => boolean, timeoutMs = 2_000): Promise<void> {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) throw new Error('scheduler-test-timeout');
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
}

describe('QuickFurno WhatsApp parallel turn scheduler', () => {
  it('admits 200 simultaneous conversations and lets one agent use the full global capacity', async () => {
    const pending = Array.from({ length: 205 }, (_, i) => ref('RIYA', i));
    const gates = new Map<string, ReturnType<typeof deferred>>();
    const started: QuickFurnoWhatsAppTurnReference[] = [];

    const queue = {
      claimNext(selection: QuickFurnoWhatsAppTurnClaimSelection = {}) {
        const allowed = new Set(selection.allowedActors ?? ['RIYA', 'ANISHA', 'AAROHI']);
        const excluded = new Set(selection.excludedConversationIds ?? []);
        const index = pending.findIndex(
          (item) => allowed.has(item.assignedActor) && !excluded.has(item.conversationId),
        );
        return Promise.resolve(index < 0 ? null : (pending.splice(index, 1)[0] ?? null));
      },
    };
    const processor = {
      async processClaimed(item: QuickFurnoWhatsAppTurnReference) {
        started.push(item);
        const gate = deferred();
        gates.set(item.inboundMessageId, gate);
        await gate.promise;
        return 'completed-queued' as const;
      },
    };
    const controller = new AbortController();
    const scheduler = createQuickFurnoWhatsAppParallelScheduler({
      queue,
      processor,
      parallelism: {
        globalMaxConcurrentTurns: 200,
        maxConcurrentByAgent: { RIYA: 200, ANISHA: 200, AAROHI: 200 },
      },
      idlePollMs: 2,
      canClaim: () => true,
      onOutcome: () => undefined,
    });

    const running = scheduler.run(controller.signal);
    await until(() => started.length === 200);

    expect(scheduler.snapshot()).toEqual({
      totalInFlight: 200,
      activeByAgent: { RIYA: 200, ANISHA: 0, AAROHI: 0 },
      activeConversationCount: 200,
    });
    expect(new Set(started.map((item) => item.conversationId)).size).toBe(200);
    expect(pending).toHaveLength(5);

    controller.abort();
    for (const gate of gates.values()) gate.resolve();
    await running;
  });
  it('serializes two turns from the same conversation even when the RIYA lane has capacity', async () => {
    const first = ref('RIYA', 0, 0);
    const second = Object.freeze({
      ...ref('RIYA', 1, 0),
      conversationRevision: first.conversationRevision + 1,
    });
    const pending = [first, second];
    const firstGate = deferred();
    const secondGate = deferred();
    const started: string[] = [];

    const queue = {
      claimNext(selection: QuickFurnoWhatsAppTurnClaimSelection = {}) {
        const allowed = new Set(selection.allowedActors ?? ['RIYA', 'ANISHA', 'AAROHI']);
        const excluded = new Set(selection.excludedConversationIds ?? []);
        const index = pending.findIndex(
          (item) => allowed.has(item.assignedActor) && !excluded.has(item.conversationId),
        );
        return Promise.resolve(index < 0 ? null : (pending.splice(index, 1)[0] ?? null));
      },
    };
    const processor = {
      async processClaimed(item: QuickFurnoWhatsAppTurnReference) {
        started.push(item.inboundMessageId);
        await (item.inboundMessageId === first.inboundMessageId
          ? firstGate.promise
          : secondGate.promise);
        return 'completed-queued' as const;
      },
    };
    const controller = new AbortController();
    const scheduler = createQuickFurnoWhatsAppParallelScheduler({
      queue,
      processor,
      parallelism: {
        globalMaxConcurrentTurns: 200,
        maxConcurrentByAgent: { RIYA: 200, ANISHA: 200, AAROHI: 200 },
      },
      idlePollMs: 2,
      canClaim: () => true,
      onOutcome: () => undefined,
    });

    const running = scheduler.run(controller.signal);
    await until(() => started.length === 1);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(started).toEqual([first.inboundMessageId]);

    firstGate.resolve();
    await until(() => started.length === 2);
    expect(started).toEqual([first.inboundMessageId, second.inboundMessageId]);

    controller.abort();
    secondGate.resolve();
    await running;
  });

  it('claims only configured agent lanes so Riya, Anisha and Aarohi can scale independently', async () => {
    const pending = [ref('ANISHA', 0), ref('RIYA', 1), ref('AAROHI', 2), ref('RIYA', 3)];
    const started: Agent[] = [];
    const queue = {
      claimNext(selection: QuickFurnoWhatsAppTurnClaimSelection = {}) {
        const allowed = new Set(selection.allowedActors ?? ['RIYA', 'ANISHA', 'AAROHI']);
        const index = pending.findIndex((item) => allowed.has(item.assignedActor));
        return Promise.resolve(index < 0 ? null : (pending.splice(index, 1)[0] ?? null));
      },
    };
    const processor = {
      processClaimed(item: QuickFurnoWhatsAppTurnReference) {
        started.push(item.assignedActor);
        return Promise.resolve('completed-queued' as const);
      },
    };
    const controller = new AbortController();
    const scheduler = createQuickFurnoWhatsAppParallelScheduler({
      queue,
      processor,
      agents: ['RIYA'],
      parallelism: {
        globalMaxConcurrentTurns: 2,
        maxConcurrentByAgent: { RIYA: 2, ANISHA: 2, AAROHI: 2 },
      },
      idlePollMs: 2,
      canClaim: () => true,
      onOutcome: () => undefined,
    });

    const running = scheduler.run(controller.signal);
    await until(() => started.length === 2);
    controller.abort();
    await running;

    expect(started).toEqual(['RIYA', 'RIYA']);
    expect(pending.map((item) => item.assignedActor)).toEqual(['ANISHA', 'AAROHI']);
  });
});
