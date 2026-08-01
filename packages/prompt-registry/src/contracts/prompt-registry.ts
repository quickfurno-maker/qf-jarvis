/**
 * The immutable prompt registry (QFJ-S3-I-A, ADR-0072).
 *
 * A frozen set of content-bound definitions and one exact-match resolver. There is no `register`,
 * `add`, `remove`, `update`, `activate`, `retire`, `reload`, `refresh`, `fetch`, `save` or `persist`
 * method: a registry is built once from definitions a human wrote and a reviewer saw, and nothing at
 * runtime can grow it. That is the whole point — a prompt set that can change while the process runs
 * is a prompt set nobody approved.
 *
 * Resolution is EXACT. No `latest`, no nearest version, no lower version, no cross-scope or cross-task
 * substitution, no result-mode coercion, no fallback of any kind. A well-formed request that matches
 * nothing returns `undefined` rather than throwing, so S3-I-B can normalize a genuine miss through the
 * M4 boundary; only a malformed request is an error. Silent substitution is the failure this design
 * exists to prevent: executing a prompt other than the one identified is exactly the drift the Part 0
 * audit found.
 */
import { z } from 'zod';

import { PromptRegistryError } from './errors.js';
import {
  MATERIALIZED_DEFINITION_KEYS,
  PROMPT_AGENT_SCOPES_FROZEN,
  PROMPT_REGISTRY_VERSION,
  PROMPT_RESULT_MODES_FROZEN,
  createPromptDefinition,
  isPlainRecord,
} from './prompt-definition.js';
import type {
  PromptAgentScope,
  PromptDefinition,
  PromptRegistryVersion,
  PromptResultMode,
} from './prompt-definition.js';
import { promptContentDigest } from '../internal/prompt-digest.js';

/** Exactly which prompt a caller wants. Identity plus the three properties it must actually have. */
export interface PromptResolutionRequest {
  readonly promptId: string;
  readonly promptVersion: number;
  readonly agentScope: PromptAgentScope;
  readonly taskClass: string;
  readonly resultMode: PromptResultMode;
}

/** A frozen registry. Immutable after construction; it exposes no way to change its contents. */
export interface PromptRegistry {
  readonly version: PromptRegistryVersion;
  readonly definitions: readonly PromptDefinition[];
  resolve(request: PromptResolutionRequest): PromptDefinition | undefined;
}

const EXACT_IDENTIFIER = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9._:-]+$/)
  .refine((value) => !value.includes('*'))
  .refine((value) => value.toLowerCase() !== 'latest');

const resolutionSchema = z
  .object({
    promptId: EXACT_IDENTIFIER,
    promptVersion: z.int().min(1).max(1_000_000),
    agentScope: z.enum(
      PROMPT_AGENT_SCOPES_FROZEN as readonly [PromptAgentScope, ...PromptAgentScope[]],
    ),
    taskClass: EXACT_IDENTIFIER,
    resultMode: z.enum(
      PROMPT_RESULT_MODES_FROZEN as readonly [PromptResultMode, ...PromptResultMode[]],
    ),
  })
  .strict();

const DIGEST = /^[0-9a-f]{64}$/;

/**
 * Canonicalize one supplied materialized definition.
 *
 * A registry must not trust the objects it is handed, even though TypeScript says they are
 * `PromptDefinition`. Three things are checked that the type system cannot: the exact own-key set
 * (so a forged record with an extra field is refused rather than partially read), the registry
 * version, and — decisively — that the supplied `contentDigest` actually equals the SHA-256 of the
 * supplied template. A definition whose digest does not match its own bytes is precisely the forgery
 * this package exists to make impossible, so it is refused rather than recomputed.
 *
 * The returned record is rebuilt through `createPromptDefinition`, so the registry holds canonical
 * frozen objects and never the caller's.
 */
