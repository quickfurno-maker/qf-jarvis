import { createHash, createPrivateKey, sign, type KeyObject } from 'node:crypto';

import {
  QFJ_WHATSAPP_MEDIA_CONTENT_PATH,
  QFJ_WHATSAPP_MEDIA_CONTENT_PROTOCOL,
  QFJ_WHATSAPP_MEDIA_CONTENT_SIGNING_DOMAIN,
  QFJ_WHATSAPP_MEDIA_CONVERSATION_ID_HEADER,
  QFJ_WHATSAPP_MEDIA_ID_HEADER,
  QFJ_WHATSAPP_MEDIA_INBOUND_ID_HEADER,
  QFJ_WHATSAPP_MEDIA_KIND_HEADER,
  QFJ_WHATSAPP_MEDIA_REQUEST_ID_HEADER,
  QFJ_WHATSAPP_MEDIA_REVISION_HEADER,
  QFJ_WHATSAPP_MEDIA_SHA256_HEADER,
  type QuickFurnoWhatsAppMediaKind,
} from './contracts.js';

const KEY_ID_HEADER = 'x-qfj-key-id';
const SIGNATURE_HEADER = 'x-qfj-signature';
const CALLER = 'qf-jarvis';
const AUDIENCE = 'quickfurno-core';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const KEY_ID = /^[A-Za-z0-9._:-]{1,64}$/u;
const MEDIA_ID = /^[A-Za-z0-9._:-]{1,256}$/u;
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u;
const MEDIA_KINDS = ['image', 'document', 'audio', 'video', 'sticker'] as const;
const MAX_BYTES: Readonly<Record<QuickFurnoWhatsAppMediaKind, number>> = Object.freeze({
  image: 8 * 1024 * 1024,
  document: 32 * 1024 * 1024,
  audio: 20 * 1024 * 1024,
  video: 20 * 1024 * 1024,
  sticker: 2 * 1024 * 1024,
});

export interface QuickFurnoWhatsAppMediaHttpResponse {
  readonly status: number;
  readonly headers: { get(name: string): string | null };
  readonly body: ReadableStream<Uint8Array> | null;
}

export type QuickFurnoWhatsAppMediaHttpPost = (
  url: string,
  init: Readonly<{
    method: 'POST';
    headers: Readonly<Record<string, string>>;
    body: string;
    signal: AbortSignal;
    redirect: 'error';
  }>,
) => Promise<QuickFurnoWhatsAppMediaHttpResponse>;

export interface QuickFurnoWhatsAppMediaHttpConfig {
  readonly baseUrl: string;
  readonly keyId: string;
  readonly privateKeyPem: string;
  readonly clock: () => string;
  readonly requestId: () => string;
  readonly httpPost: QuickFurnoWhatsAppMediaHttpPost;
  readonly timeoutMs?: number;
}

export interface QuickFurnoWhatsAppMediaContent {
  readonly conversationId: string;
  readonly inboundMessageId: string;
  readonly revision: number;
  readonly mediaId: string;
  readonly mediaKind: QuickFurnoWhatsAppMediaKind;
  readonly mimeType: string;
  readonly sha256: string;
  readonly bytes: Uint8Array;
}

export type QuickFurnoWhatsAppMediaHttpErrorCode =
  'invalid-config' | 'invalid-input' | 'request-failed' | 'response-invalid' | 'stale-revision';

export class QuickFurnoWhatsAppMediaHttpError extends Error {
  readonly code: QuickFurnoWhatsAppMediaHttpErrorCode;
  constructor(code: QuickFurnoWhatsAppMediaHttpErrorCode) {
    super(code);
    this.name = 'QuickFurnoWhatsAppMediaHttpError';
    this.code = code;
  }
}

function endpointFor(baseUrl: string): string {
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new QuickFurnoWhatsAppMediaHttpError('invalid-config');
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
    throw new QuickFurnoWhatsAppMediaHttpError('invalid-config');
  }
  return new URL(QFJ_WHATSAPP_MEDIA_CONTENT_PATH, url).toString();
}

