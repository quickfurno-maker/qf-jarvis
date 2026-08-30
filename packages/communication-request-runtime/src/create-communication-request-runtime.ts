/**
 * The communication-request runtime (QFJ-P08, ADR-0133).
 *
 * ONE responsibility, and no second: build a POWERLESS `CommunicationRequestV1` that ASKS
 * QuickFurno Core whether one communication may proceed, about ONE exact proposed action of a
 * recommendation that was already governed when it was created.
 *
 * ### What a successful call means
 *
 * > Jarvis has constructed a valid request asking QuickFurno Core whether a communication may
 * > proceed.
 *
 * **That is the whole claim.** It does not mean approved, authorized, eligible, consent-valid,
 * can-send, can-execute, ready-to-dispatch, scheduled-for-execution or delivered. An approval is not
 * a communication authorization, founder approval does not override an opt-out, and a prior
 * `CommunicationAuthorizationV1` is not a future permission slip. QuickFurno Core and the QF
 * Communications Runtime remain the sole consent, preference, suppression, STOP/DNC and eligibility
 * authorities, and they revalidate at EXECUTION time, which is not in this repository.
 *
 * ### There is no state machine, and no consent cache
 *
 * No `pending`, no `submitted`, no `authorized` boolean, no local eligibility answer, no opt-out
 * record, no suppression list. An unanswered request is represented by a request existing and an
 * authorization not existing — a fact about the world, not a field somebody has to remember to
 * update. The moment Jarvis holds a `pending` status or a cached consent verdict, a piece of an
 * authority that belongs to Core lives here.
 *
 * ### It does not solve ADR-0083 section 11, and must not try
 *
 * This producer runs while holding one exact recommendation and one exact action. That is more
 * context than the correlation runtime downstream will ever see, and it is tempting to write the
 * binding down. It does not. `CommunicationRequestV1` gains no `approvalRequestId`, no
 * `proposedActionId` and no `actionFingerprint`; no side mapping is created; and nothing is inferred
 * from `actionType`, `parameters`, `summary`, the purpose code or the template reference. QuickFurno
 * Core owns the semantic binding between a communication and the action it was approved as, because
 * Core is the party that issues `CommunicationAuthorizationV1`. If Jarvis ever needs to prove that
 * identity independently, that is a separately governed, versioned contract change — never a
 * heuristic bolted onto a producer.
 *
 * It creates no approval, no communication authorization and no execution intent; it sends,
 * executes, persists, queues and emits nothing; it reads no clock; and it can reach no Core
 * endpoint, no n8n workflow and no provider.
 */
import {
  COMMUNICATION_REQUEST_CONTRACT_VERSION,
  communicationRequestV1Schema,
  isStrictlyBefore,
} from '@qf-jarvis/contracts';
import type { CommunicationRequestV1, RecommendationV1 } from '@qf-jarvis/contracts';

import { CommunicationRequestRuntimeError } from './contracts/errors.js';
import { communicationRequestRuntimeInputSchema } from './contracts/input.js';
import type {
  CommunicationRequestRuntime,
  CommunicationRequestRuntimeIdentityPort,
} from './contracts/result.js';
import { deepFreezeJsonClone } from './internal/freeze.js';
import {
  defaultIdentityPort,
  nextCommunicationId,
  nextCommunicationRequestId,
} from './internal/identity.js';
import { selectAction, validateSource } from './internal/source-validation.js';

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
 * recommendation would let Core authorize a communication for a conclusion that had already gone
 * stale. The recommendation's expiry is the outer bound of the whole conversation about it, and a
 * communication is the most consequential thing at the end of that conversation — it reaches a real
 * person, and it cannot be retracted.
 *
 * No clock is read. Every instant is caller-stated and compared against the recommendation, exactly
 * as the contracts compare `expiresAt` against `createdAt` rather than against `now` — a request
 * that was valid when it was made must not become invalid because it was replayed tomorrow.
 *
 * The canonical schema then owns the rest: a scheduled time strictly before expiry, a window that
 * opens before it closes and before expiry, and `createdAt` strictly before `expiresAt`. None of
 * that is reimplemented here.
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

function isIdentityPort(value: unknown): value is CommunicationRequestRuntimeIdentityPort {
  const port = value as Partial<CommunicationRequestRuntimeIdentityPort> | null;
  return (
    typeof port === 'object' &&
    port !== null &&
    typeof port.nextCommunicationRequestId === 'function' &&
    typeof port.nextCommunicationId === 'function'
  );
}

/**
 * Build a communication-request runtime.
 *
 * `identity` is optional; omitted, a private port backed by `crypto.randomUUID()` is used, and it
 * generates nothing until `createRequest()` actually asks.
 */
