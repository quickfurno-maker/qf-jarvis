/**
 * The RAG provisioner factory (QFJ-P04.05 ADR-0053 §B/§C; JF-3 activation, ADR-0148).
 *
 * Builds a provisioner from an OPTIONAL config: absent config → `DISABLED`; a malformed config → a
 * fail-closed `invalid` provisioner (no throw); a valid profile → the corresponding state. The factory
 * performs no network, filesystem, env, clock, or provider access.
 *
 * ### The default is still OFF, and absence is still not consent
 *
 * An absent configuration is `DISABLED`. A malformed one is `invalid`. Neither becomes `active`, and
 * there is no code path where a missing field is filled in with something that serves.
 *
 * ### ACTIVE is reachable, and only under exact bindings
 *
 * `ACTIVE` requires all of: the `GOVERNED_EXACT` backend kind on the profile, a backend instance that
 * declares that same kind, a `knowledgeRevision` on the profile that is an EXACT identity rather than
 * `latest` or a wildcard, and a backend carrying that EXACT revision. The last one is the binding that makes the approval mean something — without it a profile
 * could approve revision `r1` while the registry behind the backend held anything at all.
 *
 * The `FUTURE_*` vector backends stay refused. They are placeholders; JF-3 built no vector retrieval.
 */
import type { RagObservabilityHook } from '../contracts/observability.js';
import { NOOP_RAG_OBSERVABILITY } from '../contracts/observability.js';
import { tryCreateRagProvisioningProfile } from '../contracts/provisioning-profile.js';
import type { RagProvisioningProfile } from '../contracts/provisioning-profile.js';
import type { RagRetrievalBackend } from '../contracts/retrieval-backend.js';
import { ACTIVE_ELIGIBLE_BACKEND } from '../contracts/vocabularies.js';
import type { RagReason } from '../contracts/vocabularies.js';

/** The state of a provisioner. `active` is reachable only through the JF-3 bindings above. */
export type RagProvisionerState = 'disabled' | 'provisioned' | 'invalid' | 'active';

/** An immutable RAG provisioner. It holds a validated profile, and for `active` a bound backend. */
export interface RagProvisioner {
  readonly state: RagProvisionerState;
  readonly profile: RagProvisioningProfile | undefined;
  /** Present only when `state === 'active'`. Never mutable, never replaceable. */
  readonly backend: RagRetrievalBackend | undefined;
  /** Why an ACTIVE profile was refused, when one was. Content-free. */
  readonly refusal: RagReason | undefined;
}

export interface CreateRagProvisionerOptions {
  readonly observability?: RagObservabilityHook;
  /** REQUIRED for an ACTIVE profile. An ACTIVE profile with no backend is refused, never downgraded. */
  readonly backend?: RagRetrievalBackend;
}

/** Is this an EXACT revision identity, rather than a moving pointer at whatever is current? */
function isExactRevision(revision: string): boolean {
  const normalized = revision.trim().toLowerCase();
  return normalized.length > 0 && normalized !== 'latest' && !normalized.includes('*');
}

/** Decide whether an ACTIVE profile may serve. Returns the refusal reason, or `undefined` to serve. */
function refuseActive(
  profile: RagProvisioningProfile,
  backend: RagRetrievalBackend | undefined,
): RagReason | undefined {
  // The FUTURE_* placeholders and NONE are not serving backends. Refused, never downgraded to no-op:
  // silently serving nothing while the configuration says ACTIVE is the worst of both.
  if (profile.backendKind !== ACTIVE_ELIGIBLE_BACKEND) {
    return 'rag-backend-not-runtime-eligible';
  }
  if (backend === undefined) {
    return 'rag-backend-missing';
  }
  if (backend.backendKind !== profile.backendKind) {
    return 'rag-backend-kind-mismatch';
  }
  if (profile.knowledgeRevision === undefined) {
    return 'rag-knowledge-revision-missing';
  }
  // A moving pointer is not an approval. `latest` would make the revision check below pass forever,
  // against whatever the pack happened to contain at the moment somebody looked.
  if (!isExactRevision(profile.knowledgeRevision) || !isExactRevision(backend.knowledgeRevision)) {
    return 'rag-knowledge-revision-not-exact';
  }
  if (profile.knowledgeRevision !== backend.knowledgeRevision) {
    return 'rag-knowledge-revision-mismatch';
  }
  return undefined;
}

/** Build a provisioner. Absent config → DISABLED; malformed config → fail-closed invalid. */
export function createRagProvisioner(
  config?: unknown,
  options?: CreateRagProvisionerOptions,
): RagProvisioner {
  const hook = options?.observability ?? NOOP_RAG_OBSERVABILITY;

  const inert = (
    state: RagProvisionerState,
    profile: RagProvisioningProfile | undefined,
    refusal?: RagReason,
  ): RagProvisioner =>
    Object.freeze({
      state,
      profile,
      backend: undefined,
      refusal,
    });

  let provisioner: RagProvisioner;
  if (config === undefined || config === null) {
    provisioner = inert('disabled', undefined);
  } else {
    const profile = tryCreateRagProvisioningProfile(config);
    if (profile === null) {
      provisioner = inert('invalid', undefined, 'rag-profile-invalid');
    } else if (profile.mode === 'ACTIVE') {
      const refusal = refuseActive(profile, options?.backend);
      provisioner =
        refusal === undefined
          ? Object.freeze({
              state: 'active' as const,
              profile,
              backend: options?.backend,
              refusal: undefined,
            })
          : inert('invalid', profile, refusal);
    } else if (profile.mode === 'PROVISIONED_NO_OP') {
      provisioner = inert('provisioned', profile);
    } else {
      provisioner = inert('disabled', profile);
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
      reason:
        provisioner.refusal ?? (provisioner.state === 'active' ? 'rag-active' : 'rag-disabled'),
      retrievalCount: 0,
      // GOVERNED_EXACT performs no embedding and no vector query. These stay zero for compatibility,
      // and a spec asserts they are never anything else.
      embeddingCount: 0,
      vectorQueryCount: 0,
      augmentedCharacterCount: 0,
    }),
  );

  return provisioner;
}
