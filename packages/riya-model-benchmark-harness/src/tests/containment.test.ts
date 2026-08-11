/**
 * RMB-B containment — the harness runs nothing real, and cannot.
 *
 * ### The load-bearing one
 *
 * A benchmark harness is the package most likely to be handed "just add the provider SDK, it is only
 * for measurement". Once it can call a provider it can call one in CI, it needs credentials, and the
 * serving path acquires a second caller that nobody reviews as a caller. So the capability is absent:
 * execution happens only through an injected port, and every target in this package is a fake.
 *
 * ### The second is that the serving waist is untouched
 *
 * A real adapter belongs behind the target port in a later slice — NOT in `model-gateway`, which
 * serves customers. This spec proves the harness names no gateway invoke path, so nobody can satisfy a
 * future requirement by threading a TTFT callback through production.
 *
 * Scans read production source with comments stripped, because this package documents at length the
 * things it refuses to be.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import * as barrel from '../index.js';
import * as testingBarrel from '../testing/index.js';

const SRC = fileURLToPath(new URL('../', import.meta.url));
const PKG = fileURLToPath(new URL('../../', import.meta.url));
const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));

const NOT_SOURCE = new Set(['node_modules', 'dist', '.next', 'coverage', '.turbo']);

function walk(dir: string, skipTests: boolean): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (NOT_SOURCE.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (skipTests && entry === 'tests') continue;
      out.push(...walk(full, skipTests));
    } else if (entry.endsWith('.ts')) {
      out.push(full);
    }
  }
  return out;
}

const codeOnly = (text: string): string =>
  text
    .replace(/\/\*[\s\S]*?\*\//gu, '')
    .split('\n')
    .filter((line) => !/^\s*\/\//u.test(line))
    .join('\n');

const productionFiles = (): readonly { readonly file: string; readonly code: string }[] =>
  walk(SRC, true).map((file) => ({ file, code: codeOnly(readFileSync(file, 'utf8')) }));

describe('the harness cannot call anything real', () => {
  it('performs no network call', () => {
    for (const { file, code } of productionFiles()) {
      for (const forbidden of [
        'fetch(',
        'node:http',
        'node:https',
        'node:net',
        'undici',
        'axios',
        'WebSocket',
        'XMLHttpRequest',
        'EventSource',
      ]) {
        expect(code, `${file} must not name ${forbidden}`).not.toContain(forbidden);
      }
    }
  });

  it('names no provider SDK, gateway, inference engine or model runtime', () => {
    for (const { file, code } of productionFiles()) {
      for (const forbidden of [
        /\bmodel-gateway\b/u,
        /\bmodel-reply-adapter\b/u,
        /\bjarvis-runtime\b/u,
        /\bagent-runtime\b/u,
        /\briya-model-interaction\b/u,
        /\briya-web-conversation-service\b/u,
        /\bprompt-registry\b/u,
        /\bgoverned-knowledge\b/u,
        /\bgroq\b/iu,
        /\bfireworks\b/iu,
        /\bopenai\b/iu,
        /\banthropic\b/iu,
        /\bollama\b/iu,
        /\bvllm\b/iu,
        /\bllama\.cpp\b/iu,
        /\btensorrt\b/iu,
        /\bhuggingface\b/iu,
        /\btransformers\b/iu,
        /\bmlx\b/iu,
        /\bn8n\b/iu,
      ]) {
        expect(forbidden.test(code), `${file} must not match ${String(forbidden)}`).toBe(false);
      }
    }
  });

  it('reads no environment, no filesystem and spawns no process', () => {
    for (const { file, code } of productionFiles()) {
      for (const forbidden of [
        'process.env',
        'process.argv',
        'node:fs',
        'readFileSync',
        'readdirSync',
        'node:child_process',
        'execSync',
        'spawn(',
        'node:os',
        'hostname',
        'cpus(',
      ]) {
        expect(code, `${file} must not name ${forbidden}`).not.toContain(forbidden);
      }
    }
  });

  it('reads NO ambient clock — every instant comes through the port', () => {
    // A harness that could read the wall clock would produce numbers that differ between machines and
    // a `createdAt` derived from elapsed time.
    for (const { file, code } of productionFiles()) {
      for (const forbidden of [
        'Date.now',
        'new Date(',
        'performance.now',
        'process.hrtime',
        'Math.random',
      ]) {
        expect(code, `${file} must not name ${forbidden}`).not.toContain(forbidden);
      }
    }
  });

  it('sleeps, waits and retries NOWHERE', () => {
    // A sleep would put harness time inside the measured window; a retry would measure a retry policy.
    for (const { file, code } of productionFiles()) {
      for (const forbidden of [
        'setTimeout',
        'setInterval',
        'sleep(',
        'backoff',
        'retry',
        'delay(',
      ]) {
        expect(code.toLowerCase(), `${file} must not name ${forbidden}`).not.toContain(
          forbidden.toLowerCase(),
        );
      }
    }
  });

  it('names no training framework and no database', () => {
    for (const { file, code } of productionFiles()) {
      for (const forbidden of [
        /\bpytorch\b/iu,
        /\bcuda\b/iu,
        /\bqlora\b/iu,
        /\btokenizer\b/iu,
        /\bfine[_-]?tune\b/iu,
        /\bembedding/iu,
        /\bmigration\b/iu,
        /\bpostgres\b/iu,
      ]) {
        expect(forbidden.test(code), `${file} must not match ${String(forbidden)}`).toBe(false);
      }
    }
    const migrations = readdirSync(
      join(REPO_ROOT, 'packages/event-backbone/src/persistence/migrations'),
    ).filter((name) => name.endsWith('.sql'));
    expect(migrations).toHaveLength(12);
    expect(migrations.some((name) => name.startsWith('0013'))).toBe(false);
  });

  it('has NO dependency on Human Gold, P10 or QuickFurno', () => {
    for (const { file, code } of productionFiles()) {
      for (const forbidden of [
        'riya-intelligence-dataset',
        'riya-quality-evaluation',
        'gold-v1',
        'HUMAN_AUTHORED',
        'GOLDEN_FIXTURES',
        'quickfurno',
        'onedecore',
      ]) {
        expect(code.toLowerCase(), `${file} must not name ${forbidden}`).not.toContain(
          forbidden.toLowerCase(),
        );
      }
    }
  });

  it('depends on exactly two packages, and RMB-A is one of them', () => {
    const manifest = JSON.parse(readFileSync(join(PKG, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
      exports?: Record<string, unknown>;
    };
    expect(Object.keys(manifest.dependencies ?? {}).sort()).toStrictEqual([
      '@qf-jarvis/riya-model-benchmark',
      'zod',
    ]);
    expect(manifest.devDependencies).toBeUndefined();
    expect(Object.keys(manifest.exports ?? {}).sort()).toStrictEqual(['.', './testing']);
  });

  it('is imported by no runtime, service or application', () => {
    // RAW source, deliberately: a regex comment stripper is not a TypeScript lexer, and a false
    // negative at an import firewall is the expensive direction.
    const importers: string[] = [];
    for (const root of [join(REPO_ROOT, 'packages'), join(REPO_ROOT, 'apps')]) {
      for (const entry of readdirSync(root)) {
        if (entry === 'riya-model-benchmark-harness') continue;
        let files: string[];
        try {
          files = walk(join(root, entry, 'src'), false);
        } catch {
          continue;
        }
        for (const file of files) {
          if (readFileSync(file, 'utf8').includes('@qf-jarvis/riya-model-benchmark-harness')) {
            importers.push(file);
          }
        }
      }
    }
    expect(importers).toStrictEqual([]);
  });

  it('THE SERVING WAIST IS UNTOUCHED — no benchmark concept reached the model gateway', () => {
    // The temptation a future slice will feel is to thread a TTFT callback or a memory probe through
    // production so the harness can observe a real call. That would put benchmark instrumentation on
    // the path that serves customers.
    for (const gateway of ['model-gateway', 'model-gateway-composition']) {
      for (const file of walk(join(REPO_ROOT, 'packages', gateway, 'src'), false)) {
        const source = readFileSync(file, 'utf8');
        for (const forbidden of [
          'riya-model-benchmark',
          'onFirstOutput',
          'benchmarkSuite',
          'measuredWindow',
          'workloadCase',
          'MemoryProbe',
        ]) {
          expect(source, `${file} must not name ${forbidden}`).not.toContain(forbidden);
        }
      }
    }
  });
});

describe('the public surface is small and free of verdicts', () => {
  it('exports exactly the approved symbols', () => {
    expect(Object.keys(barrel).sort()).toStrictEqual([
      'RIYA_BENCHMARK_HARNESS_IMPLEMENTATION_ID',
      'RIYA_BENCHMARK_HARNESS_IMPLEMENTATION_VERSION',
      'RIYA_BENCHMARK_HARNESS_SUPPORTED_BATCH_SIZE',
      'RIYA_BENCHMARK_MEASUREMENT_POLICY_REF',
      'RIYA_HARNESS_ERROR_CODES',
      'RiyaHarnessError',
      'createRiyaBenchmarkSuitePlan',
      'riyaBenchmarkWorkloadForCase',
      'runRiyaBenchmarkSuite',
    ]);
  });

  it('exports no scheduler internal, and no fake', () => {
    for (const forbidden of [
      'runPhase',
      'executeRequest',
      'MonotonicReader',
      'observationFor',
      'nearestRankPercentile',
      'FakeTarget',
      'ManualClock',
      'FakeMemoryProbe',
    ]) {
      expect(Object.keys(barrel), forbidden).not.toContain(forbidden);
    }
  });

  it('exports nothing that reads as a verdict, a score or an approval', () => {
    for (const key of Object.keys(barrel)) {
      const upper = key.toUpperCase();
      for (const forbidden of [
        'SCORE',
        'RANK',
        'WINNER',
        'BEST',
        'RECOMMEND',
        'APPROV',
        'VERDICT',
      ]) {
        expect(upper, `${key} must not contain ${forbidden}`).not.toContain(forbidden);
      }
    }
  });

  it('the testing subpath owns the fakes, and nothing else', () => {
    expect(Object.keys(testingBarrel).sort()).toStrictEqual([
      'FakeMemoryProbe',
      'FakeTarget',
      'ManualClock',
      'SYNTHETIC_HARNESS_INSTANT',
      'fakeHostedTarget',
    ]);
  });

  it('every error code is closed, and the class carries no measured value', () => {
    expect(barrel.RIYA_HARNESS_ERROR_CODES).toHaveLength(12);
    const error = new barrel.RiyaHarnessError('CLOCK_INVALID');
    expect(error.code).toBe('CLOCK_INVALID');
    expect(error.message).toBe('CLOCK_INVALID');
  });

  it('reimplements no digest, manifest or comparison logic', () => {
    // RMB-A is the evidence authority. A second digest here would be a second answer to "is this the
    // same artifact", and the two would eventually disagree.
    for (const { file, code } of productionFiles()) {
      for (const forbidden of [
        'createHash',
        'node:crypto',
        'sha256',
        'evidenceDigest =',
        'manifestDigest =',
        'resultSetDigest =',
        'canonicalize',
      ]) {
        expect(code, `${file} must not name ${forbidden}`).not.toContain(forbidden);
      }
    }
  });

  it('names no real or candidate model', () => {
    // No model has been chosen, and naming one here would pre-empt the measurement that chooses it.
    for (const { file, code } of productionFiles()) {
      for (const model of ['qwen', 'llama', 'mistral', 'gemma', 'deepseek', 'phi-3', 'gpt-']) {
        expect(code.toLowerCase(), `${file} must not name ${model}`).not.toContain(model);
      }
    }
  });
});
