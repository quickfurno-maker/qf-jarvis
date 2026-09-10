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
import { testBackend, testPack, testRecordInput, testRequest } from './knowledge-fixtures.js';

/** Every derived revision is a content identity of exactly this shape. */
const DERIVED = /^qfj\.knowledge\.sha256\.[0-9a-f]{64}$/;

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
    const provisioner = createRagProvisioner(
      activeProfileInput({ knowledgeRevision: backend.knowledgeRevision }),
      { backend },
    );
    expect(provisioner.state).toBe('active');
    expect(provisioner.refusal).toBeUndefined();
    expect(provisioner.backend).toBe(backend);
    expect(Object.isFrozen(provisioner)).toBe(true);
    expect(invokeRagRetrieval(provisioner, testRequest()).ok).toBe(true);
  });

  it('(JF3-5) ACTIVE + NONE refuses', () => {
    const backend = testBackend();
    const provisioner = createRagProvisioner(
      activeProfileInput({ backendKind: 'NONE', knowledgeRevision: backend.knowledgeRevision }),
      { backend },
    );
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

  it('(JF3-10) a wildcard or `latest` revision refuses, and no pack can ever derive one', () => {
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

    // The backend side is now structural rather than validated. A revision is DERIVED from records,
    // so there is no parameter through which a moving pointer could be supplied at all -- and every
    // derived revision is an exact 64-hex content identity.
    expect(testBackend().knowledgeRevision).toMatch(DERIVED);
    expect(testPack([]).knowledgeRevision).toMatch(DERIVED);
    // Passing something that is not a pack is refused rather than coerced.
    for (const notAPack of [undefined, null, {}, { knowledgeRevision: 'latest' }]) {
      expect(() =>
        createGovernedExactBackend({ pack: notAPack as unknown as ReturnType<typeof testPack> }),
      ).toThrow(Error);
    }
  });

  it('(JF3-11) a pack revision mismatch refuses, in both directions', () => {
    // Two packs whose CONTENT differs, so their derived revisions differ. That is now the only way a
    // mismatch can arise -- a caller can no longer produce one by typing a different label.
    const packA = testBackend();
    const packB = testBackend([
      testRecordInput({
        content: 'SYNTHETIC RECORD B. Invented for a spec; not business truth.',
        contentDigest: 'b'.repeat(64),
      }),
    ]);
    expect(packA.knowledgeRevision).not.toBe(packB.knowledgeRevision);

    const mismatch = createRagProvisioner(
      activeProfileInput({ knowledgeRevision: packA.knowledgeRevision }),
      { backend: packB },
    );
    expect(mismatch.state).toBe('invalid');
    expect(mismatch.refusal).toBe('rag-knowledge-revision-mismatch');
    expect(mismatch.backend).toBeUndefined();

    const mirrored = createRagProvisioner(
      activeProfileInput({ knowledgeRevision: packB.knowledgeRevision }),
      { backend: packA },
    );
    expect(mirrored.refusal).toBe('rag-knowledge-revision-mismatch');

    // A profile naming a revision no pack ever derived is refused too.
    expect(
      createRagProvisioner(activeProfileInput({ knowledgeRevision: 'know.rev.invented' }), {
        backend: packA,
      }).refusal,
    ).toBe('rag-knowledge-revision-mismatch');

    // A backend that declares a kind it is not cannot serve either.
    const liar: RagRetrievalBackend = Object.freeze({
      ...packA,
      backendKind: 'FUTURE_MANAGED_VECTOR' as const,
    });
    expect(
      createRagProvisioner(activeProfileInput({ knowledgeRevision: packA.knowledgeRevision }), {
        backend: liar,
      }).refusal,
    ).toBe('rag-backend-kind-mismatch');
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
      createRagProvisioner(activeProfileInput({ knowledgeRevision: backend.knowledgeRevision }), {
        backend,
      }).state,
    ).toBe('active');
  });
});
