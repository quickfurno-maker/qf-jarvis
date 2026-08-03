/**
 * The approval-evidence snapshot (QFJ-P09.01, ADR-0084).
 *
 * INTERNAL, and a security control rather than a convenience.
 *
 * ### The gap it closes
 *
 * Approval evidence is caller-controlled, and it is deliberately loosely typed at the boundary it
 * crosses: `approvalDecisionValidationInputSchema` declares `source: z.unknown()` because the
 * approval runtime validates it internally rather than re-declaring a contract
 * `@qf-jarvis/contracts` already owns. That is correct, and it has a consequence — a caller may pass
 * an object whose `recommendation` is an **accessor**, and an accessor can answer differently every
 * time it is asked.
 *
 * Validation here has two phases that both need the recommendation: the approval re-proof, and the
 * recovery of the approved action and the recommendation's expiry. Read the caller's value twice and
 * a hostile object can show:
 *
 *   - the FIRST read: the original content, whose fingerprint the approval request genuinely covers,
 *     so the re-proof succeeds honestly;
 *   - the SECOND read: a different, individually schema-valid recommendation with the same
 *     `recommendationId`, `approvedActionId` and `correlationId` but different action parameters or
 *     a later expiry.
 *
 * The execution intent is then compared against content nobody approved — which is precisely the
 * anti-substitution guarantee this package exists to provide, defeated by reading twice.
 *
 * ### The fix, stated as a property
 *
 * ONE detached snapshot is taken before the re-proof, and it feeds BOTH phases. After it is taken,
 * no production path reads the caller's value again, so there is no second read to disagree with the
 * first. An accessor is invoked exactly once, by the clone.
 *
 * ### Why `structuredClone`
 *
 * It produces a genuinely DETACHED value: every nested object is copied, so no reference into the
 * caller's graph survives and a later mutation of their object cannot change what was validated. It
 * also resolves accessors as it walks, so the result is plain data with no behaviour left in it.
 *
 * `JSON.parse(JSON.stringify(x))` would be the obvious alternative and is **not** used: it honours a
 * `toJSON` hook, so a hostile object could still choose what the snapshot sees; it silently drops
 * `undefined` members and coerces others; and a cyclic value throws a different error. A shallow
 * spread is worse still — it copies one level and leaves every nested object shared.
 *
 * It performs no I/O, reads no clock, and confers no authority: a snapshot of evidence is still just
 * evidence, and it is validated afterwards exactly as before.
 */
import { ExecutionIntentRuntimeError } from '../contracts/errors.js';

/**
 * Detach the caller's approval evidence into a stable value.
 *
 * Any failure — a function, a symbol, a cycle, a host object `structuredClone` refuses — is
 * normalized to `approval-invalid`. That is the honest code: evidence that cannot be safely
 * snapshotted is evidence this runtime cannot validate, and the thrown value is discarded rather
 * than inspected, because a clone error can name the offending property path.
 */
export function snapshotApprovalEvidence(value: unknown): unknown {
  try {
    return structuredClone(value);
  } catch {
    throw new ExecutionIntentRuntimeError('approval-invalid');
  }
}
