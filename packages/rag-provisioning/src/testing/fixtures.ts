/**
 * Deterministic synthetic fixtures for the QFJ-P04.05 no-op boundary (ADR-0053).
 *
 * The only shipped fixture content (exported under `./testing`). All synthetic — no endpoint, secret,
 * key, token, or content. Builds valid DISABLED and PROVISIONED_NO_OP profile inputs a test can vary.
 */
import type { RagProvisioningProfileInput } from '../contracts/provisioning-profile.js';

/** A valid DISABLED profile input (fully inert). */
export function disabledProfileInput(
  overrides: Partial<RagProvisioningProfileInput> = {},
): RagProvisioningProfileInput {
  return {
    profileId: 'rag.profile.disabled',
    profileVersion: 1,
    mode: 'DISABLED',
    backendKind: 'NONE',
    policyRevision: 'policy.rev.1',
    configDigest: 'abcdef01',
    createdAt: '2026-07-25T00:00:00Z',
    ...overrides,
  };
}

/** A valid PROVISIONED_NO_OP profile input with all future-facing references present. */
export function provisionedNoOpProfileInput(
  overrides: Partial<RagProvisioningProfileInput> = {},
): RagProvisioningProfileInput {
  return {
    profileId: 'rag.profile.provisioned',
    profileVersion: 1,
    mode: 'PROVISIONED_NO_OP',
    backendKind: 'NONE',
    policyRevision: 'policy.rev.1',
    configDigest: 'abcdef01',
    createdAt: '2026-07-25T00:00:00Z',
    knowledgeRevision: 'know.rev.1',
    capabilityRef: 'cap.profile.a',
    evaluationEvidenceRef: 'evref-000000',
    ...overrides,
  };
}
