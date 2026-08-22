/**
 * The durable execution-dispatch composition (QFJ-P09.04).
 *
 * ### The one thing this adds, and why it is worth a package
 *
 * QFJ-P09.02 made `replayGuard` a REQUIRED, defaultless input to `verifyExecutionDispatch`, and its
 * own ADR says why: an in-memory guard passes every test and loses its state. QFJ-P09.03 then
 * supplied the durable PostgreSQL implementation — and left it composed by nobody, which its ADR
 * also records.
 *
 * So the gap is not a missing capability. Both halves exist and both are merged. The gap is that
 * every caller had to assemble them, and a caller assembling them is a caller who can assemble them
 * WRONG — by passing an in-memory guard, or a guard from the wrong database, or none at all.
 *
 * This composition closes exactly that and nothing else. A boundary built here is durable BY
 * CONSTRUCTION: the only guard it can use is the Postgres store, built from the pool the caller
 * supplied. There is no seam through which a process-lifetime guard can enter.
 *
 * ### What it does NOT do, and will not become
 *
 * It adopts no transport. There is no URL, no webhook, no endpoint, no n8n client, no n8n workflow
 * id, no credential, no provider, no message and no recipient anywhere in this package. Nothing here
 * sends, executes, schedules, retries, polls or queues.
 *
 * The permanent flow is unchanged: Jarvis recommends, QuickFurno Core authorizes and issues the
 * intent, this boundary VERIFIES, n8n executes only behind a future adopted transport, providers
 * deliver, and results return to Core. Composing a verifier with a store creates no new authority
 * for anybody, and this package deliberately exposes nothing that could be mistaken for one — no
 * `canExecute`, `canSend`, `isAuthorized`, `executed`, `sent`, `delivered` or `consentValid`.
 *
 * A verified first-seen dispatch remains a bounded validation OBSERVATION. It is not execution
 * truth, and it is not permission to become execution truth later.
 *
 * ### It adds no schema
 *
 * Migration 0010 belongs to QFJ-P09.03 and is reused unchanged. Composition does not justify schema:
 * this package creates no migration, owns no table and issues no DDL.
 *
 * ### The pool stays the caller's
 *
 * Constructing a boundary opens no connection and performs no I/O, exactly as the underlying store
 * does. Readiness is answered where it matters — the first claim against a database without
 * migration 0010 raises `schema-incompatible`, which the dispatch boundary already turns into
 * `replay-guard-unavailable` and a refusal. This package adds no probe the verifier could never call,
 * and it never closes a pool it did not open.
 */
import {
  verifyExecutionDispatch,
  type ExecutionDispatchKeyRegistry,
  type ExecutionDispatchResult,
  type VerifyExecutionDispatchOptions,
} from '@qf-jarvis/execution-dispatch-runtime';
import { createPostgresExecutionReplayStore } from '@qf-jarvis/postgres-execution-replay-store';
import type { Pool } from 'pg';

/**
 * What the composition needs. All injected; nothing is read from the environment.
 *
 * Note what is ABSENT: there is no `replayGuard`. That is the point of the package — the guard is
 * built here from the pool, so a caller cannot substitute a process-lifetime one.
 */
export interface DurableDispatchBoundaryConfig {
  /** An open `pg` Pool. The caller creates it, configures it, and closes it. */
  readonly pool: Pool;
  /** Execution-dispatch keys. A DIFFERENT trust purpose from Core → Jarvis event keys. */
  readonly registry: ExecutionDispatchKeyRegistry;
  /** Forwarded verbatim to the verifier. This package interprets none of it. */
  readonly options?: VerifyExecutionDispatchOptions;
}

/**
 * One dispatch, as it arrives at the execution boundary.
 *
 * Deliberately the verifier's own three untrusted inputs and nothing more. The guard, the registry
 * and the options are bound at construction, so a per-dispatch caller cannot vary the trust
 * configuration between one request and the next.
 */
export interface DurableDispatchInput {
  /** The exact bytes received, as one serialized `ExecutionIntentV1`. */
  readonly rawBody: Uint8Array;
  /** The untrusted signature envelope. Fully validated downstream; cannot make this throw. */
  readonly envelope: unknown;
  /** The execution-boundary instant, injected. This package reads no clock. */
  readonly now: Date;
}

/**
 * A dispatch boundary whose replay state survives a restart.
 *
 * One method. A boundary that could also report, list, prune or reset would be a boundary somebody
 * could use to make a claim disappear, and an idempotency guarantee you can erase is not one.
 */
export interface DurableExecutionDispatchBoundary {
  /**
   * Verify one dispatch.
   *
   * Returns the P09.02 result verbatim — the same closed disposition and the same closed reason
   * codes. This composition classifies nothing itself: wrapping those into a local taxonomy would
   * destroy the classification the boundary exists to produce, and a caller would lose the ability
   * to tell a forged signature from an expired intent from an unavailable store.
   */
  verify(input: DurableDispatchInput): Promise<ExecutionDispatchResult>;
}

/**
 * Build a durable execution-dispatch boundary.
 *
 * Synchronous and I/O-free, like the store it wraps. The store's own constructor validates the pool
 * and throws `PostgresExecutionReplayStoreError('invalid-input')` on a bad one — that error is
 * allowed to propagate unchanged rather than being re-wrapped, because a wiring defect deserves the
 * precise diagnosis its owner already wrote.
 */
export function createDurableExecutionDispatchBoundary(
  config: DurableDispatchBoundaryConfig,
): DurableExecutionDispatchBoundary {
  // Built ONCE, from the caller's pool. This is the whole guarantee: there is no later seam where a
  // different guard could be supplied, and no default that could quietly be an in-memory one.
  const replayGuard = createPostgresExecutionReplayStore({ pool: config.pool });
  const registry = config.registry;
  const options = config.options;

  return Object.freeze({
    verify(input: DurableDispatchInput): Promise<ExecutionDispatchResult> {
      // Forwarded verbatim. Every P09.02 guarantee is preserved because P09.02 still performs all of
      // them: raw-body detachment and digest binding, the execution-dispatch domain and key purpose,
      // signature freshness against the injected `now`, intent expiry as a separate check, the
      // authoritative schema parse, and only then the atomic claim.
      return verifyExecutionDispatch({
        rawBody: input.rawBody,
        envelope: input.envelope,
        now: input.now,
        registry,
        replayGuard,
        ...(options === undefined ? {} : { options }),
      });
    },
  });
}
