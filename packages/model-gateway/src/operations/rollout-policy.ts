/**
 * The validated, frozen provider-rollout policy (QFJ-P04.01E, ADR-0049).
 *
 * A policy is pure configuration: a rollout id, a monotonic revision, a mode, a stable release, an
 * optional candidate release, the canary basis points, a shadow flag, a fallback-to-stable flag, the
 * bounded attempt limits, a closed operator reason, and the binding approval. It embeds NO provider
 * instance and NO secret. Validation is mode-specific: a candidate is required for SHADOW/CANARY/ACTIVE/
 * FALLBACK; canary basis points are meaningful only in CANARY; an approval that binds the candidate is
 * required whenever a candidate is present. Default construction is OFF.
 */
import { z } from 'zod';

import { GATEWAY_MODES, type GatewayMode } from '../contracts/enums.js';
import { approvalBindsRelease, type RolloutApprovalAttestation } from './rollout-approval.js';
import { createProviderReleaseRef, type ProviderReleaseRef } from './provider-release.js';
import { ROLLOUT_OPERATOR_REASONS, type RolloutOperatorReason } from './rollout-reasons.js';

const IDENTIFIER = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9._:-]+$/);
const MAX_ATTEMPTS_CEILING = 12;

/** The immutable rollout policy. */
export interface ProviderRolloutPolicy {
  readonly rolloutId: string;
  readonly revision: number;
  readonly mode: GatewayMode;
  readonly stable: ProviderReleaseRef;
  readonly candidate: ProviderReleaseRef | undefined;
  readonly canaryBasisPoints: number;
  readonly shadow: boolean;
  readonly fallbackToStable: boolean;
  readonly maxServingAttempts: number;
  readonly maxShadowAttempts: number;
  readonly operatorReason: RolloutOperatorReason;
  readonly approval: RolloutApprovalAttestation | undefined;
}

/** What a caller supplies to build a policy. Releases/approval are validated objects. */
export interface ProviderRolloutPolicyInput {
  readonly rolloutId: string;
  readonly revision: number;
  readonly mode: GatewayMode;
  readonly stable: ProviderReleaseRef;
  readonly candidate?: ProviderReleaseRef;
  readonly canaryBasisPoints?: number;
  readonly shadow?: boolean;
  readonly fallbackToStable?: boolean;
  readonly maxServingAttempts: number;
  readonly maxShadowAttempts?: number;
  readonly operatorReason: RolloutOperatorReason;
  readonly approval?: RolloutApprovalAttestation;
}

const primitivesSchema = z
  .object({
    rolloutId: IDENTIFIER,
    revision: z.int().min(0).max(1_000_000),
    mode: z.enum(GATEWAY_MODES),
    canaryBasisPoints: z.int().min(0).max(10_000),
    shadow: z.boolean(),
    fallbackToStable: z.boolean(),
    maxServingAttempts: z.int().min(1).max(MAX_ATTEMPTS_CEILING),
    maxShadowAttempts: z.int().min(0).max(4),
    operatorReason: z.enum(ROLLOUT_OPERATOR_REASONS),
  })
  .strict();

function isReleaseRef(value: unknown): value is ProviderReleaseRef {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  try {
    // Re-validate defensively: a forged plain object fails the release grammar.
    createProviderReleaseRef(value);
    return true;
  } catch {
    return false;
  }
}

/**
 * Validate and freeze a rollout policy. Mode-specific rules:
 *   - a candidate release is REQUIRED for SHADOW/CANARY/ACTIVE/FALLBACK and forbidden as identical to stable;
 *   - non-zero canary basis points are permitted ONLY in CANARY;
 *   - the `shadow` flag is permitted ONLY in SHADOW;
 *   - whenever a candidate is present, an approval that BINDS that candidate (id + digest) is required.
 * Throws a fixed-message error on any violation.
 */
export function createProviderRolloutPolicy(
  input: ProviderRolloutPolicyInput,
): ProviderRolloutPolicy {
  if (!isReleaseRef(input.stable)) {
    throw new Error('A rollout policy requires a valid stable release.');
  }
  if (input.candidate !== undefined && !isReleaseRef(input.candidate)) {
    throw new Error('A rollout policy candidate must be a valid release when present.');
  }
  const parsed = primitivesSchema.safeParse({
    rolloutId: input.rolloutId,
    revision: input.revision,
    mode: input.mode,
    canaryBasisPoints: input.canaryBasisPoints ?? 0,
    shadow: input.shadow ?? false,
    fallbackToStable: input.fallbackToStable ?? false,
    maxServingAttempts: input.maxServingAttempts,
    maxShadowAttempts: input.maxShadowAttempts ?? 1,
    operatorReason: input.operatorReason,
  });
  if (!parsed.success) {
    throw new Error('A rollout policy field is invalid.');
  }
  const p = parsed.data;
  const candidate = input.candidate;

  const needsCandidate =
    p.mode === 'SHADOW' || p.mode === 'CANARY' || p.mode === 'ACTIVE' || p.mode === 'FALLBACK';
  if (needsCandidate && candidate === undefined) {
    throw new Error('A rollout policy in this mode requires a candidate release.');
  }
  if (candidate !== undefined) {
    if (
      candidate.releaseId === input.stable.releaseId &&
      candidate.configDigest === input.stable.configDigest
    ) {
      throw new Error('A rollout policy candidate must differ from the stable release.');
    }
  }
  if (p.canaryBasisPoints > 0 && p.mode !== 'CANARY') {
    throw new Error('Canary basis points are permitted only in CANARY mode.');
  }
  if (p.shadow && p.mode !== 'SHADOW') {
    throw new Error('The shadow flag is permitted only in SHADOW mode.');
  }
  if (candidate !== undefined) {
    if (input.approval === undefined) {
      throw new Error('A rollout policy with a candidate requires a binding approval.');
    }
    if (!approvalBindsRelease(input.approval, candidate)) {
      throw new Error('The rollout approval does not bind the candidate release.');
    }
  }

  return Object.freeze({
    rolloutId: p.rolloutId,
    revision: p.revision,
    mode: p.mode,
    stable: input.stable,
    candidate,
    canaryBasisPoints: p.canaryBasisPoints,
    shadow: p.shadow,
    fallbackToStable: p.fallbackToStable,
    maxServingAttempts: p.maxServingAttempts,
    maxShadowAttempts: p.maxShadowAttempts,
    operatorReason: p.operatorReason,
    approval: input.approval,
  });
}

/** Build the default OFF policy for a rollout id + stable release (revision 0). */
export function offRolloutPolicy(
  rolloutId: string,
  stable: ProviderReleaseRef,
): ProviderRolloutPolicy {
  return createProviderRolloutPolicy({
    rolloutId,
    revision: 0,
    mode: 'OFF',
    stable,
    maxServingAttempts: 3,
    operatorReason: 'initial-enable',
  });
}
