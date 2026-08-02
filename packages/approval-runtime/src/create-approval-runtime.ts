/**
 * The approval runtime (QFJ-P08, ADR-0080).
 *
 * Two responsibilities, and no third:
 *
 * 1. **Ask.** Build a powerless `ApprovalRequestV1` about ONE exact proposed action of a
 *    recommendation that was already governed when it was created.
 * 2. **Correlate.** Prove that a decision QuickFurno Core has ALREADY issued describes that request,
 *    that recommendation, that action, and that exact action content.
 *
 * It approves nothing, decides nothing, persists nothing, queues nothing, calls Core, emits no event
 * and creates no execution intent. Jarvis asks; QuickFurno Core decides.
 *
 * ### There is no state machine
 *
 * No `pending`, no `submitted`, no `approved` boolean, no local cache. An unanswered request is
 * represented by a request existing and a decision not existing — which is a fact about the world,
 * not a field somebody has to remember to update. The moment Jarvis holds a `status: 'pending'`, a
 * piece of the authorization state lives in Jarvis, and ADR-0002 puts it in Core.
 */
import {
  APPROVAL_REQUEST_CONTRACT_VERSION,
  approvalDecisionV1Schema,
  approvalRequestV1Schema,
  isStrictlyBefore,
} from '@qf-jarvis/contracts';
import type {
  ActionDecision,
  ApprovalDecisionV1,
  ApprovalRequestV1,
  ProposedAction,
  RecommendationV1,
} from '@qf-jarvis/contracts';

import { ApprovalRuntimeError } from './contracts/errors.js';
import {
  approvalDecisionValidationInputSchema,
  approvalRequestRuntimeInputSchema,
} from './contracts/input.js';
import type {
  ApprovalDecisionCorrelation,
  ApprovalRuntime,
  ApprovalRuntimeIdentityPort,
} from './contracts/result.js';
import { deepFreezeJsonClone } from './internal/freeze.js';
import { defaultIdentityPort, nextApprovalRequestId } from './internal/identity.js';
import { selectAction, validateSource } from './internal/source-validation.js';
import type { ValidatedSource } from './internal/source-validation.js';

/** The literal that says only QF Jarvis asks. Never caller-supplied. */
const PRODUCING_SYSTEM = 'qf-jarvis';

/** `a <= b`, expressed through the contract's own comparison so ordering has one definition. */
function isAtOrBefore(a: string, b: string): boolean {
  return a === b || isStrictlyBefore(a, b);
}

/**
 * A request may not outlive the recommendation it asks about.
 *
 * Four rules, and the last is the one that matters most: a request that expired after its
 * recommendation would let an approval be granted for a conclusion that had already gone stale. The
 * recommendation's expiry is the outer bound of the whole conversation about it.
 *
 * No clock is read. Every instant is caller-stated and compared against the recommendation, exactly
 * as the contracts compare `expiresAt` against `createdAt` rather than against `now` — a request
 * that was valid when it was made must not become invalid because it was replayed tomorrow.
 */
function timingFitsWithin(
  recommendation: RecommendationV1,
  createdAt: string,
  expiresAt: string,
): boolean {
  return (
    isAtOrBefore(recommendation.createdAt, createdAt) &&
    isStrictlyBefore(createdAt, recommendation.expiresAt) &&
    isStrictlyBefore(createdAt, expiresAt) &&
    isAtOrBefore(expiresAt, recommendation.expiresAt)
  );
}

function isIdentityPort(value: unknown): value is ApprovalRuntimeIdentityPort {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as Partial<ApprovalRuntimeIdentityPort>).nextApprovalRequestId === 'function'
  );
}

/**
 * Build an approval runtime.
 *
 * `identity` is optional; omitted, a private port backed by `crypto.randomUUID()` is used, and it
 * generates nothing until `createRequest()` actually asks.
 */
