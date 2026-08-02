/**
 * The queue's public shapes (QFJ-P08, ADR-0081).
 *
 * Every result below is an OBSERVATION about durable records. None carries `status`, `pending`,
 * `approved`, `isAuthorized`, `canExecute` or `canSend`, and there is no field in which one could
 * be expressed. The model this package stores is:
 *
 *     a REQUEST exists; a DECISION may exist; a LINK between them may exist.
 *
 * "Active" is derived at an observation instant the CALLER supplies — the slot points at the
 * request, no link exists, and it has not expired — rather than stored as a column that would go
 * stale silently. Approval authority lives only in the immutable Core `ApprovalDecisionV1`.
 */
import type {
  ActionId,
  ApprovalDecisionV1,
  ApprovalLevel,
  ApprovalRequestId,
  ApprovalRequestV1,
  DecisionId,
  PolicyReference,
  RecommendationId,
  RiskClass,
  UtcTimestamp,
} from '@qf-jarvis/contracts';
import type { ApprovalDecisionCorrelation } from '@qf-jarvis/approval-runtime';
import type { RecommendationRuntimeResult } from '@qf-jarvis/recommendation-runtime';

/** What a caller supplies to durably enqueue one ask. Both values are treated as untrusted. */
export interface ApprovalQueueEnqueueInput {
  /** The recommendation runtime's result. Re-validated and re-fingerprinted before storage. */
  readonly source: RecommendationRuntimeResult;
  /** The request built by `@qf-jarvis/approval-runtime`. Re-proved against the source. */
  readonly request: ApprovalRequestV1;
}

/**
 * The outcome of an enqueue.
 *
 * `REPLAYED` is the crash-recovery case: the caller reissued a byte-identical ask, and the stored
 * original is returned unchanged with no second audit row and no slot movement. It is not a
 * failure, and it is not a new ask.
 */
export interface ApprovalQueueEnqueueResult {
  readonly outcome: 'CREATED' | 'REPLAYED';
  readonly request: ApprovalRequestV1;
}

/**
 * What a caller supplies to record a decision Core has ALREADY issued.
 *
 * `approvalRequestId` is required, and it is coordination metadata rather than part of the decision:
 * `ApprovalDecisionV1` deliberately carries no request id, because Core answers about a
 * recommendation's actions and not about Jarvis's bookkeeping. The contract is not altered to
 * accommodate this package.
 */
export interface ApprovalQueueRecordDecisionInput {
  readonly approvalRequestId: ApprovalRequestId;
  readonly decision: ApprovalDecisionV1;
}

/**
 * The outcome of recording a decision.
 *
 * `correlation` is the approval runtime's own observation, re-derived from the persisted source and
 * request — so it carries no authorization either, only what Core said about this exact action.
 */
export interface ApprovalQueueRecordDecisionResult {
  readonly outcome: 'CREATED' | 'REPLAYED';
  readonly correlation: ApprovalDecisionCorrelation;
}

/**
 * One outstanding ask, as an operator surface would list it.
 *
 * A minimal projection on purpose. The rationale, the evidence and the action's governed parameters
 * are NOT here: a queue listing is read far more often than it is acted on, and every field it
 * carries is a field that ends up in a log, a screenshot or a support ticket. Whoever needs the full
 * artifact reads the request.
 */
export interface ApprovalQueueActiveEntry {
  readonly approvalRequestId: ApprovalRequestId;
  readonly recommendationId: RecommendationId;
  readonly proposedActionId: ActionId;
  readonly createdAt: UtcTimestamp;
  readonly expiresAt: UtcTimestamp;
  readonly requestedAuthority: ApprovalLevel;
  readonly risk: RiskClass;
  readonly requestingAgent: string;
  readonly requestingAgentVersion: string;
  readonly summary: string;
  readonly policy: PolicyReference;
  readonly correlationId: string;
}

/** One stored ask, rebuilt and re-validated from durable evidence. */
export interface ApprovalQueueRequestRecord {
  readonly request: ApprovalRequestV1;
  /** The canonical source the ask was made about, exactly as it was stored. */
  readonly source: RecommendationRuntimeResult;
}

/** One content-free audit row. References only — no summary, policy, rationale or parameters. */
export interface ApprovalQueueAuditRecord {
  readonly sequence: number;
  readonly eventType: 'REQUEST_ENQUEUED' | 'REQUEST_EXPIRY_OBSERVED' | 'DECISION_LINKED';
  readonly approvalRequestId: ApprovalRequestId;
  readonly decisionId?: DecisionId;
  readonly recommendationId: RecommendationId;
  readonly proposedActionId: ActionId;
  readonly recordedAt: string;
}

/**
 * The durable approval queue.
 *
 * Seven methods, and none of them approves, decides, executes, sends or calls Core. There is no
 * `approve`, no `setStatus`, no slot mutator and no way to reach the pool or a raw row.
 *
 * No method reads a clock. `listActiveRequests` takes the observation instant from its caller, for
 * the same reason the contracts compare `expiresAt` against `createdAt` rather than against `now`:
 * an artifact that was valid when it was written must not become invalid because it was read later
 * by a machine whose clock disagrees.
 */
export interface PostgresApprovalQueue {
  /** Verify the storage contract before an application relies on it. Non-mutating. */
  assertReady(): Promise<void>;
  enqueueRequest(input: ApprovalQueueEnqueueInput): Promise<ApprovalQueueEnqueueResult>;
  readRequest(approvalRequestId: string): Promise<ApprovalQueueRequestRecord>;
  listActiveRequests(input: {
    readonly observedAt: UtcTimestamp;
    readonly limit: number;
  }): Promise<readonly ApprovalQueueActiveEntry[]>;
  recordDecision(
    input: ApprovalQueueRecordDecisionInput,
  ): Promise<ApprovalQueueRecordDecisionResult>;
  /** The correlated decision for one ask, re-proved from durable evidence. */
  readDecisionForRequest(approvalRequestId: string): Promise<ApprovalDecisionCorrelation>;
  readAuditForRequest(approvalRequestId: string): Promise<readonly ApprovalQueueAuditRecord[]>;
}
