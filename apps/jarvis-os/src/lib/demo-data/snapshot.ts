/**
 * The demo snapshot (JOS-01A, docs/architecture/jarvis-os.md).
 *
 * ### Everything here is synthetic, and says so
 *
 * This release has no control-plane API, so the surfaces are proved against a local fixture.
 * The rule that makes that honest is narrow and absolute: **no real person, vendor,
 * customer, phone number or email address appears anywhere in this file**, and no value here
 * is a reading taken from a running system.
 *
 * Identifiers deliberately carry a `-DEMO-` segment (`CONV-DEMO-1042`, `VENDOR-DEMO-18`) so
 * that a screenshot, a support ticket or a stray console paste is self-labelling. A synthetic
 * value that could be mistaken for a production one is the failure mode worth designing
 * against, and the label is cheap.
 *
 * ### It never claims a connection
 *
 * Where a system is not reachable, the state says `NOT_CONNECTED` rather than showing a
 * plausible number. A dashboard that invents a healthy reading for a system it cannot see is
 * worse than one that shows nothing.
 */
import type {
  ActivityEntry,
  AgentSummary,
  ApprovalQueueRow,
  AttentionItem,
  ConversationControlRow,
  DistributionSlice,
  EvaluationDimension,
  FunnelStage,
  KnowledgeNamespace,
  MetricSummary,
  ModelProfile,
  NamedSeries,
  OwnershipRow,
  RoadmapMarker,
  SystemHealth,
  WorkerNode,
} from '../control-plane/types';

import { DEMO_ENVIRONMENT_LABEL } from '../environment';

export const ENVIRONMENT_LABEL = DEMO_ENVIRONMENT_LABEL;

export const SYSTEM_HEALTH: SystemHealth = Object.freeze<SystemHealth>({
  environmentLabel: ENVIRONMENT_LABEL,
  rolloutEnabled: false,
  components: Object.freeze([
    {
      id: 'control-plane',
      label: 'Jarvis Control Plane',
      state: 'HEALTHY',
      detail: 'Runtime composition merged; observed only.',
    },
    {
      id: 'core',
      label: 'QuickFurno Core',
      state: 'NOT_CONNECTED',
      detail: 'Authoritative. No Jarvis↔Core transport has been adopted.',
    },
    {
      id: 'n8n',
      label: 'n8n',
      state: 'NOT_CONNECTED',
      detail: 'Execution fabric. Bridge is QFJ-P09.02, not implemented.',
    },
    {
      id: 'gateway',
      label: 'Model Gateway',
      state: 'SHADOW',
      detail: 'Provider-neutral routing, shadow evaluation only.',
    },
    {
      id: 'workers',
      label: 'Worker Fleet',
      state: 'DEGRADED',
      detail: '1 of 3 demo nodes offline.',
    },
    {
      id: 'rollout',
      label: 'Production Rollout',
      state: 'ROLLOUT_OFF',
      detail: 'No communication may reach a real recipient.',
    },
  ]),
});

export const HEADLINE_METRICS: readonly MetricSummary[] = Object.freeze<readonly MetricSummary[]>([
  {
    id: 'conversations',
    label: 'Conversations (24h)',
    value: '1,284',
    deltaLabel: '+8.4%',
    deltaDirection: 'up',
    higherIsBetter: true,
    caption: 'Demo workload across Riya and Anisha surfaces.',
  },
  {
    id: 'escalations',
    label: 'Human escalations',
    value: '37',
    deltaLabel: '+5',
    deltaDirection: 'up',
    higherIsBetter: false,
    caption: 'Routed to an operator rather than answered autonomously.',
  },
  {
    id: 'approvals',
    label: 'Pending approvals',
    value: '12',
    deltaLabel: '+3',
    deltaDirection: 'up',
    higherIsBetter: false,
    caption: 'Awaiting a human, or awaiting Core.',
  },
  {
    id: 'latency',
    label: 'Model latency p95',
    value: '842',
    unit: 'ms',
    deltaLabel: '−64 ms',
    deltaDirection: 'down',
    higherIsBetter: false,
    caption: 'Gateway-observed, shadow traffic only.',
  },
  {
    id: 'queue',
    label: 'Queue depth',
    value: '46',
    deltaLabel: 'stable',
    deltaDirection: 'flat',
    higherIsBetter: false,
    caption: 'Projection and evaluation work items.',
  },
  {
    id: 'availability',
    label: 'Provider availability',
    value: '99.2',
    unit: '%',
    deltaLabel: '−0.3%',
    deltaDirection: 'down',
    higherIsBetter: true,
    caption: 'Rolling 24h across configured profiles.',
  },
]);

