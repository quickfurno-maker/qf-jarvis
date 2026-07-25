/**
 * Strict structured-result validation (QFJ-M4, ADR-0057 §G).
 *
 * The gateway result must be a STRUCTURED result that satisfies the strict provider-neutral reply
 * schema. Any non-structured mode, malformed value, unknown kind, extra field (chain-of-thought, raw
 * provider body/header, tool result, send/deliver/execute instruction, Core `ACCEPTED`, arbitrary
 * metadata), oversized reply, or a `REPLY` without a body fails closed. Returns the frozen reply.
 */
import type { ModelResponse } from '@qf-jarvis/model-gateway';

import { structuredReplySchema, type StructuredReply } from '../contracts/reply-schema.js';

export type StructuredResultValidation =
  { readonly ok: true; readonly reply: StructuredReply } | { readonly ok: false };

/** Validate and freeze the structured reply carried by a gateway response. */
export function validateStructuredResult(response: ModelResponse): StructuredResultValidation {
  if (response.resultMode !== 'STRUCTURED') {
    return { ok: false };
  }
  const parsed = structuredReplySchema.safeParse(response.structuredResult);
  if (!parsed.success) {
    return { ok: false };
  }
  const data = parsed.data;
  const reply: StructuredReply = Object.freeze({
    kind: data.kind,
    ...(data.replyBody === undefined ? {} : { replyBody: data.replyBody }),
    ...(data.reasonCode === undefined ? {} : { reasonCode: data.reasonCode }),
    citations: Object.freeze(data.citations.map((c) => Object.freeze({ ...c }))),
  });
  return { ok: true, reply };
}
