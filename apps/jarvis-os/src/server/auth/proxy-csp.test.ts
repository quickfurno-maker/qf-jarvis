import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { SECURITY_HEADERS, contentSecurityPolicy, isApiPath, isPublicPath } from '../../proxy';

/**
 * Proxy classification and Content-Security-Policy (JOS-01C, ADR-0087).
 *
 * The proxy's routing decisions and its CSP are pure functions, exported so they can be asserted
 * without a Next.js request pipeline. What cannot be asserted here — that the proxy actually runs —
 * does not matter, because the proxy is deliberately NOT the authorization boundary: the route and
 * layout tests prove the protected surfaces refuse on their own.
 */

const SRC = fileURLToPath(new URL('../../', import.meta.url));

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

describe('proxy route classification', () => {
  it('treats only the login page and login POST as public', () => {
    expect(isPublicPath('/login')).toBe(true);
    expect(isPublicPath('/api/auth/login')).toBe(true);
  });

  it('protects every operator page and the snapshot API by default', () => {
    const protectedPaths = [
      '/',
      '/agents/jarvis',
      '/agents/riya',
      '/agents/aarohi',
      '/agents/anisha',
      '/operations',
      '/approvals',
      '/conversations',
      '/execution',
      '/knowledge',
      '/evaluations',
      '/models',
      '/workers',
      '/core-sync',
      '/integrations',
      '/analytics',
      '/governance',
      '/settings',
      '/api/control-plane/v1/snapshot',
      '/api/control-plane/v2/snapshot',
      '/api/auth/logout',
      // A route nobody has written yet is protected because the allowlist is explicit.
      '/some/future/surface',
    ];
    for (const path of protectedPaths) {
      expect(isPublicPath(path), path).toBe(false);
    }
  });

  it('classifies API paths so an unauthenticated call gets JSON, not a redirect', () => {
    expect(isApiPath('/api/control-plane/v1/snapshot')).toBe(true);
    expect(isApiPath('/api/control-plane/v2/snapshot')).toBe(true);
    expect(isApiPath('/api/auth/logout')).toBe(true);
    expect(isApiPath('/approvals')).toBe(false);
  });

  it('does not exempt the snapshot API from the matcher', async () => {
    const { config } = (await import('../../proxy')) as { config: { matcher: string[] } };
    const pattern = config.matcher[0] ?? '';
    // The matcher excludes only Next's static output. A pattern that also skipped /api would leave
    // the one protected API ungated at this layer.
    expect(pattern).not.toContain('api');
    expect(pattern).toContain('_next/static');
  });
});