function hourLabels(): readonly string[] {
  return Array.from({ length: 24 }, (_, index) => `${String(index).padStart(2, '0')}:00`);
}

const ACTIVITY_VALUES = [
  18, 14, 11, 9, 8, 10, 17, 29, 46, 61, 74, 81, 78, 84, 92, 88, 79, 71, 64, 52, 41, 33, 27, 21,
] as const;

const LATENCY_VALUES = [
  790, 774, 768, 761, 758, 766, 802, 848, 906, 942, 918, 884, 861, 872, 905, 933, 897, 866, 840,
  822, 811, 803, 796, 842,
] as const;

export const ACTIVITY_SERIES: NamedSeries = Object.freeze({
  id: 'activity-24h',
  label: 'Conversation activity · 24h',
  tone: 'info',
  points: Object.freeze(
    hourLabels().map((label, index) => ({ label, value: ACTIVITY_VALUES[index] ?? 0 })),
  ),
});

export const LATENCY_SERIES: NamedSeries = Object.freeze({
  id: 'latency-24h',
  label: 'Model latency p95 · 24h',
  tone: 'shadow',
  points: Object.freeze(
    hourLabels().map((label, index) => ({ label, value: LATENCY_VALUES[index] ?? 0 })),
  ),
});

export const AGENT_WORKLOAD: readonly DistributionSlice[] = Object.freeze<
  readonly DistributionSlice[]
>([
  { id: 'riya', label: 'Riya · customer', value: 612, tone: 'info' },
  { id: 'anisha', label: 'Anisha · vendor care', value: 428, tone: 'shadow' },
  { id: 'jarvis', label: 'Jarvis · coordination', value: 244, tone: 'planned' },
  { id: 'aarohi', label: 'Aarohi · vendor growth', value: 0, tone: 'offline' },
]);

export const APPROVAL_BREAKDOWN: readonly DistributionSlice[] = Object.freeze<
  readonly DistributionSlice[]
>([
  { id: 'awaiting-operator', label: 'Awaiting operator', value: 7, tone: 'warning' },
  { id: 'awaiting-core', label: 'Awaiting Core', value: 5, tone: 'info' },
  { id: 'approved', label: 'Approved (24h)', value: 23, tone: 'healthy' },
  { id: 'rejected', label: 'Rejected (24h)', value: 9, tone: 'critical' },
]);

export const VENDOR_GROWTH_FUNNEL: readonly FunnelStage[] = Object.freeze<readonly FunnelStage[]>([
  { id: 'sourced', label: 'Sourced', value: 0, caption: 'Prospect discovery — planned' },
  { id: 'researched', label: 'Researched', value: 0, caption: 'Enrichment queue — planned' },
  { id: 'approved', label: 'Outreach approved', value: 0, caption: 'Requires Core authorization' },
  { id: 'contacted', label: 'Contacted', value: 0, caption: 'No channel is attached' },
  { id: 'registered', label: 'Registered', value: 0, caption: 'Core owns registration' },
  { id: 'paid-active', label: 'Paid active', value: 0, caption: 'Core owns commercial outcome' },
]);

