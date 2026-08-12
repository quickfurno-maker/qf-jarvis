/**
 * The BLINDED human-review bundle (MVP-P2A.1).
 *
 * ### Why blinding is load-bearing here
 *
 * The bundle exists to select a model, and a reviewer who knows they are reading "the small cheap one"
 * marks it differently from one reading "the flagship". That bias would then be laundered into a
 * threshold pass and quoted as a quality measurement. So the reviewer sees the turn and the rubric,
 * and nothing about the provider, the model, its size, its price or its speed — none of those fields
 * exists in this structure, so omitting them is not a discipline anybody has to remember.
 *
 * ### What a reviewer does see
 *
 * The synthetic client turn, the candidate reply, the language and interaction kind the case is about,
 * the dimensions this case requires, and an anonymous case reference. That is what the rubric needs to
 * make a binary judgement per dimension, which is the only thing the review contract accepts.
 *
 * ### Two people, and the schema will not pretend otherwise
 *
 * The bundle records how many independent reviews each case needs, taken from the governed threshold
 * constant rather than a local number. Reviews come back through the existing
 * `@qf-jarvis/riya-quality-evaluation` contract; nothing here invents a competing review schema, a
 * confidence field or a comment field, because those are exactly what that contract refuses.
 */
import {
  RIYA_QUALITY_REQUIRED_HUMAN_REVIEWS,
  type RiyaQualityDimension,
  type RiyaQualityInteractionKind,
  type RiyaQualityLanguageMode,
} from '@qf-jarvis/riya-quality-evaluation';
import { RIYA_QUALITY_GOLDEN_FIXTURES } from '@qf-jarvis/riya-quality-evaluation/testing';
import type { RiyaQualityGoldenFixture } from '@qf-jarvis/riya-quality-evaluation/testing';

import { riyaReviewCaseDigest } from './case-digest.js';
import type { RiyaQualityCandidateCapture } from './capture.js';

export const RIYA_REVIEW_BUNDLE_VERSION = 1;

/** One case as a reviewer sees it. No provider, model, size, price or speed field exists. */
export interface RiyaQualityReviewCase {
  readonly caseRef: string;
  /**
   * SHA-256 of exactly this reviewer-visible case, lowercase hex.
   *
   * It travels back with the completed reviews so ingest can prove the judgements were made about
   * these bytes. A position alone could not: `case-001` means something different for every
   * candidate, and reviews for one would silently apply to another.
   */
  readonly caseDigest: string;
  readonly languageMode: RiyaQualityLanguageMode;
  readonly interactionKind: RiyaQualityInteractionKind;
  /** The synthetic client turn. */
  readonly clientMessage: string;
  /** The candidate reply, verbatim. */
  readonly candidateReply: string;
  /** The dimensions this case is judged on, from the governed scenario. */
  readonly requiredDimensions: readonly RiyaQualityDimension[];
}

export interface RiyaQualityReviewBundle {
  readonly version: typeof RIYA_REVIEW_BUNDLE_VERSION;
  /** How many DISTINCT reviewers each case needs. Taken from the governed threshold constant. */
  readonly requiredReviewsPerCase: number;
  readonly cases: readonly RiyaQualityReviewCase[];
}

/**
 * Build the bundle.
 *
 * A capture whose fixture is not in the governed corpus is dropped rather than shown, because a
 * reviewer's time should only ever be spent on cases the suite will actually evaluate.
 */
export function buildRiyaQualityReviewBundle(options: {
  readonly captures: readonly RiyaQualityCandidateCapture[];
  readonly fixtures?: readonly RiyaQualityGoldenFixture[];
}): RiyaQualityReviewBundle {
  const fixtures = options.fixtures ?? RIYA_QUALITY_GOLDEN_FIXTURES;
  const byFixtureId = new Map<string, RiyaQualityGoldenFixture>(
    fixtures.map((fixture) => [fixture.fixtureId, fixture]),
  );

  const cases: RiyaQualityReviewCase[] = [];
  for (const capture of options.captures) {
    const fixture = byFixtureId.get(capture.fixtureId);
    if (fixture === undefined) {
      continue;
    }
    const visible = {
      bundleVersion: RIYA_REVIEW_BUNDLE_VERSION,
      caseRef: capture.caseRef,
      languageMode: fixture.languageMode,
      interactionKind: fixture.interactionKind,
      clientMessage: capture.syntheticUserText,
      candidateReply: capture.replyBody,
      requiredDimensions: fixture.scenario.expected.requiredQualityDimensions,
    };
    cases.push(
      Object.freeze({
        caseRef: visible.caseRef,
        caseDigest: riyaReviewCaseDigest(visible),
        languageMode: visible.languageMode,
        interactionKind: visible.interactionKind,
        clientMessage: visible.clientMessage,
        candidateReply: visible.candidateReply,
        requiredDimensions: Object.freeze([...visible.requiredDimensions]),
      }),
    );
  }

  return Object.freeze({
    version: RIYA_REVIEW_BUNDLE_VERSION,
    requiredReviewsPerCase: RIYA_QUALITY_REQUIRED_HUMAN_REVIEWS,
    cases: Object.freeze(cases),
  });
}
