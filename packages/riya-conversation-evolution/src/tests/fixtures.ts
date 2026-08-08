/**
 * Deterministic fixtures for the evolution specs (RWC-P4A).
 *
 * Not a test file, and excluded from the emitting build. Everything is synthetic: no real client,
 * no real city, no real budget, and nothing that resembles a person's words.
 */
import type { DiscoveryField } from '@qf-jarvis/riya-agent';
import { createRiyaConversationContinuityState } from '@qf-jarvis/riya-conversation-continuity';
import type {
  RiyaConversationContinuityStateV1,
  RiyaConversationPhase,
  RiyaFieldProvenance,
} from '@qf-jarvis/riya-conversation-continuity';

import { createRiyaConversationObservationBatch } from '../contracts/observation.js';
import type {
  RiyaConversationObservationBatchV1,
  RiyaDiscoveryObservationV1,
} from '../contracts/observation.js';

/** Which `NeedDiscovery` value key a discovery field names. Restated so fixtures stay readable. */
export const VALUE_KEY = {
  serviceInterest: 'serviceInterestRef',
  location: 'locationRef',
  propertyType: 'propertyTypeRef',
  scope: 'scopeSummary',
  budget: 'budgetNote',
  timeline: 'timelineNote',
  consultationPreference: 'consultationPreferenceRef',
} as const satisfies Readonly<Record<DiscoveryField, string>>;

/** A synthetic value for a field. Opaque refs stay ref-shaped; notes stay short prose. */
export function synthetic(field: DiscoveryField, tag = 'a'): string {
  switch (field) {
    case 'serviceInterest':
      return `svc.${tag}`;
    case 'location':
      return `loc.${tag}`;
    case 'propertyType':
      return `prop.${tag}`;
    case 'consultationPreference':
      return `pref.${tag}`;
    case 'scope':
      return `synthetic scope ${tag}`;
    case 'budget':
      return `synthetic budget ${tag}`;
    case 'timeline':
      return `synthetic timeline ${tag}`;
  }
}

/** One `SET` observation. */
export function set(
  field: DiscoveryField,
  provenance: RiyaFieldProvenance,
  tag = 'a',
): RiyaDiscoveryObservationV1 {
  return { field, operation: 'SET', value: synthetic(field, tag), provenance };
}

/** One `CLEAR` observation. */
export function clear(
  field: DiscoveryField,
  provenance: RiyaFieldProvenance,
): RiyaDiscoveryObservationV1 {
  return { field, operation: 'CLEAR', provenance };
}

/** A batch. `skipProjectDetails` defaults to false — never inferred from silence. */
export function batch(
  observations: readonly RiyaDiscoveryObservationV1[] = [],
  skipProjectDetails = false,
): RiyaConversationObservationBatchV1 {
  return createRiyaConversationObservationBatch({ version: 1, observations, skipProjectDetails });
}

/** An empty batch — the semantic no-op. */
export const noop = (): RiyaConversationObservationBatchV1 => batch([]);

/**
 * A continuity state carrying exactly the supplied fields, each with the supplied provenance.
 *
 * Built through the REAL constructor, so a fixture can never assert against a state the contract
 * would refuse.
 */
export function stateWith(
  args: {
    readonly phase?: RiyaConversationPhase;
    readonly fields?: Readonly<Partial<Record<DiscoveryField, RiyaFieldProvenance>>>;
    readonly tags?: Readonly<Partial<Record<DiscoveryField, string>>>;
    readonly revision?: number;
    readonly completeness?:
      'SUFFICIENT_FOR_CORE_REVIEW' | 'MORE_DISCOVERY_REQUIRED' | 'HUMAN_REVIEW_REQUIRED';
    readonly summaryConfirmed?: boolean;
    /** Only `COMPLETE` may carry one, and only `COMPLETE` requires it. */
    readonly completionEvidenceRef?: string;
  } = {},
): RiyaConversationContinuityStateV1 {
  const fields = args.fields ?? {};
  const present = Object.keys(fields) as DiscoveryField[];
  const required: DiscoveryField[] = ['serviceInterest', 'location', 'budget', 'timeline'];
  const missing = required.filter((field) => !present.includes(field));
  const ready = missing.length === 0;
  const completeness =
    args.completeness ?? (ready ? 'SUFFICIENT_FOR_CORE_REVIEW' : 'MORE_DISCOVERY_REQUIRED');

  const discovery: Record<string, unknown> = { completeness };
  for (const field of present) {
    discovery[VALUE_KEY[field]] = synthetic(field, args.tags?.[field] ?? 'a');
  }
  if (completeness !== 'SUFFICIENT_FOR_CORE_REVIEW' && missing.length > 0) {
    discovery['missingFields'] = missing;
  }

  const provenance: Partial<Record<DiscoveryField, RiyaFieldProvenance>> = {};
  for (const field of present) {
    const source = fields[field];
    if (source !== undefined) {
      provenance[field] = source;
    }
  }

  return createRiyaConversationContinuityState({
    version: 1,
    tenantId: 'tenant.a',
    conversationId: 'conv.1',
    continuityRevision: args.revision ?? 0,
    phase: args.phase ?? 'INTRO',
    discovery: discovery as never,
    fieldProvenance: provenance,
    summaryConfirmed: args.summaryConfirmed ?? false,
    ...(args.completionEvidenceRef === undefined
      ? {}
      : { completionEvidenceRef: args.completionEvidenceRef }),
  });
}

/** Read one discovery value out of a state, by discovery field. */
export function valueOf(
  state: RiyaConversationContinuityStateV1,
  field: DiscoveryField,
): string | undefined {
  return (state.discovery as unknown as Record<string, string | undefined>)[VALUE_KEY[field]];
}
