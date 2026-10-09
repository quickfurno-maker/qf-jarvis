export const AOS_PIPELINE_NODE_STATUSES = [
  'IMPLEMENTED',
  'SHADOW',
  'NOT_CONNECTED',
  'EXTERNAL',
] as const;
export type AosPipelineNodeStatus = (typeof AOS_PIPELINE_NODE_STATUSES)[number];

export const AOS_PIPELINE_AUTHORITIES = ['NONE', 'OWNER', 'CORE', 'EXECUTION_WORKER'] as const;
export type AosPipelineAuthority = (typeof AOS_PIPELINE_AUTHORITIES)[number];

export const AOS_PIPELINE_EDGE_KINDS = [
  'EVENT',
  'EVIDENCE',
  'REASONING',
  'RECOMMENDATION',
  'AUTHORIZED_ACTION',
  'OUTCOME',
  'FEEDBACK',
] as const;
export type AosPipelineEdgeKind = (typeof AOS_PIPELINE_EDGE_KINDS)[number];

export interface AosPipelineNode {
  readonly nodeId: string;
  readonly label: string;
  readonly group: string;
  readonly owner: 'QUICKFURNO_CORE' | 'AOS' | 'JARVIS' | 'OWNER' | 'AUTOMATION' | 'AGENTS';
  readonly status: AosPipelineNodeStatus;
  readonly authority: AosPipelineAuthority;
  readonly implementationRef: string;
  readonly description: string;
  readonly x: number;
  readonly y: number;
}

export interface AosPipelineEdge {
  readonly edgeId: string;
  readonly sourceNodeId: string;
  readonly targetNodeId: string;
  readonly kind: AosPipelineEdgeKind;
  readonly label: string;
}

export interface AosPipelineDefinition {
  readonly protocol: 'qfj.aos.pipeline.v1';
  readonly mode: 'SUGGEST';
  readonly executionAuthority: 'NONE';
  readonly businessEffect: false;
  readonly nodes: readonly AosPipelineNode[];
  readonly edges: readonly AosPipelineEdge[];
}

const node = (input: AosPipelineNode): AosPipelineNode => Object.freeze(input);
const edge = (input: AosPipelineEdge): AosPipelineEdge => Object.freeze(input);

