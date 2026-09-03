/**
 * The two information boundaries, and the per-call abort (AS2 correction pass).
 *
 * Both defects these lock down were invisible in a passing run: the transcript still alternated, the
 * timeout still fired. What was wrong was what the teacher could SEE, and what kept running after
 * nobody was listening.
 */
import { describe, expect, it } from 'vitest';

import {
  createRiyaAiSyntheticAcceptancePolicy,
  validateRiyaAiSyntheticCorpus,
} from '@qf-jarvis/riya-intelligence-dataset/ai-synthetic';
import {
  releasePolicyFor,
  syntheticProtectedIndex,
} from '@qf-jarvis/riya-intelligence-dataset/testing';

import {
  RiyaSyntheticGenerationError,
  createFakeClaudeInvoker,
  customerScenarioView,
  createFakeGptInvoker,
  createRiyaSyntheticInvocationResult,
  generateRiyaSyntheticCandidate,
  teacherScenarioView,
} from '../index.js';
import type {
  RiyaSyntheticInvocationRequestV1,
  RiyaSyntheticInvokerRegistry,
  RiyaSyntheticModelInvoker,
} from '../index.js';
import {
  CRITIC_DIMENSIONS,
  gptTaughtAllocation,
  inventory,
  policy,
  scenarios,
} from './fixtures.js';

const INVENTORY = inventory();
const PROTECTED = syntheticProtectedIndex();

const firstScenario = () => {
  const one = scenarios(3)[0];
  if (one === undefined) throw new Error('scheduler produced no scenario');
  return one;
};

/** Records the exact `structuredInput` each role was handed. */
function capturing(): {
  readonly seen: Map<string, unknown[]>;
  readonly wrap: (role: string, inner: RiyaSyntheticModelInvoker) => RiyaSyntheticModelInvoker;
} {
  const seen = new Map<string, unknown[]>();
  return {
    seen,
    wrap: (role, inner) => ({
      invoke: async (request, structuredInput, options) => {
        seen.set(role, [...(seen.get(role) ?? []), structuredInput]);
        return inner.invoke(request, structuredInput, options);
      },
    }),
  };
}

function registryWith(
  overrides: Readonly<Record<string, RiyaSyntheticModelInvoker>>,
): RiyaSyntheticInvokerRegistry {
  const base = new Map<string, RiyaSyntheticModelInvoker>([
    ['cfg.planner', createFakeGptInvoker()],
    ['cfg.sim.gpt', createFakeGptInvoker()],
    ['cfg.sim.claude', createFakeClaudeInvoker()],
    ['cfg.teacher.gpt', createFakeGptInvoker()],
    ['cfg.teacher.claude', createFakeClaudeInvoker()],
    ['cfg.verify.gpt', createFakeGptInvoker()],
    ['cfg.verify.claude', createFakeClaudeInvoker()],
    ['cfg.critic.gpt', createFakeGptInvoker()],
    ['cfg.critic.gpt.two', createFakeGptInvoker()],
    ['cfg.critic.claude', createFakeClaudeInvoker()],
    ['cfg.critic.claude.two', createFakeClaudeInvoker()],
  ]);
  for (const [ref, invoker] of Object.entries(overrides)) base.set(ref, invoker);
  return base;
}

const generate = (invokers: RiyaSyntheticInvokerRegistry, override = policy()) =>
  generateRiyaSyntheticCandidate({
    scenario: firstScenario(),
    allocation: gptTaughtAllocation(),
    inventory: INVENTORY,
    policy: override,
    invokers,
    criticQualityDimensions: [...CRITIC_DIMENSIONS],
  });

// ---------------------------------------------------------------------------
// BLOCKER A — the teacher cannot see unrevealed customer state.
// ---------------------------------------------------------------------------

