export const QFJ_WHATSAPP_TURN_MATERIAL_PROTOCOL = 'qfj.whatsapp.turn-material' as const;
export const QFJ_WHATSAPP_TURN_MATERIAL_VERSION = 2 as const;
export const QFJ_WHATSAPP_TURN_MATERIAL_PATH =
  '/api/internal/jarvis/whatsapp-turn-material' as const;
export const QFJ_WHATSAPP_TURN_MATERIAL_SIGNING_DOMAIN =
  'qfj.whatsapp.turn-material.http.sig.v2' as const;
export const QFJ_WHATSAPP_CONVERSATION_CONTEXT_PROTOCOL =
  'qfj.whatsapp.conversation-context' as const;
export const QFJ_WHATSAPP_CONVERSATION_CONTEXT_VERSION = 1 as const;
export const QFJ_WHATSAPP_CONVERSATION_CONTEXT_PATH =
  '/api/internal/jarvis/whatsapp-conversation-context' as const;
export const QFJ_WHATSAPP_CONVERSATION_CONTEXT_SIGNING_DOMAIN =
  'qfj.whatsapp.conversation-context.http.sig.v1' as const;
export const QFJ_WHATSAPP_MEDIA_CONTENT_PROTOCOL = 'qfj.whatsapp.media-content' as const;
export const QFJ_WHATSAPP_MEDIA_CONTENT_VERSION = 1 as const;
export const QFJ_WHATSAPP_MEDIA_CONTENT_PATH =
  '/api/internal/jarvis/whatsapp-media-content' as const;
export const QFJ_WHATSAPP_MEDIA_CONTENT_SIGNING_DOMAIN =
  'qfj.whatsapp.media-content.http.sig.v1' as const;
export const QFJ_WHATSAPP_MEDIA_REQUEST_ID_HEADER = 'x-qfj-media-request-id' as const;
export const QFJ_WHATSAPP_MEDIA_CONVERSATION_ID_HEADER = 'x-qfj-media-conversation-id' as const;
export const QFJ_WHATSAPP_MEDIA_INBOUND_ID_HEADER = 'x-qfj-media-inbound-id' as const;
export const QFJ_WHATSAPP_MEDIA_REVISION_HEADER = 'x-qfj-media-revision' as const;
export const QFJ_WHATSAPP_MEDIA_ID_HEADER = 'x-qfj-media-id' as const;
export const QFJ_WHATSAPP_MEDIA_KIND_HEADER = 'x-qfj-media-kind' as const;
export const QFJ_WHATSAPP_MEDIA_SHA256_HEADER = 'x-qfj-media-sha256' as const;
export const QFJ_WHATSAPP_REPLY_PROTOCOL = 'qfj.whatsapp.reply' as const;
export const QFJ_WHATSAPP_REPLY_VERSION = 2 as const;
export const QFJ_WHATSAPP_REPLY_QUALIFICATION_VERSION = 3 as const;
export const QFJ_WHATSAPP_REPLY_JOURNEY_VERSION = 4 as const;
export const QFJ_WHATSAPP_REPLY_PATH = '/api/internal/jarvis/whatsapp-reply' as const;
export const QFJ_WHATSAPP_REPLY_SIGNING_DOMAIN = 'qfj.whatsapp.reply.http.sig.v2' as const;
export const QFJ_WHATSAPP_REPLY_QUALIFICATION_SIGNING_DOMAIN =
  'qfj.whatsapp.reply.http.sig.v3' as const;
export const QFJ_WHATSAPP_REPLY_JOURNEY_SIGNING_DOMAIN = 'qfj.whatsapp.reply.http.sig.v4' as const;
export const QFJ_CLIENT_MATCH_REQUEST_PROTOCOL = 'qfj.client-match.request' as const;
export const QFJ_CLIENT_MATCH_REQUEST_VERSION = 1 as const;
export const QFJ_CLIENT_MATCH_REQUEST_PATH = '/api/internal/jarvis/client-match-request' as const;
export const QFJ_CLIENT_MATCH_REQUEST_SIGNING_DOMAIN =
  'qfj.client-match.request.http.sig.v1' as const;
