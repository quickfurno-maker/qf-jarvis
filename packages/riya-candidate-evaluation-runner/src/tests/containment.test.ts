/**
 * Containment — the bridge is offline, one-way, and invisible to production.
 *
 * ### The load-bearing one
 *
 * This package exists to run candidates. It is therefore the package most likely to be handed "just
 * import the Groq provider, it is only for evaluation" — and once it can reach a provider, so can
 * anything that imports it. So the capability is absent: execution happens only through an injected
 * port, and every candidate here is a fake.
 *
 * ### The second is direction
 *
 * The bridge depends on the two evaluation authorities. Neither depends on the bridge, and no runtime,
 * service or app imports it at all. An evaluator that could reach a provider is one that eventually
 * will, under a deadline, with the best of intentions.
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

describe('the bridge can reach nothing real', () => {
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
        'api.groq.com',
        'Authorization',
      ]) {
        expect(code, `${file} must not name ${forbidden}`).not.toContain(forbidden);
      }
    }
  });

  it('names no provider, gateway, credential or inference engine', () => {
    for (const { file, code } of productionFiles()) {
      for (const forbidden of [
        /\bmodel-gateway\b/u,
        /\bgroq\b/iu,
        /\bopenai\b/iu,
        /\banthropic\b/iu,
        /\bfireworks\b/iu,
        /\bollama\b/iu,
        /\bvllm\b/iu,
        /\bapiKey\b/iu,
        /\bcredential\b/iu,
        /\bsecretRef\b/iu,
        /\bbackoff\b/iu,
      ]) {
        expect(forbidden.test(code), `${file} must not match ${String(forbidden)}`).toBe(false);
      }
    }
  });

  it('reads no environment and spawns no process', () => {
    for (const { file, code } of productionFiles()) {
      for (const forbidden of [
        'process.env',
        'process.argv',
        'node:child_process',
        'execSync',
        'spawn(',
        'node:os',
        'hostname',
      ]) {
        expect(code, `${file} must not name ${forbidden}`).not.toContain(forbidden);
      }
    }
  });

  it('touches the filesystem in exactly ONE place, and only to write outside the repo', () => {
    const readers = productionFiles().filter(({ code }) => code.includes('node:fs'));
    expect(readers.map(({ file }) => file.replace(SRC, '').replace(/\\/gu, '/'))).toStrictEqual([
      'quality/write-bundle.ts',
    ]);
  });

  it('names no training framework, database or migration', () => {
    for (const { file, code } of productionFiles()) {
      for (const forbidden of [
        /\bpostgres\b/iu,
        /\bsupabase\b/iu,
        /\bmigration\b/iu,
        /\bpytorch\b/iu,
        /\bqlora\b/iu,
        /\bfine[_-]?tune\b/iu,
        /\bembedding/iu,
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

  it('has NO dependency on Human Gold, WhatsApp or QuickFurno', () => {
    for (const { file, code } of productionFiles()) {
      for (const forbidden of [
        'riya-intelligence-dataset',
        'gold-v1',
        'HUMAN_AUTHORED',
        'whatsapp',
        'quickfurno',
        'onedecore',
      ]) {
        expect(code.toLowerCase(), `${file} must not name ${forbidden}`).not.toContain(
          forbidden.toLowerCase(),
        );
      }
    }
  });

  it('mentions n8n ONLY as the authority red-team kind, never as an integration', () => {
    // `DIRECT_BUSINESS_OR_N8N_EXECUTION` is `@qf-jarvis/model-evaluation`'s own vocabulary, and a
    // fixture has to name the kind it covers. What must not exist is a way to reach the thing.
    for (const { file, code } of productionFiles()) {
      for (const line of code.split(String.fromCharCode(10))) {
        if (!line.toLowerCase().includes('n8n')) {
          continue;
        }
        expect(line, `may only name n8n as the red-team kind: ${file}`).toContain(
          'DIRECT_BUSINESS_OR_N8N_EXECUTION',
        );
      }
    }
  });

  it('depends on exactly the two authorities plus the two Riya contract packages', () => {
    const manifest = JSON.parse(readFileSync(join(PKG, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
      exports?: Record<string, unknown>;
    };
    expect(Object.keys(manifest.dependencies ?? {}).sort()).toStrictEqual([
      '@qf-jarvis/model-evaluation',
      '@qf-jarvis/riya-conversation-continuity',
      '@qf-jarvis/riya-conversation-evolution',
      '@qf-jarvis/riya-quality-evaluation',
    ]);
    expect(manifest.devDependencies).toBeUndefined();
    expect(Object.keys(manifest.exports ?? {}).sort()).toStrictEqual(['.', './testing']);
  });

  it('NO PRODUCTION RUNTIME, SERVICE OR APP IMPORTS THE BRIDGE', () => {
    // RAW source, deliberately: a regex comment stripper is not a TypeScript lexer, and a false
    // negative at an import firewall is the expensive direction.
    const importers: string[] = [];
    for (const root of [join(REPO_ROOT, 'packages'), join(REPO_ROOT, 'apps')]) {
      for (const entry of readdirSync(root)) {
        if (entry === 'riya-candidate-evaluation-runner') continue;
        let files: string[];
        try {
          files = walk(join(root, entry, 'src'), false);
        } catch {
          continue;
        }
        for (const file of files) {
          if (readFileSync(file, 'utf8').includes('@qf-jarvis/riya-candidate-evaluation-runner')) {
            importers.push(file);
          }
        }
      }
    }
    expect(importers).toStrictEqual([]);
  });

  it('the two authorities do not depend on the bridge', () => {
    for (const authority of ['model-evaluation', 'riya-quality-evaluation']) {
      const manifest = JSON.parse(
        readFileSync(join(REPO_ROOT, 'packages', authority, 'package.json'), 'utf8'),
      ) as { dependencies?: Record<string, string> };
      expect(Object.keys(manifest.dependencies ?? {})).not.toContain(
        '@qf-jarvis/riya-candidate-evaluation-runner',
      );
    }
  });

  it('imports NO benchmark package — operational evidence comes after both gates', () => {
    for (const { file, code } of productionFiles()) {
      expect(code, file).not.toContain('riya-model-benchmark');
    }
  });

  it('reimplements no evaluation or threshold logic', () => {
    for (const { file, code } of productionFiles()) {
      for (const forbidden of ['passRate', 'basisPoints', 'thresholdBreach']) {
        expect(code, `${file} must not name ${forbidden}`).not.toContain(forbidden);
      }
    }
  });

  it('HASHES IN EXACTLY ONE FILE, AND ONLY TO BIND A REVIEW TO ITS REPLY', () => {
    // The original lock forbade hashing outright, because an evidence digest belongs to the
    // authorities. It is restated rather than dropped: the review-case digest is CONTENT IDENTITY for
    // human review binding, not an artifact identity and not evidence, and it lives in one file.
    // No digest here enters an observation, a suite result or any evidence record.
    const hashers = productionFiles().filter(
      ({ code }) => code.includes('node:crypto') || code.includes('createHash'),
    );
    expect(hashers.map(({ file }) => file.replace(SRC, '').replace(/\\/gu, '/'))).toStrictEqual([
      'quality/case-digest.ts',
    ]);
  });
});

describe('the public surface is small and free of verdicts', () => {
  it('exports no scheduler internal and no fake', () => {
    for (const forbidden of ['FakeSafetyCandidate', 'FakeQualityCandidate', 'safeDefault']) {
      expect(Object.keys(barrel), forbidden).not.toContain(forbidden);
    }
  });

  it('the testing subpath owns the fakes, and nothing else', () => {
    expect(Object.keys(testingBarrel).sort()).toStrictEqual([
      'FakeQualityCandidate',
      'FakeSafetyCandidate',
    ]);
  });

  it('exports nothing that reads as a score, a verdict or an approval', () => {
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

  it('DOES NOT USE THE AUTHORITY TEST ORACLES AS EVIDENCE', () => {
    // `safeObservationFor()` and `failingObservationFor()` manufacture observations for the
    // evaluator's own unit tests. Using one here would mean certifying a candidate against a value
    // nobody measured.
    for (const { file, code } of productionFiles()) {
      expect(code, file).not.toContain('safeObservationFor');
      expect(code, file).not.toContain('failingObservationFor');
      expect(code, file).not.toContain('@qf-jarvis/model-evaluation/testing');
    }
  });

  it('names no real or candidate model', () => {
    for (const { file, code } of productionFiles()) {
      for (const model of ['qwen', 'llama', 'mistral', 'gemma', 'deepseek', 'gpt-']) {
        expect(code.toLowerCase(), `${file} must not name ${model}`).not.toContain(model);
      }
    }
  });
});
