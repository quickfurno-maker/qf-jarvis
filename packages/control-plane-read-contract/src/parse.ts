import { CONTROL_PLANE_READ_CONTRACT_VERSION } from './contract/primitives.js';
import { controlPlaneSnapshotV1Schema } from './contract/snapshot.js';
import type { ControlPlaneSnapshotV1 } from './contract/snapshot.js';
import {
  CONTROL_PLANE_READ_CONTRACT_V2_VERSION,
  controlPlaneSnapshotV2Schema,
} from './contract/snapshot-v2.js';
import type { ControlPlaneSnapshotV2 } from './contract/snapshot-v2.js';
import { ControlPlaneReadContractError } from './errors.js';
import type { ControlPlaneReadContractIssue } from './errors.js';

/**
 * Parse and freeze an unknown payload as a `ControlPlaneSnapshotV1` (JOS-01B, ADR-0086).
 *
 * This is the only way into the contract, for both directions of travel. The server validates what
 * it built before serving it, and a client validates what it received before rendering it — the
 * same function, the same rules. A builder that could emit something no client would accept is a
 * bug that surfaces in production; running the identical check on both sides removes the category.
 *
 * The result is deeply frozen and structurally detached from the input, so a caller that keeps a
 * reference to the object it passed in cannot mutate what this returned afterwards.
 */
export function parseControlPlaneSnapshotV1(payload: unknown): ControlPlaneSnapshotV1 {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    throw new ControlPlaneReadContractError('snapshot-malformed');
  }

  // Version is checked BEFORE shape. A v2 payload should be told it is a version mismatch rather
  // than handed a list of v1 field errors that suggest the sender made a hundred mistakes.
  const declared = (payload as { readonly contractVersion?: unknown }).contractVersion;
  if (declared !== undefined && declared !== CONTROL_PLANE_READ_CONTRACT_VERSION) {
    throw new ControlPlaneReadContractError('contract-version-unsupported');
  }

  const result = controlPlaneSnapshotV1Schema.safeParse(payload);
  if (!result.success) {
    const issues: ControlPlaneReadContractIssue[] = result.error.issues.map((issue) => ({
      path: issue.path.join('.'),
      message: issue.message,
    }));
    throw new ControlPlaneReadContractError('snapshot-invalid', issues);
  }

  // `safeParse` already produced a fresh object graph, so freezing it cannot affect the caller's
  // input. Freeze depth-first so nested sections are immutable too, not just the root.
  return deepFreeze(result.data);
}

/**
 * Parse and freeze an unknown payload as a `ControlPlaneSnapshotV2` (AVG-11, ADR-0129).
 *
 * The V1 function above is UNCHANGED and stays the only way into V1. This is its sibling, not its
 * replacement: the two enforce different contracts, and a caller states which one it speaks by
 * choosing a function rather than by passing a flag. There is deliberately no
 * `parseControlPlaneSnapshot(version)` — a single entry point taking a version is one `??` away from
 * parsing a payload against the wrong contract and calling it valid.
 *
 * ### Version is checked BEFORE shape, in both directions
 *
 * A V1 payload handed to this function is told it is a version mismatch, not handed a list of V2
 * field errors suggesting the sender made a hundred mistakes — and the same is true of a V2 payload
 * handed to `parseControlPlaneSnapshotV1`. That symmetry is what makes an upgrade legible from either
 * side of it.
 *
 * The result is deeply frozen and structurally detached from the input, exactly as V1's is.
 */
export function parseControlPlaneSnapshotV2(payload: unknown): ControlPlaneSnapshotV2 {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    throw new ControlPlaneReadContractError('snapshot-malformed');
  }

  const declared = (payload as { readonly contractVersion?: unknown }).contractVersion;
  if (declared !== undefined && declared !== CONTROL_PLANE_READ_CONTRACT_V2_VERSION) {
    throw new ControlPlaneReadContractError('contract-version-unsupported');
  }

  const result = controlPlaneSnapshotV2Schema.safeParse(payload);
  if (!result.success) {
    const issues: ControlPlaneReadContractIssue[] = result.error.issues.map((issue) => ({
      path: issue.path.join('.'),
      message: issue.message,
    }));
    throw new ControlPlaneReadContractError('snapshot-invalid', issues);
  }

  return deepFreeze(result.data);
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== 'object' || value === null) {
    return value;
  }
  for (const nested of Object.values(value)) {
    deepFreeze(nested);
  }
  return Object.freeze(value);
}
