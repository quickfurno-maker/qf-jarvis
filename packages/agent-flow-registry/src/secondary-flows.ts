import type {
  AgentFlowActor,
  AgentFlowDefinition,
  AgentFlowEdgeDefinition,
  AgentFlowGroupDefinition,
  AgentFlowNodeDefinition,
} from './contracts.js';
import { createAgentFlowDefinition } from './validate.js';

const BASELINE = 'qf-jarvis@f663d9b7df64ebc916ce260a8ac00c99ada757f6';

type SecondaryActor = Extract<AgentFlowActor, 'ANISHA' | 'AAROHI'>;

interface SecondaryFlowSpec {
  readonly actor: SecondaryActor;
  readonly prefix: 'anisha' | 'aarohi';
  readonly flowId: string;
  readonly label: string;
  readonly description: string;
  readonly contextLabel: string;
  readonly intelligenceLabel: string;
  readonly intelligenceRef: string;
  readonly scopeTag: string;
}

function group(
  spec: SecondaryFlowSpec,
  suffix: string,
  label: string,
  actor: AgentFlowActor,
  description: string,
  order: number,
): AgentFlowGroupDefinition {
  return Object.freeze({
    groupId: `${spec.prefix}.${suffix}`,
    label,
    actor,
    description,
    order,
  });
}

function node(
  spec: SecondaryFlowSpec,
  input: Omit<AgentFlowNodeDefinition, 'nodeId' | 'implementationVersionRef'> & {
    readonly suffix: string;
  },
): AgentFlowNodeDefinition {
  const { suffix, ...rest } = input;
  return Object.freeze({
    ...rest,
    nodeId: `${spec.prefix}.${suffix}`,
    implementationVersionRef: BASELINE,
  });
}

function edge(
  spec: SecondaryFlowSpec,
  id: number,
  source: string,
  target: string,
  kind: AgentFlowEdgeDefinition['kind'],
  options: Pick<AgentFlowEdgeDefinition, 'label' | 'conditionRef'> = {},
): AgentFlowEdgeDefinition {
  return Object.freeze({
    edgeId: `${spec.prefix}.e.${String(id).padStart(2, '0')}`,
    sourceNodeId: `${spec.prefix}.${source}`,
    targetNodeId: `${spec.prefix}.${target}`,
    kind,
    ...options,
  });
}

