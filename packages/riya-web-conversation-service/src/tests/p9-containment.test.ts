/**
 * RWC-P9 containment — what hardening was NOT allowed to add (ADR-0105).
 *
 * The behaviour specs prove the gate bounds a replica and the events say enough to operate it. These
 * prove the shape of the additions: no second reliability layer, no telemetry product, no clock.
 *
 * ### Why a timer is the specific thing being kept out
 *
 * After `startProcessing` a logical turn is potentially SPENT. A JavaScript timeout that merely stops
 * *waiting* — `Promise.race`, an `AbortController` this package invented, a retry loop — would leave
 * the underlying runtime, model or Core call still running, and every release and finalization
 * decision downstream would then be reasoning about a turn that had not finished. The side effect
 * would exist and nothing here would track it. A deadline has to live at the I/O authority that can
 * actually cancel and normalize it, which is `@qf-jarvis/model-gateway`.
 *
 * Scans read production source with comments stripped: this file's own subject matter is a list of
 * things the package refuses to be, and the package documents those refusals in prose.
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

const admissionCode = (): string =>
  codeOnly(readFileSync(join(SRC, 'internal/text-turn-admission.ts'), 'utf8'));

const serviceCode = (): string =>
  codeOnly(readFileSync(join(SRC, 'service/create-service.ts'), 'utf8'));

// ---------------------------------------------------------------------------
// 1. No clock, no second reliability layer.
// ---------------------------------------------------------------------------

describe('RWC-P9 adds no timeout, retry, circuit, queue or clock', () => {
  it('names no timer, race, abort or scheduling primitive anywhere in production source', () => {
    for (const { file, code } of productionFiles()) {
      for (const forbidden of [
        'setTimeout',
        'setInterval',
        'setImmediate',
        'clearTimeout',
        'clearInterval',
        'queueMicrotask',
        'Promise.race',
        'Promise.any',
        'AbortController',
        'AbortSignal',
        'Date.now',
        'performance.now',
        'process.hrtime',
      ]) {
        expect(code, `${file} must not name ${forbidden}`).not.toContain(forbidden);
      }
    }
  });

  it('names no retry, backoff, circuit, queue or fallback construct', () => {
    for (const { file, code } of productionFiles()) {
      for (const forbidden of [
        /\bretr(y|ies|ying)\b/iu,
        /\bbackoff\b/iu,
        /\bjitter\b/iu,
        /\bcircuit\b/iu,
        /\bbreaker\b/iu,
        /\bwaiter\b/iu,
        /\benqueue\b/iu,
        /\bdequeue\b/iu,
        /\bkillSwitch\b/iu,
        /\bfallback\b/iu,
        /\bsleep\b/iu,
      ]) {
        expect(forbidden.test(code), `${file} must not match ${String(forbidden)}`).toBe(false);
      }
    }
  });

  it('the gate is entirely synchronous — no promise can be introduced into the decision', () => {
    // A single `await` between the check and the increment would reintroduce the interleaving the
    // gate exists to prevent, and it would do so invisibly: the counter would still look correct in
    // every serial test.
    const code = admissionCode();
    for (const forbidden of ['async', 'await', 'Promise', 'then(', 'resolve', 'reject']) {
      expect(code, `the gate must not name ${forbidden}`).not.toContain(forbidden);
    }
  });

  it('the model gateway is not imported, referenced or duplicated', () => {
    // Request timeout, cancellation at the provider boundary, bounded model concurrency, bounded
    // model queue, budget refusal, retry policy, circuit breaker, kill switch, sequential fallback
    // and provider health all remain the gateway's. RWC-P9 protects a different resource -- the
    // database session and the process -- and adds no second copy of any of them.
    for (const { file, code } of productionFiles()) {
      for (const forbidden of [
        'model-gateway',
        'ModelGateway',
        'modelGateway',
        'maxConcurrentModel',
        'providerHealth',
      ]) {
        expect(code, `${file} must not name ${forbidden}`).not.toContain(forbidden);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// 2. Observability is interfaces and events. Nothing else.
// ---------------------------------------------------------------------------

describe('RWC-P9 integrates no telemetry product', () => {
  it('writes nowhere: no console, no logger, no file, no exporter, no server', () => {
    for (const { file, code } of productionFiles()) {
      for (const forbidden of [
        'console.',
        'process.stdout',
        'process.stderr',
        'node:fs',
        'writeFile',
        'appendFile',
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
        'listen(',
        '/metrics',
        '/healthz',
      ]) {
        expect(code, `${file} must not name ${forbidden}`).not.toContain(forbidden);
      }
    }
  });

  it('adds no dependency: observability is a type and a call, not a package', () => {
    const manifest = JSON.parse(readFileSync(join(PKG, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    expect(Object.keys(manifest.dependencies ?? {}).sort()).toStrictEqual([
      '@qf-jarvis/agent-runtime',
      '@qf-jarvis/contracts',
      '@qf-jarvis/core-riya-intake',
      '@qf-jarvis/core-service-availability-read',
      '@qf-jarvis/jarvis-runtime',
      '@qf-jarvis/riya-agent',
      '@qf-jarvis/riya-conversation-completion',
      '@qf-jarvis/riya-conversation-continuity',
      '@qf-jarvis/riya-conversation-evolution',
      'zod',
    ]);
    expect(manifest.devDependencies).toBeUndefined();
  });

  it('reads no environment and starts nothing on import', () => {
    for (const { file, code } of productionFiles()) {
      expect(code, file).not.toContain('process.env');
    }
    // Importing the barrel opened no connection, bound no port and registered no exporter. The only
    // way anything happens in this package is that somebody constructs a service and hands it a turn.
    expect(Object.keys(barrel).length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// 3. Structure: the gate is internal, and it runs FIRST.
// ---------------------------------------------------------------------------

describe('the admission gate is internal and precedes every resource', () => {
  it('is not re-exported, so no caller can hand this process capacity it does not have', () => {
    for (const forbidden of [
      'createTextTurnAdmission',
      'isValidTextTurnCapacity',
      'TextTurnAdmission',
      'ReleaseTextTurnSlot',
      'MAX_CONCURRENT_TEXT_TURNS',
      'MIN_CONCURRENT_TEXT_TURNS',
    ]) {
      expect(Object.keys(barrel)).not.toContain(forbidden);
    }
    const index = codeOnly(readFileSync(join(SRC, 'index.ts'), 'utf8'));
    expect(index).not.toContain('text-turn-admission');
  });

  it('acquires a slot BEFORE the coordinator, and therefore before every resource behind it', () => {
    // Ordering as a structural fact, not only as a behavioural one. Admission after `begin` would
    // still shed load and still pass most of the load specs -- and would already have taken the
    // dedicated PostgreSQL session that is the entire thing the cap exists to bound.
    //
    // The wrapper is read on its own rather than by position in the file, because textual order in a
    // module says nothing about execution order: `admittedChannelTurn` is DECLARED after the wrapper
    // and CALLED from inside it.
    const code = serviceCode();
    const wrapper = code.slice(
      code.indexOf('async function handleChannelTurn('),
      code.indexOf('async function admittedChannelTurn('),
    );
    expect(wrapper.length).toBeGreaterThan(100);

    const acquire = wrapper.indexOf('admission.tryAcquire()');
    const delegate = wrapper.indexOf('await admittedChannelTurn(');
    expect(acquire).toBeGreaterThan(-1);
    expect(delegate).toBeGreaterThan(acquire);

    // And the wrapper itself touches NOTHING else. Every resource the cap protects is reachable only
    // through the delegation below the gate.
    for (const forbidden of [
      'turnCoordinator.begin(',
      'continuityStore.',
      'availabilityReader.',
      'lease.',
      'runtime.',
    ]) {
      expect(wrapper, `the admission wrapper must not reach ${forbidden}`).not.toContain(forbidden);
    }
    // Sanity: those calls DO exist, below the gate. A rename that quietly removed one would otherwise
    // make the assertion above pass by vacuity.
    for (const required of [
      'turnCoordinator.begin(',
      'continuityStore.load(',
      'availabilityReader.readCurrent(',
      'lease.startProcessing()',
    ]) {
      expect(code, `${required} must still exist below the gate`).toContain(required);
    }
  });

  it('there is exactly one acquisition site and exactly one release site', () => {
    // Two acquisition sites would double-count a turn; two release sites would throw on the second.
    const code = serviceCode();
    expect(code.split('admission.tryAcquire()').length - 1).toBe(1);
    expect(code.split('release();').length - 1).toBe(1);
    // And the single release is in a `finally`, which is what makes "every path" true rather than
    // "every path somebody remembered".
    expect(code).toMatch(/\}\s*finally\s*\{[^}]*release\(\);/u);
  });

  it('the gate is never consulted for a decision other than admission', () => {
    // `active()` and `max()` are gauges. If either appeared in a conditional, capacity would have
    // started influencing what a turn DOES, and the gate would have become a business authority.
    const code = serviceCode();
    for (const match of code.matchAll(/admission\.(active|max)\(\)/gu)) {
      const line = code.slice(0, match.index).split('\n').length;
      const text = code.split('\n')[line - 1] ?? '';
      expect(text.trim(), 'a gauge may only be reported, never branched on').toMatch(
        /^(activeTurns|maxConcurrentTurns):/u,
      );
    }
  });
});
