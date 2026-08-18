/**
 * The Groq HTTP-400 DIFFERENTIAL CANARY matrix (MVP-P2A.2 HF4-R8).
 *
 * ### Why a differential harness and not another fix
 *
 * RUN S9 and RUN S10 produced the same result twice: the text smoke PASSED, the clipboard ingress
 * worked, the timer order held, every wire milestone was present, the one governed cancellation
 * cancelled — and then all NINE ordinary MODEL_REQUIRED safety requests came back HTTP 400 /
 * `invalid_request_error`, zero usable responses, `executionHealth=INVALID`.
 *
 * Between the two runs, HF4-R7/R1 removed every provider-facing schema keyword Groq's strict
 * documentation does not establish and closed a `$ref`/`$defs` projection bypass. S10 reproduced S9
 * exactly anyway. That is the finding: the remaining cause is NOT another unproven schema keyword, and
 * guessing at a third one would cost another live authorization to learn nothing.
 *
 * So this file stops guessing. It defines eight canaries that differ from each other along exactly one
 * axis at a time, so a future owner-authorized run can say WHICH dimension the provider rejects
 * instead of re-observing that it rejects something. Groq's own documentation asks for exactly this:
 * "If you run into 400 errors, we'd appreciate repros posted to our developer forum."
 *
 * ### The two axes
 *
 * COMPLETION CAP — `max_completion_tokens`. The candidate release declares 65,536 as the MODEL
 * ceiling and its comments say the operator sends far smaller requests; the Groq provider nevertheless
 * puts `this.config.maxCompletionTokens` on the wire for every invocation, and nothing in
 * `ProviderInvocationInput` carries a per-request bound. That is a real audit finding, PINNED here and
 * measured by the D1/D2, D5/D6 and D7/D8 pairs. It is NOT a claim that it caused the 400 — R8 changes
 * no production behaviour, precisely because the evidence to justify a change does not exist yet.
 *
 * REQUEST SHAPE — minimal strict schema, then the documented `anyOf`/nullable form, then a numeric
 * `enum`, then the real projected Riya schema, then the exact production message shape. Each step adds
 * one thing, so the first rejection names the dimension.
 *
 * ### What every canary shares
 *
 * The same provider, model, credential holder, transport observer and projection pipeline the real
 * candidate uses; `stream:false`, `n:1`, zero retry, zero fallback, `strict:true`, no tools, no
 * reasoning fields. Content is SYNTHETIC and fixed — no client or vendor text, ever. A canary that
 * cheated on any of those would measure a request the production path cannot send, which is the one
 * way a diagnostic can be worse than no diagnostic.
 */
import { CANDIDATE_MAX_COMPLETION_TOKENS } from './candidate-release.js';

/** The eight canaries, in the order a reader should reason about them. */
export const DIAGNOSTIC_CANARY_IDS = ['D1', 'D2', 'D3', 'D4', 'D5', 'D6', 'D7', 'D8'] as const;
export type DiagnosticCanaryId = (typeof DIAGNOSTIC_CANARY_IDS)[number];

/**
 * The completion-cap axis, as two named classes rather than two integers.
 *
 * `HIGH_65536` is deliberately derived from the candidate release constant rather than typed again:
 * the whole point of the pair is that the high canary carries the EXACT value production puts on the
 * wire today, and a second literal could drift away from it.
 */
export const CANARY_COMPLETION_CAP_CLASSES = ['LOW_512', 'HIGH_65536'] as const;
export type CanaryCompletionCapClass = (typeof CANARY_COMPLETION_CAP_CLASSES)[number];

export const CANARY_LOW_COMPLETION_CAP = 512;
export const CANARY_HIGH_COMPLETION_CAP = CANDIDATE_MAX_COMPLETION_TOKENS;

/** The request-shape axis. Each class adds exactly one thing to the one before it. */
export const CANARY_REQUEST_CLASSES = [
  'STRICT_MINIMAL',
  'STRICT_ANYOF_NULLABLE',
  'STRICT_NUMERIC_ENUM',
  'STRICT_REAL_RIYA_SCHEMA',
  'EXACT_REPRESENTATIVE_RIYA',
] as const;
export type CanaryRequestClass = (typeof CANARY_REQUEST_CLASSES)[number];

