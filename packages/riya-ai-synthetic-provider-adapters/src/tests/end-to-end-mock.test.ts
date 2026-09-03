/**
 * Both cross-family paths, end to end, against MOCKED transports (AS3A, ADR-0143 §3, §17, §24).
 *
 * ### What this proves, and what it deliberately does not
 *
 * It proves the PATH: a scheduled scenario becomes real provider requests through the adapters,
 * through AS2's orchestration, into AS1's validator — in both directions, GPT-taught judged by a
 * Claude critic and Claude-taught judged by a GPT critic.
 *
 * It does not prove that a candidate is ACCEPTED. A scripted transport writes deliberately repetitive
 * conversations, and AS1's diversity and quality rules exist precisely to reject those. A spec that
 * arranged for acceptance would be measuring the fixture, and the number it produced would tell
 * nobody anything about a real model. What acceptance looks like is an AS3B question, answered with
 * real outputs.
 *
 * ### Zero real calls
 *
 * Every transport here is a function that returns a string. No credential, no socket, no spend — and
 * that is a structural fact of the seam rather than a policy somebody remembered.
 */
import { orchestrateRiyaSyntheticRun } from '@qf-jarvis/riya-ai-synthetic-generation';
import type { RiyaSyntheticModelInvoker } from '@qf-jarvis/riya-ai-synthetic-generation';
import { syntheticProtectedIndex } from '@qf-jarvis/riya-intelligence-dataset/testing';
import { describe, expect, it } from 'vitest';

import { createAnthropicMessagesInvoker } from '../adapters/anthropic-messages-invoker.js';
import { createOpenAiResponsesInvoker } from '../adapters/openai-responses-invoker.js';

import { createRiyaSyntheticPilotPlan } from '../contracts/pilot-plan.js';
import { executeRiyaSyntheticPilot } from '../service/execute-pilot.js';
import { preflightRiyaSyntheticPilot } from '../service/preflight.js';
import {
  CLAUDE_TAUGHT_ALLOCATION,
  GPT_TAUGHT_ALLOCATION,
  createTransportLog,
  pilotPlanInput,
  scriptedAnthropicTransport,
  scriptedOpenAiTransport,
} from './fixtures.js';

/**
 * A protected index whose text is a SENTINEL nothing else could produce.
 *
 * The claim being tested is "no protected text reached a model request". Asserting that against
 * ordinary prose would be weak — a scripted transport never writes it anyway. A distinctive token
 * makes the assertion mean something: if it ever appears in a request body, it came from here.
 */
const PROTECTED_TEXTS = [
  'QFJ-AS3A-PROTECTED-EXAM-SENTINEL-ONE',
  'QFJ-AS3A-PROTECTED-EXAM-SENTINEL-TWO',
] as const;

const PROTECTED = syntheticProtectedIndex([
  { protectedRef: 'protected.as3a.one', text: PROTECTED_TEXTS[0] },
  { protectedRef: 'protected.as3a.two', text: PROTECTED_TEXTS[1] },
]);
const ENVIRONMENT = Object.freeze({});

function planFor(allocations: readonly unknown[]) {
  return createRiyaSyntheticPilotPlan(pilotPlanInput({ allocations }));
}