function canonicalized(supplied: unknown): PromptDefinition {
  if (!isPlainRecord(supplied)) {
    throw new PromptRegistryError('invalid-definition');
  }
  const keys = Object.keys(supplied);
  if (
    keys.length !== MATERIALIZED_DEFINITION_KEYS.length ||
    !MATERIALIZED_DEFINITION_KEYS.every((key) => keys.includes(key))
  ) {
    throw new PromptRegistryError('invalid-definition');
  }
  if (supplied['registryVersion'] !== PROMPT_REGISTRY_VERSION) {
    throw new PromptRegistryError('invalid-definition');
  }
  const digest: unknown = supplied['contentDigest'];
  const template: unknown = supplied['systemTemplate'];
  if (typeof digest !== 'string' || !DIGEST.test(digest)) {
    throw new PromptRegistryError('invalid-definition');
  }
  if (typeof template !== 'string') {
    throw new PromptRegistryError('invalid-definition');
  }

  // Rebuild through the constructor: every scalar contract is re-validated there, and the digest it
  // computes is the one that counts.
  const rebuilt = createPromptDefinition({
    promptId: supplied['promptId'] as string,
    promptVersion: supplied['promptVersion'] as number,
    agentScope: supplied['agentScope'] as PromptAgentScope,
    taskClass: supplied['taskClass'] as string,
    resultMode: supplied['resultMode'] as PromptResultMode,
    systemTemplate: template,
  });

  if (rebuilt.contentDigest !== digest || promptContentDigest(template) !== digest) {
    throw new PromptRegistryError('invalid-definition');
  }
  return rebuilt;
}

/**
 * Build a frozen registry from materialized definitions.
 *
 * `(promptId, promptVersion)` is a GLOBAL identity: two definitions sharing it are rejected even when
 * their content is byte-identical, and regardless of scope, task class or result mode. A version
 * identifies one exact definition, or it identifies nothing — allowing the same version to mean
 * different things in different scopes would put the drift back one level down.
 *
 * An empty registry is allowed. A registry with no definitions is a perfectly coherent
 * not-yet-activated foundation, and S3-I-A deliberately registers no production prompt; refusing it
 * would force this phase to invent the very content it is not authorized to add.
 *
 * Order is canonical — `promptId` ascending, then `promptVersion` ascending — never caller order, so
 * two callers listing the same definitions differently get the same registry.
 */
export function createPromptRegistry(definitions: readonly PromptDefinition[]): PromptRegistry {
  if (!Array.isArray(definitions)) {
    throw new PromptRegistryError('invalid-definition');
  }

  const canonical = definitions.map((definition) => canonicalized(definition));

  const seen = new Set<string>();
  for (const definition of canonical) {
    const identity = `${definition.promptId}@${String(definition.promptVersion)}`;
    if (seen.has(identity)) {
      throw new PromptRegistryError('duplicate-definition');
    }
    seen.add(identity);
  }

  const ordered = Object.freeze(
    [...canonical].sort((a, b) =>
      a.promptId === b.promptId
        ? a.promptVersion - b.promptVersion
        : a.promptId < b.promptId
          ? -1
          : 1,
    ),
  );

  return Object.freeze({
    version: PROMPT_REGISTRY_VERSION,
    definitions: ordered,
    resolve(request: PromptResolutionRequest): PromptDefinition | undefined {
      if (!isPlainRecord(request)) {
        throw new PromptRegistryError('invalid-resolution');
      }
      const parsed = resolutionSchema.safeParse(request);
      if (!parsed.success) {
        throw new PromptRegistryError('invalid-resolution');
      }
      const wanted = parsed.data;
      const found = ordered.find(
        (definition) =>
          definition.promptId === wanted.promptId &&
          definition.promptVersion === wanted.promptVersion,
      );
      if (found === undefined) {
        return undefined;
      }
      // The identity exists, but a definition that does not match the requested scope, task or result
      // mode is NOT a near miss to be returned with a warning — it is a different prompt.
      if (
        found.agentScope !== wanted.agentScope ||
        found.taskClass !== wanted.taskClass ||
        found.resultMode !== wanted.resultMode
      ) {
        return undefined;
      }
      return found;
    },
  });
}
