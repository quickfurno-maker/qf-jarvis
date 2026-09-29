import { describe, expect, it } from 'vitest';
import { createPromptRegistry } from '@qf-jarvis/prompt-registry';
import { createModelReplyAdapter } from '../adapter/create-model-reply-adapter.js';
import {
  clearReplyState,
  fixedClock,
  replyPlan,
  scriptedGatewayInvoker,
  scriptedReplyStateReader,
  structuredReply,
  syntheticPromptDefinition,
  syntheticRelease,
} from '../testing/index.js';

const PROMPT = syntheticPromptDefinition();

function makeAdapter(shadow: { observe(input: unknown): Promise<void> }) {
  const invoker = scriptedGatewayInvoker(structuredReply());
  return {
    invoker,
    adapter: createModelReplyAdapter({
      release: syntheticRelease(),
      promptFamily: 'reply.client',
      promptVersion: 1,
      promptRegistry: createPromptRegistry([PROMPT]),
      capabilityProfileRef: 'cap.reply.v1',
      evaluationRef: 'evref-000000',
      evaluationPromptDigest: PROMPT.contentDigest,
      stateReader: scriptedReplyStateReader(clearReplyState()),
      clock: fixedClock(),
      invoker,
      decisionShadowPort: shadow,
    }),
  };
}

describe('decision intelligence shadow seam', () => {
  it('observes one admitted hosted turn before the existing gateway path', async () => {
    const seen: unknown[] = [];
    const { adapter, invoker } = makeAdapter({
      observe(input: unknown) {
        seen.push(input);
        return Promise.resolve();
      },
    });
    const result = await adapter.draftReplyDetailed(replyPlan());
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({
      actorRef: 'RIYA',
      dataClass: 'HOSTED_ALLOWED',
    });
    expect(invoker.invoked()).toBe(1);
    expect(result.draft).toBeDefined();
  });

  it('cannot block or alter the model path when the shadow observer fails', async () => {
    const { adapter, invoker } = makeAdapter({
      observe() {
        return Promise.reject(new Error('shadow-down'));
      },
    });
    const result = await adapter.draftReplyDetailed(replyPlan());
    expect(invoker.invoked()).toBe(1);
    expect(result.draft).toBeDefined();
  });

  it('never observes HUMAN_ONLY because the existing privacy gate wins first', async () => {
    let calls = 0;
    const { adapter, invoker } = makeAdapter({
      observe() {
        calls += 1;
        return Promise.resolve();
      },
    });
    const result = await adapter.draftReplyDetailed(replyPlan({ dataClass: 'HUMAN_ONLY' }));
    expect(calls).toBe(0);
    expect(invoker.invoked()).toBe(0);
    expect(result.reason).toBe('model-state-blocked');
  });
});
