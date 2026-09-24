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

function signingInput(body: string): string {
  const digest = createHash('sha256').update(Buffer.from(body, 'utf8')).digest('base64url');
  return [
    QFJ_WHATSAPP_MEDIA_CONTENT_SIGNING_DOMAIN,
    'POST',
    QFJ_WHATSAPP_MEDIA_CONTENT_PATH,
    'qf-jarvis',
    'quickfurno-core',
    requestId,
    '2026-09-24T06:00:00.000Z',
    keyId,
    digest,
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

function input() {
  return {
    conversationId,
    inboundMessageId,
    expectedRevision: 7,
    mediaId: 'media.123',
    mediaKind: 'image' as const,
  };
}

function okResponse(bytes: Uint8Array, overrides: Record<string, string> = {}): Response {
  const digest = createHash('sha256').update(bytes).digest('hex');
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
      'x-qfj-media-sha256': digest,
      ...overrides,
    },
  });
}

describe('QuickFurno WhatsApp signed media content reader', () => {
  it('signs the exact bounded request and accepts bound bytes', async () => {
    const bytes = new TextEncoder().encode('image-bytes');
    const post = vi.fn<QuickFurnoWhatsAppMediaHttpPost>((url, init) => {
      expect(url).toBe('https://quickfurno.example/api/internal/jarvis/whatsapp-media-content');
      expect(init.redirect).toBe('error');
      expect(JSON.parse(init.body)).toEqual({
        protocol: 'qfj.whatsapp.media-content',
        version: 1,
        caller: 'qf-jarvis',
        audience: 'quickfurno-core',
        requestId,
        issuedAt: '2026-09-24T06:00:00.000Z',
        tenantId: 'quickfurno',
        conversationId,
        inboundMessageId,
        expectedRevision: 7,
        mediaId: 'media.123',
        mediaKind: 'image',
      });
      expect(
        verify(
          null,
          Buffer.from(signingInput(init.body), 'utf8'),
          keys.publicKey,
          Buffer.from(init.headers['x-qfj-signature'] ?? '', 'base64url'),
        ),
      ).toBe(true);
      return Promise.resolve(okResponse(bytes));
    });
    const reader = createQuickFurnoWhatsAppMediaContentReader(config(post));
    await expect(reader.read(input())).resolves.toMatchObject({
      conversationId,
      inboundMessageId,
      revision: 7,
      mediaId: 'media.123',
      mediaKind: 'image',
      mimeType: 'image/jpeg',
    });
    expect(post).toHaveBeenCalledOnce();
  });

  it('fails closed on stale revision before consuming content', async () => {
    const post: QuickFurnoWhatsAppMediaHttpPost = () =>
      Promise.resolve(new Response(null, { status: 409 }));
    const reader = createQuickFurnoWhatsAppMediaContentReader(config(post));
    await expect(reader.read(input())).rejects.toMatchObject({ code: 'stale-revision' });
  });

  it('rejects response identity drift', async () => {
    const bytes = new TextEncoder().encode('image-bytes');
    const post: QuickFurnoWhatsAppMediaHttpPost = () =>
      Promise.resolve(okResponse(bytes, { 'x-qfj-media-id': 'other-media' }));
    const reader = createQuickFurnoWhatsAppMediaContentReader(config(post));
    await expect(reader.read(input())).rejects.toMatchObject({ code: 'response-invalid' });
  });

  it('rejects digest mismatch', async () => {
    const bytes = new TextEncoder().encode('image-bytes');
    const post: QuickFurnoWhatsAppMediaHttpPost = () =>
      Promise.resolve(okResponse(bytes, { 'x-qfj-media-sha256': '0'.repeat(64) }));
    const reader = createQuickFurnoWhatsAppMediaContentReader(config(post));
    await expect(reader.read(input())).rejects.toMatchObject({ code: 'response-invalid' });
  });

  it('rejects oversized declared content before reading it', async () => {
    const bytes = new TextEncoder().encode('x');
    const post: QuickFurnoWhatsAppMediaHttpPost = () =>
      Promise.resolve(
        okResponse(bytes, {
          'content-length': String(8 * 1024 * 1024 + 1),
        }),
      );
    const reader = createQuickFurnoWhatsAppMediaContentReader(config(post));
    await expect(reader.read(input())).rejects.toMatchObject({ code: 'response-invalid' });
  });

  it('refuses non-https non-loopback QuickFurno endpoints', () => {
    const post: QuickFurnoWhatsAppMediaHttpPost = () =>
      Promise.reject(new Error('network must not be reached'));
    expect(() =>
      createQuickFurnoWhatsAppMediaContentReader({
        ...config(post),
        baseUrl: 'http://quickfurno.example/',
      }),
    ).toThrow('invalid-config');
  });
});
