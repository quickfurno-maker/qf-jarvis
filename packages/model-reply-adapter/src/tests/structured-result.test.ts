/**
 * QFJ-M4 — strict structured output (ADR-0057 §G).
 *
 * Matrix 36–47: each closed draft kind is accepted; a malformed value, an unknown kind, an extra raw
 * provider field, a chain-of-thought field, a send/execute/Core-acceptance field, an oversized reply,
 * or a `REPLY` without a body is rejected; the same valid result yields a deterministic draft.
 */
import { describe, expect, it } from 'vitest';

import {
  createModelReplyAdapter,
  type ModelReplyAdapterConfig,
} from '../adapter/create-model-reply-adapter.js';
import type { StructuredReply } from '../contracts/reply-schema.js';
import {
  clearReplyState,
  fixedClock,
  rawStructuredGatewayInvoker,
  replyPlan,
  scriptedGatewayInvoker,
  scriptedReplyStateReader,
  structuredReply,
  syntheticRelease,
} from '../testing/index.js';
import type { ModelGatewayInvoker } from '../gateway/model-gateway-invoker.js';

function makeAdapter(invoker: ModelGatewayInvoker) {
  const config: ModelReplyAdapterConfig = {
    release: syntheticRelease(),
    promptFamily: 'reply.client',
    promptVersion: 1,
    capabilityProfileRef: 'cap.reply.v1',
    evaluationRef: 'evref-000000',
    stateReader: scriptedReplyStateReader(clearReplyState(), clearReplyState()),
    clock: fixedClock(),
    invoker,
  };
  return createModelReplyAdapter(config);
}
const run = (invoker: ModelGatewayInvoker) => makeAdapter(invoker).draftReplyDetailed(replyPlan());
const valid = [{ knowledgeId: 'kb.fact', version: 1 }];

describe('structured output — accepted kinds', () => {
  it('(36) a valid REPLY is accepted with a draft', () => {
    const result = run(scriptedGatewayInvoker(structuredReply()));
    expect(result.ok).toBe(true);
    expect(result.kind).toBe('REPLY');
    expect(result.draft?.replyBody).toBeTruthy();
    expect(result.draft?.structured).toBe(true);
  });

  const others: StructuredReply[] = [
    { kind: 'ESCALATE_TO_HUMAN', citations: [] },
    { kind: 'REQUEST_CLARIFICATION', citations: [] },
    { kind: 'NO_ACTION', citations: [] },
  ];
  for (const reply of others) {
    it(`(37,38,39) a valid ${reply.kind} is accepted with no reply body`, () => {
      const result = run(scriptedGatewayInvoker(reply));
      expect(result.ok).toBe(true);
      expect(result.kind).toBe(reply.kind);
      expect(result.draft).toBeUndefined();
    });
  }
});

describe('structured output — rejected results', () => {
  const rejected: Record<string, unknown> = {
    '(40) malformed value': 'not-an-object',
    '(41) unknown kind': { kind: 'SHIP', citations: valid },
    '(42) extra raw provider field': {
      kind: 'REPLY',
      replyBody: 'x',
      citations: valid,
      rawResponse: { a: 1 },
    },
    '(43) chain-of-thought field': {
      kind: 'REPLY',
      replyBody: 'x',
      citations: valid,
      reasoning: 'because',
    },
    '(44) send/execute/Core-acceptance field': {
      kind: 'REPLY',
      replyBody: 'x',
      citations: valid,
      coreOutcome: 'ACCEPTED',
    },
    '(45) oversized reply': { kind: 'REPLY', replyBody: 'x'.repeat(9000), citations: valid },
    '(46) REPLY without a body': { kind: 'REPLY', citations: valid },
  };
  for (const [label, structuredResult] of Object.entries(rejected)) {
    it(`${label} is rejected`, () => {
      const result = run(rawStructuredGatewayInvoker(structuredResult));
      expect(result.ok).toBe(false);
      expect(result.reason).toBe('model-structured-output-invalid');
    });
  }
});

describe('structured output — determinism', () => {
  it('(47) the same valid result yields the same draft', () => {
    const a = run(scriptedGatewayInvoker(structuredReply()));
    const b = run(scriptedGatewayInvoker(structuredReply()));
    expect(JSON.stringify(a.draft)).toBe(JSON.stringify(b.draft));
  });
});