describe('the Content-Security-Policy', () => {
  const production = contentSecurityPolicy('TEST-NONCE', false);

  it('uses a nonce with strict-dynamic and no unsafe directive in production', () => {
    expect(production).toContain("script-src 'self' 'nonce-TEST-NONCE' 'strict-dynamic'");
    expect(production).not.toContain('unsafe-eval');
    expect(production).not.toContain('unsafe-inline');
  });

  it('forbids framing, base rewriting and off-origin form posts', () => {
    expect(production).toContain("frame-ancestors 'none'");
    expect(production).toContain("base-uri 'none'");
    expect(production).toContain("form-action 'self'");
    expect(production).toContain("object-src 'none'");
    expect(production).toContain("connect-src 'self'");
  });

  it('names no external host and no wildcard anywhere', () => {
    expect(production).not.toMatch(/https?:\/\//u);
    expect(production).not.toContain('*');
  });

  it('permits exactly the development relaxations, and only in development', () => {
    const development = contentSecurityPolicy('TEST-NONCE', true);
    expect(development).toContain('unsafe-eval');
    expect(development).toContain("style-src 'self' 'unsafe-inline'");
    // Production keeps the nonce for styles instead.
    expect(production).toContain("style-src 'self' 'nonce-TEST-NONCE'");
  });
});

describe('security headers', () => {
  it('sets the full set on every response', () => {
    expect(SECURITY_HEADERS['X-Content-Type-Options']).toBe('nosniff');
    // `same-origin`, never `no-referrer`. Firefox derives a form submission's `Origin` from the
    // document's referrer policy, so `no-referrer` made same-origin logins arrive as
    // `Origin: null` and be correctly refused by the CSRF check. Reverting this header would
    // reintroduce a browser-specific authentication outage that Chromium testing cannot see.
    expect(SECURITY_HEADERS['Referrer-Policy']).toBe('same-origin');
    expect(SECURITY_HEADERS['X-Frame-Options']).toBe('DENY');
    expect(SECURITY_HEADERS['Cross-Origin-Opener-Policy']).toBe('same-origin');
    expect(SECURITY_HEADERS['Cross-Origin-Resource-Policy']).toBe('same-origin');
  });

  it('denies the sensitive device permissions', () => {
    const policy = SECURITY_HEADERS['Permissions-Policy'] ?? '';
    for (const feature of ['camera', 'microphone', 'geolocation', 'payment', 'usb']) {
      expect(policy, feature).toContain(`${feature}=()`);
    }
  });

  it('does NOT claim HSTS — the tier that terminates TLS owns that header', () => {
    // Sending HSTS from the application would either do nothing or read as protection that is not
    // there. JOS-01D put it in a reviewed Traefik overlay applied only after trusted TLS is proven,
    // so it must stay absent here even though the deployment now serves real HTTPS.
    expect(Object.keys(SECURITY_HEADERS)).not.toContain('Strict-Transport-Security');
  });
});

describe('protected pages are never prerendered', () => {
  it('the protected layout forces dynamic rendering', () => {
    // Without this Next prerendered all eighteen operator pages as STATIC HTML: the session check
    // ran once at build time and the result was baked to disk. A protected page must be rendered
    // per request or the check is decorative.
    const layout = readFileSync(join(SRC, 'app/(protected)/layout.tsx'), 'utf8');
    expect(layout).toContain("export const dynamic = 'force-dynamic'");
    expect(layout).toContain('requireOperatorSession');
  });

  it('the login page and every auth route are dynamic too', () => {
    for (const relative of [
      'app/(public)/login/page.tsx',
      'app/api/auth/login/route.ts',
      'app/api/auth/logout/route.ts',
      'app/api/control-plane/v1/snapshot/route.ts',
      'app/api/control-plane/v2/snapshot/route.ts',
    ]) {
      const code = readFileSync(join(SRC, relative), 'utf8');
      expect(code, relative).toContain("export const dynamic = 'force-dynamic'");
    }
  });
});

describe('secret containment in application source', () => {
  const authDir = join(SRC, 'server/auth');

  it('reads process.env in exactly one place, for exactly one variable', () => {
    const offenders: string[] = [];
    for (const file of walk(join(SRC))) {
      const relative = file.replace(/\\/gu, '/').split('/src/')[1] ?? file;
      if (relative.endsWith('.test.ts') || relative === 'proxy.ts') {
        continue;
      }
      const code = readFileSync(file, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//gu, '')
        .split('\n')
        .filter((line) => !/^\s*\/\//u.test(line))
        .join('\n');
      if (/process\s*\.\s*env/u.test(code) && relative !== 'server/auth/config/loader.ts') {
        offenders.push(relative);
      }
    }
    expect(offenders).toEqual([]);

    const loader = readFileSync(join(authDir, 'config/loader.ts'), 'utf8');
    // The only variable, and it holds a path rather than any secret material.
    expect(loader).toContain("AUTH_CONFIG_PATH_VAR = 'QFJ_JOS_AUTH_CONFIG_FILE'");
    const envReads = loader.match(/process\.env\[/gu) ?? [];
    expect(envReads).toHaveLength(1);
  });

  it('imports node:fs only in the auth config loader', () => {
    const offenders: string[] = [];
    for (const file of walk(SRC)) {
      const relative = file.replace(/\\/gu, '/').split('/src/')[1] ?? file;
      if (relative.endsWith('.test.ts')) {
        continue;
      }
      const code = readFileSync(file, 'utf8');
      if (/from '(node:)?fs/u.test(code) && relative !== 'server/auth/config/loader.ts') {
        offenders.push(relative);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('never writes a secret into a NEXT_PUBLIC variable or a client component', () => {
    for (const file of walk(SRC)) {
      const relative = file.replace(/\\/gu, '/').split('/src/')[1] ?? file;
      // A containment spec must name the strings it forbids, so scanning one reports its own
      // prohibition as the violation -- the recurring false positive in this repository's suites.
      if (relative.endsWith('.test.ts')) {
        continue;
      }
      const code = readFileSync(file, 'utf8');
      expect(code, `${relative}: NEXT_PUBLIC`).not.toContain('NEXT_PUBLIC');
      // A client component must never import the config loader, the token sealer or the password
      // verifier: doing so would pull secret-handling code into the browser bundle.
      if (code.startsWith("'use client'")) {
        expect(code, `${relative}: config`).not.toContain('auth/config/');
        expect(code, `${relative}: password`).not.toContain('auth/password/');
        expect(code, `${relative}: totp`).not.toContain('auth/totp/');
        expect(code, `${relative}: sealSession`).not.toContain('sealSession');
      }
    }
  });
});
