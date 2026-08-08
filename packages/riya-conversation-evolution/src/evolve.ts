/**
 * `evolveRiyaConversation` — one pure step of Riya's conversation (RWC-P4A, ADR-0098).
 *
 * Current state + one observation batch → evolved state + the next question plan. Deterministic,
 * total, and free of I/O: no model, no clock, no randomness, no database, no compare-and-set, no
 * Core. Called twice with the same inputs it returns the same result, which is what makes the
 * RWC-P4B reconciliation path (reload, re-merge the SAME captured batch, retry once) safe to build
 * on top of it.
 *
 * ### The revision rule
 *
 * Exactly ONE increment per changed batch, however many fields moved. A revision counts *turns of
 * the conversation that changed something*, not fields — and four facts learned from one sentence
 * are one such turn. A semantic no-op does not increment at all, so RWC-P4B can skip the
 * compare-and-set entirely rather than spending a write to store what is already stored.
 *
 * Both a phase-only change and a provenance-strengthening-only change ARE semantic changes and bump
 * once: "the conversation moved on" and "we now know the client said this themselves" are both
 * facts a later turn depends on.
 */
import type {
  DiscoveryCompleteness,
  DiscoveryField,
  NeedDiscoveryInput,
} from '@qf-jarvis/riya-agent';
import { createRiyaConversationContinuityState } from '@qf-jarvis/riya-conversation-continuity';
import type { RiyaConversationContinuityStateV1 } from '@qf-jarvis/riya-conversation-continuity';

import { RiyaConversationEvolutionError } from './contracts/errors.js';
import { createRiyaConversationObservationBatch } from './contracts/observation.js';
import type { RiyaConversationObservationBatchV1 } from './contracts/observation.js';
import { DISCOVERY_VALUE_KEY, SUMMARY_REQUIRED_FIELDS } from './internal/field-map.js';
import { mergeObservations } from './internal/merge.js';
import type { RiyaObservationRejectionReason } from './internal/merge.js';
import { OUT_OF_SCOPE_PHASES, nextPhase, questionPlanFor, summaryReady } from './internal/phase.js';
import type { RiyaNextQuestionPlanV1 } from './internal/phase.js';

export type { RiyaNextQuestionPlanV1 } from './internal/phase.js';
export type { RiyaObservationRejectionReason } from './internal/merge.js';

/** What one evolution produced. Deeply frozen; carries no field VALUE anywhere. */
export interface RiyaConversationEvolutionResultV1 {
  readonly version: 1;
  /** True iff the state genuinely moved. When false, `state` is the canonical original. */
  readonly changed: boolean;
  readonly state: RiyaConversationContinuityStateV1;
  readonly appliedFields: readonly DiscoveryField[];
  /** Which updates did not apply, and why. A field name and a closed reason — never a value. */
  readonly rejectedFields: readonly {
    readonly field: DiscoveryField;
    readonly reason: RiyaObservationRejectionReason;
  }[];
  readonly questionPlan: RiyaNextQuestionPlanV1;
}

/**
 * Decide the conversational completeness of the merged discovery.
 *
 * This is the DISCOVERY completeness of ADR-0067, not QuickFurno's business `canSubmit`, and it is
 * never allowed to become one.
 *
 * `HUMAN_REVIEW_REQUIRED` is preserved rather than recomputed: a person decided this conversation
 * needs looking at, and a reducer that cleared that the moment a field arrived would quietly undo a
 * human's judgement.
 *
 * Otherwise summary readiness decides. When all four required values exist the discovery is
 * `SUFFICIENT_FOR_CORE_REVIEW` with NO missing fields — the canonical constructor refuses the
 * combination of "sufficient" plus a missing list, and an absent OPTIONAL field is not a missing
 * requirement, it is simply not blocking. Below that, only the still-unresolved REQUIRED fields are
 * listed: naming an optional field as missing would make the conversation look unfinished forever.
 */
function completenessFor(
  current: DiscoveryCompleteness,
  values: Readonly<Partial<Record<DiscoveryField, string>>>,
): { completeness: DiscoveryCompleteness; missingFields: readonly DiscoveryField[] } {
  if (current === 'HUMAN_REVIEW_REQUIRED') {
    return {
      completeness: 'HUMAN_REVIEW_REQUIRED',
      missingFields: SUMMARY_REQUIRED_FIELDS.filter((field) => values[field] === undefined),
    };
  }
  if (summaryReady(values)) {
    return { completeness: 'SUFFICIENT_FOR_CORE_REVIEW', missingFields: [] };
  }
  return {
    completeness: 'MORE_DISCOVERY_REQUIRED',
    missingFields: SUMMARY_REQUIRED_FIELDS.filter((field) => values[field] === undefined),
  };
}

