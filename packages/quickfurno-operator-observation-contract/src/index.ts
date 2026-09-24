import { z } from 'zod';

export const QUICKFURNO_OPERATOR_REQUEST_PROTOCOL =
  'qfj.quickfurno-operator-snapshot.request.v1' as const;
export const QUICKFURNO_OPERATOR_OBSERVATION_PROTOCOL =
  'qfj.quickfurno-operator-observation.v1' as const;
export const QUICKFURNO_OPERATOR_PATH = '/api/internal/jarvis/operator-snapshot' as const;
export const QUICKFURNO_OPERATOR_SIGNING_DOMAIN =
  'qfj.jarvis-os.operator-snapshot.http.sig.v1' as const;

const instant = z.iso.datetime({ offset: false });
const identifier = z.string().min(1).max(128).regex(/^[A-Za-z0-9._:-]+$/u);
const label = z.string().min(1).max(160);
const bounded = z.number().int().nonnegative().max(1_000_000_000);

export const quickFurnoOperatorRequestSchema = z.object({
  protocol: z.literal(QUICKFURNO_OPERATOR_REQUEST_PROTOCOL),
  requestId: z.string().uuid(),
  issuedAt: instant,
}).strict();

const approval = z.object({
  id: z.string().uuid(),
  requestedAction: label,
  risk: z.enum([
    'informational',
    'low-risk-reversible',
    'client-or-vendor-facing',
    'money-related',
    'high-risk',
  ]),
  requestedAuthority: label,
  sourceAgent: label,
  subject: label,
  state: z.enum(['awaiting-core', 'awaiting-operator', 'answered']),
}).strict();

const conversation = z.object({
  id: z.string().uuid(),
  subject: label,
  agent: label,
  humanTakeover: z.boolean(),
  aiPaused: z.boolean(),
  revision: z.number().int().nonnegative().max(1_000_000),
}).strict();

const slice = z.object({
  id: identifier,
  label,
  value: bounded,
}).strict();

const point = z.object({
  label: z.string().min(1).max(16),
  value: bounded,
}).strict();

export const quickFurnoOperatorObservationSchema = z.object({
  protocol: z.literal(QUICKFURNO_OPERATOR_OBSERVATION_PROTOCOL),
  emittedAt: instant,
  approvalQueue: z.array(approval).max(100),
  approvalBreakdown: z.array(slice).max(12),
  conversationControl: z.array(conversation).max(100),
  conversationActivity: z.array(point).max(48),
  agentWorkload: z.array(slice).max(12),
  businessAnalytics: z.array(slice).max(24),
  coreAutomationExecution: z.array(slice).max(24),
}).strict();

export type QuickFurnoOperatorRequest = z.infer<typeof quickFurnoOperatorRequestSchema>;
export type QuickFurnoOperatorObservation = z.infer<typeof quickFurnoOperatorObservationSchema>;

export function parseQuickFurnoOperatorRequest(value: unknown): QuickFurnoOperatorRequest {
  return quickFurnoOperatorRequestSchema.parse(value);
}

export function parseQuickFurnoOperatorObservation(value: unknown): QuickFurnoOperatorObservation {
  return quickFurnoOperatorObservationSchema.parse(value);
}
