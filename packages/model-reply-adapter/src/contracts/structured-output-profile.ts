/**
 * The optional structured-output profile seam (QFJ-M4, ADR-0057; introduced by ADR-0099).
 *
 * ### What it is for
 *
 * One agent scope may need the model's single structured answer to carry more than a reply. A profile
 * lets a CALLER supply the strict schema that answer must satisfy, the bounded user-message content
 * that asks for it, and the projection back down to the ordinary `StructuredReply` this adapter
 * already knows how to gate.
 *
 * It exists so a richer single inference stays ONE inference. Without it, the only way to obtain
 * anything beside a reply would be a second gateway call — which is exactly the shape the runtime's
 * at-most-one-model-invocation rule forbids.
 *
 * ### It is deliberately generic
 *
 * Nothing here names an agent, a domain vocabulary, a conversational state or a business concept.
 * This module is infrastructure: it knows that *a* caller wants *a* different strict schema and *a*
 * different user message, and nothing about what either contains. A profile that made this package
 * aware of one agent's semantics would make every other agent's adapter carry them too.
 *
 * ### What a profile may NOT change
 *
 * The system message stays EXACTLY the resolved prompt definition's bytes — no prefix, no suffix, no
 * appended policy, no interpolation. Provider routing, fallback, release binding, prompt-digest
 * matching, citation authorization and both state gates are untouched. A profile chooses the SHAPE
 * of the question and the answer; it never chooses who answers, or whether the answer is allowed.
 *
 * ### When one is absent
 *
 * The adapter behaves exactly as it did before this seam existed: the same `structuredReplySchema`,
 * the same `plan.normalizedText ?? ''` user message, the same validation path, the same result keys.
 * That is asserted, not assumed.
 */
import type { ReplyPlan } from '@qf-jarvis/agent-runtime';
import type { ZodType } from 'zod';

import type { StructuredReply } from './reply-schema.js';

/** What a profile's projection yields: the ordinary reply, plus anything else the caller asked for. */
export interface ModelReplyStructuredProjection {
  /**
   * The reply this adapter will gate exactly as it gates any other.
   *
   * It is re-proved against the base `structuredReplySchema` after projection, so a profile cannot
   * widen what counts as a reply by projecting something the strict schema would refuse.
   */
  readonly reply: StructuredReply;
  /**
   * Anything else the profile validated out of the same structured answer.
   *
   * `unknown` at this boundary on purpose: giving it a type would mean this package knowing what the
   * extra material is. The profile's own package owns its shape and provides the parser for it.
   */
  readonly detail?: unknown;
}

/** An explicitly configured structured-output profile. Absent by default. */
export interface ModelReplyStructuredOutputProfile {
  /**
   * The STRICT schema the gateway must validate the provider's structured answer against.
   *
   * It replaces `structuredReplySchema` in the request only. Strictness is the profile's
   * responsibility and the adapter does not relax anything on its behalf.
   */
  readonly structuredSchema: ZodType;
  /**
   * Build the ONE user message. The system message remains the resolved prompt's bytes.
   *
   * A profile that throws is treated as an invalid structured-output configuration; the adapter
   * fails closed before the gateway rather than sending a half-built request.
   */
  buildUserContent(plan: ReplyPlan): string;
  /**
   * Project a validated structured answer to a reply plus optional detail, or `undefined` to refuse.
   *
   * Returning `undefined` — or throwing — is `model-structured-output-invalid`. The adapter never
   * inspects, repairs or partially accepts a profile's answer.
   */
  projectStructuredResult(value: unknown): ModelReplyStructuredProjection | undefined;
}
