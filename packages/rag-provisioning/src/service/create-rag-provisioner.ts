/**
 * The RAG provisioner factory (QFJ-P04.05, ADR-0053 §B, §C).
 *
 * Builds an inert provisioner from an OPTIONAL config: absent config → `DISABLED`; a malformed config
 * → a fail-closed `invalid` provisioner (no throw); a valid `DISABLED`/`PROVISIONED_NO_OP` profile →
 * the corresponding state. There is NO `ENABLED`/`ACTIVE` state and no `enabled=true`. The factory
 * performs no network, filesystem, env, clock, or provider access.
 */
import type { RagObservabilityHook } from '../contracts/observability.js';
import { NOOP_RAG_OBSERVABILITY } from '../contracts/observability.js';
import { tryCreateRagProvisioningProfile } from '../contracts/provisioning-profile.js';
import type { RagProvisioningProfile } from '../contracts/provisioning-profile.js';

/** The inert state of a provisioner. There is deliberately no `enabled`/`active` state. */
export type RagProvisionerState = 'disabled' | 'provisioned' | 'invalid';

/** An immutable, inert RAG provisioner. It holds a validated profile or none; it enables nothing. */
export interface RagProvisioner {
  readonly state: RagProvisionerState;
  readonly profile: RagProvisioningProfile | undefined;
}

export interface CreateRagProvisionerOptions {
  readonly observability?: RagObservabilityHook;
}

/** Build an inert provisioner. Absent config → DISABLED; malformed config → fail-closed invalid. */
export function createRagProvisioner(
  config?: unknown,
  options?: CreateRagProvisionerOptions,
): RagProvisioner {
  const hook = options?.observability ?? NOOP_RAG_OBSERVABILITY;

  let provisioner: RagProvisioner;
  if (config === undefined || config === null) {
    provisioner = Object.freeze({ state: 'disabled', profile: undefined });
  } else {
    const profile = tryCreateRagProvisioningProfile(config);
    if (profile === null) {
      provisioner = Object.freeze({ state: 'invalid', profile: undefined });
    } else if (profile.mode === 'PROVISIONED_NO_OP') {
      provisioner = Object.freeze({ state: 'provisioned', profile });
    } else {
      provisioner = Object.freeze({ state: 'disabled', profile });
    }
  }

  const profile = provisioner.profile;
  hook.onEvent(
    Object.freeze({
      type: 'rag-provisioner-created',
      profileId: profile?.profileId ?? 'none',
      profileVersion: profile?.profileVersion ?? 0,
      mode: profile?.mode ?? 'DISABLED',
      backendKind: profile?.backendKind ?? 'NONE',
      reason: provisioner.state === 'invalid' ? 'rag-profile-invalid' : 'rag-disabled',
      retrievalCount: 0,
      embeddingCount: 0,
      vectorQueryCount: 0,
      augmentedCharacterCount: 0,
    }),
  );

  return provisioner;
}
