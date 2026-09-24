import { createInboundEnvelope } from '@qf-jarvis/agent-runtime';
import type { ProposedReplyJarvisRuntime } from '@qf-jarvis/jarvis-runtime';
import type { RiyaCustomerTurnRunner } from '../riya-customer-orchestration/create-riya-customer-runtime.js';
import { runCustomerTurnWorkflow } from '../riya-customer-orchestration/mastra-customer-turn-runner.js';
import type {
  QuickFurnoWhatsAppAgent,
  QuickFurnoWhatsAppReplyProposal,
  QuickFurnoWhatsAppTurnMaterialV2,
} from './contracts.js';

export interface QuickFurnoWhatsAppSpecialistRuntime {
  process(
    material: QuickFurnoWhatsAppTurnMaterialV2,
  ): Promise<QuickFurnoWhatsAppReplyProposal | null>;
}

export interface QuickFurnoWhatsAppSpecialistRuntimeConfig {
  readonly runtimeId: string;
  readonly riya: RiyaCustomerTurnRunner;
  readonly jarvisRuntime: ProposedReplyJarvisRuntime;
}

const expectedSubjectByActor: Readonly<
  Record<QuickFurnoWhatsAppAgent, QuickFurnoWhatsAppTurnMaterialV2['subjectType']>
> = Object.freeze({ RIYA: 'client', ANISHA: 'vendor', AAROHI: 'prospect' });

function proposalFrom(
  material: QuickFurnoWhatsAppTurnMaterialV2,
  proposal:
    | {
        readonly proposalId: string;
        readonly boundRevision: number;
        readonly replyBody: string;
      }
    | undefined,
): QuickFurnoWhatsAppReplyProposal | null {
  if (proposal === undefined) return null;
  if (proposal.boundRevision !== material.revision) return null;
  if (proposal.replyBody.length < 1 || proposal.replyBody.length > 4096) return null;
  return Object.freeze({
    actor: material.assignedActor,
    proposalId: proposal.proposalId,
    boundRevision: proposal.boundRevision,
    body: proposal.replyBody,
  });
}
export function createQuickFurnoWhatsAppSpecialistRuntime(
  config: QuickFurnoWhatsAppSpecialistRuntimeConfig,
): QuickFurnoWhatsAppSpecialistRuntime {
  if (!/^[A-Za-z0-9._:-]{1,128}$/u.test(config.runtimeId)) {
    throw new TypeError('quickfurno-whatsapp-runtime-id-invalid');
  }

  return Object.freeze({
    async process(material: QuickFurnoWhatsAppTurnMaterialV2) {
      if (expectedSubjectByActor[material.assignedActor] !== material.subjectType) {
        return null;
      }

      // The certified live provider is text-only. LOCAL_ONLY media may cross the separately signed
      // content bridge, but it must never be silently coerced into a hosted text-model turn.
      if (material.dataClass !== 'HOSTED_ALLOWED' || material.normalizedText === undefined) {
        return null;
      }

      if (material.assignedActor === 'RIYA') {
        const result = await config.riya.handleConversationTurn({
          version: 1,
          channel: 'WHATSAPP',
          tenantId: material.tenantId,
          conversationId: material.conversationId,
          messageId: material.inboundMessageId,
          receivedAt: material.receivedAt,
          channelTurnRef: `qf.inbound:${material.inboundMessageId}`,
          dataClass: material.dataClass,
          ...(material.subjectRef === undefined ? {} : { subjectRef: material.subjectRef }),
          normalizedText: material.normalizedText,
        });
        return proposalFrom(material, result.proposedReply);
      }

      const envelope = createInboundEnvelope({
        runtimeId: config.runtimeId,
        conversationId: material.conversationId,
        messageId: material.inboundMessageId,
        tenantId: material.tenantId,
        channel: 'WHATSAPP',
        partyType: material.assignedActor === 'ANISHA' ? 'VENDOR' : 'PROSPECT',
        direction: 'INBOUND',
        receivedAt: material.receivedAt,
        providerMessageRef: `qf.inbound:${material.inboundMessageId}`,
        dataClass: material.dataClass,
        ...(material.subjectRef === undefined ? {} : { subjectRef: material.subjectRef }),
        normalizedText: material.normalizedText,
      });
      const result = await runCustomerTurnWorkflow(
        () => config.jarvisRuntime.processInboundForProposedReply(envelope),
        'WHATSAPP',
        {},
      );
      return proposalFrom(material, result.proposedReply);
    },
  });
}