describe('a scheduled scenario reaches AS1 through real adapters', () => {
  it.each([
    ['GPT teaches and a Claude critic judges', [GPT_TAUGHT_ALLOCATION]],
    ['Claude teaches and a GPT critic judges', [CLAUDE_TAUGHT_ALLOCATION]],
  ])(
    'runs the path where %s',
    async (_label, allocations) => {
      const plan = planFor(allocations);
      const preflight = preflightRiyaSyntheticPilot({ plan, environment: ENVIRONMENT });
      const log = createTransportLog();

      const result = await executeRiyaSyntheticPilot({
        plan,
        preflight,
        mode: 'EXECUTE',
        openaiTransport: scriptedOpenAiTransport(log),
        anthropicTransport: scriptedAnthropicTransport(log),
        now: () => 0,
        protectedIndex: PROTECTED,
      });

      // BOTH families were actually called. A path that quietly ran on one family would satisfy every
      // other assertion here.
      expect(log.openaiBodies.length).toBeGreaterThan(0);
      expect(log.anthropicBodies.length).toBeGreaterThan(0);
      expect(result.generatedCandidates).toBeGreaterThan(0);
      // The validator ran and produced a COHERENT report: AS1 calls a corpus eligible exactly when it
      // raised no finding. Asserting the verdict itself would be asserting a property of the scripted
      // fixture -- what a real model's output scores is an AS3B question.
      expect(result.corpusEligible).toBe(result.blockingFindings === 0);
      expect(result.ledger.providerRequests).toBe(
        log.openaiBodies.length + log.anthropicBodies.length,
      );
    },
    30_000,
  );

  it('labels every candidate TEACHER_GENERATED_SYNTHETIC with an empty review array', async () => {
    // No human review is ever fabricated, and HUMAN_AUTHORED_SYNTHETIC is never applied to
    // model-written text. This is the assertion that keeps AI output from becoming Human Gold.
    //
    // Driven through AS2's orchestrator rather than the executor, because the candidates themselves
    // are what must be inspected -- and the executor deliberately does not hand them back: its
    // result carries identities and counts, never dialogue.
    const plan = planFor([GPT_TAUGHT_ALLOCATION, CLAUDE_TAUGHT_ALLOCATION]);
    const preflight = preflightRiyaSyntheticPilot({ plan, environment: ENVIRONMENT });
    const log = createTransportLog();

    const openai = createOpenAiResponsesInvoker({
      transport: scriptedOpenAiTransport(log),
      models: preflight.openaiModels,
    });
    const anthropic = createAnthropicMessagesInvoker({
      transport: scriptedAnthropicTransport(log),
      models: preflight.anthropicModels,
    });
    const invokers = new Map<string, RiyaSyntheticModelInvoker>();
    for (const configRef of preflight.openaiModels.keys()) invokers.set(configRef, openai);
    for (const configRef of preflight.anthropicModels.keys()) invokers.set(configRef, anthropic);

    const run = await orchestrateRiyaSyntheticRun({
      items: preflight.items,
      inventory: plan.inventory,
      policy: plan.policy,
      invokers,
      criticQualityDimensions: plan.criticQualityDimensions,
    });

    const candidates = run.outcomes
      .map((outcome) => outcome.candidate)
      .filter((candidate): candidate is NonNullable<typeof candidate> => candidate !== undefined);

    expect(candidates.length).toBeGreaterThan(0);
    for (const candidate of candidates) {
      expect(candidate.trajectory.source.kind).toBe('TEACHER_GENERATED_SYNTHETIC');
      // Empty, and never populated from a critic verdict -- a critic is not a reviewer.
      expect(candidate.trajectory.review).toStrictEqual([]);
      expect(candidate.provenance.generationRef).toMatch(/^gen\.as3a\./u);
    }
  }, 30_000);

  it('sends the protected exam to NO model request', async () => {
    // The index enters at the validator and nowhere earlier. Asserted on the bytes every transport
    // was handed, because that is the only place the claim can actually be checked.
    const plan = planFor([GPT_TAUGHT_ALLOCATION]);
    const preflight = preflightRiyaSyntheticPilot({ plan, environment: ENVIRONMENT });
    const log = createTransportLog();

    await executeRiyaSyntheticPilot({
      plan,
      preflight,
      mode: 'EXECUTE',
      openaiTransport: scriptedOpenAiTransport(log),
      anthropicTransport: scriptedAnthropicTransport(log),
      now: () => 0,
      protectedIndex: PROTECTED,
    });

    const everythingSent = JSON.stringify([...log.openaiBodies, ...log.anthropicBodies]);
    expect(everythingSent.length).toBeGreaterThan(0);
    for (const text of PROTECTED_TEXTS) {
      expect(everythingSent, text).not.toContain(text);
    }
    expect(everythingSent).not.toContain('protectedIndex');
    expect(everythingSent).not.toContain('protected.as3a');
  }, 30_000);
});

describe('a dry run is a real dry run', () => {
  it('makes zero provider calls and needs no transport', async () => {
    const plan = planFor([GPT_TAUGHT_ALLOCATION]);
    const preflight = preflightRiyaSyntheticPilot({ plan, environment: ENVIRONMENT });

    const result = await executeRiyaSyntheticPilot({
      plan,
      preflight,
      mode: 'DRY_RUN',
      now: () => 0,
    });

    expect(result.ledger.providerRequests).toBe(0);
    expect(result.generatedCandidates).toBe(0);
    expect(result.notStartedCandidates).toBe(preflight.plannedCandidates);
    expect(result.artifacts).toStrictEqual([]);
  });

  it('still proves the plan and reports the ceilings', async () => {
    const plan = planFor([GPT_TAUGHT_ALLOCATION]);
    const preflight = preflightRiyaSyntheticPilot({ plan, environment: ENVIRONMENT });

    const result = await executeRiyaSyntheticPilot({
      plan,
      preflight,
      mode: 'DRY_RUN',
      now: () => 0,
    });

    expect(result.planRef).toBe(plan.planRef);
    expect(result.plannedCandidates).toBe(
      Math.min(preflight.scheduledScenarios, plan.budget.maxCandidates),
    );
  });
});

describe('preflight refuses a run before a transport exists', () => {
  it('rejects a config whose provider family this package has no adapter for', () => {
    const plan = createRiyaSyntheticPilotPlan(
      pilotPlanInput({ allocations: [GPT_TAUGHT_ALLOCATION] }, { familyOverride: 'mistral' }),
    );

    expect(() => preflightRiyaSyntheticPilot({ plan, environment: ENVIRONMENT })).toThrow();
  });

  it('rejects a config that pinned an instruction digest nobody holds', () => {
    const plan = createRiyaSyntheticPilotPlan(
      pilotPlanInput({ allocations: [GPT_TAUGHT_ALLOCATION] }, { instructionShaOverride: true }),
    );

    expect(() => preflightRiyaSyntheticPilot({ plan, environment: ENVIRONMENT })).toThrow();
  });

  it('reports credential presence without reading a value', () => {
    const plan = planFor([GPT_TAUGHT_ALLOCATION]);

    const preflight = preflightRiyaSyntheticPilot({
      plan,
      environment: { OPENAI_API_KEY: 'sk-fixture', ANTHROPIC_API_KEY: '' },
    });

    expect(preflight.credentials).toStrictEqual({
      openaiCredentialPresent: true,
      anthropicCredentialPresent: false,
    });
    expect(JSON.stringify(preflight.credentials)).not.toContain('sk-');
  });
});
