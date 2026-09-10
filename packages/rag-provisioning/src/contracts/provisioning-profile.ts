/**
 * The immutable RAG provisioning profile (QFJ-P04.05, ADR-0053 §D).
 *
 * A future-facing, EXACT-identity record that binds a mode, a backend placeholder, and references to
 * the governed-knowledge revision / capability / evaluation evidence / policy — plus a config digest
 * and a canonical instant. It carries NO endpoint, secret, key, token, provider object, or arbitrary
 * metadata (the schema is strict). The refs are optional so the runtime can surface the precise
 * `rag-*-reference-missing` reason for a `PROVISIONED_NO_OP` profile that omits one.
 *
 * ### ACTIVE profiles may NOT carry evidence-looking references (JF-3 owner correction)
 *
 * `capabilityRef` and `evaluationEvidenceRef` are future-facing declarations from ADR-0053, and JF-3
 * has no authority that verifies either of them. On a `PROVISIONED_NO_OP` profile that is harmless:
 * nothing serves, and the refs exist so the no-op path can name a precise missing precondition.
 *
 * On an `ACTIVE` profile it would not be harmless. A serving profile carrying an `evaluationEvidenceRef`
 * READS as evidence-bound — to an operator, to a reviewer, and to anyone reading an artifact that
 * records it — while the string is in fact ignored. A field that looks like a control and is not one is
 * worse than an absent field, because absence prompts the question and a decorative value settles it.
 *
 * So an ACTIVE profile carrying either ref is REFUSED at construction. When JF-5 wires a real
 * certification authority, it can accept them again and actually check them, under its own ADR.
 *
 * ### What `configDigest` and `policyRevision` mean, and what they do not
 *
 * `configDigest` is the existing profile/configuration identity from ADR-0053 and `policyRevision` is a
 * declared policy identity. Neither is a signature, neither is verified against anything here, and
 * neither proves human authorship. Only `knowledgeRevision` is structurally bound to what it names —
 * it is derived from the knowledge itself — and even that is a content identity rather than an
 * attestation.
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
  // JF-3 owner correction: an ACTIVE profile must not carry a reference nothing verifies. See the
  // header -- a decorative control is worse than a missing one, because it stops people asking.
  if (
    p.mode === 'ACTIVE' &&
    (p.capabilityRef !== undefined || p.evaluationEvidenceRef !== undefined)
  ) {
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
