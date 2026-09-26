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
  it('admits exactly 20 turns per agent and 60 total without conversation overlap', async () => {
    const pending = [
      ...Array.from({ length: 25 }, (_, i) => ref('RIYA', i)),
      ...Array.from({ length: 25 }, (_, i) => ref('ANISHA', 100 + i)),
      ...Array.from({ length: 25 }, (_, i) => ref('AAROHI', 200 + i)),
    ];
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
        globalMaxConcurrentTurns: 60,
        maxConcurrentByAgent: { RIYA: 20, ANISHA: 20, AAROHI: 20 },
      },
      idlePollMs: 2,
      canClaim: () => true,
      onOutcome: () => undefined,
    });

    const running = scheduler.run(controller.signal);
    await until(() => started.length === 60);

    expect(scheduler.snapshot()).toEqual({
      totalInFlight: 60,
      activeByAgent: { RIYA: 20, ANISHA: 20, AAROHI: 20 },
      activeConversationCount: 60,
    });
    expect(new Set(started.map((item) => item.conversationId)).size).toBe(60);

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
        globalMaxConcurrentTurns: 60,
        maxConcurrentByAgent: { RIYA: 20, ANISHA: 20, AAROHI: 20 },
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
});
