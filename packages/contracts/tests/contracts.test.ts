import { describe, expect, it } from 'vitest';
import { HealthResponseSchema, ServiceInfoSchema, ServiceStatusSchema } from '../src/index.js';

describe('ServiceStatusSchema', () => {
  it('accepts every known status', () => {
    for (const status of ['ok', 'ready', 'running', 'degraded', 'error'] as const) {
      expect(ServiceStatusSchema.parse(status)).toBe(status);
    }
  });

  it('rejects unknown statuses', () => {
    expect(ServiceStatusSchema.safeParse('bogus').success).toBe(false);
  });
});

describe('HealthResponseSchema', () => {
  it('accepts the liveness body', () => {
    expect(HealthResponseSchema.parse({ status: 'ok' })).toEqual({ status: 'ok' });
  });

  it('accepts the readiness body', () => {
    expect(HealthResponseSchema.parse({ status: 'ready' })).toEqual({ status: 'ready' });
  });

  it('rejects an invalid status value', () => {
    expect(HealthResponseSchema.safeParse({ status: 'up' }).success).toBe(false);
  });

  it('rejects a missing status', () => {
    expect(HealthResponseSchema.safeParse({}).success).toBe(false);
  });

  it('rejects unexpected extra keys', () => {
    expect(HealthResponseSchema.safeParse({ status: 'ok', extra: true }).success).toBe(false);
  });
});

describe('ServiceInfoSchema', () => {
  it('accepts well-formed service metadata', () => {
    const info = { service: 'qf-jarvis-api', status: 'running', version: '0.0.0' };
    expect(ServiceInfoSchema.parse(info)).toEqual(info);
  });

  it('rejects an empty service name', () => {
    expect(
      ServiceInfoSchema.safeParse({ service: '', status: 'running', version: '0.0.0' }).success,
    ).toBe(false);
  });

  it('rejects a missing version', () => {
    expect(
      ServiceInfoSchema.safeParse({ service: 'qf-jarvis-api', status: 'running' }).success,
    ).toBe(false);
  });
});
