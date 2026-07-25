/**
 * The immutable RAG provisioning profile (QFJ-P04.05, ADR-0053 §D).
 *
 * A future-facing, EXACT-identity record that binds a mode, a backend placeholder, and references to
 * the governed-knowledge revision / capability / evaluation evidence / policy — plus a config digest
 * and a canonical instant. It carries NO endpoint, secret, key, token, provider object, or arbitrary
 * metadata (the schema is strict). A profile never enables RAG; it is validated and then ignored at
 * runtime beyond producing a content-free no-op. The refs are optional so the runtime can surface the
 * precise `rag-*-reference-missing` reason for a `PROVISIONED_NO_OP` profile that omits one.
 */
import { z } from 'zod';

import { RagProvisioningError } from './errors.js';
import { isCanonicalInstant } from './instant.js';
import { RAG_BACKEND_KINDS, RAG_PROVISIONING_MODES } from './vocabularies.js';
import type { RagBackendKind, RagProvisioningMode } from './vocabularies.js';

/** One immutable RAG provisioning profile. */
export interface RagProvisioningProfile {
  readonly profileId: string;
  readonly profileVersion: number;
  readonly mode: RagProvisioningMode;
  readonly backendKind: RagBackendKind;
  readonly policyRevision: string;
  readonly configDigest: string;
  readonly createdAt: string;
  readonly knowledgeRevision: string | undefined;
  readonly capabilityRef: string | undefined;
  readonly evaluationEvidenceRef: string | undefined;
}

export interface RagProvisioningProfileInput {
  readonly profileId: string;
  readonly profileVersion: number;
  readonly mode: RagProvisioningMode;
  readonly backendKind: RagBackendKind;
  readonly policyRevision: string;
  readonly configDigest: string;
  readonly createdAt: string;
  readonly knowledgeRevision?: string | undefined;
  readonly capabilityRef?: string | undefined;
  readonly evaluationEvidenceRef?: string | undefined;
}

const IDENTIFIER = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9._:-]+$/);
const DIGEST = z.string().regex(/^[0-9a-f]{8,64}$/);

const profileSchema = z
  .object({
    profileId: IDENTIFIER,
    profileVersion: z.int().min(1).max(1_000_000),
    mode: z.enum(RAG_PROVISIONING_MODES),
    backendKind: z.enum(RAG_BACKEND_KINDS),
    policyRevision: IDENTIFIER,
    configDigest: DIGEST,
    createdAt: z.string().refine(isCanonicalInstant),
    knowledgeRevision: IDENTIFIER.optional(),
    capabilityRef: IDENTIFIER.optional(),
    evaluationEvidenceRef: IDENTIFIER.optional(),
  })
  .strict();

/** Validate and freeze a candidate profile. Returns null on any violation (fail closed, no throw). */
export function tryCreateRagProvisioningProfile(input: unknown): RagProvisioningProfile | null {
  const parsed = profileSchema.safeParse(input);
  if (!parsed.success) {
    return null;
  }
  const p = parsed.data;
  if (p.profileId.toLowerCase() === 'latest' || p.profileId.includes('*')) {
    return null;
  }
  return Object.freeze({
    profileId: p.profileId,
    profileVersion: p.profileVersion,
    mode: p.mode,
    backendKind: p.backendKind,
    policyRevision: p.policyRevision,
    configDigest: p.configDigest,
    createdAt: p.createdAt,
    knowledgeRevision: p.knowledgeRevision,
    capabilityRef: p.capabilityRef,
    evaluationEvidenceRef: p.evaluationEvidenceRef,
  });
}

/** Validate and freeze a candidate profile. Throws `RagProvisioningError('invalid-profile')`. */
export function createRagProvisioningProfile(
  input: RagProvisioningProfileInput,
): RagProvisioningProfile {
  const profile = tryCreateRagProvisioningProfile(input);
  if (profile === null) {
    throw new RagProvisioningError('invalid-profile');
  }
  return profile;
}
