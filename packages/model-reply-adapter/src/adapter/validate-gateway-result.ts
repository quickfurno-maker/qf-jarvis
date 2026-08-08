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
import type { ModelReplyStructuredOutputProfile } from '../contracts/structured-output-profile.js';

export type StructuredResultValidation =
  | { readonly ok: true; readonly reply: StructuredReply; readonly detail?: unknown }
  | { readonly ok: false };

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

/**
 * Validate a structured result through a configured PROFILE (ADR-0099).
 *
 * The profile projects the provider's answer to a reply plus optional detail, and that reply is then
 * RE-PROVED against the base `structuredReplySchema`. The re-proof is the point: a profile chooses
 * the shape of the answer, not what counts as a reply, and without it a projection could hand the
 * rest of the adapter something the strict schema would have refused.
 *
 * A profile that throws is treated exactly as one that refused. Nothing it produced is inspected,
 * repaired or partially accepted, and no raw provider value escapes this function.
 */
export function validateProfileStructuredResult(
  response: ModelResponse,
  profile: ModelReplyStructuredOutputProfile,
): StructuredResultValidation {
  if (response.resultMode !== 'STRUCTURED') {
    return { ok: false };
  }
  let projected;
  try {
    projected = profile.projectStructuredResult(response.structuredResult);
  } catch {
    return { ok: false };
  }
  if (projected === undefined) {
    return { ok: false };
  }
  const parsed = structuredReplySchema.safeParse(projected.reply);
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
  return projected.detail === undefined
    ? { ok: true, reply }
    : { ok: true, reply, detail: projected.detail };
}
