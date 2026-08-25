import { z } from 'zod';

export const JAO1_AUTONOMY_LEVELS = ['L0_REASON', 'L1_READ'] as const;
export const JAO1_OUTCOMES = ['RECOMMENDATION_READY', 'NO_ANOMALY', 'REFUSED'] as const;
export const JAO1_REFUSAL_REASONS = [
  'SNAPSHOT_INVALID',
  'CAPABILITY_UNAVAILABLE',
  'CAPABILITY_OUTPUT_INVALID',
  'GATEWAY_REFUSED',
  'MODEL_RESULT_INVALID',
  'CANCELLED',
  'BUDGET_EXHAUSTED',
  'WORKFLOW_FAILED',
] as const;

export type Jao1AutonomyLevel = (typeof JAO1_AUTONOMY_LEVELS)[number];
export type Jao1Outcome = (typeof JAO1_OUTCOMES)[number];
export type Jao1RefusalReason = (typeof JAO1_REFUSAL_REASONS)[number];

const runIdSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9._:-]+$/u);

const boundedEvidenceRefSchema = z.string().min(1).max(160);

export const jao1WorkflowInputSchema = z.strictObject({
  runId: runIdSchema,
  snapshot: z.unknown(),
});

export type Jao1WorkflowInput = z.infer<typeof jao1WorkflowInputSchema>;

export const jao1CapabilityDescriptorSchema = z.strictObject({
  id: z.literal('read.system-health-from-snapshot'),
  purpose: z.literal('Read validated system health from an injected control-plane snapshot.'),
  dataClass: z.literal('CONTROL_PLANE_READ_ONLY'),
  allowedActor: z.literal('jarvis'),
  maxAutonomyLevel: z.literal('L1_READ'),
  timeoutMs: z.literal(1_000),
  maxCallsPerRun: z.literal(1),
  readOnly: z.literal(true),
  businessEffect: z.literal(false),
  requiresHumanApproval: z.literal(false),
  requiresCoreAuthorization: z.literal(false),
});

export type Jao1CapabilityDescriptor = z.infer<typeof jao1CapabilityDescriptorSchema>;

export const jao1HealthComponentSchema = z.strictObject({
  id: z.string().min(1).max(64),
  label: z.string().min(1).max(80),
  state: z.enum([
    'HEALTHY',
    'AVAILABLE',
    'DEGRADED',
    'OFFLINE',
    'SHADOW',
    'ROLLOUT_OFF',
    'PLANNED',
    'DISABLED',
    'NOT_CONNECTED',
  ]),
  detail: z.string().min(1).max(240),
});

export const jao1HealthCapabilityOutputSchema = z.strictObject({
  snapshotRef: z.string().min(1).max(160),
  components: z.array(jao1HealthComponentSchema).max(24),
  evidenceRefs: z.array(boundedEvidenceRefSchema).max(24),
});

export type Jao1HealthCapabilityOutput = z.infer<typeof jao1HealthCapabilityOutputSchema>;

export const jao1AnomalySchema = z.strictObject({
  componentId: z.string().min(1).max(64),
  componentLabel: z.string().min(1).max(80),
  state: z.enum(['DEGRADED', 'OFFLINE']),
  detail: z.string().min(1).max(240),
});

export type Jao1Anomaly = z.infer<typeof jao1AnomalySchema>;

export const jao1ModelReasoningSchema = z.strictObject({
  diagnosis: z.string().min(1).max(480),
  confidence: z.number().min(0).max(1),
  recommendedNextStep: z.string().min(1).max(240),
  evidenceRefs: z.array(boundedEvidenceRefSchema).min(1).max(8),
});

export type Jao1ModelReasoning = z.infer<typeof jao1ModelReasoningSchema>;

export const jao1ModelProvenanceSchema = z.strictObject({
  runId: z.string().min(1).max(128),
  purpose: z.string().min(1).max(128),
  providerId: z.string().min(1).max(128),
  modelId: z.string().min(1).max(256),
  modelVersion: z.string().min(1).max(128),
  promptId: z.string().min(1).max(128),
  promptVersion: z.string().min(1).max(128),
  promptDigest: z.string().regex(/^[0-9a-f]{64}$/u),
  mode: z.literal('SHADOW'),
  usedFallback: z.boolean(),
  attempts: z.number().int().min(1).max(100),
});

