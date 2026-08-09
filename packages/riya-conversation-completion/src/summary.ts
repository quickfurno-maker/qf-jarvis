/**
 * Structured summary edit and confirmation (RWC-P6, ADR-0101 §19–§21).
 *
 * ### These are the only ways `summaryConfirmed` becomes true, and `user_confirmed` gets minted
 *
 * RWC-P4A can set the flag false and never true. RWC-P4B forbids the model from claiming
 * `user_confirmed`. RWC-P5 refuses to upgrade a validated reference to it. Three merged slices point
 * here, and the reason they do is that `user_confirmed` means *the client was shown this and agreed
 * it is right* — a claim only a surface that actually showed it can make, never an inference.
 *
 * ### RWC-P4A stays the only discovery reducer
 *
 * Both functions build a canonical RWC-P4A observation batch and call the REAL
 * `evolveRiyaConversation`. Nothing here merges a field, ranks a provenance, recomputes completeness
 * or decides a phase. A second reducer would be a second set of rules for one conversation, and the
 * two would drift on the first correction to either.
 *
 * ### Core availability is not optional just because a model was not involved
 *
 * A structured edit reaches `serviceInterest` and `location` without passing through the profile
 * where RWC-P5 does its checking. So both functions apply the SAME shared policy — the individual
 * reference, and then the PROSPECTIVE final pair against the state the reducer actually produced.
 * Skipping it because the value "came from the UI" would let a structured action write a state the
 * model path is forbidden to write.
 */
import type { DiscoveryField } from '@qf-jarvis/riya-agent';
import { parseCoreServiceAvailabilitySnapshotV1 } from '@qf-jarvis/core-service-availability-read';
import type { CoreServiceAvailabilitySnapshotV1 } from '@qf-jarvis/core-service-availability-read';
import {
  isCoreCityActive,
  isCoreServiceActive,
  isCoreServiceCityPairAvailable,
} from '@qf-jarvis/core-service-availability-read/policy';
import type { RiyaConversationContinuityStateV1 } from '@qf-jarvis/riya-conversation-continuity';
import { evolveRiyaConversation } from '@qf-jarvis/riya-conversation-evolution';
import type { RiyaConversationEvolutionResultV1 } from '@qf-jarvis/riya-conversation-evolution';

import { RiyaConversationCompletionError } from './contracts/errors.js';
import { createRiyaSummaryEditV1 } from './contracts/summary-edit.js';
import type { RiyaSummaryEditV1 } from './contracts/summary-edit.js';
import { advancedState, canonicalState } from './internal/state.js';

/** What one structured summary action produced. */
export interface RiyaSummaryActionResultV1 {
  readonly version: 1;
  readonly state: RiyaConversationContinuityStateV1;
  /** True iff the state genuinely moved. When false, `state` is the canonical original. */
  readonly changed: boolean;
}

function canonicalSnapshot(value: CoreServiceAvailabilitySnapshotV1) {
  try {
    return parseCoreServiceAvailabilitySnapshotV1(value);
  } catch {
    throw new RiyaConversationCompletionError('invalid-availability-snapshot');
  }
}

/**
 * Every catalogue value in a state must still be one Core lists, and the pair must still be sold.
 *
 * Applied to the PROSPECTIVE state rather than to the edit, because an individually valid change can
 * still COMBINE with what the conversation already holds to produce a pair Core does not serve — the
 * same rule, and the same reasoning, as RWC-P5's prospective check.
 */
function requireCoreValid(
  state: RiyaConversationContinuityStateV1,
  snapshot: CoreServiceAvailabilitySnapshotV1,
): void {
  const service = state.discovery.serviceInterestRef;
  const location = state.discovery.locationRef;
  if (service !== undefined && !isCoreServiceActive(snapshot, service)) {
    throw new RiyaConversationCompletionError('action-not-permitted');
  }
  if (location !== undefined && !isCoreCityActive(snapshot, location)) {
    throw new RiyaConversationCompletionError('action-not-permitted');
  }
  if (
    service !== undefined &&
    location !== undefined &&
    !isCoreServiceCityPairAvailable(snapshot, service, location)
  ) {
    throw new RiyaConversationCompletionError('action-not-permitted');
  }
}

/** Run the REAL RWC-P4A reducer, mapping its bounded errors onto this package's. */
function evolve(
  current: RiyaConversationContinuityStateV1,
  observations: readonly Record<string, unknown>[],
): RiyaConversationEvolutionResultV1 {
  try {
    return evolveRiyaConversation({
      current,
      batch: {
        version: 1,
        observations: observations as never,
        // Always false. Declining optional project-detail collection is a conversational act observed
        // during a turn, not something a summary action performs -- and a structured edit must never
        // silently close a question the client never answered.
        skipProjectDetails: false,
      },
    });
  } catch {
    throw new RiyaConversationCompletionError('action-not-permitted');
  }
}

/**
 * Apply a structured summary edit.
 *
 * Only at `SUMMARY`. Editing from `CONTACT` or `CONSENT` would mean rewriting a state back into
 * `SUMMARY` to make the edit legal, and that is a transition this slice was not given — RWC-P6B may
 * propose one with its own reasoning.
 *
 * Everything after the checks is RWC-P4A's: precedence, `CLEAR` semantics, missing fields,
 * completeness, confirmation invalidation, phase regression and the single revision increment. In
 * particular, an accepted value change sets `summaryConfirmed` back to false, because the summary the
 * client agreed to no longer exists.
 */
