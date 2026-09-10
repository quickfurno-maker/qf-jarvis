/**
 * JF-3 matrix items 1–12 — provisioning (ADR-0148 §2, §3).
 *
 * The JF-3 matrix is numbered independently of the ADR-0053 matrix that the other spec files in this
 * package use, and its items are labelled `JF3-n` so the two can never be confused for one another.
 *
 * What these pin: the default stays OFF, the historical no-op path is untouched, and ACTIVE serves
 * ONLY under the exact bindings — the right backend kind, a bound backend that declares that kind, and
 * an EXACT knowledge revision that the backend actually carries. Every other combination is refused
 * with its own precise reason, and none of them is downgraded to a quiet no-op.
 */
import { describe, expect, it } from 'vitest';

import type { RagRetrievalBackend } from '../contracts/retrieval-backend.js';
import { createGovernedExactBackend } from '../service/governed-exact-backend.js';
import { createRagProvisioner } from '../service/create-rag-provisioner.js';
import { invokeNoOpRag } from '../service/invoke-no-op-rag.js';
import { invokeRagRetrieval } from '../service/invoke-rag-retrieval.js';
import {
  activeProfileInput,
  disabledProfileInput,
  provisionedNoOpProfileInput,
} from '../testing/fixtures.js';
import {
  TEST_KNOWLEDGE_REVISION,
  testBackend,
  testRegistry,
  testRequest,
} from './knowledge-fixtures.js';

