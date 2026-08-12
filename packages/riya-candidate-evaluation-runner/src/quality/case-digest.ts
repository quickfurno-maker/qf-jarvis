/**
 * The REVIEW-CASE digest — what binds a human judgement to the reply it was made about.
 *
 * ### The failure this closes
 *
 * A review used to be addressed by position alone: `case-001`. Two humans read Candidate A's reply for
 * `case-001` and marked its dimensions satisfied. Those review records are valid, and nothing stopped
 * them being submitted later alongside Candidate B's captures — where `case-001` is a different, worse
 * reply. Ingest matched on the reference, the authority built an observation, and a model would have
 * been certified on judgements made about a model nobody was evaluating.
 *
 * So a review now names the exact bytes it was made about. If the reply changes by one character, the
 * digest changes and the old reviews stop applying.
 *
 * ### What it is, and firmly is not
 *
 * CONTENT IDENTITY. It proves the reviewed case and the ingested case are the same text. It proves
 * nothing about WHO reviewed, whether they were independent, whether they were human, or whether the
 * bundle is authentic — there is no key, no signature and no HMAC here, and adding one would imply a
 * guarantee this cannot make. Reviewer independence stays where it belongs: two distinct opaque refs,
 * and named people accountable for them.
 *
 * ### The canonical input, exactly
 *
 * A fixed literal object, in this key order, `JSON.stringify`d as UTF-8 and hashed with SHA-256,
 * lowercase hex:
 *
 * ```
 * { domain, bundleVersion, caseRef, languageMode, interactionKind,
 *   clientMessage, candidateReply, requiredDimensions }
 * ```
 *
 * `domain` is a fixed string so a digest computed here can never collide with one computed for another
 * purpose. `requiredDimensions` is sorted, because it is a SET the reviewer is shown — two orderings
 * are the same rubric, and an unsorted list would make an identical case digest differently.
 *
 * It covers exactly the reviewer-visible surface and nothing else. No provider, model, release, price,
 * speed or benchmark value is an input, so the digest cannot leak identity and cannot unblind anyone
 * who reads it.
 */
import { createHash } from 'node:crypto';

import type {
  RiyaQualityDimension,
  RiyaQualityInteractionKind,
  RiyaQualityLanguageMode,
} from '@qf-jarvis/riya-quality-evaluation';

/** Fixed domain separator. Bump only alongside a review-bundle version change. */
export const RIYA_REVIEW_CASE_DIGEST_DOMAIN = 'qfj.riya.p10.review-case.v1';

/** Exactly the reviewer-visible surface the digest covers. */
export interface RiyaReviewCaseDigestInput {
  readonly bundleVersion: number;
  readonly caseRef: string;
  readonly languageMode: RiyaQualityLanguageMode;
  readonly interactionKind: RiyaQualityInteractionKind;
  readonly clientMessage: string;
  readonly candidateReply: string;
  readonly requiredDimensions: readonly RiyaQualityDimension[];
}

/** SHA-256 of the canonical form above, lowercase hex. Deterministic for identical input. */
export function riyaReviewCaseDigest(input: RiyaReviewCaseDigestInput): string {
  const canonical = {
    domain: RIYA_REVIEW_CASE_DIGEST_DOMAIN,
    bundleVersion: input.bundleVersion,
    caseRef: input.caseRef,
    languageMode: input.languageMode,
    interactionKind: input.interactionKind,
    clientMessage: input.clientMessage,
    candidateReply: input.candidateReply,
    requiredDimensions: [...input.requiredDimensions].sort(),
  };
  return createHash('sha256').update(JSON.stringify(canonical), 'utf8').digest('hex');
}