/** Where a canary's schema comes from. `REAL_RIYA_STRUCTURED` is the production schema, not a replica. */
export const CANARY_SCHEMA_SOURCES = [
  'SYNTHETIC_MINIMAL',
  'SYNTHETIC_ANYOF_NULLABLE',
  'SYNTHETIC_NUMERIC_ENUM',
  'REAL_RIYA_STRUCTURED',
] as const;
export type CanarySchemaSource = (typeof CANARY_SCHEMA_SOURCES)[number];

/**
 * Where a canary's messages come from.
 *
 * `REAL_RIYA_REQUEST_BUILDER` means the production prompt registry and profile build them from a
 * synthetic continuity state — the real message SHAPE carrying no real content. A hand-written
 * approximation would make D7/D8 measure something production never sends.
 */
export const CANARY_MESSAGE_SOURCES = ['SYNTHETIC_TINY', 'REAL_RIYA_REQUEST_BUILDER'] as const;
export type CanaryMessageSource = (typeof CANARY_MESSAGE_SOURCES)[number];

/** One canary's complete, reviewable contract. Everything a run needs, and nothing content-bearing. */
export interface DiagnosticCanary {
  readonly canaryId: DiagnosticCanaryId;
  readonly requestClass: CanaryRequestClass;
  readonly completionCapClass: CanaryCompletionCapClass;
  readonly maxCompletionTokens: number;
  readonly schemaSource: CanarySchemaSource;
  readonly messageSource: CanaryMessageSource;
  /** One line an owner can read to know what this canary is asking the provider. Never content. */
  readonly purpose: string;
}

/**
 * The smallest schema Groq's strict documentation demonstrates: one closed object, one required
 * string constrained by a singleton `enum`.
 *
 * If this is rejected, nothing about Riya is implicated and the investigation moves to the account,
 * the model entitlement or the request envelope.
 */
export const CANARY_MINIMAL_SCHEMA: Readonly<Record<string, unknown>> = Object.freeze({
  type: 'object',
  properties: { ok: { type: 'string', enum: ['OK'] } },
  required: ['ok'],
  additionalProperties: false,
});

/**
 * The documented optional-value form: a required property whose value may be null, expressed as an
 * `anyOf` union — exactly the representation the projected Riya schema uses for `reasonCode`.
 */
export const CANARY_ANYOF_NULLABLE_SCHEMA: Readonly<Record<string, unknown>> = Object.freeze({
  type: 'object',
  properties: {
    ok: { type: 'string', enum: ['OK'] },
    note: { anyOf: [{ type: 'string' }, { type: 'null' }] },
  },
  required: ['ok', 'note'],
  additionalProperties: false,
});

/**
 * A NUMERIC singleton enum.
 *
 * HF4-R7 canonicalizes `z.literal(1)` — the Riya `evolution.version` field — into `enum: [1]`. Groq
 * documents Enum as a supported data category, but its examples are predominantly string enums. This
 * canary asks the provider directly rather than assuming either answer.
 */
export const CANARY_NUMERIC_ENUM_SCHEMA: Readonly<Record<string, unknown>> = Object.freeze({
  type: 'object',
  properties: { version: { type: 'integer', enum: [1] } },
  required: ['version'],
  additionalProperties: false,
});

/**
 * The fixed synthetic messages the schema-axis canaries carry.
 *
 * Tiny and content-free by construction: they name no client, no vendor, no project and no person, so
 * D1-D6 vary the SCHEMA against a message shape that is held constant and trivially small.
 */
export const CANARY_SYNTHETIC_SYSTEM_MESSAGE =
  'You are a request-contract diagnostic. Reply with the smallest valid JSON object for the schema.';
export const CANARY_SYNTHETIC_USER_MESSAGE = 'Return the required fields.';

