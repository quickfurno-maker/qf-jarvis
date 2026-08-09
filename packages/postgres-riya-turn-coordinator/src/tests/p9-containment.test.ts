/**
 * RWC-P9 containment for the durable coordinator — observability adds events, and nothing else
 * (ADR-0105).
 *
 * The RWC-P8 containment spec already proves this package reaches nothing and composes nothing.
 * These prove that adding observability did not quietly change that: no logger, no exporter, no
 * dependency, no clock, and above all no path by which a digest, a statement or a host reaches an
 * event object.
 *
 * Scans read production source with comments stripped, because the package documents at length the
 * things it refuses to emit.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import * as barrel from '../index.js';

const SRC = fileURLToPath(new URL('../', import.meta.url));
const PKG = fileURLToPath(new URL('../../', import.meta.url));

const NOT_SOURCE = new Set(['node_modules', 'dist', '.next', 'coverage', '.turbo']);

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (NOT_SOURCE.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === 'tests') continue;
      out.push(...walk(full));
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

const productionFiles = (): readonly { readonly file: string; readonly code: string }[] =>
  walk(SRC).map((file) => ({ file, code: codeOnly(readFileSync(file, 'utf8')) }));

const adapterCode = (): string =>
  codeOnly(readFileSync(join(SRC, 'adapter/create-coordinator.ts'), 'utf8'));

// ---------------------------------------------------------------------------
// 1. No clock, no retry, no telemetry product.
// ---------------------------------------------------------------------------

describe('RWC-P9 adds no clock, no retry and no telemetry integration here either', () => {
  it('names no timer, race, abort or scheduling primitive', () => {
    for (const { file, code } of productionFiles()) {
      for (const forbidden of [
        'setTimeout',
        'setInterval',
        'setImmediate',
        'queueMicrotask',
        'Promise.race',
        'Promise.any',
        'AbortController',
        'AbortSignal',
        'Date.now',
        'performance.now',
      ]) {
        expect(code, `${file} must not name ${forbidden}`).not.toContain(forbidden);
      }
    }
  });

  it('names no retry, backoff or reconciliation loop', () => {
    // A retry here would be the worst possible place for one: the statements it would repeat are the
    // guarded writes whose whole purpose is to be attempted exactly once.
    for (const { file, code } of productionFiles()) {
      for (const forbidden of [
        /\bretr(y|ies|ying)\b/iu,
        /\bbackoff\b/iu,
        /\bsleep\b/iu,
        /\bwhile\s*\(/u,
      ]) {
        expect(forbidden.test(code), `${file} must not match ${String(forbidden)}`).toBe(false);
      }
    }
  });

  it('writes nowhere: no console, no logger, no exporter, no server', () => {
    for (const { file, code } of productionFiles()) {
      for (const forbidden of [
        'console.',
        'process.stdout',
        'process.stderr',
        'process.env',
        'node:fs',
        'opentelemetry',
        'OpenTelemetry',
        'prom-client',
        'Prometheus',
        'StatsD',
        'datadog',
        'Sentry',
        'pino',
        'winston',
        'createServer',
        '/metrics',
      ]) {
        expect(code, `${file} must not name ${forbidden}`).not.toContain(forbidden);
      }
    }
  });

  it('adds no dependency', () => {
    const manifest = JSON.parse(readFileSync(join(PKG, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    expect(Object.keys(manifest.dependencies ?? {}).sort()).toStrictEqual([
      '@qf-jarvis/riya-web-conversation-service',
      'pg',
    ]);
    expect(Object.keys(manifest.devDependencies ?? {}).sort()).toStrictEqual([
      '@qf-jarvis/event-backbone',
      '@types/pg',
    ]);
  });
});

// ---------------------------------------------------------------------------
// 2. No content can structurally reach an event.
// ---------------------------------------------------------------------------

describe('no identifier, digest or statement can structurally reach an event', () => {
  /** The exact argument text of each `observe(` call, by matching parentheses. */
  const observeArguments = (code: string): readonly string[] => {
    const args: string[] = [];
    for (const site of code.matchAll(/observe\(/gu)) {
      let depth = 0;
      let cursor = site.index + 'observe'.length;
      const start = cursor + 1;
      for (; cursor < code.length; cursor += 1) {
        const char = code[cursor];
        if (char === '(') depth += 1;
        else if (char === ')') {
          depth -= 1;
          if (depth === 0) break;
        }
      }
      args.push(code.slice(start, cursor));
    }
    return args;
  };

  it('every observe() argument is a closed literal — no spread, no computed field', () => {
    // Structural, not behavioural. A spread or a computed field would let a future edit widen an
    // event without anybody noticing, and the leak specs only see the paths they happen to drive.
    const args = observeArguments(adapterCode());
    expect(args.length).toBeGreaterThan(10);
    for (const argument of args) {
      expect(argument, 'no spread into an event').not.toContain('...');
      expect(argument, 'no template literal in an event').not.toContain('`');
      // Every `type` is a quoted literal, and there is at least one. A ternary choosing between two
      // literal events is fine -- what is not fine is a `type` computed from anything at runtime.
      const types = [...argument.matchAll(/type:\s*(.)/gu)].map((match) => match[1]);
      expect(types.length, 'an event must declare a type').toBeGreaterThan(0);
      expect(
        types.every((quote) => quote === "'"),
        'every type is a literal',
      ).toBe(true);
    }
  });

  it('no observe() argument names a digest, a lock key, SQL, a raw error or an identifier', () => {
    // The digests are derived from a caller's channel reference, so a stream of them is a stream of
    // correlatable turn fingerprints -- the same disclosure the ledger declined, wearing a hash.
    for (const argument of observeArguments(adapterCode())) {
      for (const forbidden of [
        /\bsourceDigest\b/u,
        /\bidentityDigest\b/u,
        /\blockKey\b/u,
        /\bTRY_LOCK\b/u,
        /\bUNLOCK\b/u,
        /\bSELECT_CANDIDATE_CLAIMS\b/u,
        /\bINSERT_PROCESSING_CLAIM\b/u,
        /\bFINALIZE_CLAIM\b/u,
        /input\.(tenantId|conversationId|messageId|channelTurnRef|subjectRef)/u,
        // The raw error itself, but NOT `errorCode` -- the bounded code is the whole point.
        /\berror\b/u,
        /\bmessage\b/u,
        /\bstack\b/u,
        /\brows\b/u,
        /\browCount\b/u,
      ]) {
        expect(
          forbidden.test(argument),
          `an event must not be built from ${String(forbidden)}`,
        ).toBe(false);
      }
      // `channel` is the ONE thing carried through from the caller, and it is a closed two-value
      // vocabulary rather than a provider identity.
      expect(argument.replace(/input\.channel\b/gu, '')).not.toContain('input.');
    }
  });

  it('the emitter freezes what it hands out and swallows what a sink throws', () => {
    // Frozen so one sink cannot mutate an event another sink will read; swallowed because a metrics
    // failure must never become a conversation failure, and must never change whether a session is
    // destroyed.
    const code = adapterCode();
    expect(code).toMatch(/observability\.record\(Object\.freeze\(\{\s*\.\.\.event\s*\}\)\)/u);
    expect(code).toMatch(/try\s*\{\s*observability\.record[\s\S]{0,120}?\}\s*catch\s*\{/u);
  });

  it('the hook is never awaited and never branched on', () => {
    const code = adapterCode();
    expect(code).not.toContain('await observe');
    expect(code).not.toContain('await observability');
    expect(code).not.toMatch(/if\s*\(\s*observ/u);
  });
});

// ---------------------------------------------------------------------------
// 3. The public surface stayed a vocabulary, not a mechanism.
// ---------------------------------------------------------------------------

describe('the additions are a vocabulary, not a mechanism', () => {
  it('exports no sink, transport, adapter or recorder', () => {
    for (const forbidden of [
      'createObservability',
      'createRecorder',
      'createLogger',
      'createExporter',
      'observe',
    ]) {
      expect(Object.keys(barrel)).not.toContain(forbidden);
    }
  });

  it('the no-op default really is a no-op', () => {
    const code = codeOnly(readFileSync(join(SRC, 'contracts/observability.ts'), 'utf8'));
    // Absent configuration must mean silence, not a hidden logger that starts printing a production
    // conversation's shape to stdout the first time somebody forgets to inject a sink.
    expect(code).not.toContain('console');
    expect(code).toMatch(/record\(\): void \{\s*\}/u);
  });
});
