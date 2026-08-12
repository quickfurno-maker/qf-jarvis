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
 *
 * ### One version, one body — bound to one or more exact task classes (MVP-P2A.2-P)
 *
 * S3-I-A made `(promptId, promptVersion)` a global identity for exactly ONE definition, because at the
 * time a version implied a definition. The first real multi-task production prompt set showed that is
 * one rule doing two jobs.
 *
 * The job worth keeping is: a reviewed version can never silently mean different text. The job that
 * was accidental is: a version may be bound to only one task class. Riya's serving path resolves three
 * exact CLIENT task classes with no fallback between them, and the same reviewed behavioural bytes are
 * correct for all three — so under the old rule the same reviewed prompt could not be registered for
 * the paths it governs.
 *
 * The invariant is therefore NARROWED rather than relaxed. A family/version may carry several TASK-
 * CLASS VARIANTS only when every one of them is the same reviewed prompt: identical bytes, identical
 * digest, identical scope, identical result mode, and a distinct task class. Different bytes, a
 * different scope or a different result mode under one version stays a refusal, which is the property
 * the original rule existed for. And resolution is unchanged in strictness: a variant is never a
 * fallback for another.
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
 * `(promptId, promptVersion)` identifies ONE EXACT BYTE BODY. It may be bound to more than one task
 * class, and only then: every variant sharing a family/version must have identical bytes, an identical
 * digest, the same scope and the same result mode, with a distinct task class each. Anything else
 * under one version — different text, a different scope, a different result mode, or the same task
 * class twice — is `duplicate-definition`, exactly as before.
 *
 * That keeps the property the rule was written for. A reviewer approves a version by reading its
 * bytes, and no variant of that version can ever be different bytes.
 *
 * An empty registry is allowed. A registry with no definitions is a perfectly coherent
 * not-yet-activated foundation, and S3-I-A deliberately registers no production prompt; refusing it
 * would force this phase to invent the very content it is not authorized to add.
 *
 * Order is canonical — `promptId`, then `promptVersion`, then `taskClass`, all ascending — never
 * caller order, so two callers listing the same definitions differently get the same registry.
 */
export function createPromptRegistry(definitions: readonly PromptDefinition[]): PromptRegistry {
  if (!Array.isArray(definitions)) {
    throw new PromptRegistryError('invalid-definition');
  }

  const canonical = definitions.map((definition) => canonicalized(definition));

  // The family/version each variant must agree with. The FIRST canonical definition for a family
  // version sets it; every later one is compared against it rather than against its neighbour, so a
  // chain of pairwise-compatible definitions cannot drift across the set.
  const bodyByIdentity = new Map<string, PromptDefinition>();
  const seenVariants = new Set<string>();
  for (const definition of canonical) {
    const identity = `${definition.promptId}@${String(definition.promptVersion)}`;
    const variant = `${identity}#${definition.taskClass}`;
    if (seenVariants.has(variant)) {
      throw new PromptRegistryError('duplicate-definition');
    }
    seenVariants.add(variant);

    const established = bodyByIdentity.get(identity);
    if (established === undefined) {
      bodyByIdentity.set(identity, definition);
      continue;
    }
    // A second definition for a version the reviewer already approved. It is the SAME prompt bound to
    // another task, or it is a different prompt wearing an approved version number.
    if (
      established.systemTemplate !== definition.systemTemplate ||
      established.contentDigest !== definition.contentDigest ||
      established.agentScope !== definition.agentScope ||
      established.resultMode !== definition.resultMode
    ) {
      throw new PromptRegistryError('duplicate-definition');
    }
  }

  const ordered = Object.freeze(
    [...canonical].sort((a, b) => {
      if (a.promptId !== b.promptId) {
        return a.promptId < b.promptId ? -1 : 1;
      }
      if (a.promptVersion !== b.promptVersion) {
        return a.promptVersion - b.promptVersion;
      }
      // The tiebreaker that makes a multi-variant family deterministic. Without it, two callers
      // listing the same three variants in different orders would get different registries.
      return a.taskClass < b.taskClass ? -1 : a.taskClass > b.taskClass ? 1 : 0;
    }),
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
      // Matched on the WHOLE request in one pass. Finding by id/version first and then checking the
      // rest was equivalent while a version had one definition; with task-class variants it would
      // pick a sibling and then reject it, so a request for a task that IS registered could miss.
      return ordered.find(
        (definition) =>
          definition.promptId === wanted.promptId &&
          definition.promptVersion === wanted.promptVersion &&
          definition.agentScope === wanted.agentScope &&
          definition.taskClass === wanted.taskClass &&
          definition.resultMode === wanted.resultMode,
      );
    },
  });
}
