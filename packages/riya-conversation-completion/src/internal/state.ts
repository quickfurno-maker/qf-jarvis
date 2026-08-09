/**
 * Rebuilding a continuity state through its own canonical constructor (RWC-P6, ADR-0101).
 *
 * Every function in this package returns a state built HERE, never an object assembled by hand. The
 * constructor owns the phase/`summaryConfirmed` invariants, the summary-readiness check, the
 * provenance/discovery agreement and the completion-evidence rule — and a state that skipped it would
 * be a second, weaker definition of what a valid conversation looks like.
 *
 * The mapping function below exists for one reason: `NeedDiscovery` types every value as
 * `string | undefined`, while `NeedDiscoveryInput` under `exactOptionalPropertyTypes` accepts only a
 * `string` or an ABSENT key. Widening the input to take `undefined` would weaken a real contract for
 * a caller's convenience, so the keys are omitted instead.
 */
import type { NeedDiscovery, NeedDiscoveryInput } from '@qf-jarvis/riya-agent';
import { createRiyaConversationContinuityState } from '@qf-jarvis/riya-conversation-continuity';
import type {
  RiyaConversationContinuityStateV1,
  RiyaConversationPhase,
} from '@qf-jarvis/riya-conversation-continuity';

import { RiyaConversationCompletionError } from '../contracts/errors.js';

/** Project a frozen `NeedDiscovery` back into the constructor's input shape. */
export function discoveryInputOf(discovery: NeedDiscovery): NeedDiscoveryInput {
  return {
    ...(discovery.serviceInterestRef === undefined
      ? {}
      : { serviceInterestRef: discovery.serviceInterestRef }),
    ...(discovery.locationRef === undefined ? {} : { locationRef: discovery.locationRef }),
    ...(discovery.propertyTypeRef === undefined
      ? {}
      : { propertyTypeRef: discovery.propertyTypeRef }),
    ...(discovery.scopeSummary === undefined ? {} : { scopeSummary: discovery.scopeSummary }),
    ...(discovery.budgetNote === undefined ? {} : { budgetNote: discovery.budgetNote }),
    ...(discovery.timelineNote === undefined ? {} : { timelineNote: discovery.timelineNote }),
    ...(discovery.consultationPreferenceRef === undefined
      ? {}
      : { consultationPreferenceRef: discovery.consultationPreferenceRef }),
    completeness: discovery.completeness,
    ...(discovery.missingFields.length === 0
      ? {}
      : { missingFields: [...discovery.missingFields] }),
  };
}

/**
 * Re-prove a caller-supplied continuity state.
 *
 * A TypeScript type is not a runtime trust boundary. This package is exported, so an untyped or
 * JSON-fed caller can hand over a half-applied row or a hand-assembled object, and a conversation
 * advanced from one of those would carry an invariant nobody checked.
 */
export function canonicalState(
  value: RiyaConversationContinuityStateV1,
): RiyaConversationContinuityStateV1 {
  const supplied: unknown = value;
  if (typeof supplied !== 'object' || supplied === null || Array.isArray(supplied)) {
    throw new RiyaConversationCompletionError('invalid-state');
  }
  try {
    return createRiyaConversationContinuityState({
      version: 1,
      tenantId: value.tenantId,
      conversationId: value.conversationId,
      continuityRevision: value.continuityRevision,
      phase: value.phase,
      discovery: discoveryInputOf(value.discovery),
      fieldProvenance: value.fieldProvenance,
      summaryConfirmed: value.summaryConfirmed,
      ...(value.completionEvidenceRef === undefined
        ? {}
        : { completionEvidenceRef: value.completionEvidenceRef }),
    });
  } catch {
    // The upstream code belongs to a different bounded vocabulary and its message could name the
    // field that failed.
    throw new RiyaConversationCompletionError('invalid-state');
  }
}

/**
 * Build the next state, advancing the revision by EXACTLY one.
 *
 * The single increment is the contract RWC-P2A established and RWC-P4A kept: one semantic change, one
 * revision. Refusing at the ceiling rather than wrapping matters because a wrapped revision would make
 * a stale compare-and-set succeed.
 */
export function advancedState(args: {
  readonly from: RiyaConversationContinuityStateV1;
  readonly discovery: NeedDiscovery;
  readonly fieldProvenance: RiyaConversationContinuityStateV1['fieldProvenance'];
  readonly phase: RiyaConversationPhase;
  readonly summaryConfirmed: boolean;
  readonly completionEvidenceRef?: string;
}): RiyaConversationContinuityStateV1 {
  if (args.from.continuityRevision >= Number.MAX_SAFE_INTEGER) {
    throw new RiyaConversationCompletionError('action-not-permitted');
  }
  try {
    return createRiyaConversationContinuityState({
      version: 1,
      tenantId: args.from.tenantId,
      conversationId: args.from.conversationId,
      continuityRevision: args.from.continuityRevision + 1,
      phase: args.phase,
      discovery: discoveryInputOf(args.discovery),
      fieldProvenance: args.fieldProvenance,
      summaryConfirmed: args.summaryConfirmed,
      ...(args.completionEvidenceRef === undefined
        ? {}
        : { completionEvidenceRef: args.completionEvidenceRef }),
    });
  } catch {
    throw new RiyaConversationCompletionError('action-not-permitted');
  }
}
