/**
 * The rollout approval attestation (QFJ-P04.01E, ADR-0049).
 *
 * An OPAQUE evaluation/approval reference bound to an exact release (id + config digest), with an approved
 * mode ceiling and canary ceiling, the applicable privacy/data-control or endpoint-posture references, and
 * a monotonic revision. It makes NO legal/compliance claim and carries NO secret. The controller CONSUMES
 * an attestation — it is not itself an authorization system. A missing/stale/mismatched approval fails
 * closed (Report 04).
 */
import { z } from 'zod';

import { GATEWAY_MODES, type GatewayMode } from '../contracts/enums.js';
import { sameRelease, type ProviderReleaseRef } from './provider-release.js';

const IDENTIFIER = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9._:-]+$/);
const REFERENCE = z
  .string()
  .min(1)
  .max(256)
  .regex(/^[A-Za-z0-9._:/-]+$/);

/** The rank of each mode for a mode-ceiling comparison (higher = more exposure). */
const MODE_RANK: Readonly<Record<GatewayMode, number>> = Object.freeze({
  OFF: 0,
  SHADOW: 1,
  FALLBACK: 2,
  CANARY: 3,
  ACTIVE: 4,
});

/** The immutable approval attestation. */
export interface RolloutApprovalAttestation {
  readonly evaluationRef: string;
  readonly releaseId: string;
  readonly configDigest: string;
  readonly privacyRefs: readonly string[];
  readonly approvedModeCeiling: GatewayMode;
  readonly approvedCanaryBasisPoints: number;
  readonly revision: number;
  /**
   * QFJ-S2-C-B (ADR-0063 §7). These three bind the attestation to REGISTERED evaluation evidence.
   *
   * They are OPTIONAL at the schema boundary so the constructor stays additive and no existing caller
   * breaks — and MANDATORY for any candidate transition above OFF, where their absence is refused as
   * `evidence-missing`. An old attestation carrying only `evaluationRef` therefore cannot authorize
   * SHADOW, CANARY or ACTIVE.
   *
   * `evidenceDigest` is a CLAIM. A verifier recomputes the digest from registered evidence and
   * compares; it never trusts this value.
   */
  readonly evidenceDigest: string | undefined;
  /** The approval target the evidence must carry, as a bounded string (the gateway owns no target enum). */
  readonly approvalTarget: string | undefined;
  /** The exact capability profile the approval was granted against. */
  readonly capabilityProfileRef: string | undefined;
}

const approvalSchema = z
  .object({
    evaluationRef: REFERENCE,
    releaseId: IDENTIFIER,
    configDigest: z
      .string()
      .min(8)
      .max(128)
      .regex(/^[A-Za-z0-9._:-]+$/),
    privacyRefs: z.array(REFERENCE).max(16),
    approvedModeCeiling: z.enum(GATEWAY_MODES),
    approvedCanaryBasisPoints: z.int().min(0).max(10_000),
    revision: z.int().min(0).max(1_000_000),
    // QFJ-S2-C-B: additive and optional here, mandatory above OFF (see the interface note).
    evidenceDigest: z
      .string()
      .min(8)
      .max(128)
      .regex(/^[A-Za-z0-9._:-]+$/)
      .optional(),
    approvalTarget: IDENTIFIER.optional(),
    capabilityProfileRef: IDENTIFIER.optional(),
  })
  .strict();

/** Validate and freeze an approval attestation. Throws a fixed-message error on any invalid field. */
export function createRolloutApprovalAttestation(input: unknown): RolloutApprovalAttestation {
  const parsed = approvalSchema.safeParse(input);
  if (!parsed.success) {
    throw new Error('A rollout approval attestation field is invalid.');
  }
  return Object.freeze({
    ...parsed.data,
    privacyRefs: Object.freeze([...parsed.data.privacyRefs]),
    // Normalise the optional evidence fields to an explicit `undefined` so the frozen shape is total.
    evidenceDigest: parsed.data.evidenceDigest,
    approvalTarget: parsed.data.approvalTarget,
    capabilityProfileRef: parsed.data.capabilityProfileRef,
  });
}

/**
 * QFJ-S2-C-B: the evidence fields an attestation must carry before it may back a candidate transition
 * above OFF. Returns the complete triple, or `undefined` when any part is absent.
 */
export function approvalEvidenceClaim(approval: RolloutApprovalAttestation):
  | {
      readonly evidenceDigest: string;
      readonly approvalTarget: string;
      readonly capabilityProfileRef: string;
    }
  | undefined {
  const { evidenceDigest, approvalTarget, capabilityProfileRef } = approval;
  if (
    evidenceDigest === undefined ||
    approvalTarget === undefined ||
    capabilityProfileRef === undefined
  ) {
    return undefined;
  }
  return { evidenceDigest, approvalTarget, capabilityProfileRef };
}

/** True iff the approval is bound to exactly this candidate release (id + config digest). */
export function approvalBindsRelease(
  approval: RolloutApprovalAttestation,
  release: ProviderReleaseRef,
): boolean {
  return sameRelease(
    { releaseId: approval.releaseId, configDigest: approval.configDigest } as ProviderReleaseRef,
    release,
  );
}

/** True iff `mode` is at or below the approval's approved mode ceiling. */
export function approvalPermitsMode(
  approval: RolloutApprovalAttestation,
  mode: GatewayMode,
): boolean {
  return MODE_RANK[mode] <= MODE_RANK[approval.approvedModeCeiling];
}

/** True iff `basisPoints` is at or below the approval's approved canary ceiling. */
export function approvalPermitsCanary(
  approval: RolloutApprovalAttestation,
  basisPoints: number,
): boolean {
  return basisPoints <= approval.approvedCanaryBasisPoints;
}
