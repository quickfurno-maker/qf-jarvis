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
const VERSION = z.int().min(1).max(1_000_000);

/** The strict schema a serialized Core response must satisfy. */
export const coreCommandResponseSchema = z
  .object({
    protocol: coreDecisionProtocolSchema,
    commandId: z.string().min(1).max(256),
    idempotencyKey: z.string().regex(/^[0-9a-f]{8,64}$/),
    proposalId: IDENTIFIER,
    proposalVersion: VERSION,
    conversationId: IDENTIFIER,
    boundRevision: VERSION,
    outcome: z.enum(CORE_DECISION_OUTCOMES),
    reason: z
      .string()
      .min(1)
      .max(128)
      .regex(/^[A-Za-z0-9._:-]+$/),
    decidedAt: z.string().refine(isCanonicalInstant),
  })
  .strict();
