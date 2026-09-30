import { createHash, createPrivateKey, sign, type KeyObject } from 'node:crypto';
import { parseCoreServiceAvailabilitySnapshotV1 } from '@qf-jarvis/core-service-availability-read';
import {
  QFJ_WHATSAPP_CONVERSATION_CONTEXT_PATH,
  QFJ_WHATSAPP_CONVERSATION_CONTEXT_PROTOCOL,
  QFJ_WHATSAPP_CONVERSATION_CONTEXT_SIGNING_DOMAIN,
  QFJ_WHATSAPP_REPLY_PATH,
  QFJ_WHATSAPP_REPLY_PROTOCOL,
  QFJ_WHATSAPP_REPLY_QUALIFICATION_SIGNING_DOMAIN,
  QFJ_WHATSAPP_REPLY_JOURNEY_SIGNING_DOMAIN,
  QFJ_WHATSAPP_REPLY_SIGNING_DOMAIN,
  QFJ_WHATSAPP_TURN_MATERIAL_PATH,
  QFJ_WHATSAPP_TURN_MATERIAL_PROTOCOL,
  QFJ_WHATSAPP_TURN_MATERIAL_SIGNING_DOMAIN,
  type QuickFurnoClientJourneyField,
  type QuickFurnoClientJourneyProposalV1,
  type QuickFurnoClientJourneySnapshot,
  type QuickFurnoClientJourneySnapshotV1,
  type QuickFurnoClientJourneySnapshotV2,
  type QuickFurnoClientMatchDecisionV1,
  type QuickFurnoClientVendorJourneyV1,
  type QuickFurnoCoreAvailabilitySnapshotV1,
  type QuickFurnoLeadQualificationMaterialV1,
  type QuickFurnoQualificationProposal,
  type QuickFurnoWhatsAppAuthorityStateV2,
  type QuickFurnoWhatsAppConversationContextEnvelopeV1,
  type QuickFurnoWhatsAppReplyProposal,
  type QuickFurnoWhatsAppTurnMaterialV2,
  type QuickFurnoWhatsAppWorkerMaterial,
  type QuickFurnoWhatsAppWorkerProposal,
} from './contracts.js';

const KEY_ID_HEADER = 'x-qfj-key-id';
const SIGNATURE_HEADER = 'x-qfj-signature';
const CALLER = 'qf-jarvis';
const AUDIENCE = 'quickfurno-core';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const KEY_ID = /^[A-Za-z0-9._:-]{1,64}$/u;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,239}$/u;
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u;
const DEFAULT_TIMEOUT_MS = 5_000;
const MAX_RESPONSE_BYTES = 12_288;

export type QuickFurnoWhatsAppHttpErrorCode =
  'invalid-config' | 'invalid-input' | 'request-failed' | 'response-invalid' | 'stale-revision';
export class QuickFurnoWhatsAppHttpError extends Error {
  readonly code: QuickFurnoWhatsAppHttpErrorCode;
  constructor(code: QuickFurnoWhatsAppHttpErrorCode) {
    super(code);
    this.name = 'QuickFurnoWhatsAppHttpError';
    this.code = code;
  }
}

export interface QuickFurnoWhatsAppHttpResponse {
  readonly status: number;
  text(): Promise<string>;
}
export type QuickFurnoWhatsAppHttpPost = (
  url: string,
  init: Readonly<{
    method: 'POST';
    headers: Readonly<Record<string, string>>;
    body: string;
    signal: AbortSignal;
    redirect: 'error';
  }>,
) => Promise<QuickFurnoWhatsAppHttpResponse>;

export interface QuickFurnoWhatsAppHttpConfig {
  readonly baseUrl: string;
  readonly keyId: string;
  readonly privateKeyPem: string;
  readonly clock: () => string;
  readonly requestId: () => string;
  readonly httpPost: QuickFurnoWhatsAppHttpPost;
  readonly timeoutMs?: number;
}
function endpointFor(baseUrl: string, path: string): string {
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new QuickFurnoWhatsAppHttpError('invalid-config');
  }
  const loopback =
    url.hostname === '127.0.0.1' || url.hostname === 'localhost' || url.hostname === '[::1]';
  if (
    (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== '/'
  ) {
    throw new QuickFurnoWhatsAppHttpError('invalid-config');
  }
  return new URL(path, url).toString();
}

function digestBase64Url(body: string): string {
  return createHash('sha256').update(Buffer.from(body, 'utf8')).digest('base64url');
}
function digestHex(value: string): string {
  return createHash('sha256').update(Buffer.from(value, 'utf8')).digest('hex');
}
function signingInput(
  domain: string,
  path: string,
  requestId: string,
  issuedAt: string,
  keyId: string,
  bodyDigest: string,
): string {
  return [domain, 'POST', path, CALLER, AUDIENCE, requestId, issuedAt, keyId, bodyDigest].join(
    '\n',
  );
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

const MATERIAL_MESSAGE_TYPES = [
  'text',
  'button_reply',
  'list_reply',
  'image',
  'document',
  'audio',
  'video',
  'sticker',
  'location',
  'contact',
  'reaction',
  'order',
  'system',
  'unsupported',
] as const;
const MATERIAL_MEDIA_TYPES = ['image', 'document', 'audio', 'video', 'sticker'] as const;
const MEDIA_ID = /^[A-Za-z0-9._:-]{1,256}$/u;

function onlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}
function canonicalPartyType(subjectType: string): QuickFurnoWhatsAppAuthorityStateV2['partyType'] {
  return subjectType === 'client'
    ? 'CLIENT'
    : subjectType === 'vendor'
      ? 'VENDOR'
      : subjectType === 'prospect'
        ? 'PROSPECT'
        : 'UNKNOWN';
}

function canonicalActorForSubject(
  subjectType: string,
): QuickFurnoWhatsAppAuthorityStateV2['assignedActor'] | null {
  return subjectType === 'client'
    ? 'RIYA'
    : subjectType === 'vendor'
      ? 'ANISHA'
      : subjectType === 'prospect'
        ? 'AAROHI'
        : null;
}

