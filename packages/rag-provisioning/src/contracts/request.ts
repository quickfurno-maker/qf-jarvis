/**
 * The optional, content-free provisioning request metadata (QFJ-P04.05, ADR-0053).
 *
 * A caller MAY pass only safe bounded metadata — a run id, an optional profile id/version, an optional
 * task class, and an optional data class. It carries NO prompt, message, subject, topic, or document.
 * The strict schema rejects any other field, so no content can enter the boundary.
 */
import { z } from 'zod';

import { RagProvisioningError } from './errors.js';
import { RAG_DATA_CLASSES, RAG_TASK_CLASSES } from './vocabularies.js';
import type { RagDataClass, RagTaskClass } from './vocabularies.js';

/** Safe, content-free request metadata. */
export interface RagRequestMetadata {
  readonly runId: string;
  readonly profileId: string | undefined;
  readonly profileVersion: number | undefined;
  readonly taskClass: RagTaskClass | undefined;
  readonly dataClass: RagDataClass | undefined;
}

export interface RagRequestMetadataInput {
  readonly runId: string;
  readonly profileId?: string | undefined;
  readonly profileVersion?: number | undefined;
  readonly taskClass?: RagTaskClass | undefined;
  readonly dataClass?: RagDataClass | undefined;
}

const IDENTIFIER = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9._:-]+$/);

const requestSchema = z
  .object({
    runId: IDENTIFIER,
    profileId: IDENTIFIER.optional(),
    profileVersion: z.int().min(1).max(1_000_000).optional(),
    taskClass: z.enum(RAG_TASK_CLASSES).optional(),
    dataClass: z.enum(RAG_DATA_CLASSES).optional(),
  })
  .strict();

/** Validate and freeze content-free request metadata. Throws `RagProvisioningError('invalid-profile')`. */
export function createRagRequestMetadata(input: RagRequestMetadataInput): RagRequestMetadata {
  const parsed = requestSchema.safeParse(input);
  if (!parsed.success) {
    throw new RagProvisioningError('invalid-profile');
  }
  const r = parsed.data;
  return Object.freeze({
    runId: r.runId,
    profileId: r.profileId,
    profileVersion: r.profileVersion,
    taskClass: r.taskClass,
    dataClass: r.dataClass,
  });
}
