/**
 * Invented fixtures for the local adapter specs.
 *
 * Every identifier is obviously fake -- `vendor.alpha`, `base.alpha-14`, `engine.epsilon` -- and no
 * name here is a candidate model. That matters more than it looks: a plausible model name sitting in a
 * benchmark fixture is the thing somebody quotes six months later as though a measurement existed.
 */
import {
  createRiyaBenchmarkSuitePlan,
  riyaBenchmarkWorkloadForCase,
} from '@qf-jarvis/riya-model-benchmark-harness';
import type { RiyaBenchmarkSuitePlanV1 } from '@qf-jarvis/riya-model-benchmark-harness';
import type { RiyaBenchmarkWorkloadV1 } from '@qf-jarvis/riya-model-benchmark';

import { createRiyaLocalBenchmarkAdapterConfig } from '../contracts/adapter-config.js';
import { riyaLocalBenchmarkSamplingDigest } from '../contracts/adapter-config.js';
import type {
  RiyaLocalBenchmarkAdapterConfigInput,
  RiyaLocalBenchmarkAdapterConfigV1,
  RiyaLocalBenchmarkSamplingV1,
} from '../contracts/adapter-config.js';
import { riyaSyntheticPromptProfileDigest } from '../prompts/synthetic-profiles.js';

/** The invented served model. Not a candidate, not a real catalogue id. */
export const FIXTURE_MODEL_ID = 'vendor.alpha/base.alpha-14';

export const FIXTURE_SAMPLING: RiyaLocalBenchmarkSamplingV1 = Object.freeze({
  temperature: 0,
  topP: 1,
  seed: 7,
});

export const FIXTURE_CASE_ID = 'case.short.c1';
export const FIXTURE_PROFILE_ID = 'synthetic.short.chat.v1';

function digest(label: string): string {
  const body = label.replace(/[^a-f0-9]/gu, '');
  return (body.length > 0 ? body : 'a').repeat(64).slice(0, 64);
}

/** A minimal, valid adapter configuration input. */
export function fixtureConfigInput(
  overrides: Partial<RiyaLocalBenchmarkAdapterConfigInput> = {},
): RiyaLocalBenchmarkAdapterConfigInput {
  return {
    version: 1,
    subject: {
      version: 1,
      release: {
        releaseId: 'release.alpha',
        providerId: 'provider.local',
        modelId: FIXTURE_MODEL_ID,
        modelVersion: 'v1',
        configDigest: digest('cfa'),
        executionClass: 'LOCAL',
      },
      promptFamily: 'prompt.family.alpha',
      promptVersion: 1,
      promptDigest: digest('deadbeef'),
      capabilityProfileRef: 'capability.alpha',
      policyContractRevision: 'policy.r1',
    },
    environment: {
      architectureFamily: 'X86_64',
      acceleratorFamily: 'DISCRETE_GPU',
      acceleratorRef: 'accelerator.alpha',
      acceleratorCount: 1,
      hostMemoryBytes: 34_359_738_368,
      runtimeEngineId: 'engine.epsilon',
      runtimeEngineVersion: 'v1.2.3',
    },
    sampling: FIXTURE_SAMPLING,
    outputTokenAccounting: 'SERVER_REPORTED_USAGE',
    casePromptProfiles: { [FIXTURE_CASE_ID]: FIXTURE_PROFILE_ID },
    ...overrides,
  };
}

/** A valid adapter configuration. */
export function fixtureConfig(
  overrides: Partial<RiyaLocalBenchmarkAdapterConfigInput> = {},
): RiyaLocalBenchmarkAdapterConfigV1 {
  return createRiyaLocalBenchmarkAdapterConfig(fixtureConfigInput(overrides));
}

export interface FixturePlanOptions {
  readonly inputTokenCount?: number;
  readonly maximumOutputTokens?: number;
  readonly requestTimeoutMicros?: number;
  readonly measuredRequestCount?: number;
  readonly warmupRequestCount?: number;
  readonly concurrency?: number;
  readonly streaming?: boolean;
  readonly promptProfileDigest?: string;
  readonly samplingConfigDigest?: string;
  readonly workloadCaseId?: string;
}

/** A one-case suite plan that agrees with `fixtureConfig` unless a spec makes it disagree. */
export function fixturePlan(options: FixturePlanOptions = {}): RiyaBenchmarkSuitePlanV1 {
  return createRiyaBenchmarkSuitePlan({
    version: 1,
    benchmarkSuiteId: 'suite.local.alpha',
    benchmarkSuiteVersion: 1,
    cases: [
      {
        workloadCaseId: options.workloadCaseId ?? FIXTURE_CASE_ID,
        promptProfileDigest:
          options.promptProfileDigest ?? riyaSyntheticPromptProfileDigest(FIXTURE_PROFILE_ID),
        inputTokenCount: options.inputTokenCount ?? 11,
        maximumOutputTokens: options.maximumOutputTokens ?? 32,
        requestTimeoutMicros: options.requestTimeoutMicros ?? 5_000_000,
        concurrency: options.concurrency ?? 1,
        batchSize: 1,
        warmupRequestCount: options.warmupRequestCount ?? 0,
        measuredRequestCount: options.measuredRequestCount ?? 2,
        streaming: options.streaming ?? true,
        samplingConfigDigest:
          options.samplingConfigDigest ?? riyaLocalBenchmarkSamplingDigest(FIXTURE_SAMPLING),
      },
    ],
  });
}

/** The workload RMB-B would build for the single case of `fixturePlan`. */
export function fixtureWorkload(options: FixturePlanOptions = {}): RiyaBenchmarkWorkloadV1 {
  const plan = fixturePlan(options);
  const first = plan.cases[0];
  if (first === undefined) {
    throw new Error('fixture plan has no case');
  }
  return riyaBenchmarkWorkloadForCase(plan, first);
}
