import { createHash, generateKeyPairSync, verify } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';

import { createRiyaCustomerRuntimeComposition } from '../riya-customer-orchestration/create-riya-customer-runtime.js';
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
import { createQuickFurnoWhatsAppSpecialistRuntime } from '../quickfurno-whatsapp/specialist-runtime.js';
import {
  createQuickFurnoWhatsAppTurnProcessor,
  type QuickFurnoWhatsAppTurnQueue,
} from '../quickfurno-whatsapp/turn-processor.js';

const jarvisKeyPair = generateKeyPairSync('ed25519');
const keyId = 'jarvis-riya-e2e-test';
const privateKeyPem = jarvisKeyPair.privateKey.export({ format: 'pem', type: 'pkcs8' }).toString();

const now = '2026-09-19T00:30:00.000Z';
const conversationId = '22222222-2222-4222-8222-222222222222';
const inboundMessageId = '33333333-3333-4333-8333-333333333333';
const subjectRef = '44444444-4444-4444-8444-444444444444';
const revision = 7;
const clientText = 'I need a modular kitchen in Pune';
const replyText =
  'Absolutely. I can help you plan the modular kitchen. Please share the approximate kitchen size and your preferred budget range.';

function bodyDigest(body: string): string {
  return createHash('sha256').update(Buffer.from(body, 'utf8')).digest('base64url');
}

function verifyJarvisRequest(
  body: string,
  headers: Readonly<Record<string, string>>,
  path: string,
  domain: string,
): Record<string, unknown> {
  const parsed = JSON.parse(body) as Record<string, unknown>;
  const requestId = parsed['requestId'];
  const issuedAt = parsed['issuedAt'];
  expect(typeof requestId).toBe('string');
  expect(typeof issuedAt).toBe('string');
  expect(headers['x-qfj-key-id']).toBe(keyId);
  const signature = headers['x-qfj-signature'];
  expect(typeof signature).toBe('string');

  const input = [
    domain,
    'POST',
    path,
    'qf-jarvis',
    'quickfurno-core',
    requestId,
    issuedAt,
    keyId,
    bodyDigest(body),
  ].join('\n');

  expect(
    verify(
      null,
      Buffer.from(input, 'utf8'),
      jarvisKeyPair.publicKey,
      Buffer.from(signature ?? '', 'base64url'),
    ),
  ).toBe(true);
  return parsed;
}