function boundedString(value: unknown, max: number, min = 1): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length >= min && trimmed.length <= max ? trimmed : null;
}
function parseInboundMaterial(value: unknown): QuickFurnoWhatsAppTurnMaterialV2['inbound'] | null {
  if (
    !isRecord(value) ||
    !onlyKeys(value, [
      'version',
      'messageType',
      'normalizedText',
      'attachment',
      'selection',
      'replyContext',
      'referral',
      'reaction',
      'order',
      'forwarded',
      'frequentlyForwarded',
    ])
  )
    return null;
  if (value['version'] !== 1) return null;
  const messageType = value['messageType'];
  if (
    typeof messageType !== 'string' ||
    !(MATERIAL_MESSAGE_TYPES as readonly string[]).includes(messageType)
  )
    return null;

  let normalizedText: string | undefined;
  if (value['normalizedText'] !== undefined) {
    normalizedText = boundedString(value['normalizedText'], 4096) ?? undefined;
    if (normalizedText === undefined) return null;
  }

  let attachment: QuickFurnoWhatsAppTurnMaterialV2['inbound']['attachment'];
  if (value['attachment'] !== undefined) {
    const raw = value['attachment'];
    if (!isRecord(raw) || !onlyKeys(raw, ['kind', 'mediaId', 'mimeType', 'caption', 'filename']))
      return null;
    const kind = raw['kind'];
    const mediaId = raw['mediaId'];
    if (typeof kind !== 'string' || !(MATERIAL_MEDIA_TYPES as readonly string[]).includes(kind))
      return null;
    if (kind !== messageType || typeof mediaId !== 'string' || !MEDIA_ID.test(mediaId)) return null;
    const mimeType =
      raw['mimeType'] === undefined
        ? undefined
        : (boundedString(raw['mimeType'], 128) ?? undefined);
    const caption =
      raw['caption'] === undefined ? undefined : (boundedString(raw['caption'], 1024) ?? undefined);
    const filename =
      raw['filename'] === undefined
        ? undefined
        : (boundedString(raw['filename'], 240) ?? undefined);
    if (raw['mimeType'] !== undefined && mimeType === undefined) return null;
    if (raw['caption'] !== undefined && caption === undefined) return null;
    if (raw['filename'] !== undefined && filename === undefined) return null;
    attachment = Object.freeze({
      kind: kind as NonNullable<typeof attachment>['kind'],
      mediaId,
      ...(mimeType ? { mimeType } : {}),
      ...(caption ? { caption } : {}),
      ...(filename ? { filename } : {}),
    });
  }

  let selection: QuickFurnoWhatsAppTurnMaterialV2['inbound']['selection'];
  if (value['selection'] !== undefined) {
    if (!['button_reply', 'list_reply'].includes(messageType)) return null;
    const raw = value['selection'];
    if (!isRecord(raw) || !onlyKeys(raw, ['id', 'title', 'description'])) return null;
    const id = raw['id'] === undefined ? undefined : (boundedString(raw['id'], 200) ?? undefined);
    const title =
      raw['title'] === undefined ? undefined : (boundedString(raw['title'], 240) ?? undefined);
    const description =
      raw['description'] === undefined
        ? undefined
        : (boundedString(raw['description'], 240) ?? undefined);
    if (raw['id'] !== undefined && id === undefined) return null;
    if (raw['title'] !== undefined && title === undefined) return null;
    if (raw['description'] !== undefined && description === undefined) return null;
    if (!id && !title && !description) return null;
    selection = Object.freeze({
      ...(id ? { id } : {}),
      ...(title ? { title } : {}),
      ...(description ? { description } : {}),
    });
  }

  let replyContext: QuickFurnoWhatsAppTurnMaterialV2['inbound']['replyContext'];
  if (value['replyContext'] !== undefined) {
    const raw = value['replyContext'];
    if (!isRecord(raw) || !onlyKeys(raw, ['providerMessageId'])) return null;
    const providerMessageId = boundedString(raw['providerMessageId'], 512);
    if (!providerMessageId) return null;
    replyContext = Object.freeze({ providerMessageId });
  }

  let referral: QuickFurnoWhatsAppTurnMaterialV2['inbound']['referral'];
  if (value['referral'] !== undefined) {
    const raw = value['referral'];
    if (!isRecord(raw) || !onlyKeys(raw, ['sourceType', 'sourceId'])) return null;
    const sourceType =
      raw['sourceType'] === undefined
        ? undefined
        : (boundedString(raw['sourceType'], 40) ?? undefined);
    const sourceId =
      raw['sourceId'] === undefined
        ? undefined
        : (boundedString(raw['sourceId'], 128) ?? undefined);
    if (raw['sourceType'] !== undefined && (!sourceType || !/^[a-z_]{1,40}$/iu.test(sourceType)))
      return null;
    if (raw['sourceId'] !== undefined && (!sourceId || !/^[A-Za-z0-9._:-]{1,128}$/u.test(sourceId)))
      return null;
    if (!sourceType && !sourceId) return null;
    referral = Object.freeze({
      ...(sourceType ? { sourceType } : {}),
      ...(sourceId ? { sourceId } : {}),
    });
  }

  let reaction: QuickFurnoWhatsAppTurnMaterialV2['inbound']['reaction'];
  if (value['reaction'] !== undefined) {
    if (messageType !== 'reaction') return null;
    const raw = value['reaction'];
    if (!isRecord(raw) || !onlyKeys(raw, ['emoji', 'targetProviderMessageId'])) return null;
    const emoji =
      raw['emoji'] === undefined ? undefined : (boundedString(raw['emoji'], 32) ?? undefined);
    const targetProviderMessageId =
      raw['targetProviderMessageId'] === undefined
        ? undefined
        : (boundedString(raw['targetProviderMessageId'], 512) ?? undefined);
    if (raw['emoji'] !== undefined && emoji === undefined) return null;
    if (raw['targetProviderMessageId'] !== undefined && targetProviderMessageId === undefined)
      return null;
    if (!emoji && !targetProviderMessageId) return null;
    reaction = Object.freeze({
      ...(emoji ? { emoji } : {}),
      ...(targetProviderMessageId ? { targetProviderMessageId } : {}),
    });
  }

  let order: QuickFurnoWhatsAppTurnMaterialV2['inbound']['order'];
  if (value['order'] !== undefined) {
    if (messageType !== 'order') return null;
    const raw = value['order'];
    if (!isRecord(raw) || !onlyKeys(raw, ['itemCount', 'catalogId'])) return null;
    const itemCount = raw['itemCount'];
    if (
      typeof itemCount !== 'number' ||
      !Number.isSafeInteger(itemCount) ||
      itemCount < 0 ||
      itemCount > 100
    )
      return null;
    const catalogId =
      raw['catalogId'] === undefined
        ? undefined
        : (boundedString(raw['catalogId'], 128) ?? undefined);
    if (
      raw['catalogId'] !== undefined &&
      (!catalogId || !/^[A-Za-z0-9._:-]{1,128}$/u.test(catalogId))
    )
      return null;
    order = Object.freeze({ itemCount, ...(catalogId ? { catalogId } : {}) });
  }

  if (value['forwarded'] !== undefined && typeof value['forwarded'] !== 'boolean') return null;
  if (
    value['frequentlyForwarded'] !== undefined &&
    typeof value['frequentlyForwarded'] !== 'boolean'
  )
    return null;

  return Object.freeze({
    version: 1,
    messageType: messageType as QuickFurnoWhatsAppTurnMaterialV2['inbound']['messageType'],
    ...(normalizedText ? { normalizedText } : {}),
    ...(attachment ? { attachment } : {}),
    ...(selection ? { selection } : {}),
    ...(replyContext ? { replyContext } : {}),
    ...(referral ? { referral } : {}),
    ...(reaction ? { reaction } : {}),
    ...(order ? { order } : {}),
    ...(value['forwarded'] === true ? { forwarded: true } : {}),
    ...(value['frequentlyForwarded'] === true ? { frequentlyForwarded: true } : {}),
  });
}
function parseAuthorityState(
  value: unknown,
  requestId: string,
): QuickFurnoWhatsAppAuthorityStateV2 | null {
  if (!isRecord(value)) return null;
  const required = [
    'protocol',
    'version',
    'requestId',
    'tenantId',
    'conversationId',
    'revision',
    'assignedActor',
    'subjectType',
    'partyType',
    'conversationState',
    'jarvisAllowed',
    'dataClass',
    'humanTakeover',
    'aiPaused',
    'cancelled',
    'subjectStatus',
    'observedAt',
  ];
  const allowed = [...required, 'subjectRef'];
  if (!onlyKeys(value, allowed) || !required.every((key) => key in value)) return null;

  const conversationId = value['conversationId'];
  const revision = value['revision'];
  const actor = value['assignedActor'];
  const subjectType = value['subjectType'];
  const partyType = value['partyType'];
  const conversationState = value['conversationState'];
  const dataClass = value['dataClass'];
  const subjectStatus = value['subjectStatus'];
  const subjectRef = value['subjectRef'];
  const observedAt = value['observedAt'];

  if (
    value['protocol'] !== QFJ_WHATSAPP_TURN_MATERIAL_PROTOCOL ||
    value['version'] !== 2 ||
    value['requestId'] !== requestId ||
    value['tenantId'] !== 'quickfurno'
  )
    return null;
  if (typeof conversationId !== 'string' || !UUID.test(conversationId)) return null;
  if (typeof revision !== 'number' || !Number.isSafeInteger(revision) || revision < 0) return null;
  if (typeof actor !== 'string' || !['RIYA', 'ANISHA', 'AAROHI', 'HUMAN', 'SYSTEM'].includes(actor))
    return null;
  if (
    typeof subjectType !== 'string' ||
    !['unknown', 'client', 'vendor', 'prospect'].includes(subjectType)
  )
    return null;
  if (
    typeof partyType !== 'string' ||
    !['UNKNOWN', 'CLIENT', 'VENDOR', 'PROSPECT'].includes(partyType)
  )
    return null;
  if (
    typeof conversationState !== 'string' ||
    !['OPEN', 'PAUSED', 'HUMAN', 'CLOSED'].includes(conversationState)
  )
    return null;
  if (
    typeof value['jarvisAllowed'] !== 'boolean' ||
    typeof value['humanTakeover'] !== 'boolean' ||
    typeof value['aiPaused'] !== 'boolean' ||
    typeof value['cancelled'] !== 'boolean'
  )
    return null;
  if (
    typeof dataClass !== 'string' ||
    !['HOSTED_ALLOWED', 'LOCAL_ONLY', 'HUMAN_ONLY'].includes(dataClass)
  )
    return null;
  if (
    typeof subjectStatus !== 'string' ||
    !['clear', 'erased', 'anonymised', 'tombstoned', 'in-progress'].includes(subjectStatus)
  )
    return null;
  if (subjectRef !== undefined && (typeof subjectRef !== 'string' || !UUID.test(subjectRef)))
    return null;
  if (
    typeof observedAt !== 'string' ||
    !INSTANT.test(observedAt) ||
    !Number.isFinite(Date.parse(observedAt))
  )
    return null;

  // QuickFurno owns routing truth, but Jarvis independently verifies the canonical relationship on
  // every signed authority read so actor drift cannot silently become a different specialist turn.
  if (partyType !== canonicalPartyType(subjectType)) return null;
  const canonicalActor = canonicalActorForSubject(subjectType);
  const isRiyaFirstContact =
    actor === 'RIYA' &&
    subjectType === 'client' &&
    partyType === 'CLIENT' &&
    dataClass === 'HOSTED_ALLOWED' &&
    subjectStatus === 'in-progress' &&
    subjectRef === undefined;
  if (
    value['jarvisAllowed'] &&
    (canonicalActor === null ||
      actor !== canonicalActor ||
      conversationState !== 'OPEN' ||
      value['humanTakeover'] ||
      value['aiPaused'] ||
      value['cancelled'] ||
      dataClass === 'HUMAN_ONLY' ||
      (!isRiyaFirstContact && (subjectStatus !== 'clear' || subjectRef === undefined)))
  ) {
    return null;
  }

  return Object.freeze({
    protocol: QFJ_WHATSAPP_TURN_MATERIAL_PROTOCOL,
    version: 2,
    requestId,
    tenantId: 'quickfurno',
    conversationId,
    revision,
    assignedActor: actor as QuickFurnoWhatsAppAuthorityStateV2['assignedActor'],
    subjectType: subjectType as QuickFurnoWhatsAppAuthorityStateV2['subjectType'],
    partyType,
    conversationState: conversationState as QuickFurnoWhatsAppAuthorityStateV2['conversationState'],
    jarvisAllowed: value['jarvisAllowed'],
    dataClass: dataClass as QuickFurnoWhatsAppAuthorityStateV2['dataClass'],
    humanTakeover: value['humanTakeover'],
    aiPaused: value['aiPaused'],
    cancelled: value['cancelled'],
    subjectStatus: subjectStatus as QuickFurnoWhatsAppAuthorityStateV2['subjectStatus'],
    ...(subjectRef === undefined ? {} : { subjectRef }),
    observedAt,
  });
}

