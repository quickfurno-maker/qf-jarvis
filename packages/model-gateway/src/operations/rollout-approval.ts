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
  });
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