export function createApprovalRuntime(
  config: { readonly identity?: ApprovalRuntimeIdentityPort } = {},
): ApprovalRuntime {
  const supplied: unknown = config;
  if (typeof supplied !== 'object' || supplied === null) {
    throw new ApprovalRuntimeError('invalid-input');
  }
  const offered: unknown = (supplied as { identity?: unknown }).identity;
  if (offered !== undefined && !isIdentityPort(offered)) {
    throw new ApprovalRuntimeError('invalid-input');
  }
  const identity: ApprovalRuntimeIdentityPort = offered ?? defaultIdentityPort();

  function createRequest(input: unknown): ApprovalRequestV1 {
    // 1. Strict input. `approvalRequestId`, `recommendationId`, `actionFingerprint`, `risk`,
    //    `requestedAuthority`, `requestingAgent`, `producingSystem`, `correlationId`, `summary`,
    //    `outcome`, `approved`, `decidedBy` and `issuer` are all unknown keys here, so offering one
    //    is a refusal rather than a value that quietly wins.
    const parsedInput = approvalRequestRuntimeInputSchema.safeParse(input);
    if (!parsedInput.success) {
      throw new ApprovalRuntimeError('invalid-input');
    }
    const stated = parsedInput.data;

    // 2 & 3 & 4. The recommendation and every binding, re-proved against recomputed digests; then
    //            the one action being asked about, and its one binding.
    const validated = validateSource(stated.source);
    const { action, binding } = selectAction(validated, stated.proposedActionId);

    // 6 & 7. Timing. An informational recommendation has zero actions, so `selectAction` has already
    //        failed closed above -- there is nothing to approve, and no synthetic action is invented.
    if (!timingFitsWithin(validated.recommendation, stated.createdAt, stated.expiresAt)) {
      throw new ApprovalRuntimeError('request-invalid');
    }

    // 8 & 9. Identity, then the artifact. Everything governance-shaped is DERIVED: `risk` and
    //        `requestedAuthority` come from the recommendation so a caller cannot launder a
    //        money-related + founder recommendation into a delegated-approver ask.
    const candidate = {
      approvalRequestId: nextApprovalRequestId(identity),
      contractVersion: APPROVAL_REQUEST_CONTRACT_VERSION,
      recommendationId: validated.recommendation.recommendationId,
      proposedActionId: action.actionId,
      actionFingerprint: binding.actionFingerprint,
      requestedAuthority: validated.recommendation.requiredApproval,
      risk: validated.recommendation.risk,
      createdAt: stated.createdAt,
      expiresAt: stated.expiresAt,
      producingSystem: PRODUCING_SYSTEM,
      requestingAgent: validated.recommendation.producingAgent,
      requestingAgentVersion: validated.recommendation.producingAgentVersion,
      // The request is about ONE exact action, so it is worded by that action. This package does not
      // invent approval prose: new wording would be a second description of the same thing, free to
      // disagree with the one the fingerprint covers.
      summary: action.summary,
      policy: stated.policy,
      correlationId: validated.recommendation.correlationId,
      ...(stated.causationEventId === undefined
        ? {}
        : { causationEventId: stated.causationEventId }),
    };

    // 10. The real contract. This is what refuses `requestedAuthority: 'none'`, an informational
    //     risk, and a money-related or outbound-voice request that under-asks -- none of which is
    //     reimplemented here.
    const parsedRequest = approvalRequestV1Schema.safeParse(candidate);
    if (!parsedRequest.success) {
      throw new ApprovalRuntimeError('request-invalid');
    }

    // 11 & 12. Deep copy, then freeze. A powerless artifact a holder could edit would not be one.
    try {
      return deepFreezeJsonClone(parsedRequest.data);
    } catch {
      throw new ApprovalRuntimeError('request-invalid');
    }
  }

  /**
   * Prove a request is a faithful ask about the supplied source.
   *
   * Never assume the request came from this runtime. A deserialized or foreign `ApprovalRequestV1`
   * is untrusted, and the fields below are exactly the ones a substitution would have to alter:
   * change the risk or the authority and the ask has been laundered; change the fingerprint and the
   * approval answers different content; change the agent, version or correlation and the audit trail
   * points at the wrong producer. None is silently repaired.
   */
  function requestMatchesSource(
    request: ApprovalRequestV1,
    validated: ValidatedSource,
    action: ProposedAction,
    fingerprint: string,
  ): boolean {
    const recommendation = validated.recommendation;
    return (
      request.recommendationId === recommendation.recommendationId &&
      request.proposedActionId === action.actionId &&
      request.actionFingerprint === fingerprint &&
      request.risk === recommendation.risk &&
      request.requestedAuthority === recommendation.requiredApproval &&
      request.requestingAgent === recommendation.producingAgent &&
      request.requestingAgentVersion === recommendation.producingAgentVersion &&
      request.correlationId === recommendation.correlationId &&
      request.summary === action.summary &&
      timingFitsWithin(recommendation, request.createdAt, request.expiresAt)
    );
  }

  function validateDecision(input: unknown): ApprovalDecisionCorrelation {
    const parsedInput = approvalDecisionValidationInputSchema.safeParse(input);
    if (!parsedInput.success) {
      throw new ApprovalRuntimeError('invalid-input');
    }

    // 1 & 2. The request against its own contract, and the source against its own -- including the
    //        recomputed fingerprints. A stale request whose source action has since been edited
    //        fails here, at `validateSource`, before any decision is even looked at.
    const parsedRequest = approvalRequestV1Schema.safeParse(parsedInput.data.request);
    if (!parsedRequest.success) {
      throw new ApprovalRuntimeError('request-invalid');
    }
    const request = parsedRequest.data;
    const validated = validateSource(parsedInput.data.source);
    const { action, binding } = selectAction(validated, request.proposedActionId);

    // 3. The request is a faithful ask about THIS source. `producingSystem` needs no comparison:
    //    the contract's literal already makes any other value unparseable.
    if (!requestMatchesSource(request, validated, action, binding.actionFingerprint)) {
      throw new ApprovalRuntimeError('decision-mismatch');
    }

    // 4. Core's artifact against its own contract. This is what structurally proves `issuer` is
    //    `quickfurno-core`, that `decidedBy` is a human or a named/versioned policy and never an
    //    agent, that action verdicts are unique, and that a non-approved outcome approves nothing.
    //    A bad decision is refused, never normalized or reconstructed.
    const parsedDecision = approvalDecisionV1Schema.safeParse(parsedInput.data.decision);
    if (!parsedDecision.success) {
      throw new ApprovalRuntimeError('decision-invalid');
    }
    const decision = parsedDecision.data;

    // 5. Correlation.
    if (
      decision.recommendationId !== request.recommendationId ||
      decision.correlationId !== request.correlationId
    ) {
      throw new ApprovalRuntimeError('decision-mismatch');
    }

    // Decided within the window that was open when it was asked. A decision recorded after the
    // request or the recommendation expired is answering a question that had already died --
    // expiry is not approval, and a late yes is not a yes.
    if (
      !isAtOrBefore(request.createdAt, decision.decidedAt) ||
      !isStrictlyBefore(decision.decidedAt, request.expiresAt) ||
      !isStrictlyBefore(decision.decidedAt, validated.recommendation.expiresAt)
    ) {
      throw new ApprovalRuntimeError('decision-mismatch');
    }

    // Every action Core ruled on must belong to THIS recommendation. A foreign action id in the
    // decision means Core and Jarvis disagree about what was asked, which is never safe to average
    // out. Note this does NOT require the decision to cover only the requested action:
    // `ApprovalDecisionV1` is recommendation-level and partial approval across several actions is
    // exactly what it exists to express.
    const known = new Set(validated.recommendation.proposedActions.map((a) => a.actionId));
    for (const entry of decision.actionDecisions) {
      if (!known.has(entry.actionId)) {
        throw new ApprovalRuntimeError('decision-mismatch');
      }
    }

    // The requested action must actually have been ruled on. The contract already guarantees the
    // entries are unique, so finding one is finding the one.
    const actionDecision = decision.actionDecisions.find(
      (entry) => entry.actionId === request.proposedActionId,
    );
    if (actionDecision === undefined) {
      throw new ApprovalRuntimeError('decision-mismatch');
    }

    // An OBSERVATION. No `isAuthorized`, no `canExecute`, no `canSend` -- see `result.ts`. Under
    // partial approval the overall outcome may be `approved` while THIS action's verdict is
    // `rejected`; the per-action verdict is what describes the action, and it is returned as-is
    // rather than reconciled with the outcome.
    try {
      return deepFreezeJsonClone({
        approvalRequestId: request.approvalRequestId,
        recommendationId: request.recommendationId,
        proposedActionId: request.proposedActionId,
        actionFingerprint: request.actionFingerprint,
        decision: decision satisfies ApprovalDecisionV1,
        actionDecision: actionDecision satisfies ActionDecision,
      });
    } catch {
      throw new ApprovalRuntimeError('decision-invalid');
    }
  }

  return Object.freeze({ createRequest, validateDecision });
}
