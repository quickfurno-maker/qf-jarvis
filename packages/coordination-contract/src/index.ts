export type CoordinationStatus = 'ok' | 'unavailable';

export type RateLimitDecision =
  | { status: 'ok'; allowed: boolean; remaining: number; retryAfterMs: number }
  | { status: 'unavailable' };

export type CacheRead<T> =
  { status: 'hit'; value: T } | { status: 'miss' } | { status: 'unavailable' };

export type CoordinationWrite = { status: 'ok' } | { status: 'unavailable' };

export type LockAcquire =
  | { status: 'acquired'; owner: string; fence: number; expiresInMs: number }
  | { status: 'busy' }
  | { status: 'unavailable' };

export type LockRelease =
  { status: 'released' } | { status: 'not-owner' } | { status: 'unavailable' };

export interface CoordinationPort {
  ping(): Promise<CoordinationStatus>;

  rateLimit(input: {
    namespace: string;
    subject: string;
    limit: number;
    windowMs: number;
  }): Promise<RateLimitDecision>;

  cacheGet<T>(input: {
    namespace: string;
    key: string;
    tags?: readonly string[];
  }): Promise<CacheRead<T>>;

  cacheSet(input: {
    namespace: string;
    key: string;
    value: unknown;
    ttlMs: number;
    tags?: readonly string[];
  }): Promise<CoordinationWrite>;

  invalidateTag(input: { namespace: string; tag: string }): Promise<CoordinationWrite>;

  acquireLock(input: {
    namespace: string;
    resource: string;
    owner: string;
    ttlMs: number;
  }): Promise<LockAcquire>;

  releaseLock(input: {
    namespace: string;
    resource: string;
    owner: string;
    fence: number;
  }): Promise<LockRelease>;

  publishWakeup(input: {
    namespace: string;
    topic: string;
    payload: Readonly<Record<string, unknown>>;
  }): Promise<CoordinationWrite>;

  disconnect(): Promise<void>;
}

/**
 * Redis/Valkey is coordination only. Durable authority stays in PostgreSQL/Core.
 *
 * - cache outage => bypass to durable source;
 * - rate-limit outage => caller uses its documented edge/local fallback;
 * - lock outage => PostgreSQL authority or refuse unsafe work;
 * - wake-up outage => durable DB polling/recovery still finds the work.
 */
export const COORDINATION_IS_EPHEMERAL = true as const;
