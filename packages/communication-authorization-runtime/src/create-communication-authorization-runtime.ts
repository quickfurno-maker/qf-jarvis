/**
 * The communication authorization correlation runtime (QFJ-P08, ADR-0083).
 *
 * ### QuickFurno Core is the consent authority. This proves the paperwork, and nothing else.
 *
 * Given a `CommunicationRequestV1`, the `CommunicationAuthorizationV1` Core returned, and — when
 * Core said yes — the approval evidence behind it, this proves the artifacts describe each other and
 * returns a frozen observation. It asks Core nothing, sends nothing, persists nothing, and holds no
 * consent, opt-out, STOP, suppression or eligibility state of its own. All of that belongs to the
 * QuickFurno Communication Core, and *"Jarvis must not create parallel consent, preference,
 * suppression, STOP/START or delivery state — not as a flag, not as a list, not as a cache"*
 * (communication-model.md).
 *
 * ### The invariant this file exists to hold
 *
 * **Founder approval does not override an opt-out.**
 *
 * A human can approve a message to a client who has withdrawn consent, and Core will refuse it. That
 * refusal is not an error here and not a condition to be recovered from — it is an ordinary,
 * successful, authoritative observation. The runtime never retries it, never reinterprets it, never
 * downgrades it, and never lets the presence of an approved action turn it into anything else. Two
 * different questions were asked; a communication needs *both* answers to be yes, and this one is
 * no.
 *
 * ### What "authorized" is allowed to mean here — and exactly where the claim stops
 *
 * The authorization NAMES a Core approval decision, and the supplied evidence proves an approved
 * action WITHIN that named decision, on the same correlation thread. So an authorized outcome
 * requires approval evidence, re-proved through the PUBLIC approval runtime, whose **per-action**
 * verdict must be `approved` — not merely the overall decision outcome, which under partial approval
 * may be `approved` because some *other* action was.
 *
 * **That is the whole guarantee, and it is decision-level rather than action-level.**
 * `CommunicationAuthorizationV1` carries `approvalDecisionId` and no `approvalRequestId`,
 * `proposedActionId` or `actionFingerprint`; `ApprovalDecisionV1` is recommendation-level and may
 * cover several actions. So nothing here proves that the action the supplied evidence selected is
 * structurally the action this `CommunicationRequestV1` represents — there is no field by which that
 * comparison could be made, and inferring it from `actionType`, parameters, the summary, the template
 * reference or the purpose code would be a heuristic standing in for an authority decision. QuickFurno
 * Core owns that semantic binding, because Core is the party that issues the authorization
 * (ADR-0083 §11).
 *
 * And even then, the result carries no permission. Core's record says what Core decided WHEN it
 * decided; the contract carries no `validUntil` and no consent snapshot precisely so it cannot travel
 * forward in time. Eligibility is revalidated at execution time by Core and the communications
 * runtime, and that answer is the one that counts.
 *
 * It reads no clock, opens no socket, touches no database, and cannot reach Meta, n8n, a provider or
 * an execution intent.
 */
import {
  communicationAuthorizationV1Schema,
  communicationRequestV1Schema,
  isAtOrBefore,
  isStrictlyBefore,
} from '@qf-jarvis/contracts';
import type { CommunicationAuthorizationV1, CommunicationRequestV1 } from '@qf-jarvis/contracts';
import { createApprovalRuntime } from '@qf-jarvis/approval-runtime';
import type { ApprovalDecisionCorrelation } from '@qf-jarvis/approval-runtime';

import { CommunicationAuthorizationRuntimeError } from './contracts/errors.js';
import type {
  CommunicationAuthorizationObservation,
  CommunicationAuthorizationRuntime,
} from './contracts/result.js';
import { deepFreeze } from './internal/freeze.js';
import { knownRefusalReason } from './internal/known-refusal.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function mismatch(): never {
  throw new CommunicationAuthorizationRuntimeError('binding-mismatch');
}

/**
 * Re-prove approval evidence through the PUBLIC approval runtime.
 *
 * Rebuild rather than believe. A caller could hand over an `ApprovalDecisionCorrelation` it built
 * itself, and accepting one would let it assert the very thing this runtime exists to prove — that
 * the SUPPLIED approval request, recommendation and Core decision genuinely agree, against a
 * RECOMPUTED action fingerprint. So the raw evidence goes back through `validateDecision` every time.
 *
 * What comes back is a proof about the EVIDENCE, not about the communication request. Its
 * `proposedActionId` is the action the supplied approval evidence selected; the communication
 * contracts carry no action identity to compare it against (ADR-0083 §11).
 *
 * The runtime's own error vocabulary is deliberately not propagated. It distinguishes
 * `decision-invalid` from `decision-mismatch`, and both would be quoting a decision that names an
 * operator and a recommendation; this package's vocabulary is closed, and the caller learns only
 * that the evidence did not hold up.
 */
function proveApproval(evidence: unknown): ApprovalDecisionCorrelation {
  try {
    return createApprovalRuntime().validateDecision(evidence);
  } catch {
    throw new CommunicationAuthorizationRuntimeError('approval-invalid');
  }
}