describe('Riya complete QuickFurno WhatsApp flow', () => {
  it('materializes a client turn, runs Riya through Mastra, and queues the signed reply', async () => {
    const materialRequestId = '55555555-5555-4555-8555-555555555555';
    const replyRequestId = '66666666-6666-4666-8666-666666666666';
    const requestIds = [materialRequestId, replyRequestId];
    const callbackBodies: Record<string, unknown>[] = [];

    const httpPost: QuickFurnoWhatsAppHttpPost = (url, init) => {
      const path = new URL(url).pathname;

      if (path === QFJ_WHATSAPP_TURN_MATERIAL_PATH) {
        const request = verifyJarvisRequest(
          init.body,
          init.headers,
          QFJ_WHATSAPP_TURN_MATERIAL_PATH,
          QFJ_WHATSAPP_TURN_MATERIAL_SIGNING_DOMAIN,
        );
        expect(request).toMatchObject({
          protocol: 'qfj.whatsapp.turn-material',
          version: 1,
          caller: 'qf-jarvis',
          audience: 'quickfurno-core',
          requestId: materialRequestId,
          conversationId,
          inboundMessageId,
          expectedRevision: revision,
        });

        return Promise.resolve({
          status: 200,
          text: () =>
            Promise.resolve(
              JSON.stringify({
                protocol: 'qfj.whatsapp.turn-material',
                version: 1,
                requestId: materialRequestId,
                conversationId,
                inboundMessageId,
                conversationRevision: revision,
                assignedActor: 'RIYA',
                subjectType: 'client',
                tenantId: 'quickfurno.marketplace',
                dataClass: 'HOSTED_ALLOWED',
                subjectRef,
                receivedAt: now,
                inbound: {
                  version: 1,
                  messageType: 'text',
                  normalizedText: clientText,
                },
                normalizedText: clientText,
              }),
            ),
        });
      }

      if (path === QFJ_WHATSAPP_REPLY_PATH) {
        const request = verifyJarvisRequest(
          init.body,
          init.headers,
          QFJ_WHATSAPP_REPLY_PATH,
          QFJ_WHATSAPP_REPLY_SIGNING_DOMAIN,
        );
        callbackBodies.push(request);
        expect(request).toMatchObject({
          protocol: 'qfj.whatsapp.reply',
          version: 2,
          caller: 'qf-jarvis',
          audience: 'quickfurno-core',
          requestId: replyRequestId,
          conversationId,
          expectedRevision: revision,
          proposalId: 'riya.e2e.reply.1',
          actor: 'RIYA',
          experience: {
            version: 1,
            actor: 'RIYA',
            kind: 'text',
            heading: 'Riya · Client Concierge',
            body: replyText,
          },
        });
        expect(request['idempotencyKey']).toMatch(/^[0-9a-f]{64}$/u);

        return Promise.resolve({
          status: 202,
          text: () =>
            Promise.resolve(
              JSON.stringify({
                protocol: 'qfj.whatsapp.reply',
                version: 2,
                requestId: replyRequestId,
                status: 'queued',
              }),
            ),
        });
      }

      throw new Error('unexpected QuickFurno test endpoint');
    };

    const httpConfig = {
      baseUrl: 'http://127.0.0.1/',
      keyId,
      privateKeyPem,
      clock: () => now,
      requestId: () => {
        const next = requestIds.shift();
        if (!next) throw new Error('request id budget exhausted');
        return next;
      },
      httpPost,
    };

    const handleChannelTurn = vi.fn((turn: unknown) => {
      expect(turn).toMatchObject({
        version: 1,
        channel: 'WHATSAPP',
        tenantId: 'quickfurno.marketplace',
        conversationId,
        messageId: inboundMessageId,
        receivedAt: now,
        channelTurnRef: `qf.inbound:${inboundMessageId}`,
        dataClass: 'HOSTED_ALLOWED',
        subjectRef,
        normalizedText: clientText,
      });
      return Promise.resolve({
        authorizedReply: {
          version: 1,
          proposalId: 'riya.e2e.reply.1',
          boundRevision: revision,
          proposalKind: 'REPLY',
          replyBody: replyText,
        },
      });
    });
    const conversationService = {
      handleTurn: vi.fn(),
      handleChannelTurn,
    };
    const riya = createRiyaCustomerRuntimeComposition({
      conversationService: conversationService as never,
    }).customerTurnRunner;

    const nonRiyaRuntime = vi.fn(() => {
      throw new Error('Anisha/Aarohi runtime must not run for an exact client');
    });
    const specialistRuntime = createQuickFurnoWhatsAppSpecialistRuntime({
      runtimeId: 'qfj.whatsapp.riya.e2e',
      riya,
      jarvisRuntime: {
        processInboundForCoreAuthorizedReply: nonRiyaRuntime,
      } as never,
    });

    let claimed = false;
    const complete = vi.fn((_id: string) => Promise.resolve());
    const fail = vi.fn((_id: string) => Promise.resolve());
    const release = vi.fn((_id: string) => Promise.resolve());
    const queue: QuickFurnoWhatsAppTurnQueue = {
      claimNext: () => {
        if (claimed) return Promise.resolve(null);
        claimed = true;
        return Promise.resolve({
          conversationId,
          conversationRevision: revision,
          inboundMessageId,
          assignedActor: 'RIYA' as const,
          subjectType: 'client' as const,
        });
      },
      complete,
      fail,
      release,
    };

    const processor = createQuickFurnoWhatsAppTurnProcessor({
      queue,
      materialReader: createQuickFurnoWhatsAppMaterialReader(httpConfig),
      specialistRuntime,
      replyWriter: createQuickFurnoWhatsAppReplyWriter(httpConfig),
    });

    expect(await processor.processOne()).toBe('completed-queued');
    expect(await processor.processOne()).toBe('idle');
    expect(handleChannelTurn).toHaveBeenCalledOnce();
    expect(nonRiyaRuntime).not.toHaveBeenCalled();
    expect(callbackBodies).toHaveLength(1);
    expect(complete).toHaveBeenCalledExactlyOnceWith(inboundMessageId);
    expect(fail).not.toHaveBeenCalled();
    expect(release).not.toHaveBeenCalled();
  });
});