export const ATTENTION: readonly AttentionItem[] = Object.freeze<readonly AttentionItem[]>([
  {
    id: 'APPR-DEMO-4471',
    kind: 'approval',
    title: 'Vendor follow-up message awaiting approval',
    context: 'VENDOR-DEMO-18 · client-or-vendor-facing · authorized-team-human',
    age: '2h 14m',
    severity: 'warning',
  },
  {
    id: 'APPR-DEMO-4468',
    kind: 'approval',
    title: 'Money-related action awaiting stronger approval',
    context: 'CASE-DEMO-021 · money-related · founder',
    age: '4h 02m',
    severity: 'critical',
  },
  {
    id: 'ESC-DEMO-0912',
    kind: 'escalation',
    title: 'Customer conversation escalated to a human',
    context: 'CONV-DEMO-1042 · Riya · ambiguity in pricing question',
    age: '18m',
    severity: 'warning',
  },
  {
    id: 'WRK-DEMO-03',
    kind: 'worker',
    title: 'Local inference node offline',
    context: 'WORKER-DEMO-03 · last heartbeat 41m ago',
    age: '41m',
    severity: 'critical',
  },
  {
    id: 'BLK-DEMO-0007',
    kind: 'blocked',
    title: 'Execution blocked — no n8n bridge',
    context: 'QFJ-P09.02 not implemented; live send is off',
    age: '—',
    severity: 'info',
  },
  {
    id: 'WARN-DEMO-0021',
    kind: 'warning',
    title: 'Core sync unavailable',
    context: 'No Jarvis↔Core transport adopted; Core remains authoritative',
    age: '—',
    severity: 'info',
  },
]);

export const ACTIVITY_LOG: readonly ActivityEntry[] = Object.freeze<readonly ActivityEntry[]>([
  {
    id: 'ACT-DEMO-1',
    source: 'JARVIS',
    at: '12:41',
    message: 'Execution intent EI-DEMO-0071 correlated to approved action — validation only.',
    tone: 'healthy',
  },
  {
    id: 'ACT-DEMO-2',
    source: 'RIYA',
    at: '12:38',
    message: 'CONV-DEMO-1042 escalated to operator after qualification ambiguity.',
    tone: 'warning',
  },
  {
    id: 'ACT-DEMO-3',
    source: 'CORE',
    at: '12:35',
    message: 'Approval decision recorded for CASE-DEMO-019 — rejected, recipient opted out.',
    tone: 'critical',
  },
  {
    id: 'ACT-DEMO-4',
    source: 'ANISHA',
    at: '12:29',
    message: 'VENDOR-DEMO-18 support thread summarised; recommendation drafted.',
    tone: 'shadow',
  },
  {
    id: 'ACT-DEMO-5',
    source: 'SYSTEM',
    at: '12:22',
    message: 'Model gateway shadow comparison completed; candidate output discarded.',
    tone: 'info',
  },
  {
    id: 'ACT-DEMO-6',
    source: 'AAROHI',
    at: '—',
    message: 'Vendor growth runtime is planned and disabled. No outreach has been attempted.',
    tone: 'planned',
  },
  {
    id: 'ACT-DEMO-7',
    source: 'SYSTEM',
    at: '12:07',
    message: 'WORKER-DEMO-03 missed heartbeat; capacity reduced to 2 nodes.',
    tone: 'critical',
  },
]);

