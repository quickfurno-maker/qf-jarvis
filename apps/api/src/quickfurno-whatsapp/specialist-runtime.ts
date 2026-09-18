import { createInboundEnvelope } from '@qf-jarvis/agent-runtime';
import type { CoreAuthorizedReplyJarvisRuntime } from '@qf-jarvis/jarvis-runtime';
import type { RiyaCustomerTurnRunner } from '../riya-customer-orchestration/create-riya-customer-runtime.js';
import { runCustomerTurnWorkflow } from '../riya-customer-orchestration/mastra-customer-turn-runner.js';
import type {
  QuickFurnoWhatsAppAgent,
  QuickFurnoWhatsAppAuthorizedReply,
  QuickFurnoWhatsAppTurnMaterialV1,
} from './contracts.js';

export interface QuickFurnoWhatsAppSpecialistRuntime {
  process(
    material: QuickFurnoWhatsAppTurnMaterialV1,
  ): Promise<QuickFurnoWhatsAppAuthorizedReply | null>;
}

export interface QuickFurnoWhatsAppSpecialistRuntimeConfig {
  readonly runtimeId: string;
  readonly riya: RiyaCustomerTurnRunner;
  readonly jarvisRuntime: CoreAuthorizedReplyJarvisRuntime;
}

const expectedSubjectByActor: Readonly<
  Record<QuickFurnoWhatsAppAgent, QuickFurnoWhatsAppTurnMaterialV1['subjectType']>
> = Object.freeze({ RIYA: 'client', ANISHA: 'vendor', AAROHI: 'prospect' });

function replyFrom(
  material: QuickFurnoWhatsAppTurnMaterialV1,
  authorizedReply:
    | {
        readonly proposalId: string;
        readonly boundRevision: number;
        readonly replyBody: string;
      }
    | undefined,
): QuickFurnoWhatsAppAuthorizedReply | null {
  if (authorizedReply === undefined) return null;
  if (authorizedReply.boundRevision !== material.conversationRevision) return null;
  if (authorizedReply.replyBody.length < 1 || authorizedReply.replyBody.length > 4096) return null;
  return Object.freeze({
    actor: material.assignedActor,
    proposalId: authorizedReply.proposalId,
    boundRevision: authorizedReply.boundRevision,
    body: authorizedReply.replyBody,
  });
}
export function createQuickFurnoWhatsAppSpecialistRuntime(
  config: QuickFurnoWhatsAppSpecialistRuntimeConfig,
): QuickFurnoWhatsAppSpecialistRuntime {
  if (!/^[A-Za-z0-9._:-]{1,128}$/u.test(config.runtimeId)) {
    throw new TypeError('quickfurno-whatsapp-runtime-id-invalid');
  }

  return Object.freeze({
    async process(material: QuickFurnoWhatsAppTurnMaterialV1) {
      if (expectedSubjectByActor[material.assignedActor] !== material.subjectType) {
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
          ...(material.normalizedText === undefined
            ? {}
            : { normalizedText: material.normalizedText }),
        });
        return replyFrom(material, result.authorizedReply);
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
        ...(material.normalizedText === undefined
          ? {}
          : { normalizedText: material.normalizedText }),
      });
      const result = await runCustomerTurnWorkflow(
        () => config.jarvisRuntime.processInboundForCoreAuthorizedReply(envelope),
        'WHATSAPP',
        {},
      );
      return replyFrom(material, result.authorizedReply);
    },
  });
}