export function evolveRiyaSummaryEdit(args: {
  readonly current: RiyaConversationContinuityStateV1;
  readonly edit: RiyaSummaryEditV1;
  readonly availabilitySnapshot: CoreServiceAvailabilitySnapshotV1;
}): RiyaSummaryActionResultV1 {
  const current = canonicalState(args.current);
  if (current.phase !== 'SUMMARY') {
    throw new RiyaConversationCompletionError('action-not-permitted');
  }
  const snapshot = canonicalSnapshot(args.availabilitySnapshot);
  // Re-proved rather than trusted: this package is exported, so an untyped caller can hand over a
  // forged edit that never went through the canonical constructor -- with a provenance field, a
  // duplicate, or a `skipProjectDetails` it was never allowed to choose.
  const edit = createRiyaSummaryEditV1(args.edit);

  const observations = edit.edits.map((one) => ({
    field: one.field,
    operation: one.operation,
    ...(one.value === undefined ? {} : { value: one.value }),
    // Stamped, never chosen. This IS the structured summary surface.
    provenance: 'user_confirmed' as const,
  }));

  // The asserted reference first, so an edit naming something Core does not list is refused before
  // the reducer is asked to merge it.
  for (const one of edit.edits) {
    if (one.operation !== 'SET' || one.value === undefined) {
      continue;
    }
    if (one.field === 'serviceInterest' && !isCoreServiceActive(snapshot, one.value)) {
      throw new RiyaConversationCompletionError('action-not-permitted');
    }
    if (one.field === 'location' && !isCoreCityActive(snapshot, one.value)) {
      throw new RiyaConversationCompletionError('action-not-permitted');
    }
  }

  const decided = evolve(current, observations);
  // And the prospective state, which is what would actually be persisted.
  requireCoreValid(decided.state, snapshot);

  return Object.freeze({
    version: 1 as const,
    state: decided.state,
    changed: decided.changed,
  });
}

/**
 * Confirm the summary the client was shown.
 *
 * ### What confirmation means, expressed as provenance
 *
 * Every PRESENT discovery value is re-observed at its own current value with provenance
 * `user_confirmed`. That is the literal reading of *the client was shown these and agreed they are
 * right*, and it has a consequence worth stating: RWC-P4A never overwrites `user_confirmed` from
 * below, so a later model inference cannot silently replace a fact the client explicitly approved.
 * Only another confirmation, or a structured edit, can.
 *
 * No ABSENT field gains provenance. The client agreed to what they saw, and they did not see a blank.
 *
 * ### Exactly one revision
 *
 * RWC-P4A may itself advance the revision when a provenance strengthens; it may also report no change
 * when every present value was already `user_confirmed`. Either way this returns
 * `current.continuityRevision + 1`, because ONE structured confirmation is ONE semantic change to the
 * conversation — the phase moves and the flag flips regardless of what the merge did.
 */
export function confirmRiyaSummary(args: {
  readonly current: RiyaConversationContinuityStateV1;
  readonly availabilitySnapshot: CoreServiceAvailabilitySnapshotV1;
}): RiyaSummaryActionResultV1 {
  const current = canonicalState(args.current);
  if (current.phase !== 'SUMMARY' || current.summaryConfirmed) {
    throw new RiyaConversationCompletionError('action-not-permitted');
  }
  if (current.completionEvidenceRef !== undefined) {
    throw new RiyaConversationCompletionError('action-not-permitted');
  }
  // A person decided this conversation needs looking at. Confirming it into CONTACT would step over
  // that judgement, and RWC-P6 does not overrule human review.
  if (current.discovery.completeness === 'HUMAN_REVIEW_REQUIRED') {
    throw new RiyaConversationCompletionError('action-not-permitted');
  }

  const snapshot = canonicalSnapshot(args.availabilitySnapshot);
  // The state as it stands must still be one Core allows. A pair that was sold when the summary was
  // rendered may not be sold now, and confirming it would agree to something unavailable.
  requireCoreValid(current, snapshot);

  const present: { readonly field: DiscoveryField; readonly value: string }[] = [];
  for (const [field, key] of Object.entries({
    serviceInterest: 'serviceInterestRef',
    location: 'locationRef',
    propertyType: 'propertyTypeRef',
    scope: 'scopeSummary',
    budget: 'budgetNote',
    timeline: 'timelineNote',
    consultationPreference: 'consultationPreferenceRef',
  } as const)) {
    const value = current.discovery[key];
    if (typeof value === 'string') {
      present.push({ field: field as DiscoveryField, value });
    }
  }
  // The constructor already guarantees the four summary-required values at this phase; this is the
  // same rule stated where the batch is built, so a future change upstream fails here rather than
  // producing a confirmation of nothing.
  if (present.length === 0) {
    throw new RiyaConversationCompletionError('action-not-permitted');
  }

  const decided = evolve(
    current,
    present.map((one) => ({
      field: one.field,
      operation: 'SET' as const,
      value: one.value,
      provenance: 'user_confirmed' as const,
    })),
  );
  // Re-observing a value at its own value cannot change it, so the pair cannot have moved -- but the
  // check is cheap and the alternative is trusting that argument forever.
  requireCoreValid(decided.state, snapshot);

  const state = advancedState({
    from: current,
    discovery: decided.state.discovery,
    fieldProvenance: decided.state.fieldProvenance,
    phase: 'CONTACT',
    summaryConfirmed: true,
    // Explicitly absent. Confirming a summary is not completing a submission, and continuity refuses
    // evidence anywhere but COMPLETE.
  });

  return Object.freeze({ version: 1 as const, state, changed: true });
}