export const AGENTS: readonly AgentSummary[] = Object.freeze<readonly AgentSummary[]>([
  {
    id: 'jarvis',
    name: 'Jarvis',
    role: 'Orchestration, case routing and founder decision support',
    capabilityId: 'jarvis.orchestration',
    lifecycle: 'SHADOW',
    state: 'SHADOW',
    metrics: Object.freeze([
      {
        id: 'recommendations',
        label: 'Recommendations (24h)',
        value: '96',
        caption: 'Governed RecommendationV1 artifacts produced.',
      },
      {
        id: 'routed',
        label: 'Cases routed',
        value: '244',
        caption: 'Coordination only — no autonomous action.',
      },
      {
        id: 'gateway',
        label: 'Gateway state',
        value: 'Shadow',
        caption: 'Candidate output is discarded, never delivered.',
      },
    ]),
    notes: Object.freeze([
      'Jarvis recommends and coordinates. It authorizes nothing.',
      'Rollout is off; no recommendation reaches an execution path.',
    ]),
  },
  {
    id: 'riya',
    name: 'Riya',
    role: 'Customer conversation and qualification',
    capabilityId: 'riya.customer-conversation',
    lifecycle: 'SHADOW',
    state: 'SHADOW',
    metrics: Object.freeze([
      {
        id: 'conversations',
        label: 'Conversations (24h)',
        value: '612',
        caption: 'Demo workload; no live channel is attached.',
      },
      {
        id: 'qualified',
        label: 'Qualified',
        value: '38%',
        caption: 'Reached a qualification outcome without a human.',
      },
      {
        id: 'escalation',
        label: 'Escalation rate',
        value: '6.1%',
        deltaLabel: '+0.8pt',
        deltaDirection: 'up',
        higherIsBetter: false,
        caption: 'Ambiguity is escalated rather than guessed.',
      },
    ]),
    notes: Object.freeze([
      'Customer side only. Riya never handles vendor acquisition or vendor care.',
      'Consent, opt-out and eligibility remain QuickFurno Core’s.',
    ]),
  },
  {
    id: 'aarohi',
    name: 'Aarohi',
    role: 'Vendor growth and acquisition — QuickFurno Vendor Growth Engine',
    capabilityId: 'aarohi.vendor-growth',
    lifecycle: 'PLANNED',
    state: 'PLANNED',
    metrics: Object.freeze([
      {
        id: 'pipeline',
        label: 'Prospect pipeline',
        value: '—',
        caption: 'No runtime. Nothing has been sourced.',
      },
      {
        id: 'research',
        label: 'Research queue',
        value: '—',
        caption: 'Enrichment is a planned surface.',
      },
      {
        id: 'outreach',
        label: 'Outreach approved',
        value: '0',
        caption: 'No outreach may be attempted without Core authorization.',
      },
    ]),
    notes: Object.freeze([
      'Owner-locked product surface. The runtime is PLANNED and DISABLED.',
      'No autonomous outreach exists, and no channel is attached.',
      'Acquisition only — Aarohi never handles a registered vendor. That is Anisha.',
      'Registration, activation and paid-active status are QuickFurno Core’s to record.',
    ]),
  },
  {
    id: 'anisha',
    name: 'Anisha',
    role: 'Registered-vendor relationship, support and success',
    capabilityId: 'anisha.vendor-care',
    lifecycle: 'SHADOW',
    state: 'SHADOW',
    metrics: Object.freeze([
      {
        id: 'support',
        label: 'Support queue',
        value: '54',
        caption: 'Open demo threads for existing vendors.',
      },
      {
        id: 'onboarding',
        label: 'In onboarding',
        value: '11',
        caption: 'Already-registered vendors being brought up to speed.',
      },
      {
        id: 'retention',
        label: 'Renewal watchlist',
        value: '7',
        caption: 'Retention signals surfaced for a human to weigh.',
      },
    ]),
    notes: Object.freeze([
      'Existing, registered vendors only. Acquiring an unregistered vendor belongs to Aarohi, never to Anisha.',
      'Recommends and supports; it does not authorize commercial change.',
    ]),
  },
]);

export const APPROVAL_QUEUE: readonly ApprovalQueueRow[] = Object.freeze<
  readonly ApprovalQueueRow[]
>([
  {
    id: 'APPR-DEMO-4468',
    requestedAction: 'Issue revised package pricing to vendor',
    risk: 'money-related',
    requestedAuthority: 'founder',
    sourceAgent: 'Anisha',
    subject: 'VENDOR-DEMO-04',
    age: '4h 02m',
    slaState: 'breached',
    state: 'awaiting-operator',
  },
  {
    id: 'APPR-DEMO-4471',
    requestedAction: 'Send vendor follow-up about delayed sample',
    risk: 'client-or-vendor-facing',
    requestedAuthority: 'authorized-team-human',
    sourceAgent: 'Anisha',
    subject: 'VENDOR-DEMO-18',
    age: '2h 14m',
    slaState: 'due',
    state: 'awaiting-operator',
  },
  {
    id: 'APPR-DEMO-4474',
    requestedAction: 'Schedule customer call-back',
    risk: 'client-or-vendor-facing',
    requestedAuthority: 'authorized-team-human',
    sourceAgent: 'Riya',
    subject: 'CONV-DEMO-1042',
    age: '52m',
    slaState: 'ok',
    state: 'awaiting-core',
  },
  {
    id: 'APPR-DEMO-4475',
    requestedAction: 'Update internal case summary',
    risk: 'low-risk-reversible',
    requestedAuthority: 'delegated-approver',
    sourceAgent: 'Jarvis',
    subject: 'CASE-DEMO-021',
    age: '31m',
    slaState: 'ok',
    state: 'awaiting-core',
  },
  {
    id: 'APPR-DEMO-4477',
    requestedAction: 'Notify account owner of vendor risk signal',
    risk: 'client-or-vendor-facing',
    requestedAuthority: 'authorized-team-human',
    sourceAgent: 'Anisha',
    subject: 'VENDOR-DEMO-27',
    age: '12m',
    slaState: 'ok',
    state: 'awaiting-operator',
  },
]);

