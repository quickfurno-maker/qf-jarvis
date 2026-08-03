/**
 * The execution intent correlation runtime (QFJ-P09.01, ADR-0084).
 *
 * ### Jarvis does not issue execution intents. This checks the one Core issued.
 *
 * `ExecutionIntentV1` is created by QuickFurno Core from its own recorded authorization, names n8n
 * as the executor, and is `at-most-once` by construction. Nothing in this package builds one, and
 * nothing in it can dispatch, send, execute, retry, persist, emit, resolve a recipient, choose a
 * provider, or reach n8n or a provider at all. It answers one question:
 *
 * > does this intent faithfully name and reproduce the approved proposed action it cites?
 *
 * ### This is where P09 gains the action identity P08 could not express
 *
 * `CommunicationAuthorizationV1` names an approval DECISION and carries no `approvedActionId`, so
 * ADR-0083 §11 forbade inferring action identity from it and §12 locked P09 to starting from Core's
 * execution intent instead. `ExecutionIntentV1` carries `recommendationId`, `approvalDecisionId`,
 * `approvedActionId`, `actionType`, `actionContractVersion` and `parameters` — the exact fields that
 * were missing. This file is that lock, implemented.
 *
 * So the binding is checked, never guessed. There is no fallback that matches on a template, a
 * purpose code, a channel or a summary when the ids disagree: ids that disagree are a refusal.
 *
 * ### The approval evidence is snapshotted ONCE, before anything reads it
 *
 * The evidence is caller-controlled and loosely typed at its boundary (`source: z.unknown()`), so a
 * hostile object can expose `recommendation` as an accessor that answers differently each time. This
 * function needs the recommendation twice — for the approval re-proof, and to recover the approved
 * action and the expiry bounds — so reading the caller's value twice would let the proof and the
 * comparison see two different, individually valid recommendations sharing the same ids. The intent
 * would then be checked against content nobody approved.
 *
 * So exactly one detached snapshot is taken up front and BOTH phases work from it. After that line,
 * no path here reads `input['approval']` again.
 *
 * ### It reads no clock, and makes no freshness claim
 *
 * Every temporal rule here is a relationship BETWEEN artifacts — a decision cannot post-date the
 * intent citing it, an intent cannot outlive the recommendation whose action it runs. That makes the
 * observation true whenever it is evaluated. Whether the intent is still live *now* is a different
 * question, answered later by the execution side against a trusted execution-side clock, and this
 * package must not be read as having answered it.
 */
import {
  executionIntentV1Schema,
  isAtOrBefore,
  isStrictlyBefore,
  recommendationV1Schema,
} from '@qf-jarvis/contracts';
import type { ExecutionIntentV1, ProposedAction, RecommendationV1 } from '@qf-jarvis/contracts';
import { createApprovalRuntime } from '@qf-jarvis/approval-runtime';
import type { ApprovalDecisionCorrelation } from '@qf-jarvis/approval-runtime';

import { ExecutionIntentRuntimeError } from './contracts/errors.js';
import type { ExecutionIntentObservation, ExecutionIntentRuntime } from './contracts/result.js';
import { deepEqualJson } from './internal/deep-equal-json.js';
import { deepFreeze } from './internal/freeze.js';
import { snapshotApprovalEvidence } from './internal/snapshot.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function mismatch(): never {
  throw new ExecutionIntentRuntimeError('binding-mismatch');
}

/**
 * Re-prove the approval evidence through the PUBLIC approval runtime.
 *
 * Rebuild rather than believe. The runtime re-derives the recommendation, the approval request, the
 * selected action and a RECOMPUTED action fingerprint, and correlates Core's decision against all of
 * them. A caller-supplied `ApprovalDecisionCorrelation` would be that conclusion asserted rather than
 * proved, so only raw evidence is accepted.
 *
 * The runtime's own vocabulary is not propagated: it distinguishes `decision-invalid` from
 * `decision-mismatch`, and both would quote a decision naming an operator and a recommendation.
 */
function proveApproval(evidence: unknown): ApprovalDecisionCorrelation {
  try {
    return createApprovalRuntime().validateDecision(evidence);
  } catch {
    throw new ExecutionIntentRuntimeError('approval-invalid');
  }
}

