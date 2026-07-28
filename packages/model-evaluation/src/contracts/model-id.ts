/**
 * The provider MODEL ID grammar for evaluation bindings (QFJ-S1C-B).
 *
 * ## Why this is a deliberate mirror, not a shared import
 *
 * The canonical implementation lives in
 * `packages/model-gateway/src/contracts/model-id.ts` (QFJ-S1C-A). This package cannot import it:
 * `@qf-jarvis/model-evaluation` depends on `zod` and nothing else, and it must stay that way — an
 * evaluation record is evidence ABOUT a provider release, so making the evidence package depend on
 * the gateway that produces the thing it evaluates inverts the direction that keeps evaluation an
 * independent check. There is also no neutral leaf package that both already depend on: the only
 * candidate, `@qf-jarvis/contracts`, is the QuickFurno **Core**-facing data-contract package with its
 * own compatibility manifest, and a provider identity grammar does not belong there.
 *
 * So the grammar is mirrored, and the mirror is PROVEN rather than trusted:
 * `src/tests/provider-model-id.test.ts` reads the canonical source, reconstructs its pattern and
 * length bound, and asserts both textual and behavioural equality against the constants below across
 * a shared corpus. If either side drifts by a single character, that test fails.
 *
 * ## The grammar
 *
 *     ^[A-Za-z0-9._:-]+(?:/[A-Za-z0-9._:-]+)*$
 *
 * Anchored slash-SEGMENT form. Each segment is a generic identifier and a slash may only JOIN two
 * non-empty segments, so a real namespaced catalogue id (`openai/gpt-oss-20b`) is expressible while
 * `/leading`, `trailing/`, `double//slash`, a bare `/`, and every URL shape stay refused.
 *
 * Scope: this applies ONLY to `modelId`. `releaseId`, `providerId`, `modelVersion`, `configDigest`,
 * `capabilityProfileRef`, prompt families, suite ids, and every other identifier in this package keep
 * their existing generic grammar, byte for byte.
 *
 * Wildcard/`latest` governance is deliberately NOT encoded here — `latest` is a well-formed string
 * that a caller must still be refused, and that refusal belongs to the governance layer that owns it.
 */
import { z } from 'zod';

/**
 * The anchored slash-segment grammar. Byte-identical to the canonical gateway pattern; the
 * cross-package invariant test is what keeps that true.
 */
export const PROVIDER_MODEL_ID_PATTERN = /^[A-Za-z0-9._:-]+(?:\/[A-Za-z0-9._:-]+)*$/;

/** The model-id length bound. Identical to the canonical bound and to this package's prior `IDENTIFIER`. */
export const MAX_PROVIDER_MODEL_ID_LENGTH = 128;

/** The schema every provider `modelId` in an evaluation binding validates against. */
export const providerModelIdSchema = z
  .string()
  .min(1)
  .max(MAX_PROVIDER_MODEL_ID_LENGTH)
  .regex(PROVIDER_MODEL_ID_PATTERN);

/** True iff `value` is a well-formed, bounded provider model id. Says nothing about approval. */
export function isProviderModelId(value: unknown): value is string {
  return providerModelIdSchema.safeParse(value).success;
}
