import { createStep, createWorkflow } from '@mastra/core/workflows';
import { parseControlPlaneSnapshotV1 } from '@qf-jarvis/control-plane-read-contract';

import {
  JAO1_REFUSAL_REASONS,
  jao1HealthCapabilityOutputSchema,
  jao1InspectionStepOutputSchema,
  jao1ReasoningStepOutputSchema,
  jao1RunResultSchema,
  jao1TelemetryEventSchema,
  jao1WorkflowInputSchema,
  type Jao1Clock,
  type Jao1InspectionStepOutput,
  type Jao1ReasoningStepOutput,
  type Jao1RefusalReason,
  type Jao1RunResult,
  type Jao1TelemetryHook,
  type Jao1WorkflowInput,
} from './contracts.js';
import { Jao1CapabilityError, type Jao1ReadSystemHealthCapability } from './capability.js';
import { Jao1ModelBridgeError, type Jao1ModelBridge } from './model-bridge.js';

const TASK_TYPE = 'jarvis.operations.shadow-health-investigation' as const;
const CAPABILITY_ID = 'read.system-health-from-snapshot' as const;
const MAX_CAPABILITY_CALLS = 1;
const MAX_MODEL_CALLS = 1;

export interface Jao1ShadowSupervisorDependencies {
  readonly readSystemHealth: Jao1ReadSystemHealthCapability;
  readonly modelBridge: Jao1ModelBridge;
  readonly clock: Jao1Clock;
  readonly telemetry?: Jao1TelemetryHook;
}

function refusal(
  runId: string,
  reason: Jao1RefusalReason,
  capabilityCalls: number,
): Jao1InspectionStepOutput {
  return {
    runId,
    state: 'REFUSED',
    refusalReason: reason,
    snapshotRef: null,
    evidenceRefs: [],
    anomaly: null,
    capabilityCalls,
  };
}

function isOperationalAnomaly(state: string): state is 'DEGRADED' | 'OFFLINE' {
  return state === 'DEGRADED' || state === 'OFFLINE';
}

function mapCapabilityFailure(error: unknown, signal?: AbortSignal): Jao1RefusalReason {
  if (signal?.aborted === true) {
    return 'CANCELLED';
  }
  if (error instanceof Jao1CapabilityError && error.code === 'cancelled') {
    return 'CANCELLED';
  }
  return 'CAPABILITY_UNAVAILABLE';
}

function mapModelFailure(error: unknown, signal?: AbortSignal): Jao1RefusalReason {
  if (signal?.aborted === true) {
    return 'CANCELLED';
  }
  if (error instanceof Jao1ModelBridgeError) {
    if (error.code === 'cancelled') {
      return 'CANCELLED';
    }
    if (error.code === 'result-invalid' || error.code === 'request-invalid') {
      return 'MODEL_RESULT_INVALID';
    }
  }
  return 'GATEWAY_REFUSED';
}

