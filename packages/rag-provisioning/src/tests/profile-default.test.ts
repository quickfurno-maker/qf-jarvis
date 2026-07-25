/**
 * QFJ-P04.05 — profile and default (ADR-0053 §C, §D).
 *
 * Matrix items 1–10: valid DISABLED/PROVISIONED_NO_OP profiles frozen; instant/version validation;
 * invalid/oversized/wildcard/latest rejected; exact refs preserved; missing refs fail closed; unknown
 * mode/backend rejected; no endpoint/secret/metadata; absent config → DISABLED; malformed → fail
 * closed; no `enabled=true` and no automatic transition.
 */
import { describe, expect, it } from 'vitest';

import { RagProvisioningError } from '../contracts/errors.js';
import { createRagProvisioningProfile } from '../contracts/provisioning-profile.js';
import { RAG_PROVISIONING_MODES } from '../contracts/vocabularies.js';
import { createRagProvisioner } from '../service/create-rag-provisioner.js';
import { invokeNoOpRag } from '../service/invoke-no-op-rag.js';
import { disabledProfileInput, provisionedNoOpProfileInput } from '../testing/fixtures.js';

function expectInvalidProfile(input: unknown): void {
  try {
    createRagProvisioningProfile(input as Parameters<typeof createRagProvisioningProfile>[0]);
    throw new Error('expected RagProvisioningError');
  } catch (error) {
    expect(error).toBeInstanceOf(RagProvisioningError);
    expect((error as RagProvisioningError).code).toBe('invalid-profile');
  }
}

describe('profile and default', () => {
  it('(1) freezes valid DISABLED and PROVISIONED_NO_OP profiles', () => {
    const disabled = createRagProvisioningProfile(disabledProfileInput());
    const provisioned = createRagProvisioningProfile(provisionedNoOpProfileInput());
    expect(Object.isFrozen(disabled)).toBe(true);
    expect(Object.isFrozen(provisioned)).toBe(true);
    expect(disabled.mode).toBe('DISABLED');
    expect(provisioned.mode).toBe('PROVISIONED_NO_OP');
  });

  it('(2) validates a canonical instant and a positive version', () => {
    expectInvalidProfile(disabledProfileInput({ createdAt: '2026-07-25' }));
    expectInvalidProfile(disabledProfileInput({ profileVersion: 0 }));
    expectInvalidProfile(disabledProfileInput({ profileVersion: -1 }));
  });

  it('(3) rejects invalid, oversized, wildcard, and `latest` identities', () => {
    expectInvalidProfile(disabledProfileInput({ profileId: 'has space' }));
    expectInvalidProfile(disabledProfileInput({ profileId: 'a'.repeat(129) }));
    expectInvalidProfile(disabledProfileInput({ profileId: 'latest' }));
    expectInvalidProfile(disabledProfileInput({ profileId: 'bad*id' }));
  });

  it('(4) preserves exact capability/evaluation/knowledge/policy references', () => {
    const p = createRagProvisioningProfile(provisionedNoOpProfileInput());
    expect(p.capabilityRef).toBe('cap.profile.a');
    expect(p.evaluationEvidenceRef).toBe('evref-000000');
    expect(p.knowledgeRevision).toBe('know.rev.1');
    expect(p.policyRevision).toBe('policy.rev.1');
  });

  it('(5) fails closed with the precise reason when a PROVISIONED_NO_OP ref is missing', () => {
    const noEval = createRagProvisioner(
      provisionedNoOpProfileInput({ evaluationEvidenceRef: undefined }),
    );
    expect(invokeNoOpRag(noEval).reason).toBe('rag-evaluation-reference-missing');
    const noCap = createRagProvisioner(provisionedNoOpProfileInput({ capabilityRef: undefined }));
    expect(invokeNoOpRag(noCap).reason).toBe('rag-capability-reference-missing');
    const noKnow = createRagProvisioner(
      provisionedNoOpProfileInput({ knowledgeRevision: undefined }),
    );
    expect(invokeNoOpRag(noKnow).reason).toBe('rag-knowledge-revision-missing');
  });

  it('(6) rejects an unknown mode or backend kind', () => {
    expectInvalidProfile(disabledProfileInput({ mode: 'ENABLED' as never }));
    expectInvalidProfile(disabledProfileInput({ mode: 'ACTIVE' as never }));
    expectInvalidProfile(disabledProfileInput({ backendKind: 'PINECONE' as never }));
  });

  it('(7,10) rejects an endpoint/secret/enabled/arbitrary field (strict, no enabled=true)', () => {
    expectInvalidProfile({ ...disabledProfileInput(), endpoint: 'http://x' });
    expectInvalidProfile({ ...disabledProfileInput(), apiKey: 'sk-000' });
    expectInvalidProfile({ ...disabledProfileInput(), enabled: true });
    // The mode vocabulary has no ENABLED/ACTIVE at all.
    expect([...RAG_PROVISIONING_MODES]).toEqual(['DISABLED', 'PROVISIONED_NO_OP']);
  });

  it('(8) treats absent config as DISABLED', () => {
    const provisioner = createRagProvisioner();
    expect(provisioner.state).toBe('disabled');
    expect(invokeNoOpRag(provisioner).reason).toBe('rag-disabled');
  });

  it('(9) fails closed on a malformed config (no throw)', () => {
    const provisioner = createRagProvisioner({ garbage: true });
    expect(provisioner.state).toBe('invalid');
    expect(invokeNoOpRag(provisioner).reason).toBe('rag-profile-invalid');
  });
});
