/**
 * ApprovalRequestV1 — Jarvis asking. Never Jarvis deciding.
 *
 * This is the artifact that was missing, and its absence mattered: without it, the
 * only two shapes in the approval path were a *recommendation* (Jarvis's) and a
 * *decision* (Core's), and the act of **asking** had nowhere to live. Systems in
 * that position invariably grow a shortcut — a recommendation with a `submitted`
 * flag, a decision with a `pending` outcome — and both of those put a piece of the
 * authorization state inside Jarvis, which is the one place it may never be.
 *
 * So asking is its own contract, and it is deliberately powerless.
 *
 * ### It has no authority, and cannot be given any
 *
 * `producingSystem` is the literal `qf-jarvis`. There is **no outcome field, no
 * decision field, no approved field, no decidedBy field, and no validUntil field** —
 * the shape is strict, so a caller cannot add one. An approval request that has been
 * granted is not an approval request with a flag set; it is an
 * `ApprovalDecisionV1`, issued by Core, which is a different contract with a
 * different issuer (see approval-decision.ts).
 *
 * The distinction is the whole architecture in miniature: **Jarvis may state what it
 * wants and why. It may never state what it got.**
 *
 * ### Expiry is mandatory, and expiry is not approval
 *
 * `expiresAt` is required. A request that nobody answers **dies**; it does not
 * ripen. There is no timeout-to-approve, and there is no field in which one could
 * be expressed — "silence is never consent"
 * (docs/architecture/execution-governance.md §2).
 *
 * This is worth being blunt about because the opposite behavior is a common and
 * catastrophic convenience: a queue that auto-approves what nobody got to is a
 * queue that approves precisely the things nobody understood.
 *
 * ### The fingerprint binds the request to one exact action
 *
 * `actionFingerprint` is a digest of the proposed action as it was worded when it
 * was proposed. An approval answers *that* action — not whatever the `actionId`
 * happens to point at later. See common/identifiers.ts.
 *
 * ### What is structurally absent
 *
 * No contact details — there is no field for a phone number or an email address,
 * and the recipient of anything is Core's to resolve. No credentials. No execution
 * fields: no idempotency key, no executor, no delivery semantics, no expiry-of-an-
 * intent. **A request cannot be mistaken for an intent, because it cannot carry the
 * things an intent needs in order to act.**
 */

import { z } from 'zod';

import {
  actionFingerprintSchema,
  actionIdSchema,
  approvalRequestIdSchema,
  correlationIdSchema,
  eventIdSchema,
  recommendationIdSchema,
} from '../common/identifiers.js';
import { agentIdSchema, qfJarvisSchema } from '../common/systems.js';
import { approvalLevelSchema, riskClassSchema } from '../recommendations/recommendation.js';
import { boundedText, machineTokenSchema, TEXT_LIMITS } from '../common/text.js';
import { isStrictlyBefore, utcTimestampSchema } from '../common/timestamp.js';
import { policyReferenceSchema } from '../common/policy.js';

export const APPROVAL_REQUEST_CONTRACT_VERSION = 1;

/** Approval levels that satisfy "stronger approval" for money-related actions. */
const STRONGER_APPROVAL_LEVELS = ['stronger-approval', 'founder'] as const;

const approvalRequestShapeSchema = z.strictObject({
  approvalRequestId: approvalRequestIdSchema,
  contractVersion: z.literal(APPROVAL_REQUEST_CONTRACT_VERSION),

  /** The recommendation this asks about. */
  recommendationId: recommendationIdSchema,

  /** Which proposed action, and exactly as it was worded when proposed. */
  proposedActionId: actionIdSchema,
  actionFingerprint: actionFingerprintSchema,

  /**
   * The authority Jarvis believes this needs.
   *
   * A *request*, not a grant — and notably not a *ceiling*. Core may decide that a
   * stronger authority is required than the one asked for. Core may not decide that
   * a weaker one is: the requested level is a floor, and Core enforces its own
   * policy above it (execution-governance.md §9).
   */
  requestedAuthority: approvalLevelSchema,
  risk: riskClassSchema,

  createdAt: utcTimestampSchema,
  /** Mandatory. An unanswered request expires; it never ripens into an approval. */
  expiresAt: utcTimestampSchema,

  /** Only QF Jarvis asks. The literal is the boundary. */
  producingSystem: qfJarvisSchema,
  requestingAgent: agentIdSchema,
  /** So that a badly-reasoned request is attributable to a specific agent build. */
  requestingAgentVersion: machineTokenSchema,

  /** What a human will read first. Concise on purpose: an approver who scrolls stops reading. */
  summary: boundedText(TEXT_LIMITS.summary),

  /**
   * The policy Jarvis believed applied when it asked.
   *
   * A citation, never an authority. If Jarvis observed policy v3 and Core is now on
   * v4, Core's answer is the one that counts — and the mismatch is *visible*, which
   * is the entire reason to record what was observed.
   */
  policy: policyReferenceSchema,

  correlationId: correlationIdSchema,
  causationEventId: eventIdSchema.optional(),
});

export const approvalRequestV1Schema = approvalRequestShapeSchema.superRefine((value, ctx) => {
  // Expiry is checked against creation, never against `now`. Validation reads no
  // clock: a request that was valid when it was made must not become invalid
  // because it was replayed tomorrow (ADR-0003).
  if (!isStrictlyBefore(value.createdAt, value.expiresAt)) {
    ctx.addIssue({
      code: 'custom',
      path: ['expiresAt'],
      message: 'expiresAt must be strictly after createdAt',
    });
  }

  // Asking for "no approval" is not asking for approval. An action that genuinely
  // needs none is informational, and it does not travel this path at all.
  if (value.requestedAuthority === 'none') {
    ctx.addIssue({
      code: 'custom',
      path: ['requestedAuthority'],
      message:
        'An approval request must request a real authority. "none" is not an approval path — an action requiring no approval is informational and executes nothing',
    });
  }

  // Informational items propose nothing, so there is nothing to approve.
  if (value.risk === 'informational') {
    ctx.addIssue({
      code: 'custom',
      path: ['risk'],
      message:
        'An informational recommendation proposes no action and requires no approval, so it must not produce an approval request',
    });
  }

  // Money escalates, always — and it escalates in the *request*, not only in the
  // decision. A request that under-asks for a money-related action is how an
  // approval quietly reaches a delegated approver who should never have seen it.
  if (
    value.risk === 'money-related' &&
    !STRONGER_APPROVAL_LEVELS.some((level) => level === value.requestedAuthority)
  ) {
    ctx.addIssue({
      code: 'custom',
      path: ['requestedAuthority'],
      message: 'A money-related approval request must request "stronger-approval" or "founder"',
    });
  }

  // Outbound voice requires an explicit human on every call
  // (docs/governance/automation-levels.md).
  if (
    value.risk === 'outbound-voice-call' &&
    !STRONGER_APPROVAL_LEVELS.some((level) => level === value.requestedAuthority)
  ) {
    ctx.addIssue({
      code: 'custom',
      path: ['requestedAuthority'],
      message:
        'An outbound voice call requires explicit human approval, so it must request "stronger-approval" or "founder"',
    });
  }
});

export type ApprovalRequestV1 = z.infer<typeof approvalRequestV1Schema>;
