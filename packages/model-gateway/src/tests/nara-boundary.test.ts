/**
 * JF-2A boundaries: adding a second hosted provider moved nothing else (ADR-0146).
 *
 * The same discipline every provider-adjacent package already applies to itself — scan the repository
 * and prove nobody reaches in. What is new here is only that there are now two hosted adapters to keep
 * contained instead of one.
 *
 * ### Two pre-existing Groq compositions are deliberately out of scope
 *
 * `riya-candidate-evidence-live` constructs a Groq provider, and so does `apps/api`'s controlled SHADOW
 * runner. Both are owner-run diagnostic paths that predate JF-2A, both are reached only by an explicit
 * CLI, and neither is the customer conversation path. JF-2A changed neither and gave neither a Nara
 * provider — a fact this suite asserts rather than assumes.
 *
 * So the scope below is the CUSTOMER path and the Mastra operations app: the places where a provider
 * import would mean the gateway had stopped being the only thing that chooses a vendor. Within
 * `apps/api` the customer surface is the private Riya web ingress, and it is checked directly.
 *
 * Production source only. A spec naming a provider is describing one, not importing one.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/** `packages/model-gateway/src/tests` → the repository root is four levels up. */
const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));

/** Symbols and paths that only a provider adapter should ever name. */
const PROVIDER_ADAPTER_MARKERS: readonly string[] = Object.freeze([
  'providers/nara',
  'providers/groq',
  'NaraModelProvider',
  'GroqModelProvider',
  'createNaraProviderConfig',
  'createGroqProviderConfig',
  'router.bynara.id',
  'api.groq.com',
]);

/**
 * The customer conversation path plus the Mastra operations app.
 *
 * A provider adapter reaching any of these would mean vendor selection had escaped the gateway — the
 * one property ADR-0145 fixes and ADR-0146 must not erode.
 */
const CONTAINED_PACKAGES: readonly string[] = Object.freeze([
  'packages/riya-agent',
  'packages/riya-web-conversation-service',
  'packages/riya-conversation-continuity',
  'packages/riya-conversation-completion',
  'packages/riya-conversation-evolution',
  'packages/riya-model-interaction',
  'packages/riya-prompts',
  'packages/jarvis-runtime',
  'packages/agent-runtime',
  'packages/model-reply-adapter',
  'apps/worker',
]);

/** The customer surface inside `apps/api`. The rest of that app hosts the shadow diagnostic runner. */
const API_CUSTOMER_SURFACE = 'apps/api/src/private-riya-web-ingress';

function sourceFiles(relativeDir: string): readonly string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    let entries: readonly string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        if (entry === 'dist' || entry === 'node_modules' || entry === 'tests') continue;
        walk(full);
        continue;
      }
      if (entry.endsWith('.ts') && !entry.endsWith('.d.ts') && !entry.endsWith('.test.ts')) {
        out.push(full);
      }
    }
  };
  walk(join(REPO_ROOT, relativeDir, 'src'));
  return out;
}

