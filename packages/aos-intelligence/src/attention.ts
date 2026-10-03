import type { AosCase, AosPriority, AosRecommendation } from './contracts.js';

export const AOS_ATTENTION_LANES = ['NOW', 'SOON', 'DIGEST'] as const;
export type AosAttentionLane = (typeof AOS_ATTENTION_LANES)[number];

export interface AosAttentionInput {
  readonly case: AosCase;
  readonly recommendation?: AosRecommendation;
  readonly ageMinutes: number;
  readonly repeatedSignalCount: number;
}

export interface AosOwnerAttentionItem {
  readonly caseId: string;
  readonly priority: AosPriority;
  readonly lane: AosAttentionLane;
  readonly attentionScore: number;
  readonly reasonCodes: readonly string[];
  readonly requiresOwnerReview: boolean;
  readonly executionAuthority: 'NONE';
  readonly businessEffect: false;
}

const PRIORITY_SCORE: Readonly<Record<AosPriority, number>> = Object.freeze({
  P0: 70,
  P1: 50,
  P2: 28,
  P3: 10,
});

function lane(priority: AosPriority, score: number): AosAttentionLane {
  if (priority === 'P0' || score >= 70) return 'NOW';
  if (priority === 'P1' || score >= 35) return 'SOON';
  return 'DIGEST';
}

export function buildAosOwnerAttentionItem(input: AosAttentionInput): AosOwnerAttentionItem {
  if (
    !Number.isFinite(input.ageMinutes) ||
    input.ageMinutes < 0 ||
    !Number.isInteger(input.repeatedSignalCount) ||
    input.repeatedSignalCount < 0 ||
    input.repeatedSignalCount > 10_000
  ) {
    throw new TypeError('aos-attention-input-invalid');
  }

  const reasons: string[] = ['PRIORITY_' + input.case.priority];
  let score = PRIORITY_SCORE[input.case.priority];
  if (input.ageMinutes >= 60) {
    score += 12;
    reasons.push('AGE_OVER_60M');
  } else if (input.ageMinutes >= 20) {
    score += 6;
    reasons.push('AGE_OVER_20M');
  }
  if (input.repeatedSignalCount >= 3) {
    score += Math.min(12, input.repeatedSignalCount);
    reasons.push('REPEATED_SIGNALS');
  }
  if (input.recommendation?.requiresOwnerReview) {
    score += 12;
    reasons.push('OWNER_REVIEW_REQUIRED');
  }
  if (input.recommendation !== undefined && input.recommendation.confidence >= 0.9) {
    score += 4;
    reasons.push('HIGH_CONFIDENCE');
  }

  const bounded = Math.min(100, score);
  return Object.freeze({
    caseId: input.case.caseId,
    priority: input.case.priority,
    lane: lane(input.case.priority, bounded),
    attentionScore: bounded,
    reasonCodes: Object.freeze(reasons),
    requiresOwnerReview: input.recommendation?.requiresOwnerReview ?? false,
    executionAuthority: 'NONE' as const,
    businessEffect: false as const,
  });
}

export function rankAosOwnerAttention(
  inputs: readonly AosAttentionInput[],
): readonly AosOwnerAttentionItem[] {
  return Object.freeze(
    inputs
      .map(buildAosOwnerAttentionItem)
      .sort(
        (left, right) =>
          right.attentionScore - left.attentionScore || left.caseId.localeCompare(right.caseId),
      ),
  );
}
