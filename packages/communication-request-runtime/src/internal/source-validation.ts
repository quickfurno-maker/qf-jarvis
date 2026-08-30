/**
 * Source validation and the anti-substitution check (QFJ-P08, ADR-0133).
 *
 * INTERNAL, and the security core of this package. It is deliberately the same argument
 * `@qf-jarvis/approval-runtime` makes, applied to a different question — and deliberately a local
 * implementation rather than a dependency on that package, because asking Core whether a
 * communication may proceed must not require the ability to construct an approval request.
 *
 * `RecommendationRuntimeResult` is a TypeScript type. It is not evidence. A value arriving here may
 * have been serialized to a queue and read back, assembled by hand, or produced by a caller that
 * simply constructed the shape — TypeScript inspected none of those. So the recommendation is parsed
 * with the REAL `recommendationV1Schema`, and every binding is **recomputed** rather than believed.
 *
 * ### Why recomputation, and not a well-formed-digest check
 *
 * A 64-character lowercase hex string is trivially easy to produce. Accepting one because it *looks*
 * like a digest would mean a communication request could be built from an
 * action whose content matches nothing — which defeats the only thing the fingerprint is for.
 *
 * The substitution this defends against is concrete. Take a recommendation whose action A says
 * "send the standard follow-up", then supply a source in which A has the same `actionId`, the same
 * `recommendationId` and a materially different `summary` or `parameters`. Every identifier still
 * lines up, and the request assembled from it would carry the substituted `summary` while inheriting
 * the original's governance. Only the digest disagrees — so the digest is recomputed from the
 * CURRENT content, every time.
 *
 * `fingerprintProposedAction` is imported from `@qf-jarvis/recommendation-runtime`'s PUBLIC root,
 * which is precisely why that package exposes it separately from its runtime: verification must not
 * require rebuilding a recommendation, and must not require reimplementing the digest here. A second
 * implementation of a canonicalization is a second implementation that can drift.
 *
 * ### The fingerprint stays here, and does not travel
 *
 * `CommunicationRequestV1` carries no `actionFingerprint`, no `proposedActionId` and no
 * `approvalRequestId`, and this package does not add one. The digest is used to PROVE the source it
 * was handed, and then it stops: writing it into the request would be Jarvis asserting a
 * communication-request ↔ approved-action identity that ADR-0083 §11 reserves to QuickFurno Core.
 */
import { actionFingerprintSchema, recommendationV1Schema } from '@qf-jarvis/contracts';
import type { ProposedAction, RecommendationV1 } from '@qf-jarvis/contracts';
import { fingerprintProposedAction } from '@qf-jarvis/recommendation-runtime';
import type { RecommendationActionBinding } from '@qf-jarvis/recommendation-runtime';

import { CommunicationRequestRuntimeError } from '../contracts/errors.js';

/** One recommendation whose every binding has been re-proved against recomputed content. */
export interface ValidatedSource {
  readonly recommendation: RecommendationV1;
  /** Positionally aligned with `recommendation.proposedActions`. */
  readonly bindings: readonly RecommendationActionBinding[];
}

function mismatch(): never {
  throw new CommunicationRequestRuntimeError('binding-mismatch');
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
    // correct outcome — an informational recommendation proposes nothing, so there is no action a
    // communication could carry out.
    return mismatch();
  }
  return { action, binding };
}
