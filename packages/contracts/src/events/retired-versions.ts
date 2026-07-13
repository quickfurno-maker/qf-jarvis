/**
 * **The retirement catalogue: canonical event versions that were withdrawn before they were ever used.**
 *
 * ### Why a catalogue rather than a deletion
 *
 * Version 1 of the 41 inherited events is **not ingestible**. It carried `detail` — an arbitrary
 * 500-character string — and `signals`, an open dictionary, and QuickFurno Core stores precise
 * client coordinates inside `leads.message`. Leaving it registered would have left the door it
 * opened standing open.
 *
 * But **deleting the fact that it existed is not the same as closing it.** A future reader asking
 * *"why does this catalogue start at version 2?"* deserves an answer that does not require a
 * `git log`. So the versions are retired **on the record**: what they were, why they went, and —
 * the part that makes the zero-length migration window honest rather than convenient — **how many
 * producers, consumers and persisted events there were.**
 *
 * The answer is zero, zero and zero. That is a measured fact (ADR-0025, Accepted), not a
 * convenient assumption, and it is written down here so it can be checked rather than believed.
 *
 * ### Git history is the schema. This is the traceability.
 *
 * The exact shape of a retired v1 schema lives in git history, where it belongs — a contracts
 * package that carries its own dead schemas around forever becomes a museum, and somebody
 * eventually wires the exhibits back up. **What lives here is the record that they existed, why
 * they were withdrawn, and what replaced them.**
 *
 * ### The two failure modes are different, and must stay different
 *
 * | Condition | Error category | What it means |
 * | --- | --- | --- |
 * | A **retired** version arrives | `unsupported_retired_version` | *We knew this version. We withdrew it, and here is why.* |
 * | An **unknown** version arrives | `unsupported_unknown_version` | *We have never heard of this version. The producer is ahead of us* |
 *
 * Collapsing them into one "unknown contract" error would lose the distinction at exactly the
 * moment it matters: a retired version is a **producer that must be upgraded**, and an unknown
 * version is a **consumer that must be upgraded**. Those are different pages, different people,
 * and different hours of the night.
 */

/** One withdrawn contract version, and the evidence that withdrawing it cost nobody anything. */
export interface RetiredEventVersion {
  readonly eventType: string;
  readonly retiredVersion: number;
  readonly replacementVersion: number;
  readonly retirementReason: string;
  /** Zero. Not "short". There was nobody to migrate. */
  readonly migrationWindow: 'zero';
  readonly producerCount: 0;
  readonly consumerCount: 0;
  readonly persistedEventCount: 0;
  readonly retiredBeforeLiveUse: true;
  readonly decisionReference: 'ADR-0026';
  readonly decisionStatus: 'pending-owner-acceptance';
}

/**
 * The reason, stated once. It is the same reason for all 41, because the exposure was structural
 * rather than incidental — every observation payload carried the same free-text field, and every
 * contract-bearing payload carried the same unguarded governance text.
 */
const RETIREMENT_REASON =
  'Version 1 permitted arbitrary free text (the `detail` field) and an open ' +
  '`Record<string, unknown>` dictionary (`signals`), and applied no deep content guard to the ' +
  'governance text inside embedded contracts. QuickFurno Core stores precise client coordinates ' +
  'inside leads.message, so a coordinate could have crossed the canonical boundary in a field ' +
  'nobody classified as sensitive. Superseded by version 2, which has no free-text field, no ' +
  'open dictionary, and a deep prohibited-content guard.';

/** The 41 inherited event families, all retired at version 1 and replaced at version 2. */
const RETIRED_EVENT_TYPES: readonly string[] = [
  // Architecture lifecycle
  'qf.recommendation.created',
  'qf.recommendation.lifecycle-state-recorded',
  'qf.approval.decision-recorded',
  'qf.execution.intent-issued',
  'qf.execution.result-recorded',
  'qf.communication.state-recorded',
  // Client journey
  'qf.client.requirement-completed',
  'qf.client.follow-up-due-detected',
  'qf.client.follow-up-completed',
  'qf.client.satisfaction-recorded',
  'qf.client.dissatisfaction-recorded',
  'qf.client.complaint-recorded',
  'qf.client.reassignment-requested',
  'qf.client.reassignment-authorized',
  'qf.client.reassignment-rejected',
  'qf.assignment.batch-created',
  'qf.assignment.batch-completed',
  'qf.client.additional-service-identified',
  'qf.client.additional-service-confirmed',
  'qf.client.additional-service-rejected',
  'qf.lead.linked-created',
  'qf.client.review-requested',
  'qf.client.lifecycle-closed',
  // Vendor journey
  'qf.vendor.registration-started',
  'qf.vendor.profile-completed',
  'qf.vendor.verification-requested',
  'qf.vendor.activated',
  'qf.vendor.inactivity-detected',
  'qf.vendor.performance-updated',
  'qf.vendor.package-readiness-changed',
  'qf.vendor.recharge-opportunity-detected',
  'qf.vendor.complaint-recorded',
  'qf.vendor.retention-risk-detected',
  'qf.vendor.winback-candidate-detected',
  // Governance, privacy, communication
  'qf.privacy.erasure-requested',
  'qf.privacy.erasure-recorded',
  'qf.policy.version-changed',
  'qf.communication.authorization-recorded',
  'qf.communication.result-recorded',
  'qf.communication.human-handoff-requested',
  'qf.communication.human-handoff-recorded',
];

/** The catalogue. One record per retired event family. */
export const RETIRED_EVENT_VERSIONS: readonly RetiredEventVersion[] = RETIRED_EVENT_TYPES.map(
  (eventType) => ({
    eventType,
    retiredVersion: 1,
    replacementVersion: 2,
    retirementReason: RETIREMENT_REASON,
    migrationWindow: 'zero',
    producerCount: 0,
    consumerCount: 0,
    persistedEventCount: 0,
    retiredBeforeLiveUse: true,
    decisionReference: 'ADR-0026',
    decisionStatus: 'pending-owner-acceptance',
  }),
);

const RETIRED_KEYS: ReadonlySet<string> = new Set(
  RETIRED_EVENT_VERSIONS.map((record) => `${record.eventType}@${String(record.retiredVersion)}`),
);

/** Was this `type@version` a contract we once had and deliberately withdrew? */
export function isRetiredCanonicalVersion(eventType: string, eventVersion: number): boolean {
  return RETIRED_KEYS.has(`${eventType}@${String(eventVersion)}`);
}

/** The retirement record for a withdrawn contract, if this is one. */
export function findRetiredVersion(
  eventType: string,
  eventVersion: number,
): RetiredEventVersion | undefined {
  return RETIRED_EVENT_VERSIONS.find(
    (record) => record.eventType === eventType && record.retiredVersion === eventVersion,
  );
}

/** The two ways a contract can be absent, kept distinct on purpose. */
export const UNSUPPORTED_RETIRED_VERSION = 'unsupported_retired_version';
export const UNSUPPORTED_UNKNOWN_VERSION = 'unsupported_unknown_version';
