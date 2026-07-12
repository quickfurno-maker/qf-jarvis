/**
 * The canonical event registry.
 *
 * ### Static, and reviewable in source control
 *
 * The registry is a frozen map built at module load from the catalog above it.
 * There is **no `register()` function**, and that is deliberate: a registry that
 * accepts schemas at runtime is a registry an attacker — or a careless caller —
 * can teach to accept a payload nobody reviewed. Adding an event type here is a
 * code change, which means a diff, which means a reviewer. That is the whole
 * mechanism.
 *
 * ### Unknown type or version fails closed
 *
 * `type + version` identifies exactly one contract. Anything else is refused:
 *
 * - An **unknown event type** is rejected, not ignored and not "handled generically".
 * - An **unknown version** is rejected. In particular, **a future version does not
 *   fall back to v1.** If Core one day emits `qf.approval.decision-recorded` at
 *   version 2, this code does not quietly parse it as a v1 and drop the fields it
 *   does not recognize — because the fields it does not recognize are precisely the
 *   ones that changed. "An unknown version is rejected, never guessed at."
 *
 * - There is **no automatic upgrade** and no coercion. When migrations arrive they
 *   will be explicit functions with names, not a parser being clever. Phase 2 needs
 *   none, because only version 1 exists.
 */

import { z } from 'zod';

import {
  approvalDecisionRecordedEventV1Schema,
  assignmentBatchCompletedEventV1Schema,
  assignmentBatchCreatedEventV1Schema,
  CANONICAL_EVENT_TYPES,
  type CanonicalEvent,
  type CanonicalEventType,
  clientAdditionalServiceConfirmedEventV1Schema,
  clientAdditionalServiceIdentifiedEventV1Schema,
  clientAdditionalServiceRejectedEventV1Schema,
  clientComplaintRecordedEventV1Schema,
  clientDissatisfactionRecordedEventV1Schema,
  clientFollowUpCompletedEventV1Schema,
  clientFollowUpDueDetectedEventV1Schema,
  clientLifecycleClosedEventV1Schema,
  clientReassignmentAuthorizedEventV1Schema,
  clientReassignmentRejectedEventV1Schema,
  clientReassignmentRequestedEventV1Schema,
  clientRequirementCompletedEventV1Schema,
  clientReviewRequestedEventV1Schema,
  clientSatisfactionRecordedEventV1Schema,
  communicationAuthorizationRecordedEventV1Schema,
  communicationHumanHandoffRecordedEventV1Schema,
  communicationHumanHandoffRequestedEventV1Schema,
  communicationResultRecordedEventV1Schema,
  communicationStateRecordedEventV1Schema,
  executionIntentIssuedEventV1Schema,
  executionResultRecordedEventV1Schema,
  leadLinkedCreatedEventV1Schema,
  policyVersionChangedEventV1Schema,
  privacyErasureRecordedEventV1Schema,
  privacyErasureRequestedEventV1Schema,
  recommendationCreatedEventV1Schema,
  recommendationLifecycleStateRecordedEventV1Schema,
  vendorActivatedEventV1Schema,
  vendorComplaintRecordedEventV1Schema,
  vendorInactivityDetectedEventV1Schema,
  vendorPackageReadinessChangedEventV1Schema,
  vendorPerformanceUpdatedEventV1Schema,
  vendorProfileCompletedEventV1Schema,
  vendorRechargeOpportunityDetectedEventV1Schema,
  vendorRegistrationStartedEventV1Schema,
  vendorRetentionRiskDetectedEventV1Schema,
  vendorVerificationRequestedEventV1Schema,
  vendorWinbackCandidateDetectedEventV1Schema,
} from './event-catalog.js';
import {
  contractFailure,
  type ContractResult,
  ContractValidationError,
  toContractIssues,
  toContractResult,
} from '../validation.js';

/** One registered contract: a type, a version, and the schema that defines it. */
export interface CanonicalEventRegistryEntry {
  readonly eventType: CanonicalEventType;
  readonly eventVersion: number;
  readonly description: string;
  /** Parse an input as *this* contract. */
  readonly safeParse: (input: unknown) => ContractResult<CanonicalEvent>;
}

/**
 * `type@version` — the identity of a contract.
 *
 * Exported because consumers, fixtures, and tests all need to agree on it, and a
 * key format invented twice is a key format that disagrees once.
 */
