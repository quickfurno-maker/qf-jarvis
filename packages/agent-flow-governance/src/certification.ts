import type {
  AgentFlowCertificationEvidence,
  AgentFlowLintReport,
  AgentFlowRegressionSummary,
  AgentFlowVersionManifest,
} from './contracts.js';

export function createAgentFlowCertification(input: {
  readonly manifest: AgentFlowVersionManifest;
  readonly lint: AgentFlowLintReport;
  readonly regression: AgentFlowRegressionSummary;
  readonly certifiedAt: string;
  readonly certifiedBy: AgentFlowCertificationEvidence['certifiedBy'];
}): AgentFlowCertificationEvidence {
  if (
    input.lint.errors !== 0 ||
    input.regression.failed !== 0 ||
    !input.regression.zeroEffectGuaranteed
  ) {
    throw new TypeError('agent-flow-certification-refused');
  }
  const certifiedMs = Date.parse(input.certifiedAt);
  if (!Number.isFinite(certifiedMs)) throw new TypeError('agent-flow-certification-invalid');

  return Object.freeze({
    lintReportRef: input.lint.reportId,
    regressionReportRef: input.regression.reportId,
    passedScenarioCount: input.regression.passed,
    failedScenarioCount: input.regression.failed,
    certifiedAt: input.certifiedAt,
    certifiedBy: input.certifiedBy,
    versionId: input.manifest.versionId,
    flowId: input.manifest.flowId,
    flowVersion: input.manifest.flowVersion,
    registryBaselineRef: input.manifest.registryBaselineRef,
    configurationDigest: input.manifest.configurationDigest,
    sourceRevision: input.manifest.sourceRevision,
    profileSet: Object.freeze({ ...input.manifest.profileSet }),
  });
}
