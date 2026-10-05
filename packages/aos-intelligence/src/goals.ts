export const AOS_BUSINESS_GOALS = [
  'TRUST_AND_SATISFACTION',
  'SUCCESSFUL_LEAD_DELIVERY',
  'RETENTION',
  'RELEVANT_EXPANSION',
  'REVENUE',
] as const;
export type AosBusinessGoal = (typeof AOS_BUSINESS_GOALS)[number];

export const AOS_GOAL_PRECEDENCE: Readonly<Record<AosBusinessGoal, number>> = Object.freeze({
  TRUST_AND_SATISFACTION: 0,
  SUCCESSFUL_LEAD_DELIVERY: 1,
  RETENTION: 2,
  RELEVANT_EXPANSION: 3,
  REVENUE: 4,
});

export interface AosGoalCandidate {
  readonly goal: AosBusinessGoal;
  readonly score: number;
  readonly trustRisk: boolean;
  readonly relevant: boolean;
}

export function chooseAosGoal(candidates: readonly AosGoalCandidate[]): AosBusinessGoal | 'NONE' {
  const eligible = candidates
    .filter(
      (candidate) =>
        Number.isFinite(candidate.score) &&
        candidate.score >= 0 &&
        candidate.score <= 1 &&
        candidate.relevant &&
        !candidate.trustRisk,
    )
    .sort(
      (left, right) =>
        AOS_GOAL_PRECEDENCE[left.goal] - AOS_GOAL_PRECEDENCE[right.goal] ||
        right.score - left.score,
    );
  return eligible[0]?.goal ?? 'NONE';
}
