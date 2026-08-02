/**
 * Canonicalization and faithful-request re-proof (QFJ-P08, ADR-0081).
 *
 * INTERNAL, and the correctness core of this package.
 *
 * ### Nothing here reimplements an approval semantic
 *
 * The temptation, when writing a store, is to re-check the things that matter: that `risk` matches,
 * that the authority was not weakened, that the fingerprint is right. Doing so would create a SECOND
 * definition of the approval rules — one that can drift from `@qf-jarvis/approval-runtime`'s, and
 * that a future change to the runtime would silently leave behind.
 *
 * So this module proves faithfulness by REBUILDING. It hands the stored source back to the real
 * `createApprovalRuntime().createRequest`, with an identity port pinned to the supplied request id,
 * and compares the result to the supplied request by deep equality. Every rule the runtime enforces
 * — derived risk and authority, derived agent, version, correlation and summary, the recomputed
 * fingerprint, the timing bounds, the informational refusal, the contract's own escalations — is
 * therefore enforced here too, by construction, and stays enforced when the runtime changes.
 *
 * ### The stored source is canonical, not whatever arrived
 *
 * A caller's `RecommendationRuntimeResult` is a structural value. Storing it verbatim would persist
 * whatever extra keys it happened to carry, and a later read would re-derive from something that is
 * not quite the artifact. So the recommendation is parsed with the real schema, its bindings are
 * REBUILT from recomputed fingerprints, and only that canonical pair is written.
 */
import { recommendationV1Schema } from '@qf-jarvis/contracts';
import type { ApprovalRequestV1, ProposedAction, RecommendationV1 } from '@qf-jarvis/contracts';
import { createApprovalRuntime } from '@qf-jarvis/approval-runtime';
import { fingerprintProposedAction } from '@qf-jarvis/recommendation-runtime';
import type { RecommendationRuntimeResult } from '@qf-jarvis/recommendation-runtime';

import { PostgresApprovalQueueError } from '../contracts/errors.js';

/** A canonical, storable source snapshot: the validated recommendation plus rebuilt bindings. */
export interface CanonicalSource {
  readonly recommendation: RecommendationV1;
  readonly actionBindings: readonly {
    readonly recommendationId: string;
    readonly proposedActionId: string;
    readonly actionFingerprint: string;
  }[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Parse a supplied source and rebuild its bindings from RECOMPUTED fingerprints.
 *
 * The caller's own bindings are not read at all: a 64-character lowercase hex string is trivial to
 * produce, so accepting one because it looks like a digest would defeat the anti-substitution
 * control entirely. Action order is preserved, because a binding array is positional.
 */
export function canonicalizeSource(source: unknown): CanonicalSource {
  if (!isRecord(source)) {
    throw new PostgresApprovalQueueError('binding-invalid');
  }
  const parsed = recommendationV1Schema.safeParse(source['recommendation']);
  if (!parsed.success) {
    // Zod issues are discarded: a recommendation carries rationale, evidence and governed action
    // parameters, none of which may be echoed back in an error.
    throw new PostgresApprovalQueueError('binding-invalid');
  }
  const recommendation = parsed.data;

  let actionBindings: CanonicalSource['actionBindings'];
  try {
    actionBindings = Object.freeze(
      recommendation.proposedActions.map((action: ProposedAction) =>
        Object.freeze({
          recommendationId: recommendation.recommendationId,
          proposedActionId: action.actionId,
          actionFingerprint: fingerprintProposedAction(action),
        }),
      ),
    );
  } catch {
    throw new PostgresApprovalQueueError('binding-invalid');
  }

  return Object.freeze({ recommendation, actionBindings });
}

/** The canonical source, as the JSON that goes into `source_snapshot`. */
export function canonicalSourceJson(canonical: CanonicalSource): Record<string, unknown> {
  return {
    recommendation: canonical.recommendation,
    actionBindings: canonical.actionBindings,
  };
}

/** A `RecommendationRuntimeResult`-shaped view of a canonical source, for the public runtime. */
export function asRuntimeResult(canonical: CanonicalSource): RecommendationRuntimeResult {
  return { recommendation: canonical.recommendation, actionBindings: canonical.actionBindings };
}

/**
 * Prove the supplied request is exactly what the approval runtime would build from this source.
 *
 * Rebuild-and-compare rather than field-by-field checking. Every rule stays in one place — the
 * public runtime — and a future rule added there is enforced here without this file changing.
 *
 * The identity port is pinned to the SUPPLIED request id so the comparison is about content: a
 * generated id would differ every time and make deep equality useless.
 */
export function assertFaithfulRequest(
  canonical: CanonicalSource,
  request: ApprovalRequestV1,
): void {
  let rebuilt: ApprovalRequestV1;
  try {
    rebuilt = createApprovalRuntime({
      identity: { nextApprovalRequestId: (): string => request.approvalRequestId },
    }).createRequest({
      source: asRuntimeResult(canonical),
      proposedActionId: request.proposedActionId,
      createdAt: request.createdAt,
      expiresAt: request.expiresAt,
      policy: request.policy,
      ...(request.causationEventId === undefined
        ? {}
        : { causationEventId: request.causationEventId }),
    });
  } catch {
    // The runtime refused to build this ask at all -- a wrong action, a broken binding, an
    // informational recommendation, or timing outside the recommendation's lifetime. Its own error
    // is deliberately not propagated: this package's vocabulary is closed.
    throw new PostgresApprovalQueueError('binding-invalid');
  }

  if (!deepEquals(rebuilt, request)) {
    // Same id, and the runtime would have produced something else: a tampered risk, authority,
    // agent, correlation, summary or fingerprint. Fail closed rather than storing the caller's
    // version of an ask the runtime disagrees with.
    throw new PostgresApprovalQueueError('binding-invalid');
  }
}

/**
 * True deep equality over JSON data.
 *
 * `JSON.stringify` comparison would be key-order-sensitive and would call `toJSON`; a shallow
 * compare would miss a tampered `policy` or nested value. Both matter here, because this is the
 * comparison that decides whether a stored ask is the ask the runtime sanctioned.
 */
export function deepEquals(a: unknown, b: unknown): boolean {
  if (a === b) {
    return true;
  }
  if (typeof a !== typeof b || a === null || b === null) {
    return false;
  }
  if (typeof a !== 'object') {
    // NaN never reaches here through a contracts schema, and would be a difference anyway.
    return false;
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) {
      return false;
    }
    return a.every((item, index) => deepEquals(item, b[index]));
  }
  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  if (leftKeys.length !== rightKeys.length) {
    return false;
  }
  return (
    leftKeys.every((key, index) => key === rightKeys[index]) &&
    leftKeys.every((key) => deepEquals(left[key], right[key]))
  );
}