export function canonicalEventKey(eventType: string, eventVersion: number): string {
  return `${eventType}@${String(eventVersion)}`;
}

/**
 * Build an entry. The generic keeps each schema's precise type at the call site
 * while widening the parsed result to the union — with no type assertion.
 */
function defineEntry<T extends CanonicalEvent>(
  eventType: CanonicalEventType,
  eventVersion: number,
  description: string,
  schema: z.ZodType<T>,
): CanonicalEventRegistryEntry {
  return {
    eventType,
    eventVersion,
    description,
    safeParse: (input: unknown): ContractResult<CanonicalEvent> =>
      toContractResult(canonicalEventKey(eventType, eventVersion), schema.safeParse(input)),
  };
}

const ENTRIES: readonly CanonicalEventRegistryEntry[] = [
  defineEntry(
    'qf.recommendation.created',
    1,
    'QF Jarvis produced a recommendation and QuickFurno Core recorded it. The recommendation is inert.',
    recommendationCreatedEventV1Schema,
  ),
  defineEntry(
    'qf.recommendation.lifecycle-state-recorded',
    1,
    'A recommendation moved to a new lifecycle state.',
    recommendationLifecycleStateRecordedEventV1Schema,
  ),
  defineEntry(
    'qf.approval.decision-recorded',
    1,
    'QuickFurno Core recorded an authoritative approval decision.',
    approvalDecisionRecordedEventV1Schema,
  ),
  defineEntry(
    'qf.execution.intent-issued',
    1,
    'QuickFurno Core issued a bounded, expiring execution intent to n8n.',
    executionIntentIssuedEventV1Schema,
  ),
  defineEntry(
    'qf.execution.result-recorded',
    1,
    'QuickFurno Core recorded an execution result reported by n8n or the QF Communications Runtime.',
    executionResultRecordedEventV1Schema,
  ),
  defineEntry(
    'qf.communication.state-recorded',
    1,
    'A governed communication moved to a new lifecycle state.',
    communicationStateRecordedEventV1Schema,
  ),

  // --- Target: the client journey and vendor assignment -------------------
  // Target contracts. QuickFurno Core does not emit these today; establishing the
  // emitters is Phase 11's work, and an adapter absorbs any difference.

  defineEntry(
    'qf.client.requirement-completed',
    1,
    'A client finished stating what they need.',
    clientRequirementCompletedEventV1Schema,
  ),
  defineEntry(
    'qf.client.follow-up-due-detected',
    1,
    'Something detected that a client follow-up had fallen due.',
    clientFollowUpDueDetectedEventV1Schema,
  ),
  defineEntry(
    'qf.client.follow-up-completed',
    1,
    'A client follow-up happened.',
    clientFollowUpCompletedEventV1Schema,
  ),
  defineEntry(
    'qf.client.satisfaction-recorded',
    1,
    'A client said they were satisfied.',
    clientSatisfactionRecordedEventV1Schema,
  ),
  defineEntry(
    'qf.client.dissatisfaction-recorded',
    1,
    'A client said they were dissatisfied. Evidence for a reassignment request — not a reassignment.',
    clientDissatisfactionRecordedEventV1Schema,
  ),
  defineEntry(
    'qf.client.complaint-recorded',
    1,
    'A formal client complaint was recorded.',
    clientComplaintRecordedEventV1Schema,
  ),
  defineEntry(
    'qf.client.reassignment-requested',
    1,
    'QF Jarvis asked QuickFurno Core to reassign, carrying the client’s explicit confirmation. It authorizes nothing.',
    clientReassignmentRequestedEventV1Schema,
  ),
  defineEntry(
    'qf.client.reassignment-authorized',
    1,
    'QuickFurno Core authorized a replacement batch. This event is the authorization becoming real.',
    clientReassignmentAuthorizedEventV1Schema,
  ),
  defineEntry(
    'qf.client.reassignment-rejected',
    1,
    'QuickFurno Core refused a reassignment.',
    clientReassignmentRejectedEventV1Schema,
  ),
  defineEntry(
    'qf.assignment.batch-created',
    1,
    'QuickFurno Core created an assignment batch of at most three vendors.',
    assignmentBatchCreatedEventV1Schema,
  ),
  defineEntry(
    'qf.assignment.batch-completed',
    1,
    'An assignment batch ran its course.',
    assignmentBatchCompletedEventV1Schema,
  ),
  defineEntry(
    'qf.client.additional-service-identified',
    1,
    'A specialist noticed the client may also want something in another category. A signal, not a conclusion.',
    clientAdditionalServiceIdentifiedEventV1Schema,
  ),
  defineEntry(
    'qf.client.additional-service-confirmed',
    1,
    'The client explicitly confirmed they want an additional service in another category.',
    clientAdditionalServiceConfirmedEventV1Schema,
  ),
  defineEntry(
    'qf.client.additional-service-rejected',
    1,
    'The client declined a proposed additional service.',
    clientAdditionalServiceRejectedEventV1Schema,
  ),
  defineEntry(
    'qf.lead.linked-created',
    1,
    'QuickFurno Core created a separate linked lead for a new category, with its own identity, consent, verification, scoring and matching.',
    leadLinkedCreatedEventV1Schema,
  ),
  defineEntry(
    'qf.client.review-requested',
    1,
    'A review was requested from the client.',
    clientReviewRequestedEventV1Schema,
  ),
  defineEntry(
    'qf.client.lifecycle-closed',
    1,
    'A client lead-category journey ended.',
    clientLifecycleClosedEventV1Schema,
  ),

  // --- Target: the vendor journey -----------------------------------------

  defineEntry(
    'qf.vendor.registration-started',
    1,
    'A vendor began registering.',
    vendorRegistrationStartedEventV1Schema,
  ),
  defineEntry(
    'qf.vendor.profile-completed',
    1,
    'A vendor completed their profile.',
    vendorProfileCompletedEventV1Schema,
  ),
  defineEntry(
    'qf.vendor.verification-requested',
    1,
    'QuickFurno Core recorded that a vendor verification was requested. Jarvis does not verify.',
    vendorVerificationRequestedEventV1Schema,
  ),
  defineEntry(
    'qf.vendor.activated',
    1,
    'QuickFurno Core activated a vendor. Jarvis does not activate.',
    vendorActivatedEventV1Schema,
  ),
  defineEntry(
    'qf.vendor.inactivity-detected',
    1,
    'A vendor has gone inactive.',
    vendorInactivityDetectedEventV1Schema,
  ),
  defineEntry(
    'qf.vendor.performance-updated',
    1,
    'A vendor’s performance band changed. A band, never a rank — ranking is Core’s.',
    vendorPerformanceUpdatedEventV1Schema,
  ),
  defineEntry(
    'qf.vendor.package-readiness-changed',
    1,
    'A vendor’s package readiness band changed. No amounts, no credits, no money.',
    vendorPackageReadinessChangedEventV1Schema,
  ),
  defineEntry(
    'qf.vendor.recharge-opportunity-detected',
    1,
    'A recharge conversation may be worth having. A band, never a balance.',
    vendorRechargeOpportunityDetectedEventV1Schema,
  ),
  defineEntry(
    'qf.vendor.complaint-recorded',
    1,
    'A vendor complaint was recorded.',
    vendorComplaintRecordedEventV1Schema,
  ),
  defineEntry(
    'qf.vendor.retention-risk-detected',
    1,
    'A vendor may be about to leave.',
    vendorRetentionRiskDetectedEventV1Schema,
  ),
  defineEntry(
    'qf.vendor.winback-candidate-detected',
    1,
    'A departed vendor may be worth approaching again.',
    vendorWinbackCandidateDetectedEventV1Schema,
  ),

  // --- Target: governance, privacy, and communication authority -----------

  defineEntry(
    'qf.privacy.erasure-requested',
    1,
    'Somebody exercised a deletion or anonymisation right. The obligation starts here.',
    privacyErasureRequestedEventV1Schema,
  ),
  defineEntry(
    'qf.privacy.erasure-recorded',
    1,
    'QuickFurno Core recorded how far an erasure actually got, including which scopes remain outstanding.',
    privacyErasureRecordedEventV1Schema,
  ),
  defineEntry(
    'qf.policy.version-changed',
    1,
    'A governing policy changed. Every policyVersion recorded elsewhere resolves against this.',
    policyVersionChangedEventV1Schema,
  ),
  defineEntry(
    'qf.communication.authorization-recorded',
    1,
    'The QuickFurno Communication Core decided whether a communication may happen. A rejection carries why — including an opt-out.',
    communicationAuthorizationRecordedEventV1Schema,
  ),
  defineEntry(
    'qf.communication.result-recorded',
    1,
    'QuickFurno Core recorded what happened to a communication. Provider-accepted is not delivered; indeterminate is not success.',
    communicationResultRecordedEventV1Schema,
  ),
  defineEntry(
    'qf.communication.human-handoff-requested',
    1,
    'A machine asked for a person. It has not got one yet.',
    communicationHumanHandoffRequestedEventV1Schema,
  ),
  defineEntry(
    'qf.communication.human-handoff-recorded',
    1,
    'A person actually picked up a handed-off communication.',
    communicationHumanHandoffRecordedEventV1Schema,
  ),
];

