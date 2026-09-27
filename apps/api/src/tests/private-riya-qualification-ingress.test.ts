import { createServer } from 'node:http';
import { createHash, generateKeyPairSync, sign as cryptoSign } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import type {
  RiyaWebConversationResultV2,
  RiyaWebConversationService,
  RiyaWebConversationTurnV1,
} from '@qf-jarvis/riya-web-conversation-service';
import {
  PRIVATE_RIYA_WEB_INGRESS_AUDIENCE,
  PRIVATE_RIYA_WEB_INGRESS_CALLER,
  PRIVATE_RIYA_WEB_INGRESS_PATH,
  PRIVATE_RIYA_WEB_INGRESS_PROTOCOL,
} from '../private-riya-web-ingress/contracts.js';
import { createPrivateRiyaWebIngressHandler } from '../private-riya-web-ingress/create-handler.js';
import {
  KEY_ID_HEADER,
  SIGNATURE_HEADER,
  canonicalSigningInput,
} from '../private-riya-web-ingress/signature.js';

const NOW = '2026-09-27T12:30:00.000Z';
const KEY_ID = 'qf.phase2.test';
const { publicKey, privateKey } = generateKeyPairSync('ed25519');
const PUBLIC_PEM = publicKey.export({ type: 'spki', format: 'pem' }).toString();
const servers: ReturnType<typeof createServer>[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
});

function body(over: Record<string, unknown> = {}) {
  return {
    protocol: PRIVATE_RIYA_WEB_INGRESS_PROTOCOL,
    version: 2,
    caller: PRIVATE_RIYA_WEB_INGRESS_CALLER,
    audience: PRIVATE_RIYA_WEB_INGRESS_AUDIENCE,
    requestId: 'phase2.req.1',
    issuedAt: NOW,
    tenantId: 'quickfurno',
    conversationId: 'phase2.conv.1',
    messageId: 'phase2.msg.1',
    receivedAt: NOW,
    webTurnRef: 'lead-qualification:test',
    qualificationTarget: 'budget',
    questionText: 'Budget range?',
    allowedOptions: ['Below ₹1 lakh', '₹1–3 lakh', '₹3–7 lakh'],
    answerText: 'around five lakh',
    ...over,
  };
}

function headers(raw: string): Record<string, string> {
  const parsed = JSON.parse(raw) as { requestId: string; issuedAt: string };
  const input = canonicalSigningInput({
    method: 'POST',
    path: PRIVATE_RIYA_WEB_INGRESS_PATH,
    caller: PRIVATE_RIYA_WEB_INGRESS_CALLER,
    audience: PRIVATE_RIYA_WEB_INGRESS_AUDIENCE,
    requestId: parsed.requestId,
    issuedAt: parsed.issuedAt,
    keyId: KEY_ID,
    bodyDigest: createHash('sha256').update(Buffer.from(raw)).digest('base64url'),
  });
  return {
    'content-type': 'application/json',
    [KEY_ID_HEADER]: KEY_ID,
    [SIGNATURE_HEADER]: cryptoSign(null, Buffer.from(input), privateKey).toString('base64url'),
  };
}

function service(value: string, provenance: 'user_stated' | 'inferred'): RiyaWebConversationService {
  return {
    async handleTurn(turn: RiyaWebConversationTurnV1): Promise<RiyaWebConversationResultV2> {
      return {
        version: 2,
        tenantId: turn.tenantId,
        conversationId: turn.conversationId,
        messageId: turn.messageId,
        disposition: 'PROCESSED',
        continuity: {
          version: 1,
          tenantId: turn.tenantId,
          conversationId: turn.conversationId,
          continuityRevision: 1,
          phase: 'DISCOVERY',
          summaryConfirmed: false,
          discovery: {
            behaviourVersion: 1,
            completeness: 'MORE_DISCOVERY_REQUIRED',
            budgetNote: value,
          },
          fieldProvenance: {
            budget: provenance,
          },
        },
      } as unknown as RiyaWebConversationResultV2;
    },
  };
}

async function send(
  svc: RiyaWebConversationService,
  over: Record<string, unknown> = {},
  seen: { normalizedText?: string } = {},
) {
  const handler = createPrivateRiyaWebIngressHandler({
    service: svc,
    dataClassPolicy: {
      classify(input) {
        if (input.normalizedText === undefined) {
          delete seen.normalizedText;
        } else {
          seen.normalizedText = input.normalizedText;
        }
        return 'HOSTED_ALLOWED';
      },
    },
    clock: () => NOW,
    verificationKeys: [{ keyId: KEY_ID, publicKeyPem: PUBLIC_PEM }],
  });
  const server = createServer(handler);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as { port: number };
  const raw = JSON.stringify(body(over));
  const response = await fetch(
    `http://127.0.0.1:${port}${PRIVATE_RIYA_WEB_INGRESS_PATH}`,
    { method: 'POST', headers: headers(raw), body: raw },
  );
  return { status: response.status, json: await response.json() as Record<string, unknown> };
}

describe('Phase-2 private Riya qualification ingress', () => {
  it('returns one exact user-stated option and classifies only the client answer', async () => {
    const seen: { normalizedText?: string } = {};
    const result = await send(service('₹3–7 lakh', 'user_stated'), {}, seen);
    expect(result.status).toBe(200);
    expect(seen.normalizedText).toBe('around five lakh');
    expect(seen.normalizedText).not.toContain('Budget range?');
    expect(result.json['version']).toBe(2);
    expect(result.json['qualificationProposal']).toEqual({
      field: 'budget',
      operation: 'SET',
      value: '₹3–7 lakh',
      provenance: 'user_stated',
    });
  });

  it('returns no proposal when Riya produces a value outside Core allowed options', async () => {
    const result = await send(service('₹50 lakh', 'user_stated'));
    expect(result.status).toBe(200);
    expect(result.json['qualificationProposal']).toBeNull();
  });

  it('returns no proposal for inferred evidence', async () => {
    const result = await send(service('₹3–7 lakh', 'inferred'));
    expect(result.status).toBe(200);
    expect(result.json['qualificationProposal']).toBeNull();
  });

  it('rejects V2 requests without a bounded allowed-option set', async () => {
    const result = await send(service('₹3–7 lakh', 'user_stated'), { allowedOptions: [] });
    expect(result.status).toBe(400);
    expect(result.json['qualificationProposal']).toBeUndefined();
  });
});
