/**
 * Deterministic synthetic fixtures for the QFJ-P04.05 no-op boundary (ADR-0053).
 *
 * The only shipped fixture content (exported under `./testing`). All synthetic — no endpoint, secret,
 * key, token, or content. Builds valid DISABLED, PROVISIONED_NO_OP and ACTIVE profile inputs a test
 * can vary.
 *
 * These are profile INPUTS — configuration shapes. No knowledge record, and therefore no content,
 * is ever built here: a shipped module that could produce governed records would be a shipped
 * module that could produce answers, and synthetic answers are the one thing a production
 * composition must not be able to reach by importing a fixture subpath.
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

/**
 * A valid ACTIVE profile input (JF-3, ADR-0148).
 *
 * Synthetic, and still not an authorization: composing it requires a bound GOVERNED_EXACT backend
 * carrying EXACTLY `knowledgeRevision`, or the provisioner refuses.
 */
export function activeProfileInput(
  overrides: Partial<RagProvisioningProfileInput> = {},
): RagProvisioningProfileInput {
  return {
    profileId: 'rag.profile.active',
    profileVersion: 1,
    mode: 'ACTIVE',
    backendKind: 'GOVERNED_EXACT',
    policyRevision: 'policy.rev.1',
    configDigest: 'abcdef01',
    createdAt: '2026-07-25T00:00:00Z',
    knowledgeRevision: 'know.rev.1',
    capabilityRef: 'cap.profile.a',
    evaluationEvidenceRef: 'evref-000000',
    ...overrides,
  };
}