function digestBase64Url(body: string): string {
  return createHash('sha256').update(Buffer.from(body, 'utf8')).digest('base64url');
}

function signingInput(
  requestId: string,
  issuedAt: string,
  keyId: string,
  bodyDigest: string,
): string {
  return [
    QFJ_WHATSAPP_MEDIA_CONTENT_SIGNING_DOMAIN,
    'POST',
    QFJ_WHATSAPP_MEDIA_CONTENT_PATH,
    CALLER,
    AUDIENCE,
    requestId,
    issuedAt,
    keyId,
    bodyDigest,
  ].join('\n');
}

function parsePrivateKey(config: QuickFurnoWhatsAppMediaHttpConfig): {
  readonly key: KeyObject;
  readonly timeoutMs: number;
} {
  if (
    !KEY_ID.test(config.keyId) ||
    typeof config.privateKeyPem !== 'string' ||
    !config.privateKeyPem.includes('PRIVATE KEY') ||
    typeof config.clock !== 'function' ||
    typeof config.requestId !== 'function' ||
    typeof config.httpPost !== 'function'
  ) {
    throw new QuickFurnoWhatsAppMediaHttpError('invalid-config');
  }
  const timeoutMs = config.timeoutMs ?? 5_000;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 30_000) {
    throw new QuickFurnoWhatsAppMediaHttpError('invalid-config');
  }
  let key: KeyObject;
  try {
    key = createPrivateKey(config.privateKeyPem);
  } catch {
    throw new QuickFurnoWhatsAppMediaHttpError('invalid-config');
  }
  if (key.type !== 'private' || key.asymmetricKeyType !== 'ed25519') {
    throw new QuickFurnoWhatsAppMediaHttpError('invalid-config');
  }
  return { key, timeoutMs };
}

function normalizeMime(value: string | null): string | null {
  if (value === null) return null;
  const mime = value.split(';', 1)[0]?.trim().toLowerCase() ?? '';
  return /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/u.test(mime) ? mime : null;
}

