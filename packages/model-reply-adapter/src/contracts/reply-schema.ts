/**
 * The strict, provider-neutral structured reply the model must return (QFJ-M4, ADR-0057 §G).
 *
 * This is the schema the gateway validates provider output against (as the request `structuredSchema`)
 * AND the schema the adapter re-validates the returned result with. It is `.strict()`, so any extra key
 * — a chain-of-thought field, a raw provider body/header, a tool-execution result, a send/deliver/
 * execute instruction, a Core `ACCEPTED` status, or arbitrary metadata — makes the result invalid.
 * Closed draft kinds only; a reply body is required for `REPLY` and forbidden for every other kind.
 */
import { z } from 'zod';

/** Closed structured reply kinds. No business-mutation/tool-execution kind exists. */
export const STRUCTURED_REPLY_KINDS = [
  'REPLY',
  'ESCALATE_TO_HUMAN',
  'REQUEST_CLARIFICATION',
  'NO_ACTION',
] as const;
export type StructuredReplyKind = (typeof STRUCTURED_REPLY_KINDS)[number];

const IDENTIFIER = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9._:-]+$/);
const VERSION = z.int().min(1).max(1_000_000);

/** One citation reference the model claims to have used — must match an input-plan citation exactly. */
export interface StructuredReplyCitation {
  readonly knowledgeId: string;
  readonly version: number;
}

/** The provider-neutral structured reply. */
export interface StructuredReply {
  readonly kind: StructuredReplyKind;
  readonly replyBody?: string;
  readonly reasonCode?: string;
  readonly citations: readonly StructuredReplyCitation[];
}

/** The strict schema. A `REPLY` requires a bounded reply body; any other kind must omit it. */
export const structuredReplySchema = z
  .object({
    kind: z.enum(STRUCTURED_REPLY_KINDS),
    replyBody: z.string().min(1).max(8192).optional(),
    reasonCode: z
      .string()
      .min(1)
      .max(64)
      .regex(/^[A-Za-z0-9._:-]+$/)
      .optional(),
    citations: z.array(z.object({ knowledgeId: IDENTIFIER, version: VERSION }).strict()).max(64),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.kind === 'REPLY' && (value.replyBody === undefined || value.replyBody.length === 0)) {
      ctx.addIssue({ code: 'custom', message: 'REPLY requires a reply body.' });
    }
    if (value.kind !== 'REPLY' && value.replyBody !== undefined) {
      ctx.addIssue({ code: 'custom', message: 'A non-REPLY reply must omit the reply body.' });
    }
  });
