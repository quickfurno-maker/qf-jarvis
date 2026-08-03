/**
 * The Core approval submission adapter (QFJ-P08, ADR-0082).
 *
 * ### Jarvis asks. QuickFurno Core decides.
 *
 * This is the client half of the round trip ADR-0007 describes: an authenticated human acts in a
 * Jarvis surface, Jarvis SUBMITS that intent to Core, and Core validates identity, authority,
 * current state, risk policy, expiry and eligibility against its own truth before answering. The
 * click is a request for authorization, never an authorization. Nothing here approves anything, and
 * there is no local state in which an approval could be recorded.
 *
 * ### The three things this file is careful about
 *
 * **Nothing leaves before the ask is proved.** Input validation, the rebuild-and-compare against the
 * governed runtime, and the timing window all run before a transport is touched. A malformed input
 * is a refusal, not a round trip — and a round trip carries an operator's authorization proof.
 *
 * **Exactly one send.** No retry loop, no backoff, no second attempt on any failure class. A retry
 * of an approval submission is a second statement of human intent, and the actor who decides to make
 * one is the caller, in the open, not a hidden loop inside a transport adapter. The idempotency key
 * is deterministic precisely so an explicit retry is recognisable as the same intent.
 *
 * **A negative intent can never come back as an approval.** `REJECT` and `REQUEST_CHANGES` are
 * checked against the SELECTED ACTION's verdict, not the overall outcome — because under partial
 * approval an overall `approved` decision may legitimately reject this very action while approving
 * another. If the selected action comes back approved after a human asked for it to be refused, that
 * is a contradiction between what was asked and what was recorded, and it fails closed.
 *
 * The converse is deliberately NOT symmetric: a human may click `APPROVE` and Core may refuse. That
 * is a designed, expected, load-bearing outcome, and this adapter returns it as an ordinary result
 * rather than an error. A surface that cannot show "the founder clicked approve and Core said no"
 * has been built wrong.
 */
import {
  approvalDecisionV1Schema,
  approvalRequestV1Schema,
  humanActorSchema,
  isAtOrBefore,
  isStrictlyBefore,
  utcTimestampSchema,
} from '@qf-jarvis/contracts';
import type { ApprovalDecisionV1, ApprovalRequestV1 } from '@qf-jarvis/contracts';
import { createApprovalRuntime } from '@qf-jarvis/approval-runtime';
import type { ApprovalDecisionCorrelation } from '@qf-jarvis/approval-runtime';

import type {
  ApprovalCoreAdapter,
  ApprovalCoreAuthorizationProof,
  ApprovalCoreSubmissionResult,
  ApprovalCoreTransport,
  ApprovalRecommendationSource,
} from '../contracts/api.js';
import { ApprovalCoreAdapterError } from '../contracts/errors.js';
import { operatorActionSchema, serializeCommand } from '../internal/command.js';
import { assertFaithfulRequest } from '../internal/faithfulness.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function invalid(): never {
  throw new ApprovalCoreAdapterError('invalid-input');
}

/**
 * Is this a proof holder?
 *
 * Structural, and shallow on purpose. The holder's contract is that its secret is unreachable, so
 * there is nothing here to inspect beyond the one method — and inspecting further would be this
 * function trying to read what the design exists to hide.
 */
function isProofHolder(value: unknown): value is ApprovalCoreAuthorizationProof {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { use?: unknown }).use === 'function'
  );
}

/** Freeze an already-JSON-shaped value all the way down, so a caller cannot edit Core's artifact. */
function deepFreeze<T>(value: T): T {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) {
    return value;
  }
  for (const child of Object.values(value)) {
    deepFreeze(child);
  }
  return Object.freeze(value);
}

