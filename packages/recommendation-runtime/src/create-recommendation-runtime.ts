/**
 * The governed recommendation runtime (QFJ-P05.05, ADR-0079).
 *
 * The missing PRODUCER. `RecommendationV1`, `ProposedAction`, `ApprovalRequestV1` and
 * `ActionFingerprint` have existed in `@qf-jarvis/contracts` since Phase 2, but nothing in the
 * repository built a validated recommendation or computed the fingerprint an approval request
 * requires — so the approval runtime had a prerequisite with no implementation. This is that
 * implementation, and nothing more than that.
 *
 * ### What it will not do
 *
 * It does not infer. Risk determines how much human oversight an action receives
 * (execution-governance.md §9), so a runtime that guessed `risk` from `actionType`, or
 * `requiredApproval` from `risk`, would be setting oversight levels from a heuristic. The caller
 * states both; `recommendationV1Schema` enforces the governed relationship between them and refuses
 * a wrong pairing rather than repairing it.
 *
 * It makes no idempotency claim. Two `create()` calls with identical input produce two
 * recommendations with two identities, because they are two proposals. Deduplication belongs to
 * whoever knows the business meaning of "the same recommendation", and this package does not.
 *
 * It has no authority. There is no approve, decide, execute, send, deliver, dispatch or emit — and
 * no approval request either, which is the next phase. It creates an inert artifact and hands back
 * the values that phase will need.
 */
import {
  proposedActionSchema,
  RECOMMENDATION_CONTRACT_VERSION,
  recommendationV1Schema,
} from '@qf-jarvis/contracts';
import type { ProposedAction, RecommendationV1 } from '@qf-jarvis/contracts';

import { RecommendationRuntimeError } from './contracts/errors.js';
import { recommendationRuntimeInputSchema } from './contracts/input.js';
import type {
  RecommendationActionBinding,
  RecommendationRuntime,
  RecommendationRuntimeIdentityPort,
  RecommendationRuntimeResult,
} from './contracts/result.js';
import { deepFreezeJsonClone } from './internal/freeze.js';
import { fingerprintProposedAction } from './internal/fingerprint.js';
import { defaultIdentityPort, nextActionId, nextRecommendationId } from './internal/identity.js';

/** The literal that says only QF Jarvis produces recommendations. Never caller-supplied. */
const PRODUCING_SYSTEM = 'qf-jarvis';

function isIdentityPort(value: unknown): value is RecommendationRuntimeIdentityPort {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Partial<RecommendationRuntimeIdentityPort>;
  return (
    typeof candidate.nextRecommendationId === 'function' &&
    typeof candidate.nextActionId === 'function'
  );
}

/**
 * Build a recommendation runtime.
 *
 * `identity` is optional; omitted, a private port backed by `crypto.randomUUID()` is used, and it
 * generates nothing until `create()` actually asks.
 */
