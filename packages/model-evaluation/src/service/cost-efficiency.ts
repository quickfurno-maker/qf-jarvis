import type { EvaluationBinding } from '../contracts/binding.js';
import type { ApprovalEvidence } from '../contracts/evidence.js';

export interface VersionedModelPriceCard {
  readonly priceCardRef: string;
  readonly inputUsdPerMillionTokens: number;
  readonly outputUsdPerMillionTokens: number;
}

export interface EvaluatedCostCandidate {
  readonly candidateId: string;
  readonly evidence: ApprovalEvidence;
  /** Normalized 0..1 quality score from an owner-approved comparison rubric. */
  readonly qualityScore: number;
  readonly priceCard: VersionedModelPriceCard;
}

export interface ModelCostWorkload {
  readonly inputTokens: number;
  readonly outputTokens: number;
}

export interface CostSelectionOptions {
  readonly baselineEvaluationRef: string;
  readonly maxQualityDrop: number;
}

export type CostSelectionResult =
  | {
      readonly ok: true;
      readonly selected: EvaluatedCostCandidate;
      readonly baseline: EvaluatedCostCandidate;
      readonly selectedEstimatedUsd: number;
      readonly baselineEstimatedUsd: number;
      readonly estimatedSavingsUsd: number;
    }
  | {
      readonly ok: false;
      readonly reason:
        | 'invalid-input'
        | 'baseline-missing'
        | 'baseline-not-production-approved'
        | 'no-equivalent-qualified-candidate';
    };

function finiteNonNegative(value: number): boolean {
  return Number.isFinite(value) && value >= 0;
}

function validId(value: string): boolean {
  return /^[A-Za-z0-9._:-]{1,128}$/u.test(value);
}

function sameEvaluationContext(a: EvaluationBinding, b: EvaluationBinding): boolean {
  return (
    a.evaluationSuiteId === b.evaluationSuiteId &&
    a.evaluationSuiteVersion === b.evaluationSuiteVersion &&
    a.redTeamSuiteId === b.redTeamSuiteId &&
    a.redTeamSuiteVersion === b.redTeamSuiteVersion &&
    a.fixtureManifestId === b.fixtureManifestId &&
    a.fixtureManifestVersion === b.fixtureManifestVersion &&
    a.evaluatorImplId === b.evaluatorImplId &&
    a.evaluatorImplVersion === b.evaluatorImplVersion &&
    a.promptFamily === b.promptFamily &&
    a.promptVersion === b.promptVersion &&
    a.promptDigest === b.promptDigest &&
    a.capabilityProfileRef === b.capabilityProfileRef &&
    a.knowledgeRevision === b.knowledgeRevision &&
    a.policyContractRevision === b.policyContractRevision
  );
}

function productionApproved(evidence: ApprovalEvidence): boolean {
  return (
    evidence.target === 'ACTIVE_MODEL_RELEASE' &&
    evidence.productionApproval &&
    !evidence.synthetic
  );
}

export function estimateModelCostUsd(
  workload: ModelCostWorkload,
  priceCard: VersionedModelPriceCard,
): number {
  if (
    !Number.isInteger(workload.inputTokens) ||
    workload.inputTokens < 0 ||
    !Number.isInteger(workload.outputTokens) ||
    workload.outputTokens < 0 ||
    !validId(priceCard.priceCardRef) ||
    !finiteNonNegative(priceCard.inputUsdPerMillionTokens) ||
    !finiteNonNegative(priceCard.outputUsdPerMillionTokens)
  ) {
    throw new TypeError('model-cost-input-invalid');
  }
  return (
    (workload.inputTokens * priceCard.inputUsdPerMillionTokens +
      workload.outputTokens * priceCard.outputUsdPerMillionTokens) /
    1_000_000
  );
}

/**
 * Choose the cheapest candidate only among production-approved evaluations that were run under the
 * same suite, fixtures, prompt, capability profile, knowledge revision and policy as the baseline.
 *
 * This is an evidence/planning decision, not a serving mutation. The returned release still has to
 * be bound into a fresh production seal/composition before it can serve customer traffic.
 */
export function chooseCostEfficientQualifiedCandidate(
  candidates: readonly EvaluatedCostCandidate[],
  workload: ModelCostWorkload,
  options: CostSelectionOptions,
): CostSelectionResult {
  if (
    candidates.length < 1 ||
    candidates.length > 64 ||
    !validId(options.baselineEvaluationRef) ||
    !finiteNonNegative(options.maxQualityDrop) ||
    options.maxQualityDrop > 1
  ) {
    return { ok: false, reason: 'invalid-input' };
  }

  const ids = new Set<string>();
  for (const candidate of candidates) {
    if (
      !validId(candidate.candidateId) ||
      ids.has(candidate.candidateId) ||
      !finiteNonNegative(candidate.qualityScore) ||
      candidate.qualityScore > 1
    ) {
      return { ok: false, reason: 'invalid-input' };
    }
    ids.add(candidate.candidateId);
    try {
      estimateModelCostUsd(workload, candidate.priceCard);
    } catch {
      return { ok: false, reason: 'invalid-input' };
    }
  }

  const baseline = candidates.find(
    (candidate) => candidate.evidence.evaluationRef === options.baselineEvaluationRef,
  );
  if (baseline === undefined) return { ok: false, reason: 'baseline-missing' };
  if (!productionApproved(baseline.evidence)) {
    return { ok: false, reason: 'baseline-not-production-approved' };
  }

  const floor = Math.max(0, baseline.qualityScore - options.maxQualityDrop);
  const eligible = candidates.filter(
    (candidate) =>
      productionApproved(candidate.evidence) &&
      candidate.evidence.caseSetDigest === baseline.evidence.caseSetDigest &&
      sameEvaluationContext(candidate.evidence.binding, baseline.evidence.binding) &&
      candidate.qualityScore >= floor,
  );
  if (eligible.length === 0) {
    return { ok: false, reason: 'no-equivalent-qualified-candidate' };
  }

  const ranked = eligible
    .map((candidate) => ({
      candidate,
      cost: estimateModelCostUsd(workload, candidate.priceCard),
    }))
    .sort((a, b) => a.cost - b.cost || b.candidate.qualityScore - a.candidate.qualityScore || a.candidate.candidateId.localeCompare(b.candidate.candidateId));

  const selected = ranked[0];
  if (selected === undefined) return { ok: false, reason: 'no-equivalent-qualified-candidate' };
  const baselineCost = estimateModelCostUsd(workload, baseline.priceCard);
  return Object.freeze({
    ok: true as const,
    selected: selected.candidate,
    baseline,
    selectedEstimatedUsd: selected.cost,
    baselineEstimatedUsd: baselineCost,
    estimatedSavingsUsd: Math.max(0, baselineCost - selected.cost),
  });
}