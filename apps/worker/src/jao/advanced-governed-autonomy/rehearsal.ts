/**
 * The JAO-7 VIRTUAL REVERSIBLE REHEARSAL (ADR-0121).
 *
 * ### A rehearsal is not an execution, and the name is part of the control
 *
 * This module changes exactly one thing: two integers in a JAO-7 row. It reaches no host filesystem,
 * no process, no environment, no network, no provider, no channel, no n8n, no Core and no business
 * table. It produces no `ExecutionResultV1`, because nothing executed.
 *
 * It is called `VIRTUAL_REVERSIBLE_REHEARSAL` and never `EXECUTION`, `LIVE_APPLY` or
 * `PRODUCTION_APPLY`, and that is not decoration. The most likely way this slice becomes dangerous
 * is not a missing check — it is somebody six months from now reading `applyEffect` and wiring it to
 * something real because the name suggested that was the intent.
 *
 * ### What it may consume, and when
 *
 * The exact approved action, AFTER authority correlation, as SIMULATION INPUT. That is what makes
 * the rehearsal meaningful: it simulates what the action would do if Core issued it and n8n ran it.
 * It does not run the Core-issued intent, and holding the intent does not make Jarvis its executor.
 *
 * ### The two sandboxes
 *
 * Both are integers because integers cannot accidentally hold a hostname, a path or a payload. The
 * operator-task ledger uses a present flag plus a fingerprint-derived binding, so a verification can
 * prove the virtual task belongs to the exact action that was approved rather than merely existing.
 */
import { Jao7AutonomyError, type Jao7RehearsalClass } from './contracts.js';

/** The upper bound of the sandbox integer columns. The binding must fit, or a CHECK refuses it. */
export const JAO7_BINDING_MODULUS = 1_000_000;

/**
 * A bounded binding derived from an action fingerprint.
 *
 * The virtual task stores this rather than the digest itself, so verification can prove the ledger
 * entry corresponds to THIS approved action rather than merely existing. It is reduced into the
 * sandbox column's range: a truncation that overflowed the column would make a correct rehearsal
 * fail a constraint, which is how this bound was found.
 *
 * It is not, and is not used as, a security primitive. It is a sandbox tag.
 */
export function jao7FingerprintBinding(actionFingerprint: string): number {
  if (!/^[0-9a-f]{64}$/u.test(actionFingerprint)) {
    throw new Jao7AutonomyError('REHEARSAL_APPLY_FAILED');
  }
  return Number.parseInt(actionFingerprint.slice(0, 8), 16) % JAO7_BINDING_MODULUS;
}

/** What a rehearsal apply intends to write into the sandbox. Two integers, always. */
export interface Jao7RehearsalTarget {
  readonly afterIntegerA: number;
  readonly afterIntegerB: number | null;
}

/**
 * Compute the target state for one rehearsal class.
 *
 * Pure and total. The values come from the APPROVED ACTION's own governed parameters — the ones a
 * human saw and a fingerprint measured — so a rehearsal cannot drift from what was approved.
 */
export function jao7RehearsalTarget(
  rehearsalClass: Jao7RehearsalClass,
  parameters: Record<string, unknown>,
  actionFingerprint: string,
): Jao7RehearsalTarget {
  if (rehearsalClass === 'VIRTUAL_OPERATOR_TASK_LEDGER') {
    // Slot A: the task is now present. Slot B: which action it belongs to.
    return Object.freeze({
      afterIntegerA: 1,
      afterIntegerB: jao7FingerprintBinding(actionFingerprint),
    });
  }

  const target = parameters['targetConcurrency'];
  if (typeof target !== 'number' || !Number.isInteger(target) || target < 1 || target > 32) {
    // Unreachable through the governed parameter schema, which already bounds this. Fail closed
    // anyway: a rehearsal that trusted an unbounded number would be the one place the bounds did
    // not apply.
    throw new Jao7AutonomyError('REHEARSAL_APPLY_FAILED');
  }
  return Object.freeze({ afterIntegerA: target, afterIntegerB: null });
}

/**
 * Verify an applied rehearsal against its intended target.
 *
 * EXACT_MATCH_AGAINST_TARGET, and nothing looser. A verification that accepted "close enough" would
 * make the rollback path unreachable in exactly the cases it exists for.
 */
export function jao7VerifyRehearsal(
  rehearsalClass: Jao7RehearsalClass,
  observedA: number | null,
  observedB: number | null,
  target: Jao7RehearsalTarget,
): boolean {
  if (observedA === null) {
    return false;
  }
  if (rehearsalClass === 'VIRTUAL_OPERATOR_TASK_LEDGER') {
    // Present AND bound to the right action. Presence alone would pass for a task created by
    // something else entirely, which is precisely the corruption the failure fixture injects.
    return observedA === target.afterIntegerA && observedB === target.afterIntegerB;
  }
  return observedA === target.afterIntegerA;
}

/**
 * The rollback target.
 *
 * The CAPTURED BEFORE STATE, and only that. There is no parameter through which a caller could name
 * a rollback value: a rollback that could be aimed somewhere new would be a second apply wearing a
 * safer word, and it would not be reversible in any sense worth claiming.
 */
export function jao7RollbackTarget(
  beforeIntegerA: number,
  beforeIntegerB: number | null,
): Jao7RehearsalTarget {
  return Object.freeze({ afterIntegerA: beforeIntegerA, afterIntegerB: beforeIntegerB });
}

/** Verify a rollback restored the captured state exactly. Same strictness, same reason. */
export function jao7VerifyRollback(
  restoredA: number | null,
  restoredB: number | null,
  beforeIntegerA: number,
  beforeIntegerB: number | null,
): boolean {
  return restoredA === beforeIntegerA && restoredB === beforeIntegerB;
}