/** Build the runtime. It takes no configuration, because it has nothing to configure. */
export function createCommunicationAuthorizationRuntime(): CommunicationAuthorizationRuntime {
  function validate(input: unknown): CommunicationAuthorizationObservation {
    if (!isRecord(input)) {
      throw new CommunicationAuthorizationRuntimeError('invalid-input');
    }

    // 1. Both artifacts, by their OWN governed schemas. Neither is ever repaired: a response that is
    //    nearly an authorization is not an authorization, and filling in a missing field would be
    //    Jarvis authoring part of Core's answer.
    //
    //    A non-Core `issuer` fails HERE, as `authorization-invalid`, because `quickfurnoCoreSchema`
    //    is a literal. That is the right place for it: a Jarvis-issued artifact is not a Core
    //    artifact with a wrong label, and normalizing one into the other is how a system ends up
    //    authorizing itself.
    const parsedRequest = communicationRequestV1Schema.safeParse(input['request']);
    if (!parsedRequest.success) {
      // Zod issues are discarded: they would quote the recipient, the summary, the purpose code or
      // the template variables.
      throw new CommunicationAuthorizationRuntimeError('request-invalid');
    }
    const parsedAuthorization = communicationAuthorizationV1Schema.safeParse(
      input['authorization'],
    );
    if (!parsedAuthorization.success) {
      // Likewise, and more sharply: an issue here would quote `reasonCode`, which is routinely
      // `recipient-opted-out` about a specific person.
      throw new CommunicationAuthorizationRuntimeError('authorization-invalid');
    }
    const request: CommunicationRequestV1 = parsedRequest.data;
    const authorization: CommunicationAuthorizationV1 = parsedAuthorization.data;

    // 2. The three identities that make this Core's answer to THIS ask. All must agree exactly.
    if (
      authorization.communicationId !== request.communicationId ||
      authorization.communicationRequestId !== request.communicationRequestId ||
      authorization.correlationId !== request.correlationId
    ) {
      return mismatch();
    }

    // 3. Time, through the contract's comparators and never by comparing RFC 3339 strings -- the
    //    grammar admits fractional seconds, and `...:00.5Z` sorts BEFORE `...:00Z` lexicographically
    //    while being after it in time.
    //
    //    An answer cannot predate the question. Whatever this artifact is, it is not a decision
    //    about a request that did not exist yet.
    if (!isAtOrBefore(request.createdAt, authorization.decidedAt)) {
      return mismatch();
    }

    // 4. An EXPIRED request cannot become authorized. The asymmetry is deliberate and load-bearing:
    //    a REJECTION at or after expiry is perfectly safe and must be recordable, because Core
    //    refusing a request that has since died creates no permission and hides nothing. Refusing to
    //    observe a late refusal would mean the safest possible answer was the one Jarvis could not
    //    write down.
    if (
      authorization.outcome === 'authorized' &&
      !isStrictlyBefore(authorization.decidedAt, request.expiresAt)
    ) {
      return mismatch();
    }

    // 5. Approval evidence, if any was supplied. Re-proved on BOTH outcomes -- evidence attached to
    //    a refusal still has to be evidence -- and required on neither yet.
    const evidence: unknown = input['approval'];
    let approvalCorrelation: ApprovalDecisionCorrelation | undefined;
    if (evidence !== undefined) {
      approvalCorrelation = proveApproval(evidence);
      // The same causal thread. An approval from an unrelated conversation is not this
      // communication's approval, however valid it is in its own right.
      if (approvalCorrelation.decision.correlationId !== request.correlationId) {
        return mismatch();
      }
    }

    if (authorization.outcome === 'authorized') {
      // 6. Core said yes, so a human must have said yes too. The contract already forces Core's
      //    artifact to NAME an approval decision; this is where the named decision is actually
      //    produced and re-proved rather than assumed to exist somewhere.
      //
      //    Note what this establishes: an approved action WITHIN the decision Core named. Not that
      //    the communication request represents that action -- the artifacts carry no field that
      //    would let anything here check it (ADR-0083 §11).
      if (approvalCorrelation === undefined) {
        throw new CommunicationAuthorizationRuntimeError('approval-required');
      }

      // 7. The PER-ACTION verdict, not the overall outcome. Under partial approval a decision may be
      //    `approved` overall because a DIFFERENT action was approved while the supplied evidence's
      //    action was rejected -- and reading the overall outcome would accept an authorization
      //    backed by a refusal.
      if (approvalCorrelation.actionDecision.decision !== 'approved') {
        throw new CommunicationAuthorizationRuntimeError('approval-not-approved');
      }

      // 8. And it must be the EXACT decision Core named. Any other approved decision, however
      //    genuine, is not the one this authorization cites. This is the tightest binding the
      //    current contracts can express: decision identity, not action identity.
      if (authorization.approvalDecisionId !== approvalCorrelation.decision.decisionId) {
        return mismatch();
      }
    }

    // 9. Classification, for observability only -- and only for a refusal. Nothing branches on it,
    //    an unknown reason is exactly as binding as a named one, and `reasonCode` is preserved
    //    verbatim on the authorization either way.
    const known =
      authorization.outcome === 'rejected'
        ? knownRefusalReason(authorization.reasonCode)
        : undefined;

    return deepFreeze({
      request,
      authorization,
      ...(approvalCorrelation === undefined ? {} : { approvalCorrelation }),
      ...(known === undefined ? {} : { knownRefusalReason: known }),
    });
  }

  return Object.freeze({ validate });
}