describe('JF-2A provider containment', () => {
  it('33-34. no Riya customer package and no Mastra app names a provider adapter', () => {
    const violations: string[] = [];
    for (const pkg of CONTAINED_PACKAGES) {
      for (const file of sourceFiles(pkg)) {
        const text = readFileSync(file, 'utf8');
        for (const marker of PROVIDER_ADAPTER_MARKERS) {
          if (text.includes(marker)) {
            violations.push(`${file.slice(REPO_ROOT.length)} names ${marker}`);
          }
        }
      }
    }
    expect(violations).toStrictEqual([]);
  });

  it('33b. the private Riya web ingress names no provider adapter', () => {
    const violations: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) {
          walk(full);
          continue;
        }
        if (!entry.endsWith('.ts')) continue;
        const text = readFileSync(full, 'utf8');
        for (const marker of PROVIDER_ADAPTER_MARKERS) {
          if (text.includes(marker)) violations.push(`${entry} names ${marker}`);
        }
      }
    };
    walk(join(REPO_ROOT, API_CUSTOMER_SURFACE));
    expect(violations).toStrictEqual([]);
  });

  it('33c. JF-2A gave no Nara provider to either pre-existing Groq diagnostic path', () => {
    // The scope note above says these two compose Groq by design. This asserts JF-2A did not quietly
    // hand them a second vendor as well.
    for (const dir of ['packages/riya-candidate-evidence-live/src', 'apps/api/src/shadow']) {
      const walk = (current: string): void => {
        for (const entry of readdirSync(current)) {
          const full = join(current, entry);
          if (statSync(full).isDirectory()) {
            if (entry === 'dist' || entry === 'node_modules') continue;
            walk(full);
            continue;
          }
          if (!entry.endsWith('.ts')) continue;
          expect(readFileSync(full, 'utf8'), entry).not.toMatch(/Nara|nara/);
        }
      };
      walk(join(REPO_ROOT, dir));
    }
  });

  it('34b. the Mastra supervisor still reaches only the provider-neutral gateway', () => {
    const bridge = readFileSync(
      join(REPO_ROOT, 'apps/worker/src/jao/mastra-supervisor/model-bridge.ts'),
      'utf8',
    );
    // It may know the gateway CONTRACT. It may not know a vendor.
    expect(bridge).toMatch(/ModelGateway/);
    expect(bridge).not.toMatch(/Groq|Nara|groq|nara/);
  });

  it('35. no QuickFurno or OneDecore source exists in this repository', () => {
    const roots = readdirSync(REPO_ROOT).map((one) => one.toLowerCase());
    expect(roots).not.toContain('quickfurno');
    expect(roots).not.toContain('onedecore');
    const packages = readdirSync(join(REPO_ROOT, 'packages')).map((one) => one.toLowerCase());
    for (const one of packages) {
      expect(one).not.toContain('quickfurno');
      expect(one).not.toContain('onedecore');
    }
  });

  it('38. JF-2A added no activation surface to the production composition', () => {
    const config = readFileSync(
      join(
        REPO_ROOT,
        'packages/model-gateway-composition/src/contracts/production-composition-config.ts',
      ),
      'utf8',
    );
    // The three refusals that keep production OFF are still declared, and JF-2A did not touch them.
    expect(config).toContain('mode-not-off');
    expect(config).toContain('fallback-not-disabled');
    expect(config).toContain('retry-budget-not-zero');
    // The composition knows nothing about Nara: a provider mode is not an activation.
    expect(config).not.toMatch(/nara/i);
    expect(config).not.toMatch(/ProviderMode/);
  });

  it('39. the Nara adapter reaches the network from exactly one guarded function', () => {
    const providerDir = join(REPO_ROOT, 'packages/model-gateway/src/providers/nara');
    const withFetch: string[] = [];
    for (const entry of readdirSync(providerDir)) {
      if (!entry.endsWith('.ts')) continue;
      const text = readFileSync(join(providerDir, entry), 'utf8');
      if (/\bfetch\s*\(/.test(text)) withFetch.push(entry);
    }
    expect(withFetch).toStrictEqual(['nara-transport.ts']);

    const transport = readFileSync(join(providerDir, 'nara-transport.ts'), 'utf8');
    // One endpoint constant, a refusal for anything else, no redirect following, a bounded read.
    expect(transport).toContain('non-official endpoint');
    expect(transport).toContain("redirect: 'error'");
    expect(transport).toContain('NARA_MAX_RESPONSE_BYTES');
    // No environment access and no configurable base URL anywhere in the provider.
    for (const entry of readdirSync(providerDir)) {
      if (!entry.endsWith('.ts')) continue;
      const text = readFileSync(join(providerDir, entry), 'utf8');
      expect(text, entry).not.toMatch(/process\.env/);
      // Structural, not a prose scan: a base-URL PROPERTY or ASSIGNMENT is what would make the
      // destination configurable. The transport's own comment explains why there is no such option,
      // and a check that flagged the explanation would be flagging its own guarantee.
      expect(text, entry).not.toMatch(/\b(baseUrl|baseURL|endpointUrl)\s*[:=?]/);
    }
  });

  it('39b. no Nara credential or endpoint is committed anywhere', () => {
    const providerDir = join(REPO_ROOT, 'packages/model-gateway/src/providers/nara');
    for (const entry of readdirSync(providerDir)) {
      if (!entry.endsWith('.ts')) continue;
      const text = readFileSync(join(providerDir, entry), 'utf8');
      // No bearer-looking literal, and the only URL is the canonical router origin.
      expect(text, entry).not.toMatch(/sk-[A-Za-z0-9]{12,}/);
      expect(text, entry).not.toMatch(/Bearer\s+[A-Za-z0-9._-]{12,}/);
      for (const url of text.match(/https?:\/\/[^\s'"`]+/g) ?? []) {
        expect(url, entry).toContain('router.bynara.id');
      }
    }
  });
});
