/**
 * Durable Jarvis runtime composition (QFJ-P08-B3, ADR-0078).
 *
 * INTERNAL to `@qf-jarvis/api`. Deliberately NOT exported from the package root: the application
 * root stays at zero runtime exports, because a composition root that other packages could import
 * would stop being a boundary and become a library (ADR-0004, ADR-0010).
 *
 * ### What this closes
 *
 * QFJ-P08-A gave the runtime a writable control capability; QFJ-P08-B2 gave that capability a
 * durable PostgreSQL implementation. Neither wired them together, so on merged `main` the only
 * authoritative state a real `createJarvisRuntime` could receive was an in-process fake: a human
 * takeover lived in a closure and died with the process. This module is the seam that makes a
 * takeover survive a restart, and it is the ONLY place in the repository that constructs the durable
 * adapter for production use.
 *
 * ### The order is the safety property
 *
 * pool → adapter → **readiness** → runtime. Readiness is awaited BEFORE `createJarvisRuntime` is
 * called, so a schema or grant mismatch produces a process that refuses to start rather than a
 * runtime that refuses every conversation. There is deliberately no lazy first-use check, no fake
 * source swapped for a real one later, and no in-memory fallback: a fallback would silently trade
 * the durability guarantee for availability at exactly the moment durability matters, and nothing
 * downstream could tell the difference.
 *
 * ### What it does not do
 *
 * No HTTP server, route or health endpoint. It reads no environment variable and no secret file —
 * the `DatabaseConfig` is an explicit, already-validated input, and acquiring it belongs to a future
 * executable bootstrap. It runs and attempts no schema migration, and creates no schema object. It
 * provisions no conversation. No consent, approval, recommendation, operator API or transport.
 */
import { closeDatabasePool, createDatabasePool } from '@qf-jarvis/event-backbone';
import type { DatabaseConfig, DatabasePool } from '@qf-jarvis/event-backbone';
import { createJarvisRuntime } from '@qf-jarvis/jarvis-runtime';
import type {
  JarvisProvenanceRefs,
  JarvisRuntime,
  JarvisRuntimeConfig,
} from '@qf-jarvis/jarvis-runtime';
import { createPostgresConversationStateAdapter } from '@qf-jarvis/postgres-conversation-state';

/**
 * The B3 application provenance reference.
 *
 * The GENERIC `@qf-jarvis/jarvis-runtime` default stays `qfj.jarvis-runtime.p08b1` and is not
 * touched: it describes what that package is, and a library that renamed itself because an
 * application composed it differently would make provenance a moving target. This value describes
 * the DURABLE composition specifically — a turn stamped `p08b3` was served by a runtime whose
 * conversation state was PostgreSQL-backed, which is precisely the distinction an audit needs.
 */
export const DURABLE_JARVIS_RUNTIME_REF = 'qfj.jarvis-runtime.p08b3';

/**
 * The runtime configuration a caller supplies.
 *
 * `authoritativeState` is omitted because this module supplies it, and accepting one would let a
 * caller inject a second — or a fake — source alongside the durable adapter. `runtimeRef` is omitted
 * for the same reason: a caller that could name the runtime could claim `p08b3` durability while
 * running on something else. Every other provenance reference is passed through untouched.
 */
export type DurableJarvisRuntimeConfig = Omit<
  JarvisRuntimeConfig,
  'authoritativeState' | 'provenanceRefs'
> & {
  readonly provenanceRefs?: Omit<JarvisProvenanceRefs, 'runtimeRef'>;
};

/** A started durable runtime and the means to shut it down. Nothing else is reachable. */
export interface DurableJarvisRuntimeLifecycle {
  readonly runtime: JarvisRuntime;
  /** Closes the pool this module created. Idempotent, via `closeDatabasePool`'s `ended` guard. */
  close(): Promise<void>;
}

/**
 * Compose a durable runtime over a pool the CALLER owns.
 *
 * Separate from `startDurableJarvisRuntime` so a caller that already manages a pool — a test
 * harness, or a future process that shares one connection pool across subsystems — can compose
 * without surrendering its lifecycle. This function therefore never closes the pool it was given,
 * not even on failure: closing something you did not create is how one subsystem's error becomes
 * another's outage.
 */
export async function composeDurableJarvisRuntime(input: {
  readonly pool: DatabasePool;
  readonly runtimeConfig: DurableJarvisRuntimeConfig;
}): Promise<JarvisRuntime> {
  const adapter = createPostgresConversationStateAdapter({ pool: input.pool });

  // BEFORE the runtime exists. If this rejects, no runtime is returned and none was ever built.
  await adapter.assertReady();

  return createJarvisRuntime({
    ...input.runtimeConfig,
    // The ONE authoritative source. It is the same object the operator control surface and the
    // operations query resolve against, so there is no second state to disagree with.
    authoritativeState: adapter,
    provenanceRefs: {
      ...input.runtimeConfig.provenanceRefs,
      runtimeRef: DURABLE_JARVIS_RUNTIME_REF,
    },
  });
}

/**
 * Create the pool, compose the runtime, and hand back a lifecycle.
 *
 * On ANY failure — pool creation, readiness, or composition — the pool this function created is
 * closed before the rejection propagates. A process that failed to start should not leave
 * connections open against a database it just decided it cannot use.
 */
export async function startDurableJarvisRuntime(input: {
  readonly databaseConfig: DatabaseConfig;
  readonly runtimeConfig: DurableJarvisRuntimeConfig;
}): Promise<DurableJarvisRuntimeLifecycle> {
  const pool = createDatabasePool(input.databaseConfig);

  let runtime: JarvisRuntime;
  try {
    runtime = await composeDurableJarvisRuntime({ pool, runtimeConfig: input.runtimeConfig });
  } catch (error) {
    try {
      await closeDatabasePool(pool);
    } catch {
      // The startup failure is the informative one. A failure to close a pool we are abandoning
      // anyway must not replace it, or the reported cause becomes the cleanup rather than the fault.
    }
    throw error;
  }

  // Frozen, and exposing exactly two things. The pool, the adapter, the database config and the
  // connection string are all captured in the closure and unreachable: `provision` in particular
  // must not be callable from here, because auto-provisioning a missing conversation would be this
  // application inventing a business fact that only QuickFurno Core may supply.
  return Object.freeze({
    runtime,
    close: async (): Promise<void> => {
      await closeDatabasePool(pool);
    },
  });
}