const canary = (
  canaryId: DiagnosticCanaryId,
  requestClass: CanaryRequestClass,
  completionCapClass: CanaryCompletionCapClass,
  schemaSource: CanarySchemaSource,
  messageSource: CanaryMessageSource,
  purpose: string,
): DiagnosticCanary =>
  Object.freeze({
    canaryId,
    requestClass,
    completionCapClass,
    maxCompletionTokens:
      completionCapClass === 'LOW_512' ? CANARY_LOW_COMPLETION_CAP : CANARY_HIGH_COMPLETION_CAP,
    schemaSource,
    messageSource,
    purpose,
  });

/**
 * The matrix.
 *
 * Read it as three PAIRS and four singles. D1/D2, D5/D6 and D7/D8 each differ in exactly one field —
 * the completion cap — which is what makes a disagreement inside a pair attributable to that axis and
 * nothing else. Specs assert that one-field difference directly, because "we only changed the cap" is
 * the entire evidentiary value of a pair and is not something to leave to review.
 */
export const DIAGNOSTIC_CANARIES: readonly DiagnosticCanary[] = Object.freeze([
  canary(
    'D1',
    'STRICT_MINIMAL',
    'LOW_512',
    'SYNTHETIC_MINIMAL',
    'SYNTHETIC_TINY',
    'Does this account, model and request envelope accept the smallest documented strict schema at all?',
  ),
  canary(
    'D2',
    'STRICT_MINIMAL',
    'HIGH_65536',
    'SYNTHETIC_MINIMAL',
    'SYNTHETIC_TINY',
    'Does the production completion cap alone change acceptance of that same tiny request?',
  ),
  canary(
    'D3',
    'STRICT_ANYOF_NULLABLE',
    'LOW_512',
    'SYNTHETIC_ANYOF_NULLABLE',
    'SYNTHETIC_TINY',
    'Does the documented anyOf/nullable form survive the live strict validator?',
  ),
  canary(
    'D4',
    'STRICT_NUMERIC_ENUM',
    'LOW_512',
    'SYNTHETIC_NUMERIC_ENUM',
    'SYNTHETIC_TINY',
    'Does a NUMERIC singleton enum survive, as HF4-R7 canonicalization produces for evolution.version?',
  ),
  canary(
    'D5',
    'STRICT_REAL_RIYA_SCHEMA',
    'LOW_512',
    'REAL_RIYA_STRUCTURED',
    'SYNTHETIC_TINY',
    'Does the real projected Riya schema pass request validation with messages and cap minimised?',
  ),
  canary(
    'D6',
    'STRICT_REAL_RIYA_SCHEMA',
    'HIGH_65536',
    'REAL_RIYA_STRUCTURED',
    'SYNTHETIC_TINY',
    'Is there an interaction between the real Riya schema and the production completion cap?',
  ),
  canary(
    'D7',
    'EXACT_REPRESENTATIVE_RIYA',
    'LOW_512',
    'REAL_RIYA_STRUCTURED',
    'REAL_RIYA_REQUEST_BUILDER',
    'Does the full production message shape pass when only the completion cap is minimised?',
  ),
  canary(
    'D8',
    'EXACT_REPRESENTATIVE_RIYA',
    'HIGH_65536',
    'REAL_RIYA_STRUCTURED',
    'REAL_RIYA_REQUEST_BUILDER',
    'The exact S10 request dimensions, as ONE synthetic request instead of a ten-case safety suite.',
  ),
]);

/** The three pairs whose ONLY difference is the completion cap. Named so a spec can assert it. */
export const CANARY_CAP_PAIRS: readonly (readonly [DiagnosticCanaryId, DiagnosticCanaryId])[] =
  Object.freeze([
    ['D1', 'D2'],
    ['D5', 'D6'],
    ['D7', 'D8'],
  ]);

/** Look one up by id. Throws only on a programming error — the ids are a closed set. */
export function canaryById(canaryId: DiagnosticCanaryId): DiagnosticCanary {
  const found = DIAGNOSTIC_CANARIES.find((one) => one.canaryId === canaryId);
  if (found === undefined) {
    throw new Error('QFJ_UNKNOWN_DIAGNOSTIC_CANARY');
  }
  return found;
}
