/**
 * The JAO-5 ambient policy: the gates, as pure functions (ADR-0119).
 *
 * The split JAO-3 and JAO-4 use. Every rule here runs inside the adapter's claim transaction, on
 * the monitor row it has just locked -- and every rule here is a real production function a unit
 * test can call directly, so the suite proves the actual enforcement rather than a re-implementation
 * of it in a fake.
 *
 * ### Order is a decision, not an accident
 *
 * `assertJao5Claimable` reports KILLED before EXPIRED before QUIETED, because an operator reading a
 * refusal deserves the most specific true reason: a monitor somebody deliberately killed should say
 * so, even if it has also aged out since.
 *
 * Pure apart from one hash: no clock, no network, no filesystem, no environment, no storage. The
 * instant always arrives as a parameter.
 */
import { createHash } from 'node:crypto';

import {
  JAO5_STATUS_MAY_CLAIM,
  Jao5AmbientError,
  jao5InstantSchema,
  type Jao5Instant,
  type Jao5MonitorDefinition,
  type Jao5MonitorInstance,
} from './contracts.js';

/** The canonical instant for a millisecond value. Validated, so an impossible clock cannot leak in. */
export function jao5InstantFromMs(nowMs: number): Jao5Instant {
  if (!Number.isFinite(nowMs)) {
    throw new Jao5AmbientError('REQUEST_INVALID');
  }
  const parsed = jao5InstantSchema.safeParse(new Date(nowMs).toISOString());
  if (!parsed.success) {
    throw new Jao5AmbientError('REQUEST_INVALID');
  }
  return parsed.data;
}

/**
 * Has this enrollment reached its expiry?
 *
 * "At or after" -- an enrollment whose `expiresAt` is exactly now is expired. The boundary is closed
 * on purpose: an off-by-one that lets one more claim through at the instant of expiry is a rule that
 * does not hold at the only moment anyone would test it.
 */
export function jao5HasExpired(instance: Jao5MonitorInstance, nowMs: number): boolean {
  return nowMs >= Date.parse(instance.expiresAt);
}

/**
 * Is this monitor still quieted?
 *
 * At exactly `quietUntil` the monitor is eligible again -- the same closed-boundary reasoning, in
 * the other direction. Quiet is a pause, and a pause that never ends would be a kill switch nobody
 * declared.
 */
export function jao5IsQuieted(instance: Jao5MonitorInstance, nowMs: number): boolean {
  return instance.quietUntil !== null && nowMs < Date.parse(instance.quietUntil);
}

/**
 * May this monitor instance claim at all?
 *
 * ### Kill is terminal, and expiry needs no sweeper
 *
 * KILLED refuses forever: there is no unkill in this slice, so once the kill commits every future
 * claim stops. EXPIRED is computed at the moment of use from the persisted instant, so no cron, no
 * sweeper and no background job is required, and the row stays exactly where it is for audit.
 *
 * A persisted status is what the last writer knew; the instant is what is true now, which is why
 * both the stored status AND the clock comparison are checked.
 */
export function assertJao5Claimable(instance: Jao5MonitorInstance, nowMs: number): void {
  if (instance.status === 'KILLED' || instance.killedAt !== null) {
    throw new Jao5AmbientError('MONITOR_KILLED');
  }
  if (instance.status === 'EXPIRED') {
    throw new Jao5AmbientError('MONITOR_EXPIRED');
  }
  if (jao5HasExpired(instance, nowMs)) {
    // Clock-enforced: the row may still say ACTIVE and still be expired.
    throw new Jao5AmbientError('MONITOR_EXPIRED');
  }
  if (!JAO5_STATUS_MAY_CLAIM[instance.status]) {
    throw new Jao5AmbientError('MONITOR_NOT_ACTIVE');
  }
  if (jao5IsQuieted(instance, nowMs)) {
    throw new Jao5AmbientError('MONITOR_QUIETED');
  }
}

/**
 * The cadence slot for an instant.
 *
 * Deterministic and anchored to the ENROLLMENT, not to "last run plus cadence". A last-run offset
 * drifts every time a cycle is late and resets whatever the process last remembered; an anchored
 * slot is the same number on both sides of a restart, computed from two persisted values.
 */
export function jao5CadenceSlot(
  instance: Jao5MonitorInstance,
  cadenceSeconds: number,
  nowMs: number,
): number {
  const anchorMs = Date.parse(instance.enrolledAt);
  const elapsedSeconds = Math.floor((nowMs - anchorMs) / 1_000);
  if (elapsedSeconds < 0) {
    throw new Jao5AmbientError('TRIGGER_NOT_DUE');
  }
  return Math.floor(elapsedSeconds / cadenceSeconds);
}

/**
 * Which scheduled slot, if any, this monitor may claim now.
 *
 * ### Downtime must not become a catch-up storm
 *
 * If twenty cadence intervals were missed while the process was down, replaying twenty
 * investigations would mean twenty model calls the moment it comes back -- a self-inflicted burst
 * at exactly the point a system is least healthy. The first-proof rule is deliberate and blunt:
 * **at most ONE scheduled claim per monitor per ambient cycle, and it is the CURRENT slot.** Missed
 * slots are collapsed, not queued. Investigating the present is what an operator wants anyway; a
 * backlog of stale snapshots is not.
 *
 * Returns the slot to claim, or throws `TRIGGER_NOT_DUE`.
 */
export function jao5DueScheduledSlot(
  instance: Jao5MonitorInstance,
  definition: Jao5MonitorDefinition,
  nowMs: number,
): number {
  if (definition.cadenceSeconds === null) {
    throw new Jao5AmbientError('TRIGGER_NOT_DUE');
  }
  const slot = jao5CadenceSlot(instance, definition.cadenceSeconds, nowMs);
  if (instance.lastClaimedSlot !== null && slot <= instance.lastClaimedSlot) {
    // Already claimed this slot -- or a later one, which happens if the clock moved backwards.
    // Either way there is nothing new to investigate.
    throw new Jao5AmbientError('TRIGGER_NOT_DUE');
  }
  return slot;
}