/** Evolve one conversation by one turn. Throws only the four bounded codes. */
export function evolveRiyaConversation(input: {
  readonly current: RiyaConversationContinuityStateV1;
  readonly batch: RiyaConversationObservationBatchV1;
}): RiyaConversationEvolutionResultV1 {
  const supplied: unknown = input;
  if (typeof supplied !== 'object' || supplied === null) {
    throw new RiyaConversationEvolutionError('invalid-state');
  }
  const { current, batch } = input;

  // Re-prove the BATCH through its own canonical constructor before anything reads it.
  //
  // A TypeScript interface is not a runtime trust boundary. This function is exported, so an
  // untyped or JSON-fed caller can hand it a forged object that never went through
  // `createRiyaConversationObservationBatch` -- with an unknown provenance, an extra key, a
  // non-boolean `skipProjectDetails`, or, worst, two observations for the SAME field. The
  // constructor's contract is that a duplicate refuses the ENTIRE batch; merging a forged one
  // observation at a time would instead silently pick a winner, which is exactly the rule nobody
  // wrote down. Everything below uses the CANONICAL batch, never the argument.
  let canonicalBatch: RiyaConversationObservationBatchV1;
  try {
    canonicalBatch = createRiyaConversationObservationBatch(batch);
  } catch {
    // Rethrown as this package's own bounded code rather than passed through: the constructor
    // already discards the zod issue, and re-wrapping keeps one vocabulary at this boundary.
    throw new RiyaConversationEvolutionError('invalid-observation-batch');
  }

  // Re-prove the state through its OWN canonical constructor before reasoning about it. A caller
  // that hand-assembled a state, or a store that returned a half-applied row, must not be able to
  // put this reducer to work on something the contract would refuse.
  let canonical: RiyaConversationContinuityStateV1;
  try {
    canonical = createRiyaConversationContinuityState({
      version: 1,
      tenantId: current.tenantId,
      conversationId: current.conversationId,
      continuityRevision: current.continuityRevision,
      phase: current.phase,
      discovery: {
        ...(current.discovery.serviceInterestRef === undefined
          ? {}
          : { serviceInterestRef: current.discovery.serviceInterestRef }),
        ...(current.discovery.locationRef === undefined
          ? {}
          : { locationRef: current.discovery.locationRef }),
        ...(current.discovery.propertyTypeRef === undefined
          ? {}
          : { propertyTypeRef: current.discovery.propertyTypeRef }),
        ...(current.discovery.scopeSummary === undefined
          ? {}
          : { scopeSummary: current.discovery.scopeSummary }),
        ...(current.discovery.budgetNote === undefined
          ? {}
          : { budgetNote: current.discovery.budgetNote }),
        ...(current.discovery.timelineNote === undefined
          ? {}
          : { timelineNote: current.discovery.timelineNote }),
        ...(current.discovery.consultationPreferenceRef === undefined
          ? {}
          : { consultationPreferenceRef: current.discovery.consultationPreferenceRef }),
        completeness: current.discovery.completeness,
        ...(current.discovery.missingFields.length === 0
          ? {}
          : { missingFields: [...current.discovery.missingFields] }),
      },
      fieldProvenance: current.fieldProvenance,
      summaryConfirmed: current.summaryConfirmed,
      ...(current.completionEvidenceRef === undefined
        ? {}
        : { completionEvidenceRef: current.completionEvidenceRef }),
    });
  } catch {
    // The upstream error is discarded: its code belongs to a different bounded vocabulary, and its
    // message could name the field that failed.
    throw new RiyaConversationEvolutionError('invalid-state');
  }

  if (OUT_OF_SCOPE_PHASES.includes(canonical.phase)) {
    throw new RiyaConversationEvolutionError('phase-out-of-scope');
  }

  const merged = mergeObservations(canonical.discovery, canonical.fieldProvenance, canonicalBatch);

  const phase = nextPhase({
    currentPhase: canonical.phase,
    values: merged.values,
    changed: merged.changed,
    skipProjectDetails: canonicalBatch.skipProjectDetails,
    appliedFields: merged.appliedFields,
  });
  const questionPlan = questionPlanFor(phase, merged.values);

  const { completeness, missingFields } = completenessFor(
    canonical.discovery.completeness,
    merged.values,
  );

  const discoveryChanged =
    completeness !== canonical.discovery.completeness ||
    missingFields.length !== canonical.discovery.missingFields.length ||
    missingFields.some((field, index) => canonical.discovery.missingFields[index] !== field);
  // Invalidating a confirmation is a state change in its own right. It cannot happen without
  // `merged.changed` today -- a value only moves when something applied -- but stating it keeps the
  // two independent, so a later merge rule cannot silently produce an unrecorded flag flip.
  const confirmationInvalidated = merged.valueChanged && canonical.summaryConfirmed;
  const changed =
    merged.changed || phase !== canonical.phase || discoveryChanged || confirmationInvalidated;

  if (!changed) {
    // Nothing moved. Return the CANONICAL original, revision untouched, so a caller can compare by
    // identity of value and skip a compare-and-set entirely.
    return Object.freeze({
      version: 1 as const,
      changed: false,
      state: canonical,
      appliedFields: merged.appliedFields,
      rejectedFields: merged.rejectedFields,
      questionPlan,
    });
  }

  if (canonical.continuityRevision >= Number.MAX_SAFE_INTEGER) {
    // `+ 1` beyond this silently returns the same number, and a compare-and-set on a counter that
    // stopped counting would report success while losing every write after it.
    throw new RiyaConversationEvolutionError('revision-exhausted');
  }

  // Rebuild the discovery through the REAL canonical constructor -- reached by handing the state
  // constructor an INPUT, which validates it with `createNeedDiscovery` itself
  // (`continuity-state.ts:199`). Building a `NeedDiscovery` here and passing that would mean
  // constructing it twice, and the second pass would have to strip `behaviourVersion` and the
  // explicit `undefined`s back off to satisfy the input shape -- the exact projection RWC-P2B's
  // codec exists to perform. One construction, one set of bounds, one place they are enforced.
  const discoveryInput: NeedDiscoveryInput = {
    ...(Object.fromEntries(
      (Object.keys(DISCOVERY_VALUE_KEY) as DiscoveryField[])
        .filter((field) => merged.values[field] !== undefined)
        .map((field) => [DISCOVERY_VALUE_KEY[field], merged.values[field]]),
    ) as Omit<NeedDiscoveryInput, 'completeness' | 'missingFields'>),
    completeness,
    ...(missingFields.length === 0 ? {} : { missingFields: [...missingFields] }),
  };

  let state: RiyaConversationContinuityStateV1;
  try {
    state = createRiyaConversationContinuityState({
      version: 1,
      tenantId: canonical.tenantId,
      conversationId: canonical.conversationId,
      continuityRevision: canonical.continuityRevision + 1,
      phase,
      discovery: discoveryInput,
      fieldProvenance: merged.provenance,
      // RWC-P4A never CREATES a confirmation -- being shown a summary and agreeing with it is a
      // separate act, and RWC-P6 owns it. Reaching SUMMARY is not confirming one, so `false` can
      // never become `true` here.
      //
      // But it must INVALIDATE one. A confirmation is about the exact facts the client reviewed, so
      // an accepted change to any discovery VALUE means the summary they agreed to no longer
      // exists, and carrying the flag forward would let a later phase act on an agreement to
      // something that was since edited. Strengthening a provenance on an identical value, a
      // same-value no-op, a rejected update and a phase-only normalization all leave what they read
      // intact, and preserve it.
      summaryConfirmed: merged.valueChanged ? false : canonical.summaryConfirmed,
      ...(canonical.completionEvidenceRef === undefined
        ? {}
        : { completionEvidenceRef: canonical.completionEvidenceRef }),
    });
  } catch {
    // A value that passed the batch's outer bound but fails a canonical per-field bound lands here.
    // It is the BATCH that was wrong, and the underlying message could quote the value.
    throw new RiyaConversationEvolutionError('invalid-observation-batch');
  }

  return Object.freeze({
    version: 1 as const,
    changed: true,
    state,
    appliedFields: merged.appliedFields,
    rejectedFields: merged.rejectedFields,
    questionPlan,
  });
}