const CLIENT_JOURNEY_FIELDS = [
  'serviceInterest',
  'location',
  'propertyType',
  'scope',
  'budget',
  'timeline',
  'consultationPreference',
] as const satisfies readonly QuickFurnoClientJourneyField[];
const CLIENT_JOURNEY_PHASES = [
  'INTRO',
  'NEED',
  'LOCATION',
  'PROJECT_DETAILS',
  'BUDGET_TIMELINE',
  'SUMMARY',
  'CONTACT',
  'CONSENT',
  'COMPLETE',
] as const;

function parseClientJourneyV1(value: unknown): QuickFurnoClientJourneySnapshotV1 | null {
  if (!isRecord(value)) return null;
  const allowed = [
    'version',
    'profileId',
    'profileRevision',
    'profileStatus',
    'isFirstContact',
    'name',
    'preferredLanguage',
    'missing',
    'activeRequirement',
  ];
  if (!onlyKeys(value, allowed)) return null;
  if (
    value['version'] !== 1 ||
    typeof value['profileId'] !== 'string' ||
    !UUID.test(value['profileId']) ||
    typeof value['profileRevision'] !== 'number' ||
    !Number.isSafeInteger(value['profileRevision']) ||
    value['profileRevision'] < 0 ||
    typeof value['profileStatus'] !== 'string' ||
    !['discovering', 'known', 'inactive'].includes(value['profileStatus']) ||
    typeof value['isFirstContact'] !== 'boolean' ||
    !Array.isArray(value['missing'])
  ) {
    return null;
  }
  const name =
    value['name'] === undefined ? undefined : (boundedString(value['name'], 120) ?? undefined);
  if (value['name'] !== undefined && name === undefined) return null;
  const preferredLanguage = value['preferredLanguage'];
  if (
    preferredLanguage !== undefined &&
    (typeof preferredLanguage !== 'string' ||
      !['en', 'hi', 'hinglish', 'other'].includes(preferredLanguage))
  ) {
    return null;
  }
  const missingAllowed = ['name', ...CLIENT_JOURNEY_FIELDS] as const;
  const missing = value['missing'];
  if (
    missing.length > missingAllowed.length ||
    missing.some(
      (item) => typeof item !== 'string' || !(missingAllowed as readonly string[]).includes(item),
    ) ||
    new Set(missing).size !== missing.length
  ) {
    return null;
  }

  const raw = value['activeRequirement'];
  if (!isRecord(raw)) return null;
  const requirementAllowed = [
    'requirementId',
    'revision',
    'status',
    'phase',
    'summaryConfirmed',
    'provenance',
    ...CLIENT_JOURNEY_FIELDS,
  ];
  if (!onlyKeys(raw, requirementAllowed)) return null;
  if (
    typeof raw['requirementId'] !== 'string' ||
    !UUID.test(raw['requirementId']) ||
    typeof raw['revision'] !== 'number' ||
    !Number.isSafeInteger(raw['revision']) ||
    raw['revision'] < 0 ||
    typeof raw['status'] !== 'string' ||
    !['discovering', 'ready_for_lead', 'converted', 'closed', 'cancelled'].includes(
      raw['status'],
    ) ||
    typeof raw['phase'] !== 'string' ||
    !(CLIENT_JOURNEY_PHASES as readonly string[]).includes(raw['phase']) ||
    typeof raw['summaryConfirmed'] !== 'boolean' ||
    !isRecord(raw['provenance']) ||
    !onlyKeys(raw['provenance'], CLIENT_JOURNEY_FIELDS)
  ) {
    return null;
  }
  const provenance: Partial<
    Record<QuickFurnoClientJourneyField, 'user_stated' | 'model_inferred'>
  > = {};
  for (const [field, source] of Object.entries(raw['provenance'])) {
    if (source !== 'user_stated' && source !== 'model_inferred') return null;
    provenance[field as QuickFurnoClientJourneyField] = source;
  }

  const fieldBounds: Readonly<Record<QuickFurnoClientJourneyField, number>> = {
    serviceInterest: 128,
    location: 128,
    propertyType: 128,
    scope: 2048,
    budget: 512,
    timeline: 512,
    consultationPreference: 128,
  };
  const requirementValues: Partial<Record<QuickFurnoClientJourneyField, string>> = {};
  for (const field of CLIENT_JOURNEY_FIELDS) {
    if (raw[field] === undefined) continue;
    const parsed = boundedString(raw[field], fieldBounds[field]);
    if (!parsed) return null;
    requirementValues[field] = parsed;
  }

  const expectedMissing = [
    ...(name === undefined ? (['name'] as const) : []),
    ...(requirementValues.serviceInterest === undefined ? (['serviceInterest'] as const) : []),
    ...(requirementValues.location === undefined ? (['location'] as const) : []),
  ];
  if (
    missing.length !== expectedMissing.length ||
    missing.some((field, index) => field !== expectedMissing[index])
  ) {
    return null;
  }
  return Object.freeze({
    version: 1 as const,
    profileId: value['profileId'],
    profileRevision: value['profileRevision'],
    profileStatus: value['profileStatus'] as QuickFurnoClientJourneySnapshotV1['profileStatus'],
    isFirstContact: value['isFirstContact'],
    ...(name === undefined ? {} : { name }),
    ...(preferredLanguage === undefined
      ? {}
      : {
          preferredLanguage: preferredLanguage as 'en' | 'hi' | 'hinglish' | 'other',
        }),
    missing: Object.freeze([...missing] as QuickFurnoClientJourneySnapshotV1['missing'][number][]),
    activeRequirement: Object.freeze({
      requirementId: raw['requirementId'],
      revision: raw['revision'],
      status: raw['status'] as QuickFurnoClientJourneySnapshotV1['activeRequirement']['status'],
      phase: raw['phase'] as QuickFurnoClientJourneySnapshotV1['activeRequirement']['phase'],
      summaryConfirmed: raw['summaryConfirmed'],
      provenance: Object.freeze(provenance),
      ...requirementValues,
    }),
  });
}

function validCanonicalInstant(value: unknown): value is string {
  return typeof value === 'string' && INSTANT.test(value) && Number.isFinite(Date.parse(value));
}

function parseClientLifetimeProperty(
  value: unknown,
): QuickFurnoClientJourneySnapshotV2['properties'][number] | null {
  if (!isRecord(value)) return null;
  const allowed = [
    'propertyId',
    'relation',
    'area',
    'propertyType',
    'bhk',
    'projectStage',
    'possessionDate',
  ];
  if (!onlyKeys(value, allowed)) return null;
  if (
    typeof value['propertyId'] !== 'string' ||
    !UUID.test(value['propertyId']) ||
    (value['relation'] !== 'current' && value['relation'] !== 'historical')
  ) {
    return null;
  }
  const parsed: Record<string, string> = {};
  for (const field of ['area', 'propertyType', 'bhk', 'projectStage'] as const) {
    if (value[field] === undefined) continue;
    const bounded = boundedString(value[field], 128);
    if (bounded === null) return null;
    parsed[field] = bounded;
  }
  if (
    value['possessionDate'] !== undefined &&
    (typeof value['possessionDate'] !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}$/u.test(value['possessionDate']))
  ) {
    return null;
  }
  return Object.freeze({
    propertyId: value['propertyId'],
    relation: value['relation'],
    ...parsed,
    ...(value['possessionDate'] === undefined ? {} : { possessionDate: value['possessionDate'] }),
  }) as QuickFurnoClientJourneySnapshotV2['properties'][number];
}

