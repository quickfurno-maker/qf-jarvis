/**
 * QFJ-M4 — provenance and citation validation (ADR-0057 §H, §I).
 *
 * Matrix 48–59: exact provenance is accepted; a provider/model/version or prompt mismatch fails
 * closed; a capability/evaluation/execution-class mismatch fails closed at plan validation; an exact
 * citation subset is accepted; a fabricated, versionless, or superseded citation is rejected and never
 * silently dropped.
 */
import { describe, expect, it } from 'vitest';

import {
  createModelReplyAdapter,
  type ModelReplyAdapterConfig,
} from '../adapter/create-model-reply-adapter.js';
import type { ModelGatewayInvoker } from '../gateway/model-gateway-invoker.js';
import {
  clearReplyState,
  fixedClock,
  mismatchedProvenanceGatewayInvoker,
  rawStructuredGatewayInvoker,
  replyPlan,
  scriptedGatewayInvoker,
  scriptedReplyStateReader,
  structuredReply,
  syntheticRelease,
} from '../testing/index.js';

function makeAdapter(
  invoker: ModelGatewayInvoker,
  over: Partial<Pick<ModelReplyAdapterConfig, 'capabilityProfileRef' | 'evaluationRef'>> = {},
) {
  const config: ModelReplyAdapterConfig = {
    release: syntheticRelease(),
    promptFamily: 'reply.client',
    promptVersion: 1,
    capabilityProfileRef: 'cap.reply.v1',
    evaluationRef: 'evref-000000',
    stateReader: scriptedReplyStateReader(clearReplyState(), clearReplyState()),
    clock: fixedClock(),
    invoker,
    ...over,
  };
  return createModelReplyAdapter(config);
}
const run = (invoker: ModelGatewayInvoker) => makeAdapter(invoker).draftReplyDetailed(replyPlan());

describe('provenance validation', () => {
  it('(48) exact provenance is accepted', () => {
    expect(run(scriptedGatewayInvoker(structuredReply())).ok).toBe(true);
  });

  const mismatches = [
    { label: '(49) release/model mismatch', over: { modelId: 'other.model' } },
    { label: '(50) provider mismatch', over: { providerId: 'other.provider' } },
    { label: '(50) model-version mismatch', over: { modelVersion: '2' } },
    { label: '(51) prompt-id mismatch', over: { promptId: 'other.prompt' } },
    { label: '(51) prompt-version mismatch', over: { promptVersion: '2' } },
    { label: '(50) run-id mismatch', over: { runId: 'other.run' } },
  ];
  for (const { label, over } of mismatches) {
    it(`${label} fails closed`, () => {
      const result = run(mismatchedProvenanceGatewayInvoker(structuredReply(), over));
      expect(result.ok).toBe(false);
      expect(result.reason).toBe('model-provenance-mismatch');
    });
  }
});

describe('plan-identity validation', () => {
  it('(52) a capability-profile mismatch fails closed', () => {
    const adapter = makeAdapter(scriptedGatewayInvoker(structuredReply()), {
      capabilityProfileRef: 'cap.other',
    });
    expect(adapter.draftReplyDetailed(replyPlan()).reason).toBe('model-plan-invalid');
  });

  it('(53) an evaluation-reference mismatch fails closed', () => {
    const adapter = makeAdapter(scriptedGatewayInvoker(structuredReply()), {
      evaluationRef: 'evref-999999',
    });
    expect(adapter.draftReplyDetailed(replyPlan()).reason).toBe('model-plan-invalid');
  });

  it('(54) an execution-class mismatch (LOCAL_ONLY + hosted) fails closed', () => {
    const result = makeAdapter(scriptedGatewayInvoker(structuredReply())).draftReplyDetailed(
      replyPlan({ dataClass: 'LOCAL_ONLY' }),
    );
    expect(result.reason).toBe('model-plan-invalid');
  });
});

describe('citation validation', () => {
  it('(55) an exact citation subset is accepted', () => {
    const reply = structuredReply({ citations: [{ knowledgeId: 'kb.fact', version: 1 }] });
    expect(run(scriptedGatewayInvoker(reply)).ok).toBe(true);
  });

  it('(56) a fabricated citation is rejected', () => {
    const reply = structuredReply({ citations: [{ knowledgeId: 'kb.ghost', version: 1 }] });
    expect(run(scriptedGatewayInvoker(reply)).reason).toBe('model-citation-mismatch');
  });

  it('(57) a versionless citation is rejected', () => {
    const result = run(
      rawStructuredGatewayInvoker({
        kind: 'REPLY',
        replyBody: 'x',
        citations: [{ knowledgeId: 'kb.fact' }],
      }),
    );
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('model-structured-output-invalid');
  });

  it('(58) a superseded (wrong-version) citation is rejected', () => {
    const reply = structuredReply({ citations: [{ knowledgeId: 'kb.fact', version: 2 }] });
    expect(run(scriptedGatewayInvoker(reply)).reason).toBe('model-citation-mismatch');
  });

  it('(59) a mix of valid and fabricated citations is rejected, not silently trimmed', () => {
    const reply = structuredReply({
      citations: [
        { knowledgeId: 'kb.fact', version: 1 },
        { knowledgeId: 'kb.ghost', version: 1 },
      ],
    });
    const result = run(scriptedGatewayInvoker(reply));
    expect(result.reason).toBe('model-citation-mismatch');
    expect(result.draft).toBeUndefined();
  });
});
