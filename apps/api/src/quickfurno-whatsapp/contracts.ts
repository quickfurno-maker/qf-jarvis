export const QFJ_WHATSAPP_TURN_MATERIAL_PROTOCOL = 'qfj.whatsapp.turn-material' as const;
export const QFJ_WHATSAPP_TURN_MATERIAL_VERSION = 1 as const;
export const QFJ_WHATSAPP_TURN_MATERIAL_PATH =
  '/api/internal/jarvis/whatsapp-turn-material' as const;
export const QFJ_WHATSAPP_TURN_MATERIAL_SIGNING_DOMAIN =
  'qfj.whatsapp.turn-material.http.sig.v1' as const;
export const QFJ_WHATSAPP_REPLY_PROTOCOL = 'qfj.whatsapp.reply' as const;
export const QFJ_WHATSAPP_REPLY_VERSION = 2 as const;
export const QFJ_WHATSAPP_REPLY_PATH = '/api/internal/jarvis/whatsapp-reply' as const;
export const QFJ_WHATSAPP_REPLY_SIGNING_DOMAIN = 'qfj.whatsapp.reply.http.sig.v2' as const;

export type QuickFurnoWhatsAppAgent = 'AAROHI' | 'ANISHA' | 'RIYA';
export type QuickFurnoWhatsAppSubjectType = 'prospect' | 'client' | 'vendor';

export interface QuickFurnoWhatsAppTurnMaterialV1 {
  readonly protocol: typeof QFJ_WHATSAPP_TURN_MATERIAL_PROTOCOL;
  readonly version: 1;
  readonly requestId: string;
  readonly conversationId: string;
  readonly inboundMessageId: string;
  readonly conversationRevision: number;
  readonly assignedActor: QuickFurnoWhatsAppAgent;
  readonly subjectType: QuickFurnoWhatsAppSubjectType;
  readonly tenantId: 'quickfurno.marketplace';
  readonly dataClass: 'HOSTED_ALLOWED';
  readonly subjectRef?: string;
  readonly receivedAt: string;
  readonly normalizedText?: string;
}

export interface QuickFurnoWhatsAppExperienceV1 {
  readonly version: 1;
  readonly actor: QuickFurnoWhatsAppAgent;
  readonly kind: 'text';
  readonly body: string;
}

export interface QuickFurnoWhatsAppAuthorizedReply {
  readonly actor: QuickFurnoWhatsAppAgent;
  readonly proposalId: string;
  readonly boundRevision: number;
  readonly body: string;
}
