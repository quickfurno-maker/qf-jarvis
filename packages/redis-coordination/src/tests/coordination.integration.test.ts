import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createClient } from 'redis';

import { RedisCoordination } from '../index.js';

function requiredRedisUrl(): string {
  const value = process.env['QFJ_COORDINATION_REDIS_URL']?.trim();
  if (!value) {
    throw new Error(
      'QFJ_COORDINATION_REDIS_URL is required for Phase 06 coordination integration tests',
    );
  }
  return value;
}

const url = requiredRedisUrl();
const prefix = `qfj:p6-${process.pid}`;
const web1 = new RedisCoordination({ url, prefix });
const web2 = new RedisCoordination({ url, prefix });
const worker1 = new RedisCoordination({ url, prefix });
const worker2 = new RedisCoordination({ url, prefix });
const replicas = [web1, web2, worker1, worker2] as const;

beforeAll(async () => {
  for (const replica of replicas) {
    expect(await replica.ping()).toBe('ok');
  }
});

afterAll(async () => {
  await Promise.all(replicas.map((replica) => replica.disconnect()));
});

describe('Phase 06 shared Redis/Valkey coordination', () => {
  it('shares one distributed rate limit across two web and two worker replicas', async () => {
    const results = await Promise.all(
      replicas.map((replica) =>
        replica.rateLimit({
          namespace: 'rate-limit',
          subject: 'client:+91-plaintext-must-not-enter-key',
          limit: 3,
          windowMs: 30_000,
        }),
      ),
    );

    expect(results.filter((result) => result.status === 'ok' && result.allowed)).toHaveLength(3);
    expect(results.filter((result) => result.status === 'ok' && !result.allowed)).toHaveLength(1);
  });

  it('invalidates a cache tag across web replicas without process-local state', async () => {
    expect(
      await web1.cacheSet({
        namespace: 'cache',
        key: 'conversation:client-visible-reference',
        value: { lane: 'riya' },
        ttlMs: 10_000,
        tags: ['routing'],
      }),
    ).toEqual({ status: 'ok' });

    expect(
      await web2.cacheGet<{ lane: string }>({
        namespace: 'cache',
        key: 'conversation:client-visible-reference',
        tags: ['routing'],
      }),
    ).toEqual({ status: 'hit', value: { lane: 'riya' } });

    expect(await web2.invalidateTag({ namespace: 'cache', tag: 'routing' })).toEqual({
      status: 'ok',
    });

    expect(
      await web1.cacheGet({
        namespace: 'cache',
        key: 'conversation:client-visible-reference',
        tags: ['routing'],
      }),
    ).toEqual({ status: 'miss' });
  });

  it('enforces lock ownership and increasing fencing between worker replicas', async () => {
    const race = await Promise.all([
      worker1.acquireLock({
        namespace: 'locks',
        resource: 'turn:client-visible-reference',
        owner: 'worker-a',
        ttlMs: 10_000,
      }),
      worker2.acquireLock({
        namespace: 'locks',
        resource: 'turn:client-visible-reference',
        owner: 'worker-b',
        ttlMs: 10_000,
      }),
    ]);

    const winner = race.find((result) => result.status === 'acquired');
    const loser = race.find((result) => result.status === 'busy');
    expect(winner?.status).toBe('acquired');
    expect(loser?.status).toBe('busy');
    if (!winner || winner.status !== 'acquired') throw new Error('expected lock winner');

    const losingOwner = winner.owner === 'worker-a' ? 'worker-b' : 'worker-a';
    expect(
      await worker2.releaseLock({
        namespace: 'locks',
        resource: 'turn:client-visible-reference',
        owner: losingOwner,
        fence: winner.fence,
      }),
    ).toEqual({ status: 'not-owner' });

    const winningClient = winner.owner === 'worker-a' ? worker1 : worker2;
    expect(
      await winningClient.releaseLock({
        namespace: 'locks',
        resource: 'turn:client-visible-reference',
        owner: winner.owner,
        fence: winner.fence,
      }),
    ).toEqual({ status: 'released' });

    const nextClient = losingOwner === 'worker-a' ? worker1 : worker2;
    const next = await nextClient.acquireLock({
      namespace: 'locks',
      resource: 'turn:client-visible-reference',
      owner: losingOwner,
      ttlMs: 10_000,
    });
    expect(next.status).toBe('acquired');
    if (next.status !== 'acquired') throw new Error('expected second lock owner');
    expect(next.fence).toBeGreaterThan(winner.fence);

    expect(
      await nextClient.releaseLock({
        namespace: 'locks',
        resource: 'turn:client-visible-reference',
        owner: losingOwner,
        fence: next.fence,
      }),
    ).toEqual({ status: 'released' });
  });

  it('publishes best-effort wake-up signals and keeps every stored key TTL-bound and opaque', async () => {
    const subscriber = createClient({ url });
    subscriber.on('error', () => undefined);
    await subscriber.connect();

    let resolveWakeup: ((message: string) => void) | undefined;
    let rejectWakeup: ((error: Error) => void) | undefined;
    const wakeup = new Promise<string>((resolve, reject) => {
      resolveWakeup = resolve;
      rejectWakeup = reject;
    });
    const timer = setTimeout(() => rejectWakeup?.(new Error('wakeup was not observed')), 3_000);
    await subscriber.subscribe(`${prefix}:wakeups:wake:jobs`, (message) => {
      clearTimeout(timer);
      resolveWakeup?.(message);
    });

    expect(
      await worker1.publishWakeup({
        namespace: 'wakeups',
        topic: 'jobs',
        payload: { kind: 'durable-work-available', opaqueId: 'job-123' },
      }),
    ).toEqual({ status: 'ok' });
    expect(JSON.parse(await wakeup)).toEqual({
      kind: 'durable-work-available',
      opaqueId: 'job-123',
    });
    await subscriber.unsubscribe();
    await subscriber.quit();

    await web1.rateLimit({
      namespace: 'ttl',
      subject: 'client:+91-plaintext-must-not-enter-key',
      limit: 5,
      windowMs: 30_000,
    });
    await web1.cacheSet({
      namespace: 'ttl',
      key: 'lead:client-visible-reference',
      value: { ok: true },
      ttlMs: 30_000,
      tags: ['state'],
    });
    await web2.invalidateTag({ namespace: 'ttl', tag: 'state' });
    const held = await worker1.acquireLock({
      namespace: 'ttl',
      resource: 'lead:client-visible-reference',
      owner: 'worker-c',
      ttlMs: 10_000,
    });
    expect(held.status).toBe('acquired');

    const inspector = createClient({ url });
    inspector.on('error', () => undefined);
    await inspector.connect();
    const keys = await inspector.keys(`${prefix}:*ttl*`);
    expect(keys.length).toBeGreaterThanOrEqual(4);
    for (const key of keys) {
      expect(await inspector.pTTL(key)).toBeGreaterThan(0);
      expect(key).not.toContain('+91-plaintext-must-not-enter-key');
      expect(key).not.toContain('client-visible-reference');
    }
    await inspector.quit();

    if (held.status === 'acquired') {
      await worker1.releaseLock({
        namespace: 'ttl',
        resource: 'lead:client-visible-reference',
        owner: 'worker-c',
        fence: held.fence,
      });
    }
  });

  it('surfaces Redis outage without fabricating coordination success or mutating durable truth', async () => {
    const outage = new RedisCoordination({
      url: 'redis://127.0.0.1:63991',
      prefix: 'qfj:outage',
      connectTimeoutMs: 100,
    });
    const durableBusinessTruth = Object.freeze({
      authority: 'postgres',
      conversationTurn: 17,
      approval: 'pending-core-validation',
    });

    expect(
      await outage.rateLimit({
        namespace: 'outage',
        subject: 'subject',
        limit: 1,
        windowMs: 1_000,
      }),
    ).toEqual({ status: 'unavailable' });
    expect(
      await outage.cacheGet({
        namespace: 'outage',
        key: 'cache',
        tags: ['state'],
      }),
    ).toEqual({ status: 'unavailable' });
    expect(
      await outage.acquireLock({
        namespace: 'outage',
        resource: 'turn',
        owner: 'worker-d',
        ttlMs: 1_000,
      }),
    ).toEqual({ status: 'unavailable' });
    expect(
      await outage.publishWakeup({
        namespace: 'outage',
        topic: 'jobs',
        payload: { opaqueId: 'missed-wakeup' },
      }),
    ).toEqual({ status: 'unavailable' });

    expect(durableBusinessTruth).toEqual({
      authority: 'postgres',
      conversationTurn: 17,
      approval: 'pending-core-validation',
    });
    await outage.disconnect();
  });
});
