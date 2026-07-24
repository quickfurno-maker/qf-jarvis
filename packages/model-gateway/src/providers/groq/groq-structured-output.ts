/**
 * Groq structured-output mapping (QFJ-P04.01B, ADR-0046).
 *
 * A STRUCTURED request maps to `response_format`. STRICT `json_schema` is used ONLY when the configured
 * model capability declares strict support AND the JSON Schema meets Groq's strict restrictions (an
 * object with `additionalProperties:false`); otherwise the request fails BEFORE any transport call
 * rather than sending an invalid strict schema. When strict is not supported, best-effort `json_object`
 * mode is used and the gateway's local zod validation remains the authority. No provider tools, no
 * streaming, and no hidden model-based JSON repair.
 */
import type { GroqChatRequestBody } from './groq-contracts.js';

type ResponseFormat = NonNullable<GroqChatRequestBody['response_format']>;

/** The result of building a response format: either the format, or a pre-transport failure. */
export type ResponseFormatBuild =
  { readonly ok: true; readonly responseFormat: ResponseFormat } | { readonly ok: false };

/** True iff a JSON Schema satisfies Groq's strict-mode restrictions (object, additionalProperties false). */
export function isStrictCompatibleJsonSchema(jsonSchema: unknown): boolean {
  if (typeof jsonSchema !== 'object' || jsonSchema === null) {
    return false;
  }
  const schema = jsonSchema as Record<string, unknown>;
  return schema['type'] === 'object' && schema['additionalProperties'] === false;
}

/**
 * Build the `response_format` for a STRUCTURED request. In strict mode a non-strict-compatible schema is
 * rejected (`{ ok: false }`) before any transport call.
 */
export function buildResponseFormat(
  jsonSchema: unknown,
  strictSupported: boolean,
): ResponseFormatBuild {
  if (strictSupported) {
    if (!isStrictCompatibleJsonSchema(jsonSchema)) {
      return { ok: false };
    }
    return {
      ok: true,
      responseFormat: {
        type: 'json_schema',
        json_schema: { name: 'qf_structured_output', strict: true, schema: jsonSchema },
      },
    };
  }
  return { ok: true, responseFormat: { type: 'json_object' } };
}
