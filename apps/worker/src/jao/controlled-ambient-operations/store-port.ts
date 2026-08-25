/**
 * The JAO-5 ambient monitor store port (ADR-0119).
 *
 * ### Narrow, semantic, and split around the investigation
 *
 * The shape that matters most is `claimAmbientRun` / `finalizeAmbientRun` being two operations
 * rather than one. A single "run the monitor" method would have to hold a database transaction
 * across JAO-1's capability read and its model call -- a row lock held across network inference,
 * which is how a slow provider becomes a stalled database. So the claim commits first, the
 * investigation runs outside any transaction, and finalize records what happened.
 *
 * There is deliberately no `query`, `execute`, `raw` or row type on this surface, no `clearAll`,
 * `reset`, `deleteMonitor` or `prune` -- expired and killed instances stay for audit -- and no
 * `unkill`, because a kill switch that can be cleared by whatever is still running is not one.
 *
 * ### Why the port exists with one implementation
 *
 * For the unit suite, and for the statement it makes in types a compiler checks: durability is
 * somebody's job. A future implementation must satisfy the same relations, and the memory format
 * is defined here rather than by whatever happens to be storing it.
 */
import type {
  Jao5AmbientOutcome,
  Jao5AmbientRunRecord,
  Jao5EnrollMonitorInput,
  Jao5KillMonitorInput,
  Jao5MonitorInstance,
  Jao5OperationResult,
  Jao5RefusalReason,
  Jao5TriggerType,
} from './contracts.js';

/**
 * What the claim transaction was asked to establish.
 *
 * The definition-derived bounds travel WITH the request rather than being looked up inside the
 * store, so the gates can be re-checked under the row lock without the persistence layer needing
 * to know what a monitor registry is. `definitionDigest` is what binds the claim to the exact
 * definition the caller evaluated -- a definition edited between evaluation and claim no longer
 * matches, and the claim fails closed rather than proceeding under bounds nobody reviewed.
 */
export interface Jao5ClaimRequest {
  readonly monitorInstanceId: string;
  readonly ambientRunId: string;
  readonly jao1RunId: string;
  readonly cycleRunId: string;
  readonly triggerKind: Jao5TriggerType;
  readonly triggerRef: string;
  readonly dedupeKey: string;
  readonly scheduledSlot: number | null;
  readonly eventId: string | null;
  readonly definitionDigest: string;
  readonly budgetWindowSeconds: number;
  readonly maxInvestigationsPerWindow: number;
}

/** What a successful claim durably established, before any investigation ran. */
export interface Jao5Claim {
  readonly ambientRunId: string;
  readonly monitorInstanceId: string;
  readonly monitorId: string;
  readonly monitorVersion: '1';
  readonly triggerKind: Jao5TriggerType;
  readonly triggerRef: string;
  readonly dedupeKey: string;
  /** The revision the monitor instance committed at when the claim was taken. Immutable. */
  readonly committedRevision: number;
}

/** What finalize records. Closed metadata only -- never an attention body or a snapshot. */
export interface Jao5FinalizeRequest {
  readonly ambientRunId: string;
  readonly outcome: Jao5AmbientOutcome;
  readonly refusalCode: Jao5RefusalReason | null;
  readonly attentionPresent: boolean;
  readonly capabilityCalls: number;
  readonly modelCalls: number;
  /** The instant the monitor becomes eligible again, from its own quieting policy. */
  readonly quietUntilMs: number | null;
}

/**
 * The durable ambient monitor store.
 *
 * `nowMs` is a parameter on every operation rather than read inside: the store holds no clock, so
 * schedule, expiry and quieting decisions are reproducible and a test can move time exactly.
 */
export interface Jao5AmbientStore {
  /**
   * Enroll a monitor instance in SHADOW mode. Idempotent by `operationId`.
   *
   * Enrollment is what makes a static definition operable, and it expires -- an enrollment with no
   * horizon is a monitor nobody has to review again.
   */
  enrollMonitor(
    input: Jao5EnrollMonitorInput,
    definitionDigest: string,
    ownerId: string,
    nowMs: number,
  ): Promise<Jao5OperationResult>;

  /** The instance, or `MONITOR_NOT_ENROLLED`. Never reports absence for uncertainty. */
  readMonitorInstance(monitorInstanceId: string): Promise<Jao5MonitorInstance>;

  /**
   * Kill terminally. Idempotent by `operationId`, compare-and-set on `expectedRevision`.
   *
   * There is no counterpart. Reactivation means enrolling a NEW instance, which is an explicit
   * auditable act rather than a state transition a stale process can race.
   */
  killMonitor(input: Jao5KillMonitorInput, nowMs: number): Promise<Jao5OperationResult>;

  /**
   * PHASE A. Take a durable claim, or refuse -- all inside ONE transaction that locks the monitor
   * row, checks every gate, reserves one budget unit, advances the schedule and inserts the run.
   *
   * Returns before any investigation starts, so the claim is durable the moment external work
   * could begin.
   */
  claimAmbientRun(request: Jao5ClaimRequest, nowMs: number): Promise<Jao5Claim>;

  /**
   * PHASE C. Record what happened, exactly once, and apply the quieting policy.
   *
   * Refuses `CLAIM_ALREADY_FINALIZED` rather than overwriting: a finalized run is a fact about
   * something that already happened, and rewriting it would make the audit trail a draft.
   */
  finalizeAmbientRun(request: Jao5FinalizeRequest, nowMs: number): Promise<void>;

  /** Read-only, for proving durability across a restart. */
  countClaimedInWindow(monitorInstanceId: string, windowStartEpoch: number): Promise<number>;

  /**
   * Read-only run history for one instance, oldest first. Governance metadata only.
   *
   * Every row is decoded STRICTLY: a durable value outside the closed vocabulary is a
   * `STORE_FAILED` refusal, never a plausible substitute. The persisted refusal code is preserved.
   */
  listAmbientRuns(monitorInstanceId: string): Promise<readonly Jao5AmbientRunRecord[]>;
}
