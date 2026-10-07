import { generateKeyPairSync } from 'node:crypto';

import {
  createQfjScaleMetadata,
  signQfjScaleHeaders,
} from '@qf-jarvis/cross-system-scale-contract';
import { describe, expect, it } from 'vitest';

import {
  AGNI_OPERATOR_QUERY_PATH,
  AGNI_OPERATOR_QUERY_REQUEST_PROTOCOL,
  parseAgniOperatorQuery,
  verifyAgniOperatorQuery,
} from './agni-operator-query';

function fixture(actor: 'qf-agni-control-plane' | 'qf-jarvis' = 'qf-agni-control-plane') {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const body = Buffer.from(
    JSON.stringify({
      protocol: AGNI_OPERATOR_QUERY_REQUEST_PROTOCOL,
      query: 'Jarvis system status',
    }),
    'utf8',
  );
  const metadata = createQfjScaleMetadata({
    requestId: 'telegram-owner-request-1',
    idempotencyKey: 'telegram-owner-request-1',
    correlationId: 'telegram-owner-request-1',
    traceId: '44444444444444444444444444444444',
    actor,
    timeoutMs: 5000,
    nowMs: Date.parse('2026-10-07T00:00:00Z'),
  });
  const keyId = 'agni-telegram-to-jarvis-1';
  const headers = signQfjScaleHeaders({
    method: 'POST',
    path: AGNI_OPERATOR_QUERY_PATH,
    metadata,
    keyId,
    privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    rawBody: body,
  });
  return {
    body,
    headers,
    keys: [
      {
        keyId,
        publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
      },
    ],
  };
}

describe('AGNI operator query ingress', () => {
  it('accepts only signed current-version AGNI read requests', () => {
    const one = fixture();
    expect(
      verifyAgniOperatorQuery({
        headers: one.headers,
        rawBody: one.body,
        verificationKeys: one.keys,
        nowMs: Date.parse('2026-10-07T00:00:01Z'),
      }).ok,
    ).toBe(true);
    expect(parseAgniOperatorQuery(one.body)).toBe('Jarvis system status');
  });

  it('rejects the wrong actor even with a valid signature', () => {
    const one = fixture('qf-jarvis');
    expect(
      verifyAgniOperatorQuery({
        headers: one.headers,
        rawBody: one.body,
        verificationKeys: one.keys,
        nowMs: Date.parse('2026-10-07T00:00:01Z'),
      }).ok,
    ).toBe(false);
  });

  it('rejects legacy unsigned requests and oversized queries', () => {
    const unsigned = Buffer.from(
      JSON.stringify({ protocol: AGNI_OPERATOR_QUERY_REQUEST_PROTOCOL, query: 'status' }),
    );
    expect(
      verifyAgniOperatorQuery({
        headers: {},
        rawBody: unsigned,
        verificationKeys: [],
      }).ok,
    ).toBe(false);

    expect(
      parseAgniOperatorQuery(
        Buffer.from(
          JSON.stringify({
            protocol: AGNI_OPERATOR_QUERY_REQUEST_PROTOCOL,
            query: 'x'.repeat(501),
          }),
        ),
      ),
    ).toBeNull();
  });
});
