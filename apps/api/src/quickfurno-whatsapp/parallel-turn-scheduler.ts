import type {
  QuickFurnoWhatsAppProcessorOutcome,
  QuickFurnoWhatsAppTurnProcessor,
  QuickFurnoWhatsAppTurnQueue,
  QuickFurnoWhatsAppTurnReference,
} from './turn-processor.js';

export type QuickFurnoWhatsAppAgent = QuickFurnoWhatsAppTurnReference['assignedActor'];

export interface QuickFurnoWhatsAppParallelism {
  readonly globalMaxConcurrentTurns: number;
  readonly maxConcurrentByAgent: Readonly<Record<QuickFurnoWhatsAppAgent, number>>;
}

export interface QuickFurnoWhatsAppParallelSchedulerConfig {
  readonly queue: Pick<QuickFurnoWhatsAppTurnQueue, 'claimNext'>;
  readonly processor: Pick<QuickFurnoWhatsAppTurnProcessor, 'processClaimed'>;
  readonly parallelism: QuickFurnoWhatsAppParallelism;
  readonly idlePollMs: number;
  readonly canClaim: () => boolean;
  readonly onOutcome: (
    outcome: QuickFurnoWhatsAppProcessorOutcome,
    ref: QuickFurnoWhatsAppTurnReference,
  ) => Promise<void> | void;
  readonly onIdle?: () => Promise<void> | void;
}

const AGENTS = Object.freeze(['RIYA', 'ANISHA', 'AAROHI'] as const);

class FailureLatch {
  private reason: Error | undefined;

  public fail(error: unknown): void {
    if (this.reason !== undefined) return;
    this.reason = error instanceof Error ? error : new Error('parallel-scheduler-failed');
  }

  public failed(): boolean {
    return this.reason !== undefined;
  }

  public throwIfFailed(): void {
    if (this.reason !== undefined) throw this.reason;
  }
}

function delay(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const finish = (): void => {
      signal.removeEventListener('abort', stop);
      resolve();
    };
    const timer = setTimeout(finish, ms);
    const stop = (): void => {
      clearTimeout(timer);
      finish();
    };
    signal.addEventListener('abort', stop, { once: true });
  });
}

export function createQuickFurnoWhatsAppParallelScheduler(
  config: QuickFurnoWhatsAppParallelSchedulerConfig,
) {
  const activeConversations = new Set<string>();
  const activeByAgent: Record<QuickFurnoWhatsAppAgent, number> = {
    RIYA: 0,
    ANISHA: 0,
    AAROHI: 0,
  };
  const inFlight = new Set<Promise<void>>();
  const failure = new FailureLatch();
  let cursor = 0;

  const capacityAvailable = (agent: QuickFurnoWhatsAppAgent): boolean =>
    inFlight.size < config.parallelism.globalMaxConcurrentTurns &&
    activeByAgent[agent] < config.parallelism.maxConcurrentByAgent[agent];

  const startOne = async (signal: AbortSignal): Promise<boolean> => {
    if (
      signal.aborted ||
      failure.failed() ||
      !config.canClaim() ||
      inFlight.size >= config.parallelism.globalMaxConcurrentTurns
    ) {
      return false;
    }

    for (let offset = 0; offset < AGENTS.length; offset += 1) {
      const index = (cursor + offset) % AGENTS.length;
      const agent = AGENTS[index];
      if (agent === undefined || !capacityAvailable(agent)) continue;

      const ref = await config.queue.claimNext({
        allowedActors: [agent],
        excludedConversationIds: [...activeConversations],
      });
      if (ref === null) continue;

      cursor = (index + 1) % AGENTS.length;
      activeConversations.add(ref.conversationId);
      activeByAgent[ref.assignedActor] += 1;

      const operation = (async () => {
        const outcome = await config.processor.processClaimed(ref);
        await config.onOutcome(outcome, ref);
      })().catch((error: unknown) => {
        failure.fail(error);
      });
      const task = operation.finally(() => {
        activeConversations.delete(ref.conversationId);
        activeByAgent[ref.assignedActor] -= 1;
        inFlight.delete(task);
      });
      inFlight.add(task);
      return true;
    }
    return false;
  };

  const run = async (signal: AbortSignal): Promise<void> => {
    try {
      while (!signal.aborted && !failure.failed()) {
        let started = false;
        while (inFlight.size < config.parallelism.globalMaxConcurrentTurns && config.canClaim()) {
          const claimed = await startOne(signal);
          if (!claimed) break;
          started = true;
        }
        if (inFlight.size === 0 || !config.canClaim()) {
          await config.onIdle?.();
          await delay(config.idlePollMs, signal);
          continue;
        }
        if (!started || inFlight.size >= config.parallelism.globalMaxConcurrentTurns) {
          await Promise.race([Promise.race([...inFlight]), delay(config.idlePollMs, signal)]);
        }
      }
    } finally {
      await Promise.allSettled([...inFlight]);
    }

    failure.throwIfFailed();
  };

  return Object.freeze({
    run,
    snapshot() {
      return Object.freeze({
        totalInFlight: inFlight.size,
        activeByAgent: Object.freeze({ ...activeByAgent }),
        activeConversationCount: activeConversations.size,
      });
    },
  });
}