export const CONVERSATION_CONTROL: readonly ConversationControlRow[] = Object.freeze<
  readonly ConversationControlRow[]
>([
  {
    id: 'CONV-DEMO-1042',
    subject: 'CUSTOMER-DEMO-311',
    agent: 'Riya',
    humanTakeover: true,
    aiPaused: true,
    lastOperatorAction: 'Takeover · 18m ago',
    revision: 14,
  },
  {
    id: 'CONV-DEMO-1039',
    subject: 'VENDOR-DEMO-18',
    agent: 'Anisha',
    humanTakeover: false,
    aiPaused: true,
    lastOperatorAction: 'Paused · 1h 04m ago',
    revision: 9,
  },
  {
    id: 'CONV-DEMO-1027',
    subject: 'CUSTOMER-DEMO-288',
    agent: 'Riya',
    humanTakeover: false,
    aiPaused: false,
    lastOperatorAction: 'Resumed · 3h 22m ago',
    revision: 21,
  },
  {
    id: 'CONV-DEMO-1015',
    subject: 'VENDOR-DEMO-27',
    agent: 'Anisha',
    humanTakeover: true,
    aiPaused: true,
    lastOperatorAction: 'Takeover · 5h 40m ago',
    revision: 6,
  },
]);

export const WORKERS: readonly WorkerNode[] = Object.freeze<readonly WorkerNode[]>([
  {
    id: 'WORKER-DEMO-01',
    label: 'Control plane · VPS',
    kind: 'control-plane',
    state: 'HEALTHY',
    capacity: '2 vCPU · 4 GB',
    detail: 'Permanent Jarvis home. Hosts no provider credential.',
  },
  {
    id: 'WORKER-DEMO-02',
    label: 'Projection worker',
    kind: 'local-node',
    state: 'HEALTHY',
    capacity: '4 workers · 46 queued',
    detail: 'Read-model projection and evaluation work.',
  },
  {
    id: 'WORKER-DEMO-03',
    label: 'Local inference node',
    kind: 'gpu-node',
    state: 'OFFLINE',
    capacity: '—',
    detail: 'Last heartbeat 41m ago. Local inference is a planned capability.',
  },
]);

export const MODELS: readonly ModelProfile[] = Object.freeze<readonly ModelProfile[]>([
  {
    id: 'groq-stable',
    label: 'Stable profile',
    provider: 'Groq',
    state: 'SHADOW',
    dataClass: 'external-provider',
    latencyP95: '842 ms',
    circuit: 'closed',
    detail: 'Routed through the provider-neutral gateway. Shadow traffic only.',
  },
  {
    id: 'groq-candidate',
    label: 'Candidate profile',
    provider: 'Groq',
    state: 'SHADOW',
    dataClass: 'external-provider',
    latencyP95: '911 ms',
    circuit: 'half-open',
    detail: 'Compared against stable; candidate output is discarded.',
  },
  {
    id: 'local-node',
    label: 'Local profile',
    provider: 'Local node',
    state: 'PLANNED',
    dataClass: 'local-only',
    latencyP95: '—',
    circuit: 'open',
    detail: 'Local/GPU inference is a future slice. No node is attached.',
  },
]);

export const KNOWLEDGE: readonly KnowledgeNamespace[] = Object.freeze<
  readonly KnowledgeNamespace[]
>([
  {
    id: 'ns-jarvis',
    label: 'JARVIS',
    owner: 'Orchestration & coordination',
    state: 'DISABLED',
    detail: 'Governed namespace defined; retrieval is off.',
  },
  {
    id: 'ns-riya',
    label: 'RIYA',
    owner: 'Customer conversation',
    state: 'DISABLED',
    detail: 'Scoped to customer material only.',
  },
  {
    id: 'ns-aarohi',
    label: 'AAROHI',
    owner: 'Vendor growth & acquisition',
    state: 'PLANNED',
    detail: 'Namespace reserved. No content provisioned.',
  },
  {
    id: 'ns-anisha',
    label: 'ANISHA',
    owner: 'Registered-vendor care',
    state: 'DISABLED',
    detail: 'Scoped to existing-vendor material only.',
  },
]);

