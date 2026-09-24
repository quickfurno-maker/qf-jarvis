import { createHash, generateKeyPairSync, verify } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  QUICKFURNO_OPERATOR_SIGNING_DOMAIN,
  parseQuickFurnoOperatorRequest,
} from '@qf-jarvis/quickfurno-operator-observation-contract';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createQuickFurnoOperatorReadSource } from './quickfurno-operator-source';

const roots: string[] = [];

function jsonResponse(value: unknown, status = 200): Response {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  return {
    ok: status >= 200 && status < 300,
    status,
    arrayBuffer: async () =>
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  } as Response;
}

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'qfj-os-core-read-'));
  roots.push(root);
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const path = join(root, 'core-read.json');
  writeFileSync(
    path,
    JSON.stringify({
      version: 1,
      baseUrl: 'https://core.example.test/',
      keyId: 'jarvis-os-read-test',
      privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    }),
  );
  return { path, publicKey };
}

afterEach(() => {
  vi.unstubAllGlobals();
  while (roots.length) {
    const root = roots.pop();
    if (root) rmSync(root, { recursive: true, force: true });
  }
});

describe('QuickFurno operator read source', () => {
  const FIXED_NOW = new Date('2026-09-24T12:00:00.000Z');

  it('signs a bounded request and contributes only its reviewed sections', async () => {
    const { path, publicKey } = fixture();

    const request = vi.fn((input: URL | RequestInfo, init?: RequestInit) => {
      expect(String(input)).toBe('https://core.example.test/api/internal/jarvis/operator-snapshot');
      expect(init?.method).toBe('POST');
      const raw = Buffer.from(init?.body as Uint8Array);
      const parsedRequest = parseQuickFurnoOperatorRequest(JSON.parse(raw.toString('utf8')));
      const headers = init?.headers as Readonly<Record<string, string>>;
      const keyId = headers['x-qfj-key-id'];
      const signature = headers['x-qfj-signature'];
      expect(keyId).toBe('jarvis-os-read-test');
      expect(signature).toBeTruthy();

      const digest = createHash('sha256').update(raw).digest('base64url');
      const signingInput = [
        QUICKFURNO_OPERATOR_SIGNING_DOMAIN,
        'POST',
        '/api/internal/jarvis/operator-snapshot',
        'qf-jarvis-os',
        'quickfurno-core',
        parsedRequest.requestId,
        parsedRequest.issuedAt,
        keyId,
        digest,
      ].join('\n');
      expect(
        verify(
          null,
          Buffer.from(signingInput, 'utf8'),
          publicKey,
          Buffer.from(signature ?? '', 'base64url'),
        ),
      ).toBe(true);

      return Promise.resolve(
        jsonResponse({
          protocol: 'qfj.quickfurno-operator-observation.v1',
          emittedAt: FIXED_NOW.toISOString(),
          approvalQueue: [],
          approvalBreakdown: [{ id: 'waiting', label: 'Awaiting operator', value: 2 }],
          conversationControl: [],
          conversationActivity: [
            { label: '10:00Z', value: 2 },
            { label: '12:00Z', value: 4 },
          ],
          agentWorkload: [{ id: 'riya', label: 'Riya', value: 4 }],
          businessAnalytics: [{ id: 'leads', label: 'Total leads', value: 9 }],
          coreAutomationExecution: [{ id: 'queue', label: 'Queued', value: 1 }],
        }),
      );
    });

    const source = createQuickFurnoOperatorReadSource(path, () => FIXED_NOW, request);
    expect(source.owns).toStrictEqual([
      'approvalQueue',
      'approvalBreakdown',
      'conversationControl',
      'conversationActivity',
      'agentWorkload',
      'businessAnalytics',
      'coreAutomationExecution',
    ]);
    const result = await source.acquire(new AbortController().signal);
    expect(result.status).toBe('OBSERVED');
    if (result.status !== 'OBSERVED') return;
    expect(result.sections.businessAnalytics?.items).toHaveLength(1);
    expect(result.sections.headlineMetrics).toBeUndefined();
    expect(result.sections.coreSync).toBeUndefined();
  });

  it('fails closed on a stale response', async () => {
    const { path } = fixture();
    const request = vi.fn(() =>
      Promise.resolve(
        jsonResponse({
          protocol: 'qfj.quickfurno-operator-observation.v1',
          emittedAt: new Date(FIXED_NOW.getTime() - 31_000).toISOString(),
          approvalQueue: [],
          approvalBreakdown: [],
          conversationControl: [],
          conversationActivity: [],
          agentWorkload: [],
          businessAnalytics: [],
          coreAutomationExecution: [],
        }),
      ),
    );

    const result = await createQuickFurnoOperatorReadSource(path, () => FIXED_NOW, request).acquire(
      new AbortController().signal,
    );
    expect(result).toStrictEqual({
      status: 'UNAVAILABLE',
      reason: 'SOURCE_RETURNED_UNUSABLE_DATA',
    });
  });

  it('fails closed on an invalid response shape', async () => {
    const { path } = fixture();
    const request = vi.fn(() =>
      Promise.resolve(
        jsonResponse({
          protocol: 'qfj.quickfurno-operator-observation.v1',
          emittedAt: FIXED_NOW.toISOString(),
          approvalQueue: [{ messageBody: 'must never cross this boundary' }],
        }),
      ),
    );

    const result = await createQuickFurnoOperatorReadSource(path, () => FIXED_NOW, request).acquire(
      new AbortController().signal,
    );
    expect(result.status).toBe('UNAVAILABLE');
  });
});
