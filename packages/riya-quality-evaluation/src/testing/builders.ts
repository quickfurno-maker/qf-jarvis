/**
 * Deterministic builders for Riya quality evaluation. TESTING SUBPATH ONLY (RWC-P10, ADR-0106).
 *
 * These exist so a spec — or an operator dry-running the harness — can produce a complete, valid
 * suite without inventing thirty identities by hand. Everything is synthetic and everything is
 * derived: there is no clock, no randomness, no key, no token and no real reviewer identity.
 *
 * `createSyntheticSafetyEvidence` deserves a note. It constructs an `ApprovalEvidence` shaped exactly
 * as `@qf-jarvis/model-evaluation` produces one, marked `synthetic: true` /
 * `productionApproval: false`. It is a FIXTURE, not a shortcut around the safety gate: a real
 * candidate binding must be derived from evidence that package actually issued, and this one exists
 * only so the derivation itself can be tested. It lives on this subpath for the same reason the
 * corpus does — nothing on a production import path can reach it.
 */
import { createEvaluationBinding } from '@qf-jarvis/model-evaluation';
import type { ApprovalEvidence, EvaluationApprovalTarget } from '@qf-jarvis/model-evaluation';

import { createRiyaQualityCandidateBinding } from '../contracts/binding.js';
import type { RiyaQualityCandidateBindingV1 } from '../contracts/binding.js';
import { createRiyaQualityHumanReview } from '../contracts/human-review.js';
import type { RiyaQualityHumanReviewV1 } from '../contracts/human-review.js';
import { createRiyaQualityObservation } from '../contracts/observation.js';
import type { RiyaQualityObservationV1 } from '../contracts/observation.js';
import { createRiyaQualitySuite } from '../contracts/suite.js';
import type { RiyaQualitySuiteV1 } from '../contracts/suite.js';
import { RIYA_QUALITY_CANONICAL_THRESHOLDS_V1 } from '../contracts/thresholds.js';
import type { RiyaQualityThresholdsV1 } from '../contracts/thresholds.js';
import type { RiyaQualityDimension } from '../contracts/vocabularies.js';
import {
  RIYA_QUALITY_GOLDEN_FIXTURES,
  RIYA_QUALITY_GOLDEN_FIXTURE_MANIFEST_ID,
  RIYA_QUALITY_GOLDEN_FIXTURE_MANIFEST_VERSION,
  RIYA_QUALITY_GOLDEN_SCENARIOS,
  RIYA_QUALITY_GOLDEN_SUITE_ID,
  RIYA_QUALITY_GOLDEN_SUITE_VERSION,
} from './golden-corpus.js';
import type { RiyaQualityGoldenFixture } from './golden-corpus.js';

/** A fixed instant. Deterministic, so two runs of the same harness produce the same digests. */
export const SYNTHETIC_INSTANT = '2026-01-01T00:00:00Z';

export interface SyntheticSafetyEvidenceOptions {
  readonly target?: EvaluationApprovalTarget;
  readonly releaseId?: string;
  readonly modelId?: string;
  readonly promptFamily?: string;
  readonly promptVersion?: number;
  readonly promptDigest?: string;
  readonly capabilityProfileRef?: string;
  readonly knowledgeRevision?: string;
  readonly policyContractRevision?: string;
  readonly synthetic?: boolean;
  readonly productionApproval?: boolean;
}

/** A synthetic generic-safety `ApprovalEvidence`, shaped exactly as model-evaluation emits one. */
export function createSyntheticSafetyEvidence(
  options: SyntheticSafetyEvidenceOptions = {},
): ApprovalEvidence {
  const binding = createEvaluationBinding({
    evaluationSuiteId: 'synthetic-safety-suite',
    evaluationSuiteVersion: 1,
    fixtureManifestId: 'synthetic-safety-fixtures',
    fixtureManifestVersion: 1,
    evaluatorImplId: 'synthetic-evaluator',
    evaluatorImplVersion: 1,
    release: {
      releaseId: options.releaseId ?? 'release.alpha',
      providerId: 'provider.alpha',
      modelId: options.modelId ?? 'vendor.alpha/model-alpha',
      modelVersion: '1',
      configDigest: 'abcdef01',
      executionClass: 'HOSTED',
    },
    promptFamily: options.promptFamily ?? 'riya.conversation',
    promptVersion: options.promptVersion ?? 1,
    promptDigest: options.promptDigest ?? 'a'.repeat(64),
    capabilityProfileRef: options.capabilityProfileRef ?? 'capability.riya.alpha',
    knowledgeRevision: options.knowledgeRevision ?? 'knowledge.rev.1',
    policyContractRevision: options.policyContractRevision ?? 'policy.rev.1',
    createdAt: SYNTHETIC_INSTANT,
  });

  return Object.freeze({
    evaluationRef: 'synthetic.safety.ref.1',
    target: options.target ?? 'SHADOW_ELIGIBILITY',
    binding,
    suiteResultDigest: 'b'.repeat(32),
    caseSetDigest: 'c'.repeat(32),
    createdAt: SYNTHETIC_INSTANT,
    synthetic: options.synthetic ?? true,
    productionApproval: options.productionApproval ?? false,
  });
}

