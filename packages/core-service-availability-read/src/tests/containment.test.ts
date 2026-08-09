/**
 * RWC-P5 — containment for `@qf-jarvis/core-service-availability-read` (ADR-0100 §33).
 *
 * The companion spec proves what this package accepts. This one proves what it cannot do at all.
 *
 * Two directions matter, and they are the reason the package exists as a leaf rather than living
 * inside Riya or inside the web service:
 *
 * - **Downward:** it reaches nothing. No HTTP, no QuickFurno, no database, no environment, no cache.
 *   A contract that could fetch would become the live adapter by accident, and the live adapter is a
 *   later, separately governed integration.
 * - **Upward:** it knows nothing about Riya. No phase, no continuity, no observation, no model. That
 *   is what lets one contract also serve a future WhatsApp Riya or an operator surface.
 *
 * And one rule that is really a business rule: **no city or service literal.** The moment a name
 * appears in production source, Jarvis has started owning a fact that belongs to Core.
 *
 * Scans read production source with comments stripped: this package necessarily NAMES the things it
 * refuses to be, so scanning the prose would report every prohibition as its own violation.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import * as barrel from '../index.js';

const SRC = fileURLToPath(new URL('../', import.meta.url));
const PKG = fileURLToPath(new URL('../../', import.meta.url));

function walk(dir: string, skip: readonly string[]): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (skip.includes(entry)) continue;
      out.push(...walk(full, skip));
    } else if (entry.endsWith('.ts')) {
      out.push(full);
    }
  }
  return out;
}

function codeOnly(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//gu, '')
    .split('\n')
    .filter((line) => !/^\s*\/\//u.test(line))
    .join('\n');
}

/** Production source. `testing/` is a shipped subpath but holds the synthetic fixture, so it is
 *  scanned separately where a rule applies to it and excluded where it legitimately differs. */
const productionCode = (): string =>
  walk(SRC, ['tests', 'testing'])
    .map((file) => codeOnly(readFileSync(file, 'utf8')))
    .join('\n');

const shippedCode = (): string =>
  walk(SRC, ['tests'])
    .map((file) => codeOnly(readFileSync(file, 'utf8')))
    .join('\n');

describe('it reaches nothing', () => {
  it('holds no transport, client, endpoint or credential', () => {
    // The port is deliberately unsatisfied in this repository. A fetch here would make this the live
    // QuickFurno adapter by accident -- and that adapter belongs to the final integration handshake,
    // where an endpoint, an auth scheme and a payload can be agreed rather than guessed.
    const code = shippedCode();
    for (const forbidden of [
      'fetch(',
      'node:http',
      'node:https',
      'node:net',
      'node:fs',
      'undici',
      'axios',
      'XMLHttpRequest',
      'WebSocket',
      'apiKey',
      'Authorization',
      'Bearer',
      'https://',
      'http://',
      '/api/',
      'quickfurno',
      'supabase',
      'n8n',
      'webhook',
    ]) {
      expect({
        forbidden,
        present: code.toLowerCase().includes(forbidden.toLowerCase()),
      }).toStrictEqual({ forbidden, present: false });
    }
  });

  it('touches no database, environment or cache', () => {
    const code = shippedCode();
    for (const forbidden of [
      "'pg'",
      'Pool',
      'DATABASE_URL',
      'connectionString',
      'process.env',
      'SELECT ',
      'INSERT INTO',
      'migration',
      'cache',
      'ttl',
      'expiresAt',
      'staleAfter',
    ]) {
      expect({
        forbidden,
        present: code.toLowerCase().includes(forbidden.toLowerCase()),
      }).toStrictEqual({ forbidden, present: false });
    }
  });

  it('reads no clock and no randomness, so one snapshot parses identically forever', () => {
    const code = shippedCode();
    for (const forbidden of ['Date.now', 'new Date', 'Math.random', 'randomUUID', 'hrtime']) {
      expect({ forbidden, present: code.includes(forbidden) }).toStrictEqual({
        forbidden,
        present: false,
      });
    }
  });

  it('invokes no model and consults no decision authority', () => {
    const code = shippedCode();
    for (const forbidden of [
      'model-gateway',
      'model-reply-adapter',
      'ModelGatewayInvoker',
      'core-decision-adapter',
      'CoreDecisionTransport',
      'openai',
      'anthropic',
      'groq',
    ]) {
      expect({
        forbidden,
        present: code.toLowerCase().includes(forbidden.toLowerCase()),
      }).toStrictEqual({ forbidden, present: false });
    }
  });
});

