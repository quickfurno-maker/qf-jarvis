import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { argon2, randomBytes } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';

import { parseControlPlaneSnapshotV1 } from '@qf-jarvis/control-plane-read-contract';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { GET } from '../../app/api/control-plane/v1/snapshot/route';
import { AUTH_CONFIG_PATH_VAR } from '../auth/config/loader';
import { authConfigV1Schema } from '../auth/config/schema';
import { newSessionClaims, sealSession } from '../auth/session/token';

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

/**
 * JOS-01C: the route now requires an operator session, so this suite supplies one.
 *
 * The contract assertions below are unchanged -- they are about the PAYLOAD. That the route
 * refuses an unauthenticated caller is proved separately in `auth-http.test.ts`, against the same
 * handler, so neither property depends on the other's fixture.
 */
let sessionCookie: string | undefined;

vi.mock('next/headers', () => ({
  cookies: () =>
    Promise.resolve({
      get: (name: string) =>
        sessionCookie === undefined ? undefined : { name, value: sessionCookie },
    }),
}));

beforeAll(async () => {
  const salt = Buffer.alloc(16, 7);
  const digest = await new Promise<Buffer>((resolve, reject) => {
    argon2(
      'argon2id',
      {
        message: Buffer.from('a-test-passphrase-value'),
        nonce: salt,
        parallelism: 1,
        tagLength: 32,
        memory: 19_456,
        passes: 2,
      },
      (error, tag) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(Buffer.from(tag.buffer, tag.byteOffset, tag.byteLength));
      },
    );
  });
  const document = {
    version: 1,
    mode: 'LOCAL_DEVELOPMENT',
    operator: { id: 'owner', displayName: 'Owner', role: 'OWNER' },
    passwordVerifier: {
      algorithm: 'ARGON2ID_V19',
      memoryKiB: 19_456,
      passes: 2,
      parallelism: 1,
      salt: salt.toString('base64url'),
      digest: digest.toString('base64url'),
    },
    totp: {
      required: true,
      algorithm: 'SHA1',
      digits: 6,
      periodSeconds: 30,
      allowedDriftSteps: 1,
      secret: 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ',
    },
    session: {
      revision: 1,
      absoluteTtlSeconds: 3600,
      primaryKeyId: 'k1',
      keys: [{ id: 'k1', status: 'PRIMARY', key: randomBytes(32).toString('base64url') }],
    },
  };
  const dir = mkdtempSync(`${tmpdir()}/qfj-snapshot-auth-`);
  const path = `${dir}/auth.json`;
  writeFileSync(path, JSON.stringify(document), { mode: 0o600 });
  process.env[AUTH_CONFIG_PATH_VAR] = path;

  const config = authConfigV1Schema.parse(document);
  sessionCookie = sealSession(
    config,
    newSessionClaims({ config, nowSeconds: Math.floor(Date.now() / 1000) }),
  );
});

afterAll(() => {
  Reflect.deleteProperty(process.env, AUTH_CONFIG_PATH_VAR);
});

