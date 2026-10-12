import { createHash, generateKeyPairSync, verify } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { createAnishaMemoryPurgeWorker } from '../quickfurno-whatsapp/anisha-memory-purge-worker.js';
import {
  createQuickFurnoAnishaMemoryPurgeCore,
  type AnishaMemoryPurgeCore,
  type AnishaMemoryPurgeTask,
} from '../quickfurno-whatsapp/quickfurno-http.js';

const task: AnishaMemoryPurgeTask = Object.freeze({
  purgeId: '11111111-1111-4111-8111-111111111111',
  vendorId: '44444444-4444-4444-8444-444444444444',
  leaseToken: '55555555-5555-4555-8555-555555555555',
});
const now = '2026-10-12T06:00:00.000Z';
const requestId = '66666666-6666-4666-8666-666666666666';
const kp = generateKeyPairSync('ed25519');
const privateKeyPem = kp.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();

function signedFixture(input: { crossVendor?: boolean; badAck?: boolean } = {}) {
  const httpPost = vi.fn(
    async (url: string, init: { body: string; headers: Record<string, string> }) => {
      await Promise.resolve();
      const request = JSON.parse(init.body) as Record<string, unknown>;
      const action = request['action'];
      expect(action).toMatch(/^(CLAIM|ACK)$/);
      const part = action === 'CLAIM' ? 'claim' : 'ack';
      const path = '/api/internal/jarvis/anisha-memory-purge-' + part;
      expect(url).toBe('https://quickfurno.example' + path);
      expect(request['caller']).toBe('qf-jarvis');
      const digest = createHash('sha256')
        .update(Buffer.from(init.body, 'utf8'))
        .digest('base64url');
      const signingInput = [
        'qfj.anisha.memory-purge.' + part + '.http.sig.v1',
        'POST',
        path,
        'qf-jarvis',
        'quickfurno-core',
        requestId,
        now,
        'memory-purge-test',
        digest,
      ].join('\n');
      expect(
        verify(
          null,
          Buffer.from(signingInput),
          kp.publicKey,
          Buffer.from(requireAnishaTestValue(init.headers['x-qfj-signature']), 'base64url'),
        ),
      ).toBe(true);
      if (action === 'ACK') {
        expect(request).toMatchObject(task);
        return {
          status: 200,
          text: async () => {
            await Promise.resolve();
            return JSON.stringify({
              protocol: 'qfj.anisha.memory-purge',
              version: 1,
              action,
              requestId,
              acknowledged: !input.badAck,
            });
          },
        };
      }
      return {
        status: 200,
        text: async () => {
          await Promise.resolve();
          return JSON.stringify({
            protocol: 'qfj.anisha.memory-purge',
            version: 1,
            action,
            requestId,
            tasks: [
              {
                ...task,
                ...(input.crossVendor
                  ? {
                      vendorId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
                    }
                  : {}),
              },
            ],
          });
        },
      };
    },
  );
  const core = createQuickFurnoAnishaMemoryPurgeCore({
    baseUrl: 'https://quickfurno.example/',
    keyId: 'memory-purge-test',
    privateKeyPem,
    clock: () => now,
    requestId: () => requestId,
    httpPost,
  });
  return { core, httpPost };
}
describe('Anisha A2c signed Core claim / acknowledgement', () => {
  it('signs both distinct purposes with the existing Ed25519 transport', async () => {
    const { core, httpPost } = signedFixture();
    await expect(core.claim(5)).resolves.toEqual([task]);
    await expect(core.acknowledge(task)).resolves.toBeUndefined();
    expect(httpPost).toHaveBeenCalledTimes(2);
  });
  it('never acknowledges Core denial or a false acknowledgement', async () => {
    const { core } = signedFixture({ badAck: true });
    await expect(core.acknowledge(task)).rejects.toMatchObject({ code: 'response-invalid' });
  });
  it('rejects invalid claim sizes and lease identities before HTTP', async () => {
    const { core, httpPost } = signedFixture();
    await expect(core.claim(0)).rejects.toMatchObject({ code: 'invalid-input' });
    await expect(core.acknowledge({ ...task, leaseToken: 'forged' })).rejects.toMatchObject({
      code: 'invalid-input',
    });
    expect(httpPost).not.toHaveBeenCalled();
  });
});
function mockedCore(): {
  readonly core: AnishaMemoryPurgeCore;
  readonly claim: ReturnType<typeof vi.fn>;
  readonly ack: ReturnType<typeof vi.fn>;
} {
  const claim = vi.fn(async () => {
    await Promise.resolve();
    return [task];
  });
  const ack = vi.fn(async (_task: AnishaMemoryPurgeTask) => {
    await Promise.resolve();
    return undefined;
  });
  return { core: { claim, acknowledge: ack }, claim, ack };
}
describe('Anisha A2c physical-delete-before-ack protocol', () => {
  it('acknowledges only after committed erasure with valid bounded count', async () => {
    const { core, ack } = mockedCore();
    const events: string[] = [];
    const worker = createAnishaMemoryPurgeWorker({
      core: {
        ...core,
        acknowledge: async (t) => {
          events.push('ack');
          await core.acknowledge(t);
        },
      },
      erase: async () => {
        await Promise.resolve();
        events.push('erase');
        return { deletedCount: 3 };
      },
    });
    await expect(worker.runCycle()).resolves.toEqual({
      claimed: 1,
      deleted: 3,
      acknowledged: 1,
      failed: 0,
    });
    expect(events).toEqual(['erase', 'ack']);
    expect(ack).toHaveBeenCalledWith(task);
  });
  it('never ack on deletion failure; next lease can retry', async () => {
    const { core, ack } = mockedCore();
    const erase = vi
      .fn()
      .mockRejectedValueOnce(Error('database inaccessible'))
      .mockResolvedValueOnce({ deletedCount: 1 });
    const worker = createAnishaMemoryPurgeWorker({ core, erase });
    expect(await worker.runCycle()).toEqual({ claimed: 1, deleted: 0, acknowledged: 0, failed: 1 });
    expect(ack).not.toHaveBeenCalled();
    expect(await worker.runCycle()).toEqual({ claimed: 1, deleted: 1, acknowledged: 1, failed: 0 });
  });
  it('lost acknowledgement is retried with idempotent zero-row delete', async () => {
    const { core, ack } = mockedCore();
    ack.mockRejectedValueOnce(Error('network timeout')).mockResolvedValueOnce(undefined);
    const erase = vi
      .fn()
      .mockResolvedValueOnce({ deletedCount: 1 })
      .mockResolvedValueOnce({ deletedCount: 0 });
    const worker = createAnishaMemoryPurgeWorker({ core, erase });
    expect(await worker.runCycle()).toEqual({ claimed: 1, deleted: 1, acknowledged: 0, failed: 1 });
    expect(await worker.runCycle()).toEqual({ claimed: 1, deleted: 0, acknowledged: 1, failed: 0 });
  });
  it('bad deletion receipt cannot be promoted to Core acknowledgement', async () => {
    const { core, ack } = mockedCore();
    const worker = createAnishaMemoryPurgeWorker({
      core,
      erase: async () => {
        await Promise.resolve();
        return { deletedCount: -1 };
      },
    });
    expect((await worker.runCycle()).failed).toBe(1);
    expect(ack).not.toHaveBeenCalled();
  });
  it('rejects parallel processing of the same memory purge worker', async () => {
    const pending: { resolve?: (value: readonly AnishaMemoryPurgeTask[]) => void } = {};
    const claim = vi.fn(
      () =>
        new Promise<readonly AnishaMemoryPurgeTask[]>((resolve) => {
          pending.resolve = resolve;
        }),
    );
    const worker = createAnishaMemoryPurgeWorker({
      core: { claim, acknowledge: vi.fn() },
      erase: vi.fn(),
    });
    const started = worker.runCycle();
    await expect(worker.runCycle()).rejects.toThrow('anisha-memory-purge-cycle-overlap');
    pending.resolve?.([]);
    await expect(started).resolves.toMatchObject({ claimed: 0 });
  });
  it('runs physical TTL cleanup before a Core claim, even when Core is unavailable', async () => {
    const purgeExpired = vi.fn(async () => {
      await Promise.resolve();
      return { invalidatedCount: 2 };
    });
    const core = {
      claim: vi.fn().mockRejectedValueOnce(new Error('core offline')).mockResolvedValueOnce([]),
      acknowledge: vi.fn(),
    };
    const worker = createAnishaMemoryPurgeWorker({
      core,
      erase: vi.fn(),
      purgeExpired,
    });
    await expect(worker.runCycle()).rejects.toThrow('core offline');
    expect(purgeExpired).toHaveBeenCalledOnce();
    await expect(worker.runCycle()).resolves.toMatchObject({ claimed: 0 });
    expect(purgeExpired).toHaveBeenCalledTimes(2);
  });
});

function requireAnishaTestValue<T>(value: T | undefined | null): NonNullable<T> {
  if (value === null || value === undefined) throw new TypeError('test-precondition-missing');
  return value;
}
