/**
 * The JAO-3 memory policy: the guards, as pure functions (ADR-0117).
 *
 * ### Why these are functions and not comments in the adapter
 *
 * Every rule below is enforced INSIDE the adapter's transaction, on the row it just locked. But a
 * rule buried in a transaction is a rule only a database can test, and "expired investigations
 * cannot be resumed" should not require PostgreSQL to demonstrate. These are the real production
 * guards -- the adapter calls exactly these -- so the unit suite proves the actual enforcement
 * rather than a re-implementation of it in a fake.
 *
 * The database still gets the last word where atomicity matters: `UNIQUE (investigation_id,
 * revision)` and the compare-and-set `WHERE revision = $expected` are what make a rule true under
 * two concurrent writers, which no in-process check can be.
 *
 * ### Order is a decision, not an accident
 *
 * `assertWritable` reports SUPERSEDED before EXPIRED before COMPLETED, because an operator reading
 * a refusal deserves the most specific true reason: an investigation that was replaced should say
 * so, even if it also happens to have aged out since.
 *
 * Pure apart from one hash: no clock, no network, no filesystem, no environment, no storage. The
 * instant always arrives as a parameter.
 */
import { createHash } from 'node:crypto';

import {
  JAO3_STATUS_ACCEPTS_WRITES,
  Jao3MemoryError,
  jao3InstantSchema,
  type Jao3Instant,
  type Jao3Investigation,
} from './contracts.js';

/** The canonical instant for a millisecond value. Validated, so an impossible clock cannot leak in. */
export function jao3InstantFromMs(nowMs: number): Jao3Instant {
  if (!Number.isFinite(nowMs)) {
    throw new Jao3MemoryError('INPUT_INVALID');
  }
  const parsed = jao3InstantSchema.safeParse(new Date(nowMs).toISOString());
  if (!parsed.success) {
    throw new Jao3MemoryError('INPUT_INVALID');
  }
  return parsed.data;
}

/**
 * Has this investigation reached its expiry?
 *
 * "At or after" -- an investigation whose `expiresAt` is exactly now is expired. The boundary is
 * closed on purpose: an off-by-one that lets one more write through at the instant of expiry is a
 * rule that does not hold at the only moment anyone would test it.
 */
export function jao3HasExpired(investigation: Jao3Investigation, nowMs: number): boolean {
  return nowMs >= Date.parse(investigation.expiresAt);
}

/**
 * May this investigation be written to at all?
 *
 * ### Expiry is semantic, not cleanup
 *
 * There is no sweeper, no cron and no background job, and JAO-3 does not need one: expiry is a
 * refusal computed at the moment of use, from the persisted `expiresAt` and an injected instant.
 * The row stays exactly where it is -- expired records remain readable for audit, because deleting
 * the evidence of an investigation is not the same as ending it. Ambient operations belong to
 * JAO-5; inventing a timer here would be JAO-3 quietly taking that on.
 */
export function assertJao3Writable(investigation: Jao3Investigation, nowMs: number): void {
  if (investigation.status === 'SUPERSEDED') {
    throw new Jao3MemoryError('INVESTIGATION_SUPERSEDED');
  }
  if (investigation.status === 'EXPIRED') {
    throw new Jao3MemoryError('INVESTIGATION_EXPIRED');
  }
  // Clock-enforced: the row may still say OPEN and still be expired. The persisted status is what
  // the last writer knew; the instant is what is true now.
  if (jao3HasExpired(investigation, nowMs)) {
    throw new Jao3MemoryError('INVESTIGATION_EXPIRED');
  }
  if (!JAO3_STATUS_ACCEPTS_WRITES[investigation.status]) {
    throw new Jao3MemoryError('STATUS_NOT_RESUMABLE');
  }
}

/**
 * The compare-and-set token, checked in process against the row that was just locked.
 *
 * This is the FIRST of two mechanisms. It gives a sequential stale writer a precise answer without
 * a wasted UPDATE; the `WHERE revision = $expected` predicate in the write itself is the one that
 * holds under genuine concurrency. Neither is redundant: remove this and a stale caller learns of
 * the conflict only after attempting the write; remove the SQL predicate and two writers that
 * loaded simultaneously could both believe they were current.
 */
export function assertJao3ExpectedRevision(
  investigation: Jao3Investigation,
  expectedRevision: number,
): void {
  if (investigation.revision !== expectedRevision) {
    throw new Jao3MemoryError('REVISION_CONFLICT');
  }
}

