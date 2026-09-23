const REF = /^[A-Za-z0-9._:-]{1,128}$/u;

export const JAO_ACTION_RISK_CLASSES = Object.freeze(['READ_ONLY', 'LOW', 'MEDIUM', 'HIGH'] as const);
export type JaoActionRiskClass = (typeof JAO_ACTION_RISK_CLASSES)[number];

export const JAO_ACTION_EFFECT_CLASSES = Object.freeze([
  'READ_ONLY',
  'CORE_PROPOSAL',
  'TEMPORAL_REQUEST',
] as const);
export type JaoActionEffectClass = (typeof JAO_ACTION_EFFECT_CLASSES)[number];

export interface JaoActionDefinition {
  readonly actionId: string;
  readonly actionVersion: number;
  readonly riskClass: JaoActionRiskClass;
  readonly effectClass: JaoActionEffectClass;
  readonly allowedAgentScopes: readonly ('RIYA' | 'ANISHA' | 'AAROHI')[];
  readonly requiredAuthorityRef: string;
  readonly approvalPolicyRef: string;
  readonly idempotencyPolicyRef: string;
  readonly rollbackPolicyRef: string;
  readonly enabled: boolean;
}

export interface JaoActionRegistry {
  readonly registryRef: string;
  readonly actions: readonly JaoActionDefinition[];
}

export const JAO_ACTION_PROPOSAL_DECISIONS = Object.freeze([
  'ACTION_UNKNOWN',
  'ACTION_DISABLED',
  'AGENT_SCOPE_DENIED',
  'MATURITY_REVIEW_REQUIRED',
  'AUTHORITY_EVIDENCE_MISSING',
  'APPROVAL_EVIDENCE_MISSING',
  'ELIGIBLE_FOR_PROPOSAL',
] as const);

export type JaoActionProposalDecision = (typeof JAO_ACTION_PROPOSAL_DECISIONS)[number];

export interface JaoActionProposalAssessment {
  readonly actionId: string;
  readonly decision: JaoActionProposalDecision;
  readonly registryRef: string;
}

function validateAction(action: JaoActionDefinition): void {
  if (
    !REF.test(action.actionId) ||
    !Number.isInteger(action.actionVersion) ||
    action.actionVersion < 1 ||
    action.actionVersion > 1_000_000 ||
    !JAO_ACTION_RISK_CLASSES.includes(action.riskClass) ||
    !JAO_ACTION_EFFECT_CLASSES.includes(action.effectClass) ||
    action.allowedAgentScopes.length < 1 ||
    new Set(action.allowedAgentScopes).size !== action.allowedAgentScopes.length ||
    !REF.test(action.requiredAuthorityRef) ||
    !REF.test(action.approvalPolicyRef) ||
    !REF.test(action.idempotencyPolicyRef) ||
    !REF.test(action.rollbackPolicyRef)
  ) {
    throw new TypeError('jao-action-definition-invalid');
  }
}

export function createJaoActionRegistry(input: {
  readonly registryRef: string;
  readonly actions: readonly JaoActionDefinition[];
}): JaoActionRegistry {
  if (!REF.test(input.registryRef)) throw new TypeError('jao-action-registry-invalid');
  const keys = new Set<string>();
  for (const action of input.actions) {
    validateAction(action);
    const key = action.actionId + '@' + String(action.actionVersion);
    if (keys.has(key)) throw new TypeError('jao-action-registry-duplicate');
    keys.add(key);
  }
  return Object.freeze({
    registryRef: input.registryRef,
    actions: Object.freeze(input.actions.map((action) => Object.freeze({ ...action }))),
  });
}

/**
 * This is a PROPOSAL gate only. ELIGIBLE_FOR_PROPOSAL never means executable, authorized or sent.
 * Execution remains downstream of the real Core/approval/Temporal boundary.
 */
