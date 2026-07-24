/**
 * Local structured-output mapping (QFJ-P04.01C, ADR-0047).
 *
 * A STRUCTURED request maps to `response_format` only when the configured local server/model declares the
 * capability. STRICT `json_schema` is used ONLY when strict support is declared AND the JSON Schema meets
 * the strict restrictions (an object with `additionalProperties:false`). Best-effort `json_object` is used
 * when only that mode is declared. When neither is supported the request fails BEFORE any transport call
 * rather than sending an unsupported field. The gateway's local zod validation remains the authority. No
 * provider tools, no streaming, and no hidden model-based JSON repair.
 */
import type { LocalChatRequestBody } from './local-contracts.js';

type ResponseFormat = NonNullable<LocalChatRequestBody['response_format']>;

/** Which structured-output modes the configured local server/model supports. */
export interface LocalStructuredOutputSupport {
  readonly strictJsonSchema: boolean;
  readonly jsonObject: boolean;
}

/** The result of building a response format: either the format, or a pre-transport failure. */
export type ResponseFormatBuild =
  { readonly ok: true; readonly responseFormat: ResponseFormat } | { readonly ok: false };

/** True iff a JSON Schema satisfies strict-mode restrictions (object, additionalProperties false). */
export function isStrictCompatibleJsonSchema(jsonSchema: unknown): boolean {
  if (typeof jsonSchema !== 'object' || jsonSchema === null) {
    return false;
  }
  const schema = jsonSchema as Record<string, unknown>;
  return schema['type'] === 'object' && schema['additionalProperties'] === false;
}

/**
 * Build the `response_format` for a STRUCTURED request against the declared support. A strict-declared
 * server with a non-strict-compatible schema is rejected (`{ ok: false }`) before any transport call; a
 * server that declares neither structured mode also fails before transport.
 */
export function buildResponseFormat(
  jsonSchema: unknown,
  support: LocalStructuredOutputSupport,
): ResponseFormatBuild {
  if (support.strictJsonSchema) {
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
  if (support.jsonObject) {
    return { ok: true, responseFormat: { type: 'json_object' } };
  }
  // The configured server declares no structured-output mode — fail before transport.
  return { ok: false };
}
