/**
 * QFJ-P04.01A — provider-neutral contract validation (ADR-0045).
 *
 * Pins request validation (structured needs a schema, text forbids one; closed agent scope + data
 * class; frozen result; no chain-of-thought field), capability matching, error-code normalization, and
 * that the FakeModelProvider is deterministic and needs no network/env/key.
 */
import { z } from 'zod';
import { describe, expect, it } from 'vitest';

import {
  capabilitiesSatisfy,
  defineProviderCapabilities,
  isModelDataClass,
  isModelAgentScope,
  ModelGatewayError,
  MODEL_GATEWAY_ERROR_CODES,
  validateModelRequest,
  type ProviderCapabilities,
  type RequiredCapabilities,
} from '../index.js';
import { FakeModelProvider, completedText } from '../testing/index.js';

const CAPS: ProviderCapabilities = defineProviderCapabilities({
  providerId: 'a',
  modelId: 'm',
  modelVersion: '1',
  executionClass: 'HOSTED',
  supportsStructuredOutput: true,
  supportsStrictJsonSchema: true,
  maxInputTokens: 1000,
  supportsTimeout: true,
  supportsCancellation: true,
  supportsNonStreaming: true,
  supportsStreaming: false,
});

const NO_REQUIRED: RequiredCapabilities = {
  structuredOutput: false,
  strictJsonSchema: false,
  cancellation: false,
  minContextTokens: 0,
};

function textReq(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    runId: 'run-1',
    purpose: 'qualify',
    agentScope: 'CLIENT',
    dataClass: 'HOSTED_ALLOWED',
    messages: [{ role: 'user', content: 'hi' }],
    requiredCapabilities: NO_REQUIRED,
    resultMode: 'TEXT',
    maxResultChars: 100,
    promptId: 'p',
    promptVersion: '1',
    tokenBudget: 100,
    costBudget: 1,
    timeoutMs: 1000,
    retryBudget: 0,
    metadata: {},
    ...overrides,
  };
}

describe('validateModelRequest', () => {
  it('accepts a valid text request and freezes it', () => {
    const result = validateModelRequest(textReq());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(Object.isFrozen(result.request)).toBe(true);
      expect(Object.isFrozen(result.request.messages)).toBe(true);
      expect(result.request.agentScope).toBe('CLIENT');
      // No chain-of-thought / reasoning field on the contract.
      expect('reasoning' in result.request).toBe(false);
      expect('chainOfThought' in result.request).toBe(false);
    }
  });

  it('rejects an unknown agent scope and an unknown data class', () => {
    expect(validateModelRequest(textReq({ agentScope: 'ADMIN' })).ok).toBe(false);
    expect(validateModelRequest(textReq({ dataClass: 'PUBLIC' })).ok).toBe(false);
  });

  it('requires a zod schema for STRUCTURED mode', () => {
    const required: RequiredCapabilities = { ...NO_REQUIRED, structuredOutput: true };
    expect(
      validateModelRequest(textReq({ resultMode: 'STRUCTURED', requiredCapabilities: required }))
        .ok,
    ).toBe(false);
    expect(
      validateModelRequest(
        textReq({
          resultMode: 'STRUCTURED',
          requiredCapabilities: required,
          structuredSchema: z.string(),
        }),
      ).ok,
    ).toBe(true);
  });

  it('forbids a structured schema in TEXT mode', () => {
    expect(validateModelRequest(textReq({ structuredSchema: z.string() })).ok).toBe(false);
  });

  it('rejects unknown/extra top-level fields (strict) and unsupported metadata shapes', () => {
    expect(validateModelRequest(textReq({ apiKey: 'secret' })).ok).toBe(false);
    expect(validateModelRequest(textReq({ metadata: { nested: { a: 1 } } })).ok).toBe(false);
  });

  it('the CLIENT and VENDOR scopes are distinct and closed', () => {
    expect(isModelAgentScope('CLIENT')).toBe(true);
    expect(isModelAgentScope('VENDOR')).toBe(true);
    expect(isModelAgentScope('SUPERUSER')).toBe(false);
    expect(isModelDataClass('LOCAL_ONLY')).toBe(true);
    expect(isModelDataClass('ANYTHING')).toBe(false);
  });
});

describe('capabilitiesSatisfy', () => {
  it('requires structured output / strict schema / cancellation / context when the request needs them', () => {
    expect(capabilitiesSatisfy(CAPS, NO_REQUIRED)).toBe(true);
    expect(capabilitiesSatisfy(CAPS, { ...NO_REQUIRED, minContextTokens: 2000 })).toBe(false);
    const weak = defineProviderCapabilities({ ...CAPS, supportsStructuredOutput: false });
    expect(capabilitiesSatisfy(weak, { ...NO_REQUIRED, structuredOutput: true })).toBe(false);
  });
});

describe('ModelGatewayError', () => {
  it('normalizes an unknown code to internal-invariant and carries no cause', () => {
    const error = new ModelGatewayError('not-a-real-code' as never);
    expect(error.code).toBe('internal-invariant');
    expect((error as { cause?: unknown }).cause).toBeUndefined();
    expect(MODEL_GATEWAY_ERROR_CODES).toContain('kill-switch-active');
  });
});

describe('FakeModelProvider', () => {
  it('is deterministic and records only safe run ids, never content', async () => {
    const provider = new FakeModelProvider({
      capabilities: CAPS,
      responses: [completedText('ok')],
    });
    const controller = new AbortController();
    const input = {
      runId: 'run-9',
      messages: [{ role: 'user' as const, content: 'private message' }],
      resultMode: 'TEXT' as const,
      timeoutMs: 1000,
      signal: controller.signal,
    };
    const a = await provider.invoke(input);
    const b = await provider.invoke(input);
    expect(a).toEqual(b);
    expect(provider.invocations).toBe(2);
    expect(provider.seenRunIds).toEqual(['run-9', 'run-9']);
    expect(JSON.stringify(provider.seenRunIds)).not.toContain('private message');
  });
});