export const QFJ_CLIENT_VENDOR_FEEDBACK_PROTOCOL = 'qfj.client-vendor-feedback.request' as const;
export const QFJ_CLIENT_VENDOR_FEEDBACK_VERSION = 1 as const;
export const QFJ_CLIENT_VENDOR_FEEDBACK_PATH =
  '/api/internal/jarvis/client-vendor-feedback' as const;
export const QFJ_CLIENT_VENDOR_FEEDBACK_SIGNING_DOMAIN =
  'qfj.client-vendor-feedback.http.sig.v1' as const;

export type QuickFurnoWhatsAppAgent = 'AAROHI' | 'ANISHA' | 'RIYA';
export type QuickFurnoWhatsAppAuthorityActor = QuickFurnoWhatsAppAgent | 'HUMAN' | 'SYSTEM';
export type QuickFurnoWhatsAppSubjectType = 'unknown' | 'prospect' | 'client' | 'vendor';
export type QuickFurnoWhatsAppPartyType = 'CLIENT' | 'VENDOR' | 'PROSPECT' | 'UNKNOWN';
export type QuickFurnoWhatsAppConversationState = 'OPEN' | 'PAUSED' | 'HUMAN' | 'CLOSED';
export type QuickFurnoWhatsAppDataClass = 'HOSTED_ALLOWED' | 'LOCAL_ONLY' | 'HUMAN_ONLY';
export type QuickFurnoWhatsAppSubjectStatus =
  'clear' | 'erased' | 'anonymised' | 'tombstoned' | 'in-progress';

export type QuickFurnoWhatsAppMediaKind = 'image' | 'document' | 'audio' | 'video' | 'sticker';

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

export type QuickFurnoClientJourneyField =
  | 'serviceInterest'
  | 'location'
  | 'propertyType'
  | 'scope'
  | 'budget'
  | 'timeline'
  | 'consultationPreference';

export type QuickFurnoClientJourneyPhase =
  | 'INTRO'
  | 'NEED'
  | 'LOCATION'
  | 'PROJECT_DETAILS'
  | 'BUDGET_TIMELINE'
  | 'SUMMARY'
  | 'CONTACT'
  | 'CONSENT'
  | 'COMPLETE';

export interface QuickFurnoClientJourneySnapshotV1 {
  readonly version: 1;
  readonly profileId: string;
  readonly profileRevision: number;
  readonly profileStatus: 'discovering' | 'known' | 'inactive';
  readonly isFirstContact: boolean;
  readonly name?: string;
  readonly preferredLanguage?: 'en' | 'hi' | 'hinglish' | 'other';
  readonly missing: readonly ('name' | QuickFurnoClientJourneyField)[];
  readonly activeRequirement: {
    readonly requirementId: string;
    readonly revision: number;
    readonly status: 'discovering' | 'ready_for_lead' | 'converted' | 'closed' | 'cancelled';
    readonly phase: QuickFurnoClientJourneyPhase;
    readonly summaryConfirmed: boolean;
    readonly provenance: Readonly<
      Partial<Record<QuickFurnoClientJourneyField, 'user_stated' | 'model_inferred'>>
    >;
    readonly serviceInterest?: string;
    readonly location?: string;
    readonly propertyType?: string;
    readonly scope?: string;
    readonly budget?: string;
    readonly timeline?: string;
    readonly consultationPreference?: string;
  };
}

export interface QuickFurnoClientJourneySnapshotV2 extends Omit<
  QuickFurnoClientJourneySnapshotV1,
  'version'
> {
  readonly version: 2;
  readonly isReturningClient: boolean;
  readonly createdAt: string;
  readonly lastSeenAt: string;
  readonly properties: readonly {
    readonly propertyId: string;
    readonly relation: 'current' | 'historical';
    readonly area?: string;
    readonly propertyType?: string;
    readonly bhk?: string;
    readonly projectStage?: string;
    readonly possessionDate?: string;
  }[];
  readonly pastRequirements: readonly {
    readonly requirementId: string;
    readonly categoryRef: string;
    readonly propertyId?: string;
    readonly status: 'converted' | 'closed' | 'cancelled';
    readonly closedAt?: string;
  }[];
}