export const AOS_PIPELINE_V1: AosPipelineDefinition = Object.freeze({
  protocol: 'qfj.aos.pipeline.v1',
  mode: 'SUGGEST',
  executionAuthority: 'NONE',
  businessEffect: false,
  nodes: Object.freeze([
    node({
      nodeId: 'core.events',
      label: 'Core evidence & projections',
      group: 'Observe',
      owner: 'QUICKFURNO_CORE',
      status: 'EXTERNAL',
      authority: 'CORE',
      implementationRef: 'packages.aos-core-event-bridge',
      description:
        'Authoritative events and bounded lead/client/vendor/marketplace projections. AOS never fabricates missing business truth.',
      x: 0,
      y: 140,
    }),
    node({
      nodeId: 'aos.sentry',
      label: 'Sentry & detectors',
      group: 'Observe',
      owner: 'AOS',
      status: 'SHADOW',
      authority: 'NONE',
      implementationRef: 'packages.aos-intelligence.sentry',
      description: 'Deterministic SLA, invariant, journey, anomaly and supply-demand detectors.',
      x: 260,
      y: 140,
    }),
    node({
      nodeId: 'aos.case-engine',
      label: 'Case engine + context',
      group: 'Correlate',
      owner: 'AOS',
      status: 'SHADOW',
      authority: 'NONE',
      implementationRef: 'packages.aos-intelligence.case-engine',
      description:
        'Correlates signals across cycles into bounded cases and non-authoritative case context memory.',
      x: 520,
      y: 140,
    }),
    node({
      nodeId: 'aos.evidence',
      label: 'Evidence minimizer',
      group: 'Understand',
      owner: 'AOS',
      status: 'SHADOW',
      authority: 'NONE',
      implementationRef: 'packages.aos-intelligence.evidence',
      description: 'Builds compact source-bound evidence packets with no direct contact PII.',
      x: 780,
      y: 140,
    }),
    node({
      nodeId: 'aos.policy-route',
      label: 'Behaviour + cost router',
      group: 'Understand',
      owner: 'AOS',
      status: 'IMPLEMENTED',
      authority: 'NONE',
      implementationRef: 'packages.aos-intelligence.routing',
      description:
        'Known governed cases stay NO_MODEL. Novel/conflicting/high-risk cases may enter a budget-gated model route.',
      x: 1040,
      y: 140,
    }),
    node({
      nodeId: 'jarvis.model-control',
      label: 'Certified model selection',
      group: 'Reason',
      owner: 'JARVIS',
      status: 'IMPLEMENTED',
      authority: 'NONE',
      implementationRef: 'packages.aos-governance-integration.model-control',
      description:
        'Model Intelligence Control selects only an exact verifier-backed capable release; missing certification fails closed.',
      x: 1300,
      y: 20,
    }),
    node({
      nodeId: 'jarvis.openai-reasoning',
      label: 'Governed model reasoning',
      group: 'Reason',
      owner: 'JARVIS',
      status: 'NOT_CONNECTED',
      authority: 'NONE',
      implementationRef: 'packages.aos-model-reasoning',
      description:
        'Closed-schema AOS reasoning over minimized evidence. A live AOS-specific certified provider binding is not enabled on this branch.',
      x: 1560,
      y: 20,
    }),
    node({
      nodeId: 'aos.critic',
      label: 'Evidence critic',
      group: 'Verify',
      owner: 'AOS',
      status: 'SHADOW',
      authority: 'NONE',
      implementationRef: 'packages.aos-intelligence.recommendation',
      description:
        'Rechecks action vocabulary, evidence binding, policy references, confidence and authority posture.',
      x: 1820,
      y: 100,
    }),
    node({
      nodeId: 'jarvis.jev-adjudication',
      label: 'Optional Jev adjudication',
      group: 'Verify',
      owner: 'JARVIS',
      status: 'NOT_CONNECTED',
      authority: 'NONE',
      implementationRef: 'packages.aos-governance-integration.decision-adjudication',
      description:
        'Selective second opinion for novel/conflicting/high-review cases. Disagreement or failure creates a human-review hold.',
      x: 2080,
      y: 20,
    }),
    node({
      nodeId: 'aos.policy-validator',
      label: 'Governed policy binding',
      group: 'Verify',
      owner: 'AOS',
      status: 'IMPLEMENTED',
      authority: 'NONE',
      implementationRef: 'packages.aos-behaviour-control',
      description:
        'Binds exact policy versions/configuration to reviewed SUGGEST_SHADOW behaviour. Policies cannot create new capabilities.',
      x: 1300,
      y: 260,
    }),
    node({
      nodeId: 'jarvis.simulation',
      label: 'Digital Twin rehearsal',
      group: 'Policy governance',
      owner: 'JARVIS',
      status: 'IMPLEMENTED',
      authority: 'NONE',
      implementationRef: 'packages.aos-governance-integration.digital-twin',
      description:
        'Zero-effect baseline/candidate replay is mandatory for policy revisions before owner review eligibility.',
      x: 1560,
      y: 300,
    }),
    node({
      nodeId: 'aos.canonical-recommendation',
      label: 'Canonical recommendation',
      group: 'Recommend',
      owner: 'JARVIS',
      status: 'SHADOW',
      authority: 'NONE',
      implementationRef: 'packages.aos-governance-integration.canonical-recommendation',
      description:
        'Projects accepted AOS advice into the existing fingerprintable inert recommendation contract. Holds are not projected.',
      x: 2340,
      y: 120,
    }),
    node({
      nodeId: 'jarvis.owner-attention',
      label: 'Owner attention',
      group: 'Review',
      owner: 'JARVIS',
      status: 'SHADOW',
      authority: 'OWNER',
      implementationRef: 'apps.jarvis-os.aos',
      description:
        'Ranks cases into NOW / SOON / DIGEST. Outbound owner notification remains separately gated.',
      x: 2600,
      y: 20,
    }),
    node({
      nodeId: 'core.authorization',
      label: 'Core authorization',
      group: 'Review',
      owner: 'QUICKFURNO_CORE',
      status: 'EXTERNAL',
      authority: 'CORE',
      implementationRef: 'packages.core-decision-adapter',
      description:
        'QuickFurno Core revalidates current truth and remains the final business-decision authority.',
      x: 2600,
      y: 220,
    }),
    node({
      nodeId: 'automation.worker',
      label: 'Automation Worker',
      group: 'Act',
      owner: 'AUTOMATION',
      status: 'EXTERNAL',
      authority: 'EXECUTION_WORKER',
      implementationRef: 'quickfurno-core-automation',
      description: 'Executes only an action already authorized through the Core-controlled path.',
      x: 2860,
      y: 220,
    }),
    node({
      nodeId: 'agents.communication',
      label: 'Riya / Anisha / Aarohi',
      group: 'Act',
      owner: 'AGENTS',
      status: 'EXTERNAL',
      authority: 'NONE',
      implementationRef: 'apps.api.quickfurno-whatsapp',
      description:
        'Communicate only after the existing Core/communication authorization boundaries allow it.',
      x: 3120,
      y: 220,
    }),
    node({
      nodeId: 'aos.outcome-feedback',
      label: 'Outcome & maturity evidence',
      group: 'Learn',
      owner: 'AOS',
      status: 'SHADOW',
      authority: 'NONE',
      implementationRef: 'packages.aos-intelligence.maturity',
      description:
        'Measures recommendation quality and can only make a capability eligible for later review—not grant authority.',
      x: 2860,
      y: 420,
    }),
  ]),
  edges: Object.freeze([
    edge({
      edgeId: 'aos.e01',
      sourceNodeId: 'core.events',
      targetNodeId: 'aos.sentry',
      kind: 'EVENT',
      label: 'authoritative evidence',
    }),
    edge({
      edgeId: 'aos.e02',
      sourceNodeId: 'aos.sentry',
      targetNodeId: 'aos.case-engine',
      kind: 'EVENT',
      label: 'signals',
    }),
    edge({
      edgeId: 'aos.e03',
      sourceNodeId: 'aos.case-engine',
      targetNodeId: 'aos.evidence',
      kind: 'EVIDENCE',
      label: 'correlated case',
    }),
    edge({
      edgeId: 'aos.e04',
      sourceNodeId: 'aos.evidence',
      targetNodeId: 'aos.policy-route',
      kind: 'EVIDENCE',
      label: 'minimized evidence',
    }),
    edge({
      edgeId: 'aos.e05',
      sourceNodeId: 'aos.policy-route',
      targetNodeId: 'aos.critic',
      kind: 'RECOMMENDATION',
      label: 'deterministic NO_MODEL',
    }),
    edge({
      edgeId: 'aos.e06',
      sourceNodeId: 'aos.policy-route',
      targetNodeId: 'jarvis.model-control',
      kind: 'REASONING',
      label: 'model warranted',
    }),
    edge({
      edgeId: 'aos.e07',
      sourceNodeId: 'jarvis.model-control',
      targetNodeId: 'jarvis.openai-reasoning',
      kind: 'REASONING',
      label: 'certified release',
    }),
    edge({
      edgeId: 'aos.e08',
      sourceNodeId: 'jarvis.openai-reasoning',
      targetNodeId: 'aos.critic',
      kind: 'REASONING',
      label: 'structured candidate',
    }),
    edge({
      edgeId: 'aos.e09',
      sourceNodeId: 'aos.policy-validator',
      targetNodeId: 'aos.policy-route',
      kind: 'EVIDENCE',
      label: 'exact behaviour binding',
    }),
    edge({
      edgeId: 'aos.e10',
      sourceNodeId: 'aos.policy-validator',
      targetNodeId: 'jarvis.simulation',
      kind: 'EVIDENCE',
      label: 'policy revision',
    }),
    edge({
      edgeId: 'aos.e11',
      sourceNodeId: 'jarvis.simulation',
      targetNodeId: 'aos.policy-validator',
      kind: 'FEEDBACK',
      label: 'zero-effect rehearsal',
    }),
    edge({
      edgeId: 'aos.e12',
      sourceNodeId: 'aos.critic',
      targetNodeId: 'jarvis.jev-adjudication',
      kind: 'RECOMMENDATION',
      label: 'selective second opinion',
    }),
    edge({
      edgeId: 'aos.e13',
      sourceNodeId: 'aos.critic',
      targetNodeId: 'aos.canonical-recommendation',
      kind: 'RECOMMENDATION',
      label: 'routine critic pass',
    }),
    edge({
      edgeId: 'aos.e14',
      sourceNodeId: 'jarvis.jev-adjudication',
      targetNodeId: 'aos.canonical-recommendation',
      kind: 'RECOMMENDATION',
      label: 'advisory agrees',
    }),
    edge({
      edgeId: 'aos.e15',
      sourceNodeId: 'jarvis.jev-adjudication',
      targetNodeId: 'jarvis.owner-attention',
      kind: 'RECOMMENDATION',
      label: 'hold for human review',
    }),
    edge({
      edgeId: 'aos.e16',
      sourceNodeId: 'aos.canonical-recommendation',
      targetNodeId: 'jarvis.owner-attention',
      kind: 'RECOMMENDATION',
      label: 'rank for review',
    }),
    edge({
      edgeId: 'aos.e17',
      sourceNodeId: 'aos.canonical-recommendation',
      targetNodeId: 'core.authorization',
      kind: 'RECOMMENDATION',
      label: 'proposal only',
    }),
    edge({
      edgeId: 'aos.e18',
      sourceNodeId: 'core.authorization',
      targetNodeId: 'automation.worker',
      kind: 'AUTHORIZED_ACTION',
      label: 'authorized intent',
    }),
    edge({
      edgeId: 'aos.e19',
      sourceNodeId: 'automation.worker',
      targetNodeId: 'agents.communication',
      kind: 'AUTHORIZED_ACTION',
      label: 'governed execution',
    }),
    edge({
      edgeId: 'aos.e20',
      sourceNodeId: 'automation.worker',
      targetNodeId: 'aos.outcome-feedback',
      kind: 'OUTCOME',
      label: 'action outcome',
    }),
    edge({
      edgeId: 'aos.e21',
      sourceNodeId: 'jarvis.owner-attention',
      targetNodeId: 'aos.outcome-feedback',
      kind: 'FEEDBACK',
      label: 'owner decision',
    }),
    edge({
      edgeId: 'aos.e22',
      sourceNodeId: 'agents.communication',
      targetNodeId: 'aos.outcome-feedback',
      kind: 'OUTCOME',
      label: 'communication result',
    }),
    edge({
      edgeId: 'aos.e23',
      sourceNodeId: 'aos.outcome-feedback',
      targetNodeId: 'aos.sentry',
      kind: 'FEEDBACK',
      label: 'evaluation only',
    }),
  ]),
});