describe('it knows nothing about Riya', () => {
  it('names no conversation, phase, continuity or observation concept', () => {
    // Upward independence. A city/service contract that learned about phases would be unusable by
    // anything except one agent on one surface.
    const code = shippedCode();
    for (const forbidden of [
      'riya',
      'continuity',
      'conversationId',
      'observation',
      'discovery',
      'summaryConfirmed',
      'questionPlan',
      'provenance',
      'INTRO',
      'SUMMARY',
      'CONTACT',
      'CONSENT',
      'COMPLETE',
      'locationRef',
      'serviceInterestRef',
      'jarvis-runtime',
      'agent-runtime',
    ]) {
      expect({
        forbidden,
        present: code.toLowerCase().includes(forbidden.toLowerCase()),
      }).toStrictEqual({ forbidden, present: false });
    }
  });

  it('holds no business data beyond the availability question it answers', () => {
    const code = shippedCode();
    for (const forbidden of [
      'vendorId',
      'vendorCount',
      'vendorName',
      'price',
      'package',
      'payment',
      'invoice',
      'leadId',
      'clientId',
      'phone',
      'email',
      'consent',
      'canSubmit',
      'latitude',
      'longitude',
      'geocode',
      'pincode',
      'projectArea',
      'areaRef',
      'transcript',
    ]) {
      expect({
        forbidden,
        present: code.toLowerCase().includes(forbidden.toLowerCase()),
      }).toStrictEqual({ forbidden, present: false });
    }
  });

  it('carries NO alias or synonym vocabulary in V1', () => {
    // Core publishes an id, a display name, a state and a version -- and no governed alias
    // collection. Adding one because it would help natural-language matching would be Jarvis
    // asserting a Core-owned fact Core never agreed to own.
    const code = shippedCode();
    for (const forbidden of ['alias', 'synonym', 'previousDisplayName', 'previousName']) {
      expect({
        forbidden,
        present: code.toLowerCase().includes(forbidden.toLowerCase()),
      }).toStrictEqual({ forbidden, present: false });
    }
  });
});

describe('it invents no business truth', () => {
  it('contains no city or service literal anywhere in production source', () => {
    // The rule that matters most. Every value must come from a snapshot a reader supplied; the moment
    // a place name appears here, Jarvis has started owning a fact that is Core's.
    const code = productionCode().toLowerCase();
    for (const forbidden of [
      'pune',
      'mumbai',
      'bombay',
      'delhi',
      'bengaluru',
      'bangalore',
      'hyderabad',
      'nashik',
      'nagpur',
      'chennai',
      'kolkata',
      'modular',
      'kitchen',
      'wardrobe',
      'carpenter',
      'painter',
      'interior',
    ]) {
      expect({ forbidden, present: code.includes(forbidden) }).toStrictEqual({
        forbidden,
        present: false,
      });
    }
  });

  it('has no default, fallback or "allow everything" path', () => {
    const code = shippedCode();
    for (const forbidden of [
      'defaultCity',
      'fallbackCity',
      'DEFAULT_CITY',
      'allowAll',
      'assumeAvailable',
      'defaultSnapshot',
      'emptySnapshotIsValid',
    ]) {
      expect({ forbidden, present: code.includes(forbidden) }).toStrictEqual({
        forbidden,
        present: false,
      });
    }
  });
});

describe('it stays a leaf with a small surface', () => {
  it('depends on exactly @qf-jarvis/contracts and zod', () => {
    const manifest = JSON.parse(readFileSync(join(PKG, 'package.json'), 'utf8')) as {
      readonly dependencies?: Record<string, string>;
      readonly devDependencies?: Record<string, string>;
      readonly exports?: Record<string, unknown>;
    };
    expect(Object.keys(manifest.dependencies ?? {}).sort()).toStrictEqual([
      '@qf-jarvis/contracts',
      'zod',
    ]);
    expect(Object.keys(manifest.devDependencies ?? {})).toStrictEqual([]);
    // RWC-P6 (ADR-0101) adds `./policy`: the three agent-neutral read predicates, moved here from
    // `riya-model-interaction` so a structured summary edit and the one model call apply the SAME
    // pair rule. A subpath rather than a root export -- the root is the READ CONTRACT, and its four
    // runtime values are locked; a predicate is not a contract.
    expect(Object.keys(manifest.exports ?? {}).sort()).toStrictEqual([
      '.',
      './policy',
      './testing',
    ]);
  });

  it('deep-imports no other package private module', () => {
    const code = shippedCode();
    expect(code).not.toMatch(/@qf-jarvis\/[a-z-]+\/(src|dist|internal)\//u);
  });

  it('exposes exactly the four runtime values it means to', () => {
    // The schemas stay internal. A caller able to compose sub-schemas would build its own
    // half-validated snapshot, and "everything in use went through the parser" would stop being true.
    expect(Object.keys(barrel).sort()).toStrictEqual([
      'CORE_SERVICE_AVAILABILITY_READ_ERROR_CODES',
      'CORE_SERVICE_AVAILABILITY_READ_VERSION',
      'CoreServiceAvailabilityReadError',
      'parseCoreServiceAvailabilitySnapshotV1',
    ]);
    const b = barrel as Record<string, unknown>;
    for (const internal of [
      'MAX_CORE_SERVICE_AVAILABILITY_SNAPSHOT_CHARS',
      'syntheticAvailabilitySnapshot',
      'scriptedAvailabilityReader',
    ]) {
      expect(b[internal], internal).toBeUndefined();
    }
  });

  it('the reader port is a TYPE only: the root exports no implementation of it', () => {
    // A shipped default reader is the failure this package is shaped to prevent -- it would answer
    // "everything is available everywhere" and pass every test in the repository.
    const b = barrel as Record<string, unknown>;
    for (const key of Object.keys(b)) {
      expect(typeof b[key] === 'function' ? key : 'ok').not.toContain('Reader');
    }
    const contractSource = readFileSync(join(SRC, 'contract/reader.ts'), 'utf8');
    // A port file that declared a value would be an implementation hiding behind a contract name.
    expect(codeOnly(contractSource)).not.toMatch(/^\s*export (const|function|class)\s/mu);
  });
});