/** Build the runtime. It takes no configuration, because it has nothing to configure. */
export function createExecutionIntentRuntime(): ExecutionIntentRuntime {
  function validate(input: unknown): ExecutionIntentObservation {
    if (!isRecord(input)) {
      throw new ExecutionIntentRuntimeError('invalid-input');
    }

    // 1. Core's artifact, by its OWN governed schema, never repaired.
    //
    //    Parsing is doing far more work here than it looks. `executionIntentV1Schema` is what
    //    structurally establishes that the issuer is `quickfurno-core`, the executor is `n8n`, the
    //    delivery semantics are `at-most-once`, an idempotency key is present and well-formed,
    //    `issuedAt < expiresAt`, and the parameters are governed -- which is to say they carry no
    //    contact detail, no credential, and no smuggled permission to retry. None of those rules is
    //    restated below: re-implementing them would create a second definition of a contract
    //    `@qf-jarvis/contracts` already owns, free to drift from it.
    const parsedIntent = executionIntentV1Schema.safeParse(input['intent']);
    if (!parsedIntent.success) {
      // Zod issues are discarded: they would quote the parameters, the action type or the
      // idempotency key.
      throw new ExecutionIntentRuntimeError('intent-invalid');
    }
    const intent: ExecutionIntentV1 = parsedIntent.data;

    // 2. ONE detached snapshot of the caller's evidence, taken BEFORE anything inspects it.
    //
    //    This is the only place `input['approval']` is read. Everything below -- the re-proof, the
    //    approved-action recovery, the expiry bounds -- works from `approvalEvidence`, so a getter or
    //    proxy gets exactly one chance to decide what the evidence is, and cannot present one
    //    recommendation to the proof and a different one to the comparison (ADR-0084 §11).
    const approvalEvidence = snapshotApprovalEvidence(input['approval']);

    // 3. The approval evidence, re-proved independently -- against the snapshot.
    const approvalCorrelation = proveApproval(approvalEvidence);

    // 4. The PER-ACTION verdict, not the overall outcome. Under partial approval a decision may be
    //    `approved` overall because a DIFFERENT action was approved while this one was rejected --
    //    and an intent that ran on the overall outcome would execute an action a human refused.
    if (approvalCorrelation.actionDecision.decision !== 'approved') {
      throw new ExecutionIntentRuntimeError('approval-not-approved');
    }

    // 5. IDENTITY. Four exact equalities, and no fallback: this is the binding P08 could not make,
    //    and a near-match is a refusal rather than a hint.
    if (
      intent.recommendationId !== approvalCorrelation.recommendationId ||
      intent.approvalDecisionId !== approvalCorrelation.decision.decisionId ||
      intent.approvedActionId !== approvalCorrelation.proposedActionId ||
      intent.correlationId !== approvalCorrelation.decision.correlationId
    ) {
      return mismatch();
    }

    // 6. The recommendation, taken from the SAME SNAPSHOT the proof consumed and re-parsed with the
    //    governed schema. Two properties matter here and they are separate:
    //
    //      - the SNAPSHOT is why this is the same recommendation the approval runtime saw; and
    //      - re-parsing is why the action and expiry below are read off a validated artifact rather
    //        than a raw object, without reaching into another package's internals for its result.
    const parsedSource = recommendationV1Schema.safeParse(
      isRecord(approvalEvidence) && isRecord(approvalEvidence['source'])
        ? approvalEvidence['source']['recommendation']
        : undefined,
    );
    if (!parsedSource.success) {
      // Unreachable in practice -- the approval runtime parses the same value with the same schema.
      throw new ExecutionIntentRuntimeError('approval-invalid');
    }
    const recommendation: RecommendationV1 = parsedSource.data;

    const approvedAction: ProposedAction | undefined = recommendation.proposedActions.find(
      (action) => action.actionId === intent.approvedActionId,
    );
    if (approvedAction === undefined) {
      // Also unreachable: step 5 tied the intent's action id to the one the approval runtime proved
      // is in this recommendation. Refused rather than assumed, because the alternative is reading
      // `undefined` as "nothing to compare against" and passing.
      return mismatch();
    }

    // 7. CONTENT. The intent must reproduce the approved action exactly -- not approximately, not
    //    compatibly, not "with defaults filled in". Parameters are compared structurally, so key
    //    ORDER is irrelevant while the key SET and every value are not: an extra key, a missing key,
    //    a changed value or a reordered array is a different instruction to the world.
    if (
      intent.actionType !== approvedAction.actionType ||
      intent.actionContractVersion !== approvedAction.actionContractVersion ||
      !deepEqualJson(intent.parameters, approvedAction.parameters)
    ) {
      throw new ExecutionIntentRuntimeError('action-mismatch');
    }

    // 8. TIME, as relationships between artifacts, and against the SNAPSHOT's recommendation. No
    //    clock is read, and none of this claims the intent is live now.
    //
    //    a. An intent cannot predate the Core decision it cites. Whatever that artifact is, it was
    //       not derived from a decision that had not been made.
    //    b. An intent cannot be issued at or after the recommendation expires: a stale
    //       recommendation's action is not one Core may still start.
    //    c. An intent cannot OUTLIVE the recommendation whose approved action it runs. Equal is
    //       allowed -- expiring together is coherent; expiring later is a window in which the
    //       reasoning behind the action has lapsed and the permission has not.
    if (
      !isAtOrBefore(approvalCorrelation.decision.decidedAt, intent.issuedAt) ||
      !isStrictlyBefore(intent.issuedAt, recommendation.expiresAt) ||
      !isAtOrBefore(intent.expiresAt, recommendation.expiresAt)
    ) {
      throw new ExecutionIntentRuntimeError('timing-mismatch');
    }

    return deepFreeze({ intent, approvalCorrelation, approvedAction });
  }

  return Object.freeze({ validate });
}
