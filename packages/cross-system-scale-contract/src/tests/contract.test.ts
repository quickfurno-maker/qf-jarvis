import { generateKeyPairSync, randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  createQfjScaleMetadata,
  qfjScaleResponseHeaders,
  signQfjScaleHeaders,
  verifyQfjScaleRequest,
} from '../index.js';

describe('QFJ cross-system scale contract v1', () => {
  it('signs and verifies all correlation/deadline/revision metadata', () => {
    const pair = generateKeyPairSync('ed25519');
    const privateKeyPem = pair.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
    const publicKeyPem = pair.publicKey.export({ type: 'spki', format: 'pem' }).toString();
    const keyId = 'phase11-test-key';
    const requestId = randomUUID();
    const nowMs = Date.parse('2026-10-05T07:00:00.000Z');
    const metadata = createQfjScaleMetadata({
      requestId,
      idempotencyKey: 'effect-' + requestId,
      correlationId: 'correlation-' + requestId,
      traceId: '0123456789abcdef0123456789abcdef',
      actor: 'qf-jarvis',
      expectedRevision: 9,
      timeoutMs: 1_000,
      nowMs,
    });
    const rawBody = Buffer.from('{"safe":true}', 'utf8');
    const headers = signQfjScaleHeaders({
      method: 'POST',
      path: '/api/internal/jarvis/core-decision',
      metadata,
      keyId,
      privateKeyPem,
      rawBody,
    });

    const verified = verifyQfjScaleRequest({
      headers,
      method: 'POST',
      path: '/api/internal/jarvis/core-decision',
      rawBody,
      verificationKeys: [{ keyId, publicKeyPem }],
      nowMs: nowMs + 500,
    });

    expect(verified).toEqual({ ok: true, mode: 'v1', metadata });
  });

  it('keeps a bounded legacy coexistence lane but rejects unsupported v2', () => {
    const legacy = verifyQfjScaleRequest({
      headers: {},
      method: 'POST',
      path: '/v1/test',
      rawBody: Buffer.from('{}'),
      verificationKeys: [],
      allowLegacy: true,
    });
    expect(legacy).toEqual({ ok: true, mode: 'legacy' });

    const unsupported = verifyQfjScaleRequest({
      headers: { 'x-qfj-scale-version': '2' },
      method: 'POST',
      path: '/v1/test',
      rawBody: Buffer.from('{}'),
      verificationKeys: [],
    });
    expect(unsupported).toEqual({ ok: false, errorClass: 'QFJ_CONTRACT_INVALID' });
  });

  it('rejects tampered signed metadata and expired deadlines before work', () => {
    const pair = generateKeyPairSync('ed25519');
    const privateKeyPem = pair.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
    const publicKeyPem = pair.publicKey.export({ type: 'spki', format: 'pem' }).toString();
    const keyId = 'phase11-test-key';
    const nowMs = Date.parse('2026-10-05T07:00:00.000Z');
    const metadata = createQfjScaleMetadata({
      requestId: randomUUID(),
      idempotencyKey: 'effect-1',
      actor: 'qf-jarvis-os',
      timeoutMs: 500,
      nowMs,
    });
    const rawBody = Buffer.from('{}');
    const headers = signQfjScaleHeaders({
      method: 'POST',
      path: '/api/internal/jarvis/operator-snapshot',
      metadata,
      keyId,
      privateKeyPem,
      rawBody,
    });

    const tampered = verifyQfjScaleRequest({
      headers: { ...headers, 'x-qfj-actor': 'HUMAN' },
      method: 'POST',
      path: '/api/internal/jarvis/operator-snapshot',
      rawBody,
      verificationKeys: [{ keyId, publicKeyPem }],
      nowMs: nowMs + 100,
    });
    expect(tampered).toEqual({ ok: false, errorClass: 'QFJ_AUTHENTICATION_FAILED' });

    const expired = verifyQfjScaleRequest({
      headers,
      method: 'POST',
      path: '/api/internal/jarvis/operator-snapshot',
      rawBody,
      verificationKeys: [{ keyId, publicKeyPem }],
      nowMs: nowMs + 1_000,
    });
    expect(expired).toEqual({ ok: false, errorClass: 'QFJ_DEADLINE_EXCEEDED' });
  });

  it('emits canonical response error and retryability headers', () => {
    expect(
      qfjScaleResponseHeaders(
        {
          correlationId: 'correlation-1',
          traceId: '0123456789abcdef0123456789abcdef',
        },
        'QFJ_BACKPRESSURE',
      ),
    ).toMatchObject({
      'x-qfj-scale-version': '1',
      'x-qfj-correlation-id': 'correlation-1',
      'x-qfj-trace-id': '0123456789abcdef0123456789abcdef',
      'x-qfj-error-class': 'QFJ_BACKPRESSURE',
      'x-qfj-retryable': 'true',
    });
  });
});
