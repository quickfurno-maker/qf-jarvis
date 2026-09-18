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
function parseMaterial(value: unknown, requestId: string): QuickFurnoWhatsAppTurnMaterialV1 | null {
  if (!isRecord(value)) return null;
  const required = [
    'protocol',
    'version',
    'requestId',
    'conversationId',
    'inboundMessageId',
    'conversationRevision',
    'assignedActor',
    'subjectType',
    'tenantId',
    'dataClass',
    'receivedAt',
  ];
  const allowed = [...required, 'subjectRef', 'normalizedText'];
  if (
    !Object.keys(value).every((key) => allowed.includes(key)) ||
    !required.every((key) => key in value)
  )
    return null;
  const conversationId = value['conversationId'];
  const inboundMessageId = value['inboundMessageId'];
  const revision = value['conversationRevision'];
  const actor = value['assignedActor'];
  const subject = value['subjectType'];
  const subjectRef = value['subjectRef'];
  const receivedAt = value['receivedAt'];
  const normalizedText = value['normalizedText'];
  if (
    value['protocol'] !== QFJ_WHATSAPP_TURN_MATERIAL_PROTOCOL ||
    value['version'] !== 1 ||
    value['requestId'] !== requestId
  )
    return null;
  if (
    typeof conversationId !== 'string' ||
    !UUID.test(conversationId) ||
    typeof inboundMessageId !== 'string' ||
    !UUID.test(inboundMessageId)
  )
    return null;
  if (typeof revision !== 'number' || !Number.isSafeInteger(revision) || revision < 0) return null;
  if (typeof actor !== 'string' || !['RIYA', 'ANISHA', 'AAROHI'].includes(actor)) return null;
  if (typeof subject !== 'string' || !['client', 'vendor', 'prospect'].includes(subject))
    return null;
  if (value['tenantId'] !== 'quickfurno.marketplace' || value['dataClass'] !== 'HOSTED_ALLOWED')
    return null;
  if (subjectRef !== undefined && (typeof subjectRef !== 'string' || !UUID.test(subjectRef)))
    return null;
  if (
    typeof receivedAt !== 'string' ||
    !INSTANT.test(receivedAt) ||
    !Number.isFinite(Date.parse(receivedAt))
  )
    return null;
  if (
    normalizedText !== undefined &&
    (typeof normalizedText !== 'string' || normalizedText.length > 4096)
  )
    return null;
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
