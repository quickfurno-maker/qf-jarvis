/**
 * The Core command response contract (QFJ-M3, ADR-0056 §E, §H).
 *
 * The transport returns a serialized response; the adapter parses it with this STRICT schema and then
 * checks its identity against the command. Any command/idempotency/proposal/conversation/revision/
 * protocol mismatch, an unknown outcome, a malformed reason, an invalid instant, or an `ACCEPTED`
 * without exact identity fails closed. It carries no content, prompt, subject, PII, secret, or raw
 * provider/Core error.
 */
import { z } from 'zod';

import { CORE_DECISION_OUTCOMES } from '@qf-jarvis/agent-runtime';
import { isCanonicalInstant } from './digest.js';
import { coreDecisionProtocolSchema } from './protocol.js';
import type { CoreDecisionProtocol } from './protocol.js';
import type { CoreDecisionOutcome } from '@qf-jarvis/agent-runtime';

/** The validated Core command response. */
export interface CoreCommandResponse {
  readonly protocol: CoreDecisionProtocol;
  readonly commandId: string;
  readonly idempotencyKey: string;
  readonly proposalId: string;
  readonly proposalVersion: number;
  readonly conversationId: string;
  readonly boundRevision: number;
  readonly outcome: CoreDecisionOutcome;
  readonly reason: string;
  readonly decidedAt: string;
}

const IDENTIFIER = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9._:-]+$/);
/** An authored artefact version: one-based and bounded. Used here for `proposalVersion` only. */
const VERSION = z.int().min(1).max(1_000_000);

/**
 * A CONVERSATION REVISION, which is not an authored version (QFJ-P08-B3 final review, ADR-0078).
 *
 * `boundRevision` is the conversation revision the Core response echoes back, and
 * `validate-response.ts` compares it to `command.expectedRevision`. Its domain therefore belongs to
 * the durable schema that owns conversation state: migration 0008 requires a new state row to start
 * at **0** and permits values through `Number.MAX_SAFE_INTEGER`.
 *
 * It was validated as an authored `VERSION` — the same semantic-domain conflation found in
 * `@qf-jarvis/agent-runtime`, one layer further out. The consequence was worse here because it
 * arrived late: a revision-0 conversation would pass every M1/M2 gate, produce a model draft, reach
 * Core, receive a legitimate `ACCEPTED` echoing `boundRevision: 0` — and then be discarded as
 * `CORE_UNAVAILABLE` during response validation. The turn looked like a Core outage rather than a
 * bounds bug, which is precisely the kind of misattribution that survives a long time in production.
 *
 * `VERSION` is unchanged. Widening it would have admitted `proposalVersion: 0`, loosening an
 * unrelated contract to fix this one. `REVISION` is private and reaches only `boundRevision`.
 */
const REVISION = z.int().min(0).max(Number.MAX_SAFE_INTEGER);

/** The strict schema a serialized Core response must satisfy. */
export const coreCommandResponseSchema = z
  .object({
    protocol: coreDecisionProtocolSchema,
    commandId: z.string().min(1).max(256),
    idempotencyKey: z.string().regex(/^[0-9a-f]{8,64}$/),
    proposalId: IDENTIFIER,
    proposalVersion: VERSION,
    conversationId: IDENTIFIER,
    boundRevision: REVISION,
    outcome: z.enum(CORE_DECISION_OUTCOMES),
    reason: z
      .string()
      .min(1)
      .max(128)
      .regex(/^[A-Za-z0-9._:-]+$/),
    decidedAt: z.string().refine(isCanonicalInstant),
  })
  .strict();
