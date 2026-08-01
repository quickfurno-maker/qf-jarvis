/**
 * Exact provenance validation (QFJ-M4, ADR-0057 §I).
 *
 * The gateway result must match the plan's exact provider/model/version and the request's prompt
 * family/version and run id (the fields model-gateway provenance exposes). Any mismatch fails closed
 * before a draft is returned. The release/configuration/execution-class identity is bound into the
 * request and owned by the gateway's routing/rollout resolution.
 */
import type { ReplyPlan } from '@qf-jarvis/agent-runtime';
import type { ModelRequest, ModelResponse } from '@qf-jarvis/model-gateway';

/** True iff the response provenance exactly matches the plan release and the request prompt/run. */
export function provenanceMatches(
  response: ModelResponse,
  plan: ReplyPlan,
  request: ModelRequest,
): boolean {
  const p = response.provenance;
  return (
    response.runId === request.runId &&
    p.runId === request.runId &&
    p.purpose === request.purpose &&
    p.providerId === plan.release.providerId &&
    p.modelId === plan.release.modelId &&
    p.modelVersion === plan.release.modelVersion &&
    p.promptId === request.promptId &&
    p.promptVersion === request.promptVersion &&
    // ADR-0073: the digest must match too. Identity alone would let a provider echo the right name
    // for the wrong bytes, which is precisely the drift this phase closes.
    p.promptDigest === request.promptDigest
  );
}
