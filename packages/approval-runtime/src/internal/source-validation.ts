/**
 * Source validation and the anti-substitution check (QFJ-P08, ADR-0080).
 *
 * INTERNAL, and the security core of this package.
 *
 * `RecommendationRuntimeResult` is a TypeScript type. It is not evidence. A value arriving here may
 * have been serialized to a queue and read back, assembled by hand, or produced by a caller that
 * simply constructed the shape — TypeScript inspected none of those. So the recommendation is parsed
 * with the REAL `recommendationV1Schema`, and every binding is **recomputed** rather than believed.
 *
 * ### Why recomputation, and not a well-formed-digest check
 *
 * A 64-character lowercase hex string is trivially easy to produce. Accepting one because it *looks*
 * like a digest would mean an approval request could carry a fingerprint that matches nothing —
 * which defeats the only thing the fingerprint is for.
 *
 * The substitution this defends against is concrete. Take a recommendation whose action A says
 * "send the standard follow-up", get it approved, then supply a source in which A has the same
 * `actionId` and the same `recommendationId` but different `parameters`. Every identifier still
 * lines up; the Core decision still says `approved`. Only the digest disagrees — so the digest is
 * the thing that must be recomputed from the CURRENT content, every time, on both entry points.
 *
 * `fingerprintProposedAction` is imported from `@qf-jarvis/recommendation-runtime`'s PUBLIC root,
 * which is precisely why that package exposes it separately from its runtime: verification must not
 * require rebuilding a recommendation, and must not require reimplementing the digest here. A second
 * implementation of a canonicalization is a second implementation that can drift.
 */
import { actionFingerprintSchema, recommendationV1Schema } from '@qf-jarvis/contracts';
import type { ProposedAction, RecommendationV1 } from '@qf-jarvis/contracts';
import { fingerprintProposedAction } from '@qf-jarvis/recommendation-runtime';
import type { RecommendationActionBinding } from '@qf-jarvis/recommendation-runtime';

import { ApprovalRuntimeError } from '../contracts/errors.js';

/** One recommendation whose every binding has been re-proved against recomputed content. */
export interface ValidatedSource {
  readonly recommendation: RecommendationV1;
  /** Positionally aligned with `recommendation.proposedActions`. */
  readonly bindings: readonly RecommendationActionBinding[];
}

function mismatch(): never {
  throw new ApprovalRuntimeError('binding-mismatch');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Parse a `RecommendationRuntimeResult` and prove every binding against a recomputed digest.
 *
 * Fails closed as `binding-mismatch` on any disagreement between the recommendation and its
 * bindings — a missing binding, an extra one, a duplicate, a wrong id, a malformed digest, or a
 * digest that does not equal the fingerprint of the action content actually supplied.
 */
export function validateSource(source: unknown): ValidatedSource {
  if (!isRecord(source)) {
    return mismatch();
  }

  const parsed = recommendationV1Schema.safeParse(source['recommendation']);
  if (!parsed.success) {
    // Zod issues are discarded: a recommendation carries rationale, evidence and governed action
    // parameters, none of which may be echoed back in an error.
    return mismatch();
  }
  const recommendation = parsed.data;

  const offered: unknown = source['actionBindings'];
  if (!Array.isArray(offered)) {
    return mismatch();
  }
  // Exactly one binding per action: no missing, no extra. A count check first makes the
  // one-to-one claim total rather than merely "every action found something".
  if (offered.length !== recommendation.proposedActions.length) {
    return mismatch();
  }

  const seen = new Set<string>();
  const bindings: RecommendationActionBinding[] = [];

  recommendation.proposedActions.forEach((action: ProposedAction, index: number) => {
    const candidate: unknown = offered[index];
    if (!isRecord(candidate)) {
      return mismatch();
    }
    const digest = actionFingerprintSchema.safeParse(candidate['actionFingerprint']);
    if (
      candidate['recommendationId'] !== recommendation.recommendationId ||
      candidate['proposedActionId'] !== action.actionId ||
      !digest.success
    ) {
      return mismatch();
    }
    // A duplicate `proposedActionId` would make "the binding for this action" ambiguous. The
    // recommendation's own schema already forbids duplicate action ids, so this can only fire on a
    // binding array that disagrees with it — which is exactly the case worth catching.
    if (seen.has(action.actionId)) {
      return mismatch();
    }
    seen.add(action.actionId);

    // THE anti-substitution check. Recomputed from the content supplied right now, not read.
    if (fingerprintProposedAction(action) !== digest.data) {
      return mismatch();
    }

    bindings.push(
      Object.freeze({
        recommendationId: recommendation.recommendationId,
        proposedActionId: action.actionId,
        actionFingerprint: digest.data,
      }),
    );
  });

  // Informational recommendations propose nothing, so they carry no bindings. The schema already
  // guarantees zero actions; the length check above therefore guarantees zero bindings.
  return Object.freeze({ recommendation, bindings: Object.freeze(bindings) });
}

/** Locate the one action and its one binding, or fail closed. */
export function selectAction(
  validated: ValidatedSource,
  proposedActionId: unknown,
): { readonly action: ProposedAction; readonly binding: RecommendationActionBinding } {
  if (typeof proposedActionId !== 'string') {
    return mismatch();
  }
  const index = validated.recommendation.proposedActions.findIndex(
    (action) => action.actionId === proposedActionId,
  );
  const action = validated.recommendation.proposedActions[index];
  const binding = validated.bindings[index];
  if (index < 0 || action === undefined || binding === undefined) {
    // Includes the informational case: zero actions means nothing can be selected, which is the
    // correct outcome — an informational recommendation has nothing to approve.
    return mismatch();
  }
  return { action, binding };
}