export type QuickFurnoClientJourneySnapshot =
  QuickFurnoClientJourneySnapshotV1 | QuickFurnoClientJourneySnapshotV2;

export type QuickFurnoClientMatchState =
  | 'REQUIREMENT_INCOMPLETE'
  | 'LEAD_REQUIRED'
  | 'NEEDS_ENRICHMENT'
  | 'READY'
  | 'PARTIALLY_MATCHED'
  | 'MATCHED'
  | 'WAITING_FOR_SUPPLY'
  | 'BLOCKED';

export interface QuickFurnoClientMatchDecisionV1 {
  readonly version: 1;
  readonly state: QuickFurnoClientMatchState;
  readonly requirementId: string;
  readonly requirementRevision: number;
  readonly leadId?: string;
  readonly assignmentCount: number;
  readonly missingFields: readonly string[];
  readonly reasonCode: string;
  readonly coreReady: boolean;
  readonly executionAuthorized: false;
}

export type QuickFurnoClientMatchRequestOutcome =
  | 'matched'
  | 'partially_matched'
  | 'waiting_for_supply'
  | 'already_resolved'
  | 'not_ready'
  | 'blocked'
  | 'stale'
  | 'retry_later';

export interface QuickFurnoClientMatchRequestResultV1 {
  readonly protocol: typeof QFJ_CLIENT_MATCH_REQUEST_PROTOCOL;
  readonly version: 1;
  readonly requestId: string;
  readonly outcome: QuickFurnoClientMatchRequestOutcome;
  readonly leadId: string;
  readonly assignmentCount: number;
  readonly reasonCode: string;
  readonly providerAuthority: 'quickfurno-core';
}

export type QuickFurnoClientVendorFeedbackEventType =
  | 'client_confirmed_contact'
  | 'client_reported_no_contact'
  | 'client_satisfied'
  | 'client_dissatisfied'
  | 'client_complaint'
  | 'reassignment_requested';

export interface QuickFurnoExplicitClientVendorFeedback {
  readonly assignmentOrdinal: number;
  readonly eventType: QuickFurnoClientVendorFeedbackEventType;
}

export type QuickFurnoClientVendorFeedbackOutcome =
  'recorded' | 'already_recorded' | 'stale' | 'blocked' | 'retry_later';

export interface QuickFurnoClientVendorFeedbackResultV1 {
  readonly protocol: typeof QFJ_CLIENT_VENDOR_FEEDBACK_PROTOCOL;
  readonly version: 1;
  readonly requestId: string;
  readonly outcome: QuickFurnoClientVendorFeedbackOutcome;
  readonly assignmentOrdinal: number;
  readonly eventType: QuickFurnoClientVendorFeedbackEventType;
  readonly reasonCode: string;
  readonly providerAuthority: 'quickfurno-core';
}

export type QuickFurnoClientVendorSatisfactionState =
  'UNKNOWN' | 'SATISFIED' | 'DISSATISFIED' | 'COMPLAINT';

export type QuickFurnoClientVendorReassignmentState =
  'NONE' | 'REQUESTED' | 'AUTHORIZED' | 'REJECTED';

export interface QuickFurnoClientVendorJourneyV1 {
  readonly version: 1;
  readonly requirementId: string;
  readonly requirementRevision: number;
  readonly vendorsReleased: number;
  readonly vendorNoContactCount: number;
  readonly allReleasedVendorsContacted: boolean;
  readonly satisfactionState: QuickFurnoClientVendorSatisfactionState;
  readonly serviceRecoveryNeeded: boolean;
  readonly reassignmentState: QuickFurnoClientVendorReassignmentState;
  readonly followUpDue: boolean;
}

