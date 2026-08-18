/**
 * The provider-neutral, minimized model REQUEST (QFJ-P04.01A, ADR-0045).
 *
 * A request carries a stable run id, a task purpose, an agent scope, a privacy data class, sanitized
 * bounded messages, the capabilities it requires, an output mode (structured schema or bounded text),
 * a prompt id/version, and per-request budgets/timeout/retry. It carries NO secret, NO raw
 * database/provider object, NO subject reference, and NO chain-of-thought field. The cancellation
 * signal is passed at INVOCATION time (an `AbortSignal`), never stored on the frozen request.
 */
import { z, type ZodType } from 'zod';

import { MODEL_AGENT_SCOPES, MODEL_DATA_CLASSES, MODEL_RESULT_MODES } from './enums.js';
import { requiredCapabilitiesSchema, type RequiredCapabilities } from './capabilities.js';

/** One sanitized, bounded conversation message. Content is minimized text — never raw PII/secrets. */
export interface ModelMessage {
  readonly role: 'system' | 'user' | 'assistant';
  readonly content: string;
}

/** Closed, bounded metadata: string keys to scalar values only (no nested objects, no secrets). */
export type ModelRequestMetadata = Readonly<Record<string, string | number | boolean>>;

/** The immutable, validated model request. `structuredSchema` is present iff `resultMode` is STRUCTURED. */
export interface ModelRequest {
  readonly runId: string;
  readonly purpose: string;
  readonly agentScope: (typeof MODEL_AGENT_SCOPES)[number];
  readonly dataClass: (typeof MODEL_DATA_CLASSES)[number];
  readonly messages: readonly ModelMessage[];
  readonly requiredCapabilities: RequiredCapabilities;
  readonly resultMode: (typeof MODEL_RESULT_MODES)[number];
  /** For STRUCTURED mode: the schema the provider output must satisfy. Absent for TEXT mode. */
  readonly structuredSchema?: ZodType;
  /** For TEXT mode: the maximum accepted result length. */
  readonly maxResultChars: number;
  readonly promptId: string;
  readonly promptVersion: string;
  /**
   * The lowercase 64-hex SHA-256 of the exact system-prompt content this request carries
   * (QFJ-S3-I-B, ADR-0073).
   *
   * REQUIRED, not optional. `promptId` and `promptVersion` name a prompt; only this says which bytes
   * were actually sent. Before it existed, the identity and the system message were assembled
   * independently and never compared, so a request could truthfully report a version whose text it
   * was not carrying. A caller that cannot produce a digest cannot produce a request.
   */
  readonly promptDigest: string;
  readonly tokenBudget: number;
  /**
   * The per-request COMPLETION bound in tokens (POST-S11 REQUEST-CONTRACT REPAIR).
   *
   * Deliberately separate from `tokenBudget`, which is the whole-request accounting estimate the
   * budget policy checks. This one is narrower and different in kind: it is how many tokens the
   * answer is allowed to occupy, and it is the value a provider puts on the wire.
   *
   * Optional so every existing caller is unchanged. Absent means the provider falls back to its
   * configured model ceiling, which is the pre-repair behaviour.
   */
  readonly completionBudget?: number;
  readonly costBudget: number;
  readonly timeoutMs: number;
  readonly retryBudget: number;
  readonly metadata: ModelRequestMetadata;
}

const IDENTIFIER = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9._:-]+$/);
const MACHINE_TOKEN = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9]+([-.][a-z0-9]+)*$/);

const messageSchema = z
  .object({
    role: z.enum(['system', 'user', 'assistant']),
    content: z.string().min(0).max(200_000),
  })
  .strict();

const metadataSchema = z.record(
  z
    .string()
    .min(1)
    .max(64)
    .regex(/^[A-Za-z0-9._:-]+$/),
  z.union([z.string().max(1024), z.number(), z.boolean()]),
);

/** The primitive fields of a request, validated by zod. `structuredSchema` is validated separately. */
const requestPrimitivesSchema = z
  .object({
    runId: IDENTIFIER,
    purpose: MACHINE_TOKEN,
    agentScope: z.enum(MODEL_AGENT_SCOPES),
    dataClass: z.enum(MODEL_DATA_CLASSES),
    messages: z.array(messageSchema).min(1).max(1000),
    requiredCapabilities: requiredCapabilitiesSchema,
    resultMode: z.enum(MODEL_RESULT_MODES),
    maxResultChars: z.int().min(1).max(1_000_000),
    promptId: IDENTIFIER,
    promptVersion: IDENTIFIER,
    promptDigest: z.string().regex(/^[0-9a-f]{64}$/),
    tokenBudget: z.int().min(1).max(100_000_000),
    // Bounded by the same ceiling a provider config accepts, so a request cannot name a completion
    // budget no provider could be configured to honour.
    completionBudget: z.int().min(1).max(1_000_000).optional(),
    costBudget: z.number().min(0).max(1_000_000),
    timeoutMs: z.int().min(1).max(600_000),
    retryBudget: z.int().min(0).max(10),
    metadata: metadataSchema,
  })
  .strict();

/** True iff `value` looks like a zod schema (has a `safeParse` method). */
function isZodSchema(value: unknown): value is ZodType {
  return typeof (value as { safeParse?: unknown } | null)?.safeParse === 'function';
}

/**
 * The result of validating a candidate request: either the frozen {@link ModelRequest}, or a bounded
 * reason token (never caller content). The gateway maps a failure to `ModelGatewayError('request-invalid')`.
 */
export type ModelRequestValidation =
  { readonly ok: true; readonly request: ModelRequest } | { readonly ok: false };

/**
 * Validate and freeze a candidate request. Reads each field once into a validated snapshot; a STRUCTURED
 * request must carry a zod `structuredSchema` and a TEXT request must not. Returns `{ ok: false }` on any
 * violation — never a native zod error and never any caller content.
 */
export function validateModelRequest(input: unknown): ModelRequestValidation {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return { ok: false };
  }
  // Separate the (non-serialisable) structured schema from the primitive fields so the strict primitive
  // schema does not reject it as an unknown key.
  const { structuredSchema: candidateSchema, ...rest } = input as Record<string, unknown>;
  const parsed = requestPrimitivesSchema.safeParse(rest);
  if (!parsed.success) {
    return { ok: false };
  }
  // `exactOptionalPropertyTypes` is on, so an optional field must be ABSENT rather than present and
  // `undefined`. Zod renders `.optional()` as the latter, so it is split out and re-added only when
  // the caller actually supplied one.
  const { completionBudget, ...primitives } = parsed.data;
  const optionalCompletionBudget = completionBudget === undefined ? {} : { completionBudget };

  if (primitives.resultMode === 'STRUCTURED') {
    if (!isZodSchema(candidateSchema)) {
      return { ok: false };
    }
    if (!primitives.requiredCapabilities.structuredOutput) {
      return { ok: false };
    }
    return {
      ok: true,
      request: Object.freeze({
        ...primitives,
        ...optionalCompletionBudget,
        messages: Object.freeze(primitives.messages.map((m: ModelMessage) => Object.freeze(m))),
        metadata: Object.freeze({ ...primitives.metadata }),
        structuredSchema: candidateSchema,
      }),
    };
  }

  // TEXT mode: no structured schema is permitted.
  if (candidateSchema !== undefined) {
    return { ok: false };
  }
  return {
    ok: true,
    request: Object.freeze({
      ...primitives,
      ...optionalCompletionBudget,
      messages: Object.freeze(primitives.messages.map((m: ModelMessage) => Object.freeze(m))),
      metadata: Object.freeze({ ...primitives.metadata }),
    }),
  };
}
