/**
 * The immutable provider release reference (QFJ-P04.01E, ADR-0049).
 *
 * A release binds an opaque release id to a provider/model/version and a capability/configuration digest.
 * It is pure identity — it embeds NO provider instance, NO secret, and NO arbitrary metadata map. Two
 * releases are the same iff their `releaseId` and `configDigest` match (the digest changing means the
 * candidate changed and a new attestation + restart is required).
 */
import { z } from 'zod';

import type { ProviderExecutionClass } from '../contracts/enums.js';
import { PROVIDER_EXECUTION_CLASSES } from '../contracts/enums.js';

const IDENTIFIER = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9._:-]+$/);
const DIGEST = z
  .string()
  .min(8)
  .max(128)
  .regex(/^[A-Za-z0-9._:-]+$/);

/** The immutable release reference. */
export interface ProviderReleaseRef {
  readonly releaseId: string;
  readonly providerId: string;
  readonly modelId: string;
  readonly modelVersion: string;
  readonly executionClass: ProviderExecutionClass;
  readonly configDigest: string;
}

const releaseSchema = z
  .object({
    releaseId: IDENTIFIER,
    providerId: IDENTIFIER,
    modelId: IDENTIFIER,
    modelVersion: IDENTIFIER,
    executionClass: z.enum(PROVIDER_EXECUTION_CLASSES),
    configDigest: DIGEST,
  })
  .strict();

/** Validate and freeze a provider release reference. Throws a fixed-message error on any invalid field. */
export function createProviderReleaseRef(input: unknown): ProviderReleaseRef {
  const parsed = releaseSchema.safeParse(input);
  if (!parsed.success) {
    throw new Error('A provider release reference field is invalid.');
  }
  return Object.freeze(parsed.data);
}

/** True iff two releases refer to the exact same release id AND configuration digest. */
export function sameRelease(a: ProviderReleaseRef, b: ProviderReleaseRef): boolean {
  return a.releaseId === b.releaseId && a.configDigest === b.configDigest;
}