function parsePastRequirement(
  value: unknown,
): QuickFurnoClientJourneySnapshotV2['pastRequirements'][number] | null {
  if (!isRecord(value)) return null;
  if (!onlyKeys(value, ['requirementId', 'categoryRef', 'propertyId', 'status', 'closedAt']))
    return null;
  if (
    typeof value['requirementId'] !== 'string' ||
    !UUID.test(value['requirementId']) ||
    typeof value['categoryRef'] !== 'string' ||
    !ID.test(value['categoryRef']) ||
    !['converted', 'closed', 'cancelled'].includes(String(value['status']))
  ) {
    return null;
  }
  if (
    value['propertyId'] !== undefined &&
    (typeof value['propertyId'] !== 'string' || !UUID.test(value['propertyId']))
  ) {
    return null;
  }
  if (value['closedAt'] !== undefined && !validCanonicalInstant(value['closedAt'])) return null;
  return Object.freeze({
    requirementId: value['requirementId'],
    categoryRef: value['categoryRef'],
    ...(value['propertyId'] === undefined ? {} : { propertyId: value['propertyId'] }),
    status: value['status'] as 'converted' | 'closed' | 'cancelled',
    ...(value['closedAt'] === undefined ? {} : { closedAt: value['closedAt'] }),
  });
}

function parseClientJourneyV2(value: unknown): QuickFurnoClientJourneySnapshotV2 | null {
  if (!isRecord(value)) return null;
  const v2Allowed = [
    'version',
    'profileId',
    'profileRevision',
    'profileStatus',
    'isFirstContact',
    'isReturningClient',
    'createdAt',
    'lastSeenAt',
    'name',
    'preferredLanguage',
    'missing',
    'activeRequirement',
    'properties',
    'pastRequirements',
  ];
  if (!onlyKeys(value, v2Allowed) || value['version'] !== 2) return null;
  if (
    typeof value['isReturningClient'] !== 'boolean' ||
    !validCanonicalInstant(value['createdAt']) ||
    !validCanonicalInstant(value['lastSeenAt']) ||
    Date.parse(value['lastSeenAt']) < Date.parse(value['createdAt']) ||
    !Array.isArray(value['properties']) ||
    value['properties'].length > 8 ||
    !Array.isArray(value['pastRequirements']) ||
    value['pastRequirements'].length > 24
  ) {
    return null;
  }

  const base = parseClientJourneyV1({
    version: 1,
    profileId: value['profileId'],
    profileRevision: value['profileRevision'],
    profileStatus: value['profileStatus'],
    isFirstContact: value['isFirstContact'],
    ...(value['name'] === undefined ? {} : { name: value['name'] }),
    ...(value['preferredLanguage'] === undefined
      ? {}
      : { preferredLanguage: value['preferredLanguage'] }),
    missing: value['missing'],
    activeRequirement: value['activeRequirement'],
  });
  if (base === null) return null;
  const properties = value['properties'].map(parseClientLifetimeProperty);
  const pastRequirements = value['pastRequirements'].map(parsePastRequirement);
  if (
    properties.some((entry) => entry === null) ||
    pastRequirements.some((entry) => entry === null)
  )
    return null;

  const propertyIds = properties.map((entry) => entry!.propertyId);
  const requirementIds = pastRequirements.map((entry) => entry!.requirementId);
  if (
    new Set(propertyIds).size !== propertyIds.length ||
    new Set(requirementIds).size !== requirementIds.length
  )
    return null;
  if (value['isFirstContact'] && value['isReturningClient']) return null;

  return Object.freeze({
    ...base,
    version: 2 as const,
    isReturningClient: value['isReturningClient'],
    createdAt: value['createdAt'],
    lastSeenAt: value['lastSeenAt'],
    properties: Object.freeze(properties as QuickFurnoClientJourneySnapshotV2['properties']),
    pastRequirements: Object.freeze(
      pastRequirements as QuickFurnoClientJourneySnapshotV2['pastRequirements'],
    ),
  });
}

function parseClientJourney(value: unknown): QuickFurnoClientJourneySnapshot | null {
  if (!isRecord(value)) return null;
  return value['version'] === 2 ? parseClientJourneyV2(value) : parseClientJourneyV1(value);
}

function parseClientMatchDecision(
  value: unknown,
  journey: QuickFurnoClientJourneySnapshot,
): QuickFurnoClientMatchDecisionV1 | null {
  if (!isRecord(value)) return null;
  if (
    !onlyKeys(value, [
      'version',
      'state',
      'requirementId',
      'requirementRevision',
      'leadId',
      'assignmentCount',
      'missingFields',
      'reasonCode',
      'coreReady',
      'executionAuthorized',
    ]) ||
    value['version'] !== 1 ||
    typeof value['state'] !== 'string' ||
    ![
      'REQUIREMENT_INCOMPLETE',
      'LEAD_REQUIRED',
      'NEEDS_ENRICHMENT',
      'READY',
      'PARTIALLY_MATCHED',
      'MATCHED',
      'WAITING_FOR_SUPPLY',
      'BLOCKED',
    ].includes(value['state']) ||
    typeof value['requirementId'] !== 'string' ||
    !UUID.test(value['requirementId']) ||
    value['requirementId'] !== journey.activeRequirement.requirementId ||
    typeof value['requirementRevision'] !== 'number' ||
    !Number.isSafeInteger(value['requirementRevision']) ||
    value['requirementRevision'] < 0 ||
    value['requirementRevision'] !== journey.activeRequirement.revision ||
    typeof value['assignmentCount'] !== 'number' ||
    !Number.isSafeInteger(value['assignmentCount']) ||
    value['assignmentCount'] < 0 ||
    value['assignmentCount'] > 6 ||
    !Array.isArray(value['missingFields']) ||
    value['missingFields'].length > 16 ||
    value['missingFields'].some((field) => typeof field !== 'string' || !ID.test(field)) ||
    new Set(value['missingFields']).size !== value['missingFields'].length ||
    typeof value['reasonCode'] !== 'string' ||
    !ID.test(value['reasonCode']) ||
    typeof value['coreReady'] !== 'boolean' ||
    value['executionAuthorized'] !== false
  ) return null;
  const leadId = value['leadId'];
  if (leadId !== undefined && (typeof leadId !== 'string' || !UUID.test(leadId))) return null;
  const missingFields = value['missingFields'] as string[];
  const requiresMissingFields =
    value['state'] === 'REQUIREMENT_INCOMPLETE' || value['state'] === 'NEEDS_ENRICHMENT';
  if (requiresMissingFields && missingFields.length === 0) return null;
  if (!requiresMissingFields && missingFields.length > 0) return null;
  if (value['state'] === 'READY' && (!value['coreReady'] || leadId === undefined)) return null;
  if (value['state'] !== 'READY' && value['coreReady']) return null;
  if (value['state'] === 'MATCHED' && value['assignmentCount'] < 3) return null;
  if (value['state'] === 'PARTIALLY_MATCHED' && (value['assignmentCount'] < 1 || value['assignmentCount'] >= 3)) return null;
  if (['REQUIREMENT_INCOMPLETE', 'LEAD_REQUIRED', 'NEEDS_ENRICHMENT', 'READY', 'WAITING_FOR_SUPPLY', 'BLOCKED'].includes(value['state']) &&
      value['assignmentCount'] !== 0) return null;
  return Object.freeze({
    version: 1 as const,
    state: value['state'] as QuickFurnoClientMatchDecisionV1['state'],
    requirementId: value['requirementId'],
    requirementRevision: value['requirementRevision'],
    ...(leadId === undefined ? {} : { leadId }),
    assignmentCount: value['assignmentCount'],
    missingFields: Object.freeze([...missingFields]),
    reasonCode: value['reasonCode'],
    coreReady: value['coreReady'],
    executionAuthorized: false as const,
  });
}


