/**
 * The AS2 contracts (AS2, ADR-0143).
 *
 * The credential screen on the config inventory is the one worth reading twice: a config carrying a
 * key would be committed, digested into a run manifest and copied into every artifact citing the run.
 * That failure is silent, which is why it gets a constructor check rather than a review convention.
 */
import { describe, expect, it } from 'vitest';

import {
  RIYA_SYNTHETIC_INSTRUCTION_PROHIBITIONS,
  RiyaSyntheticGenerationError,
  createRiyaSyntheticGenerationPolicy,
  createRiyaSyntheticInvocationRequest,
  createRiyaSyntheticInvocationResult,
  createRiyaSyntheticConfigInventory,
  createRiyaSyntheticModelConfig,
  createRiyaSyntheticRoleInstruction,
  createRiyaSyntheticRunPlan,
  parseRiyaSyntheticModelOutput,
} from '../index.js';
import { customerTurnOutputSchema, teacherTurnOutputSchema } from '../contracts/model-output.js';
import { sha256Hex } from '../internal/digest.js';
import { policy, runPlan } from './fixtures.js';

const SHA = sha256Hex('anything');

const CONFIG = {
  configRef: 'cfg.one',
  providerFamilyRef: 'provider.one',
  modelFamilyRef: 'family.one',
  modelRef: 'model.one',
  adapterRef: 'adapter.one',
  allowedRoles: ['RIYA_TEACHER'] as const,
  instructionRef: 'instruction.one',
  instructionSha256: SHA,
  outputSchemaVersion: 1,
  maxOutputTokens: 1_024,
  samplingPolicyRef: 'sampling.one',
  retryPolicyRef: 'retry.one',
  activeForGeneration: true,
};

describe('a model configuration carries no credential', () => {
  it('has no field a key, URL or header could live in', () => {
    const config = createRiyaSyntheticModelConfig(CONFIG);

    for (const absent of ['apiKey', 'baseUrl', 'url', 'token', 'authorization', 'organization']) {
      expect(Object.keys(config), absent).not.toContain(absent);
    }
  });

  it('refuses a value that looks like a credential or an endpoint', () => {
    for (const [field, value] of [
      ['adapterRef', 'https://api.example.com/v1'],
      ['modelRef', 'sk-abcdefghijklmno'],
      ['instructionRef', 'my-api-key-value'],
      ['samplingPolicyRef', 'secret-sampling'],
    ] as const) {
      expect(() => createRiyaSyntheticModelConfig({ ...CONFIG, [field]: value })).toThrow(
        RiyaSyntheticGenerationError,
      );
    }
  });

  it('refuses an inventory with duplicate configuration refs', () => {
    // This spec previously asserted something else under this name: it exercised an empty role list
    // and never built a duplicate at all. The production guard was real; the test was not.
    expect(() =>
      createRiyaSyntheticConfigInventory({
        inventoryRef: 'inventory.duplicate.v1',
        configs: [
          { ...CONFIG, configRef: 'cfg.same' },
          { ...CONFIG, configRef: 'cfg.same', modelRef: 'model.two' },
        ],
      }),
    ).toThrow(RiyaSyntheticGenerationError);
  });

  it('accepts the same inventory once the refs differ', () => {
    // The other half, so the rejection above is provably about DUPLICATION and not the fixture.
    const built = createRiyaSyntheticConfigInventory({
      inventoryRef: 'inventory.distinct.v1',
      configs: [
        { ...CONFIG, configRef: 'cfg.one' },
        { ...CONFIG, configRef: 'cfg.two', modelRef: 'model.two' },
      ],
    });

    expect(built.configs).toHaveLength(2);
  });

  it('refuses a configuration with no permitted role', () => {
    // The assertion the duplicate spec used to carry, kept -- under a name that describes it.
    expect(() => createRiyaSyntheticModelConfig({ ...CONFIG, allowedRoles: [] })).toThrow(
      RiyaSyntheticGenerationError,
    );
  });
});

describe('a role instruction is identity plus prohibitions', () => {
  const INSTRUCTION = {
    instructionRef: 'instruction.teacher.v1',
    instructionVersion: 1,
    role: 'RIYA_TEACHER' as const,
    instructionSha256: SHA,
    forbids: [...RIYA_SYNTHETIC_INSTRUCTION_PROHIBITIONS],
  };

  it('requires EVERY prohibition, not a chosen subset', () => {
    // The trimmed one is always the inconvenient one.
    expect(() =>
      createRiyaSyntheticRoleInstruction({ ...INSTRUCTION, forbids: ['CHAIN_OF_THOUGHT'] }),
    ).toThrow(RiyaSyntheticGenerationError);
    expect(createRiyaSyntheticRoleInstruction(INSTRUCTION).forbids).toHaveLength(
      RIYA_SYNTHETIC_INSTRUCTION_PROHIBITIONS.length,
    );
  });

  it('carries a digest, so editing the words moves the identity', () => {
    const original = createRiyaSyntheticRoleInstruction(INSTRUCTION);
    const edited = createRiyaSyntheticRoleInstruction({
      ...INSTRUCTION,
      instructionSha256: sha256Hex('different words'),
    });

    expect(edited.instructionSha256).not.toBe(original.instructionSha256);
  });
});

