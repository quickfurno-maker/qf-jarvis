/**
 * A runtime that HOLDS every turn until a spec lets it go. TEST-ONLY (RWC-P9, ADR-0105).
 *
 * ### Why concurrency is proved this way and not with a clock
 *
 * To observe that a replica admits exactly `maxConcurrentTextTurns` turns at once, turns have to be
 * genuinely simultaneous — each one past admission and not yet finished. The tempting way to arrange
 * that is a sleep inside the runtime and an assertion afterwards, and it is the wrong way: the test
 * then passes on a fast machine, fails on a loaded CI worker, and gets marked flaky. At that point
 * the capacity bound has stopped being guarded and nobody notices.
 *
 * So the barrier is explicit. Every turn that reaches the runtime parks on a promise this file holds,
 * and the spec resolves them. `awaitArrivals(n)` settles at the exact moment the nth turn arrives, so
 * a spec never has to guess how many microtasks the pipeline takes. No `setTimeout`, no `setInterval`,
 * no sleep, no polling, and no timing assumption anywhere.
 *
 * The gate is the only thing added: the answers themselves come from the ordinary scripted runtime, so
 * a load spec and a behaviour spec are looking at the same runtime semantics.
 */
import type {
  JarvisRiyaConversationEvolutionInput,
  JarvisRiyaGroundedReplyInput,
  RiyaConversationEvolutionJarvisRuntime,
} from '@qf-jarvis/jarvis-runtime';

import { scriptedRuntime } from './scripted-runtime.js';

export type GatedRuntime = RiyaConversationEvolutionJarvisRuntime & {
  /** How many turns have reached the runtime and are parked. Cumulative, never decremented. */
  arrivals(): number;
  /** Settles the instant the nth turn has arrived. Already-satisfied counts settle immediately. */
  awaitArrivals(count: number): Promise<void>;
  /** Let every parked turn continue. Turns arriving afterwards park again. */
  releaseAll(): void;
  /** How many times the RWC-P4B evolution capability was entered. */
  invoked(): number;
  /** How many times the RWC-P7 grounded capability was entered. */
  groundedInvoked(): number;
};

export function gatedRuntime(): GatedRuntime {
  const inner = scriptedRuntime('CORE_ACCEPTED');
  const parked: (() => void)[] = [];
  let watchers: { readonly count: number; readonly resolve: () => void }[] = [];
  let arrivals = 0;

  const arrive = (): Promise<void> => {
    arrivals += 1;
    const reached = watchers.filter((watcher) => arrivals >= watcher.count);
    watchers = watchers.filter((watcher) => arrivals < watcher.count);
    for (const watcher of reached) {
      watcher.resolve();
    }
    return new Promise<void>((resolve) => {
      parked.push(resolve);
    });
  };

  return {
    ...inner,
    async processInboundForRiyaConversationEvolution(input: JarvisRiyaConversationEvolutionInput) {
      await arrive();
      return inner.processInboundForRiyaConversationEvolution(input);
    },
    async processInboundForRiyaGroundedReply(input: JarvisRiyaGroundedReplyInput) {
      await arrive();
      return inner.processInboundForRiyaGroundedReply(input);
    },
    arrivals: () => arrivals,
    awaitArrivals: (count: number): Promise<void> => {
      if (arrivals >= count) {
        return Promise.resolve();
      }
      return new Promise<void>((resolve) => {
        watchers.push({ count, resolve });
      });
    },
    releaseAll: (): void => {
      for (const resume of parked.splice(0)) {
        resume();
      }
    },
    invoked: () => inner.invoked(),
    groundedInvoked: () => inner.groundedInvoked(),
  };
}