/** The budget window an instant falls in. Epoch-aligned, so a restart lands in the same window. */
export function jao5BudgetWindowStart(nowMs: number, windowSeconds: number): number {
  const epochSeconds = Math.floor(nowMs / 1_000);
  return Math.floor(epochSeconds / windowSeconds) * windowSeconds;
}

/**
 * The budget, checked against what has already been claimed in this window.
 *
 * Read from the durable window row, never from process memory: usage held in a process is usage a
 * restart forgets, and a budget a restart resets is a budget an unstable system silently removes at
 * exactly the moment it matters most.
 */
export function assertJao5Budget(
  claimedInWindow: number,
  maxInvestigationsPerWindow: number,
): void {
  if (claimedInWindow >= maxInvestigationsPerWindow) {
    throw new Jao5AmbientError('BUDGET_EXHAUSTED');
  }
}

/**
 * The deduplication identity for a scheduled trigger.
 *
 * Monitor instance plus cadence slot, and nothing else. Not a process id, not an invocation
 * counter, not a timestamp -- all three differ on the far side of a restart, and a dedupe rule that
 * resets when the process does is not a dedupe rule.
 */
export function jao5ScheduledDedupeKey(monitorInstanceId: string, slot: number): string {
  return `slot:${monitorInstanceId}:${String(slot)}`;
}

/** The deduplication identity for an approved event: the instance and the event's own id. */
export function jao5EventDedupeKey(monitorInstanceId: string, eventId: string): string {
  return `event:${monitorInstanceId}:${eventId}`;
}

/**
 * The instant a monitor becomes eligible again after an investigation.
 *
 * Attention quiets longest: an operator who has been given something to look at should not be given
 * the same thing again fifteen minutes later. A refusal quiets briefly, because a failing
 * investigation that retries immediately is a loop. `NO_ANOMALY` adds nothing -- cadence and dedupe
 * already bound the rate, and quieting a healthy system would delay the first real signal.
 */
export function jao5QuietUntilMs(
  definition: Jao5MonitorDefinition,
  outcome: 'NO_ANOMALY' | 'ATTENTION_CREATED' | 'REFUSED',
  nowMs: number,
): number | null {
  const seconds =
    outcome === 'ATTENTION_CREATED'
      ? definition.quietingPolicy.quietAfterAttentionSeconds
      : outcome === 'REFUSED'
        ? definition.quietingPolicy.quietAfterFailureSeconds
        : definition.quietingPolicy.quietAfterNoAnomalySeconds;
  return seconds === 0 ? null : nowMs + seconds * 1_000;
}

/**
 * Bind an approved event to the monitor that is allowed to observe it.
 *
 * Type and scope are checked separately so the refusal says which one was wrong. Neither is
 * normalised: an event of the wrong type is not "close enough" to investigate.
 */
export function assertJao5EventMatches(
  definition: Jao5MonitorDefinition,
  event: { readonly eventType: string; readonly scope: string },
): void {
  if (definition.eventType !== event.eventType) {
    throw new Jao5AmbientError('EVENT_TYPE_MISMATCH');
  }
  if (definition.scope !== event.scope) {
    throw new Jao5AmbientError('EVENT_SCOPE_MISMATCH');
  }
}

/**
 * Bind the enrolled instance to the definition it was enrolled against.
 *
 * The JAO-2 and JAO-4 lesson. A definition edited after enrollment -- a widened budget, a shortened
 * quiet, a different owner -- would otherwise silently govern an instance that was never reviewed
 * against it. Comparing the digest makes the enrollment refuse rather than drift.
 */
export function assertJao5DefinitionBinding(
  instance: Jao5MonitorInstance,
  definition: Jao5MonitorDefinition,
  digestOf: (definition: Jao5MonitorDefinition) => string,
): void {
  if (instance.monitorId !== definition.monitorId) {
    throw new Jao5AmbientError('MONITOR_UNKNOWN');
  }
  // The version is not compared separately: both sides are the literal '1', so the comparison is
  // dead code TypeScript can already prove. The version IS part of the digest below, so a future
  // second version is covered by the comparison that actually runs.
  if (instance.definitionDigest !== digestOf(definition)) {
    throw new Jao5AmbientError('MONITOR_VERSION_MISMATCH');
  }
}

/** Compare-and-set on the monitor row. A stale writer loses rather than overwriting. */
export function assertJao5ExpectedRevision(
  instance: Jao5MonitorInstance,
  expectedRevision: number,
): void {
  if (instance.revision !== expectedRevision) {
    throw new Jao5AmbientError('REVISION_CONFLICT');
  }
}

/** Cancellation is checked before the claim, so a cancelled cycle claims and investigates nothing. */
export function assertJao5NotCancelled(signal?: AbortSignal): void {
  if (signal?.aborted === true) {
    throw new Jao5AmbientError('CANCELLED');
  }
}

/**
 * A digest of what a retryable operation MEANS, for idempotency.
 *
 * Only the digest is stored. Keeping the payload would put a second, unbounded copy of operation
 * inputs beside the governed record, and it would be the copy nobody remembered to review.
 * Length-prefixed so `['ab','c']` and `['a','bc']` are different operations.
 */
export function jao5SemanticDigest(parts: readonly string[]): string {
  const hash = createHash('sha256');
  for (const part of parts) {
    hash.update(`${String(part.length)}:${part};`);
  }
  return hash.digest('hex');
}