/**
 * The identity binding, and the lesson JAO-2 paid for.
 *
 * Three relations, all enforced rather than assumed:
 *
 * - the row loaded must be the investigation that was asked for;
 * - the writing run must be the investigation's CURRENT run, so a run that was superseded by an
 *   explicit resume cannot keep appending to an investigation that has moved on;
 * - `rootRunId` never changes, and a caller asserting a different one is refused rather than
 *   reconciled.
 *
 * Nothing is normalised. A mismatch is invalid provenance, and writing a checkpoint under a run
 * that did not perform it is an audit trail that quietly lies.
 */
export function assertJao3IdentityBinding(
  investigation: Jao3Investigation,
  requested: { readonly investigationId: string; readonly runId: string },
): void {
  if (investigation.investigationId !== requested.investigationId) {
    throw new Jao3MemoryError('PERSISTED_STATE_INVALID');
  }
  if (investigation.currentRunId !== requested.runId) {
    throw new Jao3MemoryError('RUN_ID_MISMATCH');
  }
}

/** `rootRunId` is fixed at creation. A caller claiming otherwise is refused. */
export function assertJao3RootRunUnchanged(
  investigation: Jao3Investigation,
  claimedRootRunId: string,
): void {
  if (investigation.rootRunId !== claimedRootRunId) {
    throw new Jao3MemoryError('RUN_ID_MISMATCH');
  }
}

/**
 * The persisted budgets, checked against the PERSISTED ceiling.
 *
 * Read from the row, never from `JAO3_BUDGET_LIMITS`. A process that consulted today's constant
 * would silently re-grant whatever the current code allows, which is precisely the restart reset
 * these budgets exist to prevent.
 *
 * There is also nothing to widen: `resumeInvestigation` and the append operations take no budget
 * parameter at all, so raising a limit is not a thing a caller can express -- and the parse caps
 * every persisted field at the ceiling, so a row claiming more than JAO-3 ever grants is refused as
 * corrupt rather than honoured.
 */
export function assertJao3CheckpointBudget(investigation: Jao3Investigation): void {
  if (investigation.checkpointCount >= investigation.budget.maxCheckpoints) {
    throw new Jao3MemoryError('BUDGET_EXHAUSTED');
  }
}

export function assertJao3CorrectionBudget(investigation: Jao3Investigation): void {
  if (investigation.ownerCorrectionCount >= investigation.budget.maxOwnerCorrections) {
    throw new Jao3MemoryError('BUDGET_EXHAUSTED');
  }
}

export function assertJao3ResumeBudget(investigation: Jao3Investigation): void {
  if (investigation.resumeCount >= investigation.budget.maxResumeCount) {
    throw new Jao3MemoryError('BUDGET_EXHAUSTED');
  }
}

export function assertJao3EvidenceAndHypothesisBudget(
  investigation: Jao3Investigation,
  counts: { readonly evidenceRefs: number; readonly hypotheses: number },
): void {
  if (counts.evidenceRefs > investigation.budget.maxEvidenceRefsPerCheckpoint) {
    throw new Jao3MemoryError('BUDGET_EXHAUSTED');
  }
  if (counts.hypotheses > investigation.budget.maxHypothesesPerCheckpoint) {
    throw new Jao3MemoryError('BUDGET_EXHAUSTED');
  }
}

/** A replacement must be a different investigation. Superseding by yourself is a loop, not a move. */
export function assertJao3SupersessionTarget(
  investigation: Jao3Investigation,
  supersededByInvestigationId: string,
): void {
  if (investigation.investigationId === supersededByInvestigationId) {
    throw new Jao3MemoryError('SUPERSESSION_INVALID');
  }
}

/**
 * A digest of what a retryable write MEANS, for idempotency.
 *
 * ### Why a digest rather than storing the payload
 *
 * Because the payload is the thing JAO-3 is careful about. A replay table holding a copy of every
 * summary, hypothesis and correction statement would be a second, unbounded, unreviewed memory
 * store sitting beside the governed one -- and it would be the copy nobody remembered to check for
 * transcripts. Sixty-four hex characters answer the only question the replay table asks: is this
 * the same write, or a different one wearing the same operation id?
 *
 * The fields are serialised in a fixed order rather than by `JSON.stringify` over an object,
 * because key order is a property of how an object was built, and two callers assembling the same
 * semantic write in different orders must produce the same digest.
 */
export function jao3SemanticDigest(parts: readonly string[]): string {
  const hash = createHash('sha256');
  for (const part of parts) {
    // Length-prefixed. Without it, ['ab','c'] and ['a','bc'] would hash identically, and two
    // different corrections could be mistaken for a replay of one another.
    hash.update(String(part.length));
    hash.update(' ');
    hash.update(part);
    hash.update(' ');
  }
  return hash.digest('hex');
}
