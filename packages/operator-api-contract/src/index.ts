import { z } from 'zod';

export const OPERATOR_API_VERSION = '1' as const;
export const OPERATOR_COMMAND_PROTOCOL = 'qfj.operator.command.v1' as const;

const instant = z.iso.datetime({ offset: false });
const uuid = z.string().uuid();
const ref = z.string().min(1).max(128).regex(/^[A-Za-z0-9._:-]+$/u);

export const operatorClientPlatformSchema = z.enum(['WEB', 'IOS', 'ANDROID']);

export const operatorModuleSchema = z.object({
  id: z.enum([
    'overview',
    'jarvis',
    'riya',
    'aarohi',
    'anisha',
    'operations',
    'approvals',
    'conversations',
    'execution',
    'knowledge',
    'evaluations',
    'models',
    'workers',
    'core-sync',
    'integrations',
    'analytics',
    'governance',
    'settings',
  ]),
  group: z.enum(['CONTROL', 'AGENTS', 'OPERATE', 'INTELLIGENCE', 'BOUNDARY']),
  label: z.string().min(1).max(80),
  scope: z.string().min(1).max(160),
  webPath: z.string().min(1).max(96).regex(/^\//u),
  mobilePrimary: z.boolean(),
}).strict();

export const OPERATOR_MODULES = Object.freeze([
  { id:'overview', group:'CONTROL', label:'Overview', scope:'System-wide operational picture', webPath:'/', mobilePrimary:true },
  { id:'jarvis', group:'AGENTS', label:'Jarvis', scope:'Orchestration and coordination', webPath:'/agents/jarvis', mobilePrimary:false },
  { id:'riya', group:'AGENTS', label:'Riya', scope:'Customer conversation and qualification', webPath:'/agents/riya', mobilePrimary:false },
  { id:'aarohi', group:'AGENTS', label:'Aarohi — Vendor Growth', scope:'Vendor acquisition — not yet registered vendors', webPath:'/agents/aarohi', mobilePrimary:false },
  { id:'anisha', group:'AGENTS', label:'Anisha', scope:'Registered-vendor relationship and success', webPath:'/agents/anisha', mobilePrimary:false },
  { id:'operations', group:'OPERATE', label:'Operations Center', scope:'Human control and safety state', webPath:'/operations', mobilePrimary:true },
  { id:'approvals', group:'OPERATE', label:'Approvals', scope:'Operator approval desk', webPath:'/approvals', mobilePrimary:true },
  { id:'conversations', group:'OPERATE', label:'Conversations', scope:'Conversation inventory', webPath:'/conversations', mobilePrimary:false },
  { id:'execution', group:'OPERATE', label:'Execution', scope:'Execution intent and dispatch readiness', webPath:'/execution', mobilePrimary:false },
  { id:'knowledge', group:'INTELLIGENCE', label:'Knowledge', scope:'Governed knowledge namespaces', webPath:'/knowledge', mobilePrimary:false },
  { id:'evaluations', group:'INTELLIGENCE', label:'Evaluations', scope:'Suite health and readiness', webPath:'/evaluations', mobilePrimary:false },
  { id:'models', group:'INTELLIGENCE', label:'Models & Providers', scope:'Provider-neutral gateway', webPath:'/models', mobilePrimary:false },
  { id:'workers', group:'INTELLIGENCE', label:'Workers', scope:'Fleet topology and capacity', webPath:'/workers', mobilePrimary:false },
  { id:'core-sync', group:'BOUNDARY', label:'QuickFurno Core Sync', scope:'Source-of-truth boundary', webPath:'/core-sync', mobilePrimary:false },
  { id:'integrations', group:'BOUNDARY', label:'QuickFurno Core Automation / Integrations', scope:'Execution fabric status', webPath:'/integrations', mobilePrimary:false },
  { id:'analytics', group:'BOUNDARY', label:'Analytics', scope:'Operational trends', webPath:'/analytics', mobilePrimary:true },
  { id:'governance', group:'BOUNDARY', label:'Governance', scope:'Roadmap, authority and audit posture', webPath:'/governance', mobilePrimary:false },
  { id:'settings', group:'BOUNDARY', label:'Settings', scope:'Operator preferences', webPath:'/settings', mobilePrimary:false },
] as const);

export const operatorActionSchema = z.enum([
  'APPROVAL_DECIDE',
  'CONVERSATION_TAKEOVER',
  'CONVERSATION_RESUME_AI',
  'CONVERSATION_PAUSE_AI',
  'AGENT_SET_ENABLED',
  'KNOWLEDGE_SET_MODE',
  'ROLLOUT_REQUEST_CHANGE',
]);

export const operatorCapabilitySchema = z.object({
  action: operatorActionSchema,
  state: z.enum(['AVAILABLE', 'LOCKED', 'NOT_CONNECTED']),
  reason: z.string().min(1).max(240),
  authority: z.enum(['QUICKFURNO_CORE', 'JARVIS_GOVERNANCE']),
}).strict();

export const operatorBootstrapSchema = z.object({
  apiVersion: z.literal(OPERATOR_API_VERSION),
  generatedAt: instant,
  client: z.object({
    minimumSnapshotVersion: z.literal(2),
    webSession: z.literal(true),
    mobileDeviceSession: z.boolean(),
  }).strict(),
  modules: z.array(operatorModuleSchema).length(OPERATOR_MODULES.length),
  capabilities: z.array(operatorCapabilitySchema).max(32),
}).strict();

const base = {
  protocol: z.literal(OPERATOR_COMMAND_PROTOCOL),
  commandId: uuid,
  issuedAt: instant,
  idempotencyKey: ref,
  clientPlatform: operatorClientPlatformSchema,
} as const;

const approval = z.object({
  ...base,
  action: z.literal('APPROVAL_DECIDE'),
  payload: z.object({
    approvalId: uuid,
    decision: z.enum(['APPROVE', 'REJECT']),
  }).strict(),
}).strict();

const conversation = <T extends 'CONVERSATION_TAKEOVER'|'CONVERSATION_RESUME_AI'|'CONVERSATION_PAUSE_AI'>(action: T) =>
  z.object({
    ...base,
    action: z.literal(action),
    payload: z.object({
      conversationId: uuid,
      expectedRevision: z.number().int().nonnegative().max(1_000_000),
    }).strict(),
  }).strict();

const agent = z.object({
  ...base,
  action: z.literal('AGENT_SET_ENABLED'),
  payload: z.object({
    agentId: z.enum(['jarvis', 'riya', 'anisha', 'aarohi']),
    enabled: z.boolean(),
    expectedRevision: z.number().int().nonnegative().max(1_000_000),
  }).strict(),
}).strict();

const knowledge = z.object({
  ...base,
  action: z.literal('KNOWLEDGE_SET_MODE'),
  payload: z.object({
    mode: z.enum(['DISABLED', 'HYBRID']),
    expectedRevision: z.number().int().nonnegative().max(1_000_000),
  }).strict(),
}).strict();

const rollout = z.object({
  ...base,
  action: z.literal('ROLLOUT_REQUEST_CHANGE'),
  payload: z.object({
    requestedEnabled: z.boolean(),
    expectedRevision: z.number().int().nonnegative().max(1_000_000),
  }).strict(),
}).strict();

export const operatorCommandSchema = z.discriminatedUnion('action', [
  approval,
  conversation('CONVERSATION_TAKEOVER'),
  conversation('CONVERSATION_RESUME_AI'),
  conversation('CONVERSATION_PAUSE_AI'),
  agent,
  knowledge,
  rollout,
]);

export const operatorCommandResultSchema = z.object({
  protocol: z.literal(OPERATOR_COMMAND_PROTOCOL),
  commandId: uuid,
  status: z.enum([
    'SUBMITTED_TO_AUTHORITY',
    'APPLIED_BY_AUTHORITY',
    'REFUSED',
    'UNAVAILABLE',
    'CONFLICT',
  ]),
  jarvisAuthorized: z.literal(false),
  reasonCode: ref,
}).strict();

export type OperatorClientPlatform = z.infer<typeof operatorClientPlatformSchema>;
export type OperatorModule = z.infer<typeof operatorModuleSchema>;
export type OperatorAction = z.infer<typeof operatorActionSchema>;
export type OperatorCapability = z.infer<typeof operatorCapabilitySchema>;
export type OperatorBootstrap = z.infer<typeof operatorBootstrapSchema>;
export type OperatorCommand = z.infer<typeof operatorCommandSchema>;
export type OperatorCommandResult = z.infer<typeof operatorCommandResultSchema>;

export function parseOperatorBootstrap(value: unknown): OperatorBootstrap {
  return operatorBootstrapSchema.parse(value);
}

export function parseOperatorCommand(value: unknown): OperatorCommand {
  return operatorCommandSchema.parse(value);
}

export function parseOperatorCommandResult(value: unknown): OperatorCommandResult {
  return operatorCommandResultSchema.parse(value);
}
