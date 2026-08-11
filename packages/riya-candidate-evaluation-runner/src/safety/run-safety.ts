/**
 * The offline SAFETY runner (MVP-P2A.1).
 *
 * ### It schedules; the authority decides
 *
 * One synthetic case per mandatory red-team kind goes through the injected candidate port, each result
 * becomes a `CandidateObservation` through the real constructor, and the whole map is handed to
 * `evaluateSuite`. This file computes no verdict, no score and no threshold of its own — it exists
 * because `@qf-jarvis/model-evaluation` had no way to be given a real candidate, not because it needed
 * a second opinion.
 *
 * ### A blocked run is not a failed run, and neither is a pass
 *
 * If any case cannot be observed deterministically, the whole attempt returns BLOCKED with the case
 * ids and closed reasons, and no suite result is produced. That is deliberately louder than a failing
 * case: a failure says the candidate did something wrong, while a block says the measurement did not
 * happen, and only one of those is a statement about the model.
 */
import {
  createEvaluationSuite,
  DEFAULT_MANDATORY_RED_TEAM_KINDS,
  evaluateSuite,
  scenarioKey,
} from '@qf-jarvis/model-evaluation';
import type {
  CandidateObservation,
  EvaluationBinding,
  SuiteResult,
  SuiteThresholds,
} from '@qf-jarvis/model-evaluation';

import type { RiyaCandidateExecutionPort } from '../contracts/candidate-port.js';
import { extractSafetyObservation } from './extract-observation.js';
import type { SafetyIncompleteReason } from './extract-observation.js';
import { RIYA_SAFETY_FIXTURES } from './fixtures.js';
import type { RiyaSafetyFixtureV1 } from './fixtures.js';

export interface RunRiyaSafetyCandidateOptions {
  readonly port: RiyaCandidateExecutionPort;
  /** The exact evaluation binding — release, prompt identity, capability profile, policy revision. */
  readonly binding: EvaluationBinding;
  readonly thresholds: SuiteThresholds;
  /** Defaults to the full manifest; a spec may narrow it, a live run must not. */
  readonly fixtures?: readonly RiyaSafetyFixtureV1[];
}

/** One case the run could not measure. */
export interface RiyaSafetyBlockedCase {
  readonly caseId: string;
  readonly reason: SafetyIncompleteReason;
}

export type RunRiyaSafetyCandidateResult =
  | { readonly status: 'EVALUATED'; readonly suiteResult: SuiteResult }
  | { readonly status: 'BLOCKED'; readonly blocked: readonly RiyaSafetyBlockedCase[] };

/**
 * Execute every safety fixture once and evaluate the suite.
 *
 * Sequential on purpose. These are seventeen requests against a candidate whose behaviour under
 * concurrency is not what is being measured here, and a fixed order makes a blocked run reproducible.
 */
export async function runRiyaSafetyCandidate(
  options: RunRiyaSafetyCandidateOptions,
): Promise<RunRiyaSafetyCandidateResult> {
  const fixtures = options.fixtures ?? RIYA_SAFETY_FIXTURES;
  const observations = new Map<string, CandidateObservation>();
  const blocked: RiyaSafetyBlockedCase[] = [];

  for (const fixture of fixtures) {
    const record = await options.port.execute(fixture.request);
    const extracted = extractSafetyObservation(fixture.scenario, record);
    if (!extracted.ok) {
      blocked.push({ caseId: fixture.fixtureId, reason: extracted.reason });
      continue;
    }
    observations.set(
      scenarioKey(fixture.scenario.scenarioId, fixture.scenario.scenarioVersion),
      extracted.observation,
    );
  }

  if (blocked.length > 0) {
    return { status: 'BLOCKED', blocked: Object.freeze(blocked) };
  }

  const suite = createEvaluationSuite({
    binding: options.binding,
    scenarios: fixtures.map((fixture) => fixture.scenario),
    thresholds: options.thresholds,
    mandatoryRedTeamKinds: DEFAULT_MANDATORY_RED_TEAM_KINDS,
  });
  return { status: 'EVALUATED', suiteResult: evaluateSuite(suite, observations) };
}
