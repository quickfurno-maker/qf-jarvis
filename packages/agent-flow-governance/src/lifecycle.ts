import type {
  AgentFlowLifecycleStage,
  AgentFlowPromotionDecision,
  AgentFlowVersionDiff,
  AgentFlowVersionManifest,
} from './contracts.js';

const NEXT_STAGE: Readonly<Record<AgentFlowLifecycleStage, AgentFlowLifecycleStage | undefined>> =
  Object.freeze({
    DRAFT: 'SIMULATION',
    SIMULATION: 'TEST',
    TEST: 'STAGING',
    STAGING: 'LIVE',
    LIVE: 'RETIRED',
    RETIRED: undefined,
  });

function certificationReady(manifest: AgentFlowVersionManifest): readonly string[] {
  const reasons: string[] = [];
  const certification = manifest.certification;
  if (certification === undefined) {
    reasons.push('certification-missing');
    return reasons;
  }
  if (certification.failedScenarioCount !== 0) reasons.push('regression-failures-present');
  if (certification.passedScenarioCount <= 0) reasons.push('no-regression-scenarios-passed');
  if (manifest.rollbackTargetVersionId === undefined) reasons.push('rollback-target-missing');
  return Object.freeze(reasons);
}

export function evaluateAgentFlowPromotion(
  manifest: AgentFlowVersionManifest,
  target: AgentFlowLifecycleStage,
): AgentFlowPromotionDecision {
  const reasons: string[] = [];
  if (NEXT_STAGE[manifest.lifecycle] !== target) {
    reasons.push('lifecycle-transition-not-sequential');
  }
  if (target === 'LIVE') reasons.push(...certificationReady(manifest));
  if (target === 'RETIRED' && manifest.lifecycle !== 'LIVE') {
    reasons.push('only-live-version-can-retire');
  }
  return Object.freeze({
    allowed: reasons.length === 0,
    from: manifest.lifecycle,
    to: target,
    reasons: Object.freeze(reasons),
  });
}
export function promoteAgentFlowManifest(
  manifest: AgentFlowVersionManifest,
  target: AgentFlowLifecycleStage,
): AgentFlowVersionManifest {
  const decision = evaluateAgentFlowPromotion(manifest, target);
  if (!decision.allowed) throw new TypeError('agent-flow-promotion-refused');
  return Object.freeze({ ...manifest, lifecycle: target });
}

function addDiff(
  changes: AgentFlowVersionDiff['changes'] extends readonly (infer T)[] ? T[] : never,
  field: string,
  before: string | number | undefined,
  after: string | number | undefined,
): void {
  if (before !== after) changes.push(Object.freeze({ field, before, after }));
}

export function compareAgentFlowVersions(
  before: AgentFlowVersionManifest,
  after: AgentFlowVersionManifest,
): AgentFlowVersionDiff {
  const changes: {
    readonly field: string;
    readonly before: string | number | undefined;
    readonly after: string | number | undefined;
  }[] = [];

  addDiff(changes, 'flowVersion', before.flowVersion, after.flowVersion);
  addDiff(changes, 'lifecycle', before.lifecycle, after.lifecycle);
  addDiff(changes, 'registryBaselineRef', before.registryBaselineRef, after.registryBaselineRef);
  addDiff(changes, 'configurationDigest', before.configurationDigest, after.configurationDigest);
  addDiff(changes, 'contextProfileRef', before.profileSet.contextProfileRef, after.profileSet.contextProfileRef);
  addDiff(changes, 'promptProfileRef', before.profileSet.promptProfileRef, after.profileSet.promptProfileRef);
  addDiff(changes, 'modelRoutingProfileRef', before.profileSet.modelRoutingProfileRef, after.profileSet.modelRoutingProfileRef);
  addDiff(changes, 'toolProfileRef', before.profileSet.toolProfileRef, after.profileSet.toolProfileRef);
  addDiff(changes, 'waitPolicyRef', before.profileSet.waitPolicyRef, after.profileSet.waitPolicyRef);
  addDiff(changes, 'retryPolicyRef', before.profileSet.retryPolicyRef, after.profileSet.retryPolicyRef);
  addDiff(changes, 'handoffPolicyRef', before.profileSet.handoffPolicyRef, after.profileSet.handoffPolicyRef);
  addDiff(
    changes,
    'rollbackTargetVersionId',
    before.rollbackTargetVersionId,
    after.rollbackTargetVersionId,
  );

  return Object.freeze({
    fromVersionId: before.versionId,
    toVersionId: after.versionId,
    changed: changes.length > 0,
    changes: Object.freeze(changes),
  });
}

export function selectRollbackTarget(input: {
  readonly live: AgentFlowVersionManifest;
  readonly candidates: readonly AgentFlowVersionManifest[];
}): AgentFlowVersionManifest {
  if (input.live.lifecycle !== 'LIVE' || input.live.rollbackTargetVersionId === undefined) {
    throw new TypeError('agent-flow-rollback-target-invalid');
  }
  const target = input.candidates.find(
    (candidate) => candidate.versionId === input.live.rollbackTargetVersionId,
  );
  if (target === undefined) {
    throw new TypeError('agent-flow-rollback-target-invalid');
  }
  if (
    target.flowId !== input.live.flowId ||
    (target.lifecycle !== 'LIVE' && target.lifecycle !== 'RETIRED')
  ) {
    throw new TypeError('agent-flow-rollback-target-invalid');
  }
  return target;
}