function parseClientVendorJourney(
  value: unknown,
  journey: QuickFurnoClientJourneySnapshot,
  matchDecision: QuickFurnoClientMatchDecisionV1 | undefined,
): QuickFurnoClientVendorJourneyV1 | null {
  if (!isRecord(value)) return null;
  if (
    !onlyKeys(value, [
      'version',
      'requirementId',
      'requirementRevision',
      'vendorsReleased',
      'vendorNoContactCount',
      'allReleasedVendorsContacted',
      'satisfactionState',
      'serviceRecoveryNeeded',
      'reassignmentState',
      'followUpDue',
    ]) ||
    value['version'] !== 1 ||
    typeof value['requirementId'] !== 'string' ||
    !UUID.test(value['requirementId']) ||
    value['requirementId'] !== journey.activeRequirement.requirementId ||
    typeof value['requirementRevision'] !== 'number' ||
    !Number.isSafeInteger(value['requirementRevision']) ||
    value['requirementRevision'] !== journey.activeRequirement.revision ||
    typeof value['vendorsReleased'] !== 'number' ||
    !Number.isSafeInteger(value['vendorsReleased']) ||
    value['vendorsReleased'] < 0 ||
    value['vendorsReleased'] > 6 ||
    typeof value['vendorNoContactCount'] !== 'number' ||
    !Number.isSafeInteger(value['vendorNoContactCount']) ||
    value['vendorNoContactCount'] < 0 ||
    value['vendorNoContactCount'] > value['vendorsReleased'] ||
    typeof value['allReleasedVendorsContacted'] !== 'boolean' ||
    typeof value['satisfactionState'] !== 'string' ||
    !['UNKNOWN', 'SATISFIED', 'DISSATISFIED', 'COMPLAINT'].includes(value['satisfactionState']) ||
    typeof value['serviceRecoveryNeeded'] !== 'boolean' ||
    typeof value['reassignmentState'] !== 'string' ||
    !['NONE', 'REQUESTED', 'AUTHORIZED', 'REJECTED'].includes(value['reassignmentState']) ||
    typeof value['followUpDue'] !== 'boolean'
  ) return null;

  const vendorsReleased = value['vendorsReleased'];
  const vendorNoContactCount = value['vendorNoContactCount'];
  const allReleasedVendorsContacted =
    vendorsReleased > 0 && vendorNoContactCount === 0;
  if (value['allReleasedVendorsContacted'] !== allReleasedVendorsContacted) return null;
  if (
    matchDecision !== undefined &&
    matchDecision.assignmentCount !== vendorsReleased
  ) return null;

  const satisfactionState =
    value['satisfactionState'] as QuickFurnoClientVendorJourneyV1['satisfactionState'];
  const reassignmentState =
    value['reassignmentState'] as QuickFurnoClientVendorJourneyV1['reassignmentState'];
  const recoveryExpected =
    satisfactionState === 'DISSATISFIED' ||
    satisfactionState === 'COMPLAINT' ||
    reassignmentState === 'REQUESTED' ||
    reassignmentState === 'REJECTED';
  if (value['serviceRecoveryNeeded'] !== recoveryExpected) return null;

  return Object.freeze({
    version: 1 as const,
    requirementId: value['requirementId'],
    requirementRevision: value['requirementRevision'],
    vendorsReleased,
    vendorNoContactCount,
    allReleasedVendorsContacted,
    satisfactionState,
    serviceRecoveryNeeded: recoveryExpected,
    reassignmentState,
    followUpDue: value['followUpDue'],
  });
}

function parseCoreAvailability(value: unknown): QuickFurnoCoreAvailabilitySnapshotV1 | null {
  try {
    return parseCoreServiceAvailabilitySnapshotV1(value);
  } catch {
    return null;
  }
}

function parseMaterial(value: unknown, requestId: string): QuickFurnoWhatsAppTurnMaterialV2 | null {
  if (!isRecord(value)) return null;
  const authority = parseAuthorityState(value, requestId);
  if (!authority) {
    const authorityFields = [
      'protocol',
      'version',
      'requestId',
      'tenantId',
      'conversationId',
      'revision',
      'assignedActor',
      'subjectType',
      'partyType',
      'conversationState',
      'jarvisAllowed',
      'dataClass',
      'humanTakeover',
      'aiPaused',
      'cancelled',
      'subjectStatus',
      'subjectRef',
      'observedAt',
    ];
    const authorityOnly = Object.fromEntries(
      Object.entries(value).filter(([key]) => authorityFields.includes(key)),
    );
    const parsedAuthority = parseAuthorityState(authorityOnly, requestId);
    if (!parsedAuthority) return null;
  }
  const baseFields = [
    'protocol',
    'version',
    'requestId',
    'tenantId',
    'conversationId',
    'revision',
    'assignedActor',
    'subjectType',
    'partyType',
    'conversationState',
    'jarvisAllowed',
    'dataClass',
    'humanTakeover',
    'aiPaused',
    'cancelled',
    'subjectStatus',
    'observedAt',
  ];
  const allowed = [
    ...baseFields,
    'subjectRef',
    'inboundMessageId',
    'receivedAt',
    'inbound',
    'normalizedText',
    'clientJourney',
    'clientMatchDecision',
    'clientVendorJourney',
    'coreAvailability',
  ];
  if (!onlyKeys(value, allowed)) return null;

  const authorityFields = Object.fromEntries(
    Object.entries(value).filter(([key]) => [...baseFields, 'subjectRef'].includes(key)),
  );
  const parsedAuthority = parseAuthorityState(authorityFields, requestId);
  if (!parsedAuthority) return null;
  if (!['RIYA', 'ANISHA', 'AAROHI'].includes(parsedAuthority.assignedActor)) return null;
  if (!['client', 'vendor', 'prospect'].includes(parsedAuthority.subjectType)) return null;

  const inboundMessageId = value['inboundMessageId'];
  const receivedAt = value['receivedAt'];
  if (typeof inboundMessageId !== 'string' || !UUID.test(inboundMessageId)) return null;
  if (
    typeof receivedAt !== 'string' ||
    !INSTANT.test(receivedAt) ||
    !Number.isFinite(Date.parse(receivedAt))
  )
    return null;
  const inbound = parseInboundMaterial(value['inbound']);
  if (!inbound) return null;
  const hostedTextTypes = ['text', 'button_reply', 'list_reply'];
  const localMediaTypes = ['image', 'document', 'audio', 'video', 'sticker'];
  if (
    (parsedAuthority.dataClass === 'HOSTED_ALLOWED' &&
      !hostedTextTypes.includes(inbound.messageType)) ||
    (parsedAuthority.dataClass === 'LOCAL_ONLY' &&
      (!localMediaTypes.includes(inbound.messageType) || inbound.attachment === undefined)) ||
    parsedAuthority.dataClass === 'HUMAN_ONLY'
  ) {
    return null;
  }
  const normalizedTextRaw = value['normalizedText'];
  const normalizedText =
    normalizedTextRaw === undefined
      ? undefined
      : (boundedString(normalizedTextRaw, 4096) ?? undefined);
  if (normalizedTextRaw !== undefined && normalizedText === undefined) return null;
  if (normalizedText !== inbound.normalizedText) return null;

  const clientJourney =
    value['clientJourney'] === undefined ? undefined : parseClientJourney(value['clientJourney']);
  const clientMatchDecision =
    value['clientMatchDecision'] === undefined
      ? undefined
      : clientJourney === undefined || clientJourney === null
        ? null
        : parseClientMatchDecision(value['clientMatchDecision'], clientJourney);
  const clientVendorJourney =
    value['clientVendorJourney'] === undefined
      ? undefined
      : clientJourney === undefined || clientJourney === null || clientMatchDecision === null
        ? null
        : parseClientVendorJourney(value['clientVendorJourney'], clientJourney, clientMatchDecision);
  const coreAvailability =
    value['coreAvailability'] === undefined
      ? undefined
      : parseCoreAvailability(value['coreAvailability']);
  if (
    clientJourney === null ||
    clientMatchDecision === null ||
    clientVendorJourney === null ||
    coreAvailability === null
  ) {
    return null;
  }
  const hasRiyaContext =
    clientJourney !== undefined ||
    clientMatchDecision !== undefined ||
    clientVendorJourney !== undefined ||
    coreAvailability !== undefined;
  if (
    hasRiyaContext &&
    (parsedAuthority.assignedActor !== 'RIYA' ||
      parsedAuthority.subjectType !== 'client' ||
      clientJourney === undefined ||
      coreAvailability === undefined)
  ) {
    return null;
  }

  return Object.freeze({
    ...parsedAuthority,
    assignedActor:
      parsedAuthority.assignedActor as QuickFurnoWhatsAppTurnMaterialV2['assignedActor'],
    subjectType: parsedAuthority.subjectType as QuickFurnoWhatsAppTurnMaterialV2['subjectType'],
    inboundMessageId,
    receivedAt,
    inbound,
    ...(normalizedText === undefined ? {} : { normalizedText }),
    ...(clientJourney === undefined ? {} : { clientJourney }),
    ...(clientMatchDecision === undefined ? {} : { clientMatchDecision }),
    ...(clientVendorJourney === undefined ? {} : { clientVendorJourney }),
    ...(coreAvailability === undefined ? {} : { coreAvailability }),
  });
}

function parsePrivateKey(config: QuickFurnoWhatsAppHttpConfig): {
  key: KeyObject;
  timeoutMs: number;
} {
  if (
    !KEY_ID.test(config.keyId) ||
    typeof config.privateKeyPem !== 'string' ||
    !config.privateKeyPem.includes('PRIVATE KEY') ||
    typeof config.clock !== 'function' ||
    typeof config.requestId !== 'function' ||
    typeof config.httpPost !== 'function'
  ) {
    throw new QuickFurnoWhatsAppHttpError('invalid-config');
  }
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 30_000)
    throw new QuickFurnoWhatsAppHttpError('invalid-config');
  let key: KeyObject;
  try {
    key = createPrivateKey(config.privateKeyPem);
  } catch {
    throw new QuickFurnoWhatsAppHttpError('invalid-config');
  }
  if (key.type !== 'private' || key.asymmetricKeyType !== 'ed25519')
    throw new QuickFurnoWhatsAppHttpError('invalid-config');
  return { key, timeoutMs };
}

