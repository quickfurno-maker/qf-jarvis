import { createInboundEnvelope } from '@qf-jarvis/agent-runtime';
import type { ProposedReplyJarvisRuntime } from '@qf-jarvis/jarvis-runtime';
import { composeConversationAwareInput } from '@qf-jarvis/semantic-context-engine';
import { runCustomerTurnWorkflow } from '../riya-customer-orchestration/mastra-customer-turn-runner.js';
import type {
  QuickFurnoLeadQualificationMaterialV1,
  QuickFurnoQualificationProposal,
  QuickFurnoWhatsAppAgent,
  QuickFurnoWhatsAppConversationContextV1,
  QuickFurnoWhatsAppReplyProposal,
  QuickFurnoWhatsAppTurnMaterialV2,
  QuickFurnoWhatsAppWorkerMaterial,
  QuickFurnoWhatsAppWorkerProposal,
} from './contracts.js';

export interface QuickFurnoWhatsAppSpecialistRuntime {
  process(
    material: QuickFurnoWhatsAppWorkerMaterial,
    conversationContext?: QuickFurnoWhatsAppConversationContextV1,
  ): Promise<QuickFurnoWhatsAppWorkerProposal | null>;
}

export interface QuickFurnoWhatsAppSpecialistRuntimeConfig {
  readonly runtimeId: string;
  readonly jarvisRuntime: ProposedReplyJarvisRuntime;
}

function isQualificationMaterial(
  material: QuickFurnoWhatsAppWorkerMaterial,
): material is QuickFurnoLeadQualificationMaterialV1 {
  return 'purpose' in material;
}

const expectedSubjectByActor: Readonly<
  Record<QuickFurnoWhatsAppAgent, QuickFurnoWhatsAppTurnMaterialV2['subjectType']>
> = Object.freeze({ RIYA: 'client', ANISHA: 'vendor', AAROHI: 'prospect' });

function conversationProposal(
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

function qualificationResult(
  material: QuickFurnoLeadQualificationMaterialV1,
  proposal:
    | {
        readonly proposalId: string;
        readonly boundRevision: number;
        readonly replyBody: string;
      }
    | undefined,
): QuickFurnoQualificationProposal {
  const candidate =
    proposal?.boundRevision === material.revision ? proposal.replyBody.trim() : null;
  const exact =
    candidate !== null && material.qualification.allowedOptions.includes(candidate)
      ? candidate
      : null;
  return Object.freeze({
    actor: 'RIYA',
    proposalId:
      proposal?.proposalId ??
      `riya-qualification:${material.qualification.requestId}:${material.inboundMessageId}`,
    boundRevision: material.revision,
    qualificationRequestId: material.qualification.requestId,
    inboundMessageId: material.inboundMessageId,
    target: material.qualification.target,
    outcome: exact === null ? 'no_match' : 'matched',
    ...(exact === null ? {} : { value: exact }),
  });
}

function qualificationPrompt(material: QuickFurnoLeadQualificationMaterialV1): string {
  return [
    'QuickFurno qualification interpretation.',
    `Question: ${material.qualification.questionText}`,
    `Client answer: ${material.qualification.answerText}`,
    `Allowed options: ${material.qualification.allowedOptions.join(' | ')}`,
    'Return EXACTLY one allowed option only when the client explicitly supports it.',
    'Otherwise return exactly __NO_MATCH__.',
    'Do not explain, infer, recommend, or add punctuation.',
  ].join('\n');
}

export function createQuickFurnoWhatsAppSpecialistRuntime(
  config: QuickFurnoWhatsAppSpecialistRuntimeConfig,
): QuickFurnoWhatsAppSpecialistRuntime {
  if (!/^[A-Za-z0-9._:-]{1,128}$/u.test(config.runtimeId)) {
    throw new TypeError('quickfurno-whatsapp-runtime-id-invalid');
  }

  return Object.freeze({
    async process(
      material: QuickFurnoWhatsAppWorkerMaterial,
      conversationContext?: QuickFurnoWhatsAppConversationContextV1,
    ) {
      if (isQualificationMaterial(material)) {
        const envelope = createInboundEnvelope({
          runtimeId: config.runtimeId,
          conversationId: material.conversationId,
          messageId: material.inboundMessageId,
          tenantId: material.tenantId,
          channel: 'WHATSAPP',
          partyType: 'CLIENT',
          direction: 'INBOUND',
          receivedAt: material.receivedAt,
          providerMessageRef: `qf.qualification:${material.inboundMessageId}`,
          dataClass: material.dataClass,
          normalizedText: qualificationPrompt(material),
        });
        try {
          const result = await runCustomerTurnWorkflow(
            () => config.jarvisRuntime.processInboundForProposedReply(envelope),
            'WHATSAPP',
            {},
          );
          return qualificationResult(material, result.proposedReply);
        } catch {
          // Qualification never retries the model after execution uncertainty.
          // Core receives no_match and deterministically re-asks the exact question.
          return qualificationResult(material, undefined);
        }
      }

      if (expectedSubjectByActor[material.assignedActor] !== material.subjectType) return null;
      if (material.dataClass !== 'HOSTED_ALLOWED' || material.normalizedText === undefined)
        return null;

      const envelope = createInboundEnvelope({
        runtimeId: config.runtimeId,
        conversationId: material.conversationId,
        messageId: material.inboundMessageId,
        tenantId: material.tenantId,
        channel: 'WHATSAPP',
        partyType:
          material.assignedActor === 'RIYA'
            ? 'CLIENT'
            : material.assignedActor === 'ANISHA'
              ? 'VENDOR'
              : 'PROSPECT',
        direction: 'INBOUND',
        receivedAt: material.receivedAt,
        providerMessageRef: `qf.inbound:${material.inboundMessageId}`,
        dataClass: material.dataClass,
        ...(material.subjectRef === undefined ? {} : { subjectRef: material.subjectRef }),
        normalizedText:
          conversationContext === undefined
            ? material.normalizedText
            : composeConversationAwareInput({
                currentText: material.normalizedText,
                summary: conversationContext,
              }),
      });
      const result = await runCustomerTurnWorkflow(
        () => config.jarvisRuntime.processInboundForProposedReply(envelope),
        'WHATSAPP',
        {},
      );
      return conversationProposal(material, result.proposedReply);
    },
  });
}