/** Build the adapter over an INJECTED transport. The caller owns the transport and its lifecycle. */
export function createApprovalCoreAdapter(config: {
  readonly transport: ApprovalCoreTransport;
}): ApprovalCoreAdapter {
  // Typed `unknown` at the check: the declared parameter says a transport is present, but this is a
  // package boundary and an untyped caller -- or a bare transport passed instead of `{ transport }`
  // -- would otherwise reach the send as `undefined`.
  const supplied: unknown = config;
  if (
    !isRecord(supplied) ||
    !isRecord(supplied['transport']) ||
    typeof supplied['transport']['send'] !== 'function'
  ) {
    return invalid();
  }
  const transport = supplied['transport'] as unknown as ApprovalCoreTransport;

  /** The public runtime's own correlation, mapped into this package's closed vocabulary. */
  function correlate(
    source: ApprovalRecommendationSource,
    request: ApprovalRequestV1,
    decision: ApprovalDecisionV1,
  ): ApprovalDecisionCorrelation {
    try {
      return createApprovalRuntime().validateDecision({ source, request, decision });
    } catch (error) {
      // `decision-invalid` means Core's artifact violates its own contract -- the same class of
      // problem as a malformed body, so it is reported as an invalid RESPONSE. Everything else
      // reaching here is a correlation failure: a decision about a different recommendation, a
      // missing entry for this action, or a fingerprint that no longer matches the action content.
      const code: unknown =
        error instanceof Error && error.name === 'ApprovalRuntimeError'
          ? (error as { code?: unknown }).code
          : undefined;
      if (code === 'decision-invalid') {
        throw new ApprovalCoreAdapterError('core-invalid-response');
      }
      throw new ApprovalCoreAdapterError('core-decision-mismatch');
    }
  }

  async function submit(input: unknown): Promise<ApprovalCoreSubmissionResult> {
    if (!isRecord(input)) {
      return invalid();
    }

    // 1. Structure, before anything else. Each value is parsed with the CONTRACT's own schema rather
    //    than a shape invented here, so the vocabulary this package speaks is the governed one.
    //    `humanActorSchema`, not `actorReferenceSchema`: a policy actor is something Core applies on
    //    its own authority, not something a person at a screen can claim to be -- and
    //    `@qf-jarvis/contracts` has no agent variant at all, so agent self-approval is not a value
    //    that exists to be excluded.
    const parsedRequest = approvalRequestV1Schema.safeParse(input['request']);
    const parsedOperator = humanActorSchema.safeParse(input['operator']);
    const parsedAction = operatorActionSchema.safeParse(input['action']);
    const parsedRequestedAt = utcTimestampSchema.safeParse(input['requestedAt']);
    const authorization: unknown = input['authorization'];
    if (
      !parsedRequest.success ||
      !parsedOperator.success ||
      !parsedAction.success ||
      !parsedRequestedAt.success ||
      !isProofHolder(authorization)
    ) {
      // Issues are discarded entirely: they would quote the request's summary, its policy citation,
      // the operator's opaque Core identity, or the offending value itself.
      return invalid();
    }
    const request = parsedRequest.data;
    const operator = parsedOperator.data;
    const action = parsedAction.data;
    const requestedAt = parsedRequestedAt.data;

    // 2. The ask must be the ask the governed runtime sanctioned. Before the transport, because a
    //    send carries the operator's proof and a tampered ask must not cost one. The source is
    //    unknown structural input until this returns; it re-proves the whole artifact, including a
    //    recomputed action fingerprint.
    const source = input['source'] as ApprovalRecommendationSource;
    assertFaithfulRequest(source, request);

    // 3. The human acted INSIDE the request's own validity window. Both bounds come from the
    //    request; no clock is read, for the same reason the contracts compare `expiresAt` against
    //    `createdAt` rather than against `now` -- an ask that was valid when it was made must not
    //    become invalid because a machine's clock disagrees. There is deliberately no "time left to
    //    approve" rule beyond the expiry the request itself states.
    if (
      !isAtOrBefore(request.createdAt, requestedAt) ||
      !isStrictlyBefore(requestedAt, request.expiresAt)
    ) {
      return invalid();
    }

    // 4. Serialize. The proof is NOT in the command -- it travels beside it, in a holder the
    //    transport opens for exactly one send.
    const serializedCommand = serializeCommand({ request, operator, action, requestedAt });

    // 5. ONE send. A rejection is `core-unavailable` and nothing was decided; whatever the transport
    //    threw is discarded rather than wrapped, because an HTTP client's exception carries the URL,
    //    the headers and often the request body.
    let serializedResponse: unknown;
    try {
      serializedResponse = await transport.send({ serializedCommand, authorization });
    } catch {
      throw new ApprovalCoreAdapterError('core-unavailable');
    }
    if (typeof serializedResponse !== 'string') {
      throw new ApprovalCoreAdapterError('core-invalid-response');
    }

    // 6. Core's answer, parsed and never repaired. A response that is nearly a decision is not a
    //    decision: filling in a missing field would be Jarvis authoring part of an authorization.
    let parsedResponse: unknown;
    try {
      parsedResponse = JSON.parse(serializedResponse);
    } catch {
      throw new ApprovalCoreAdapterError('core-invalid-response');
    }
    const parsedDecision = approvalDecisionV1Schema.safeParse(parsedResponse);
    if (!parsedDecision.success) {
      throw new ApprovalCoreAdapterError('core-invalid-response');
    }
    const decision = parsedDecision.data;

    // 7. Correlation, through the PUBLIC approval runtime rather than re-derived here, so the
    //    anti-substitution fingerprint check and the request/recommendation/action agreement rules
    //    live in exactly one place.
    const correlation = correlate(source, request, decision);

    // 8. The negative-intent safety rule, over the SELECTED ACTION's verdict.
    //
    //    Partial approval is preserved on purpose: `decision.outcome` may be `approved` because some
    //    OTHER action of the recommendation was approved, while this action was rejected. Checking
    //    the overall outcome would turn that ordinary, correct case into a spurious mismatch.
    //
    //    `decidedBy` is deliberately NOT compared against the operator. Core is authoritative and may
    //    legitimately attribute a refusal to a policy rather than to the person who asked -- and a
    //    check demanding that the decider be the submitter would reject exactly the refusals this
    //    architecture exists to make possible.
    if (action !== 'APPROVE' && correlation.actionDecision.decision !== 'rejected') {
      // A human asked for this action to be refused, and it came back approved. Whatever produced
      // that, it is not this submission faithfully answered.
      throw new ApprovalCoreAdapterError('core-decision-mismatch');
    }

    return deepFreeze({ decision, correlation });
  }

  return Object.freeze({ submit });
}