describe('the teacher sees a projection, never the customer plan', () => {
  it('is handed no plannedCustomerFacts and no customerBehaviorCodes', async () => {
    const capture = capturing();
    await generate(
      registryWith({
        'cfg.teacher.gpt': capture.wrap('teacher', createFakeGptInvoker()),
      }),
    );

    const teacherInputs = capture.seen.get('teacher') ?? [];
    expect(teacherInputs.length).toBeGreaterThan(0);
    for (const input of teacherInputs) {
      const view = (input as { readonly scenario: Record<string, unknown> }).scenario;
      expect(Object.keys(view)).not.toContain('plannedCustomerFacts');
      expect(Object.keys(view)).not.toContain('customerBehaviorCodes');
      // Also absent: anything else that forecasts what the customer will do next.
      expect(Object.keys(view)).not.toContain('requiredConversationEvents');
      expect(Object.keys(view)).not.toContain('persona');
      expect(Object.keys(view)).not.toContain('difficulty');
      expect(Object.keys(view)).not.toContain('targetAssistantTurns');
    }
  });

  it('never leaks a planned customer fact VALUE into any teacher input', async () => {
    // The one that matters. A fact the customer is meant to reveal on a later turn must not appear in
    // an earlier teacher input in any form -- not under another key, not nested.
    const scenario = firstScenario();
    const plannedValues = scenario.plannedCustomerFacts.map((fact) => fact.value);
    expect(plannedValues.length).toBeGreaterThan(0);

    const capture = capturing();
    await generate(
      registryWith({
        'cfg.teacher.gpt': capture.wrap('teacher', createFakeGptInvoker()),
      }),
    );

    for (const input of capture.seen.get('teacher') ?? []) {
      const serialized = JSON.stringify(input);
      for (const value of plannedValues) {
        expect(serialized, `teacher input must not contain ${value}`).not.toContain(value);
      }
    }
  });

  it('still gives the customer simulator the hidden state it owns', async () => {
    const capture = capturing();
    await generate(
      registryWith({
        'cfg.sim.claude': capture.wrap('sim', createFakeClaudeInvoker()),
      }),
    );

    const simInputs = capture.seen.get('sim') ?? [];
    expect(simInputs.length).toBeGreaterThan(0);
    for (const input of simInputs) {
      const view = (input as { readonly scenario: Record<string, unknown> }).scenario;
      expect(Object.keys(view)).toContain('plannedCustomerFacts');
      expect(Object.keys(view)).toContain('customerBehaviorCodes');
    }
  });

  it('projects exactly the allowlisted fields, and adds nothing back', () => {
    const view = teacherScenarioView(firstScenario());

    expect(Object.keys(view).sort()).toStrictEqual([
      'forbiddenBehaviors',
      'languageMode',
      'plannedDiscoveryFields',
      'riskClass',
      'startPhase',
    ]);
  });

  it('still produces a candidate AS1 accepts', async () => {
    // No compensating information was added elsewhere to make up for the narrower view.
    const candidate = await generate(registryWith({}));

    const acceptance = createRiyaAiSyntheticAcceptancePolicy({
      policyId: 'as2.boundary.acceptance.v1',
      policyVersion: 1,
      baseReleasePolicy: releasePolicyFor(PROTECTED, { minimumTotalTrajectories: 1 }),
      criticPolicy: {
        minAcceptedCritics: 2,
        requiredQualityDimensions: [...CRITIC_DIMENSIONS],
        requireCriticConfigDistinctFromGeneration: true,
        requireDistinctCriticConfigs: true,
        requireDistinctCriticModelFamilies: true,
      },
      diversityPolicy: {
        minFingerprintUniquenessBp: 10_000,
        maxOpenerRecurrenceBp: 10_000,
        maxCloserRecurrenceBp: 10_000,
        maxQuestionSequenceRecurrenceBp: 10_000,
        maxPhaseSequenceRecurrenceBp: 10_000,
        maxVariantsPerLineage: 1,
        maxSameLineageNearDuplicateBp: 10_000,
        minDepthBandsCovered: 1,
        minDecisionsCovered: 1,
        minObjectivesCovered: 1,
      },
      assistantTurnTolerance: 4,
    });

    const result = validateRiyaAiSyntheticCorpus({
      trajectories: [candidate.trajectory],
      scenarios: [firstScenario()],
      provenances: [candidate.provenance],
      evidence: [candidate.evidence],
      policy: acceptance,
      protectedIndex: PROTECTED,
    });

    expect(result.report.findings).toStrictEqual([]);
    expect(result.report.eligible).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// A customer's hidden fact and a governed authority fact are different channels.
// ---------------------------------------------------------------------------

describe('customer hidden facts and governed authority facts are separate channels', () => {
  const authorityScenario = () => {
    const found = scenarios(40).find((one) => one.requiredAuthorityFactClasses.length > 0);
    if (found === undefined) throw new Error('no authority scenario scheduled');
    return found;
  };

  const withAuthority = (invokers: RiyaSyntheticInvokerRegistry) =>
    generateRiyaSyntheticCandidate({
      scenario: authorityScenario(),
      allocation: gptTaughtAllocation(),
      inventory: INVENTORY,
      policy: policy(),
      invokers,
      criticQualityDimensions: [...CRITIC_DIMENSIONS],
    });

  it('gives the teacher the authority VALUE, class and ref, not just an identifier', async () => {
    // A ref alone lets a teacher label a citation but not ground an answer, which pushes a real model
    // toward inventing the number or avoiding authority the scenario asked for.
    const capture = capturing();
    await withAuthority(
      registryWith({ 'cfg.teacher.gpt': capture.wrap('teacher', createFakeGptInvoker()) }),
    );

    const inputs = capture.seen.get('teacher') ?? [];
    expect(inputs.length).toBeGreaterThan(0);
    for (const input of inputs) {
      const facts = (
        input as { readonly availableAuthorityFacts: readonly Record<string, unknown>[] }
      ).availableAuthorityFacts;
      expect(facts.length).toBeGreaterThan(0);
      for (const fact of facts) {
        expect(Object.keys(fact).sort()).toStrictEqual(['factClass', 'factRef', 'value']);
        expect(String(fact['factRef']).startsWith('synthetic.fact.')).toBe(true);
        expect(String(fact['value']).length).toBeGreaterThan(0);
      }
    }
  });

  it('never routes a customer hidden fact through the authority channel', async () => {
    const customerValues = authorityScenario().plannedCustomerFacts.map((fact) => fact.value);
    const capture = capturing();
    await withAuthority(
      registryWith({ 'cfg.teacher.gpt': capture.wrap('teacher', createFakeGptInvoker()) }),
    );

    for (const input of capture.seen.get('teacher') ?? []) {
      const facts = (input as { readonly availableAuthorityFacts: readonly unknown[] })
        .availableAuthorityFacts;
      const serialized = JSON.stringify(facts);
      for (const value of customerValues) {
        expect(serialized, 'authority must not carry a customer fact').not.toContain(value);
      }
    }
  });

  it('lets a teacher cite the supplied fact, grounded in an earlier context turn', async () => {
    const candidate = await withAuthority(
      registryWith({ 'cfg.teacher.gpt': createFakeGptInvoker({ citeAuthority: true }) }),
    );

    const cited = candidate.trajectory.turns.filter(
      (turn) => turn.type === 'ASSISTANT' && turn.annotation.supportedFactRefs.length > 0,
    );
    const context = candidate.trajectory.turns.filter(
      (turn) => turn.type === 'AUTHORITATIVE_CONTEXT',
    );

    expect(cited.length).toBeGreaterThan(0);
    expect(context.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// BLOCKER B — a per-invocation timeout aborts the call it timed out.
// ---------------------------------------------------------------------------

describe('a per-invocation timeout aborts the underlying call', () => {
  it('aborts one call without ending the candidate budget, and starts nothing after', async () => {
    // Losing a race does not stop the loser. Before the per-call controller, a timed-out invocation
    // kept its socket open and kept consuming tokens after AS2 had already rejected the attempt.
    let abortObserved = false;
    let completedNaturally = false;
    const later = new Map<string, number>();

    const slowTeacher: RiyaSyntheticModelInvoker = {
      invoke: async (
        request: RiyaSyntheticInvocationRequestV1,
        _structuredInput: unknown,
        options,
      ) => {
        await new Promise<void>((resolve) => {
          const timer = setTimeout(() => {
            // Only reached if the call was allowed to run to completion.
            completedNaturally = true;
            resolve();
          }, 4_000);
          options.signal?.addEventListener('abort', () => {
            abortObserved = true;
            clearTimeout(timer);
            resolve();
          });
        });
        // A well-behaved adapter stops here rather than finishing work nobody is waiting for.
        if (options.signal?.aborted === true) {
          return {
            result: createRiyaSyntheticInvocationResult({
              requestRef: request.requestRef,
              configRef: request.configRef,
              role: request.role,
              status: 'CANCELLED',
              errorClass: 'CANCELLED',
            }),
          };
        }
        return {
          result: createRiyaSyntheticInvocationResult({
            requestRef: request.requestRef,
            configRef: request.configRef,
            role: request.role,
            status: 'SUCCESS',
            outputDigest: 'a'.repeat(64),
          }),
          payload: '{}',
        };
      },
    };

    const count = (ref: string, inner: RiyaSyntheticModelInvoker): RiyaSyntheticModelInvoker => ({
      invoke: async (request, structuredInput, options) => {
        later.set(ref, (later.get(ref) ?? 0) + 1);
        return inner.invoke(request, structuredInput, options);
      },
    });

    let thrown: unknown;
    try {
      await generate(
        registryWith({
          'cfg.teacher.gpt': slowTeacher,
          'cfg.verify.claude': count('verify', createFakeClaudeInvoker()),
          'cfg.critic.claude': count('critic', createFakeClaudeInvoker()),
          'cfg.critic.gpt': count('critic', createFakeGptInvoker()),
        }),
        // The candidate budget is comfortably large, so ONLY the per-call budget can fire.
        policy({
          perInvocationTimeoutMs: 1_000,
          candidateTimeoutMs: 60_000,
          maxTransientRetries: 0,
        }),
      );
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(RiyaSyntheticGenerationError);
    expect((thrown as RiyaSyntheticGenerationError).code).toBe('invocation-timeout');

    // The call was told to stop, and stopped.
    expect(abortObserved).toBe(true);

    // Nothing downstream ran.
    expect(later.get('verify') ?? 0).toBe(0);
    expect(later.get('critic') ?? 0).toBe(0);

    // Wait past the fake's original 4s duration. The underlying call never ran to completion, which
    // is the whole claim: its timer was cancelled rather than left burning.
    await new Promise<void>((resolve) => setTimeout(resolve, 4_200));
    expect(completedNaturally).toBe(false);
    expect(later.get('verify') ?? 0).toBe(0);
    expect(later.get('critic') ?? 0).toBe(0);
  }, 20_000);
});

// ---------------------------------------------------------------------------
// BLOCKER E - no model role sees dataset governance state.
// ---------------------------------------------------------------------------

describe('every model input is split-blind', () => {
  const validationScenario = () => {
    const found = scenarios(20).find((one) => one.split === 'VALIDATION');
    if (found === undefined) throw new Error('no VALIDATION scenario scheduled');
    return found;
  };

  it('hides split and lineage from the simulator, which keeps its own state', async () => {
    // Splits are fixed before generation for LINEAGE isolation. That is not the same as telling the
    // generator which split it is writing: a simulator that knows it is producing VALIDATION can
    // drift that distribution away from TRAIN for no reason a reader could ever find.
    const capture = capturing();
    await generateRiyaSyntheticCandidate({
      scenario: validationScenario(),
      allocation: gptTaughtAllocation(),
      inventory: INVENTORY,
      policy: policy(),
      invokers: registryWith({
        'cfg.sim.claude': capture.wrap('sim', createFakeClaudeInvoker()),
      }),
      criticQualityDimensions: [...CRITIC_DIMENSIONS],
    });

    const inputs = capture.seen.get('sim') ?? [];
    expect(inputs.length).toBeGreaterThan(0);
    for (const input of inputs) {
      const view = (input as { readonly scenario: Record<string, unknown> }).scenario;
      expect(Object.keys(view)).not.toContain('split');
      expect(Object.keys(view)).not.toContain('lineageRootRef');
      expect(Object.keys(view)).not.toContain('scenarioRef');
      expect(Object.keys(view)).toContain('plannedCustomerFacts');
      expect(Object.keys(view)).toContain('customerBehaviorCodes');
      expect(JSON.stringify(input)).not.toContain('VALIDATION');
      expect(JSON.stringify(input)).not.toContain('HOLDOUT');
    }
  });

  it('projects the same customer view whatever the split says', () => {
    // The strongest form: the split is not merely hidden, it makes no difference to the projection.
    const scenario = validationScenario();

    expect(JSON.stringify(customerScenarioView(scenario))).toBe(
      JSON.stringify(customerScenarioView({ ...scenario, split: 'TRAIN' })),
    );
  });

  it('hides split and lineage from the teacher, verifier and critic too', () => {
    const view = teacherScenarioView(validationScenario());

    expect(Object.keys(view)).not.toContain('split');
    expect(Object.keys(view)).not.toContain('lineageRootRef');
    expect(JSON.stringify(view)).not.toContain('VALIDATION');
  });
});

// ---------------------------------------------------------------------------
// BLOCKER F - the teacher gets no future interaction label.
// ---------------------------------------------------------------------------

describe('the teacher is told no future interaction kind', () => {
  it('carries neither primary nor secondary interaction kinds', () => {
    const view = teacherScenarioView(firstScenario());

    expect(Object.keys(view)).not.toContain('primaryInteractionKind');
    expect(Object.keys(view)).not.toContain('secondaryInteractionKinds');
  });

  it('does not reveal an objection before the customer has objected', async () => {
    // OBJECTION_PRICE on turn 1 is the same omniscience as a planned fact, in taxonomy form.
    const objection = scenarios(40).find((one) => one.primaryInteractionKind === 'OBJECTION_PRICE');
    expect(objection).toBeDefined();
    if (objection === undefined) return;

    const capture = capturing();
    await generateRiyaSyntheticCandidate({
      scenario: objection,
      allocation: gptTaughtAllocation(),
      inventory: INVENTORY,
      policy: policy(),
      invokers: registryWith({
        'cfg.teacher.gpt': capture.wrap('teacher', createFakeGptInvoker()),
      }),
      criticQualityDimensions: [...CRITIC_DIMENSIONS],
    });

    for (const input of capture.seen.get('teacher') ?? []) {
      expect(JSON.stringify(input)).not.toContain('OBJECTION_PRICE');
    }
  });

  it('projects two scenarios differing only by interaction kind identically', () => {
    const base = firstScenario();

    expect(JSON.stringify(teacherScenarioView(base))).toBe(
      JSON.stringify(teacherScenarioView({ ...base, primaryInteractionKind: 'OBJECTION_PRICE' })),
    );
  });
});
