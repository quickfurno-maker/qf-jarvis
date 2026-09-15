import { generateKeyPairSync, verify } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import {
  QUICKFURNO_CORE_DECISION_AUDIENCE,
  QUICKFURNO_CORE_DECISION_CALLER,
  QUICKFURNO_CORE_DECISION_KEY_ID_HEADER,
  QUICKFURNO_CORE_DECISION_METHOD,
  QUICKFURNO_CORE_DECISION_PATH,
  QUICKFURNO_CORE_DECISION_SIGNATURE_HEADER,
  QUICKFURNO_CORE_DECISION_SIGNING_DOMAIN,
  QuickFurnoCoreTransportError,
  createQuickFurnoCoreTransport,
  quickFurnoCoreSigningInput,
  rawQuickFurnoCoreBodyDigest,
  type QuickFurnoCoreHttpPost,
} from '../index.js';

const { publicKey, privateKey } = generateKeyPairSync('ed25519');
const privateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
const keyId = 'jarvis-core-test-1';
const command = JSON.stringify({
  protocol: { name: 'qfj.core.decision', version: 2, contractDigest: 'c0de0002' },
  commandId: 'conv-1-prop-1-r7',
  idempotencyKey: '0123456789abcdef0123456789abcdef',
  correlationId: 'corr-1',
  proposalId: 'prop-1',
  proposalVersion: 1,
  conversationId: 'conv-1',
  expectedRevision: 7,
  proposalDigest: 'abcdef0123456789abcdef0123456789',
  assignedActor: 'RIYA',
  partyType: 'CLIENT',
  proposalKind: 'REPLY',
  structuredIntent: { taskClass: 'RESPONSE_GENERATION', replyKind: 'REPLY' },
  policyRevision: 'policy.rev.1',
  evaluationRef: 'evref-riya01',
  citations: [],
  proposedReplyBody: 'Hello',
  createdAt: '2026-09-15T06:00:00.000Z',
});
const coreResponse = JSON.stringify({ outcome: 'HUMAN_REVIEW_REQUIRED' });

function makeTransport(
  post: QuickFurnoCoreHttpPost,
  over: Partial<Parameters<typeof createQuickFurnoCoreTransport>[0]> = {},
) {
  return createQuickFurnoCoreTransport({
    baseUrl: 'https://quickfurno.internal/',
    keyId,
    privateKeyPem,
    timeoutMs: 500,
    httpPost: post,
    ...over,
  });
}

