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
import { createQuickFurnoWhatsAppSpecialistRuntime } from '../quickfurno-whatsapp/specialist-runtime.js';
import {
  createQuickFurnoWhatsAppTurnProcessor,
  type QuickFurnoWhatsAppTurnQueue,
} from '../quickfurno-whatsapp/turn-processor.js';

const jarvisKeyPair = generateKeyPairSync('ed25519');
const keyId = 'jarvis-anisha-e2e-test';
const privateKeyPem = jarvisKeyPair.privateKey.export({ format: 'pem', type: 'pkcs8' }).toString();

const now = '2026-09-19T00:30:00.000Z';
const conversationId = '22222222-2222-4222-8222-222222222222';
const inboundMessageId = '33333333-3333-4333-8333-333333333333';
const subjectRef = '44444444-4444-4444-8444-444444444444';
const revision = 7;
const vendorText = 'Mere vendor package aur leads ki madad chahiye';
const replyText =
  'Main aapki madad kar sakti hoon. Package aur credit balance ki exact detail QuickFurno Core se verify hoti hai.';

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

describe('Anisha complete signed QuickFurno WhatsApp flow', () => {
  it.each([
    {
      label: 'valid identified vendor, signed Core reply queued',
      materialOverrides: {},
      replyStatus: 202,
      expected: 'completed-queued',
      expectedModels: 1,
      expectedCallbacks: 1,
    },
    {
      label: 'paused vendor cannot invoke Anisha',
      materialOverrides: { conversationState: 'PAUSED', jarvisAllowed: false, aiPaused: true },
      replyStatus: 202,
      expected: 'completed-no-reply',
      expectedModels: 0,
      expectedCallbacks: 0,
    },
    {
      label: 'human takeover suppresses Anisha model and reply',
      materialOverrides: { conversationState: 'HUMAN', jarvisAllowed: false, humanTakeover: true },
      replyStatus: 202,
      expected: 'completed-no-reply',
      expectedModels: 0,
      expectedCallbacks: 0,
    },
    {
      label: 'erased vendor blocks Core-hosted model',
      materialOverrides: { subjectStatus: 'erased', jarvisAllowed: false },
      replyStatus: 202,
      expected: 'completed-no-reply',
      expectedModels: 0,
      expectedCallbacks: 0,
    },
    {
      label: 'non-hosted vendor data rejected before Anisha',
      materialOverrides: { dataClass: 'LOCAL_ONLY', jarvisAllowed: false },
      replyStatus: 202,
      expected: 'failed-indeterminate',
      expectedModels: 0,
      expectedCallbacks: 0,
    },
    {
      label: 'contradictory Core party rejected before model',
      materialOverrides: { partyType: 'CLIENT' },
      replyStatus: 202,
      expected: 'failed-indeterminate',
      expectedModels: 0,
      expectedCallbacks: 0,
    },
    {
      label: 'missing vendor subject reference rejected before model',
      materialOverrides: { subjectRef: undefined },
      replyStatus: 202,
      expected: 'failed-indeterminate',
      expectedModels: 0,
      expectedCallbacks: 0,
    },
    {
      label: 'Core rejects stale reply revision with 409 and no replay',
      materialOverrides: {},
      replyStatus: 409,
      expected: 'completed-stale',
      expectedModels: 1,
      expectedCallbacks: 1,
    },
    {
      label: 'indeterminate Core callback does not rerun model',
      materialOverrides: {},
      replyStatus: 503,
      expected: 'failed-indeterminate',
      expectedModels: 1,
      expectedCallbacks: 1,
    },
  ])(
    '$label',
    async ({ materialOverrides, replyStatus, expected, expectedModels, expectedCallbacks }) => {
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
            version: 2,
            caller: 'qf-jarvis',
            audience: 'quickfurno-core',
            requestId: materialRequestId,
            tenantId: 'quickfurno',
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
                  version: 2,
                  requestId: materialRequestId,
                  tenantId: 'quickfurno',
                  conversationId,
                  revision,
                  assignedActor: 'ANISHA',
                  subjectType: 'vendor',
                  partyType: 'VENDOR',
                  conversationState: 'OPEN',
                  jarvisAllowed: true,
                  dataClass: 'HOSTED_ALLOWED',
                  humanTakeover: false,
                  aiPaused: false,
                  cancelled: false,
                  subjectStatus: 'clear',
                  subjectRef,
                  observedAt: now,
                  inboundMessageId,
                  receivedAt: now,
                  inbound: {
                    version: 1,
                    messageType: 'text',
                    normalizedText: vendorText,
                  },
                  normalizedText: vendorText,
                  ...materialOverrides,
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
            proposalId: 'anisha.e2e.reply.1',
            actor: 'ANISHA',
            experience: {
              version: 1,
              actor: 'ANISHA',
              kind: 'text',
              heading: 'Anisha · Partner Concierge',
              body: replyText,
            },
          });
          expect(request['idempotencyKey']).toMatch(/^[0-9a-f]{64}$/u);

          return Promise.resolve({
            status: replyStatus,
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

      const processInboundForProposedReply = vi.fn((envelope: unknown) => {
        expect(envelope).toMatchObject({
          runtimeId: 'qfj.whatsapp.anisha.e2e',
          channel: 'WHATSAPP',
          tenantId: 'quickfurno',
          conversationId,
          messageId: inboundMessageId,
          partyType: 'VENDOR',
          direction: 'INBOUND',
          receivedAt: now,
          providerMessageRef: `qf.inbound:${inboundMessageId}`,
          dataClass: 'HOSTED_ALLOWED',
          subjectRef,
          normalizedText: vendorText,
        });
        return Promise.resolve({
          runtimeResult: {
            outcome: 'MODEL_DRAFTED',
            conversationId,
            boundRevision: revision,
            proposalId: 'anisha.e2e.reply.1',
            modelDrafted: true,
            coreConsulted: false,
          },
          proposedReply: {
            version: 1,
            proposalId: 'anisha.e2e.reply.1',
            boundRevision: revision,
            proposalKind: 'REPLY',
            authorityStatus: 'PENDING_CORE_VALIDATION',
            replyBody: replyText,
          },
        });
      });
      const specialistRuntime = createQuickFurnoWhatsAppSpecialistRuntime({
        runtimeId: 'qfj.whatsapp.anisha.e2e',
        jarvisRuntime: {
          processInboundForProposedReply,
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
            assignedActor: 'ANISHA' as const,
            subjectType: 'vendor' as const,
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

      expect(await processor.processOne()).toBe(expected);
      expect(await processor.processOne()).toBe('idle');
      expect(processInboundForProposedReply).toHaveBeenCalledTimes(expectedModels);
      expect(callbackBodies).toHaveLength(expectedCallbacks);
      if (expected === 'failed-indeterminate') {
        expect(fail).toHaveBeenCalledExactlyOnceWith(inboundMessageId);
        expect(complete).not.toHaveBeenCalled();
      } else {
        expect(complete).toHaveBeenCalledExactlyOnceWith(inboundMessageId);
        expect(fail).not.toHaveBeenCalled();
      }
      expect(release).not.toHaveBeenCalled();
    },
  );
});
