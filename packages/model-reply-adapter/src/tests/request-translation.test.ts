/**
 * QFJ-M4 — exact gateway request translation (ADR-0057 §D, §E, §F).
 *
 * Matrix 5–16: a valid plan builds an exact, deeply-frozen gateway request binding the exact actor/
 * party/task/data class, release/provider/model/version/config/execution, prompt/capability/evaluation/
 * policy, and exact citation references; a wildcard/`latest`, an oversized id, or a non-canonical
 * instant is rejected; the metadata is a closed scalar set with no arbitrary field; the same input
 * yields the same request identity.
 */
import { describe, expect, it } from 'vitest';

import {
  buildGatewayRequest,
  DEFAULT_GATEWAY_REQUEST_BUDGETS,
} from '../adapter/build-gateway-request.js';
import { ModelReplyAdapterError } from '../contracts/errors.js';
import { replyPlan, syntheticRelease } from '../testing/index.js';

const requestedAt = '2026-07-25T00:00:00Z';
const build = (plan = replyPlan()) =>
  buildGatewayRequest({ plan, requestedAt, budgets: DEFAULT_GATEWAY_REQUEST_BUDGETS });

const EXPECTED_METADATA_KEYS = [
  'assignedActor',
  'capabilityProfileRef',
  'citationCount',
  'citationsDigest',
  'configDigest',
  'conversationId',
  'evaluationRef',
  'executionClass',
  'modelId',
  'modelVersion',
  'partyType',
  'policyRevision',
  'promptFamily',
  'promptVersion',
  'providerId',
  'releaseId',
  'requestedAt',
  'taskClass',
].sort();

describe('request translation — exact binding', () => {
  it('(5,8) builds a STRUCTURED request with exact actor/party/task/data class', () => {
    const req = build();
    expect(req.runId).toBe('run.1');
    expect(req.purpose).toBe('agent.reply');
    expect(req.agentScope).toBe('CLIENT');
    expect(req.dataClass).toBe('HOSTED_ALLOWED');
    expect(req.resultMode).toBe('STRUCTURED');
    expect(req.metadata['assignedActor']).toBe('RIYA');
    expect(req.metadata['partyType']).toBe('CLIENT');
    expect(req.metadata['taskClass']).toBe('RESPONSE_GENERATION');
  });

  it('(6) freezes the request, its messages, and its metadata', () => {
    const req = build();
    expect(Object.isFrozen(req)).toBe(true);
    expect(Object.isFrozen(req.metadata)).toBe(true);
    expect(req.messages.every((m) => Object.isFrozen(m))).toBe(true);
  });

  it('(9) binds exact release/provider/model/version/config/execution', () => {
    const md = build().metadata;
    expect(md['releaseId']).toBe('rel.reply.1');
    expect(md['providerId']).toBe('prov.fake');
    expect(md['modelId']).toBe('model.fake');
    expect(md['modelVersion']).toBe('1');
    expect(md['configDigest']).toBe('cfg00001');
    expect(md['executionClass']).toBe('HOSTED');
  });

  it('(10) binds exact prompt/capability/evaluation/policy', () => {
    const req = build();
    expect(req.promptId).toBe('reply.client');
    expect(req.promptVersion).toBe('1');
    expect(req.metadata['capabilityProfileRef']).toBe('cap.reply.v1');
    expect(req.metadata['evaluationRef']).toBe('evref-000000');
    expect(req.metadata['policyRevision']).toBe('policy.rev.1');
  });

  it('(11) binds exact citation references (digest changes with citations)', () => {
    const a = build().metadata['citationsDigest'];
    const b = build(replyPlan({ citations: [] })).metadata['citationsDigest'];
    expect(a).toMatch(/^[0-9a-f]{16}$/);
    expect(a).not.toBe(b);
    expect(build().metadata['citationCount']).toBe(1);
  });

  it('(12) rejects a wildcard or `latest` identity', () => {
    expect(() =>
      build(replyPlan({ release: syntheticRelease({ modelVersion: 'latest' }) })),
    ).toThrow(ModelReplyAdapterError);
    expect(() => build(replyPlan({ release: syntheticRelease({ modelId: '*' }) }))).toThrow(
      ModelReplyAdapterError,
    );
  });

  it('(13) rejects an oversized id', () => {
    expect(() => build(replyPlan({ runId: 'r'.repeat(200) }))).toThrow(ModelReplyAdapterError);
  });

  it('(14) rejects a non-canonical requested-at instant', () => {
    expect(() =>
      buildGatewayRequest({
        plan: replyPlan(),
        requestedAt: 'not-an-instant',
        budgets: DEFAULT_GATEWAY_REQUEST_BUDGETS,
      }),
    ).toThrow(ModelReplyAdapterError);
  });

  it('(15) exposes only a closed scalar metadata set (no arbitrary/provider field)', () => {
    const md = build().metadata;
    expect(Object.keys(md).sort()).toEqual(EXPECTED_METADATA_KEYS);
    for (const value of Object.values(md)) {
      expect(['string', 'number', 'boolean']).toContain(typeof value);
    }
  });

  it('(16) is deterministic — same input yields the same request identity', () => {
    expect(JSON.stringify(build().metadata)).toBe(JSON.stringify(build().metadata));
  });
});
