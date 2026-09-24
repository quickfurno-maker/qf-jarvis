import { createInboundEnvelope } from '@qf-jarvis/agent-runtime';
import type { ProposedReplyJarvisRuntime } from '@qf-jarvis/jarvis-runtime';
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

      // Production WhatsApp deliberately keeps Riya stateless inside Jarvis. QuickFurno owns the
      // durable turn, revision, consent and takeover evidence; this boundary must not create a second
      // store of client discovery state while its retention/erasure policy is unresolved. The richer
      // Riya continuity service remains available to separately governed surfaces.
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