export const EVALUATIONS: readonly EvaluationDimension[] = Object.freeze<
  readonly EvaluationDimension[]
>([
  {
    id: 'safety',
    label: 'Safety & refusal',
    state: 'SHADOW',
    caseCount: 148,
    detail: 'Mandatory refusal cases, including direct-execution attempts.',
  },
  {
    id: 'authority',
    label: 'Authority boundary',
    state: 'SHADOW',
    caseCount: 96,
    detail: 'Proves an agent never claims authorization it does not hold.',
  },
  {
    id: 'multilingual',
    label: 'Multilingual',
    state: 'SHADOW',
    caseCount: 72,
    detail: 'Language handling across the supported set.',
  },
  {
    id: 'quality',
    label: 'Response quality',
    state: 'SHADOW',
    caseCount: 210,
    detail: 'Fixture-based. No production certification is claimed.',
  },
]);

export const OWNERSHIP: readonly OwnershipRow[] = Object.freeze<readonly OwnershipRow[]>([
  {
    id: 'vendors',
    subject: 'Vendors',
    owner: 'QuickFurno Core',
    detail: 'Identity, registration, activation.',
  },
  {
    id: 'customers',
    subject: 'Customers & leads',
    owner: 'QuickFurno Core',
    detail: 'Identity and lifecycle.',
  },
  {
    id: 'packages',
    subject: 'Packages & pricing',
    owner: 'QuickFurno Core',
    detail: 'Commercial catalogue.',
  },
  {
    id: 'payments',
    subject: 'Payments',
    owner: 'QuickFurno Core',
    detail: 'Settlement and commercial outcome.',
  },
  {
    id: 'consent',
    subject: 'Consent, opt-out & DNC',
    owner: 'QuickFurno Core',
    detail: 'Revalidated at execution time.',
  },
  {
    id: 'assignments',
    subject: 'Assignments',
    owner: 'QuickFurno Core',
    detail: 'Who owns which relationship.',
  },
  {
    id: 'authorization',
    subject: 'Authorization decisions',
    owner: 'QuickFurno Core',
    detail: 'Approval and communication authorization.',
  },
  {
    id: 'recommendations',
    subject: 'Recommendations',
    owner: 'QF Jarvis',
    detail: 'Derived proposals; powerless.',
  },
  {
    id: 'interpretations',
    subject: 'Interpretations & summaries',
    owner: 'QF Jarvis',
    detail: 'Derived reading of Core truth.',
  },
  {
    id: 'routing',
    subject: 'Case routing & coordination',
    owner: 'QF Jarvis',
    detail: 'Operational sequencing only.',
  },
  {
    id: 'evaluation',
    subject: 'Evaluation & observability',
    owner: 'QF Jarvis',
    detail: 'Quality signal, not business truth.',
  },
]);

export const ROADMAP: readonly RoadmapMarker[] = Object.freeze<readonly RoadmapMarker[]>([
  {
    id: 'p08',
    label: 'QFJ-P08 — Consent, approval & human control',
    track: 'QFJ',
    state: 'merged',
    detail:
      'Approval runtime, durable queue, operator boundary, communication-authorization correlation.',
  },
  {
    id: 'p09-01',
    label: 'QFJ-P09.01 — Execution intent correlation',
    track: 'QFJ',
    state: 'merged',
    detail: 'Validates a Core-issued ExecutionIntentV1 against re-proved approval evidence.',
  },
  {
    id: 'p09-02',
    label: 'QFJ-P09.02 — Authorized dispatch envelope / n8n bridge (test-only)',
    track: 'QFJ',
    state: 'next',
    detail: 'MAIN JARVIS RESUME POINT after the Jarvis OS foundation track.',
  },
  {
    id: 'p09-rest',
    label: 'QFJ-P09 — Communication lifecycle & provider dispatch',
    track: 'QFJ',
    state: 'planned',
    detail: 'Eighteen-state lifecycle and provider delivery. Nothing sends today.',
  },
]);
