/**
 * The ONE fixed synthetic smoke prompt (QFJ-S1A, ADR-0061 §F).
 *
 * This module is the entire prompt surface of the harness. The messages are a frozen literal in SOURCE:
 * they cannot be replaced by a CLI argument, by the configuration file, or by stdin, because nothing in
 * the harness ever reads prompt text from any of those. The content is a pure connectivity probe — no
 * client, vendor, or subject data; no phone number, name, note, or conversation history; nothing whose
 * disclosure would matter and nothing whose answer has business meaning. The result is discarded.
 *
 * The family/version/schema-revision constants below are the values the configuration must match
 * EXACTLY (see `config.ts`), so a configuration cannot claim to be exercising a different prompt than
 * the one compiled in here.
 */
import { z } from 'zod';

/** The exact prompt family identifier bound into the staging release and the bind event. */
export const SMOKE_PROMPT_FAMILY = 'qfj.s1a.synthetic.smoke';

/** The exact prompt version bound into the staging release and the bind event. */
export const SMOKE_PROMPT_VERSION = 1;

/** The exact strict-JSON-schema revision reference the configuration must name. */
export const SMOKE_SCHEMA_REVISION = 'qfj.s1a.synthetic.smoke.schema.v1';

/**
 * The fixed synthetic messages. Frozen, and frozen element-wise, so a caller cannot mutate them into
 * something that carries real data.
 */
export const SYNTHETIC_SMOKE_MESSAGES: readonly {
  readonly role: 'system' | 'user' | 'assistant';
  readonly content: string;
}[] = Object.freeze([
  Object.freeze({
    role: 'system' as const,
    content:
      'You are a staging connectivity probe. Reply with a single JSON object and no other text.',
  }),
  Object.freeze({
    role: 'user' as const,
    content: 'Reply with exactly this JSON object: {"probe":"ok"}',
  }),
]);

/**
 * The strict JSON Schema sent as `response_format`. It satisfies Groq's strict restrictions (an object
 * with `additionalProperties: false` and an explicit `required`), so strictness is never downgraded.
 */
export const SYNTHETIC_SMOKE_JSON_SCHEMA: unknown = Object.freeze({
  type: 'object',
  additionalProperties: false,
  properties: Object.freeze({ probe: Object.freeze({ type: 'string' }) }),
  required: Object.freeze(['probe']),
});

/** The local authority on the returned shape. A value that fails this is `smoke-provider-malformed`. */
const syntheticSmokeResponseSchema = z.object({ probe: z.string().min(1).max(64) }).strict();

/** True iff the provider's structured value is the expected tiny probe object. Never logs the value. */
export function isSyntheticSmokeResponse(value: unknown): boolean {
  return syntheticSmokeResponseSchema.safeParse(value).success;
}
