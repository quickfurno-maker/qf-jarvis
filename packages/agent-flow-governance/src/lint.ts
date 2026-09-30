import type { AgentFlowDefinition } from '@qf-jarvis/agent-flow-registry';

import type {
  AgentFlowLintIssue,
  AgentFlowLintReport,
  AgentFlowProfileDefinition,
  AgentFlowVersionManifest,
} from './contracts.js';

const UNSAFE_IMPLEMENTATION =
  /(?:arbitrary|unrestricted|direct[-_. ]?(?:sql|http|javascript|js))/iu;

function issue(
  severity: AgentFlowLintIssue['severity'],
  code: AgentFlowLintIssue['code'],
  subjectRef: string,
  message: string,
): AgentFlowLintIssue {
  return Object.freeze({ severity, code, subjectRef, message });
}

function profileRefs(manifest: AgentFlowVersionManifest): readonly string[] {
  return Object.freeze(
    [
      manifest.profileSet.contextProfileRef,
      manifest.profileSet.promptProfileRef,
      manifest.profileSet.modelRoutingProfileRef,
      manifest.profileSet.toolProfileRef,
      manifest.profileSet.waitPolicyRef,
      manifest.profileSet.retryPolicyRef,
      manifest.profileSet.handoffPolicyRef,
    ].filter((value): value is string => value !== undefined),
  );
}

export function lintAgentFlow(input: {
  readonly flow: AgentFlowDefinition;
  readonly manifest: AgentFlowVersionManifest;
  readonly profiles: readonly AgentFlowProfileDefinition[];
}): AgentFlowLintReport {
  const issues: AgentFlowLintIssue[] = [];

  const runtimeReadOnly: unknown = Reflect.get(input.flow, 'readOnly');
  if (runtimeReadOnly !== true) {
    issues.push(
      issue(
        'ERROR',
        'FLOW_NOT_READ_ONLY_BASELINE',
        input.flow.flowId,
        'Phase 2 requires a read-only registry baseline.',
      ),
    );
  }
  for (const node of input.flow.nodes) {
    const effectful = node.effect === 'GOVERNED_ACTION' || node.effect === 'CHANNEL_REQUEST';
    if (effectful && node.authority !== 'CORE_GOVERNED_ACTION') {
      issues.push(
        issue(
          'ERROR',
          'EFFECTFUL_NODE_WITHOUT_GOVERNED_AUTHORITY',
          node.nodeId,
          'Effectful nodes must remain behind the governed Core/Worker authority boundary.',
        ),
      );
    }
    if (UNSAFE_IMPLEMENTATION.test(node.implementationRef)) {
      issues.push(
        issue(
          'ERROR',
          'ARBITRARY_IMPLEMENTATION_SURFACE',
          node.nodeId,
          'Arbitrary JavaScript, SQL or unrestricted HTTP implementations are forbidden.',
        ),
      );
    }
    if (effectful && !node.canvasEditable.includes('timeoutPolicyRef')) {
      issues.push(
        issue(
          'WARNING',
          'MISSING_TIMEOUT_CONFIG',
          node.nodeId,
          'Effectful node has no canvas-selectable bounded timeout profile.',
        ),
      );
    }
    if (effectful && node.canvasEditable.includes('retryPolicyRef') && !node.codeLocked) {
      issues.push(
        issue(
          'ERROR',
          'UNSAFE_RETRY_CONFIG',
          node.nodeId,
          'Effectful retry controls require a code-locked capability implementation.',
        ),
      );
    }
  }
  const profileById = new Map(
    input.profiles.map((profile) => [profile.profileId, profile] as const),
  );
  for (const ref of profileRefs(input.manifest)) {
    const profile = profileById.get(ref);
    if (profile === undefined) {
      issues.push(
        issue(
          'ERROR',
          'UNKNOWN_PROFILE_REF',
          ref,
          'Version manifest references an unknown Agent Flow profile.',
        ),
      );
      continue;
    }
    if (profile.actor !== input.manifest.actor && profile.actor !== 'SHARED') {
      issues.push(
        issue(
          'ERROR',
          'PROFILE_ACTOR_MISMATCH',
          ref,
          'Profile actor does not match the flow manifest actor.',
        ),
      );
    }
    if (input.manifest.lifecycle === 'LIVE' && !profile.productionEligible) {
      issues.push(
        issue(
          'ERROR',
          'PROFILE_NOT_PRODUCTION_ELIGIBLE',
          ref,
          'LIVE cannot reference a profile that is reserved for a later activation phase.',
        ),
      );
    }
  }

  if (input.manifest.profileSet.handoffPolicyRef === undefined) {
    issues.push(
      issue(
        'WARNING',
        'MISSING_HUMAN_ESCALATION',
        input.manifest.versionId,
        'No approved human handoff profile is declared for this version.',
      ),
    );
  }

  if (input.manifest.lifecycle === 'LIVE') {
    if (input.manifest.certification === undefined) {
      issues.push(
        issue(
          'ERROR',
          'LIVE_WITHOUT_CERTIFICATION',
          input.manifest.versionId,
          'LIVE requires certification evidence.',
        ),
      );
    } else if (input.manifest.certification.failedScenarioCount !== 0) {
      issues.push(
        issue(
          'ERROR',
          'LIVE_WITH_REGRESSION_FAILURE',
          input.manifest.versionId,
          'LIVE cannot carry failed protected regression scenarios.',
        ),
      );
    }
    if (input.manifest.rollbackTargetVersionId === undefined) {
      issues.push(
        issue(
          'ERROR',
          'LIVE_WITHOUT_ROLLBACK_TARGET',
          input.manifest.versionId,
          'LIVE requires an explicit rollback target.',
        ),
      );
    }
  }

  const errors = issues.filter((item) => item.severity === 'ERROR').length;
  const warnings = issues.length - errors;
  return Object.freeze({
    reportId: `lint:${input.manifest.versionId}`,
    flowId: input.flow.flowId,
    flowVersion: input.flow.flowVersion,
    errors,
    warnings,
    issues: Object.freeze(issues),
    promotable: errors === 0,
  });
}
