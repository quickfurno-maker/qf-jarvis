import { createHash, generateKeyPairSync, verify } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import {
  createQuickFurnoWhatsAppMaterialReader,
  createQuickFurnoWhatsAppReplyWriter,
  type QuickFurnoWhatsAppHttpPost,
} from '../quickfurno-whatsapp/quickfurno-http.js';
import {
  QFJ_WHATSAPP_REPLY_PATH,
  QFJ_WHATSAPP_REPLY_SIGNING_DOMAIN,
  QFJ_WHATSAPP_TURN_MATERIAL_PATH,
  QFJ_WHATSAPP_TURN_MATERIAL_SIGNING_DOMAIN,
} from '../quickfurno-whatsapp/contracts.js';

const keys = generateKeyPairSync('ed25519');
const keyId = 'jarvis-test';
const privateKeyPem = keys.privateKey.export({ format: 'pem', type: 'pkcs8' }).toString();
const requestIds = ['11111111-1111-4111-8111-111111111111', '55555555-5555-4555-8555-555555555555'];

function bodyDigest(body: string): string {
  return createHash('sha256').update(Buffer.from(body, 'utf8')).digest('base64url');
}
function signingInput(
  domain: string,
  pathName: string,
  requestId: string,
  issuedAt: string,
  body: string,
): string {
  return [
    domain,
    'POST',
    pathName,
    'qf-jarvis',
    'quickfurno-core',
    requestId,
    issuedAt,
    keyId,
    bodyDigest(body),
  ].join('\n');
}
function config(httpPost: QuickFurnoWhatsAppHttpPost) {
  let index = 0;
  return {
    baseUrl: 'https://quickfurno.example/',
    keyId,
    privateKeyPem,
    clock: () => '2026-09-18T12:00:00.000Z',
    requestId: () => requestIds[index++] ?? '99999999-9999-4999-8999-999999999999',
    httpPost,
  };
}
describe('QuickFurno WhatsApp signed HTTP clients', () => {
  it('material reader signs the exact bytes and accepts only the bound response identity', async () => {
    const post = vi.fn<QuickFurnoWhatsAppHttpPost>((_url, init) => {
      const request = JSON.parse(init.body) as Record<string, unknown>;
      const signature = init.headers['x-qfj-signature'];
      if (signature === undefined) throw new Error('signature missing in test request');
      expect(
        verify(
          null,
          Buffer.from(
            signingInput(
              QFJ_WHATSAPP_TURN_MATERIAL_SIGNING_DOMAIN,
              QFJ_WHATSAPP_TURN_MATERIAL_PATH,
              String(request['requestId']),
              String(request['issuedAt']),
              init.body,
            ),
            'utf8',
          ),
          keys.publicKey,
          Buffer.from(signature, 'base64url'),
        ),
      ).toBe(true);
      const responseBody = {
        protocol: 'qfj.whatsapp.turn-material',
        version: 1,
        requestId: request['requestId'],
        conversationId: request['conversationId'],
        inboundMessageId: request['inboundMessageId'],
        conversationRevision: request['expectedRevision'],
        assignedActor: 'RIYA',
        subjectType: 'client',
        tenantId: 'quickfurno.marketplace',
        dataClass: 'HOSTED_ALLOWED',
        subjectRef: '44444444-4444-4444-8444-444444444444',
        receivedAt: '2026-09-18T12:00:00.000Z',
        inbound: {
          version: 1,
          messageType: 'image',
          normalizedText: '[Attachment: image; content not inspected] Caption: Need this style',
          attachment: {
            kind: 'image',
            mediaId: 'media-123',
            mimeType: 'image/jpeg',
            caption: 'Need this style',
          },
          replyContext: { providerMessageId: 'wamid.parent' },
          referral: { sourceType: 'ad', sourceId: 'ad-123' },
        },
        normalizedText: '[Attachment: image; content not inspected] Caption: Need this style',
      };
      return Promise.resolve({
        status: 200,
        text: () => Promise.resolve(JSON.stringify(responseBody)),
      });
    });
    const reader = createQuickFurnoWhatsAppMaterialReader(config(post));
    const result = await reader.read({
      conversationId: '22222222-2222-4222-8222-222222222222',
      inboundMessageId: '33333333-3333-4333-8333-333333333333',
      expectedRevision: 7,
    });
    expect(result).toMatchObject({
      assignedActor: 'RIYA',
      subjectType: 'client',
      tenantId: 'quickfurno.marketplace',
    });
    expect(result.inbound).toMatchObject({
      messageType: 'image',
      attachment: { mediaId: 'media-123' },
      replyContext: { providerMessageId: 'wamid.parent' },
    });
    expect(post).toHaveBeenCalledOnce();
  });

  it('material reader rejects conflicting parallel text and structured material', async () => {
    const post: QuickFurnoWhatsAppHttpPost = (_url, init) => {
      const request = JSON.parse(init.body) as Record<string, unknown>;
      return Promise.resolve({
        status: 200,
        text: () => Promise.resolve(JSON.stringify({
          protocol: 'qfj.whatsapp.turn-material',
          version: 1,
          requestId: request['requestId'],
          conversationId: request['conversationId'],
          inboundMessageId: request['inboundMessageId'],
          conversationRevision: request['expectedRevision'],
          assignedActor: 'RIYA',
          subjectType: 'client',
          tenantId: 'quickfurno.marketplace',
          dataClass: 'HOSTED_ALLOWED',
          receivedAt: '2026-09-18T12:00:00.000Z',
          inbound: { version: 1, messageType: 'text', normalizedText: 'trusted text' },
          normalizedText: 'different text',
        })),
      });
    };
    const reader = createQuickFurnoWhatsAppMaterialReader(config(post));
    await expect(reader.read({
      conversationId: '22222222-2222-4222-8222-222222222222',
      inboundMessageId: '33333333-3333-4333-8333-333333333333',
      expectedRevision: 7,
    })).rejects.toMatchObject({ code: 'response-invalid' });
  });

  it('reply writer signs V2 structured Concierge output with deterministic idempotency', async () => {
    let captured: Record<string, unknown> | undefined;
    const post = vi.fn<QuickFurnoWhatsAppHttpPost>((_url, init) => {
      const request = JSON.parse(init.body) as Record<string, unknown>;
      captured = request;
      const signature = init.headers['x-qfj-signature'];
      if (signature === undefined) throw new Error('signature missing in test request');
      expect(
        verify(
          null,
          Buffer.from(
            signingInput(
              QFJ_WHATSAPP_REPLY_SIGNING_DOMAIN,
              QFJ_WHATSAPP_REPLY_PATH,
              String(request['requestId']),
              String(request['issuedAt']),
              init.body,
            ),
            'utf8',
          ),
          keys.publicKey,
          Buffer.from(signature, 'base64url'),
        ),
      ).toBe(true);
      return Promise.resolve({
        status: 202,
        text: () =>
          Promise.resolve(
            JSON.stringify({
              protocol: 'qfj.whatsapp.reply',
              version: 2,
              requestId: request['requestId'],
              status: 'queued',
            }),
          ),
      });
    });
    const writer = createQuickFurnoWhatsAppReplyWriter(config(post));
    const outcome = await writer.write({
      conversationId: '22222222-2222-4222-8222-222222222222',
      expectedRevision: 7,
      reply: {
        actor: 'ANISHA',
        proposalId: 'prop.vendor.1',
        boundRevision: 7,
        body: 'Vendor assistance reply',
      },
    });
    expect(outcome).toBe('queued');
    expect(captured?.['actor']).toBe('ANISHA');
    expect(String(captured?.['idempotencyKey'])).toMatch(/^[0-9a-f]{64}$/u);
    expect(captured?.['experience']).toMatchObject({
      actor: 'ANISHA',
      kind: 'text',
      heading: 'Anisha · Partner Concierge',
    });
  });

  it('maps a QuickFurno revision conflict to a terminal stale result', async () => {
    const post: QuickFurnoWhatsAppHttpPost = () =>
      Promise.resolve({
        status: 409,
        text: () => Promise.resolve('{}'),
      });
    const writer = createQuickFurnoWhatsAppReplyWriter(config(post));
    await expect(
      writer.write({
        conversationId: '22222222-2222-4222-8222-222222222222',
        expectedRevision: 7,
        reply: { actor: 'RIYA', proposalId: 'prop.1', boundRevision: 7, body: 'hello' },
      }),
    ).resolves.toBe('stale');
  });
});
