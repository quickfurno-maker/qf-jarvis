/**
 * The rebuild-and-compare proof (QFJ-P08, ADR-0082).
 *
 * INTERNAL. Nothing here reimplements an approval semantic.
 *
 * A submission is about to leave the process carrying an operator's identity and an authorization
 * proof, so the ask it names must genuinely be the ask the governed runtime sanctioned — not merely
 * a well-typed object that resembles one. The tempting way to check that is to re-verify the things
 * that matter: risk, requested authority, the fingerprint. Doing so would create a SECOND definition
 * of the approval rules inside a transport adapter, free to drift from
 * `@qf-jarvis/approval-runtime`'s and silently left behind the next time the runtime changes.
 *
 * So faithfulness is proved by REBUILDING: the source goes back through the real
 * `createApprovalRuntime().createRequest`, with the identity port pinned to the SUPPLIED request id
 * so the comparison is about content rather than about a freshly generated identifier, and the
 * result is compared by deep equality. Every rule the runtime enforces — derived risk and authority,
 * derived agent, version, correlation and summary, the recomputed fingerprint, the timing bounds,
 * the informational refusal, the contract's own money escalation — is therefore enforced here by
 * construction, and stays enforced when the runtime changes.
 *
 * This is the same technique `@qf-jarvis/postgres-approval-queue` uses, and deliberately so: the
 * durable store and the Core transport must agree about what a faithful ask is, and the way to
 * guarantee that is for both to ask the same runtime rather than for both to know the rules.
 */
import type { ApprovalRequestV1 } from '@qf-jarvis/contracts';
import { createApprovalRuntime } from '@qf-jarvis/approval-runtime';

import type { ApprovalRecommendationSource } from '../contracts/api.js';
import { ApprovalCoreAdapterError } from '../contracts/errors.js';
import { deepEquals } from './canonical-json.js';

/**
 * Prove the supplied request is exactly what the approval runtime would build from this source.
 *
 * Throws `binding-invalid` on any disagreement, including a source the runtime refuses outright.
 */
export function assertFaithfulRequest(
  source: ApprovalRecommendationSource,
  request: ApprovalRequestV1,
): void {
  let rebuilt: ApprovalRequestV1;
  try {
    rebuilt = createApprovalRuntime({
      identity: { nextApprovalRequestId: (): string => request.approvalRequestId },
    }).createRequest({
      source,
      proposedActionId: request.proposedActionId,
      createdAt: request.createdAt,
      expiresAt: request.expiresAt,
      policy: request.policy,
      ...(request.causationEventId === undefined
        ? {}
        : { causationEventId: request.causationEventId }),
    });
  } catch {
    // The runtime refused to build this ask at all: a wrong action, a broken binding, an
    // informational recommendation, or timing outside the recommendation's lifetime. Its error is
    // deliberately not propagated -- this package's vocabulary is closed, and the runtime's is its
    // own.
    throw new ApprovalCoreAdapterError('binding-invalid');
  }

  if (!deepEquals(rebuilt, request)) {
    // Same identity, and the runtime would have produced something else: a tampered risk, requested
    // authority, agent, correlation, summary, policy or fingerprint. Fail closed rather than asking
    // Core to authorize a version of the ask the runtime disagrees with.
    throw new ApprovalCoreAdapterError('binding-invalid');
  }
}
