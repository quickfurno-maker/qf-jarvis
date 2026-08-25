/**
 * The JAO-5 governed monitor operations (ADR-0119).
 *
 * Enrollment and the kill switch. Both are explicit, both are durable, both are idempotent by
 * `operationId`, and neither has a counterpart that undoes it: there is no `unenroll` and no
 * `unkill` anywhere in this slice.
 *
 * That asymmetry is deliberate. A kill switch a stale process can clear is not a kill switch, and
 * an enrollment that can be silently revived is not a bounded horizon. Reactivation means enrolling
 * a NEW monitor instance, which is an explicit auditable act with its own expiry rather than a
 * state transition somebody can race.
 *
 * Pure apart from the store it is handed: no clock, no network, no filesystem, no environment.
 */
import type { DatabasePool } from '@qf-jarvis/event-backbone';

import {
  Jao5AmbientError,
  type Jao5Clock,
  type Jao5EnrollMonitorInput,
  type Jao5KillMonitorInput,
  type Jao5MonitorInstance,
  type Jao5OperationResult,
} from './contracts.js';
import {
  createJao5MonitorRegistry,
  jao5DefinitionDigest,
  type Jao5MonitorRegistry,
} from './monitor-registry.js';
import { createJao5PostgresStore } from './postgres-store.js';
import type { Jao5AmbientStore } from './store-port.js';

/**
 * What a PUBLIC JAO-5 operation needs. Trusted infrastructure boundaries only.
 *
 * ### Why this is a `DatabasePool` and not a `Jao5AmbientStore`
 *
 * It used to be a store, and owner review found the bypass. `Jao5AmbientStore` exposes
 * `claimAmbientRun`, which takes the trigger kind, trigger reference, dedupe key, scheduled slot,
 * event id, definition digest, budget window and per-window limit as CALLER-SUPPLIED VALUES. The
 * adapter re-checks them against the locked row -- but it cannot reconstruct canonical monitor
 * policy, so it cannot know whether the slot was actually due, whether the event matched the
 * monitor's own type and scope, or whether the budget numbers are the reviewed ones.
 *
 * So a public caller holding a store could skip `runJao5AmbientCycle` entirely and claim with
 * whatever policy it liked -- or supply a store implementation of its own. Either defeats the
 * statement that the public surface IS the ambient governance boundary.
 *
 * A `DatabasePool` is the trusted persistence infrastructure boundary, the way `ModelGateway` is
 * the trusted inference boundary. The canonical store is constructed from it HERE, and the raw
 * store, claim and finalize contracts are not exported from any barrel.
 */
export interface Jao5MonitorOperationDependencies {
  readonly pool: DatabasePool;
  readonly clock: Jao5Clock;
}

/**
 * The INTERNAL variant. Trusted, source-level, and not public.
 *
 * Adapter implementations and direct-path tests need to exercise the raw store; the public surface
 * must not be able to reach it. Exported from this module and from no barrel.
 */
export interface Jao5InternalMonitorOperationDependencies {
  readonly store: Jao5AmbientStore;
  readonly clock: Jao5Clock;
}

/** The canonical store, built from the pool. Not a default a caller could displace. */
function canonicalStore(
  dependencies: Jao5MonitorOperationDependencies,
): Jao5InternalMonitorOperationDependencies {
  return { store: createJao5PostgresStore(dependencies.pool), clock: dependencies.clock };
}

/**
 * Enroll a monitor instance in SHADOW mode.
 *
 * The definition is looked up in the CANONICAL registry here and its digest stored on the
 * instance, so the enrollment is bound to the exact definition it was reviewed against. A caller
 * cannot supply a definition, only name one -- which is what stops enrollment becoming a way to
 * introduce a monitor nobody governs.
 */
export async function enrollJao5Monitor(
  input: Jao5EnrollMonitorInput,
  dependencies: Jao5MonitorOperationDependencies,
): Promise<Jao5OperationResult> {
  return enrollJao5MonitorInternal(input, canonicalStore(dependencies));
}

/** The internal enrollment. Same governance; a trusted caller may supply the store. */
export async function enrollJao5MonitorInternal(
  input: Jao5EnrollMonitorInput,
  dependencies: Jao5InternalMonitorOperationDependencies,
): Promise<Jao5OperationResult> {
  const registry = createJao5MonitorRegistry();
  const definition = registry.lookup(input.monitorId, input.monitorVersion);
  return dependencies.store.enrollMonitor(
    input,
    jao5DefinitionDigest(definition),
    definition.ownerId,
    dependencies.clock.nowMs(),
  );
}

/**
 * Kill a monitor instance. Terminal, durable, idempotent, compare-and-set.
 *
 * Once this commits, every subsequent claim for that instance refuses -- including one already in
 * flight in another process, because the claim transaction locks the same row. It cannot undo a
 * model call that has already started: an investigation claimed before the kill committed may
 * finish, and JAO-5 does not pretend otherwise.
 */
export async function killJao5Monitor(
  input: Jao5KillMonitorInput,
  dependencies: Jao5MonitorOperationDependencies,
): Promise<Jao5OperationResult> {
  return killJao5MonitorInternal(input, canonicalStore(dependencies));
}

/** The internal kill. Same governance; a trusted caller may supply the store. */
export async function killJao5MonitorInternal(
  input: Jao5KillMonitorInput,
  dependencies: Jao5InternalMonitorOperationDependencies,
): Promise<Jao5OperationResult> {
  return dependencies.store.killMonitor(input, dependencies.clock.nowMs());
}

/** Read one enrolled instance. Refuses `MONITOR_NOT_ENROLLED`; never reports absence for doubt. */
export async function readJao5MonitorInstance(
  monitorInstanceId: string,
  dependencies: Jao5MonitorOperationDependencies,
): Promise<Jao5MonitorInstance> {
  return canonicalStore(dependencies).store.readMonitorInstance(monitorInstanceId);
}

/**
 * The definition an enrolled instance is bound to, from the canonical registry.
 *
 * Exposed so an operator surface can show what a monitor is governed by without being able to
 * change it: the returned definition is a frozen record built at module load.
 */
export function jao5DefinitionForInstance(
  instance: Jao5MonitorInstance,
  registry: Jao5MonitorRegistry = createJao5MonitorRegistry(),
): ReturnType<Jao5MonitorRegistry['lookup']> {
  const definition = registry.lookup(instance.monitorId, instance.monitorVersion);
  if (jao5DefinitionDigest(definition) !== instance.definitionDigest) {
    // The definition changed after enrollment. Fail closed rather than presenting bounds the
    // instance was never enrolled against.
    throw new Jao5AmbientError('MONITOR_VERSION_MISMATCH');
  }
  return definition;
}
