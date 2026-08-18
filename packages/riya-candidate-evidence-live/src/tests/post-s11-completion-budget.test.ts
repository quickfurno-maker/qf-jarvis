/**
 * POST-S11 REQUEST-CONTRACT REPAIR — the completion budget, proven on the wire.
 *
 * S11's D1/D2 pair sent the same minimal strict schema and the same tiny messages, differing only in
 * `max_completion_tokens`: HTTP 200 at 512, HTTP 413 at 65,536. The cause was a missing distinction.
 * `ProviderInvocationInput` carried no per-request completion bound, so `GroqModelProvider` put its
 * configured MODEL CAPABILITY ceiling on every invocation — a two-sentence Riya reply asked for the
 * entire model allowance.
 *
 * These specs drive the REAL candidate gateway and the REAL Riya turn over a fake transport and read
 * the body that would have gone to Groq. They prove the two numbers now travel separately: the model
 * capability is unchanged at 65,536, and the request carries the derived Riya budget instead.
 *
 * No provider is reached. The transport is injected, and a spec asserts that.
 */
import { createGroqApiKey } from '@qf-jarvis/model-gateway';
import type { GroqTransport } from '@qf-jarvis/model-gateway';
import { RIYA_COMPLETION_BUDGET_TOKENS } from '@qf-jarvis/riya-model-interaction';
import { RIYA_SAFETY_FIXTURES } from '@qf-jarvis/riya-candidate-evaluation-runner';
import { describe, expect, it } from 'vitest';

import {
  CANDIDATE_MAX_COMPLETION_TOKENS,
  CANDIDATE_MAX_INPUT_TOKENS,
  CANDIDATE_MODEL_ID,
} from '../candidate-release.js';
import { stateReaderFor } from '../candidate-ports.js';
import { createCandidateGateway, createCandidateInvoker } from '../evaluation-gateway.js';
import { runRiyaEvaluationTurn } from '../riya-turn.js';

const SENTINEL_KEY = 'FAKE-POST-S11-SENTINEL-NEVER-A-REAL-KEY-0';

interface RecordedBody {
  readonly model: string;
  readonly maxCompletionTokens: number;
}

interface FakeWire {
  readonly transport: GroqTransport;
  readonly bodies: () => readonly RecordedBody[];
}

/** A wire that records and answers, and reaches nothing. */
function fakeWire(): FakeWire {
  const bodies: RecordedBody[] = [];
  return {
    transport: {
      send: (request) => {
        const parsed = JSON.parse(request.body) as Record<string, unknown>;
        bodies.push({
          model: String(parsed['model']),
          maxCompletionTokens: Number(parsed['max_completion_tokens']),
        });
        return Promise.resolve({
          status: 200,
          retryAfterSeconds: null,
          bodyText: JSON.stringify({
            id: 'chatcmpl-post-s11',
            object: 'chat.completion',
            created: 1,
            model: CANDIDATE_MODEL_ID,
            choices: [
              {
                index: 0,
                message: { role: 'assistant', content: '{"unused":true}' },
                finish_reason: 'stop',
              },
            ],
            usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 },
          }),
        });
      },
    },
    bodies: () => bodies,
  };
}

/** The first ordinary MODEL_REQUIRED case — the population that returned 400 in S9/S10/S11. */
function representativeRequest(): (typeof RIYA_SAFETY_FIXTURES)[number]['request'] {
  const found = RIYA_SAFETY_FIXTURES.find(
    (fixture) =>
      fixture.executionExpectation === 'MODEL_REQUIRED' && !fixture.request.cancelAfterAdmission,
  );
  if (found === undefined) {
    throw new Error('the ordinary MODEL_REQUIRED set must not be empty');
  }
  return found.request;
}

/** Run ONE real Riya turn through the real gateway over the fake wire. */
async function runOneTurn(): Promise<readonly RecordedBody[]> {
  const wire = fakeWire();
  const gateway = createCandidateGateway({
    apiKey: createGroqApiKey(SENTINEL_KEY),
    transport: wire.transport,
  });
  const request = representativeRequest();
  await runRiyaEvaluationTurn(
    {
      caseId: request.caseId,
      syntheticUserText: request.syntheticUserText,
      phase: 'NEED',
      dataClass: request.declaredDataClass,
      humanTakeoverActive: request.humanTakeoverActive,
    },
    {
      invoker: createCandidateInvoker(gateway),
      clock: () => '2026-08-12T00:00:00.000Z',
      stateReader: stateReaderFor(request),
    },
  );
  return wire.bodies();
}

describe('the model ceiling and the request budget are different numbers', () => {
  it('the model capability ceiling is unchanged at 65,536', () => {
    // The repair does NOT lower what the model can emit. Groq publishes a 65,536 output maximum for
    // this model and the candidate release still declares it.
    expect(CANDIDATE_MAX_COMPLETION_TOKENS).toBe(65_536);
    expect(CANDIDATE_MAX_INPUT_TOKENS).toBe(131_072);
  });

  it('the Riya request budget is much smaller, and derived', () => {
    expect(RIYA_COMPLETION_BUDGET_TOKENS).toBeLessThan(CANDIDATE_MAX_COMPLETION_TOKENS);
    expect(RIYA_COMPLETION_BUDGET_TOKENS).toBeGreaterThan(0);
  });
});

describe('an ordinary Riya turn no longer asks for the model maximum', () => {
  it('sends the request budget on the wire, not 65,536', async () => {
    const bodies = await runOneTurn();
    expect(bodies).toHaveLength(1);
    const [only] = bodies;
    // THE regression this phase exists to prevent. Before the repair this was 65,536 on every turn.
    expect(only?.maxCompletionTokens).toBe(RIYA_COMPLETION_BUDGET_TOKENS);
    expect(only?.maxCompletionTokens).not.toBe(CANDIDATE_MAX_COMPLETION_TOKENS);
    expect(only?.model).toBe(CANDIDATE_MODEL_ID);
  });

  it('exactly one request reaches the wire — no retry, no fallback', async () => {
    const bodies = await runOneTurn();
    expect(bodies).toHaveLength(1);
  });

  it('reaches no real provider — the transport is injected and recorded every send', async () => {
    // If a real network client had served this, the fake would have recorded nothing.
    const bodies = await runOneTurn();
    expect(bodies.length).toBeGreaterThan(0);
  });
});

describe('the budget is an upper bound a provider clamps, never a way to exceed the ceiling', () => {
  it('a request asking for more than the model ceiling is clamped down to it', async () => {
    const wire = fakeWire();
    const gateway = createCandidateGateway({
      apiKey: createGroqApiKey(SENTINEL_KEY),
      transport: wire.transport,
    });
    // Ask for far more than the configured model ceiling, through the real gateway contract.
    const invoker = createCandidateInvoker(gateway);
    const request = representativeRequest();
    await runRiyaEvaluationTurn(
      {
        caseId: request.caseId,
        syntheticUserText: request.syntheticUserText,
        phase: 'NEED',
        dataClass: request.declaredDataClass,
        humanTakeoverActive: request.humanTakeoverActive,
      },
      {
        invoker: {
          invoke: (modelRequest) =>
            invoker.invoke({
              ...modelRequest,
              // A caller trying to buy more output than the model was configured for.
              completionBudget: 999_999,
            }),
        },
        clock: () => '2026-08-12T00:00:00.000Z',
        stateReader: stateReaderFor(request),
      },
    );
    const [only] = wire.bodies();
    // Clamped. An application budget can only ever narrow a model capability, never widen it.
    expect(only?.maxCompletionTokens).toBe(CANDIDATE_MAX_COMPLETION_TOKENS);
  });
});
