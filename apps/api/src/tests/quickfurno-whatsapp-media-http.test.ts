import { createHash, generateKeyPairSync, verify } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';

import {
  createQuickFurnoWhatsAppMediaContentReader,
  type QuickFurnoWhatsAppMediaHttpPost,
} from '../quickfurno-whatsapp/media-content-http.js';
import {
  QFJ_WHATSAPP_MEDIA_CONTENT_PATH,
  QFJ_WHATSAPP_MEDIA_CONTENT_SIGNING_DOMAIN,
} from '../quickfurno-whatsapp/contracts.js';

const keys = generateKeyPairSync('ed25519');
const keyId = 'jarvis-media-test';
const privateKeyPem = keys.privateKey.export({ format: 'pem', type: 'pkcs8' }).toString();
const requestId = '11111111-1111-4111-8111-111111111111';
const conversationId = '22222222-2222-4222-8222-222222222222';
const inboundMessageId = '33333333-3333-4333-8333-333333333333';

function digestBase64Url(body: string): string {
  return createHash('sha256').update(Buffer.from(body, 'utf8')).digest('base64url');
}

function signingInput(body: string, request: Record<string, unknown>): string {
  return [
    QFJ_WHATSAPP_MEDIA_CONTENT_SIGNING_DOMAIN,
    'POST',
    QFJ_WHATSAPP_MEDIA_CONTENT_PATH,
    'qf-jarvis',
    'quickfurno-core',
    String(request['requestId']),
    String(request['issuedAt']),
    keyId,
    digestBase64Url(body),
  ].join('\n');
}

function config(httpPost: QuickFurnoWhatsAppMediaHttpPost) {
  return {
    baseUrl: 'https://quickfurno.example/',
    keyId,
    privateKeyPem,
    clock: () => '2026-09-24T06:00:00.000Z',
    requestId: () => requestId,
    httpPost,
  };
}

function binaryResponse(bytes: Uint8Array, headers: Record<string, string> = {}): Response {
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  return new Response(bytes, {
    status: 200,
    headers: {
      'content-type': 'image/jpeg',
      'content-length': String(bytes.byteLength),
      'x-qfj-media-request-id': requestId,
      'x-qfj-media-conversation-id': conversationId,
      'x-qfj-media-inbound-id': inboundMessageId,
      'x-qfj-media-revision': '7',
      'x-qfj-media-id': 'media.123',
      'x-qfj-media-kind': 'image',
      'x-qfj-media-sha256': sha256,
      ...headers,
    },
  });
}

describe('QuickFurno signed WhatsApp media reader', () => {
  it('signs an exact turn-bound request and accepts only matching binary evidence', async () => {
    const bytes = new TextEncoder().encode('bounded-image-bytes');
    const post = vi.fn<QuickFurnoWhatsAppMediaHttpPost>((url, init) => {
      expect(url).toBe('https://quickfurno.example/api/internal/jarvis/whatsapp-media-content');
      expect(init.redirect).toBe('error');
      const request = JSON.parse(init.body) as Record<string, unknown>;
      expect(request).toMatchObject({
        protocol: 'qfj.whatsapp.media-content',
        version: 1,
        caller: 'qf-jarvis',
        audience: 'quickfurno-core',
        tenantId: 'quickfurno',
        conversationId,
        inboundMessageId,
        expectedRevision: 7,
        mediaId: 'media.123',
        mediaKind: 'image',
      });
      const signature = init.headers['x-qfj-signature'];
      if (signature === undefined) throw new Error('missing test signature');
      expect(
        verify(
          null,
          Buffer.from(signingInput(init.body, request), 'utf8'),
          keys.publicKey,
          Buffer.from(signature, 'base64url'),
        ),
      ).toBe(true);
      return Promise.resolve(binaryResponse(bytes));
    });

    const reader = createQuickFurnoWhatsAppMediaContentReader(config(post));
    const content = await reader.read({
      conversationId,
      inboundMessageId,
      expectedRevision: 7,
      mediaId: 'media.123',
      mediaKind: 'image',
    });

    expect(content).toMatchObject({
      conversationId,
      inboundMessageId,
      revision: 7,
      mediaId: 'media.123',
      mediaKind: 'image',
      mimeType: 'image/jpeg',
      sha256: createHash('sha256').update(bytes).digest('hex'),
    });
    expect([...content.bytes]).toEqual([...bytes]);
    expect(post).toHaveBeenCalledOnce();
  });

  it('rejects response identity drift before accepting media bytes', async () => {
    const bytes = new TextEncoder().encode('bytes');
    const post: QuickFurnoWhatsAppMediaHttpPost = () =>
      Promise.resolve(
        binaryResponse(bytes, {
          'x-qfj-media-inbound-id': '44444444-4444-4444-8444-444444444444',
        }),
      );
    const reader = createQuickFurnoWhatsAppMediaContentReader(config(post));
    await expect(
      reader.read({
        conversationId,
        inboundMessageId,
        expectedRevision: 7,
        mediaId: 'media.123',
        mediaKind: 'image',
      }),
    ).rejects.toMatchObject({ code: 'response-invalid' });
  });

  it('rejects a body whose digest does not match the QuickFurno response binding', async () => {
    const bytes = new TextEncoder().encode('actual');
    const post: QuickFurnoWhatsAppMediaHttpPost = () =>
      Promise.resolve(
        binaryResponse(bytes, {
          'x-qfj-media-sha256': createHash('sha256').update('different').digest('hex'),
        }),
      );
    const reader = createQuickFurnoWhatsAppMediaContentReader(config(post));
    await expect(
      reader.read({
        conversationId,
        inboundMessageId,
        expectedRevision: 7,
        mediaId: 'media.123',
        mediaKind: 'image',
      }),
    ).rejects.toMatchObject({ code: 'response-invalid' });
  });

  it('maps a stale QuickFurno revision to a terminal stale result', async () => {
    const post: QuickFurnoWhatsAppMediaHttpPost = () =>
      Promise.resolve(new Response('{}', { status: 409 }));
    const reader = createQuickFurnoWhatsAppMediaContentReader(config(post));
    await expect(
      reader.read({
        conversationId,
        inboundMessageId,
        expectedRevision: 7,
        mediaId: 'media.123',
        mediaKind: 'image',
      }),
    ).rejects.toMatchObject({ code: 'stale-revision' });
  });

  it('rejects invalid identifiers without making a request', async () => {
    const post = vi.fn<QuickFurnoWhatsAppMediaHttpPost>();
    const reader = createQuickFurnoWhatsAppMediaContentReader(config(post));
    await expect(
      reader.read({
        conversationId,
        inboundMessageId,
        expectedRevision: 7,
        mediaId: 'https://provider.example/token',
        mediaKind: 'image',
      }),
    ).rejects.toMatchObject({ code: 'invalid-input' });
    expect(post).not.toHaveBeenCalled();
  });
});