/** A quality candidate binding over the golden corpus, derived from synthetic safety evidence. */
export function createSyntheticQualityBinding(
  options: SyntheticSafetyEvidenceOptions = {},
): RiyaQualityCandidateBindingV1 {
  return createRiyaQualityCandidateBinding({
    safetyEvidence: createSyntheticSafetyEvidence(options),
    qualitySuiteId: RIYA_QUALITY_GOLDEN_SUITE_ID,
    qualitySuiteVersion: RIYA_QUALITY_GOLDEN_SUITE_VERSION,
    fixtureManifestId: RIYA_QUALITY_GOLDEN_FIXTURE_MANIFEST_ID,
    fixtureManifestVersion: RIYA_QUALITY_GOLDEN_FIXTURE_MANIFEST_VERSION,
    thresholdsId: RIYA_QUALITY_CANONICAL_THRESHOLDS_V1.thresholdsId,
    thresholdsVersion: RIYA_QUALITY_CANONICAL_THRESHOLDS_V1.thresholdsVersion,
    createdAt: SYNTHETIC_INSTANT,
  });
}

/** The full 72-case golden suite under the canonical thresholds. */
export function buildRiyaQualityGoldenSuite(
  binding: RiyaQualityCandidateBindingV1 = createSyntheticQualityBinding(),
  thresholds: RiyaQualityThresholdsV1 = RIYA_QUALITY_CANONICAL_THRESHOLDS_V1,
): RiyaQualitySuiteV1 {
  return createRiyaQualitySuite({
    binding,
    scenarios: RIYA_QUALITY_GOLDEN_SCENARIOS,
    thresholds,
  });
}

/** Two distinct reviews that satisfy exactly `satisfied`. */
export function twoReviews(
  satisfied: readonly RiyaQualityDimension[],
  options: {
    readonly secondSatisfied?: readonly RiyaQualityDimension[];
    readonly refs?: readonly [string, string];
  } = {},
): readonly RiyaQualityHumanReviewV1[] {
  const [first, second] = options.refs ?? (['reviewer.alpha', 'reviewer.beta'] as const);
  return Object.freeze([
    createRiyaQualityHumanReview({ version: 1, reviewRef: first, satisfiedDimensions: satisfied }),
    createRiyaQualityHumanReview({
      version: 1,
      reviewRef: second,
      satisfiedDimensions: options.secondSatisfied ?? satisfied,
    }),
  ]);
}

/**
 * A PASSING observation for one golden fixture.
 *
 * `withheldDimensions` lets a spec make the second reviewer withhold specific dimensions, which is
 * how a controlled pass-rate drop is produced for the comparison specs — one reviewer disagreeing is
 * exactly the real-world shape of a dimension regression.
 */
export function passingObservationFor(
  fixture: RiyaQualityGoldenFixture,
  options: { readonly withheldDimensions?: readonly RiyaQualityDimension[] } = {},
): RiyaQualityObservationV1 {
  const required = fixture.scenario.expected.requiredQualityDimensions;
  const withheld = new Set(options.withheldDimensions ?? []);
  const secondSatisfied = required.filter((dimension) => !withheld.has(dimension));

  return createRiyaQualityObservation({
    version: 1,
    scenarioId: fixture.scenario.scenarioId,
    scenarioVersion: fixture.scenario.scenarioVersion,
    languageMode: fixture.scenario.languageMode,
    replyCharCount: fixture.passingShape.replyCharCount,
    questionCount: fixture.passingShape.questionCount,
    askedDiscoveryFields: fixture.passingShape.askedDiscoveryFields,
    observationBatch: {
      version: 1,
      observations: fixture.passingShape.observations,
      skipProjectDetails: fixture.passingShape.skipProjectDetails,
    },
    citations: fixture.passingShape.citations,
    continuityPhaseAfter: fixture.passingShape.continuityPhaseAfter,
    humanReviews: required.length === 0 ? [] : twoReviews(required, { secondSatisfied }),
  });
}

/**
 * A passing observation for every golden fixture.
 *
 * `withhold` names dimensions the SECOND reviewer declines on the first `withholdCases` fixtures that
 * require them, which drives a specific dimension's pass rate down by a known amount.
 */
export function passingGoldenObservations(
  options: {
    readonly withhold?: readonly RiyaQualityDimension[];
    readonly withholdCases?: number;
  } = {},
): readonly RiyaQualityObservationV1[] {
  const withhold = options.withhold ?? [];
  let remaining = options.withholdCases ?? 0;
  return Object.freeze(
    RIYA_QUALITY_GOLDEN_FIXTURES.map((fixture) => {
      const applies =
        remaining > 0 &&
        withhold.some((dimension) =>
          fixture.scenario.expected.requiredQualityDimensions.includes(dimension),
        );
      if (applies) {
        remaining -= 1;
        return passingObservationFor(fixture, { withheldDimensions: withhold });
      }
      return passingObservationFor(fixture);
    }),
  );
}
