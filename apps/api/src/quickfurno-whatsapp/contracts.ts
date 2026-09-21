export const QFJ_WHATSAPP_TURN_MATERIAL_PROTOCOL = 'qfj.whatsapp.turn-material' as const;
export const QFJ_WHATSAPP_TURN_MATERIAL_VERSION = 2 as const;
export const QFJ_WHATSAPP_TURN_MATERIAL_PATH =
  '/api/internal/jarvis/whatsapp-turn-material' as const;
export const QFJ_WHATSAPP_TURN_MATERIAL_SIGNING_DOMAIN =
  'qfj.whatsapp.turn-material.http.sig.v2' as const;
export const QFJ_WHATSAPP_REPLY_PROTOCOL = 'qfj.whatsapp.reply' as const;
export const QFJ_WHATSAPP_REPLY_VERSION = 2 as const;
export const QFJ_WHATSAPP_REPLY_PATH = '/api/internal/jarvis/whatsapp-reply' as const;
export const QFJ_WHATSAPP_REPLY_SIGNING_DOMAIN = 'qfj.whatsapp.reply.http.sig.v2' as const;

export type QuickFurnoWhatsAppAgent = 'AAROHI' | 'ANISHA' | 'RIYA';
export type QuickFurnoWhatsAppAuthorityActor = QuickFurnoWhatsAppAgent | 'HUMAN' | 'SYSTEM';
export type QuickFurnoWhatsAppSubjectType = 'unknown' | 'prospect' | 'client' | 'vendor';
export type QuickFurnoWhatsAppPartyType = 'CLIENT' | 'VENDOR' | 'PROSPECT' | 'UNKNOWN';
export type QuickFurnoWhatsAppConversationState = 'OPEN' | 'PAUSED' | 'HUMAN' | 'CLOSED';
export type QuickFurnoWhatsAppDataClass = 'HOSTED_ALLOWED' | 'LOCAL_ONLY' | 'HUMAN_ONLY';
export type QuickFurnoWhatsAppSubjectStatus =
  'clear' | 'erased' | 'anonymised' | 'tombstoned' | 'in-progress';

export type QuickFurnoWhatsAppInboundMessageType =
  | 'text'
  | 'button_reply'
  | 'list_reply'
  | 'image'
  | 'document'
  | 'audio'
  | 'video'
  | 'sticker'
  | 'location'
  | 'contact'
  | 'reaction'
  | 'order'
  | 'system'
  | 'unsupported';

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
  readonly referral?: {
    readonly sourceType?: string;
    readonly sourceId?: string;
  };
  readonly reaction?: {
    readonly emoji?: string;
    readonly targetProviderMessageId?: string;
  };
  readonly order?: {
    readonly itemCount: number;
    readonly catalogId?: string;
  };
  readonly forwarded?: boolean;
  readonly frequentlyForwarded?: boolean;
}

export interface QuickFurnoWhatsAppAuthorityStateV2 {
  readonly protocol: typeof QFJ_WHATSAPP_TURN_MATERIAL_PROTOCOL;
  readonly version: 2;
  readonly requestId: string;
  readonly tenantId: 'quickfurno';
  readonly conversationId: string;
  readonly revision: number;
  readonly assignedActor: QuickFurnoWhatsAppAuthorityActor;
  readonly subjectType: QuickFurnoWhatsAppSubjectType;
  readonly partyType: QuickFurnoWhatsAppPartyType;
  readonly conversationState: QuickFurnoWhatsAppConversationState;
  readonly jarvisAllowed: boolean;
  readonly dataClass: QuickFurnoWhatsAppDataClass;
  readonly humanTakeover: boolean;
  readonly aiPaused: boolean;
  readonly cancelled: boolean;
  readonly subjectStatus: QuickFurnoWhatsAppSubjectStatus;
  readonly subjectRef?: string;
  readonly observedAt: string;
}

export interface QuickFurnoWhatsAppTurnMaterialV2 extends Omit<
  QuickFurnoWhatsAppAuthorityStateV2,
  'assignedActor' | 'subjectType'
> {
  readonly assignedActor: QuickFurnoWhatsAppAgent;
  readonly subjectType: Exclude<QuickFurnoWhatsAppSubjectType, 'unknown'>;
  readonly inboundMessageId: string;
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

export interface QuickFurnoWhatsAppReplyProposal {
  readonly actor: QuickFurnoWhatsAppAgent;
  readonly proposalId: string;
  readonly boundRevision: number;
  readonly body: string;
}