export interface QuickFurnoCoreAvailabilitySnapshotV1 {
  readonly version: 1;
  readonly snapshotRef: string;
  readonly taxonomyVersion: number;
  readonly cities: readonly { readonly ref: string; readonly displayName: string }[];
  readonly services: readonly { readonly ref: string; readonly displayName: string }[];
  readonly availability: readonly {
    readonly serviceRef: string;
    readonly cityRefs: 'ALL' | readonly string[];
  }[];
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
  /** Present only for the upgraded Riya client-memory lane. */
  readonly clientJourney?: QuickFurnoClientJourneySnapshot;
  /** Current QuickFurno Core decision about whether the active requirement may enter matching. */
  readonly clientMatchDecision?: QuickFurnoClientMatchDecisionV1;
  /** Core-owned vendor-contact/satisfaction summary for the active requirement. */
  readonly clientVendorJourney?: QuickFurnoClientVendorJourneyV1;
  /** Current QuickFurno Core service/city authority captured for the same Riya turn. */
  readonly coreAvailability?: QuickFurnoCoreAvailabilitySnapshotV1;
}

export interface QuickFurnoWhatsAppConversationContextV1 {
  readonly version: 1;
  readonly authority: 'NON_AUTHORITATIVE_CONVERSATION_CONTEXT';
  readonly text: string;
  readonly includedTurns: number;
  readonly truncated: boolean;
}

export interface QuickFurnoWhatsAppConversationContextEnvelopeV1 {
  readonly protocol: typeof QFJ_WHATSAPP_CONVERSATION_CONTEXT_PROTOCOL;
  readonly version: 1;
  readonly requestId: string;
  readonly tenantId: 'quickfurno';
  readonly conversationId: string;
  readonly revision: number;
  readonly inboundMessageId: string;
  readonly context: QuickFurnoWhatsAppConversationContextV1;
}

export interface QuickFurnoWhatsAppExperienceV1 {
  readonly version: 1;
  readonly actor: QuickFurnoWhatsAppAgent;
  readonly kind: 'text';
  readonly body: string;
}

export interface QuickFurnoClientJourneyProposalV1 {
  readonly version: 1;
  readonly profileId: string;
  readonly profileRevision: number;
  readonly requirementId: string;
  readonly requirementRevision: number;
  readonly nextPhase: QuickFurnoClientJourneyPhase;
  readonly summaryConfirmed: boolean;
  readonly name?: {
    readonly value: string;
    readonly provenance: 'user_stated';
  };
  readonly sets: readonly {
    readonly field: QuickFurnoClientJourneyField;
    readonly value: string;
    readonly provenance: 'user_stated' | 'model_inferred';
  }[];
  readonly clears: readonly {
    readonly field: QuickFurnoClientJourneyField;
    readonly provenance: 'user_stated';
  }[];
}

export interface QuickFurnoWhatsAppReplyProposal {
  readonly actor: QuickFurnoWhatsAppAgent;
  readonly proposalId: string;
  readonly boundRevision: number;
  readonly body: string;
  readonly clientJourneyProposal?: QuickFurnoClientJourneyProposalV1;
}

export type QuickFurnoQualificationTarget = 'budget' | 'timeline' | 'propertyType';

export interface QuickFurnoLeadQualificationMaterialV1 {
  readonly protocol: typeof QFJ_WHATSAPP_TURN_MATERIAL_PROTOCOL;
  readonly version: 2;
  readonly requestId: string;
  readonly tenantId: 'quickfurno';
  readonly conversationId: string;
  readonly revision: number;
  readonly purpose: 'lead_qualification';
  readonly assignedActor: 'RIYA';
  readonly inboundMessageId: string;
  readonly receivedAt: string;
  readonly dataClass: 'HOSTED_ALLOWED';
  readonly qualification: {
    readonly requestId: string;
    readonly target: QuickFurnoQualificationTarget;
    readonly questionText: string;
    readonly allowedOptions: readonly string[];
    readonly answerText: string;
  };
}

export interface QuickFurnoQualificationProposal {
  readonly actor: 'RIYA';
  readonly proposalId: string;
  readonly boundRevision: number;
  readonly qualificationRequestId: string;
  readonly inboundMessageId: string;
  readonly target: QuickFurnoQualificationTarget;
  readonly outcome: 'matched' | 'no_match';
  readonly value?: string;
}

export type QuickFurnoWhatsAppWorkerMaterial =
  QuickFurnoWhatsAppTurnMaterialV2 | QuickFurnoLeadQualificationMaterialV1;

export type QuickFurnoWhatsAppWorkerProposal =
  QuickFurnoWhatsAppReplyProposal | QuickFurnoQualificationProposal;