async function signedPost(args: {
  config: QuickFurnoWhatsAppHttpConfig;
  key: KeyObject;
  timeoutMs: number;
  path: string;
  domain: string;
  requestId: string;
  issuedAt: string;
  body: string;
}): Promise<QuickFurnoWhatsAppHttpResponse> {
  const signature = sign(
    null,
    Buffer.from(
      signingInput(
        args.domain,
        args.path,
        args.requestId,
        args.issuedAt,
        args.config.keyId,
        digestBase64Url(args.body),
      ),
      'utf8',
    ),
    args.key,
  ).toString('base64url');
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, args.timeoutMs);
  try {
    return await args.config.httpPost(endpointFor(args.config.baseUrl, args.path), {
      method: 'POST',
      redirect: 'error',
      signal: controller.signal,
      body: args.body,
      headers: Object.freeze({
        'content-type': 'application/json',
        [KEY_ID_HEADER]: args.config.keyId,
        [SIGNATURE_HEADER]: signature,
      }),
    });
  } catch {
    throw new QuickFurnoWhatsAppHttpError('request-failed');
  } finally {
    clearTimeout(timer);
  }
}
function parseQualificationMaterial(
  value: unknown,
  requestId: string,
): QuickFurnoLeadQualificationMaterialV1 | null {
  if (!isRecord(value)) return null;
  const expected = [
    'protocol',
    'version',
    'requestId',
    'tenantId',
    'conversationId',
    'revision',
    'purpose',
    'assignedActor',
    'inboundMessageId',
    'receivedAt',
    'dataClass',
    'qualification',
  ];
  if (!onlyKeys(value, expected) || !expected.every((key) => key in value)) return null;
  if (
    value['protocol'] !== QFJ_WHATSAPP_TURN_MATERIAL_PROTOCOL ||
    value['version'] !== 2 ||
    value['requestId'] !== requestId ||
    value['tenantId'] !== 'quickfurno' ||
    value['purpose'] !== 'lead_qualification' ||
    value['assignedActor'] !== 'RIYA' ||
    value['dataClass'] !== 'HOSTED_ALLOWED'
  )
    return null;
  const conversationId = value['conversationId'];
  const revision = value['revision'];
  const inboundMessageId = value['inboundMessageId'];
  const receivedAt = value['receivedAt'];
  if (
    typeof conversationId !== 'string' ||
    !UUID.test(conversationId) ||
    typeof inboundMessageId !== 'string' ||
    !UUID.test(inboundMessageId) ||
    typeof revision !== 'number' ||
    !Number.isSafeInteger(revision) ||
    revision < 0 ||
    typeof receivedAt !== 'string' ||
    !INSTANT.test(receivedAt) ||
    !Number.isFinite(Date.parse(receivedAt))
  )
    return null;
  const q = value['qualification'];
  if (
    !isRecord(q) ||
    !onlyKeys(q, ['requestId', 'target', 'questionText', 'allowedOptions', 'answerText'])
  )
    return null;
  const qualificationRequestId = q['requestId'];
  const target = q['target'];
  const questionText = boundedString(q['questionText'], 512);
  const answerText = boundedString(q['answerText'], 512);
  const allowedOptions = q['allowedOptions'];
  if (
    typeof qualificationRequestId !== 'string' ||
    !UUID.test(qualificationRequestId) ||
    typeof target !== 'string' ||
    !['budget', 'timeline', 'propertyType'].includes(target) ||
    !questionText ||
    !answerText ||
    !Array.isArray(allowedOptions) ||
    allowedOptions.length < 2 ||
    allowedOptions.length > 12 ||
    allowedOptions.some(
      (option) => typeof option !== 'string' || option.length < 1 || option.length > 128,
    )
  )
    return null;
  return Object.freeze({
    protocol: QFJ_WHATSAPP_TURN_MATERIAL_PROTOCOL,
    version: 2,
    requestId,
    tenantId: 'quickfurno',
    conversationId,
    revision,
    purpose: 'lead_qualification',
    assignedActor: 'RIYA',
    inboundMessageId,
    receivedAt,
    dataClass: 'HOSTED_ALLOWED',
    qualification: Object.freeze({
      requestId: qualificationRequestId,
      target: target as QuickFurnoLeadQualificationMaterialV1['qualification']['target'],
      questionText,
      allowedOptions: Object.freeze(allowedOptions.map((option) => String(option))),
      answerText,
    }),
  });
}

function parseConversationContext(
  value: unknown,
  requestId: string,
): QuickFurnoWhatsAppConversationContextEnvelopeV1 | null {
  if (
    !isRecord(value) ||
    !onlyKeys(value, [
      'protocol',
      'version',
      'requestId',
      'tenantId',
      'conversationId',
      'revision',
      'inboundMessageId',
      'context',
    ]) ||
    value['protocol'] !== QFJ_WHATSAPP_CONVERSATION_CONTEXT_PROTOCOL ||
    value['version'] !== 1 ||
    value['requestId'] !== requestId ||
    value['tenantId'] !== 'quickfurno' ||
    typeof value['conversationId'] !== 'string' ||
    !UUID.test(value['conversationId']) ||
    typeof value['revision'] !== 'number' ||
    !Number.isSafeInteger(value['revision']) ||
    value['revision'] < 0 ||
    typeof value['inboundMessageId'] !== 'string' ||
    !UUID.test(value['inboundMessageId']) ||
    !isRecord(value['context'])
  ) {
    return null;
  }
  const context = value['context'];
  if (
    !onlyKeys(context, ['version', 'authority', 'text', 'includedTurns', 'truncated']) ||
    context['version'] !== 1 ||
    context['authority'] !== 'NON_AUTHORITATIVE_CONVERSATION_CONTEXT' ||
    typeof context['text'] !== 'string' ||
    context['text'].length > 4000 ||
    typeof context['includedTurns'] !== 'number' ||
    !Number.isSafeInteger(context['includedTurns']) ||
    context['includedTurns'] < 0 ||
    context['includedTurns'] > 12 ||
    typeof context['truncated'] !== 'boolean'
  ) {
    return null;
  }
  return Object.freeze({
    protocol: QFJ_WHATSAPP_CONVERSATION_CONTEXT_PROTOCOL,
    version: 1 as const,
    requestId,
    tenantId: 'quickfurno' as const,
    conversationId: value['conversationId'],
    revision: value['revision'],
    inboundMessageId: value['inboundMessageId'],
    context: Object.freeze({
      version: 1 as const,
      authority: 'NON_AUTHORITATIVE_CONVERSATION_CONTEXT' as const,
      text: context['text'],
      includedTurns: context['includedTurns'],
      truncated: context['truncated'],
    }),
  });
}

export interface QuickFurnoWhatsAppConversationContextReader {
  read(input: {
    readonly conversationId: string;
    readonly inboundMessageId: string;
    readonly expectedRevision: number;
  }): Promise<QuickFurnoWhatsAppConversationContextEnvelopeV1>;
}

export interface QuickFurnoWhatsAppMaterialReader {
  read(input: {
    readonly conversationId: string;
    readonly inboundMessageId: string;
    readonly expectedRevision: number;
    readonly turnPurpose?: 'lead_qualification';
    readonly qualificationRequestId?: string;
  }): Promise<QuickFurnoWhatsAppWorkerMaterial>;
}

export function createQuickFurnoWhatsAppMaterialReader(
  config: QuickFurnoWhatsAppHttpConfig,
): QuickFurnoWhatsAppMaterialReader {
  const { key, timeoutMs } = parsePrivateKey(config);
  return Object.freeze({
    async read(input: {
      readonly conversationId: string;
      readonly inboundMessageId: string;
      readonly expectedRevision: number;
      readonly turnPurpose?: 'lead_qualification';
      readonly qualificationRequestId?: string;
    }) {
      if (
        !UUID.test(input.conversationId) ||
        !UUID.test(input.inboundMessageId) ||
        !Number.isSafeInteger(input.expectedRevision) ||
        input.expectedRevision < 0 ||
        (input.turnPurpose === 'lead_qualification' &&
          (typeof input.qualificationRequestId !== 'string' ||
            !UUID.test(input.qualificationRequestId))) ||
        (input.turnPurpose === undefined && input.qualificationRequestId !== undefined)
      ) {
        throw new QuickFurnoWhatsAppHttpError('invalid-input');
      }
      const requestId = config.requestId();
      const issuedAt = config.clock();
      if (
        !UUID.test(requestId) ||
        !INSTANT.test(issuedAt) ||
        !Number.isFinite(Date.parse(issuedAt))
      )
        throw new QuickFurnoWhatsAppHttpError('invalid-input');
      const body = JSON.stringify({
        protocol: QFJ_WHATSAPP_TURN_MATERIAL_PROTOCOL,
        version: 2,
        caller: CALLER,
        audience: AUDIENCE,
        requestId,
        issuedAt,
        tenantId: 'quickfurno',
        conversationId: input.conversationId,
        inboundMessageId: input.inboundMessageId,
        expectedRevision: input.expectedRevision,
        ...(input.turnPurpose === 'lead_qualification'
          ? {
              turnPurpose: 'lead_qualification',
              qualificationRequestId: input.qualificationRequestId,
            }
          : {}),
      });
      const response = await signedPost({
        config,
        key,
        timeoutMs,
        path: QFJ_WHATSAPP_TURN_MATERIAL_PATH,
        domain: QFJ_WHATSAPP_TURN_MATERIAL_SIGNING_DOMAIN,
        requestId,
        issuedAt,
        body,
      });
      if (response.status === 409) throw new QuickFurnoWhatsAppHttpError('stale-revision');
      if (response.status !== 200) throw new QuickFurnoWhatsAppHttpError('request-failed');
      const text = await response.text();
      if (
        Buffer.byteLength(text, 'utf8') < 2 ||
        Buffer.byteLength(text, 'utf8') > MAX_RESPONSE_BYTES
      )
        throw new QuickFurnoWhatsAppHttpError('response-invalid');
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        throw new QuickFurnoWhatsAppHttpError('response-invalid');
      }
      const material =
        input.turnPurpose === 'lead_qualification'
          ? parseQualificationMaterial(parsed, requestId)
          : parseMaterial(parsed, requestId);
      if (
        material?.conversationId !== input.conversationId ||
        material.inboundMessageId !== input.inboundMessageId ||
        material.revision !== input.expectedRevision ||
        (input.turnPurpose === 'lead_qualification' &&
          (!('purpose' in material) ||
            material.qualification.requestId !== input.qualificationRequestId))
      ) {
        throw new QuickFurnoWhatsAppHttpError('response-invalid');
      }
      return material;
    },
  });
}

