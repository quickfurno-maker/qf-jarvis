import { describe, expect, it } from 'vitest';

import { RIYA_WHATSAPP_CLIENT_FLOW_V1 } from '@qf-jarvis/agent-flow-registry';
import {
  AGENT_FLOW_TRACE_PROTOCOL,
  AGENT_FLOW_TRACE_SNAPSHOT_PROTOCOL,
  parseAgentFlowTraceSnapshot,
} from '@qf-jarvis/agent-flow-trace-contract';

import {
  RIYA_AGENT_FLOW_PROFILES_V1,
  RIYA_CLIENT_INTELLIGENCE_REGRESSION_CANDIDATE_REF,
  RIYA_PHASE2_DRAFT_MANIFEST_V2,
  RIYA_PHASE2_REGRESSION_SCENARIOS,
  createRiyaClientIntelligenceRegressionCandidate,
  buildAgentFlowReplayHistory,
  compareAgentFlowVersions,
  createAgentFlowCertification,
  createAgentFlowVersionManifest,
  evaluateAgentFlowPromotion,
  lintAgentFlow,
  promoteAgentFlowManifest,
  runRiyaAgentFlowRegression,
  selectRollbackTarget,
} from '../index.js';

function event(input: {
  readonly sequence: number;
  readonly kind: 'RUN_STARTED' | 'NODE_ENTERED' | 'NODE_OBSERVED' | 'NODE_EXITED' | 'RUN_COMPLETED';
  readonly status: 'RUNNING' | 'OBSERVED' | 'SUCCEEDED';
  readonly at: string;
  readonly nodeId?: string;
  readonly resultCode?: string;
}) {
  return {
    protocol: AGENT_FLOW_TRACE_PROTOCOL,
    traceId: 'trace-1',
    flowId: RIYA_WHATSAPP_CLIENT_FLOW_V1.flowId,
    flowVersion: 1,
    actor: 'RIYA' as const,
    conversationId: 'conversation-1',
    inboundMessageId: 'message-1',
    sequence: input.sequence,
    kind: input.kind,
    ...(input.nodeId === undefined ? {} : { nodeId: input.nodeId }),
    status: input.status,
    at: input.at,
    ...(input.resultCode === undefined ? {} : { resultCode: input.resultCode }),
  };
}
describe('agent-flow Phase 2 governance', () => {
  it('replays historical traces without executing anything', () => {
    const snapshot = parseAgentFlowTraceSnapshot({
      protocol: AGENT_FLOW_TRACE_SNAPSHOT_PROTOCOL,
      emittedAt: '2026-09-30T10:00:01.000Z',
      sourceRevision: 'b1571cb1fc35689a23d48a49486af2b5f8ce9d7e',
      events: [
        event({
          sequence: 0,
          kind: 'RUN_STARTED',
          status: 'RUNNING',
          at: '2026-09-30T10:00:00.000Z',
        }),
        event({
          sequence: 1,
          kind: 'NODE_ENTERED',
          status: 'RUNNING',
          at: '2026-09-30T10:00:00.100Z',
          nodeId: 'riya.agent.specialist-runtime',
        }),
        event({
          sequence: 2,
          kind: 'NODE_OBSERVED',
          status: 'OBSERVED',
          at: '2026-09-30T10:00:00.200Z',
          nodeId: 'riya.agent.specialist-runtime',
          resultCode: 'model-route:SIMPLE:release.fast',
        }),
        event({
          sequence: 3,
          kind: 'NODE_EXITED',
          status: 'SUCCEEDED',
          at: '2026-09-30T10:00:00.350Z',
          nodeId: 'riya.agent.specialist-runtime',
          resultCode: 'proposal',
        }),
        event({
          sequence: 4,
          kind: 'RUN_COMPLETED',
          status: 'SUCCEEDED',
          at: '2026-09-30T10:00:00.500Z',
          resultCode: 'completed-queued',
        }),
      ],
    });

    const history = buildAgentFlowReplayHistory(snapshot);
    expect(history).toHaveLength(1);
    expect(history[0]?.durationMs).toBe(500);
    expect(history[0]?.nodes[0]?.durationMs).toBe(250);
    expect(history[0]?.nodes[0]?.observations).toContain('model-route:SIMPLE:release.fast');
    expect(history[0]?.outcome).toBe('completed-queued');
  });
  it('lints the current draft against the approved profile catalog', () => {
    const report = lintAgentFlow({
      flow: RIYA_WHATSAPP_CLIENT_FLOW_V1,
      manifest: RIYA_PHASE2_DRAFT_MANIFEST_V2,
      profiles: RIYA_AGENT_FLOW_PROFILES_V1,
    });
    expect(report.errors).toBe(0);
    expect(report.promotable).toBe(true);
  });

  it('enforces sequential lifecycle promotion and refuses uncertified live', () => {
    const toSimulation = evaluateAgentFlowPromotion(RIYA_PHASE2_DRAFT_MANIFEST_V2, 'SIMULATION');
    expect(toSimulation.allowed).toBe(true);
    const simulation = promoteAgentFlowManifest(RIYA_PHASE2_DRAFT_MANIFEST_V2, 'SIMULATION');
    expect(evaluateAgentFlowPromotion(simulation, 'LIVE').allowed).toBe(false);
  });

  it('produces explicit version diffs', () => {
    const simulation = promoteAgentFlowManifest(RIYA_PHASE2_DRAFT_MANIFEST_V2, 'SIMULATION');
    const diff = compareAgentFlowVersions(RIYA_PHASE2_DRAFT_MANIFEST_V2, simulation);
    expect(diff.changed).toBe(true);
    expect(diff.changes.some((change) => change.field === 'lifecycle')).toBe(true);
  });

  it('requires clean certification bound to the exact STAGING release before LIVE', () => {
    const stagingCandidate = createAgentFlowVersionManifest({
      ...RIYA_PHASE2_DRAFT_MANIFEST_V2,
      versionId: 'riya-flow-config.v2.staging',
      lifecycle: 'STAGING',
      rollbackTargetVersionId: 'riya-flow-config.v1.live',
    });
    const certification = createAgentFlowCertification({
      manifest: stagingCandidate,
      lint: {
        reportId: 'lint:riya.staging.v1',
        flowId: RIYA_WHATSAPP_CLIENT_FLOW_V1.flowId,
        flowVersion: 1,
        errors: 0,
        warnings: 0,
        issues: [],
        promotable: true,
      },
      regression: {
        reportId: 'regression:riya.staging.v1',
        protocol: 'qfj.agent-flow-regression.v1',
        candidateRef: RIYA_CLIENT_INTELLIGENCE_REGRESSION_CANDIDATE_REF,
        scenarioCount: 16,
        passed: 16,
        failed: 0,
        zeroEffectGuaranteed: true,
        failedScenarioIds: [],
      },
      certifiedAt: '2026-09-30T10:45:00.000Z',
      certifiedBy: 'REPOSITORY_TESTS',
    });
    const staging = createAgentFlowVersionManifest({
      ...stagingCandidate,
      certification,
    });
    expect(evaluateAgentFlowPromotion(staging, 'LIVE').allowed).toBe(true);

    const changedAfterCertification = createAgentFlowVersionManifest({
      ...staging,
      configurationDigest:
        'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    });
    const changedDecision = evaluateAgentFlowPromotion(changedAfterCertification, 'LIVE');
    expect(changedDecision.allowed).toBe(false);
    expect(changedDecision.reasons).toContain('certification-binding-mismatch');
  });

  it('selects only an explicit same-flow LIVE or RETIRED rollback target', () => {
    const previous = createAgentFlowVersionManifest({
      ...RIYA_PHASE2_DRAFT_MANIFEST_V2,
      versionId: 'riya-flow-config.v1.live',
      lifecycle: 'RETIRED',
    });
    const live = createAgentFlowVersionManifest({
      ...RIYA_PHASE2_DRAFT_MANIFEST_V2,
      versionId: 'riya-flow-config.v2.live',
      lifecycle: 'LIVE',
      rollbackTargetVersionId: previous.versionId,
    });
    expect(selectRollbackTarget({ live, candidates: [previous] }).versionId).toBe(
      previous.versionId,
    );
  });

  it('keeps Phase 3 orchestration profiles activation-locked from LIVE in Phase 2', () => {
    const liveCandidate = createAgentFlowVersionManifest({
      ...RIYA_PHASE2_DRAFT_MANIFEST_V2,
      versionId: 'riya-flow-config.v2.live-candidate',
      lifecycle: 'LIVE',
      rollbackTargetVersionId: 'riya-flow-config.v1.live',
    });
    const report = lintAgentFlow({
      flow: RIYA_WHATSAPP_CLIENT_FLOW_V1,
      manifest: liveCandidate,
      profiles: RIYA_AGENT_FLOW_PROFILES_V1,
    });
    expect(
      report.issues.filter((issue) => issue.code === 'PROFILE_NOT_PRODUCTION_ELIGIBLE'),
    ).toHaveLength(3);
    expect(report.promotable).toBe(false);
  });
  it('ships the required protected Riya regression library', () => {
    expect(RIYA_PHASE2_REGRESSION_SCENARIOS).toHaveLength(16);
    expect(RIYA_PHASE2_REGRESSION_SCENARIOS.map((item) => item.scenarioId)).toContain(
      'riya.core-timeout',
    );
    expect(RIYA_PHASE2_REGRESSION_SCENARIOS.map((item) => item.scenarioId)).toContain(
      'riya.human-takeover',
    );
  });

  it('runs all Riya scenarios through the real deterministic client-intelligence planner', async () => {
    const summary = await runRiyaAgentFlowRegression({
      reportId: 'regression:riya.phase2.client-intelligence',
      candidateRef: RIYA_CLIENT_INTELLIGENCE_REGRESSION_CANDIDATE_REF,
      candidate: createRiyaClientIntelligenceRegressionCandidate(),
    });
    expect(summary.candidateRef).toBe(RIYA_CLIENT_INTELLIGENCE_REGRESSION_CANDIDATE_REF);
    expect(summary.scenarioCount).toBe(16);
    expect(summary.passed).toBe(16);
    expect(summary.failed).toBe(0);
    expect(summary.zeroEffectGuaranteed).toBe(true);
  });
});
