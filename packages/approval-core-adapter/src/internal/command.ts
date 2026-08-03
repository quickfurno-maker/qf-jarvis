/**
 * The wire command, its idempotency key, and the private schema that bounds both
 * (QFJ-P08, ADR-0082).
 *
 * INTERNAL, and deliberately so: the command shape is a PROPOSED protocol that QuickFurno Core has
 * not adopted yet. Exporting it would invite a second implementation to depend on a wire format that
 * is still a proposal, and would make the eventual negotiation with Core a breaking change to a
 * published type instead of an internal one.
 *
 * ### The six fields, and the one that is missing
 *
 * `protocol`, `idempotencyKey`, `approvalRequest`, `operator`, `operatorAction`, `requestedAt`. The
 * schema is `strictObject`, so a seventh key is a refusal rather than something Core has to ignore.
 *
 * The AUTHORIZATION PROOF IS NOT A FIELD. It travels beside the command, inside a holder the
 * transport opens for one send. A command is a string: it may be hashed for the key, logged by a
 * transport, retried by an operator, or captured in a test — and a credential inside it would go
 * everywhere the string goes. The separation is what makes those things safe.
 *
 * Also absent, and each for its own reason: no recipient, phone number or address (this is an
 * approval, not a delivery); no execution intent or idempotency key for an action (Core creates
 * those from its own recorded decision); no consent or opt-out flag (a separate contract, and
 * collapsing it here is how an approval quietly becomes permission to contact someone); and no local
 * authority field of any kind, because there is no local authority.
 */
import { createHash } from 'node:crypto';

import {
  approvalRequestV1Schema,
  humanActorSchema,
  utcTimestampSchema,
} from '@qf-jarvis/contracts';
import type { ApprovalRequestV1 } from '@qf-jarvis/contracts';
import { z } from 'zod';

import type { ApprovalOperatorAction, ApprovalOperatorActor } from '../contracts/api.js';
import { ApprovalCoreAdapterError } from '../contracts/errors.js';
import { canonicalJson } from './canonical-json.js';

/** The protocol identifier. Versioned, because a wire format that cannot be versioned cannot move. */
export const APPROVAL_CORE_SUBMISSION_PROTOCOL = 'qfj.approval-core-submission.v1';

/**
 * The domain separator for the idempotency digest.
 *
 * Domain separation costs one string and removes a whole class of question: a digest computed here
 * can never collide with a digest computed elsewhere over structurally similar JSON — an action
 * fingerprint, a Core command hash, a future protocol's key. The trailing newline is part of the
 * separator so the boundary between it and the payload is unambiguous.
 */
export const IDEMPOTENCY_DOMAIN = 'qf-jarvis.approval-core-submission.v1\n';

/** The three human intents, closed. Anything else is not a value this protocol can carry. */
export const operatorActionSchema = z.enum(['APPROVE', 'REJECT', 'REQUEST_CHANGES']);

/** A 64-character lowercase hex digest. */
const idempotencyKeySchema = z.string().regex(/^[a-f0-9]{64}$/);

/**
 * The wire command, exactly.
 *
 * `approvalRequest` is re-validated with the governed schema on the way out, not merely typed. The
 * request has already been proved faithful to its source by this point, so this is belt and braces —
 * but it is the last gate before bytes leave the process, and the cost of it is nothing.
 */
export const approvalCoreSubmissionCommandSchema = z.strictObject({
  protocol: z.literal(APPROVAL_CORE_SUBMISSION_PROTOCOL),
  idempotencyKey: idempotencyKeySchema,
  approvalRequest: approvalRequestV1Schema,
  operator: humanActorSchema,
  operatorAction: operatorActionSchema,
  requestedAt: utcTimestampSchema,
});

/**
 * Derive the idempotency key for one human intent.
 *
 * ### What is in it
 *
 * The identity of the ask (`approvalRequestId`), what the ask is about (`recommendationId`,
 * `proposedActionId`), the CONTENT of the action (`actionFingerprint`), who is acting (`operator`),
 * and what they are asking for (`operatorAction`). Change any of those and it is a different intent,
 * which must be a different key.
 *
 * ### What is deliberately NOT in it
 *
 * `requestedAt` — because a human who clicks, loses the connection, and clicks again ten seconds
 * later is expressing the SAME intent. Including the instant would make every retry a new key, which
 * is precisely the deduplication a Core would want this key for.
 *
 * The authorization proof — because a key is not a secret and must not become one. The key is
 * hashed, compared, logged and stored; a proof mixed into it would be a credential smeared across
 * all of those, and re-authenticating (a fresh session for the same person) would silently change
 * the key of an unchanged intent.
 *
 * ### What this key does NOT claim
 *
 * It is not an exactly-once guarantee, and this package must not be read as offering one. It is a
 * stable, deterministic name for an intent. Whether two sends bearing the same name become one
 * effect is entirely up to Core, which has not adopted this protocol yet. Calling it exactly-once
 * before Core enforces it would be a safety claim backed by nothing.
 */
export function idempotencyKeyFor(input: {
  readonly request: ApprovalRequestV1;
  readonly operator: ApprovalOperatorActor;
  readonly action: ApprovalOperatorAction;
}): string {
  const payload = canonicalJson({
    approvalRequestId: input.request.approvalRequestId,
    recommendationId: input.request.recommendationId,
    proposedActionId: input.request.proposedActionId,
    actionFingerprint: input.request.actionFingerprint,
    operator: input.operator,
    operatorAction: input.action,
  });
  return createHash('sha256')
    .update(IDEMPOTENCY_DOMAIN, 'utf8')
    .update(payload, 'utf8')
    .digest('hex');
}

/**
 * Build and serialize one command.
 *
 * Serialized through the canonical writer, so the same intent at the same instant produces
 * byte-identical output on every machine and every run. A transport that logs the command, a test
 * that asserts on it, and a Core that hashes it all see the same string.
 */
export function serializeCommand(input: {
  readonly request: ApprovalRequestV1;
  readonly operator: ApprovalOperatorActor;
  readonly action: ApprovalOperatorAction;
  readonly requestedAt: string;
}): string {
  const parsed = approvalCoreSubmissionCommandSchema.safeParse({
    protocol: APPROVAL_CORE_SUBMISSION_PROTOCOL,
    idempotencyKey: idempotencyKeyFor(input),
    approvalRequest: input.request,
    operator: input.operator,
    operatorAction: input.action,
    requestedAt: input.requestedAt,
  });
  if (!parsed.success) {
    // Issues are discarded: they would quote the request's summary, its policy citation, or the
    // operator's Core identity.
    throw new ApprovalCoreAdapterError('invalid-input');
  }
  return canonicalJson(parsed.data);
}
