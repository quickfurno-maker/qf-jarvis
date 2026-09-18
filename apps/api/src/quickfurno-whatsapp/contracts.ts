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
export type QuickFurnoWhatsAppInboundMessageType =
  | 'text' | 'button_reply' | 'list_reply'
  | 'image' | 'document' | 'audio' | 'video' | 'sticker'
  | 'location' | 'contact' | 'reaction' | 'order' | 'system' | 'unsupported';

export interface QuickFurnoWhatsAppInboundMaterialV1 {
  readonly version: 1;
  readonly messageType: QuickFurnoWhatsAppInboundMessageType;
  readonly normalizedText?: string;
  readonly attachment?: {
    readonly kind: 'image' | 'document' | 'audio' | 'video' | 'sticker';
    readonly mediaId: string;
    readonly mimeType?: string;
    readonly caption?: string;
    readonly filename?: string;
  };
  readonly selection?: {
    readonly id?: string;
    readonly title?: string;
    readonly description?: string;
  };
  readonly replyContext?: { readonly providerMessageId: string };
  readonly referral?: { readonly sourceType?: string; readonly sourceId?: string };
  readonly reaction?: { readonly emoji?: string; readonly targetProviderMessageId?: string };
  readonly order?: {
    readonly itemCount: number;
    readonly catalogId?: string;
  };
  readonly forwarded?: boolean;
  readonly frequentlyForwarded?: boolean;
}

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
  readonly inbound: QuickFurnoWhatsAppInboundMaterialV1;
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