describe('QuickFurno Core signed transport', () => {
  it('locks the cross-repository route and signature vocabulary', () => {
    expect(QUICKFURNO_CORE_DECISION_METHOD).toBe('POST');
    expect(QUICKFURNO_CORE_DECISION_PATH).toBe('/api/internal/jarvis/core-decision');
    expect(QUICKFURNO_CORE_DECISION_CALLER).toBe('qf-jarvis');
    expect(QUICKFURNO_CORE_DECISION_AUDIENCE).toBe('quickfurno-core');
    expect(QUICKFURNO_CORE_DECISION_SIGNING_DOMAIN).toBe('qfj.core.decision.http.sig.v1');
  });

  it('sends the exact serialized command once and independently verifies its Ed25519 signature', async () => {
    let calls = 0;
    const post: QuickFurnoCoreHttpPost = (url, init) => {
      calls += 1;
      expect(url).toBe('https://quickfurno.internal/api/internal/jarvis/core-decision');
      expect(init.method).toBe('POST');
      expect(init.redirect).toBe('error');
      expect(init.body).toBe(command);
      expect(init.headers[QUICKFURNO_CORE_DECISION_KEY_ID_HEADER]).toBe(keyId);
      const sig = init.headers[QUICKFURNO_CORE_DECISION_SIGNATURE_HEADER];
      expect(sig).toBeDefined();
      if (sig === undefined) throw new Error('missing signature');
      const bodyDigest = rawQuickFurnoCoreBodyDigest(Buffer.from(command, 'utf8'));
      const input = quickFurnoCoreSigningInput({
        commandId: 'conv-1-prop-1-r7',
        createdAt: '2026-09-15T06:00:00.000Z',
        keyId,
        bodyDigest,
      });
      expect(
        verify(null, Buffer.from(input, 'utf8'), publicKey, Buffer.from(sig, 'base64url')),
      ).toBe(true);
      return Promise.resolve({ status: 200, text: () => Promise.resolve(coreResponse) });
    };
    const result = await makeTransport(post).send(command);
    expect(result).toBe(coreResponse);
    expect(calls).toBe(1);
  });

  it('does not retry a failed request', async () => {
    let calls = 0;
    const post: QuickFurnoCoreHttpPost = () => {
      calls += 1;
      return Promise.reject(new Error('network detail that must not escape'));
    };
    await expect(makeTransport(post).send(command)).rejects.toMatchObject({
      code: 'request-failed',
    });
    expect(calls).toBe(1);
  });

  it('normalizes non-200 without leaking the response body', async () => {
    const post: QuickFurnoCoreHttpPost = () =>
      Promise.resolve({
        status: 503,
        text: () => Promise.resolve('secret upstream detail'),
      });
    await expect(makeTransport(post).send(command)).rejects.toEqual(
      new QuickFurnoCoreTransportError('request-failed'),
    );
  });

  it('bounds the timeout and aborts the single request', async () => {
    let calls = 0;
    const post: QuickFurnoCoreHttpPost = async (_url, init) => {
      calls += 1;
      await new Promise<void>((_resolve, reject) => {
        init.signal.addEventListener(
          'abort',
          () => {
            reject(new Error('aborted'));
          },
          { once: true },
        );
      });
      return Promise.resolve({ status: 200, text: () => Promise.resolve(coreResponse) });
    };
    await expect(makeTransport(post, { timeoutMs: 100 }).send(command)).rejects.toMatchObject({
      code: 'request-failed',
    });
    expect(calls).toBe(1);
  });

  it.each([
    'http://example.com/',
    'https://user:pass@example.com/',
    'https://example.com/base/',
    'https://example.com/?x=1',
  ])('refuses unsafe Core base URL %s before any request', (baseUrl) => {
    let calls = 0;
    expect(() =>
      makeTransport(
        async () => {
          calls += 1;
          return Promise.resolve({ status: 200, text: () => Promise.resolve(coreResponse) });
        },
        { baseUrl },
      ),
    ).toThrow(QuickFurnoCoreTransportError);
    expect(calls).toBe(0);
  });

  it('permits loopback HTTP for isolated local integration only', async () => {
    let observed = '';
    const transport = makeTransport(
      async (url) => {
        observed = url;
        return Promise.resolve({ status: 200, text: () => Promise.resolve(coreResponse) });
      },
      { baseUrl: 'http://127.0.0.1:3000/' },
    );
    await transport.send(command);
    expect(observed).toBe('http://127.0.0.1:3000/api/internal/jarvis/core-decision');
  });

  it.each([
    '',
    '{',
    JSON.stringify({ createdAt: '2026-09-15T06:00:00.000Z' }),
    JSON.stringify({ commandId: 'x', createdAt: 'not-an-instant' }),
  ])('refuses malformed command identity before network', async (bad) => {
    let calls = 0;
    await expect(
      makeTransport(async () => {
        calls += 1;
        return Promise.resolve({ status: 200, text: () => Promise.resolve(coreResponse) });
      }).send(bad),
    ).rejects.toMatchObject({ code: 'invalid-command' });
    expect(calls).toBe(0);
  });

  it('refuses non-Ed25519 signing material at construction', () => {
    const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 })
      .privateKey.export({ type: 'pkcs8', format: 'pem' })
      .toString();
    expect(() =>
      makeTransport(
        () => Promise.resolve({ status: 200, text: () => Promise.resolve(coreResponse) }),
        {
          privateKeyPem: rsa,
        },
      ),
    ).toThrow(QuickFurnoCoreTransportError);
  });

  it('refuses an empty or oversized response before returning it to the Core adapter', async () => {
    const empty = makeTransport(() =>
      Promise.resolve({ status: 200, text: () => Promise.resolve('') }),
    );
    await expect(empty.send(command)).rejects.toMatchObject({ code: 'response-invalid' });
    const huge = makeTransport(() =>
      Promise.resolve({ status: 200, text: () => Promise.resolve('x'.repeat(65_537)) }),
    );
    await expect(huge.send(command)).rejects.toMatchObject({ code: 'response-invalid' });
  });
});
