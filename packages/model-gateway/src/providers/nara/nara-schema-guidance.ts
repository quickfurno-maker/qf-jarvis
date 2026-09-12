/**
 * Provider-wire schema guidance for a NON-STRICT structured Nara request (JF-5B-R4, ADR-0152).
 *
 * ### Why this exists
 *
 * A strict JSON-Schema endpoint is HANDED the schema and enforces it. NaraRouter publishes no such
 * mode from this repository's observation, so a structured request goes out as
 * `response_format: { type: 'json_object' }` — which asks for "some JSON" and says nothing about which
 * JSON. Two authenticated live runs failed every hard gate for exactly that reason: the model was asked
 * for an object, was never shown the object, answered something reasonable, and local validation
 * correctly refused it.
 *
 * The schema was never missing. It arrives in `ProviderInvocationInput.structuredJsonSchema`, rendered
 * by the gateway for precisely this purpose, and the Groq provider already consumes it. This module is
 * the Nara equivalent for an endpoint that cannot be handed a schema: it puts the SAME document in a
 * message instead.
 *
 * ### It derives, and never restates
 *
 * There is no field name anywhere in this file. The instruction is fixed prose about ENCODING — one
 * object, conform to the schema, no extra properties, no fences, JSON `null` where permitted, nothing
 * but the object — followed by the exact serialized schema it was handed. A handwritten field list here
 * would be a second definition of the reply, and it would drift from the schema the answer is then
 * validated against, which is the failure this repair exists to remove.
 *
 * ### It adds no authority
 *
 * No business policy, no agent vocabulary, no opinion about the turn. Local exact-schema validation
 * remains the only thing that decides whether an answer is acceptable; this only improves the odds that
 * the model produces one. And it fails CLOSED: a structured request whose schema cannot be serialized
 * or does not fit the bound never reaches the network, because a structured request we cannot describe
 * is a request we should not spend on.
 */
import { NARA_MAX_SCHEMA_GUIDANCE_BYTES, NARA_SCHEMA_GUIDANCE_PREFIX } from './nara-config.js';

/**
 * The fixed instruction, verbatim.
 *
 * Deliberately about SHAPE and ENCODING only. Every line addresses a way a chat model breaks a
 * json_object contract in practice: prose around the object, a markdown fence, an invented key, or an
 * omitted key where the schema wanted an explicit null.
 */
const INSTRUCTION: readonly string[] = Object.freeze([
  'Respond with exactly one JSON object and nothing else.',
  'The object must conform exactly to the JSON Schema below.',
  'Include every property the schema requires. Add no additional properties.',
  'Where the schema permits null, use JSON null rather than omitting the property.',
  'Do not wrap the object in markdown, code fences, backticks or any explanatory text.',
  'Output the JSON object only.',
  'JSON Schema:',
]);

export type SchemaGuidance =
  { readonly ok: true; readonly content: string } | { readonly ok: false };

/**
 * Build the provider-owned guidance message, or refuse.
 *
 * Refuses when the schema is absent, cannot be serialized (a cyclic or otherwise unserializable
 * document), or exceeds {@link NARA_MAX_SCHEMA_GUIDANCE_BYTES}. The caller must treat a refusal as a
 * pre-transport failure.
 */
export function buildNaraSchemaGuidance(structuredJsonSchema: unknown): SchemaGuidance {
  if (structuredJsonSchema === undefined || structuredJsonSchema === null) {
    return { ok: false };
  }
  let serialized: string;
  try {
    const candidate = JSON.stringify(structuredJsonSchema);
    if (typeof candidate !== 'string') {
      // `JSON.stringify` answers `undefined` for a function or a bare `undefined`. Neither is a schema.
      return { ok: false };
    }
    serialized = candidate;
  } catch {
    // Cyclic, or a `toJSON` that threw. The raw value is never read, quoted or logged.
    return { ok: false };
  }
  if (serialized.length > NARA_MAX_SCHEMA_GUIDANCE_BYTES) {
    return { ok: false };
  }
  return {
    ok: true,
    content: `${NARA_SCHEMA_GUIDANCE_PREFIX}\n${INSTRUCTION.join('\n')}\n${serialized}`,
  };
}

/**
 * Insert the guidance after the LEADING system messages and before everything else.
 *
 * After, because the application's own system bytes are the authority on the turn and must be read
 * first. Before the user content, because a schema instruction the model reads after the question is an
 * instruction it has already answered around.
 *
 * Returns a NEW array. The caller's messages are never mutated — a provider that rewrote its input
 * would leave the next provider in a fallback chain reading a request nobody built.
 */
export function withSchemaGuidance<T extends { readonly role: string; readonly content: string }>(
  messages: readonly T[],
  guidance: T,
): readonly T[] {
  let insertAt = 0;
  while (insertAt < messages.length && messages[insertAt]?.role === 'system') {
    insertAt += 1;
  }
  return Object.freeze([...messages.slice(0, insertAt), guidance, ...messages.slice(insertAt)]);
}
