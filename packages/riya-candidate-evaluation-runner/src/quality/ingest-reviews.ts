/**
 * Completed human reviews → P10 quality result (MVP-P2A.1).
 *
 * ### The two-reviewer rule is not negotiable, and not re-implemented
 *
 * Every review is rebuilt through the existing `createRiyaQualityHumanReview`, so a `comment`, a
 * `name` or a confidence score is refused by the contract that already refuses them. This file adds
 * exactly one thing on top: it counts DISTINCT reviewers per case against the governed constant, and
 * refuses a case where the same `reviewRef` appears twice. One person marking a reply twice is one
 * person's taste recorded as agreement, which is precisely the failure two reviewers exist to prevent.
 *
 * There is no bypass, no single-reviewer MVP mode and no auto-fill. A case short of its reviews is not
 * evaluated as a fail — the evaluator's own `INCONCLUSIVE` handling is what it is for.
 *
 * ### What this cannot detect
 *
 * The review contract carries an opaque `reviewRef` and nothing about how the judgement was formed. A
 * reviewer who pasted the reply into a chatbot and copied its verdict is indistinguishable, here, from
 * one who read it. That is a PROCESS control, not a code control, and pretending otherwise with a
 * heuristic would be worse than saying it plainly: two named humans are accountable for those refs.
 */
import {
  createRiyaQualityObservation,
  evaluateRiyaQualitySuite,
  RIYA_QUALITY_REQUIRED_HUMAN_REVIEWS,
} from '@qf-jarvis/riya-quality-evaluation';
import type {
  RiyaQualityHumanReviewInput,
  RiyaQualityObservationV1,
  RiyaQualitySuiteResultV1,
  RiyaQualitySuiteV1,
} from '@qf-jarvis/riya-quality-evaluation';

import { RIYA_QUALITY_GOLDEN_FIXTURES } from '@qf-jarvis/riya-quality-evaluation/testing';
import type { RiyaQualityGoldenFixture } from '@qf-jarvis/riya-quality-evaluation/testing';

import { RiyaCandidateRunnerError } from '../contracts/errors.js';
import type { RiyaQualityCandidateCapture } from './capture.js';
import { riyaReviewCaseDigest } from './case-digest.js';
import { RIYA_REVIEW_BUNDLE_VERSION } from './review-bundle.js';

/**
 * One case's completed reviews, as returned by the review tool.
 *
 * `caseDigest` is what makes this a review OF SOMETHING. Without it the envelope names a position, and
 * a position is the same string for every candidate.
 */
export interface RiyaQualityCaseReviews {
  readonly caseRef: string;
  readonly caseDigest: string;
  readonly reviews: readonly RiyaQualityHumanReviewInput[];
}

/** Why a review set was refused. Content-free, and it names no reviewer. */
export const REVIEW_REJECTION_REASONS = [
  'unknown-case-ref',
  'duplicate-case-ref',
  'missing-case-review',
  /** The reviews were made about different bytes than the ones now being evaluated. */
  'case-digest-mismatch',
  /** The capture's fixture is not in the governed corpus, so the digest cannot be re-derived. */
  'unknown-fixture',
  'insufficient-independent-reviews',
  'duplicate-reviewer',
  'review-schema-invalid',
] as const;
export type ReviewRejectionReason = (typeof REVIEW_REJECTION_REASONS)[number];

export interface RiyaQualityReviewRejection {
  readonly caseRef: string;
  readonly reason: ReviewRejectionReason;
}

export type RiyaQualityIngestResult =
  | { readonly ok: true; readonly observations: readonly RiyaQualityObservationV1[] }
  | { readonly ok: false; readonly rejections: readonly RiyaQualityReviewRejection[] };

/**
 * Validate the review set against the captures and build governed observations.
 *
 * Coverage is exact in both directions: an unreviewed capture and a review for a case that was never
 * captured are both refusals, because either one means the reviewer and the run were not looking at
 * the same thing.
 */
