import { describe, expect, it } from 'vitest';
import {
  buildAosEvidencePacket,
  createAosCase,
  createAosSignal,
} from '@qf-jarvis/aos-intelligence';
import type { ModelRequest, ModelResponse } from '@qf-jarvis/model-gateway';
import type { ModelGatewayInvoker } from '@qf-jarvis/model-reply-adapter';

import {
  AOS_REASONING_PROMPT_DIGEST,
  createAosModelReasoner,
  createAosReasoningRequest,
} from '../index.js';

const at = '2026-10-01T04:30:00.000Z';

function packet() {
  const signal = createAosSignal({
    signalId: 'signal.aos-model',
    detectorId: 'detector.first-contact',
    detectorType: 'SLA',
    caseKey: 'lead-opaque.first-contact',
    subjectRef: 'lead:opaque-subject',
    priority: 'P1',
    score: 0.8,
    observedAt: at,
    evidenceRefs: ['core:event:opaque'],
    reasonCode: 'VENDOR_FIRST_CONTACT_SLA',
  });
  const aosCase = createAosCase('case.opaque', [signal]);
  return buildAosEvidencePacket({
    case: aosCase,
    generatedAt: at,
    policyRefs: ['policy:first-contact'],
    facts: [
      {
        factId: 'fact:elapsed',
        kind: 'METRIC',
        dataClass: 'OPERATIONAL',
        sourceRef: 'metric:first-contact',
        observedAt: at,
        value: 26,
      },
    ],
  });
}

function responseFor(request: ModelRequest, structuredResult: unknown): ModelResponse {
  return {
    runId: request.runId,
    resultMode: 'STRUCTURED',
    structuredResult,
    provenance: {
      runId: request.runId,
      purpose: request.purpose,
      providerId: 'openai',
      modelId: 'test-model',
      modelVersion: 'test-v1',
      promptId: request.promptId,
      promptVersion: request.promptVersion,
      promptDigest: request.promptDigest,
      mode: 'SHADOW',
      usedFallback: false,
      attempts: 1,
    },
    usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
    latencyMs: 90,
    finishStatus: 'completed',
  };
}

describe('AOS governed model reasoning', () => {
  it('builds a strict hosted request without subject or case identity', () => {
    const request = createAosReasoningRequest({
      runId: 'aos.run.1',
      packet: packet(),
      route: 'ROUTINE',
      allowedActions: ['REQUEST_VENDOR_REMINDER', 'REQUEST_REPLACEMENT_BATCH'],
    });
    expect(request.dataClass).toBe('HOSTED_ALLOWED');
    expect(request.agentScope).toBe('COORDINATION');
    expect(request.resultMode).toBe('STRUCTURED');
    expect(request.promptDigest).toBe(AOS_REASONING_PROMPT_DIGEST);
    expect(request.metadata['aosModelRoute']).toBe('ROUTINE');
    const serialized = request.messages.map((message) => message.content).join('\n');
    expect(serialized).not.toContain('lead:opaque-subject');
    expect(serialized).not.toContain('case.opaque');
    expect(serialized).toContain('fact:elapsed');
  });

  it('turns model output into an advisory candidate bound to deterministic evidence', async () => {
    let seen: ModelRequest | undefined;
    const invoker: ModelGatewayInvoker = {
      invoke(request) {
        seen = request;
        return Promise.resolve({
          ok: true as const,
          response: responseFor(request, {
            action: 'REQUEST_VENDOR_REMINDER',
            confidence: 0.91,
            rootCause: 'First-contact SLA exceeded.',
            rationale: 'A vendor follow-up is appropriate before replacement review.',
            alternatives: ['REQUEST_REPLACEMENT_BATCH'],
            needsHumanReview: false,
          }),
        });
      },
    };
    const result = await createAosModelReasoner(invoker).reason({
      runId: 'aos.run.2',
      packet: packet(),
      route: 'ROUTINE',
      allowedActions: ['REQUEST_VENDOR_REMINDER', 'REQUEST_REPLACEMENT_BATCH'],
    });
    expect(seen).toBeDefined();
    expect(result).toMatchObject({
      ok: true,
      route: 'ROUTINE',
      executionAuthority: 'NONE',
      businessEffect: false,
    });
    if (!result.ok) throw new Error('fixture-failed');
    expect(result.candidate).toMatchObject({
      action: 'REQUEST_VENDOR_REMINDER',
      confidence: 0.91,
      evidenceRefs: ['fact:elapsed'],
      policyRefs: ['policy:first-contact'],
    });
  });

  it('forces the human-review action when the model flags review', async () => {
    const invoker: ModelGatewayInvoker = {
      invoke(request) {
        return Promise.resolve({
          ok: true as const,
          response: responseFor(request, {
            action: 'REQUEST_VENDOR_REMINDER',
            confidence: 0.8,
            rootCause: 'Evidence conflicts.',
            rationale: 'A human should review before continuing.',
            alternatives: [],
            needsHumanReview: true,
          }),
        });
      },
    };
    const result = await createAosModelReasoner(invoker).reason({
      runId: 'aos.run.3',
      packet: packet(),
      route: 'DEEP',
      allowedActions: ['REQUEST_VENDOR_REMINDER', 'REQUEST_REPLACEMENT_BATCH'],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('fixture-failed');
    expect(result.candidate.action).toBe('REQUEST_HUMAN_REVIEW');
  });

  it('fails closed on malformed or refused model output', async () => {
    const malformed: ModelGatewayInvoker = {
      invoke(request) {
        return Promise.resolve({
          ok: true as const,
          response: responseFor(request, { action: 'DO_ANYTHING' }),
        });
      },
    };
    expect(
      await createAosModelReasoner(malformed).reason({
        runId: 'aos.run.4',
        packet: packet(),
        route: 'ROUTINE',
        allowedActions: ['REQUEST_VENDOR_REMINDER', 'REQUEST_REPLACEMENT_BATCH'],
      }),
    ).toMatchObject({ ok: false, reason: 'MALFORMED_RESULT' });

    const refused: ModelGatewayInvoker = {
      invoke() {
        return Promise.resolve({ ok: false as const, transient: true });
      },
    };
    expect(
      await createAosModelReasoner(refused).reason({
        runId: 'aos.run.5',
        packet: packet(),
        route: 'DEEP',
        allowedActions: ['REQUEST_VENDOR_REMINDER', 'REQUEST_REPLACEMENT_BATCH'],
      }),
    ).toMatchObject({ ok: false, reason: 'MODEL_REFUSED', transient: true });
  });
});
