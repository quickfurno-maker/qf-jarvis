import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseControlPlaneSnapshotV1 } from '@qf-jarvis/control-plane-read-contract';
import { describe, expect, it } from 'vitest';

import { GET } from '../../app/api/control-plane/v1/snapshot/route';

import { buildControlPlaneSnapshot } from './build-snapshot';

/**
 * The read-only snapshot API (JOS-01B, ADR-0086).
 *
 * These assertions cover the two things that make this route safe to exist before it has
 * authentication: it can only be READ, and it can only say true things.
 *
 * The route is exercised through its real exported handler with a real `Request`, not through a
 * mock. A mock would prove that a function returns an object; this proves that the thing Next.js
 * will actually invoke produces a response with the headers, status and body claimed here.
 */

const SRC = fileURLToPath(new URL('../../', import.meta.url));
const ROUTE = join(SRC, 'app/api/control-plane/v1/snapshot/route.ts');
const URL_BASE = 'http://127.0.0.1/api/control-plane/v1/snapshot';

const call = async (url: string = URL_BASE): Promise<Response> =>
  Promise.resolve(GET(new Request(url, { method: 'GET' })));

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...walk(full));
    } else if (entry.endsWith('.ts') || entry.endsWith('.tsx')) {
      out.push(full);
    }
  }
  return out;
}

