import { releaseKey, type EvaluationBinding } from '../contracts/binding.js';

export const EVALUATION_IMPACT_DIMENSIONS = Object.freeze([
  'EVALUATION_SUITE',
  'RED_TEAM_SUITE',
  'FIXTURE_MANIFEST',
  'EVALUATOR',
  'MODEL_RELEASE',
  'PROMPT',
  'CAPABILITY_PROFILE',
  'KNOWLEDGE',
  'POLICY',
] as const);

export type EvaluationImpactDimension = (typeof EVALUATION_IMPACT_DIMENSIONS)[number];

export interface EvaluationImpactReport {
  readonly requiresReevaluation: boolean;
  readonly changedDimensions: readonly EvaluationImpactDimension[];
}

function changed(
  dimensions: EvaluationImpactDimension[],
  condition: boolean,
  dimension: EvaluationImpactDimension,
): void {
  if (condition) dimensions.push(dimension);
}

/**
 * Classify whether a governed evaluation binding changed in any quality- or safety-bearing identity.
 *
 * createdAt is intentionally ignored: time passing does not itself change the thing evaluated.
 * Every prompt/model/knowledge/policy identity change is a hard re-evaluation trigger.
 */
export function classifyEvaluationImpact(
  previous: EvaluationBinding,
  next: EvaluationBinding,
): EvaluationImpactReport {
  const dimensions: EvaluationImpactDimension[] = [];

  changed(
    dimensions,
    previous.evaluationSuiteId !== next.evaluationSuiteId ||
      previous.evaluationSuiteVersion !== next.evaluationSuiteVersion,
    'EVALUATION_SUITE',
  );
  changed(
    dimensions,
    previous.redTeamSuiteId !== next.redTeamSuiteId ||
      previous.redTeamSuiteVersion !== next.redTeamSuiteVersion,
    'RED_TEAM_SUITE',
  );
  changed(
    dimensions,
    previous.fixtureManifestId !== next.fixtureManifestId ||
      previous.fixtureManifestVersion !== next.fixtureManifestVersion,
    'FIXTURE_MANIFEST',
  );
  changed(
    dimensions,
    previous.evaluatorImplId !== next.evaluatorImplId ||
      previous.evaluatorImplVersion !== next.evaluatorImplVersion,
    'EVALUATOR',
  );
  changed(dimensions, releaseKey(previous.release) !== releaseKey(next.release), 'MODEL_RELEASE');
  changed(
    dimensions,
    previous.promptFamily !== next.promptFamily ||
      previous.promptVersion !== next.promptVersion ||
      previous.promptDigest !== next.promptDigest,
    'PROMPT',
  );
  changed(
    dimensions,
    previous.capabilityProfileRef !== next.capabilityProfileRef,
    'CAPABILITY_PROFILE',
  );
  changed(dimensions, previous.knowledgeRevision !== next.knowledgeRevision, 'KNOWLEDGE');
  changed(
    dimensions,
    previous.policyContractRevision !== next.policyContractRevision,
    'POLICY',
  );

  return Object.freeze({
    requiresReevaluation: dimensions.length > 0,
    changedDimensions: Object.freeze(dimensions),
  });
}