describe('JF-3 provisioning', () => {
  it('(JF3-1) absent config stays DISABLED, even with a backend supplied', () => {
    // A backend in the options is not consent. Absence of configuration is absence of authorization.
    const absent = createRagProvisioner(undefined, { backend: testBackend() });
    expect(absent.state).toBe('disabled');
    expect(absent.backend).toBeUndefined();
    expect(invokeNoOpRag(absent).reason).toBe('rag-disabled');
    expect(createRagProvisioner().state).toBe('disabled');
  });

  it('(JF3-2) a malformed config cannot activate', () => {
    for (const config of [
      { garbage: true },
      { ...activeProfileInput(), endpoint: 'http://example.invalid' },
      { ...activeProfileInput(), enabled: true },
      { ...activeProfileInput(), mode: 'ENABLED' },
    ]) {
      const provisioner = createRagProvisioner(config, { backend: testBackend() });
      expect(provisioner.state).toBe('invalid');
      expect(provisioner.backend).toBeUndefined();
    }
  });

  it('(JF3-3) a historical PROVISIONED_NO_OP profile still does zero retrieval', () => {
    // ADR-0053 behaviour preserved byte-for-byte: a composition written against it keeps working, and
    // keeps doing nothing, whether or not a backend is now available in the same process.
    const provisioner = createRagProvisioner(provisionedNoOpProfileInput(), {
      backend: testBackend(),
    });
    expect(provisioner.state).toBe('provisioned');
    expect(provisioner.backend).toBeUndefined();
    const result = invokeNoOpRag(provisioner);
    expect(result.reason).toBe('rag-provisioned-no-op');
    expect(result.retrievalCount).toBe(0);
    expect(result.embeddingCount).toBe(0);
    expect(result.vectorQueryCount).toBe(0);
    expect(result.augmentedCharacterCount).toBe(0);
    // And it cannot retrieve through the ACTIVE entry point either.
    expect(invokeRagRetrieval(provisioner, testRequest()).ok).toBe(false);
  });

  it('(JF3-4) ACTIVE + GOVERNED_EXACT succeeds with exact dependencies', () => {
    const backend = testBackend();
    const provisioner = createRagProvisioner(activeProfileInput(), { backend });
    expect(provisioner.state).toBe('active');
    expect(provisioner.refusal).toBeUndefined();
    expect(provisioner.backend).toBe(backend);
    expect(Object.isFrozen(provisioner)).toBe(true);
    expect(invokeRagRetrieval(provisioner, testRequest()).ok).toBe(true);
  });

  it('(JF3-5) ACTIVE + NONE refuses', () => {
    const provisioner = createRagProvisioner(activeProfileInput({ backendKind: 'NONE' }), {
      backend: testBackend(),
    });
    expect(provisioner.state).toBe('invalid');
    expect(provisioner.refusal).toBe('rag-backend-not-runtime-eligible');
  });

  it('(JF3-6) ACTIVE + FUTURE_LOCAL_VECTOR refuses', () => {
    const provisioner = createRagProvisioner(
      activeProfileInput({ backendKind: 'FUTURE_LOCAL_VECTOR' }),
      { backend: testBackend() },
    );
    expect(provisioner.state).toBe('invalid');
    expect(provisioner.refusal).toBe('rag-backend-not-runtime-eligible');
    expect(provisioner.backend).toBeUndefined();
  });

  it('(JF3-7) ACTIVE + FUTURE_MANAGED_VECTOR refuses', () => {
    const provisioner = createRagProvisioner(
      activeProfileInput({ backendKind: 'FUTURE_MANAGED_VECTOR' }),
      { backend: testBackend() },
    );
    expect(provisioner.state).toBe('invalid');
    expect(provisioner.refusal).toBe('rag-backend-not-runtime-eligible');
    expect(provisioner.backend).toBeUndefined();
  });

  it('(JF3-8) ACTIVE with a missing backend refuses, and is never downgraded', () => {
    const provisioner = createRagProvisioner(activeProfileInput());
    expect(provisioner.state).toBe('invalid');
    expect(provisioner.refusal).toBe('rag-backend-missing');
    // Not 'provisioned' and not 'disabled': an ACTIVE declaration that cannot serve has to be visible
    // as a failure. Serving nothing while the configuration says ACTIVE is the worst of both.
    expect(provisioner.state).not.toBe('provisioned');
    expect(provisioner.state).not.toBe('disabled');
  });

  it('(JF3-9) ACTIVE with no knowledgeRevision refuses', () => {
    const provisioner = createRagProvisioner(activeProfileInput({ knowledgeRevision: undefined }), {
      backend: testBackend(),
    });
    expect(provisioner.state).toBe('invalid');
    expect(provisioner.refusal).toBe('rag-knowledge-revision-missing');
  });

  it('(JF3-10) a wildcard or `latest` revision refuses, at the profile AND at the backend', () => {
    // `latest` is the whole failure in one word: an approval written against it approves nothing in
    // particular, and silently re-approves every future change to the pack.
    for (const revision of ['latest', 'LATEST', 'Latest']) {
      const provisioner = createRagProvisioner(
        activeProfileInput({ knowledgeRevision: revision }),
        {
          backend: testBackend(),
        },
      );
      expect(provisioner.state).toBe('invalid');
      expect(provisioner.refusal).toBe('rag-knowledge-revision-not-exact');
    }
    // A wildcard cannot even reach the provisioner: the profile identifier grammar excludes it.
    expect(
      createRagProvisioner(activeProfileInput({ knowledgeRevision: 'know.rev.*' }), {
        backend: testBackend(),
      }).refusal,
    ).toBe('rag-profile-invalid');
    // And a backend cannot be constructed with a moving pointer in the first place.
    for (const revision of ['latest', 'know.rev.*', '   ']) {
      expect(() =>
        createGovernedExactBackend({ registry: testRegistry(), knowledgeRevision: revision }),
      ).toThrow(Error);
    }
  });

  it('(JF3-11) a registry/pack revision mismatch refuses, in both directions', () => {
    // The binding that makes an approval mean something. Without it a profile could approve revision
    // `r1` while the registry behind the backend held anything at all -- same package, same backend
    // kind, same everything a coarser check compares.
    const mismatch = createRagProvisioner(activeProfileInput(), {
      backend: testBackend(undefined, 'know.rev.2'),
    });
    expect(mismatch.state).toBe('invalid');
    expect(mismatch.refusal).toBe('rag-knowledge-revision-mismatch');
    expect(mismatch.backend).toBeUndefined();

    const mirrored = createRagProvisioner(activeProfileInput({ knowledgeRevision: 'know.rev.9' }), {
      backend: testBackend(),
    });
    expect(mirrored.refusal).toBe('rag-knowledge-revision-mismatch');

    // A backend that declares a kind it is not cannot serve either.
    const liar: RagRetrievalBackend = Object.freeze({
      ...testBackend(),
      backendKind: 'FUTURE_MANAGED_VECTOR' as const,
    });
    expect(createRagProvisioner(activeProfileInput(), { backend: liar }).refusal).toBe(
      'rag-backend-kind-mismatch',
    );
  });

  it('(JF3-12) there is no default ACTIVE and no path that reaches it by omission', () => {
    // Every state that is not an explicit, fully-bound ACTIVE declaration. None of them serves.
    const backend = testBackend();
    for (const provisioner of [
      createRagProvisioner(),
      createRagProvisioner(undefined, { backend }),
      createRagProvisioner(null, { backend }),
      createRagProvisioner({}, { backend }),
      createRagProvisioner(disabledProfileInput(), { backend }),
      createRagProvisioner(provisionedNoOpProfileInput(), { backend }),
      createRagProvisioner(activeProfileInput()),
    ]) {
      expect(provisioner.state).not.toBe('active');
      expect(provisioner.backend).toBeUndefined();
    }
    // The ONE way in: name ACTIVE, name GOVERNED_EXACT, name the exact revision, bind the backend.
    expect(
      createRagProvisioner(activeProfileInput({ knowledgeRevision: TEST_KNOWLEDGE_REVISION }), {
        backend,
      }).state,
    ).toBe('active');
  });
});