async function readBounded(
  body: ReadableStream<Uint8Array> | null,
  maxBytes: number,
): Promise<Uint8Array> {
  if (body === null) throw new QuickFurnoWhatsAppMediaHttpError('response-invalid');
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      total += part.value.byteLength;
      if (total > maxBytes) throw new QuickFurnoWhatsAppMediaHttpError('response-invalid');
      chunks.push(part.value);
    }
  } finally {
    try {
      await reader.cancel();
    } catch {
      // best effort only
    }
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function exactHeader(
  response: QuickFurnoWhatsAppMediaHttpResponse,
  name: string,
  expected: string,
): boolean {
  return response.headers.get(name) === expected;
}

export interface QuickFurnoWhatsAppMediaContentReader {
  read(input: {
    readonly conversationId: string;
    readonly inboundMessageId: string;
    readonly expectedRevision: number;
    readonly mediaId: string;
    readonly mediaKind: QuickFurnoWhatsAppMediaKind;
  }): Promise<QuickFurnoWhatsAppMediaContent>;
}

export function createQuickFurnoWhatsAppMediaContentReader(
  config: QuickFurnoWhatsAppMediaHttpConfig,
): QuickFurnoWhatsAppMediaContentReader {
  const { key, timeoutMs } = parsePrivateKey(config);
  const endpoint = endpointFor(config.baseUrl);

  return Object.freeze({
    async read(input: Parameters<QuickFurnoWhatsAppMediaContentReader['read']>[0]) {
      if (
        !UUID.test(input.conversationId) ||
        !UUID.test(input.inboundMessageId) ||
        !Number.isSafeInteger(input.expectedRevision) ||
        input.expectedRevision < 0 ||
        !MEDIA_ID.test(input.mediaId) ||
        !(MEDIA_KINDS as readonly string[]).includes(input.mediaKind)
      ) {
        throw new QuickFurnoWhatsAppMediaHttpError('invalid-input');
      }

      const requestId = config.requestId();
      const issuedAt = config.clock();
      if (
        !UUID.test(requestId) ||
        !INSTANT.test(issuedAt) ||
        !Number.isFinite(Date.parse(issuedAt))
      ) {
        throw new QuickFurnoWhatsAppMediaHttpError('invalid-input');
      }

      const body = JSON.stringify({
        protocol: QFJ_WHATSAPP_MEDIA_CONTENT_PROTOCOL,
        version: 1,
        caller: CALLER,
        audience: AUDIENCE,
        requestId,
        issuedAt,
        tenantId: 'quickfurno',
        conversationId: input.conversationId,
        inboundMessageId: input.inboundMessageId,
        expectedRevision: input.expectedRevision,
        mediaId: input.mediaId,
        mediaKind: input.mediaKind,
      });
      const signature = sign(
        null,
        Buffer.from(signingInput(requestId, issuedAt, config.keyId, digestBase64Url(body)), 'utf8'),
        key,
      ).toString('base64url');

      const controller = new AbortController();
      const timer = setTimeout(() => {
        controller.abort();
      }, timeoutMs);
      let response: QuickFurnoWhatsAppMediaHttpResponse;
      try {
        response = await config.httpPost(endpoint, {
          method: 'POST',
          redirect: 'error',
          signal: controller.signal,
          body,
          headers: Object.freeze({
            'content-type': 'application/json',
            [KEY_ID_HEADER]: config.keyId,
            [SIGNATURE_HEADER]: signature,
          }),
        });
      } catch {
        throw new QuickFurnoWhatsAppMediaHttpError('request-failed');
      } finally {
        clearTimeout(timer);
      }

      if (response.status === 409) throw new QuickFurnoWhatsAppMediaHttpError('stale-revision');
      if (response.status !== 200) throw new QuickFurnoWhatsAppMediaHttpError('request-failed');
      if (
        !exactHeader(response, QFJ_WHATSAPP_MEDIA_REQUEST_ID_HEADER, requestId) ||
        !exactHeader(response, QFJ_WHATSAPP_MEDIA_CONVERSATION_ID_HEADER, input.conversationId) ||
        !exactHeader(response, QFJ_WHATSAPP_MEDIA_INBOUND_ID_HEADER, input.inboundMessageId) ||
        !exactHeader(
          response,
          QFJ_WHATSAPP_MEDIA_REVISION_HEADER,
          String(input.expectedRevision),
        ) ||
        !exactHeader(response, QFJ_WHATSAPP_MEDIA_ID_HEADER, input.mediaId) ||
        !exactHeader(response, QFJ_WHATSAPP_MEDIA_KIND_HEADER, input.mediaKind)
      ) {
        throw new QuickFurnoWhatsAppMediaHttpError('response-invalid');
      }

      const digest = response.headers.get(QFJ_WHATSAPP_MEDIA_SHA256_HEADER);
      const mimeType = normalizeMime(response.headers.get('content-type'));
      const declaredLength = response.headers.get('content-length');
      const maxBytes = MAX_BYTES[input.mediaKind];
      if (
        digest === null ||
        !/^[0-9a-f]{64}$/u.test(digest) ||
        mimeType === null ||
        declaredLength === null ||
        !/^\d{1,10}$/u.test(declaredLength) ||
        Number(declaredLength) > maxBytes
      ) {
        throw new QuickFurnoWhatsAppMediaHttpError('response-invalid');
      }

      const bytes = await readBounded(response.body, maxBytes);
      if (bytes.byteLength !== Number(declaredLength)) {
        throw new QuickFurnoWhatsAppMediaHttpError('response-invalid');
      }
      const actualDigest = createHash('sha256').update(bytes).digest('hex');
      if (actualDigest !== digest) {
        throw new QuickFurnoWhatsAppMediaHttpError('response-invalid');
      }

      return Object.freeze({
        conversationId: input.conversationId,
        inboundMessageId: input.inboundMessageId,
        revision: input.expectedRevision,
        mediaId: input.mediaId,
        mediaKind: input.mediaKind,
        mimeType,
        sha256: digest,
        bytes,
      });
    },
  });
}
