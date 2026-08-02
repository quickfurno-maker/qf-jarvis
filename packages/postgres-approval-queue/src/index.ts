/**
 * `@qf-jarvis/postgres-approval-queue` — the durable approval queue and audit (QFJ-P08, ADR-0081).
 *
 * QFJ-P08's approval-runtime slice made asking and correlating powerless and correct, but kept both
 * in memory: a request died with the process, and nothing prevented two overlapping asks about the
 * same action. This package supplies the durability, and exactly one coordination invariant.
 *
 * **The invariant.** `ApprovalDecisionV1` carries no `approvalRequestId` — deliberately, because
 * Core answers about a recommendation's actions, not about Jarvis's bookkeeping. Two unanswered
 * asks for the same (recommendation, action) would therefore make an arriving decision ambiguous
 * between them, with nothing in the artifacts able to resolve it. So at most ONE active ask per
 * action is enforced by a per-key row lock — no global lock, no advisory lock, no retry.
 *
 * **There is no local authority.** No `status`, no `pending`, no `approved`, no `isAuthorized`. A
 * request exists; a decision may exist; a link may exist. "Active" is derived at a caller-supplied
 * observation instant, never stored, because a stored `pending` goes stale silently — and a stale
 * `pending` in Jarvis is precisely the authorization state ADR-0002 puts in Core. Approval authority
 * lives only in the immutable `ApprovalDecisionV1`, stored verbatim and never reinterpreted.
 *
 * **Nothing here reimplements an approval semantic.** A stored ask is proved faithful by REBUILDING
 * it through the public `@qf-jarvis/approval-runtime` and comparing; a decision is correlated by
 * calling that runtime's `validateDecision` against the PERSISTED source — so the anti-substitution
 * fingerprint check survives storage, and a second definition of the rules cannot drift into a
 * storage adapter.
 *
 * It reads no clock, calls no Core, emits no event, evaluates no consent, and creates no execution
 * intent. Jarvis asks; QuickFurno Core decides.
 *
 * Three root runtime symbols. Every schema, statement, canonicalizer and readiness probe stays
 * internal, and the pool is never exposed.
 */
export {
  POSTGRES_APPROVAL_QUEUE_ERROR_CODES,
  PostgresApprovalQueueError,
} from './contracts/errors.js';
export type { PostgresApprovalQueueErrorCode } from './contracts/errors.js';

export { createPostgresApprovalQueue } from './adapter/create-queue.js';

export type {
  ApprovalQueueActiveEntry,
  ApprovalQueueAuditRecord,
  ApprovalQueueEnqueueInput,
  ApprovalQueueEnqueueResult,
  ApprovalQueueRecordDecisionInput,
  ApprovalQueueRecordDecisionResult,
  ApprovalQueueRequestRecord,
  PostgresApprovalQueue,
} from './contracts/api.js';