const call = async (url: string = URL_BASE): Promise<Response> =>
  GET(new Request(url, { method: 'GET' }));

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
    const a = buildControlPlaneSnapshot({ generatedAt: '2026-08-03T12:00:00.000Z' });
    const b = buildControlPlaneSnapshot({ generatedAt: '2026-08-03T12:00:00.000Z' });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('uses the injected instant rather than reading a clock', () => {
    const snapshot = buildControlPlaneSnapshot({ generatedAt: '1999-12-31T23:59:59.999Z' });
    expect(snapshot.generatedAt).toBe('1999-12-31T23:59:59.999Z');
  });

  it('derives source freshness rather than accepting it', () => {
    // The defect this replaces: the builder took `freshness` and the route passed REQUEST_TIME,
    // so a compiled-in baseline claimed it had just been observed. A caller can no longer say.
    const snapshot = buildControlPlaneSnapshot({ generatedAt: '2026-08-03T12:00:00.000Z' });
    expect(snapshot.source.kind).toBe('REPOSITORY_BASELINE');
    expect(snapshot.source.freshness).toBe('BUILD_DECLARATION');
    expect(snapshot.source.liveOperationalData).toBe(false);
  });

  it('moves generatedAt without moving source freshness', () => {
    const early = buildControlPlaneSnapshot({ generatedAt: '2020-01-01T00:00:00.000Z' });
    const late = buildControlPlaneSnapshot({ generatedAt: '2030-01-01T00:00:00.000Z' });
    expect(early.generatedAt).not.toBe(late.generatedAt);
    // Ten years apart, and the facts are exactly as fresh -- which is to say, not fresh at all.
    expect(early.source).toEqual(late.source);
    expect(late.source.freshness).toBe('BUILD_DECLARATION');
  });

  it('validates its own output through the shared contract', () => {
    const snapshot = buildControlPlaneSnapshot({ generatedAt: '2026-08-03T12:00:00.000Z' });
    // Re-parsing must succeed: the server holds itself to exactly what a client will enforce.
    expect(() => parseControlPlaneSnapshotV1(JSON.parse(JSON.stringify(snapshot)))).not.toThrow();
    expect(Object.isFrozen(snapshot)).toBe(true);
  });

  it('never claims live operational data', () => {
    const snapshot = buildControlPlaneSnapshot({ generatedAt: '2026-08-03T12:00:00.000Z' });
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

    // Each in-flight track carries exactly one `current`, and there is no `next` anywhere: the JOS
    // track is closed and no QFJ successor to P09.03 has been owner-locked.
    const qfj = body.roadmap.filter((marker) => marker.track === 'QFJ');
    const jos = body.roadmap.filter((marker) => marker.track === 'JOS');

    expect(body.roadmap.filter((marker) => marker.state === 'next')).toHaveLength(0);
    const qfjCurrent = qfj.filter((marker) => marker.state === 'current');
    expect(qfjCurrent).toHaveLength(1);
    expect(qfjCurrent[0]?.label).toContain('QFJ-P09.03');
    const qfjMerged = qfj
      .filter((marker) => marker.state === 'merged')
      .map((m) => m.label)
      .join(' ');
    expect(qfjMerged).toContain('QFJ-P09.01');
    expect(qfjMerged).toContain('QFJ-P09.02');
    // P09.02 merged a VALIDATION boundary. n8n stays NOT_CONNECTED above, and this surface must not
    // let a reader infer a bridge from a merge.
    expect(qfjCurrent[0]?.detail).toContain('not merged');

    // Phase-agnostic on purpose: naming the slice here would make this a test somebody edits every
    // phase, which is how the marker/BASELINE_FACTS drift got shipped in the first place.
    const josCurrent = jos.filter((marker) => marker.state === 'current');
    expect(josCurrent).toHaveLength(1);

    // The JOS foundation track is bounded and closes at its current slice, so it carries no `next`.
    // Neither does QFJ: the main track is mid-slice at P09.03, and no successor has been
    // owner-locked. Requiring a `next` here could only be satisfied by inventing one.
    expect(jos.filter((marker) => marker.state === 'next')).toHaveLength(0);

    expect(
      jos
        .filter((marker) => marker.state === 'merged')
        .map((m) => m.label)
        .join(' '),
    ).toContain('JOS-01A');
  });

  it('stamps the envelope at request time WITHOUT promoting source freshness', async () => {
    // The correction, asserted end to end. Two separate requests genuinely produce two different
    // `generatedAt` values -- and the facts underneath are compiled in, so freshness does not
    // budge. A request re-reads no Git, no governance document, no Core and no n8n.
    const first = parseControlPlaneSnapshotV1(await (await call()).json());
    await new Promise((resolve) => setTimeout(resolve, 5));
    const second = parseControlPlaneSnapshotV1(await (await call()).json());

    expect(Date.parse(second.generatedAt)).toBeGreaterThanOrEqual(Date.parse(first.generatedAt));
    for (const body of [first, second]) {
      expect(body.source.kind).toBe('REPOSITORY_BASELINE');
      expect(body.source.freshness).toBe('BUILD_DECLARATION');
      expect(body.source.liveOperationalData).toBe(false);
    }
    // Everything except the envelope instant is identical between calls.
    expect({ ...first, generatedAt: '' }).toEqual({ ...second, generatedAt: '' });
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
    // JOS-01C made the handler async so it can await session verification before doing any work.
    expect(code).toMatch(/export async function GET\b/);
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
      const label = file.replace(/\\/g, '/').split('/apps/jarvis-os/')[1] ?? file;
      // The auth subtree has its own, STRICTER containment spec (proxy-csp.test.ts), which pins
      // `process.env` and `node:fs` to exactly one file each. Re-scanning it here with the
      // control-plane rules would only report the two authorised exceptions as violations.
      if (label.startsWith('src/server/auth/') || label.endsWith('.test.ts')) {
        continue;
      }
      const code = readFileSync(file, 'utf8');
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

  it('locks the API route set to exactly three, all of them accounted for', () => {
    // An EXACT set. A fourth route file appearing -- a debug endpoint, a session introspection
    // helper, an auth-config reader -- fails this test rather than shipping quietly.
    const routes = walk(join(SRC, 'app'))
      .map((file) => file.replace(/\\/g, '/'))
      .filter((file) => /\/route\.tsx?$/.test(file))
      .map((file) => file.split('/src/app/')[1] ?? file)
      .sort();
    expect(routes).toEqual([
      'api/auth/login/route.ts', // POST only: the sole unauthenticated mutation
      'api/auth/logout/route.ts', // POST only: session-bound CSRF required
      'api/control-plane/v1/snapshot/route.ts', // GET only: requires a verified session
    ]);
  });
});
