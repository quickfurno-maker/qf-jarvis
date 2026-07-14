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

import { CANONICAL_EVENT_TYPES, type CanonicalEventType } from './event-catalog.js';
import { type CanonicalEvent, REGISTERED_EVENT_DEFINITIONS } from './canonical-events-v2.js';
import {
  findRetiredVersion,
  UNSUPPORTED_RETIRED_VERSION,
  UNSUPPORTED_UNKNOWN_VERSION,
} from './retired-versions.js';
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

/**
 * What each registered contract means, in one line.
 *
 * Keyed by event type, because the meaning of `qf.vendor.activated` does not change when its
 * payload version does — the *shape* changed, not the *fact*.
 */
const DESCRIPTIONS: Readonly<Record<CanonicalEventType, string>> = {
  'qf.recommendation.created':
    'QF Jarvis produced a recommendation and QuickFurno Core recorded it. The recommendation is inert.',
  'qf.recommendation.lifecycle-state-recorded':
    'A recommendation moved through its governed lifecycle. Recorded by Core.',
  'qf.approval.decision-recorded': 'A human or a named policy decided. Core recorded the decision.',
  'qf.execution.intent-issued':
    'QuickFurno Core authorized an action and issued an intent for n8n to execute. Only Core may issue one.',
  'qf.execution.result-recorded': 'n8n reported an outcome, and Core recorded it as authoritative.',
  'qf.communication.state-recorded': 'A communication reached one of the eighteen governed states.',

  'qf.client.requirement-completed': 'A client requirement is complete enough to act on.',
  'qf.client.follow-up-due-detected': 'A follow-up became due.',
  'qf.client.follow-up-completed': 'A follow-up was completed.',
  'qf.client.satisfaction-recorded': 'Client satisfaction was recorded.',
  'qf.client.dissatisfaction-recorded':
    'Client dissatisfaction was recorded. Evidence, never permission to reassign.',
  'qf.client.complaint-recorded': 'A client complaint was recorded.',
  'qf.client.reassignment-requested':
    'A reassignment was requested, carrying the explicit client confirmation that permits one.',
  'qf.client.reassignment-authorized': 'Core authorized a reassignment.',
  'qf.client.reassignment-rejected': 'Core rejected a reassignment.',
  'qf.assignment.batch-created':
    'Core created an assignment batch. At most three vendors, and only Core may create one.',
  'qf.assignment.batch-completed': 'An assignment batch completed.',
  'qf.client.additional-service-identified': 'An additional service need was identified.',
  'qf.client.additional-service-confirmed':
    'The client explicitly confirmed an additional service.',
  'qf.client.additional-service-rejected': 'An additional service was rejected.',
  'qf.lead.linked-created':
    'A different category became a separate linked lead, with its own consent, verification and cap.',
  'qf.client.review-requested': 'A review was requested from the client.',
  'qf.client.lifecycle-closed': 'The client lifecycle closed.',

  'qf.vendor.registration-started': 'A vendor began registering.',
  'qf.vendor.profile-completed': 'A vendor profile reached completeness.',
  'qf.vendor.verification-requested': 'Vendor verification was requested.',
  'qf.vendor.activated': 'Core activated a vendor. Only Core may.',
  'qf.vendor.inactivity-detected': 'A vendor has gone inactive.',
  'qf.vendor.performance-updated': 'Vendor performance changed. A band, never a score to act on.',
  'qf.vendor.package-readiness-changed': 'Package readiness changed. A band, never a balance.',
  'qf.vendor.recharge-opportunity-detected':
    'A recharge conversation is warranted. A band, never a balance, and never a transaction.',
  'qf.vendor.complaint-recorded': 'A complaint about or from a vendor was recorded.',
  'qf.vendor.retention-risk-detected': 'A vendor is at risk of leaving.',
  'qf.vendor.winback-candidate-detected': 'A departed vendor is a win-back candidate.',

  'qf.privacy.erasure-requested': 'An erasure was requested.',
  'qf.privacy.erasure-recorded': 'An erasure was carried out and recorded.',
  'qf.policy.version-changed': 'A governed policy version changed.',
  'qf.communication.authorization-recorded':
    'The QuickFurno Communication Core authorized, or refused, a communication.',
  'qf.communication.result-recorded': 'A communication result was recorded by Core.',
  'qf.communication.human-handoff-requested': 'A conversation must reach a human.',
  'qf.communication.human-handoff-recorded': 'A human took over a conversation.',

  'qf.taxonomy.city-created': 'Core created a city. Jarvis is told; Jarvis never decides.',
  'qf.taxonomy.city-updated': 'Core updated a city. The id is permanent; the label is not.',
  'qf.taxonomy.city-deactivated': 'Core deactivated a city.',
  'qf.taxonomy.category-created': 'Core created a category.',
  'qf.taxonomy.category-updated': 'Core updated a category. The id is permanent; the label is not.',
  'qf.taxonomy.category-deactivated': 'Core deactivated a category.',
  'qf.taxonomy.subcategory-created': 'Core created a subcategory under a parent category.',
  'qf.taxonomy.subcategory-moved':
    'Core moved a subcategory to a different parent. Its meaning changed while its id did not.',
  'qf.taxonomy.subcategory-updated': 'Core updated a subcategory.',
  'qf.taxonomy.subcategory-deactivated': 'Core deactivated a subcategory.',
  'qf.taxonomy.version-published':
    'Core published a taxonomy version. Without it, the ids in other events have no meaning.',
};

/**
 * The registered contracts, built from `REGISTERED_EVENT_DEFINITIONS`.
 *
 * Built from the definitions rather than restated beside them, so "what is defined" and "what is
 * registered" cannot drift apart. A drift here shows up as an event that exists in source and
 * cannot be parsed — or, far worse, one that parses and was never reviewed.
 */
const ENTRIES: readonly CanonicalEventRegistryEntry[] = REGISTERED_EVENT_DEFINITIONS.map(
  ([eventType, eventVersion, schema]) =>
    defineEntry(
      eventType,
      eventVersion,
      DESCRIPTIONS[eventType],
      schema as unknown as z.ZodType<CanonicalEvent>,
    ),
);

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
    /**
     * **A retired version and an unknown version are different failures, and stay different.**
     *
     * A **retired** version is a contract we had, and withdrew, and can explain — the producer is
     * behind us and must be upgraded. An **unknown** version is a contract we have never seen —
     * the producer is *ahead* of us, and the consumer must be upgraded.
     *
     * Collapsing them into one "unknown contract" loses the distinction at exactly the moment it
     * decides who gets paged. Neither one ever falls back to the other version, and neither is
     * guessed at.
     */
    const retired = findRetiredVersion(head.data.eventType, head.data.eventVersion);

    if (retired !== undefined) {
      return contractFailure(CONTRACT_NAME, [
        {
          path: 'eventVersion',
          code: UNSUPPORTED_RETIRED_VERSION,
          message:
            `Canonical event contract "${key}" is RETIRED and is no longer ingestible. ` +
            `It was superseded by version ${String(retired.replacementVersion)}. ` +
            `${retired.retirementReason} ` +
            `Retirement is recorded in the retirement catalogue (${retired.decisionReference}); ` +
            `a retired version is refused, never parsed by a later contract that never checked it.`,
        },
      ]);
    }

    return contractFailure(CONTRACT_NAME, [
      {
        path: 'eventType',
        code: UNSUPPORTED_UNKNOWN_VERSION,
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
