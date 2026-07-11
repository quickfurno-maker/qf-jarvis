import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createLogger } from '@qf/observability';
import { createLogCapture } from '@qf/testing';
import { HealthResponseSchema, ServiceInfoSchema } from '@qf/contracts';
import { buildApp } from '../src/app.js';

let app: FastifyInstance;

beforeAll(async () => {
  // Silence request logs into an in-memory capture; keep tests quiet and fast.
  const capture = createLogCapture();
  const logger = createLogger(
    { service: 'qf-jarvis-api', environment: 'test', level: 'silent' },
    capture.stream,
  );
  app = await buildApp({ logger, version: '9.9.9-test' });
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

describe('GET /health/live', () => {
  it('returns 200 and a contract-valid liveness body', async () => {
    const response = await app.inject({ method: 'GET', url: '/health/live' });

    expect(response.statusCode).toBe(200);
    const body: unknown = response.json();
    expect(body).toEqual({ status: 'ok' });
    // The response must satisfy the shared contract exactly.
    expect(HealthResponseSchema.parse(body)).toEqual({ status: 'ok' });
  });
});

describe('GET /health/ready', () => {
  it('returns 200 and a contract-valid readiness body', async () => {
    const response = await app.inject({ method: 'GET', url: '/health/ready' });

    expect(response.statusCode).toBe(200);
    const body: unknown = response.json();
    expect(body).toEqual({ status: 'ready' });
    expect(HealthResponseSchema.parse(body)).toEqual({ status: 'ready' });
  });
});

describe('GET /', () => {
  it('returns stable, contract-valid service metadata', async () => {
    const response = await app.inject({ method: 'GET', url: '/' });

    expect(response.statusCode).toBe(200);
    const body: unknown = response.json();
    expect(ServiceInfoSchema.parse(body)).toEqual(body);
    expect(body).toEqual({
      service: 'qf-jarvis-api',
      status: 'running',
      version: '9.9.9-test',
    });
  });

  it('exposes only non-secret metadata keys', async () => {
    const response = await app.inject({ method: 'GET', url: '/' });
    const body = response.json() as Record<string, unknown>;

    expect(Object.keys(body).sort()).toEqual(['service', 'status', 'version']);
  });
});

describe('unknown routes', () => {
  it('returns a JSON 404 without a stack trace', async () => {
    const response = await app.inject({ method: 'GET', url: '/does-not-exist' });

    expect(response.statusCode).toBe(404);
    const body = response.json() as Record<string, unknown>;
    expect(body).not.toHaveProperty('stack');
  });
});