export function assessJaoActionProposal(input: {
  readonly registry: JaoActionRegistry;
  readonly actionId: string;
  readonly actionVersion: number;
  readonly agentScope: 'RIYA' | 'ANISHA' | 'AAROHI';
  readonly maturityDecision:
    | 'KEEP_DEFAULT_OFF'
    | 'SHADOW_EVIDENCE_SUFFICIENT'
    | 'BOUNDED_AUTONOMY_REVIEW_ELIGIBLE';
  readonly authorityEvidenceRef?: string;
  readonly approvalEvidenceRef?: string;
}): JaoActionProposalAssessment {
  const action = input.registry.actions.find(
    (one) => one.actionId === input.actionId && one.actionVersion === input.actionVersion,
  );

  const base = { actionId: input.actionId, registryRef: input.registry.registryRef };
  if (action === undefined) return Object.freeze({ ...base, decision: 'ACTION_UNKNOWN' as const });
  if (!action.enabled) return Object.freeze({ ...base, decision: 'ACTION_DISABLED' as const });
  if (!action.allowedAgentScopes.includes(input.agentScope)) {
    return Object.freeze({ ...base, decision: 'AGENT_SCOPE_DENIED' as const });
  }
  if (input.maturityDecision !== 'BOUNDED_AUTONOMY_REVIEW_ELIGIBLE') {
    return Object.freeze({ ...base, decision: 'MATURITY_REVIEW_REQUIRED' as const });
  }
  if (
    input.authorityEvidenceRef === undefined ||
    !REF.test(input.authorityEvidenceRef)
  ) {
    return Object.freeze({ ...base, decision: 'AUTHORITY_EVIDENCE_MISSING' as const });
  }
  if (
    input.approvalEvidenceRef === undefined ||
    !REF.test(input.approvalEvidenceRef)
  ) {
    return Object.freeze({ ...base, decision: 'APPROVAL_EVIDENCE_MISSING' as const });
  }
  return Object.freeze({ ...base, decision: 'ELIGIBLE_FOR_PROPOSAL' as const });
}

export const JAO_ENGINEERING_REGISTRY_V1 = createJaoActionRegistry({
  registryRef: 'qfj.jao-action-registry.engineering.v1',
  actions: [
    {
      actionId: 'schedule_callback',
      actionVersion: 1,
      riskClass: 'LOW',
      effectClass: 'CORE_PROPOSAL',
      allowedAgentScopes: ['RIYA', 'ANISHA', 'AAROHI'],
      requiredAuthorityRef: 'authority.quickfurno.core',
      approvalPolicyRef: 'approval.schedule-callback.v1',
      idempotencyPolicyRef: 'idempotency.logical-action.v1',
      rollbackPolicyRef: 'rollback.cancel-before-dispatch.v1',
      enabled: false,
    },
    {
      actionId: 'request_human_takeover',
      actionVersion: 1,
      riskClass: 'LOW',
      effectClass: 'CORE_PROPOSAL',
      allowedAgentScopes: ['RIYA', 'ANISHA', 'AAROHI'],
      requiredAuthorityRef: 'authority.quickfurno.core',
      approvalPolicyRef: 'approval.human-takeover.v1',
      idempotencyPolicyRef: 'idempotency.logical-action.v1',
      rollbackPolicyRef: 'rollback.release-human-takeover.v1',
      enabled: false,
    },
    {
      actionId: 'start_governed_followup',
      actionVersion: 1,
      riskClass: 'MEDIUM',
      effectClass: 'TEMPORAL_REQUEST',
      allowedAgentScopes: ['RIYA', 'ANISHA', 'AAROHI'],
      requiredAuthorityRef: 'authority.quickfurno.core',
      approvalPolicyRef: 'approval.temporal-followup.v1',
      idempotencyPolicyRef: 'idempotency.temporal-workflow.v1',
      rollbackPolicyRef: 'rollback.cancel-temporal-workflow.v1',
      enabled: false,
    },
  ],
});
