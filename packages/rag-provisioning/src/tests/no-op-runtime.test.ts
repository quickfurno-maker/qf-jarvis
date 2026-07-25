/**
 * QFJ-P04.05 — zero-side-effect runtime and approval/privacy/authority (ADR-0053 §B, §G, §I–§K).
 *
 * Matrix items 11–27: DISABLED and PROVISIONED_NO_OP return no-op with zero counters and no content;
 * a future backend cannot run; deterministic; capability/knowledge/evaluation/rollout references never
 * enable; no tenant content/subject/prompt/PII/secret accepted; no business authorize/execute method.
 */
import { describe, expect, it } from 'vitest';

import { RagProvisioningError } from '../contracts/errors.js';
import { createRagRequestMetadata } from '../contracts/request.js';
import type { RagEvent, RagObservabilityHook } from '../contracts/observability.js';
import { createRagProvisioner } from '../service/create-rag-provisioner.js';
import { invokeNoOpRag } from '../service/invoke-no-op-rag.js';
import { disabledProfileInput, provisionedNoOpProfileInput } from '../testing/fixtures.js';

function recorder(): { hook: RagObservabilityHook; events: RagEvent[] } {
  const events: RagEvent[] = [];
  return { hook: { onEvent: (e) => events.push(e) }, events };
}

function expectZeroCounters(result: {
  retrievalCount: number;
  embeddingCount: number;
  vectorQueryCount: number;
  augmentedCharacterCount: number;
}): void {
  expect(result.retrievalCount).toBe(0);
  expect(result.embeddingCount).toBe(0);
  expect(result.vectorQueryCount).toBe(0);
  expect(result.augmentedCharacterCount).toBe(0);
}

describe('zero-side-effect runtime', () => {
  it('(11) DISABLED returns a no-op with rag-disabled', () => {
    const result = invokeNoOpRag(createRagProvisioner(disabledProfileInput()));
    expect(result.reason).toBe('rag-disabled');
    expect(result.mode).toBe('DISABLED');
    expectZeroCounters(result);
  });

  it('(12) PROVISIONED_NO_OP returns a no-op with rag-provisioned-no-op', () => {
    const result = invokeNoOpRag(createRagProvisioner(provisionedNoOpProfileInput()));
    expect(result.reason).toBe('rag-provisioned-no-op');
    expect(result.mode).toBe('PROVISIONED_NO_OP');
    expectZeroCounters(result);
  });

  it('(13) a future local/managed backend cannot run', () => {
    for (const backendKind of ['FUTURE_LOCAL_VECTOR', 'FUTURE_MANAGED_VECTOR'] as const) {
      const result = invokeNoOpRag(
        createRagProvisioner(provisionedNoOpProfileInput({ backendKind })),
      );
      expect(result.reason).toBe('rag-backend-not-runtime-eligible');
      expectZeroCounters(result);
    }
  });

  it('(14,15) counters are exactly zero and the result carries no content/citation/prompt/output', () => {
    const result = invokeNoOpRag(createRagProvisioner(provisionedNoOpProfileInput()));
    expectZeroCounters(result);
    const keys = Object.keys(result).sort();
    expect(keys).toEqual([
      'augmentedCharacterCount',
      'embeddingCount',
      'mode',
      'profileId',
      'profileVersion',
      'reason',
      'retrievalCount',
      'vectorQueryCount',
    ]);
    const serialized = JSON.stringify(result);
    for (const forbidden of ['content', 'citation', 'prompt', 'document', 'text']) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it('(16) the provisioner and result expose no retriever/embedding/vector/provider method', () => {
    const provisioner = createRagProvisioner(provisionedNoOpProfileInput()) as unknown as Record<
      string,
      unknown
    >;
    const result = invokeNoOpRag(
      createRagProvisioner(provisionedNoOpProfileInput()),
    ) as unknown as Record<string, unknown>;
    for (const method of ['retrieve', 'embed', 'query', 'search', 'index', 'augment']) {
      expect(provisioner[method]).toBeUndefined();
      expect(result[method]).toBeUndefined();
    }
  });

  it('(18) is deterministic for the same config', () => {
    const a = invokeNoOpRag(createRagProvisioner(provisionedNoOpProfileInput()));
    const b = invokeNoOpRag(createRagProvisioner(provisionedNoOpProfileInput()));
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

describe('approval, privacy, and authority', () => {
  it('(19,20,21,22) capability/knowledge/evaluation references never enable RAG', () => {
    // A fully-referenced PROVISIONED_NO_OP profile (capability + knowledge + synthetic evidence) is
    // STILL a no-op — none of these references turns RAG on.
    const result = invokeNoOpRag(createRagProvisioner(provisionedNoOpProfileInput()));
    expect(result.reason).toBe('rag-provisioned-no-op');
    expect(result.mode).not.toBe('ENABLED');
    expectZeroCounters(result);
  });

  it('(23,25) exposes no provider-activation / rollout-mutation / business method', () => {
    const provisioner = createRagProvisioner(provisionedNoOpProfileInput()) as unknown as Record<
      string,
      unknown
    >;
    for (const method of [
      'activate',
      'promote',
      'mutate',
      'authorize',
      'execute',
      'send',
      'callN8n',
    ]) {
      expect(provisioner[method]).toBeUndefined();
    }
  });

  it('(24) accepts no tenant content/subject/prompt/message/PII/secret in request metadata', () => {
    // A valid content-free request is fine.
    const ok = createRagRequestMetadata({
      runId: 'run-1',
      taskClass: 'RESPONSE_GENERATION',
      dataClass: 'LOCAL_ONLY',
    });
    expect(ok.runId).toBe('run-1');
    // Any content-bearing field is rejected (strict).
    for (const bad of [
      { prompt: 'hi' },
      { message: 'hi' },
      { subject: 'person.1' },
      { topic: 't' },
      { document: 'd' },
      { secret: 'sk-0' },
    ]) {
      expect(() => createRagRequestMetadata({ runId: 'run-1', ...bad })).toThrow(
        RagProvisioningError,
      );
    }
  });
});

describe('observability', () => {
  it('(28,29) emits content-free events with safe fields and zero counters', () => {
    const { hook, events } = recorder();
    const provisioner = createRagProvisioner(provisionedNoOpProfileInput(), {
      observability: hook,
    });
    invokeNoOpRag(provisioner, undefined, { observability: hook });
    expect(events.length).toBe(2);
    for (const event of events) {
      expect(event.retrievalCount).toBe(0);
      expect(event.embeddingCount).toBe(0);
      expect(event.vectorQueryCount).toBe(0);
      expect(event.augmentedCharacterCount).toBe(0);
    }
    const serialized = JSON.stringify(events);
    for (const forbidden of ['prompt', 'content', 'subject', 'document', 'sk-']) {
      expect(serialized).not.toContain(forbidden);
    }
  });
});