function createSecondaryFlow(spec: SecondaryFlowSpec): AgentFlowDefinition {
  const groups: readonly AgentFlowGroupDefinition[] = Object.freeze([
    group(
      spec,
      'inbound',
      'Inbound & durable claim',
      'SHARED',
      'Shared WhatsApp admission and turn claim.',
      10,
    ),
    group(
      spec,
      'context',
      spec.contextLabel,
      spec.actor,
      'Revision-bound Core material and bounded conversation context.',
      20,
    ),
    group(
      spec,
      'intelligence',
      spec.intelligenceLabel,
      spec.actor,
      'Domain reasoning plus the existing shared specialist runtime.',
      30,
    ),
    group(
      spec,
      'orchestration',
      'Controlled soft orchestration',
      spec.actor,
      'Typed route, wait, event-resume and human-handoff control only.',
      40,
    ),
    group(
      spec,
      'response',
      'Governed response',
      'SHARED',
      'Core-bound reply request and durable turn completion.',
      50,
    ),
  ]);

  const nodes: readonly AgentFlowNodeDefinition[] = Object.freeze([
    node(spec, {
      suffix: 'trigger.whatsapp-inbound',
      nodeVersion: 1,
      label: 'WhatsApp inbound',
      actor: 'SHARED',
      kind: 'TRIGGER',
      executionRole: 'STEP',
      stage: 'TRIGGER',
      authority: 'ORCHESTRATION_CONTROL',
      effect: 'NONE',
      status: 'IMPLEMENTED',
      implementationRef: 'apps.quickfurno-gateway',
      description: 'Validated inbound message enters the existing durable turn path.',
      codeLocked: true,
      canvasEditable: [],
      groupId: `${spec.prefix}.inbound`,
      tags: ['whatsapp', 'trigger'],
    }),
    node(spec, {
      suffix: 'queue.claim-turn',
      nodeVersion: 1,
      label: 'Claim durable turn',
      actor: 'SHARED',
      kind: 'ORCHESTRATION',
      executionRole: 'STEP',
      stage: 'IDENTIFY',
      authority: 'ORCHESTRATION_CONTROL',
      effect: 'NONE',
      status: 'IMPLEMENTED',
      implementationRef: 'apps.api.quickfurno-whatsapp.QuickFurnoWhatsAppTurnQueue.claimNext',
      description: 'Claims the actor-bound turn under existing concurrency protection.',
      codeLocked: true,
      canvasEditable: ['retryPolicyRef'],
      groupId: `${spec.prefix}.inbound`,
      tags: ['queue', 'durable'],
    }),
    node(spec, {
      suffix: 'context.turn-material',
      nodeVersion: 1,
      label: 'Read Core turn material',
      actor: spec.actor,
      kind: 'CONTEXT',
      executionRole: 'STEP',
      stage: 'LOAD_CONTEXT',
      authority: 'READ_ONLY',
      effect: 'READ_ONLY',
      status: 'IMPLEMENTED',
      implementationRef: 'apps.api.quickfurno-whatsapp.QuickFurnoWhatsAppMaterialReader.read',
      description: 'Reads the exact revision-bound Core material for this agent turn.',
      codeLocked: true,
      canvasEditable: ['contextProfileRef', 'timeoutPolicyRef', 'fallbackNodeId'],
      groupId: `${spec.prefix}.context`,
      tags: ['core', 'context', spec.scopeTag],
    }),
    node(spec, {
      suffix: 'context.conversation',
      nodeVersion: 1,
      label: 'Read bounded conversation context',
      actor: spec.actor,
      kind: 'CONTEXT',
      executionRole: 'STEP',
      stage: 'LOAD_CONTEXT',
      authority: 'READ_ONLY',
      effect: 'READ_ONLY',
      status: 'IMPLEMENTED',
      implementationRef:
        'apps.api.quickfurno-whatsapp.QuickFurnoWhatsAppConversationContextReader.read',
      description: 'Loads non-authoritative bounded conversation context from the existing reader.',
      codeLocked: true,
      canvasEditable: ['contextProfileRef', 'timeoutPolicyRef'],
      groupId: `${spec.prefix}.context`,
      tags: ['conversation', 'context'],
    }),
    node(spec, {
      suffix: 'context.authority-scope',
      nodeVersion: 1,
      label: `${spec.actor} authority scope`,
      actor: spec.actor,
      kind: 'CONTEXT',
      executionRole: 'PROJECTION',
      stage: 'LOAD_CONTEXT',
      authority: 'READ_ONLY',
      effect: 'READ_ONLY',
      status: 'IMPLEMENTED',
      implementationRef: 'apps.api.quickfurno-whatsapp.contracts.QuickFurnoWhatsAppTurnMaterialV2',
      description:
        'Uses Core-supplied assigned actor, subject type, party type and control posture.',
      codeLocked: true,
      canvasEditable: ['contextProfileRef'],
      groupId: `${spec.prefix}.context`,
      tags: ['authority', 'scope', spec.scopeTag],
    }),
    node(spec, {
      suffix: 'intelligence.domain',
      nodeVersion: 1,
      label: spec.intelligenceLabel,
      actor: spec.actor,
      kind: 'INTELLIGENCE',
      executionRole: 'DECISION',
      stage: 'UNDERSTAND',
      authority: 'AGENT_INTERPRET',
      effect: 'NONE',
      status: 'IMPLEMENTED',
      implementationRef: spec.intelligenceRef,
      description:
        'Uses the existing domain package; it cannot authorize or execute business effects.',
      codeLocked: true,
      canvasEditable: ['contextProfileRef', 'toolProfileRef'],
      groupId: `${spec.prefix}.intelligence`,
      tags: [spec.scopeTag, 'domain-intelligence'],
    }),
    node(spec, {
      suffix: 'agent.specialist-runtime',
      nodeVersion: 1,
      label: `${spec.actor} specialist runtime`,
      actor: spec.actor,
      kind: 'INTELLIGENCE',
      executionRole: 'STEP',
      stage: 'DECIDE',
      authority: 'AGENT_PROPOSE',
      effect: 'PROPOSAL_ONLY',
      status: 'IMPLEMENTED',
      implementationRef: 'apps.api.quickfurno-whatsapp.createQuickFurnoWhatsAppSpecialistRuntime',
      description: 'Reuses the shared three-agent runtime and versioned prompt/model routing.',
      codeLocked: true,
      canvasEditable: [
        'promptProfileRef',
        'modelRoutingProfileRef',
        'toolProfileRef',
        'fallbackNodeId',
      ],
      groupId: `${spec.prefix}.intelligence`,
      tags: [spec.prefix, 'model', 'proposal'],
    }),
    node(spec, {
      suffix: 'condition.next-step',
      nodeVersion: 1,
      label: 'Safe next-step router',
      actor: spec.actor,
      kind: 'ORCHESTRATION',
      executionRole: 'DECISION',
      stage: 'DECIDE',
      authority: 'ORCHESTRATION_CONTROL',
      effect: 'NONE',
      status: 'SHADOW',
      implementationRef: 'packages.agent-flow-orchestration.evaluateAgentFlowRoute',
      description:
        'Evaluates only closed typed conditions over supplied signals; no arbitrary expressions.',
      codeLocked: true,
      canvasEditable: ['conditionRef', 'fallbackNodeId'],
      groupId: `${spec.prefix}.orchestration`,
      tags: ['condition', 'phase3'],
    }),
    node(spec, {
      suffix: 'wait.durable',
      nodeVersion: 1,
      label: 'Bounded durable wait',
      actor: spec.actor,
      kind: 'ORCHESTRATION',
      executionRole: 'STEP',
      stage: 'WAIT_CONTINUE_CLOSE',
      authority: 'ORCHESTRATION_CONTROL',
      effect: 'NONE',
      status: 'SHADOW',
      implementationRef: 'packages.agent-flow-orchestration.createAgentFlowDurableWaitPlan',
      description:
        'Compiles a bounded Temporal journey wait with no execution authority in the canvas.',
      codeLocked: true,
      canvasEditable: ['waitPolicyRef', 'fallbackNodeId'],
      groupId: `${spec.prefix}.orchestration`,
      tags: ['wait', 'temporal', 'phase3'],
    }),
    node(spec, {
      suffix: 'event.resume',
      nodeVersion: 1,
      label: 'Resume from governed event',
      actor: spec.actor,
      kind: 'ORCHESTRATION',
      executionRole: 'STEP',
      stage: 'WAIT_CONTINUE_CLOSE',
      authority: 'ORCHESTRATION_CONTROL',
      effect: 'NONE',
      status: 'SHADOW',
      implementationRef: 'packages.agent-flow-orchestration.createAgentFlowResumeSignal',
      description:
        'Creates a validated content-free wake signal for the existing durable workflow.',
      codeLocked: true,
      canvasEditable: ['conditionRef', 'fallbackNodeId'],
      groupId: `${spec.prefix}.orchestration`,
      tags: ['event', 'resume', 'temporal'],
    }),
    node(spec, {
      suffix: 'human.handoff',
      nodeVersion: 1,
      label: 'Request human takeover',
      actor: spec.actor,
      kind: 'HUMAN',
      executionRole: 'CAPABILITY',
      stage: 'ACT_OR_RESPOND',
      authority: 'CORE_GOVERNED_ACTION',
      effect: 'GOVERNED_ACTION',
      status: 'DISABLED',
      implementationRef: 'packages.jao-action-registry.request_human_takeover',
      description:
        'Governed proposal remains registry-gated; the canvas cannot enable or execute it.',
      codeLocked: true,
      canvasEditable: ['fallbackNodeId'],
      groupId: `${spec.prefix}.orchestration`,
      tags: ['human', 'handoff', 'core-proposal'],
    }),
    node(spec, {
      suffix: 'action.write-reply',
      nodeVersion: 1,
      label: 'Queue governed reply',
      actor: 'SHARED',
      kind: 'CHANNEL',
      executionRole: 'CHANNEL',
      stage: 'ACT_OR_RESPOND',
      authority: 'CORE_GOVERNED_ACTION',
      effect: 'CHANNEL_REQUEST',
      status: 'IMPLEMENTED',
      implementationRef: 'apps.api.quickfurno-whatsapp.createQuickFurnoWhatsAppReplyWriter',
      description: 'Submits the reply through the existing signed Core/provider boundary.',
      codeLocked: true,
      canvasEditable: ['timeoutPolicyRef', 'retryPolicyRef', 'fallbackNodeId'],
      groupId: `${spec.prefix}.response`,
      tags: ['reply', 'whatsapp', 'core'],
    }),
    node(spec, {
      suffix: 'queue.complete',
      nodeVersion: 1,
      label: 'Finalize durable turn',
      actor: 'SHARED',
      kind: 'SYSTEM',
      executionRole: 'TERMINAL',
      stage: 'WAIT_CONTINUE_CLOSE',
      authority: 'ORCHESTRATION_CONTROL',
      effect: 'NONE',
      status: 'IMPLEMENTED',
      implementationRef: 'apps.api.quickfurno-whatsapp.QuickFurnoWhatsAppTurnQueue.complete',
      description: 'Marks the claimed turn complete after a governed result is accepted.',
      codeLocked: true,
      canvasEditable: [],
      groupId: `${spec.prefix}.response`,
      tags: ['queue', 'terminal'],
    }),
  ]);

  const edges: readonly AgentFlowEdgeDefinition[] = Object.freeze([
    edge(spec, 1, 'trigger.whatsapp-inbound', 'queue.claim-turn', 'CONTROL'),
    edge(spec, 2, 'queue.claim-turn', 'context.turn-material', 'CONTROL'),
    edge(spec, 3, 'queue.claim-turn', 'context.conversation', 'CONTROL', {
      label: 'parallel context',
    }),
    edge(spec, 4, 'context.turn-material', 'context.authority-scope', 'DATA'),
    edge(spec, 5, 'context.authority-scope', 'intelligence.domain', 'DATA'),
    edge(spec, 6, 'intelligence.domain', 'agent.specialist-runtime', 'DATA'),
    edge(spec, 7, 'context.conversation', 'agent.specialist-runtime', 'DATA'),
    edge(spec, 8, 'agent.specialist-runtime', 'condition.next-step', 'CONTROL'),
    edge(spec, 9, 'condition.next-step', 'action.write-reply', 'COMMAND', {
      label: 'reply',
      conditionRef: `${spec.prefix}.route.reply`,
    }),
    edge(spec, 10, 'condition.next-step', 'wait.durable', 'CONTROL', {
      label: 'wait / follow-up',
      conditionRef: `${spec.prefix}.route.wait`,
    }),
    edge(spec, 11, 'condition.next-step', 'human.handoff', 'COMMAND', {
      label: 'human review',
      conditionRef: `${spec.prefix}.route.human`,
    }),
    edge(spec, 12, 'wait.durable', 'event.resume', 'EVENT', { label: 'timer / Core event' }),
    edge(spec, 13, 'event.resume', 'agent.specialist-runtime', 'EVENT', { label: 'resume' }),
    edge(spec, 14, 'human.handoff', 'queue.complete', 'RESULT'),
    edge(spec, 15, 'action.write-reply', 'queue.complete', 'RESULT'),
  ]);

  return createAgentFlowDefinition({
    registrySchemaVersion: 1,
    implementationBaselineRef: BASELINE,
    verifiedAt: '2026-09-30',
    readOnly: true,
    flowId: spec.flowId,
    flowVersion: 1,
    label: spec.label,
    actor: spec.actor,
    status: 'SHADOW',
    description: spec.description,
    rootNodeId: `${spec.prefix}.trigger.whatsapp-inbound`,
    groups,
    nodes,
    edges,
  });
}

export const ANISHA_VENDOR_FLOW_V1 = createSecondaryFlow({
  actor: 'ANISHA',
  prefix: 'anisha',
  flowId: 'agent-flow.anisha.whatsapp-vendor.v1',
  label: 'Anisha — registered-vendor journey',
  description:
    'Phase 3 controlled vendor journey built on the existing shared runtime; soft orchestration remains shadow until deployment.',
  contextLabel: 'Vendor context',
  intelligenceLabel: 'Vendor journey intelligence',
  intelligenceRef: 'packages.anisha-agent.decideAnishaTurn',
  scopeTag: 'vendor',
});

export const AAROHI_ACQUISITION_FLOW_V1 = createSecondaryFlow({
  actor: 'AAROHI',
  prefix: 'aarohi',
  flowId: 'agent-flow.aarohi.whatsapp-prospect.v1',
  label: 'Aarohi — acquisition journey',
  description:
    'Phase 3 acquisition journey over existing prospect-domain contracts; orchestration remains shadow and Core-gated.',
  contextLabel: 'Prospect context',
  intelligenceLabel: 'Acquisition intelligence',
  intelligenceRef: 'packages.aarohi-agent.evaluateAcquisitionContactEligibility',
  scopeTag: 'prospect',
});