export async function runJao1ShadowSupervisor(
  input: Jao1WorkflowInput,
  dependencies: Jao1ShadowSupervisorDependencies,
  signal?: AbortSignal,
): Promise<Jao1RunResult> {
  const startedAt = dependencies.clock.nowMs();
  let capabilityCalls = 0;
  let modelCalls = 0;

  const inspectStep = createStep({
    id: 'jao1-validate-and-read-health',
    inputSchema: jao1WorkflowInputSchema,
    outputSchema: jao1InspectionStepOutputSchema,
    execute: async ({ inputData }) => {
      if (signal?.aborted === true) {
        return refusal(inputData.runId, 'CANCELLED', capabilityCalls);
      }

      let snapshot: ReturnType<typeof parseControlPlaneSnapshotV1>;
      try {
        snapshot = parseControlPlaneSnapshotV1(inputData.snapshot);
      } catch {
        return refusal(inputData.runId, 'SNAPSHOT_INVALID', capabilityCalls);
      }

      if (capabilityCalls >= MAX_CAPABILITY_CALLS) {
        return refusal(inputData.runId, 'BUDGET_EXHAUSTED', capabilityCalls);
      }

      capabilityCalls += 1;

      let rawCapabilityOutput: unknown;
      try {
        rawCapabilityOutput = await dependencies.readSystemHealth.invoke(snapshot, signal);
      } catch (error) {
        return refusal(inputData.runId, mapCapabilityFailure(error, signal), capabilityCalls);
      }

      const capabilityOutput = jao1HealthCapabilityOutputSchema.safeParse(rawCapabilityOutput);
      if (!capabilityOutput.success) {
        return refusal(inputData.runId, 'CAPABILITY_OUTPUT_INVALID', capabilityCalls);
      }

      const anomaly = capabilityOutput.data.components.find((component) =>
        isOperationalAnomaly(component.state),
      );

      if (anomaly === undefined) {
        return {
          runId: inputData.runId,
          state: 'NO_ANOMALY' as const,
          refusalReason: null,
          snapshotRef: capabilityOutput.data.snapshotRef,
          evidenceRefs: capabilityOutput.data.evidenceRefs,
          anomaly: null,
          capabilityCalls,
        };
      }

      if (!isOperationalAnomaly(anomaly.state)) {
        return refusal(inputData.runId, 'CAPABILITY_OUTPUT_INVALID', capabilityCalls);
      }

      return {
        runId: inputData.runId,
        state: 'READY' as const,
        refusalReason: null,
        snapshotRef: capabilityOutput.data.snapshotRef,
        evidenceRefs: capabilityOutput.data.evidenceRefs,
        anomaly: {
          componentId: anomaly.id,
          componentLabel: anomaly.label,
          state: anomaly.state,
          detail: anomaly.detail,
        },
        capabilityCalls,
      };
    },
  });

  const reasoningStep = createStep({
    id: 'jao1-gateway-reason-and-recommend',
    inputSchema: jao1InspectionStepOutputSchema,
    outputSchema: jao1ReasoningStepOutputSchema,
    execute: async ({ inputData }) => {
      if (inputData.state === 'REFUSED') {
        return {
          runId: inputData.runId,
          outcome: 'REFUSED' as const,
          refusalReason: inputData.refusalReason,
          snapshotRef: inputData.snapshotRef,
          evidenceRefs: inputData.evidenceRefs,
          anomaly: inputData.anomaly,
          attention: null,
          modelProvenance: null,
          capabilityCalls: inputData.capabilityCalls,
          modelCalls,
        };
      }

      if (inputData.state === 'NO_ANOMALY' || inputData.anomaly === null) {
        return {
          runId: inputData.runId,
          outcome: 'NO_ANOMALY' as const,
          refusalReason: null,
          snapshotRef: inputData.snapshotRef,
          evidenceRefs: inputData.evidenceRefs,
          anomaly: null,
          attention: null,
          modelProvenance: null,
          capabilityCalls: inputData.capabilityCalls,
          modelCalls,
        };
      }

      if (signal?.aborted === true) {
        return {
          runId: inputData.runId,
          outcome: 'REFUSED' as const,
          refusalReason: 'CANCELLED' as const,
          snapshotRef: inputData.snapshotRef,
          evidenceRefs: inputData.evidenceRefs,
          anomaly: inputData.anomaly,
          attention: null,
          modelProvenance: null,
          capabilityCalls: inputData.capabilityCalls,
          modelCalls,
        };
      }

      if (modelCalls >= MAX_MODEL_CALLS) {
        return {
          runId: inputData.runId,
          outcome: 'REFUSED' as const,
          refusalReason: 'BUDGET_EXHAUSTED' as const,
          snapshotRef: inputData.snapshotRef,
          evidenceRefs: inputData.evidenceRefs,
          anomaly: inputData.anomaly,
          attention: null,
          modelProvenance: null,
          capabilityCalls: inputData.capabilityCalls,
          modelCalls,
        };
      }

      modelCalls += 1;

      try {
        const result = await dependencies.modelBridge.reason(
          {
            runId: inputData.runId,
            anomaly: inputData.anomaly,
            evidenceRefs: inputData.evidenceRefs,
          },
          signal,
        );

        return {
          runId: inputData.runId,
          outcome: 'RECOMMENDATION_READY' as const,
          refusalReason: null,
          snapshotRef: inputData.snapshotRef,
          evidenceRefs: inputData.evidenceRefs,
          anomaly: inputData.anomaly,
          attention: {
            kind: 'SHADOW_OPERATIONAL_ATTENTION' as const,
            title: 'Operational anomaly requires founder review',
            context: result.reasoning.diagnosis,
            severity:
              inputData.anomaly.state === 'OFFLINE' ? ('critical' as const) : ('warning' as const),
            recommendedNextStep: result.reasoning.recommendedNextStep,
            confidence: result.reasoning.confidence,
            evidenceRefs: result.reasoning.evidenceRefs,
          },
          modelProvenance: result.provenance,
          capabilityCalls: inputData.capabilityCalls,
          modelCalls,
        };
      } catch (error) {
        return {
          runId: inputData.runId,
          outcome: 'REFUSED' as const,
          refusalReason: mapModelFailure(error, signal),
          snapshotRef: inputData.snapshotRef,
          evidenceRefs: inputData.evidenceRefs,
          anomaly: inputData.anomaly,
          attention: null,
          modelProvenance: null,
          capabilityCalls: inputData.capabilityCalls,
          modelCalls,
        };
      }
    },
  });

  const workflow = createWorkflow({
    id: 'jao1-shadow-operations-supervisor',
    inputSchema: jao1WorkflowInputSchema,
    outputSchema: jao1ReasoningStepOutputSchema,
  })
    .then(inspectStep)
    .then(reasoningStep)
    .commit();

  let output: Jao1ReasoningStepOutput;
  try {
    const run = await workflow.createRun();
    const result = await run.start({ inputData: input });
    if (result.status !== 'success') {
      throw new Error('Mastra workflow did not complete successfully');
    }
    output = jao1ReasoningStepOutputSchema.parse(result.result);
  } catch {
    output = jao1ReasoningStepOutputSchema.parse({
      runId: input.runId,
      outcome: 'REFUSED',
      refusalReason: signal?.aborted === true ? 'CANCELLED' : 'WORKFLOW_FAILED',
      snapshotRef: null,
      evidenceRefs: [],
      anomaly: null,
      attention: null,
      modelProvenance: null,
      capabilityCalls,
      modelCalls,
    });
  }

  const endedAt = dependencies.clock.nowMs();
  const durationMs = Math.max(0, Math.min(600_000, Math.trunc(endedAt - startedAt)));
  const capabilitiesInvoked = output.capabilityCalls === 0 ? [] : ([CAPABILITY_ID] as const);

  const finalResult = jao1RunResultSchema.parse({
    ...output,
    taskType: TASK_TYPE,
    autonomyLevel: 'L1_READ',
    capabilitiesInvoked,
    durationMs,
  });

  const telemetry = jao1TelemetryEventSchema.parse({
    runId: finalResult.runId,
    triggerType: 'EXPLICIT_SHADOW_PROOF',
    taskType: TASK_TYPE,
    autonomyLevel: 'L1_READ',
    capabilitiesInvoked: finalResult.capabilitiesInvoked,
    providerId: finalResult.modelProvenance?.providerId ?? null,
    modelId: finalResult.modelProvenance?.modelId ?? null,
    modelVersion: finalResult.modelProvenance?.modelVersion ?? null,
    evidenceRefs: finalResult.evidenceRefs,
    capabilityCalls: finalResult.capabilityCalls,
    modelCalls: finalResult.modelCalls,
    durationMs: finalResult.durationMs,
    outcome: finalResult.outcome,
    refusalReason: finalResult.refusalReason,
  });

  dependencies.telemetry?.record(telemetry);

  return Object.freeze(finalResult);
}

export const JAO1_SHADOW_BOUNDS = Object.freeze({
  maxCapabilityCalls: MAX_CAPABILITY_CALLS,
  maxModelCalls: MAX_MODEL_CALLS,
  maxSpecialists: 0,
  persistence: false,
  businessEffect: false,
  automaticRetryOutsideGateway: false,
});

export const JAO1_SHADOW_REFUSALS = Object.freeze([...JAO1_REFUSAL_REASONS]);
