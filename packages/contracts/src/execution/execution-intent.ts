/**
 * ExecutionIntentV1 — a narrow, expiring authorization to do one specific thing.
 *
 * **Jarvis cannot construct a valid one, and that is the entire point.**
 * `issuer` is the literal `quickfurno-core` and `executor` is the literal `n8n`.
 * There is no `qf-jarvis` issuer, and there is no provider executor. The two
 * edges that do not exist — Jarvis to n8n, and Jarvis to a provider — are absent
 * from the type, not merely forbidden by a rule (system-boundary.md).
 *
 * An intent is **not a general permission**. It states the exact action, the exact
 * subject, the exact parameters, an expiry, and an idempotency key. Anything
 * outside those bounds is unauthorized: "an intent to message one client does not
 * authorize messaging a cohort" (execution-governance.md §4).
 *
 * ### At most once, and why the retry keys are banned
 *
 * `deliverySemantics` is the literal `at-most-once`. There is no other value.
 *
 * One execution intent may produce **at most one** provider call initiation. A
 * technical retry re-attempts *the same* execution under the same idempotency key
 * and does not dial again. A legitimate later attempt — after a no-answer, a busy
 * line, a "call me later" — is a **new decision**: a new recommendation, a new
 * approval, a new intent, with its own consent check, attempt-limit check, expiry,
 * and audit trail (communication-model.md).
 *
 * A system that cannot tell those apart will either double-dial or never follow
 * up. So permission to try again cannot be smuggled in as a parameter:
 * `parameters` rejects `retry`, `autoRetry`, `maxAttempts`, `redial`, `resend`,
 * and their variants. A second effect requires a second decision, not a flag.
 *
 * ### What is absent
 *
 * No status. No outcome. No `sent`, no `delivered`, no `completed`. An intent
 * describes what *may* happen; what *did* happen is an execution result, recorded
 * by Core. Collapsing the two is how a founder comes to believe a message arrived
 * when it did not.
 *
 * No provider credential, no phone number, no email address, no webhook secret —
 * `parameters` refuses all of them structurally.
 */

import { z } from 'zod';

import {
  actionIdSchema,
  contractVersionSchema,
  correlationIdSchema,
  decisionIdSchema,
  executionIntentIdSchema,
  idempotencyKeySchema,
  recommendationIdSchema,
} from '../common/identifiers.js';
import { executionParametersSchema } from '../common/governed-parameters.js';
import { n8nSchema, quickfurnoCoreSchema } from '../common/systems.js';
import { machineTokenSchema } from '../common/text.js';
import { isStrictlyBefore, utcTimestampSchema } from '../common/timestamp.js';

/**
 * At-most-once, and nothing else.
 *
 * A literal rather than an enum, because there is no second option to choose
 * between. "Where a provider cannot guarantee idempotency, the action is treated
 * as at-most-once: on ambiguity, it fails rather than repeats. For money-related
 * actions this is not negotiable — and it applies equally to voice calls."
 */
export const deliverySemanticsSchema = z.literal('at-most-once');
export type DeliverySemantics = z.infer<typeof deliverySemanticsSchema>;

export const EXECUTION_INTENT_CONTRACT_VERSION = 1;

const executionIntentShapeSchema = z.strictObject({
  executionIntentId: executionIntentIdSchema,
  contractVersion: z.literal(EXECUTION_INTENT_CONTRACT_VERSION),

  /**
   * The chain back to a decision. All three are mandatory.
   *
   * An auditor must be able to prove that this intent came from exactly one
   * approval decision, against exactly one recommendation, approving exactly one
   * action. An intent that cannot name its approval is an effect with no
   * authorization behind it — which is the one thing this architecture exists to
   * make impossible (execution-governance.md, "what an auditor should be able to
   * prove").
   */
  recommendationId: recommendationIdSchema,
  approvalDecisionId: decisionIdSchema,
  approvedActionId: actionIdSchema,

  actionType: machineTokenSchema,
  actionContractVersion: contractVersionSchema,
  /** The exact, bounded parameters. Governed: no credentials, no contacts, no retry permission. */
  parameters: executionParametersSchema,

  /** Only Core issues an intent. */
  issuer: quickfurnoCoreSchema,
  /** Only n8n executes one. Never a provider, and never Jarvis. */
  executor: n8nSchema,

  issuedAt: utcTimestampSchema,
  /** Mandatory. An expired intent is refused, by n8n, before it acts. */
  expiresAt: utcTimestampSchema,

  /** Mandatory, always. This is what makes a retry safe and a double-send a defect. */
  idempotencyKey: idempotencyKeySchema,

  deliverySemantics: deliverySemanticsSchema,

  correlationId: correlationIdSchema,
});

export const executionIntentV1Schema = executionIntentShapeSchema.superRefine((value, ctx) => {
  if (!isStrictlyBefore(value.issuedAt, value.expiresAt)) {
    ctx.addIssue({
      code: 'custom',
      path: ['expiresAt'],
      message: 'expiresAt must be strictly after issuedAt',
    });
  }
});

export type ExecutionIntentV1 = z.infer<typeof executionIntentV1Schema>;