export function createCommunicationRequestRuntime(
  config: { readonly identity?: CommunicationRequestRuntimeIdentityPort } = {},
): CommunicationRequestRuntime {
  const supplied: unknown = config;
  if (typeof supplied !== 'object' || supplied === null) {
    throw new CommunicationRequestRuntimeError('invalid-input');
  }
  const offered: unknown = (supplied as { identity?: unknown }).identity;
  if (offered !== undefined && !isIdentityPort(offered)) {
    throw new CommunicationRequestRuntimeError('invalid-input');
  }
  const identity: CommunicationRequestRuntimeIdentityPort = offered ?? defaultIdentityPort();

  function createRequest(input: unknown): CommunicationRequestV1 {
    // 1. Strict input. `communicationRequestId`, `communicationId`, `producingSystem`,
    //    `requestingAgent`, `requestingAgentVersion`, `priority`, `requiredApproval`, `summary`,
    //    `correlationId`, and every authority-, consent-, contact-, provider- and execution-shaped
    //    key a caller might reach for, are all UNKNOWN keys here. Offering one is a refusal rather
    //    than a value that quietly disappears — and a value that quietly disappears is how a caller
    //    comes to believe it was honoured.
    const parsedInput = communicationRequestRuntimeInputSchema.safeParse(input);
    if (!parsedInput.success) {
      throw new CommunicationRequestRuntimeError('invalid-input');
    }
    const stated = parsedInput.data;

    // 2 & 3. The recommendation and every binding, re-proved against recomputed digests; then the
    //        one action this communication would carry out, and its one binding. A malformed,
    //        mutated or substituted source fails closed here, before anything is generated.
    const validated = validateSource(stated.source);
    const { action } = selectAction(validated, stated.proposedActionId);

    // 4. Timing. An informational recommendation has zero actions, so `selectAction` has already
    //    failed closed above — there is nothing to communicate about, and no synthetic action is
    //    invented.
    if (!timingFitsWithin(validated.recommendation, stated.createdAt, stated.expiresAt)) {
      throw new CommunicationRequestRuntimeError('request-invalid');
    }

    // 5. Identity, then the artifact. Everything governance-shaped is DERIVED from the canonical
    //    source: `requiredApproval` and `priority` come from the recommendation, so a caller can
    //    neither weaken an ask nor strengthen one. Nothing is repaired, either — a source whose
    //    `requiredApproval` does not satisfy the contract's outbound-voice rule is REFUSED at step
    //    6, never silently escalated. Escalating would mean this package deciding what level of
    //    human sign-off a communication needs, which is the recommendation's decision, already made
    //    and already governed.
    const candidate = {
      communicationRequestId: nextCommunicationRequestId(identity),
      contractVersion: COMMUNICATION_REQUEST_CONTRACT_VERSION,
      communicationId: nextCommunicationId(identity),
      producingSystem: PRODUCING_SYSTEM,
      requestingAgent: validated.recommendation.producingAgent,
      requestingAgentVersion: validated.recommendation.producingAgentVersion,
      recipient: stated.recipient,
      purposeCode: stated.purposeCode,
      proposedChannel: stated.proposedChannel,
      content: stated.content,
      requestedTiming: stated.requestedTiming,
      createdAt: stated.createdAt,
      expiresAt: stated.expiresAt,
      priority: validated.recommendation.priority,
      requiredApproval: validated.recommendation.requiredApproval,
      policy: stated.policy,
      // The request is about ONE exact action, so it is worded by that action. This package does not
      // invent communication prose: new wording would be a second description of the same thing,
      // free to disagree with the one the recommendation was governed against.
      summary: action.summary,
      correlationId: validated.recommendation.correlationId,
      ...(stated.causationEventId === undefined
        ? {}
        : { causationEventId: stated.causationEventId }),
    };

    // 6. The real contract. This is what refuses a `requiredApproval` of "none", an outbound voice
    //    call without explicit human approval, a voice request carrying a template, a messaging
    //    request carrying a script, a scheduled time at or after expiry, and a window that opens too
    //    late — none of which is reimplemented here.
    const parsedRequest = communicationRequestV1Schema.safeParse(candidate);
    if (!parsedRequest.success) {
      throw new CommunicationRequestRuntimeError('request-invalid');
    }

    // 7 & 8. Deep copy, then freeze. `templateVariablesSchema` is built on `z.custom`, so the
    //        governed variables arrived BY REFERENCE: without the copy, a caller could edit the
    //        content of a request after it had been validated. A powerless artifact a holder could
    //        edit would not be one.
    try {
      return deepFreezeJsonClone(parsedRequest.data);
    } catch {
      throw new CommunicationRequestRuntimeError('request-invalid');
    }
  }

  return Object.freeze({ createRequest });
}
