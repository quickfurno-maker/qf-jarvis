import { RIYA_WHATSAPP_CLIENT_FLOW_V1 } from '@qf-jarvis/agent-flow-registry';

import type { AgentFlowVersionManifest } from './contracts.js';
import { RIYA_PHASE2_PROFILE_SET_V1 } from './profiles.js';

const DIGEST = /^sha256:[0-9a-f]{64}$/u;
const REF = /^[A-Za-z0-9._:@/-]{1,200}$/u;

export function createAgentFlowVersionManifest(
  input: AgentFlowVersionManifest,
): AgentFlowVersionManifest {
  if (
    !REF.test(input.versionId) ||
    !REF.test(input.flowId) ||
    !Number.isInteger(input.flowVersion) ||
    input.flowVersion <= 0 ||
    !REF.test(input.registryBaselineRef) ||
    !DIGEST.test(input.configurationDigest) ||
    input.notes.length > 2_000
  ) {
    throw new TypeError('agent-flow-version-manifest-invalid');
  }
  if (input.certification !== undefined) {
    if (
      input.certification.passedScenarioCount < 0 ||
      input.certification.failedScenarioCount < 0 ||
      !REF.test(input.certification.lintReportRef) ||
      !REF.test(input.certification.regressionReportRef)
    ) {
      throw new TypeError('agent-flow-version-manifest-invalid');
    }
  }
  return Object.freeze({
    ...input,
    profileSet: Object.freeze({ ...input.profileSet }),
    ...(input.certification === undefined
      ? {}
      : { certification: Object.freeze({ ...input.certification }) }),
  });
}
export const RIYA_PHASE2_DRAFT_MANIFEST_V2 = createAgentFlowVersionManifest({
  versionId: 'riya-flow-config.v2.phase2-draft',
  flowId: RIYA_WHATSAPP_CLIENT_FLOW_V1.flowId,
  flowVersion: RIYA_WHATSAPP_CLIENT_FLOW_V1.flowVersion,
  actor: 'RIYA',
  lifecycle: 'DRAFT',
  registryBaselineRef: RIYA_WHATSAPP_CLIENT_FLOW_V1.implementationBaselineRef,
  profileSet: RIYA_PHASE2_PROFILE_SET_V1,
  configurationDigest:
    'sha256:c08152d96f6dd3dabfa15477fd2da6fe679706fc3f9135eeaf4d3a3ddb24c2de',
  createdAt: '2026-09-30T10:40:00.000Z',
  notes:
    'Phase 2 configuration manifest. It is reviewable and testable but not production-active; wait/retry/handoff profiles remain activation-locked until controlled orchestration.',
});