export function ingestRiyaQualityReviews(options: {
  readonly captures: readonly RiyaQualityCandidateCapture[];
  readonly caseReviews: readonly RiyaQualityCaseReviews[];
  /** Defaults to the governed corpus. The digest is re-derived from it, never from the submission. */
  readonly fixtures?: readonly RiyaQualityGoldenFixture[];
}): RiyaQualityIngestResult {
  const fixtures = options.fixtures ?? RIYA_QUALITY_GOLDEN_FIXTURES;
  const fixtureById = new Map<string, RiyaQualityGoldenFixture>(
    fixtures.map((fixture) => [fixture.fixtureId, fixture]),
  );
  const rejections: RiyaQualityReviewRejection[] = [];
  const byCaseRef = new Map<string, RiyaQualityCandidateCapture>(
    options.captures.map((capture) => [capture.caseRef, capture]),
  );

  const seen = new Set<string>();
  for (const entry of options.caseReviews) {
    if (!byCaseRef.has(entry.caseRef)) {
      rejections.push({ caseRef: entry.caseRef, reason: 'unknown-case-ref' });
      continue;
    }
    if (seen.has(entry.caseRef)) {
      rejections.push({ caseRef: entry.caseRef, reason: 'duplicate-case-ref' });
      continue;
    }
    seen.add(entry.caseRef);
  }

  const envelopeByCaseRef = new Map<string, RiyaQualityCaseReviews>(
    options.caseReviews.map((entry) => [entry.caseRef, entry]),
  );

  const observations: RiyaQualityObservationV1[] = [];
  for (const capture of options.captures) {
    const envelope = envelopeByCaseRef.get(capture.caseRef);
    if (envelope === undefined) {
      rejections.push({ caseRef: capture.caseRef, reason: 'missing-case-review' });
      continue;
    }

    // Re-derived from the CURRENT capture and the CURRENT governed fixture — never read back from
    // the submission, which is the thing being checked.
    const fixture = fixtureById.get(capture.fixtureId);
    if (fixture === undefined) {
      rejections.push({ caseRef: capture.caseRef, reason: 'unknown-fixture' });
      continue;
    }
    const expectedDigest = riyaReviewCaseDigest({
      bundleVersion: RIYA_REVIEW_BUNDLE_VERSION,
      caseRef: capture.caseRef,
      languageMode: fixture.languageMode,
      interactionKind: fixture.interactionKind,
      clientMessage: capture.syntheticUserText,
      candidateReply: capture.replyBody,
      requiredDimensions: fixture.scenario.expected.requiredQualityDimensions,
    });
    if (envelope.caseDigest !== expectedDigest) {
      // The humans judged different bytes. Their verdicts are valid; they are just not about this.
      rejections.push({ caseRef: capture.caseRef, reason: 'case-digest-mismatch' });
      continue;
    }

    const reviews = envelope.reviews;
    const refs = new Set(reviews.map((review) => review.reviewRef));
    if (refs.size !== reviews.length) {
      // The same person twice. Counting it would satisfy the rule while defeating it.
      rejections.push({ caseRef: capture.caseRef, reason: 'duplicate-reviewer' });
      continue;
    }
    if (refs.size < RIYA_QUALITY_REQUIRED_HUMAN_REVIEWS) {
      rejections.push({ caseRef: capture.caseRef, reason: 'insufficient-independent-reviews' });
      continue;
    }

    try {
      observations.push(
        createRiyaQualityObservation({
          version: 1,
          scenarioId: capture.scenarioId,
          scenarioVersion: capture.scenarioVersion,
          languageMode: capture.languageMode,
          replyCharCount: capture.replyCharCount,
          questionCount: capture.questionCount,
          askedDiscoveryFields: [...capture.askedDiscoveryFields],
          observationBatch: {
            version: 1,
            observations: [...capture.observations],
            skipProjectDetails: capture.skipProjectDetails,
          },
          citations: capture.citations.map((one) => ({ ...one })),
          continuityPhaseAfter: capture.continuityPhaseAfter,
          // Rebuilt by the authority's own factory inside this constructor. A `comment`, a `name` or
          // an `email` is refused there, not stripped here.
          humanReviews: reviews.map((review) => ({ ...review })),
        }),
      );
    } catch {
      rejections.push({ caseRef: capture.caseRef, reason: 'review-schema-invalid' });
    }
  }

  if (rejections.length > 0) {
    return { ok: false, rejections: Object.freeze(rejections) };
  }
  return { ok: true, observations: Object.freeze(observations) };
}

/**
 * Ingest, then hand the observations to the quality authority.
 *
 * The suite, the thresholds and the verdict all belong to `@qf-jarvis/riya-quality-evaluation`; this
 * returns whatever it says, unchanged and unscored.
 */
export function evaluateRiyaQualityFromReviews(options: {
  readonly suite: RiyaQualitySuiteV1;
  readonly captures: readonly RiyaQualityCandidateCapture[];
  readonly caseReviews: readonly RiyaQualityCaseReviews[];
  readonly fixtures?: readonly RiyaQualityGoldenFixture[];
}): { readonly ok: true; readonly result: RiyaQualitySuiteResultV1 } | RiyaQualityIngestResult {
  const ingested = ingestRiyaQualityReviews({
    captures: options.captures,
    caseReviews: options.caseReviews,
    ...(options.fixtures === undefined ? {} : { fixtures: options.fixtures }),
  });
  if (!ingested.ok) {
    return ingested;
  }
  try {
    return { ok: true, result: evaluateRiyaQualitySuite(options.suite, ingested.observations) };
  } catch {
    throw new RiyaCandidateRunnerError('REVIEW_INVALID');
  }
}
