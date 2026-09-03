/**
 * Turn-by-turn orchestration, the untrusted-output boundary, and the path into AS1 (AS2).
 *
 * The end-to-end spec at the bottom is the one that matters: a scenario becomes a candidate that AS1
 * accepts, through the port, with zero provider calls. Everything above it is a way that path can go
 * wrong.
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
  createFakeGptInvoker,
  generateRiyaSyntheticCandidate,
} from '../index.js';
import type {
  RiyaSyntheticCandidateV1,
  RiyaSyntheticInvokerRegistry,
  RiyaSyntheticModelInvoker,
} from '../index.js';
import {
  CRITIC_DIMENSIONS,
  claudeTaughtAllocation,
  gptTaughtAllocation,
  inventory,
  policy,
  scenarios,
} from './fixtures.js';

const INVENTORY = inventory();
const PROTECTED = syntheticProtectedIndex();

function registry(
  overrides: Readonly<Record<string, RiyaSyntheticModelInvoker>> = {},
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

const firstScenario = () => {
  const all = scenarios(3);
  const one = all[0];
  if (one === undefined) throw new Error('scheduler produced no scenario');
  return one;
};

const generate = (
  overrides: {
    readonly invokers?: RiyaSyntheticInvokerRegistry;
    readonly allocation?: ReturnType<typeof gptTaughtAllocation>;
    readonly policy?: ReturnType<typeof policy>;
    readonly signal?: AbortSignal;
  } = {},
) =>
  generateRiyaSyntheticCandidate({
    scenario: firstScenario(),
    allocation: overrides.allocation ?? gptTaughtAllocation(),
    inventory: INVENTORY,
    policy: overrides.policy ?? policy(),
    invokers: overrides.invokers ?? registry(),
    criticQualityDimensions: [...CRITIC_DIMENSIONS],
    ...(overrides.signal === undefined ? {} : { signal: overrides.signal }),
  });

// ---------------------------------------------------------------------------
// Turn-by-turn.
// ---------------------------------------------------------------------------

describe('conversations are generated one turn at a time', () => {
  it('alternates USER and ASSISTANT and never exceeds the AS1 ceiling', async () => {
    const candidate = await generate();
    const spoken = candidate.trajectory.turns.filter(
      (turn) => turn.type === 'USER' || turn.type === 'ASSISTANT',
    );

    expect(spoken[0]?.type).toBe('USER');
    for (let index = 1; index < spoken.length; index += 1) {
      expect(spoken[index]?.type, `turn ${String(index)}`).not.toBe(spoken[index - 1]?.type);
    }
    const assistantTurns = candidate.trajectory.turns.filter((turn) => turn.type === 'ASSISTANT');
    expect(assistantTurns.length).toBeGreaterThanOrEqual(4);
    expect(assistantTurns.length).toBeLessThanOrEqual(12);
  });

  it('keeps the scenario lineage and split the scheduler assigned', async () => {
    const scenario = firstScenario();
    const candidate = await generate();

    expect(candidate.trajectory.lineageRootRef).toBe(scenario.lineageRootRef);
    expect(candidate.trajectory.split).toBe(scenario.split);
  });

  it('produces a teacher-generated row with no review records', async () => {
    const candidate = await generate();

    expect(candidate.trajectory.source.kind).toBe('TEACHER_GENERATED_SYNTHETIC');
    expect(candidate.trajectory.source.teacherRef).toBe('gen.run.one');
    expect(candidate.trajectory.review).toStrictEqual([]);
  });

  it('reads critic family from the inventory rather than from the model', async () => {
    const candidate = await generate();
    const families = candidate.verdicts.map((one) => one.criticModelFamilyRef);

    expect(families).toContain('claude');
    expect(candidate.provenance.riyaTeacherModelFamilyRef).toBe('gpt');
  });

  it('generates a different conversation under a different teacher family', async () => {
    const fromGpt = await generate();
    const fromClaude = await generate({ allocation: claudeTaughtAllocation() });

    expect(fromGpt.evidence.conversationFingerprint).not.toBe(
      fromClaude.evidence.conversationFingerprint,
    );
  });
});

// ---------------------------------------------------------------------------
// Untrusted output.
// ---------------------------------------------------------------------------

describe('model output is untrusted until a constructor says otherwise', () => {
  it('recovers from malformed bytes with ONE structural repair', async () => {
    const candidate = await generate({
      invokers: registry({
        'cfg.teacher.gpt': createFakeGptInvoker({ malformedFirstAttempt: true }),
      }),
    });

    expect(candidate.trajectory.turns.length).toBeGreaterThan(0);
  });

  it('gives up when malformed output never resolves', async () => {
    await expect(
      generate({
        invokers: registry({ 'cfg.teacher.gpt': createFakeGptInvoker({ alwaysMalformed: true }) }),
      }),
    ).rejects.toThrow(RiyaSyntheticGenerationError);
  });

  it('does NOT repair a schema mismatch', async () => {
    // A well-formed object of the wrong shape will come back the same way if asked again. Re-asking
    // is spend without a hypothesis, and is the first step toward retrying until something passes.
    await expect(
      generate({
        invokers: registry({ 'cfg.teacher.gpt': createFakeGptInvoker({ schemaMismatch: true }) }),
      }),
    ).rejects.toThrow(RiyaSyntheticGenerationError);
  });

  it('refuses repair entirely when the policy allows none', async () => {
    await expect(
      generate({
        invokers: registry({
          'cfg.teacher.gpt': createFakeGptInvoker({ malformedFirstAttempt: true }),
        }),
        policy: policy({ maxStructuralRepairAttempts: 0 }),
      }),
    ).rejects.toThrow(RiyaSyntheticGenerationError);
  });
});

// ---------------------------------------------------------------------------
// Transport bounds.
// ---------------------------------------------------------------------------

describe('transport failures are bounded and classified', () => {
  it('retries a transient failure within the policy budget', async () => {
    const candidate = await generate({
      invokers: registry({ 'cfg.teacher.gpt': createFakeGptInvoker({ transientFailures: 1 }) }),
    });

    expect(candidate.trajectory.turns.length).toBeGreaterThan(0);
  });

  it('gives up once transient retries are exhausted', async () => {
    await expect(
      generate({
        invokers: registry({ 'cfg.teacher.gpt': createFakeGptInvoker({ transientFailures: 9 }) }),
        policy: policy({ maxTransientRetries: 1 }),
      }),
    ).rejects.toThrow(RiyaSyntheticGenerationError);
  });

  it('does not retry a permanent failure', async () => {
    await expect(
      generate({
        invokers: registry({ 'cfg.teacher.gpt': createFakeGptInvoker({ permanentFailure: true }) }),
      }),
    ).rejects.toThrow(RiyaSyntheticGenerationError);
  });

  it('classifies a hung invocation as a timeout, not a verdict', async () => {
    await expect(
      generate({
        invokers: registry({ 'cfg.teacher.gpt': createFakeGptInvoker({ hangs: true }) }),
        policy: policy({ perInvocationTimeoutMs: 1_000, candidateTimeoutMs: 5_000 }),
      }),
    ).rejects.toThrow(RiyaSyntheticGenerationError);
  });

  it('honours an AbortSignal', async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(generate({ signal: controller.signal })).rejects.toThrow(
      RiyaSyntheticGenerationError,
    );
  });
});

// ---------------------------------------------------------------------------
// The candidate budget.
// ---------------------------------------------------------------------------

describe('the candidate budget bounds the WHOLE conversation', () => {
  it('terminates mid-conversation, and starts no invocation after expiry', async () => {
    // INVARIANT B. The regression this locks down. The budget used to be a `let expired` flag checked
    // between turns, so a run could only notice expiry at a turn boundary -- and, being assigned only
    // inside a closure, the check read as a constant to the compiler while still running.
    //
    // Every individual call here finishes in 300ms against a 1000ms per-invocation budget, so no
    // per-invocation timeout can fire. Only the accumulated conversation exceeds the candidate budget.
    const calls = new Map<string, number>();
    const counting = (
      ref: string,
      inner: RiyaSyntheticModelInvoker,
    ): RiyaSyntheticModelInvoker => ({
      invoke: async (request, structuredInput, invocationOptions) => {
        calls.set(ref, (calls.get(ref) ?? 0) + 1);
        return inner.invoke(request, structuredInput, invocationOptions);
      },
    });

    const slow = registry({
      'cfg.sim.claude': counting('sim', createFakeClaudeInvoker({ delayMs: 300 })),
      'cfg.teacher.gpt': counting('teacher', createFakeGptInvoker({ delayMs: 300 })),
      'cfg.verify.claude': counting('verify', createFakeClaudeInvoker({ delayMs: 300 })),
      'cfg.critic.claude': counting('critic', createFakeClaudeInvoker({ delayMs: 300 })),
      'cfg.critic.gpt': counting('critic', createFakeGptInvoker({ delayMs: 300 })),
    });

    let thrown: unknown;
    let candidate: RiyaSyntheticCandidateV1 | undefined;
    try {
      candidate = await generate({
        invokers: slow,
        policy: policy({ perInvocationTimeoutMs: 1_000, candidateTimeoutMs: 1_000 }),
      });
    } catch (error) {
      thrown = error;
    }

    // Classified as the CANDIDATE budget, not a per-invocation timeout. Collapsing the two would send
    // somebody hunting for a slow provider that was never slow.
    expect(thrown).toBeInstanceOf(RiyaSyntheticGenerationError);
    expect((thrown as RiyaSyntheticGenerationError).code).toBe('candidate-budget-exceeded');

    // The candidate did not complete, so no AS1 acceptance evidence exists.
    expect(candidate).toBeUndefined();

    // Generation had genuinely begun before expiry.
    expect(calls.get('sim') ?? 0).toBeGreaterThan(0);
    expect(calls.get('teacher') ?? 0).toBeGreaterThan(0);

    // And the later stages never ran.
    expect(calls.get('verify') ?? 0).toBe(0);
    expect(calls.get('critic') ?? 0).toBe(0);

    // Losing a race does not stop the loser, so this is the assertion that matters: after the caller
    // was rejected, the abandoned conversation must start NO further invocation. Without the
    // candidate AbortController these counters keep climbing while nobody is waiting for the result.
    const settled = new Map(calls);
    await new Promise<void>((resolve) => setTimeout(resolve, 1_200));
    expect(new Map(calls)).toStrictEqual(settled);
  });

  it('refuses a candidate budget smaller than a single invocation', () => {
    // INVARIANT A, deliberately a SEPARATE spec from the one above. An incoherent timeout hierarchy
    // is rejected at construction: a candidate budget the first policy-compliant call cannot fit
    // inside makes every candidate expire for a reason nobody could diagnose.
    //
    // Invariant B is the different claim that valid per-call budgets can still cumulatively exceed
    // the whole-candidate budget. Merging them into one spec would lose both.
    expect(() => policy({ perInvocationTimeoutMs: 30_000, candidateTimeoutMs: 5_000 })).toThrow(
      RiyaSyntheticGenerationError,
    );
  });
});

// ---------------------------------------------------------------------------
// Quality outcomes are not transport failures.
// ---------------------------------------------------------------------------

describe('a poor candidate is an outcome, never a retry', () => {
  it('stops when the annotation verifier rejects', async () => {
    await expect(
      generate({
        invokers: registry({
          'cfg.verify.claude': createFakeClaudeInvoker({ verifierRejects: true }),
        }),
      }),
    ).rejects.toThrow(RiyaSyntheticGenerationError);
  });

  it('records a critic rejection as a verdict rather than re-rolling the candidate', async () => {
    const candidate = await generate({
      invokers: registry({
        'cfg.critic.claude': createFakeClaudeInvoker({ criticDecision: 'REJECTED' }),
      }),
    });

    // The candidate still exists and still carries its evidence. AS1 decides what that means; the
    // harness does not quietly generate a nicer one under the same identity.
    const rejected = candidate.verdicts.filter((one) => one.decision === 'REJECTED');
    expect(rejected).toHaveLength(1);
    expect(candidate.evidence.criticVerdicts).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// The whole point: a candidate AS1 accepts.
// ---------------------------------------------------------------------------

describe('a generated candidate reaches AS1 automated eligibility', () => {
  it('passes validateRiyaAiSyntheticCorpus with test policies and zero provider calls', async () => {
    const candidate = await generate();

    const acceptance = createRiyaAiSyntheticAcceptancePolicy({
      policyId: 'as2.smoke.acceptance.v1',
      policyVersion: 1,
      baseReleasePolicy: releasePolicyFor(PROTECTED, { minimumTotalTrajectories: 1 }),
      criticPolicy: {
        minAcceptedCritics: 2,
        requiredQualityDimensions: [...CRITIC_DIMENSIONS],
        requireCriticConfigDistinctFromGeneration: true,
        requireDistinctCriticConfigs: true,
        requireDistinctCriticModelFamilies: true,
      },
      // Tiny TEST thresholds. AS3 chooses production values from observed distributions -- AS2 must
      // not bake a diversity policy nobody has evidence for.
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
      // The protected index reaches the VALIDATOR, and only here. No generator or critic ever saw it.
      protectedIndex: PROTECTED,
    });

    expect(result.report.findings).toStrictEqual([]);
    expect(result.report.eligible).toBe(true);
    expect(result.report.reviewMode).toBe('AUTOMATED_SYNTHETIC');
    // The generic report still says human review is missing, and is right to.
    expect(result.baseReport.insufficientReview).toHaveLength(1);
  });
});