/**
 * A registry that genuinely cannot be added to.
 *
 * Note that a `ReadonlyMap<K, V>` would **not** be enough. `ReadonlyMap` is a
 * compile-time view over a real `Map`, and a `Map` still has `.set()` at runtime —
 * so any holder of the reference could teach the parser to accept a new shape,
 * with no diff and no reviewer. `Object.freeze` does not help either: a Map stores
 * its entries in internal slots that freezing does not touch.
 *
 * So the backing map is closed over and never handed out. What is exported has no
 * mutator to call — not because the type hides it, but because it does not exist.
 */
export interface CanonicalEventRegistry {
  get(key: string): CanonicalEventRegistryEntry | undefined;
  has(key: string): boolean;
  keys(): readonly string[];
  readonly size: number;
}

function createRegistry(entries: readonly CanonicalEventRegistryEntry[]): CanonicalEventRegistry {
  const backing = new Map(
    entries.map((entry) => [canonicalEventKey(entry.eventType, entry.eventVersion), entry]),
  );

  return Object.freeze({
    get: (key: string): CanonicalEventRegistryEntry | undefined => backing.get(key),
    has: (key: string): boolean => backing.has(key),
    keys: (): readonly string[] => [...backing.keys()],
    size: backing.size,
  });
}

/** The registry. Static, closed, and reviewable in source control. */
export const CANONICAL_EVENT_REGISTRY: CanonicalEventRegistry = createRegistry(ENTRIES);

