/**
 * The versioned, content-bound prompt definition (QFJ-S3-I-A, ADR-0072).
 *
 * The S3-I Part 0 audit found that the runtime carries `promptFamily`/`promptVersion` while the actual
 * executed system text lives in an unrelated module constant, so an identity can name a body it does
 * not match, and a green evaluation can attest a prompt that never ran. This contract is the fix's
 * foundation: a definition BINDS its identity to its exact bytes, because the digest is computed here
 * from the template rather than accepted from a caller. There is no field in which a wrong digest
 * could be supplied.
 *
 * What this is NOT: an approval, an activation, evaluation evidence, a rollout decision, or business
 * authority. A definition existing means a prompt is *defined at a version*, nothing more. ADR-0016
 * and `agent-model.md` are the reason the shape is so plain — "a prompt version is a thing a human
 * changed and a reviewer saw", and these records carry a version, they grant no ability to set one.
 */
import { z } from 'zod';

import { PromptRegistryError } from './errors.js';
import { promptContentDigest } from '../internal/prompt-digest.js';

/** The registry CONTRACT version. Not the prompt version, not evaluation, not a rollout mode. */
export const PROMPT_REGISTRY_VERSION = 1 as const;
export type PromptRegistryVersion = typeof PROMPT_REGISTRY_VERSION;

/**
 * The scopes a prompt may serve.
 *
 * Mirrors the gateway's agent scopes without importing them: this package stays a leaf, and S3-I-B
 * will assert exact compatibility with `MODEL_AGENT_SCOPES` at the binding boundary. There is no
 * `HUMAN` scope, because a human turn never reaches a model.
 */
const PROMPT_AGENT_SCOPE_VALUES = ['CLIENT', 'VENDOR', 'COORDINATION', 'SYSTEM'] as const;
export type PromptAgentScope = (typeof PROMPT_AGENT_SCOPE_VALUES)[number];

export const PROMPT_AGENT_SCOPES_FROZEN: readonly PromptAgentScope[] = Object.freeze([
  ...PROMPT_AGENT_SCOPE_VALUES,
]);

/** The result modes the gateway already governs. No JSON/CHAT/FUNCTION/TOOLS — S3-I-A grants no tool. */
const PROMPT_RESULT_MODE_VALUES = ['STRUCTURED', 'TEXT'] as const;
export type PromptResultMode = (typeof PROMPT_RESULT_MODE_VALUES)[number];

export const PROMPT_RESULT_MODES_FROZEN: readonly PromptResultMode[] = Object.freeze([
  ...PROMPT_RESULT_MODE_VALUES,
]);

/** The maximum system-template size. Bounded so a definition cannot become an unbounded document. */
const MAX_TEMPLATE_CHARS = 16_384;

/**
 * An exact identifier: no wildcard, no `latest`, no slash, no whitespace.
 *
 * `latest` is rejected case-insensitively as a whole token because it is the one well-formed
 * identifier that silently means "whichever one is newest" — the precise opposite of a version a
 * reviewer saw. The gateway's staging binding already refuses it for the same reason.
 */
const EXACT_IDENTIFIER = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9._:-]+$/)
  .refine((value) => !value.includes('*'))
  .refine((value) => value.toLowerCase() !== 'latest');

/** The literal system template. Hashed exactly as supplied — see `internal/prompt-digest.ts`. */
const SYSTEM_TEMPLATE = z
  .string()
  .min(1)
  .max(MAX_TEMPLATE_CHARS)
  // A NUL byte is not review-visible and would truncate the text in several consumers.
  .refine((value) => !value.includes(String.fromCharCode(0)));

/** What a caller may supply. No digest, no registry version, no lifecycle, no metadata. */
export interface PromptDefinitionInput {
  readonly promptId: string;
  readonly promptVersion: number;
  readonly agentScope: PromptAgentScope;
  readonly taskClass: string;
  readonly resultMode: PromptResultMode;
  readonly systemTemplate: string;
}

/** One frozen, content-bound prompt definition. */
export interface PromptDefinition {
  readonly registryVersion: PromptRegistryVersion;
  readonly promptId: string;
  readonly promptVersion: number;
  readonly agentScope: PromptAgentScope;
  readonly taskClass: string;
  readonly resultMode: PromptResultMode;
  readonly systemTemplate: string;
  /** Lowercase 64-hex SHA-256 of `systemTemplate`. Computed here; never caller-supplied. */
  readonly contentDigest: string;
}

const definitionInputSchema = z
  .object({
    promptId: EXACT_IDENTIFIER,
    // Numeric and integral, matching JarvisRuntimeConfig / ModelReplyPort / EvaluationBinding. The
    // gateway serializes it to a string at its own wire boundary; the registry does not.
    promptVersion: z.int().min(1).max(1_000_000),
    agentScope: z.enum(PROMPT_AGENT_SCOPE_VALUES),
    // An exact identifier, deliberately NOT a closed vocabulary: the runtime exposes `taskClass?:
    // string` and the repository has never governed a finite global list. Inventing one here would
    // lock a vocabulary this phase has no authority over.
    taskClass: EXACT_IDENTIFIER,
    resultMode: z.enum(PROMPT_RESULT_MODE_VALUES),
    systemTemplate: SYSTEM_TEMPLATE,
  })
  .strict();

/** The exact own keys a materialized `PromptDefinition` carries. Every one, and nothing else. */
export const MATERIALIZED_DEFINITION_KEYS = [
  'registryVersion',
  'promptId',
  'promptVersion',
  'agentScope',
  'taskClass',
  'resultMode',
  'systemTemplate',
  'contentDigest',
] as const;

/** A plain, non-array object with no inherited enumerable payload. */
export function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype: unknown = Object.getPrototypeOf(value);
  if (prototype !== null && prototype !== Object.prototype) {
    return false;
  }
  const own = new Set(Object.keys(value));
  for (const key in value) {
    if (!own.has(key)) {
      return false;
    }
  }
  return true;
}

/**
 * Build a frozen, content-bound prompt definition.
 *
 * Throws `PromptRegistryError('invalid-definition')` on any invalid or unknown field. The digest is
 * computed from the validated template, so identity and content are bound at construction and cannot
 * be separated afterwards.
 *
 * The template is not trimmed, collapsed, re-encoded or normalized. A reviewer approved specific
 * bytes; tidying them here would mean the digest attests to text nobody read.
 */
export function createPromptDefinition(input: PromptDefinitionInput): PromptDefinition {
  if (!isPlainRecord(input)) {
    throw new PromptRegistryError('invalid-definition');
  }
  const parsed = definitionInputSchema.safeParse(input);
  if (!parsed.success) {
    throw new PromptRegistryError('invalid-definition');
  }
  const data = parsed.data;
  return Object.freeze({
    registryVersion: PROMPT_REGISTRY_VERSION,
    promptId: data.promptId,
    promptVersion: data.promptVersion,
    agentScope: data.agentScope,
    taskClass: data.taskClass,
    resultMode: data.resultMode,
    systemTemplate: data.systemTemplate,
    contentDigest: promptContentDigest(data.systemTemplate),
  });
}
