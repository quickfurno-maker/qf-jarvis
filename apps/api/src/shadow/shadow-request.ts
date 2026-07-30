/**
 * The fixed synthetic SHADOW request (QFJ-S2-E-B, ADR-0065 §9).
 *
 * The prompt literal and the output schema live HERE, in source, and are reachable from neither the CLI
 * nor the run configuration. A runtime-supplied prompt is exactly how a synthetic validation becomes a
 * real one by accident, so the capability simply does not exist.
 *
 * The prompt contains no name, phone number, email, address, project detail, customer or vendor
 * information; requests no tool, no memory lookup and no external action; and carries no
 * prompt-injection content. It asks for a two-token JSON object and nothing else.
 */
import { validateModelRequest, type ModelRequest } from '@qf-jarvis/model-gateway';
import { z } from 'zod';

/** The fixed prompt identity. Config must declare exactly this value; it is never taken FROM config. */
export const SHADOW_PROMPT_ID = 'qfj.s2e.synthetic.shadow.v1';
export const SHADOW_PROMPT_VERSION = '1';

/** The maximum accepted result length. A two-field object needs nothing close to this. */
export const SHADOW_MAX_RESULT_CHARS = 128;

/**
 * The fixed synthetic prompt.
 *
 * Deliberately dull. It exercises the transport, the model's ability to honour a strict schema, and
 * nothing else — there is no instruction a model could follow that would produce a side effect.
 */
export const SHADOW_SYSTEM_PROMPT =
  'You are a connectivity and schema probe for an internal engineering validation. ' +
  'Reply with ONLY the required JSON object. Do not explain, do not add fields, do not use tools, ' +
  'and do not include any other text.';

export const SHADOW_USER_PROMPT =
  'Return the JSON object {"status":"ok"} exactly, with no other field and no commentary.';

/** The strict output schema: one field, one permitted value. */
export const shadowReplySchema = z
  .object({
    status: z.literal('ok'),
  })
  .strict();

/**
 * Build the one synthetic request.
 *
 * The SAME returned object is handed to the gateway once; the gateway passes that identical reference
 * to both the stable provider and the shadow candidate, so byte-identical input is guaranteed by
 * construction rather than by comparison.
 */
export function createShadowRequest(args: {
  readonly runId: string;
  readonly timeoutMs: number;
  readonly minContextTokens: number;
}): ModelRequest {
  const candidate = {
    runId: args.runId,
    purpose: 'engineering.shadow.probe',
    agentScope: 'SYSTEM',
    dataClass: 'HOSTED_ALLOWED',
    messages: [
      { role: 'system', content: SHADOW_SYSTEM_PROMPT },
      { role: 'user', content: SHADOW_USER_PROMPT },
    ],
    requiredCapabilities: {
      structuredOutput: true,
      strictJsonSchema: true,
      cancellation: true,
      minContextTokens: args.minContextTokens,
    },
    resultMode: 'STRUCTURED',
    structuredSchema: shadowReplySchema,
    maxResultChars: SHADOW_MAX_RESULT_CHARS,
    promptId: SHADOW_PROMPT_ID,
    promptVersion: SHADOW_PROMPT_VERSION,
    tokenBudget: 4096,
    costBudget: 1,
    timeoutMs: args.timeoutMs,
    // Locked at zero: this slice introduces no retry, and the gateway derives its attempt ceiling here.
    retryBudget: 0,
    metadata: {},
  };
  const validated = validateModelRequest(candidate);
  if (!validated.ok) {
    throw new Error('The fixed synthetic shadow request must be gateway-valid.');
  }
  return validated.request;
}