export function createRecommendationRuntime(
  config: { readonly identity?: RecommendationRuntimeIdentityPort } = {},
): RecommendationRuntime {
  const supplied: unknown = config;
  if (typeof supplied !== 'object' || supplied === null) {
    throw new RecommendationRuntimeError('invalid-input');
  }
  const offered: unknown = (supplied as { identity?: unknown }).identity;
  if (offered !== undefined && !isIdentityPort(offered)) {
    throw new RecommendationRuntimeError('invalid-input');
  }
  const identity: RecommendationRuntimeIdentityPort = offered ?? defaultIdentityPort();

  /**
   * Create one recommendation.
   *
   * The order matters at two points. Identities are generated for each action draft in INPUT ORDER,
   * so bindings line up positionally with `proposedActions`. And fingerprints are computed from the
   * FINALIZED, frozen actions — after full validation and after the deep copy — so every binding
   * describes exactly the bytes the caller is handed, not an intermediate that could still change.
   */
  function create(input: unknown): RecommendationRuntimeResult {
    // 1. Strict input. An unknown key -- including `recommendationId`, `contractVersion`,
    //    `producingSystem`, `actionId`, `actionFingerprint`, `approved` or `authorized` -- is a
    //    refusal, not something quietly dropped. The Zod issue tree is discarded: `parameters` is
    //    governed precisely because it may hold something that must never be echoed back.
    const parsedInput = recommendationRuntimeInputSchema.safeParse(input);
    if (!parsedInput.success) {
      throw new RecommendationRuntimeError('invalid-input');
    }
    const stated = parsedInput.data;

    // 2 & 3. Identity, recommendation first, then one per action draft in input order.
    const recommendationId = nextRecommendationId(identity);

    // 4. Each action, assembled and validated individually. Validating here rather than only via
    //    the recommendation means a malformed action is attributable to the action.
    const actions: ProposedAction[] = stated.proposedActions.map((draft) => {
      const candidate = {
        actionId: nextActionId(identity),
        actionType: draft.actionType,
        actionContractVersion: draft.actionContractVersion,
        summary: draft.summary,
        parameters: draft.parameters,
      };
      const parsedAction = proposedActionSchema.safeParse(candidate);
      if (!parsedAction.success) {
        throw new RecommendationRuntimeError('recommendation-invalid');
      }
      return parsedAction.data;
    });

    // 5. The artifact. Three fields are the runtime's, not the caller's: the identity, the contract
    //    version, and the literal producing system that is the structural boundary itself.
    const candidate = {
      recommendationId,
      contractVersion: RECOMMENDATION_CONTRACT_VERSION,
      recommendationType: stated.recommendationType,
      createdAt: stated.createdAt,
      expiresAt: stated.expiresAt,
      producingSystem: PRODUCING_SYSTEM,
      producingAgent: stated.producingAgent,
      producingAgentVersion: stated.producingAgentVersion,
      subject: stated.subject,
      priority: stated.priority,
      confidence: stated.confidence,
      risk: stated.risk,
      requiredApproval: stated.requiredApproval,
      summary: stated.summary,
      rationale: stated.rationale,
      evidence: stated.evidence,
      proposedActions: actions,
      composite: stated.composite,
      ...(stated.contributingAgents === undefined
        ? {}
        : { contributingAgents: stated.contributingAgents }),
      correlationId: stated.correlationId,
    };

    // 6. The whole thing, against the real contract. This is what enforces every governed
    //    invariant -- informational proposes nothing, money escalates, expiry follows creation,
    //    composite attributes its contributors -- and it is also what proves action ids are UNIQUE.
    //    A port that returned the same UUID twice therefore surfaces here, as `recommendation-invalid`:
    //    each identifier was individually well-formed, so the failure is the assembled artifact's,
    //    not the generator's.
    const parsedRecommendation = recommendationV1Schema.safeParse(candidate);
    if (!parsedRecommendation.success) {
      throw new RecommendationRuntimeError('recommendation-invalid');
    }

    // 7. Deep copy, then freeze. `actionParametersSchema` is built on `z.custom`, which passes the
    //    caller's own object through by reference -- so without this, mutating that object after
    //    `create()` returned would retroactively change what was recommended, and would change it
    //    out from under the fingerprint computed below.
    let recommendation: RecommendationV1;
    try {
      recommendation = deepFreezeJsonClone(parsedRecommendation.data);
    } catch {
      throw new RecommendationRuntimeError('recommendation-invalid');
    }

    // 8. One fingerprint per FINALIZED action, in the same order.
    const actionBindings: readonly RecommendationActionBinding[] = Object.freeze(
      recommendation.proposedActions.map((action) =>
        Object.freeze({
          recommendationId: recommendation.recommendationId,
          proposedActionId: action.actionId,
          actionFingerprint: fingerprintProposedAction(action),
        }),
      ),
    );

    // 9. Frozen result. An inert proposal that a holder could edit would not be inert.
    return Object.freeze({ recommendation, actionBindings });
  }

  return Object.freeze({ create });
}
