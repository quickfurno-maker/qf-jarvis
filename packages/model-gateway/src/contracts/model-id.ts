/**
 * The provider MODEL ID grammar (QFJ-S1C-A).
 *
 * A provider model id is not a generic identifier. Real hosted catalogues namespace their models with
 * a slash — Groq serves `openai/gpt-oss-20b` — and the wire `model` field must carry that value
 * verbatim, because it IS the provider's identifier. The gateway's generic identifier charset
 * (`^[A-Za-z0-9._:-]+$`) has no slash, so it silently made an entire class of real models
 * unexpressible. This module fixes exactly that, and only that.
 *
 * The grammar is an ANCHORED SLASH-SEGMENT form, not "the generic charset plus a slash":
 *
 *     ^[A-Za-z0-9._:-]+(?:/[A-Za-z0-9._:-]+)*$
 *
 * Each segment is a generic identifier, and slashes may only JOIN segments. So a namespaced id is
 * accepted while `/leading`, `trailing/`, `double//slash`, and a bare `/` are all refused — a
 * path-shaped value cannot slip through, and neither can a URL, because `:` may appear inside a
 * segment but `//` may not follow it.
 *
 * Scope discipline: this is applied ONLY to `modelId`. `providerId`, `releaseId`, `modelVersion`,
 * `configDigest`, capability/evaluation/prompt/credential references, rollout ids, and every other
 * generic identifier keep their existing byte-for-byte grammar. Widening the shared charset instead
 * would have loosened validation on a dozen unrelated fields to fix one.
 *
 * Wildcard/`latest` rejection is deliberately NOT part of this grammar: `latest` is a well-formed
 * model id that a caller must still be refused. That refusal lives with the callers that own it
 * (the staging binding's identity guard and the smoke configuration), and is unchanged.
 */
import { z } from 'zod';

/**
 * The anchored slash-segment grammar. Each segment uses the repository's generic identifier charset;
 * a slash may only appear BETWEEN two non-empty segments.
 */
export const PROVIDER_MODEL_ID_PATTERN = /^[A-Za-z0-9._:-]+(?:\/[A-Za-z0-9._:-]+)*$/;

/** The existing repository bound for a model id. Unchanged: every prior `modelId` schema used 128. */
export const MAX_PROVIDER_MODEL_ID_LENGTH = 128;

/** The single canonical schema every provider `modelId` field validates against. */
export const providerModelIdSchema = z
  .string()
  .min(1)
  .max(MAX_PROVIDER_MODEL_ID_LENGTH)
  .regex(PROVIDER_MODEL_ID_PATTERN);

/** True iff `value` is a well-formed, bounded provider model id. Says nothing about approval. */
export function isProviderModelId(value: unknown): value is string {
  return providerModelIdSchema.safeParse(value).success;
}
