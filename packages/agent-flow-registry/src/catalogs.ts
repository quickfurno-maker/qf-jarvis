import type {
  AgentFlowActionDefinition,
  AgentFlowEventDefinition,
  AgentFlowTriggerDefinition,
} from './contracts.js';

export const AGENT_FLOW_TRIGGER_CATALOG_V1: readonly AgentFlowTriggerDefinition[] = Object.freeze([
  Object.freeze({
    triggerId: 'trigger.whatsapp.inbound',
    actor: 'SHARED',
    label: 'WhatsApp inbound',
    status: 'IMPLEMENTED',
    implementationRef: 'apps.quickfurno-gateway',
    description:
      'A validated inbound WhatsApp message enters the durable QuickFurno/Jarvis turn path.',
  }),
  Object.freeze({
    triggerId: 'trigger.riya.lead-qualification',
    actor: 'RIYA',
    label: 'Lead qualification turn',
    status: 'IMPLEMENTED',
    implementationRef: 'apps.api.quickfurno-whatsapp.turn-processor',
    description:
      'Core-bound Phase-1 qualification work is claimed with the dedicated lead_qualification purpose.',
  }),
  Object.freeze({
    triggerId: 'trigger.riya.follow-up-due',
    actor: 'RIYA',
    label: 'Client follow-up due',
    status: 'PLANNED',
    implementationRef: 'packages.durable-orchestration-contracts',
    description:
      'Approved future Riya follow-up wake trigger; durable orchestration primitives already exist underneath.',
  }),
  Object.freeze({
    triggerId: 'trigger.anisha.vendor-event',
    actor: 'ANISHA',
    label: 'Vendor lifecycle event',
    status: 'PLANNED',
    implementationRef: 'packages.event-backbone',
    description: 'Future Anisha flow trigger sourced from canonical vendor lifecycle events.',
  }),
  Object.freeze({
    triggerId: 'trigger.aarohi.prospect-event',
    actor: 'AAROHI',
    label: 'Prospect acquisition event',
    status: 'PLANNED',
    implementationRef: 'packages.event-backbone',
    description: 'Future Aarohi flow trigger sourced from acquisition/prospect events.',
  }),
]);

export const AGENT_FLOW_ACTION_CATALOG_V1: readonly AgentFlowActionDefinition[] = Object.freeze([
  Object.freeze({
    actionId: 'action.riya.record-vendor-feedback',
    actor: 'RIYA',
    label: 'Record client vendor feedback',
    status: 'IMPLEMENTED',
    authority: 'CORE_GOVERNED_ACTION',
    effect: 'GOVERNED_ACTION',
    implementationRef: 'apps.api.quickfurno-whatsapp.createQuickFurnoClientVendorFeedbackWriter',
    description:
      'Signed, evidence-bound client feedback request. Core independently validates and persists truth.',
  }),
  Object.freeze({
    actionId: 'action.riya.request-match',
    actor: 'RIYA',
    label: 'Request Core vendor match',
    status: 'IMPLEMENTED',
    authority: 'CORE_GOVERNED_ACTION',
    effect: 'GOVERNED_ACTION',
    implementationRef: 'apps.api.quickfurno-whatsapp.createQuickFurnoClientMatchRequestWriter',
    description:
      'Signed revision-bound match request. QuickFurno Core revalidates readiness and owns matching.',
  }),
  Object.freeze({
    actionId: 'action.shared.write-whatsapp-reply',
    actor: 'SHARED',
    label: 'Queue WhatsApp reply through Core',
    status: 'IMPLEMENTED',
    authority: 'CORE_GOVERNED_ACTION',
    effect: 'CHANNEL_REQUEST',
    implementationRef: 'apps.api.quickfurno-whatsapp.createQuickFurnoWhatsAppReplyWriter',
    description:
      'Queues a governed conversational reply through the existing Core/provider boundary.',
  }),
  Object.freeze({
    actionId: 'action.shared.request-human-takeover',
    actor: 'SHARED',
    label: 'Request human takeover',
    status: 'DISABLED',
    authority: 'CORE_GOVERNED_ACTION',
    effect: 'GOVERNED_ACTION',
    implementationRef: 'packages.jao-action-registry.request_human_takeover',
    description: 'Reviewed proposal path exists but is disabled by the engineering registry.',
  }),
]);

export const AGENT_FLOW_EVENT_CATALOG_V1: readonly AgentFlowEventDefinition[] = Object.freeze([
  Object.freeze({
    eventId: 'event.core.client-vendor-feedback-result',
    actor: 'RIYA',
    label: 'Client vendor feedback result',
    status: 'IMPLEMENTED',
    eventClass: 'FLOW_RESULT',
    sourceRef: 'apps.api.quickfurno-whatsapp.client-vendor-feedback',
    description: 'Core result accepted by the turn processor before context refresh.',
  }),
  Object.freeze({
    eventId: 'event.core.client-match-result',
    actor: 'RIYA',
    label: 'Client match result',
    status: 'IMPLEMENTED',
    eventClass: 'FLOW_RESULT',
    sourceRef: 'apps.api.quickfurno-whatsapp.client-match-request',
    description: 'Core match result accepted before the specialist/model turn.',
  }),
  Object.freeze({
    eventId: 'event.channel.reply-queued',
    actor: 'SHARED',
    label: 'WhatsApp reply queued',
    status: 'IMPLEMENTED',
    eventClass: 'CHANNEL_EVENT',
    sourceRef: 'apps.api.quickfurno-whatsapp.reply-writer',
    description: 'Core accepted a reply request and returned its queue result.',
  }),
  Object.freeze({
    eventId: 'event.core.vendor-lifecycle',
    actor: 'ANISHA',
    label: 'Vendor lifecycle event',
    status: 'PLANNED',
    eventClass: 'CORE_EVENT',
    sourceRef: 'packages.event-backbone',
    description: 'Future canonical vendor event wake source for Anisha.',
  }),
  Object.freeze({
    eventId: 'event.core.prospect-lifecycle',
    actor: 'AAROHI',
    label: 'Prospect lifecycle event',
    status: 'PLANNED',
    eventClass: 'CORE_EVENT',
    sourceRef: 'packages.event-backbone',
    description: 'Future acquisition/prospect wake source for Aarohi.',
  }),
]);