/** Every registered contract, for documentation, coverage checks, and tests. */
export const CANONICAL_EVENT_ENTRIES: readonly CanonicalEventRegistryEntry[] = ENTRIES;

/** The head of an envelope: just enough to find the contract that defines the rest. */
const eventHeadSchema = z.object({
  eventType: z.string(),
  eventVersion: z.number(),
});

const CONTRACT_NAME = 'CanonicalEvent';

/**
 * Parse a canonical event: find its contract by `type + version`, then validate
 * against exactly that contract.
 *
 * Fails closed on an unknown type or version. Never falls back to another version.
 */
export function safeParseCanonicalEvent(input: unknown): ContractResult<CanonicalEvent> {
  const head = eventHeadSchema.safeParse(input);
  if (!head.success) {
    // The envelope does not even carry a type and a version, so there is no
    // contract to dispatch to. Fail here rather than guessing at one.
    return contractFailure(CONTRACT_NAME, toContractIssues(head.error));
  }

  const key = canonicalEventKey(head.data.eventType, head.data.eventVersion);
  const entry = CANONICAL_EVENT_REGISTRY.get(key);

  if (entry === undefined) {
    return contractFailure(CONTRACT_NAME, [
      {
        path: 'eventType',
        code: 'unknown_contract',
        message:
          `No registered canonical event contract for "${key}". ` +
          `Unknown types and versions are rejected, never guessed at, and a future version never falls back to an earlier one. ` +
          `Registered types: ${CANONICAL_EVENT_TYPES.join(', ')}.`,
      },
    ]);
  }

  return entry.safeParse(input);
}

/** Parse a canonical event, or throw a `ContractValidationError`. */
export function parseCanonicalEvent(input: unknown): CanonicalEvent {
  const result = safeParseCanonicalEvent(input);
  if (!result.success) {
    throw result.error;
  }
  return result.data;
}

/** True when `type + version` names a contract this build knows. */
export function isRegisteredCanonicalEvent(eventType: string, eventVersion: number): boolean {
  return CANONICAL_EVENT_REGISTRY.has(canonicalEventKey(eventType, eventVersion));
}

export { ContractValidationError };