describe('the snapshot builder', () => {
  it('is pure: the same instant in gives byte-identical output', () => {
    const a = buildControlPlaneSnapshot({
      observedAt: '2026-08-03T12:00:00.000Z',
      freshness: 'REQUEST_TIME',
    });
    const b = buildControlPlaneSnapshot({
      observedAt: '2026-08-03T12:00:00.000Z',
      freshness: 'REQUEST_TIME',
    });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('uses the injected instant rather than reading a clock', () => {
    const snapshot = buildControlPlaneSnapshot({
      observedAt: '1999-12-31T23:59:59.999Z',
      freshness: 'BUILD_DECLARATION',
    });
    expect(snapshot.observedAt).toBe('1999-12-31T23:59:59.999Z');
  });

  it('validates its own output through the shared contract', () => {
    const snapshot = buildControlPlaneSnapshot({
      observedAt: '2026-08-03T12:00:00.000Z',
      freshness: 'REQUEST_TIME',
    });
    // Re-parsing must succeed: the server holds itself to exactly what a client will enforce.
    expect(() => parseControlPlaneSnapshotV1(JSON.parse(JSON.stringify(snapshot)))).not.toThrow();
    expect(Object.isFrozen(snapshot)).toBe(true);
  });

  it('never claims live operational data', () => {
    const snapshot = buildControlPlaneSnapshot({
      observedAt: '2026-08-03T12:00:00.000Z',
      freshness: 'REQUEST_TIME',
    });
    expect(snapshot.source.kind).toBe('REPOSITORY_BASELINE');
    expect(snapshot.source.liveOperationalData).toBe(false);
    expect(snapshot.mode).toBe('READ_ONLY');
    expect(snapshot.rollout.enabled).toBe(false);
    expect(snapshot.rollout.state).toBe('ROLLOUT_OFF');
  });
});

describe('GET /api/control-plane/v1/snapshot', () => {
  it('answers 200 with a payload that satisfies the contract', async () => {
    const response = await call();
    expect(response.status).toBe(200);
    const body: unknown = await response.json();
    expect(() => parseControlPlaneSnapshotV1(body)).not.toThrow();
  });

  it('sets the security and caching headers, and NO CORS header', async () => {
    const response = await call();
    expect(response.headers.get('content-type')).toContain('application/json');
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('x-control-plane-contract-version')).toBe('1');
    // No wildcard, no echo, no header at all. A cross-origin page must not be able to read this.
    expect(response.headers.get('access-control-allow-origin')).toBeNull();
    expect(response.headers.get('access-control-allow-credentials')).toBeNull();
  });

  it('states the authority boundary and the unconnected integrations', async () => {
    const response = await call();
    const body = parseControlPlaneSnapshotV1(await response.json());

    expect(body.authority.jarvis).toBe('RECOMMENDS_AND_OBSERVES');
    expect(body.authority.quickfurnoCore).toBe('AUTHORIZES_AND_OWNS_BUSINESS_TRUTH');
    expect(body.authority.n8n).toBe('EXECUTES_ONLY');
    expect(body.authority.provider).toBe('DELIVERS_ONLY');

    const byId = new Map(body.system.map((component) => [component.id, component]));
    expect(byId.get('quickfurno-core')?.state).toBe('NOT_CONNECTED');
    expect(byId.get('n8n')?.state).toBe('NOT_CONNECTED');

    const aarohi = body.agents.find((agent) => agent.id === 'aarohi');
    expect(aarohi?.lifecycle).toBe('PLANNED');

    const merged = body.roadmap.filter((marker) => marker.state === 'merged');
    expect(merged.map((marker) => marker.label).join(' ')).toContain('QFJ-P09.01');
    const next = body.roadmap.filter((marker) => marker.state === 'next');
    expect(next.map((marker) => marker.label).join(' ')).toContain('QFJ-P09.02');
  });

  it('reports request-time freshness, unlike the prerendered pages', async () => {
    const body = parseControlPlaneSnapshotV1(await (await call()).json());
    expect(body.source.freshness).toBe('REQUEST_TIME');
  });

  it('rejects any query parameter rather than ignoring it', async () => {
    for (const suffix of ['?tenant=other', '?limit=1000', '?x=1', '?']) {
      const response = await call(URL_BASE + suffix);
      // `?` alone yields an empty search string, which is not a parameter.
      const expected = suffix === '?' ? 200 : 400;
      expect(response.status, suffix).toBe(expected);
      if (expected === 400) {
        const body = (await response.json()) as { readonly error?: string };
        expect(body.error, suffix).toBe('unsupported-query-parameter');
      }
    }
  });

  it('carries no contact detail, credential or business record', async () => {
    const text = JSON.stringify(await (await call()).json());
    expect(text).not.toMatch(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/);
    expect(text).not.toMatch(/\+\d{8,}/);
    for (const forbidden of ['CONV-DEMO-', 'VENDOR-DEMO-', 'APPR-DEMO-', 'CASE-DEMO-']) {
      expect(text, forbidden).not.toContain(forbidden);
    }
    // Assert on JSON KEYS. The word "authorization" appears legitimately in governance prose
    // ("outreach requires QuickFurno Core authorization"); a credential would be a field name.
    const keys = [...text.matchAll(/"([A-Za-z0-9_]+)":/g)].map((match) =>
      (match[1] ?? '').toLowerCase(),
    );
    for (const forbidden of [
      'password',
      'secret',
      'token',
      'apikey',
      'authorization',
      'credential',
    ]) {
      expect(keys, forbidden).not.toContain(forbidden);
    }
  });

  it('exposes no authority field anywhere in the payload', async () => {
    const text = JSON.stringify(await (await call()).json());
    for (const forbidden of [
      'canExecute',
      'canSend',
      'isAuthorized',
      'consentValid',
      'approvalGranted',
      'dispatchAllowed',
    ]) {
      expect(text, forbidden).not.toContain(forbidden);
    }
  });
});

describe('the route file itself', () => {
  const source = (): string => readFileSync(ROUTE, 'utf8');

  it('exports GET and no mutating method', () => {
    const code = source();
    expect(code).toMatch(/export function GET\b/);
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']) {
      expect(code, method).not.toMatch(
        new RegExp(`export\\s+(async\\s+)?function\\s+${method}\\b`),
      );
    }
  });

  it('sets no CORS header and defines no server action', () => {
    const code = source();
    expect(code).not.toContain('Access-Control-Allow-Origin');
    expect(code).not.toContain("'use server'");
  });

  it('reaches no database, provider, n8n or Core transport', () => {
    // The whole server directory, not just the route: the builder is the thing a future
    // contributor would be tempted to "just add a fetch to".
    for (const file of walk(join(SRC, 'server'))) {
      const code = readFileSync(file, 'utf8');
      const label = file.replace(/\\/g, '/').split('/apps/jarvis-os/')[1] ?? file;
      expect(code, `${label}: fetch`).not.toMatch(/\bfetch\s*\(/);
      expect(code, `${label}: url`).not.toMatch(/https?:\/\/(?!127\.0\.0\.1)/);
      expect(code, `${label}: env`).not.toMatch(/process\s*\.\s*env/);
      const specifiers = [...code.matchAll(/from\s+['"]([^'"]+)['"]/g)].map(
        (match) => match[1] ?? '',
      );
      for (const specifier of specifiers) {
        for (const forbidden of [
          'pg',
          'supabase',
          'n8n-',
          'whatsapp',
          'twilio',
          'groq',
          'openai',
        ]) {
          expect(
            specifier.toLowerCase().includes(forbidden),
            `${label}: imports ${specifier}`,
          ).toBe(false);
        }
      }
    }
  });

  it('is the only API route in the application', () => {
    const routes = walk(join(SRC, 'app'))
      .map((file) => file.replace(/\\/g, '/'))
      .filter((file) => /\/route\.tsx?$/.test(file));
    expect(routes).toHaveLength(1);
    expect(routes[0]).toContain('api/control-plane/v1/snapshot/route.ts');
  });
});