export function createQuickFurnoWhatsAppConversationContextReader(
  config: QuickFurnoWhatsAppHttpConfig,
): QuickFurnoWhatsAppConversationContextReader {
  const { key, timeoutMs } = parsePrivateKey(config);
  return Object.freeze({
    async read(input: {
      readonly conversationId: string;
      readonly inboundMessageId: string;
      readonly expectedRevision: number;
    }) {
      if (
        !UUID.test(input.conversationId) ||
        !UUID.test(input.inboundMessageId) ||
        !Number.isSafeInteger(input.expectedRevision) ||
        input.expectedRevision < 0
      ) {
        throw new QuickFurnoWhatsAppHttpError('invalid-input');
      }
      const requestId = config.requestId();
      const issuedAt = config.clock();
      if (
        !UUID.test(requestId) ||
        !INSTANT.test(issuedAt) ||
        !Number.isFinite(Date.parse(issuedAt))
      ) {
        throw new QuickFurnoWhatsAppHttpError('invalid-input');
      }
      const body = JSON.stringify({
        protocol: QFJ_WHATSAPP_CONVERSATION_CONTEXT_PROTOCOL,
        version: 1,
        caller: CALLER,
        audience: AUDIENCE,
        requestId,
        issuedAt,
        tenantId: 'quickfurno',
        conversationId: input.conversationId,
        inboundMessageId: input.inboundMessageId,
        expectedRevision: input.expectedRevision,
      });
      const response = await signedPost({
        config,
        key,
        timeoutMs,
        path: QFJ_WHATSAPP_CONVERSATION_CONTEXT_PATH,
        domain: QFJ_WHATSAPP_CONVERSATION_CONTEXT_SIGNING_DOMAIN,
        requestId,
        issuedAt,
        body,
      });
      if (response.status === 409) throw new QuickFurnoWhatsAppHttpError('stale-revision');
      if (response.status !== 200) throw new QuickFurnoWhatsAppHttpError('request-failed');
      const text = await response.text();
      if (
        Buffer.byteLength(text, 'utf8') < 2 ||
        Buffer.byteLength(text, 'utf8') > MAX_RESPONSE_BYTES
      ) {
        throw new QuickFurnoWhatsAppHttpError('response-invalid');
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        throw new QuickFurnoWhatsAppHttpError('response-invalid');
      }
      const context = parseConversationContext(parsed, requestId);
      if (
        context?.conversationId !== input.conversationId ||
        context.inboundMessageId !== input.inboundMessageId ||
        context.revision !== input.expectedRevision
      ) {
        throw new QuickFurnoWhatsAppHttpError('response-invalid');
      }
      return context;
    },
  });
}

export interface QuickFurnoWhatsAppAuthorityReader {
  read(input: {
    readonly tenantId: string;
    readonly conversationId: string;
  }): Promise<QuickFurnoWhatsAppAuthorityStateV2>;
}

export function createQuickFurnoWhatsAppAuthorityReader(
  config: QuickFurnoWhatsAppHttpConfig,
): QuickFurnoWhatsAppAuthorityReader {
  const { key, timeoutMs } = parsePrivateKey(config);
  return Object.freeze({
    async read(input: { readonly tenantId: string; readonly conversationId: string }) {
      if (input.tenantId !== 'quickfurno' || !UUID.test(input.conversationId)) {
        throw new QuickFurnoWhatsAppHttpError('invalid-input');
      }
      const requestId = config.requestId();
      const issuedAt = config.clock();
      if (
        !UUID.test(requestId) ||
        !INSTANT.test(issuedAt) ||
        !Number.isFinite(Date.parse(issuedAt))
      ) {
        throw new QuickFurnoWhatsAppHttpError('invalid-input');
      }
      const body = JSON.stringify({
        protocol: QFJ_WHATSAPP_TURN_MATERIAL_PROTOCOL,
        version: 2,
        caller: CALLER,
        audience: AUDIENCE,
        requestId,
        issuedAt,
        tenantId: input.tenantId,
        conversationId: input.conversationId,
      });
      const response = await signedPost({
        config,
        key,
        timeoutMs,
        path: QFJ_WHATSAPP_TURN_MATERIAL_PATH,
        domain: QFJ_WHATSAPP_TURN_MATERIAL_SIGNING_DOMAIN,
        requestId,
        issuedAt,
        body,
      });
      if (response.status !== 200) throw new QuickFurnoWhatsAppHttpError('request-failed');
      const text = await response.text();
      if (
        Buffer.byteLength(text, 'utf8') < 2 ||
        Buffer.byteLength(text, 'utf8') > MAX_RESPONSE_BYTES
      ) {
        throw new QuickFurnoWhatsAppHttpError('response-invalid');
      }
      let decoded: unknown;
      try {
        decoded = JSON.parse(text);
      } catch {
        throw new QuickFurnoWhatsAppHttpError('response-invalid');
      }
      const authority = parseAuthorityState(decoded, requestId);
      if (
        authority?.tenantId !== input.tenantId ||
        authority.conversationId !== input.conversationId
      ) {
        throw new QuickFurnoWhatsAppHttpError('response-invalid');
      }
      return authority;
    },
  });
}

export interface QuickFurnoWhatsAppReplyWriter {
  write(input: {
    readonly conversationId: string;
    readonly expectedRevision: number;
    readonly proposal: QuickFurnoWhatsAppWorkerProposal;
  }): Promise<'queued' | 'stale'>;
}

function actorHeading(actor: QuickFurnoWhatsAppReplyProposal['actor']): string {
  return actor === 'RIYA'
    ? 'Riya · Client Concierge'
    : actor === 'ANISHA'
      ? 'Anisha · Partner Concierge'
      : 'Aarohi · Growth Concierge';
}

function isQualificationProposal(
  proposal: QuickFurnoWhatsAppWorkerProposal,
): proposal is QuickFurnoQualificationProposal {
  return 'qualificationRequestId' in proposal;
}

function validClientJourneyProposal(proposal: QuickFurnoClientJourneyProposalV1): boolean {
  if (
    proposal.version !== 1 ||
    !UUID.test(proposal.profileId) ||
    !Number.isSafeInteger(proposal.profileRevision) ||
    proposal.profileRevision < 0 ||
    !UUID.test(proposal.requirementId) ||
    !Number.isSafeInteger(proposal.requirementRevision) ||
    proposal.requirementRevision < 0 ||
    !(CLIENT_JOURNEY_PHASES as readonly string[]).includes(proposal.nextPhase) ||
    typeof proposal.summaryConfirmed !== 'boolean' ||
    proposal.sets.length > CLIENT_JOURNEY_FIELDS.length ||
    proposal.clears.length > CLIENT_JOURNEY_FIELDS.length
  ) return false;
  if (
    proposal.name !== undefined &&
    (proposal.name.provenance !== 'user_stated' ||
      proposal.name.value.trim().length < 1 ||
      proposal.name.value.trim().length > 120)
  ) return false;
  const seen = new Set<QuickFurnoClientJourneyField>();
  for (const item of proposal.sets) {
    if (
      !(CLIENT_JOURNEY_FIELDS as readonly string[]).includes(item.field) ||
      seen.has(item.field) ||
      (item.provenance !== 'user_stated' && item.provenance !== 'model_inferred')
    ) return false;
    const max =
      item.field === 'scope' ? 2048 : item.field === 'budget' || item.field === 'timeline' ? 512 : 128;
    if (item.value.trim().length < 1 || item.value.trim().length > max) return false;
    seen.add(item.field);
  }
  for (const item of proposal.clears) {
    if (
      !(CLIENT_JOURNEY_FIELDS as readonly string[]).includes(item.field) ||
      seen.has(item.field) ||
      item.provenance !== 'user_stated'
    ) return false;
    seen.add(item.field);
  }
  return true;
}

