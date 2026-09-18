import { createHash, createPrivateKey, sign, type KeyObject } from 'node:crypto';
import {
  QFJ_WHATSAPP_REPLY_PATH,
  QFJ_WHATSAPP_REPLY_PROTOCOL,
  QFJ_WHATSAPP_REPLY_SIGNING_DOMAIN,
  QFJ_WHATSAPP_TURN_MATERIAL_PATH,
  QFJ_WHATSAPP_TURN_MATERIAL_PROTOCOL,
  QFJ_WHATSAPP_TURN_MATERIAL_SIGNING_DOMAIN,
  type QuickFurnoWhatsAppAuthorizedReply,
  type QuickFurnoWhatsAppTurnMaterialV1,
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
  'text','button_reply','list_reply','image','document','audio','video','sticker',
  'location','contact','reaction','order','system','unsupported',
] as const;
const MATERIAL_MEDIA_TYPES = ['image','document','audio','video','sticker'] as const;
const MEDIA_ID = /^[A-Za-z0-9._:-]{1,256}$/u;

function onlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}
function boundedString(value: unknown, max: number, min = 1): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length >= min && trimmed.length <= max ? trimmed : null;
}
function parseInboundMaterial(
  value: unknown,
): QuickFurnoWhatsAppTurnMaterialV1['inbound'] | null {
  if (!isRecord(value) || !onlyKeys(value, [
    'version','messageType','normalizedText','attachment','selection','replyContext',
    'referral','reaction','order','forwarded','frequentlyForwarded',
  ])) return null;
  if (value['version'] !== 1) return null;
  const messageType = value['messageType'];
  if (typeof messageType !== 'string' || !(MATERIAL_MESSAGE_TYPES as readonly string[]).includes(messageType)) return null;

  let normalizedText: string | undefined;
  if (value['normalizedText'] !== undefined) {
    normalizedText = boundedString(value['normalizedText'], 4096) ?? undefined;
    if (normalizedText === undefined) return null;
  }

  let attachment: QuickFurnoWhatsAppTurnMaterialV1['inbound']['attachment'];
  if (value['attachment'] !== undefined) {
    const raw = value['attachment'];
    if (!isRecord(raw) || !onlyKeys(raw, ['kind','mediaId','mimeType','caption','filename'])) return null;
    const kind = raw['kind'];
    const mediaId = raw['mediaId'];
    if (typeof kind !== 'string' || !(MATERIAL_MEDIA_TYPES as readonly string[]).includes(kind)) return null;
    if (kind !== messageType || typeof mediaId !== 'string' || !MEDIA_ID.test(mediaId)) return null;
    const mimeType = raw['mimeType'] === undefined ? undefined : boundedString(raw['mimeType'], 128) ?? undefined;
    const caption = raw['caption'] === undefined ? undefined : boundedString(raw['caption'], 1024) ?? undefined;
    const filename = raw['filename'] === undefined ? undefined : boundedString(raw['filename'], 240) ?? undefined;
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

  let selection: QuickFurnoWhatsAppTurnMaterialV1['inbound']['selection'];
  if (value['selection'] !== undefined) {
    if (!['button_reply','list_reply'].includes(messageType)) return null;
    const raw = value['selection'];
    if (!isRecord(raw) || !onlyKeys(raw, ['id','title','description'])) return null;
    const id = raw['id'] === undefined ? undefined : boundedString(raw['id'], 200) ?? undefined;
    const title = raw['title'] === undefined ? undefined : boundedString(raw['title'], 240) ?? undefined;
    const description = raw['description'] === undefined ? undefined : boundedString(raw['description'], 240) ?? undefined;
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

  let replyContext: QuickFurnoWhatsAppTurnMaterialV1['inbound']['replyContext'];
  if (value['replyContext'] !== undefined) {
    const raw = value['replyContext'];
    if (!isRecord(raw) || !onlyKeys(raw, ['providerMessageId'])) return null;
    const providerMessageId = boundedString(raw['providerMessageId'], 512);
    if (!providerMessageId) return null;
    replyContext = Object.freeze({ providerMessageId });
  }

  let referral: QuickFurnoWhatsAppTurnMaterialV1['inbound']['referral'];
  if (value['referral'] !== undefined) {
    const raw = value['referral'];
    if (!isRecord(raw) || !onlyKeys(raw, ['sourceType','sourceId'])) return null;
    const sourceType = raw['sourceType'] === undefined ? undefined : boundedString(raw['sourceType'], 40) ?? undefined;
    const sourceId = raw['sourceId'] === undefined ? undefined : boundedString(raw['sourceId'], 128) ?? undefined;
    if (raw['sourceType'] !== undefined && (!sourceType || !/^[a-z_]{1,40}$/iu.test(sourceType))) return null;
    if (raw['sourceId'] !== undefined && (!sourceId || !/^[A-Za-z0-9._:-]{1,128}$/u.test(sourceId))) return null;
    if (!sourceType && !sourceId) return null;
    referral = Object.freeze({ ...(sourceType ? { sourceType } : {}), ...(sourceId ? { sourceId } : {}) });
  }

  let reaction: QuickFurnoWhatsAppTurnMaterialV1['inbound']['reaction'];
  if (value['reaction'] !== undefined) {
    if (messageType !== 'reaction') return null;
    const raw = value['reaction'];
    if (!isRecord(raw) || !onlyKeys(raw, ['emoji','targetProviderMessageId'])) return null;
    const emoji = raw['emoji'] === undefined ? undefined : boundedString(raw['emoji'], 32) ?? undefined;
    const targetProviderMessageId = raw['targetProviderMessageId'] === undefined
      ? undefined : boundedString(raw['targetProviderMessageId'], 512) ?? undefined;
    if (raw['emoji'] !== undefined && emoji === undefined) return null;
    if (raw['targetProviderMessageId'] !== undefined && targetProviderMessageId === undefined) return null;
    if (!emoji && !targetProviderMessageId) return null;
    reaction = Object.freeze({
      ...(emoji ? { emoji } : {}),
      ...(targetProviderMessageId ? { targetProviderMessageId } : {}),
    });
  }

  let order: QuickFurnoWhatsAppTurnMaterialV1['inbound']['order'];
  if (value['order'] !== undefined) {
    if (messageType !== 'order') return null;
    const raw = value['order'];
    if (!isRecord(raw) || !onlyKeys(raw, ['itemCount','catalogId'])) return null;
    const itemCount = raw['itemCount'];
    if (typeof itemCount !== 'number' || !Number.isSafeInteger(itemCount) || itemCount < 0 || itemCount > 100) return null;
    const catalogId = raw['catalogId'] === undefined ? undefined : boundedString(raw['catalogId'], 128) ?? undefined;
    if (raw['catalogId'] !== undefined && (!catalogId || !/^[A-Za-z0-9._:-]{1,128}$/u.test(catalogId))) return null;
    order = Object.freeze({ itemCount, ...(catalogId ? { catalogId } : {}) });
  }

  if (value['forwarded'] !== undefined && typeof value['forwarded'] !== 'boolean') return null;
  if (value['frequentlyForwarded'] !== undefined && typeof value['frequentlyForwarded'] !== 'boolean') return null;

  return Object.freeze({
    version: 1,
    messageType: messageType as QuickFurnoWhatsAppTurnMaterialV1['inbound']['messageType'],
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
function parseMaterial(value: unknown, requestId: string): QuickFurnoWhatsAppTurnMaterialV1 | null {
  if (!isRecord(value)) return null;
  const required = [
    'protocol','version','requestId','conversationId','inboundMessageId','conversationRevision',
    'assignedActor','subjectType','tenantId','dataClass','receivedAt','inbound',
  ];
  const allowed = [...required, 'subjectRef', 'normalizedText'];
  if (!Object.keys(value).every((key) => allowed.includes(key)) || !required.every((key) => key in value)) return null;

  const conversationId = value['conversationId'];
  const inboundMessageId = value['inboundMessageId'];
  const revision = value['conversationRevision'];
  const actor = value['assignedActor'];
  const subject = value['subjectType'];
  const subjectRef = value['subjectRef'];
  const receivedAt = value['receivedAt'];
  const normalizedTextRaw = value['normalizedText'];

  if (
    value['protocol'] !== QFJ_WHATSAPP_TURN_MATERIAL_PROTOCOL ||
    value['version'] !== 1 ||
    value['requestId'] !== requestId
  ) return null;
  if (
    typeof conversationId !== 'string' || !UUID.test(conversationId) ||
    typeof inboundMessageId !== 'string' || !UUID.test(inboundMessageId)
  ) return null;
  if (typeof revision !== 'number' || !Number.isSafeInteger(revision) || revision < 0) return null;
  if (typeof actor !== 'string' || !['RIYA','ANISHA','AAROHI'].includes(actor)) return null;
  if (typeof subject !== 'string' || !['client','vendor','prospect'].includes(subject)) return null;
  if (value['tenantId'] !== 'quickfurno.marketplace' || value['dataClass'] !== 'HOSTED_ALLOWED') return null;
  if (subjectRef !== undefined && (typeof subjectRef !== 'string' || !UUID.test(subjectRef))) return null;
  if (typeof receivedAt !== 'string' || !INSTANT.test(receivedAt) || !Number.isFinite(Date.parse(receivedAt))) return null;

  const inbound = parseInboundMaterial(value['inbound']);
  if (!inbound) return null;
  const normalizedText = normalizedTextRaw === undefined ? undefined : boundedString(normalizedTextRaw, 4096) ?? undefined;
  if (normalizedTextRaw !== undefined && normalizedText === undefined) return null;
  if (normalizedText !== inbound.normalizedText) return null;

  return Object.freeze({
    protocol: QFJ_WHATSAPP_TURN_MATERIAL_PROTOCOL,
    version: 1,
    requestId,
    conversationId,
    inboundMessageId,
    conversationRevision: revision,
    assignedActor: actor as QuickFurnoWhatsAppTurnMaterialV1['assignedActor'],
    subjectType: subject as QuickFurnoWhatsAppTurnMaterialV1['subjectType'],
    tenantId: 'quickfurno.marketplace',
    dataClass: 'HOSTED_ALLOWED',
    ...(subjectRef === undefined ? {} : { subjectRef }),
    receivedAt,
    inbound,
    ...(normalizedText === undefined ? {} : { normalizedText }),
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
export interface QuickFurnoWhatsAppMaterialReader {
  read(input: {
    readonly conversationId: string;
    readonly inboundMessageId: string;
    readonly expectedRevision: number;
  }): Promise<QuickFurnoWhatsAppTurnMaterialV1>;
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
      )
        throw new QuickFurnoWhatsAppHttpError('invalid-input');
      const body = JSON.stringify({
        protocol: QFJ_WHATSAPP_TURN_MATERIAL_PROTOCOL,
        version: 1,
        caller: CALLER,
        audience: AUDIENCE,
        requestId,
        issuedAt,
        conversationId: input.conversationId,
        inboundMessageId: input.inboundMessageId,
        expectedRevision: input.expectedRevision,
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
      const material = parseMaterial(parsed, requestId);
      if (
        material?.conversationId !== input.conversationId ||
        material.inboundMessageId !== input.inboundMessageId ||
        material.conversationRevision !== input.expectedRevision
      ) {
        throw new QuickFurnoWhatsAppHttpError('response-invalid');
      }
      return material;
    },
  });
}
export interface QuickFurnoWhatsAppReplyWriter {
  write(input: {
    readonly conversationId: string;
    readonly expectedRevision: number;
    readonly reply: QuickFurnoWhatsAppAuthorizedReply;
  }): Promise<'queued' | 'stale'>;
}

function actorHeading(actor: QuickFurnoWhatsAppAuthorizedReply['actor']): string {
  return actor === 'RIYA'
    ? 'Riya · Client Concierge'
    : actor === 'ANISHA'
      ? 'Anisha · Partner Concierge'
      : 'Aarohi · Growth Concierge';
}

export function createQuickFurnoWhatsAppReplyWriter(
  config: QuickFurnoWhatsAppHttpConfig,
): QuickFurnoWhatsAppReplyWriter {
  const { key, timeoutMs } = parsePrivateKey(config);
  return Object.freeze({
    async write(input: {
      readonly conversationId: string;
      readonly expectedRevision: number;
      readonly reply: QuickFurnoWhatsAppAuthorizedReply;
    }) {
      if (
        !UUID.test(input.conversationId) ||
        !Number.isSafeInteger(input.expectedRevision) ||
        input.expectedRevision < 0 ||
        input.reply.boundRevision !== input.expectedRevision ||
        !ID.test(input.reply.proposalId) ||
        input.reply.body.length < 1 ||
        input.reply.body.length > 3072
      )
        throw new QuickFurnoWhatsAppHttpError('invalid-input');
      const requestId = config.requestId();
      const issuedAt = config.clock();
      if (
        !UUID.test(requestId) ||
        !INSTANT.test(issuedAt) ||
        !Number.isFinite(Date.parse(issuedAt))
      )
        throw new QuickFurnoWhatsAppHttpError('invalid-input');
      const experience = {
        version: 1,
        actor: input.reply.actor,
        kind: 'text',
        heading: actorHeading(input.reply.actor),
        body: input.reply.body,
      };
      const idempotencyKey = digestHex(
        [
          'qfj.whatsapp.reply.v2',
          input.conversationId,
          String(input.expectedRevision),
          input.reply.proposalId,
          input.reply.actor,
          input.reply.body,
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
        proposalId: input.reply.proposalId,
        actor: input.reply.actor,
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