export type Jao1ModelProvenance = z.infer<typeof jao1ModelProvenanceSchema>;

export const jao1FounderAttentionSchema = z.strictObject({
  kind: z.literal('SHADOW_OPERATIONAL_ATTENTION'),
  title: z.string().min(1).max(80),
  context: z.string().min(1).max(480),
  severity: z.enum(['critical', 'warning']),
  recommendedNextStep: z.string().min(1).max(240),
  confidence: z.number().min(0).max(1),
  evidenceRefs: z.array(boundedEvidenceRefSchema).min(1).max(8),
});

export type Jao1FounderAttention = z.infer<typeof jao1FounderAttentionSchema>;

export const jao1InspectionStepOutputSchema = z.strictObject({
  runId: runIdSchema,
  state: z.enum(['READY', 'NO_ANOMALY', 'REFUSED']),
  refusalReason: z.enum(JAO1_REFUSAL_REASONS).nullable(),
  snapshotRef: z.string().min(1).max(160).nullable(),
  evidenceRefs: z.array(boundedEvidenceRefSchema).max(24),
  anomaly: jao1AnomalySchema.nullable(),
  capabilityCalls: z.number().int().min(0).max(1),
});

export type Jao1InspectionStepOutput = z.infer<typeof jao1InspectionStepOutputSchema>;

export const jao1ReasoningStepOutputSchema = z.strictObject({
  runId: runIdSchema,
  outcome: z.enum(JAO1_OUTCOMES),
  refusalReason: z.enum(JAO1_REFUSAL_REASONS).nullable(),
  snapshotRef: z.string().min(1).max(160).nullable(),
  evidenceRefs: z.array(boundedEvidenceRefSchema).max(24),
  anomaly: jao1AnomalySchema.nullable(),
  attention: jao1FounderAttentionSchema.nullable(),
  modelProvenance: jao1ModelProvenanceSchema.nullable(),
  capabilityCalls: z.number().int().min(0).max(1),
  modelCalls: z.number().int().min(0).max(1),
});

export type Jao1ReasoningStepOutput = z.infer<typeof jao1ReasoningStepOutputSchema>;

export const jao1RunResultSchema = jao1ReasoningStepOutputSchema.extend({
  taskType: z.literal('jarvis.operations.shadow-health-investigation'),
  autonomyLevel: z.literal('L1_READ'),
  capabilitiesInvoked: z.array(z.literal('read.system-health-from-snapshot')).max(1),
  durationMs: z.number().int().nonnegative().max(600_000),
});

export type Jao1RunResult = z.infer<typeof jao1RunResultSchema>;

export const jao1TelemetryEventSchema = z.strictObject({
  runId: runIdSchema,
  triggerType: z.literal('EXPLICIT_SHADOW_PROOF'),
  taskType: z.literal('jarvis.operations.shadow-health-investigation'),
  autonomyLevel: z.literal('L1_READ'),
  capabilitiesInvoked: z.array(z.literal('read.system-health-from-snapshot')).max(1),
  providerId: z.string().min(1).max(128).nullable(),
  modelId: z.string().min(1).max(256).nullable(),
  modelVersion: z.string().min(1).max(128).nullable(),
  evidenceRefs: z.array(boundedEvidenceRefSchema).max(24),
  capabilityCalls: z.number().int().min(0).max(1),
  modelCalls: z.number().int().min(0).max(1),
  durationMs: z.number().int().nonnegative().max(600_000),
  outcome: z.enum(JAO1_OUTCOMES),
  refusalReason: z.enum(JAO1_REFUSAL_REASONS).nullable(),
});

export type Jao1TelemetryEvent = z.infer<typeof jao1TelemetryEventSchema>;

export interface Jao1TelemetryHook {
  record(event: Jao1TelemetryEvent): void;
}

export interface Jao1Clock {
  nowMs(): number;
}