export function createQuickFurnoWhatsAppReplyWriter(
  config: QuickFurnoWhatsAppHttpConfig,
): QuickFurnoWhatsAppReplyWriter {
  const { key, timeoutMs } = parsePrivateKey(config);
  return Object.freeze({
    async write(input: {
      readonly conversationId: string;
      readonly expectedRevision: number;
      readonly proposal: QuickFurnoWhatsAppWorkerProposal;
    }) {
      const proposal = input.proposal;
      if (
        !UUID.test(input.conversationId) ||
        !Number.isSafeInteger(input.expectedRevision) ||
        input.expectedRevision < 0 ||
        proposal.boundRevision !== input.expectedRevision ||
        !ID.test(proposal.proposalId)
      ) {
        throw new QuickFurnoWhatsAppHttpError('invalid-input');
      }
      const requestId = config.requestId();
      const issuedAt = config.clock();
      if (
        !UUID.test(requestId) ||
        !INSTANT.test(issuedAt) ||
        !Number.isFinite(Date.parse(issuedAt))
      ) {
        throw new QuickFurnoWhatsAppHttpError('invalid-input');
      }

      if (isQualificationProposal(proposal)) {
        const matched = proposal.outcome === 'matched';
        if (
          !UUID.test(proposal.qualificationRequestId) ||
          !UUID.test(proposal.inboundMessageId) ||
          !['budget', 'timeline', 'propertyType'].includes(proposal.target) ||
          (matched &&
            (typeof proposal.value !== 'string' ||
              proposal.value.length < 1 ||
              proposal.value.length > 128)) ||
          (!matched && proposal.value !== undefined)
        ) {
          throw new QuickFurnoWhatsAppHttpError('invalid-input');
        }
        const idempotencyKey = digestHex(
          [
            'qfj.whatsapp.reply.v3',
            input.conversationId,
            String(input.expectedRevision),
            proposal.proposalId,
            proposal.inboundMessageId,
            proposal.qualificationRequestId,
            proposal.target,
            proposal.outcome,
            proposal.value ?? '',
          ].join('\n'),
        );
        const body = JSON.stringify({
          protocol: QFJ_WHATSAPP_REPLY_PROTOCOL,
          version: 3,
          caller: CALLER,
          audience: AUDIENCE,
          requestId,
          issuedAt,
          conversationId: input.conversationId,
          expectedRevision: input.expectedRevision,
          proposalId: proposal.proposalId,
          actor: 'RIYA',
          inboundMessageId: proposal.inboundMessageId,
          qualificationRequestId: proposal.qualificationRequestId,
          target: proposal.target,
          outcome: proposal.outcome,
          ...(matched ? { value: proposal.value } : {}),
          idempotencyKey,
        });
        const response = await signedPost({
          config,
          key,
          timeoutMs,
          path: QFJ_WHATSAPP_REPLY_PATH,
          domain: QFJ_WHATSAPP_REPLY_QUALIFICATION_SIGNING_DOMAIN,
          requestId,
          issuedAt,
          body,
        });
        if (response.status === 409) return 'stale';
        if (response.status !== 202 && response.status !== 200) {
          throw new QuickFurnoWhatsAppHttpError('request-failed');
        }
        const text = await response.text();
        if (
          Buffer.byteLength(text, 'utf8') < 2 ||
          Buffer.byteLength(text, 'utf8') > MAX_RESPONSE_BYTES
        ) {
          throw new QuickFurnoWhatsAppHttpError('response-invalid');
        }
        let parsed: unknown;
        try {
          parsed = JSON.parse(text);
        } catch {
          throw new QuickFurnoWhatsAppHttpError('response-invalid');
        }
        if (
          !isRecord(parsed) ||
          parsed['protocol'] !== QFJ_WHATSAPP_REPLY_PROTOCOL ||
          parsed['version'] !== 3 ||
          parsed['requestId'] !== requestId ||
          parsed['status'] !== 'applied' ||
          parsed['qualificationRequestId'] !== proposal.qualificationRequestId
        ) {
          throw new QuickFurnoWhatsAppHttpError('response-invalid');
        }
        return 'queued';
      }

      if (proposal.body.length < 1 || proposal.body.length > 3072) {
        throw new QuickFurnoWhatsAppHttpError('invalid-input');
      }
      const experience = {
        version: 1,
        actor: proposal.actor,
        kind: 'text',
        heading: actorHeading(proposal.actor),
        body: proposal.body,
      };
      const journeyProposal = proposal.clientJourneyProposal;
      if (journeyProposal !== undefined) {
        if (proposal.actor !== 'RIYA' || !validClientJourneyProposal(journeyProposal)) {
          throw new QuickFurnoWhatsAppHttpError('invalid-input');
        }
        const journeyJson = JSON.stringify(journeyProposal);
        const idempotencyKey = digestHex(
          [
            'qfj.whatsapp.reply.v4',
            input.conversationId,
            String(input.expectedRevision),
            proposal.proposalId,
            proposal.actor,
            proposal.body,
            journeyJson,
          ].join('\n'),
        );
        const body = JSON.stringify({
          protocol: QFJ_WHATSAPP_REPLY_PROTOCOL,
          version: 4,
          caller: CALLER,
          audience: AUDIENCE,
          requestId,
          issuedAt,
          conversationId: input.conversationId,
          expectedRevision: input.expectedRevision,
          proposalId: proposal.proposalId,
          actor: 'RIYA',
          experience,
          clientJourneyProposal: journeyProposal,
          idempotencyKey,
        });
        const response = await signedPost({
          config,
          key,
          timeoutMs,
          path: QFJ_WHATSAPP_REPLY_PATH,
          domain: QFJ_WHATSAPP_REPLY_JOURNEY_SIGNING_DOMAIN,
          requestId,
          issuedAt,
          body,
        });
        if (response.status === 409) return 'stale';
        if (response.status !== 202 && response.status !== 200) {
          throw new QuickFurnoWhatsAppHttpError('request-failed');
        }
        const text = await response.text();
        if (
          Buffer.byteLength(text, 'utf8') < 2 ||
          Buffer.byteLength(text, 'utf8') > MAX_RESPONSE_BYTES
        ) {
          throw new QuickFurnoWhatsAppHttpError('response-invalid');
        }
        let parsed: unknown;
        try {
          parsed = JSON.parse(text);
        } catch {
          throw new QuickFurnoWhatsAppHttpError('response-invalid');
        }
        const journey =
          isRecord(parsed) && isRecord(parsed['clientJourney']) ? parsed['clientJourney'] : null;
        if (
          !isRecord(parsed) ||
          parsed['protocol'] !== QFJ_WHATSAPP_REPLY_PROTOCOL ||
          parsed['version'] !== 4 ||
          parsed['requestId'] !== requestId ||
          parsed['status'] !== 'queued' ||
          journey === null ||
          typeof journey['profileRevision'] !== 'number' ||
          !Number.isSafeInteger(journey['profileRevision']) ||
          journey['profileRevision'] < 0 ||
          typeof journey['requirementRevision'] !== 'number' ||
          !Number.isSafeInteger(journey['requirementRevision']) ||
          journey['requirementRevision'] < 0
        ) {
          throw new QuickFurnoWhatsAppHttpError('response-invalid');
        }
        return 'queued';
      }
      const idempotencyKey = digestHex(
        [
          'qfj.whatsapp.reply.v2',
          input.conversationId,
          String(input.expectedRevision),
          proposal.proposalId,
          proposal.actor,
          proposal.body,
        ].join('\n'),
      );
      const body = JSON.stringify({
        protocol: QFJ_WHATSAPP_REPLY_PROTOCOL,
        version: 2,
        caller: CALLER,
        audience: AUDIENCE,
        requestId,
        issuedAt,
        conversationId: input.conversationId,
        expectedRevision: input.expectedRevision,
        proposalId: proposal.proposalId,
        actor: proposal.actor,
        experience,
        idempotencyKey,
      });
      const response = await signedPost({
        config,
        key,
        timeoutMs,
        path: QFJ_WHATSAPP_REPLY_PATH,
        domain: QFJ_WHATSAPP_REPLY_SIGNING_DOMAIN,
        requestId,
        issuedAt,
        body,
      });
      if (response.status === 409) return 'stale';
      if (response.status !== 202 && response.status !== 200)
        throw new QuickFurnoWhatsAppHttpError('request-failed');
      const text = await response.text();
      if (
        Buffer.byteLength(text, 'utf8') < 2 ||
        Buffer.byteLength(text, 'utf8') > MAX_RESPONSE_BYTES
      )
        throw new QuickFurnoWhatsAppHttpError('response-invalid');
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        throw new QuickFurnoWhatsAppHttpError('response-invalid');
      }
      if (
        !isRecord(parsed) ||
        parsed['protocol'] !== QFJ_WHATSAPP_REPLY_PROTOCOL ||
        parsed['version'] !== 2 ||
        parsed['requestId'] !== requestId ||
        parsed['status'] !== 'queued'
      ) {
        throw new QuickFurnoWhatsAppHttpError('response-invalid');
      }
      return 'queued';
    },
  });
}