describe('an invocation envelope carries refs, never transport', () => {
  const REQUEST = {
    requestRef: 'req.one',
    generationRef: 'gen.one',
    scenarioRef: 'scn.one',
    role: 'RIYA_TEACHER' as const,
    configRef: 'cfg.one',
    inputDigest: SHA,
    outputSchemaRef: 'schema.one',
    attempt: 1,
    maxOutputTokens: 1_024,
  };

  it('has no field for a key, a URL or a customer identifier', () => {
    const request = createRiyaSyntheticInvocationRequest(REQUEST);

    for (const absent of ['apiKey', 'url', 'headers', 'tenant', 'customerId', 'waId', 'prompt']) {
      expect(Object.keys(request), absent).not.toContain(absent);
    }
  });

  it('refuses a result whose status and payload disagree', () => {
    // SUCCESS without a digest, or a failure carrying one, is a bug that would be stored as evidence.
    expect(() =>
      createRiyaSyntheticInvocationResult({
        requestRef: 'req.one',
        configRef: 'cfg.one',
        role: 'RIYA_TEACHER',
        status: 'SUCCESS',
      }),
    ).toThrow(RiyaSyntheticGenerationError);
    expect(() =>
      createRiyaSyntheticInvocationResult({
        requestRef: 'req.one',
        configRef: 'cfg.one',
        role: 'RIYA_TEACHER',
        status: 'PROVIDER_ERROR',
        outputDigest: SHA,
        errorClass: 'TRANSIENT',
      }),
    ).toThrow(RiyaSyntheticGenerationError);
  });

  it('stores usage as integer counters and no cost', () => {
    const result = createRiyaSyntheticInvocationResult({
      requestRef: 'req.one',
      configRef: 'cfg.one',
      role: 'RIYA_TEACHER',
      status: 'SUCCESS',
      outputDigest: SHA,
      usage: { inputTokens: 12, outputTokens: 8, cachedInputTokens: 0 },
    });

    expect(Object.keys(result.usage ?? {})).toStrictEqual([
      'inputTokens',
      'outputTokens',
      'cachedInputTokens',
    ]);
  });
});

describe('the generation policy bounds every loop in the contract', () => {
  it('caps structural repair at one', () => {
    expect(() =>
      createRiyaSyntheticGenerationPolicy({ ...policy(), maxStructuralRepairAttempts: 2 }),
    ).toThrow(RiyaSyntheticGenerationError);
  });

  it('refuses a candidate budget smaller than a single call', () => {
    expect(() =>
      createRiyaSyntheticGenerationPolicy({
        ...policy(),
        perInvocationTimeoutMs: 30_000,
        candidateTimeoutMs: 5_000,
      }),
    ).toThrow(RiyaSyntheticGenerationError);
  });

  it('refuses cross-family critique with only one critic', () => {
    expect(() =>
      createRiyaSyntheticGenerationPolicy({
        ...policy(),
        requireCrossFamilyCritique: true,
        minCriticsPerCandidate: 1,
      }),
    ).toThrow(RiyaSyntheticGenerationError);
  });
});

describe('parsing fails closed', () => {
  it('refuses an unknown key rather than dropping it', () => {
    // Silently discarding an invented field hides that the instruction and the schema have drifted.
    expect(() =>
      parseRiyaSyntheticModelOutput(
        JSON.stringify({
          userText: 'hello there friend',
          revealedFields: [],
          behaviorEvents: [],
          extra: 1,
        }),
        customerTurnOutputSchema,
      ),
    ).toThrow(RiyaSyntheticGenerationError);
  });

  it('refuses a customer output that tried to write the assistant side', () => {
    expect(() =>
      parseRiyaSyntheticModelOutput(
        JSON.stringify({
          userText: 'hi',
          revealedFields: [],
          behaviorEvents: [],
          assistantText: 'no',
        }),
        customerTurnOutputSchema,
      ),
    ).toThrow(RiyaSyntheticGenerationError);
  });

  it('refuses a teacher output carrying a reasoning trace', () => {
    expect(() =>
      parseRiyaSyntheticModelOutput(
        JSON.stringify({
          assistantText: 'a reply',
          reasoning: 'first I considered',
          annotation: {
            decision: 'ASK_DISCOVERY',
            responseObjective: 'DISCOVER',
            askedDiscoveryFields: [],
            supportedFactRefs: [],
          },
        }),
        teacherTurnOutputSchema,
      ),
    ).toThrow(RiyaSyntheticGenerationError);
  });

  it('refuses bytes that are not JSON, and bytes that are too large', () => {
    expect(() => parseRiyaSyntheticModelOutput('{nope', customerTurnOutputSchema)).toThrow(
      RiyaSyntheticGenerationError,
    );
    expect(() =>
      parseRiyaSyntheticModelOutput('x'.repeat(40_000), customerTurnOutputSchema),
    ).toThrow(RiyaSyntheticGenerationError);
  });
});

// ---------------------------------------------------------------------------
// The run plan proves its closed vocabularies at CONSTRUCTION.
// ---------------------------------------------------------------------------

describe('a run plan cannot claim a vocabulary it does not hold', () => {
  it('refuses an invalid value on every closed axis', () => {
    // These were `z.array(z.string())`, so a plan carrying "NOT_A_REAL_VALUE" survived the
    // constructor and became an object whose TypeScript type claimed only canonical members. Failing
    // later at schedule time is a weaker guarantee: the false contract has already been issued, by
    // the very function whose job is to prove one.
    const axes = [
      'languageModes',
      'interactionKinds',
      'personas',
      'difficulties',
      'riskClasses',
      'startPhases',
    ] as const;

    for (const axis of axes) {
      expect(
        () => createRiyaSyntheticRunPlan({ ...runPlan(4), [axis]: ['NOT_A_REAL_VALUE'] }),
        `${axis} must be closed at construction`,
      ).toThrow(RiyaSyntheticGenerationError);
    }
  });

  it('still accepts every canonical value', () => {
    expect(createRiyaSyntheticRunPlan(runPlan(4)).languageModes.length).toBeGreaterThan(0);
  });
});
