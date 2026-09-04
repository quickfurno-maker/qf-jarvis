/**
 * Containment: what this package may reach, and what may reach it.
 *
 * ### The direction that matters
 *
 * This is the first package in the repository that benchmarks a real model, and it is therefore the
 * one most likely to be handed "just point it at the hosted API too, it is only for measurement". That
 * request arrives reasonably. It ends with a credential in a benchmark package, a paid call in CI and
 * a second caller of the serving path that nobody reviews as a caller.
 *
 * So the capability is absent rather than discouraged, and these specs are what keep it absent.
 *
 * ### And the other direction
 *
 * Nothing that serves a customer may import this. A benchmark adapter reachable from a runtime is a
 * runtime that can be made to emit synthetic traffic, and the import is the only thing standing
 * between those two facts.
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

/** The one file allowed to open a socket. */
const TRANSPORT_FILE = join(SRC, 'service', 'loopback-transport.ts');

describe('it can reach a local engine, and nothing else', () => {
  it('opens a socket in EXACTLY ONE file', () => {
    // Every other module -- the target, the tokenizer, the registry, the CLI -- goes through the
    // transport port. Concentrating the capability is what makes the loopback rule provable at all.
    const openers = productionFiles().filter(({ code }) => code.includes('fetch('));
    expect(openers.map((one) => one.file)).toStrictEqual([TRANSPORT_FILE]);
  });

  it('names no provider SDK, hosted endpoint or paid model surface', () => {
    for (const { file, code } of productionFiles()) {
      for (const forbidden of [
        /from 'openai'/u,
        /@anthropic-ai/u,
        /\bnew OpenAI\b/u,
        /\bnew Anthropic\b/u,
        /openai\.com/iu,
        /anthropic\.com/iu,
        /\banthropic\b/iu,
        /\bgroq\b/iu,
        /\bfireworks\b/iu,
        /together\.ai/iu,
        /\bcompletions\.create\b/iu,
        /\bmessages\.create\b/iu,
      ]) {
        expect(forbidden.test(code), `${file} must not match ${String(forbidden)}`).toBe(false);
      }
    }
  });

  it('says "openai" in exactly one place, and it is the name of a wire PROTOCOL', () => {
    // The word cannot be banned outright: the surface this adapter speaks is genuinely called
    // OpenAI-compatible, and renaming it in our own source would obscure what a local engine must be
    // launched with. So the check is that every occurrence is that protocol ref -- a string describing
    // a request shape -- and never an SDK, a host or a client.
    const occurrences = productionFiles().flatMap(({ file, code }) =>
      code
        .split('\n')
        .filter((line) => /openai/iu.test(line))
        .map((line) => ({ file, line: line.trim() })),
    );
    expect(occurrences.length).toBeGreaterThan(0);
    for (const { file, line } of occurrences) {
      expect(line, file).toContain('openai-compatible-chat-completions');
    }
  });

  it('has NO credential surface at all', () => {
    // Absent, not unused. A header input would be the one field a future slice could fill with a
    // bearer token without changing a signature or a reviewer's mind.
    for (const { file, code } of productionFiles()) {
      for (const forbidden of [
        'apiKey',
        'api_key',
        'Authorization',
        'authorization',
        'Bearer',
        'x-api-key',
        'OPENAI_API_KEY',
        'ANTHROPIC_API_KEY',
        'HF_TOKEN',
        'process.env',
        'getEnv',
      ]) {
        expect(code, `${file} must not name ${forbidden}`).not.toContain(forbidden);
      }
    }
  });

  it('follows no redirect', () => {
    const transport = codeOnly(readFileSync(TRANSPORT_FILE, 'utf8'));
    expect(transport).toContain("redirect: 'manual'");
    expect(transport).not.toContain("redirect: 'follow'");
  });

  it('downloads nothing and runs nothing', () => {
    for (const { file, code } of productionFiles()) {
      for (const forbidden of [
        'node:child_process',
        'execSync',
        'spawn(',
        'huggingface',
        'hf_hub',
        'snapshot_download',
        'from_pretrained',
        'safetensors',
        '.gguf',
        'node:os',
        // The call, not the URL property: `url.hostname` is how the loopback check reads a host, and
        // `os.hostname()` is machine identity. Only the second may not appear.
        'hostname(',
        'cpus(',
        'networkInterfaces',
        'userInfo',
      ]) {
        expect(code, `${file} must not name ${forbidden}`).not.toContain(forbidden);
      }
    }
  });

  it('trains nothing and quantizes nothing', () => {
    for (const { file, code } of productionFiles()) {
      for (const forbidden of [
        /\blora\b/iu,
        /\bqlora\b/iu,
        /\bfine[_-]?tune\b/iu,
        /\bcheckpoint\b/iu,
        /\bquantiz/iu,
        /\bpytorch\b/iu,
        /\btrain(ing)?[_-]?(run|job|loop)\b/iu,
      ]) {
        expect(forbidden.test(code), `${file} must not match ${String(forbidden)}`).toBe(false);
      }
    }
  });

  it('names no database and adds no migration', () => {
    for (const { file, code } of productionFiles()) {
      for (const forbidden of [/\bpostgres\b/iu, /\bevent-backbone\b/iu, /\bmigration\b/iu]) {
        expect(forbidden.test(code), `${file} must not match ${String(forbidden)}`).toBe(false);
      }
    }
    const migrations = readdirSync(
      join(REPO_ROOT, 'packages/event-backbone/src/persistence/migrations'),
    ).filter((name) => name.endsWith('.sql'));
    expect(migrations).toHaveLength(13);
  });

  it('names no runtime, gateway or agent package', () => {
    for (const { file, code } of productionFiles()) {
      for (const forbidden of [
        'model-gateway',
        'model-reply-adapter',
        'jarvis-runtime',
        'agent-runtime',
        'riya-agent',
        'riya-model-interaction',
        'riya-web-conversation-service',
        'conversation-control',
        'whatsapp',
      ]) {
        expect(code.toLowerCase(), `${file} must not name ${forbidden}`).not.toContain(
          forbidden.toLowerCase(),
        );
      }
    }
  });

  it('names no AS3 provider adapter, generation harness or dataset package', () => {
    for (const { file, code } of productionFiles()) {
      for (const forbidden of [
        'riya-ai-synthetic-provider-adapters',
        'riya-ai-synthetic-generation',
        'riya-intelligence-dataset',
        'riya-quality-evaluation',
        'riya-candidate-evaluation-runner',
        'RIYA_AS3',
      ]) {
        expect(code, `${file} must not name ${forbidden}`).not.toContain(forbidden);
      }
    }
  });

  it('declares exactly three dependencies, and no dev dependency', () => {
    const manifest = JSON.parse(readFileSync(join(PKG, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
      exports?: Record<string, unknown>;
    };
    expect(Object.keys(manifest.dependencies ?? {}).sort()).toStrictEqual([
      '@qf-jarvis/riya-model-benchmark',
      '@qf-jarvis/riya-model-benchmark-harness',
      'zod',
    ]);
    expect(manifest.devDependencies).toBeUndefined();
    expect(Object.keys(manifest.exports ?? {}).sort()).toStrictEqual(['.', './testing']);
  });

  it('names no real or candidate model', () => {
    // No model has been chosen, and naming one here would pre-empt the measurement that chooses it --
    // and would be quoted as though a benchmark existed.
    for (const { file, code } of productionFiles()) {
      for (const model of [
        'qwen',
        'llama',
        'mistral',
        'gemma',
        'deepseek',
        'phi-3',
        'gpt-',
        'claude-',
        'minimax',
      ]) {
        expect(code.toLowerCase(), `${file} must not name ${model}`).not.toContain(model);
      }
    }
  });

  it('reimplements no RMB-A evidence identity', () => {
    // RMB-A is the evidence authority. This package hashes its own INPUTS -- prompt bytes, sampling,
    // runtime config -- and never an artifact.
    for (const { file, code } of productionFiles()) {
      for (const forbidden of [
        'evidenceDigest =',
        'manifestDigest =',
        'resultSetDigest =',
        'createRiyaBenchmarkEvidence',
        'createRiyaBenchmarkObservation',
        'createRiyaBenchmarkResultSet',
      ]) {
        expect(code, `${file} must not name ${forbidden}`).not.toContain(forbidden);
      }
    }
  });
});

describe('nothing that serves a customer may import it', () => {
  it('is imported by no runtime, service or application', () => {
    // RAW source, deliberately: `codeOnly` strips block comments with a regex, and a regex is not a
    // TypeScript lexer -- a false negative at an import firewall is the expensive direction.
    const importers: string[] = [];
    for (const root of [join(REPO_ROOT, 'packages'), join(REPO_ROOT, 'apps')]) {
      for (const entry of readdirSync(root)) {
        if (entry === 'riya-model-benchmark-local-adapter') continue;
        let files: string[];
        try {
          files = walk(join(root, entry, 'src'), false);
        } catch {
          continue;
        }
        for (const file of files) {
          if (
            readFileSync(file, 'utf8').includes('@qf-jarvis/riya-model-benchmark-local-adapter')
          ) {
            importers.push(file);
          }
        }
      }
    }
    expect(importers).toStrictEqual([]);
  });

  it('THE SERVING WAIST IS STILL UNTOUCHED', () => {
    // RMB-B proved the gateway named no benchmark concept, and said a real adapter belonged behind the
    // target port rather than in production. This is the slice that could have taken the shortcut, so
    // this is the spec that proves it did not.
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

  it('NEGATIVE CONTROL: the importer scan actually detects an importer', () => {
    // A scan that walks the wrong directory, or matches the wrong specifier, passes forever and proves
    // nothing. This runs the identical logic over a directory that DOES contain the specifier -- this
    // package's own source -- and requires it to be found.
    const found: string[] = [];
    for (const file of walk(join(PKG, 'src'), false)) {
      if (readFileSync(file, 'utf8').includes('@qf-jarvis/riya-model-benchmark-harness')) {
        found.push(file);
      }
    }
    expect(found.length).toBeGreaterThan(0);
  });
});

describe('the public surface is small and free of verdicts', () => {
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
        'SELECT',
      ]) {
        expect(upper, `${key} must not contain ${forbidden}`).not.toContain(forbidden);
      }
    }
  });

  it('exports no internal parser, decoder or digest helper', () => {
    for (const forbidden of [
      'RiyaLocalSseDecoder',
      'projectRiyaLocalEngineChunk',
      'projectRiyaLocalEngineModelIds',
      'sha256OfCanonical',
      'FakeEngineTransport',
      'FakeTokenizer',
    ]) {
      expect(Object.keys(barrel), forbidden).not.toContain(forbidden);
    }
  });

  it('the testing subpath owns the fakes, and nothing else', () => {
    expect(Object.keys(testingBarrel).sort()).toStrictEqual([
      'FAKE_STREAM_DONE',
      'FakeEngineTransport',
      'FakeTokenizer',
      'SYNTHETIC_LOCAL_BENCHMARK_INSTANT',
      'fakeHealthyStream',
      'fakeStreamChunk',
    ]);
  });

  it('every error code is closed, and the class carries no measured value', () => {
    expect(barrel.RIYA_LOCAL_BENCHMARK_ERROR_CODES).toHaveLength(17);
    const error = new barrel.RiyaLocalBenchmarkError('ENDPOINT_NOT_LOOPBACK');
    expect(error.code).toBe('ENDPOINT_NOT_LOOPBACK');
    expect(error.message).toBe('ENDPOINT_NOT_LOOPBACK');
    expect(error.cause).toBeUndefined();
  });

  it('exposes no memory probe, because it can measure none honestly', () => {
    // Process RSS is not VRAM, a model file size is not a working set, and a parameter count is not a
    // measurement. RMB-B makes the probe optional; supplying a fabricated one would be worse than
    // supplying none.
    for (const key of Object.keys(barrel)) {
      expect(key.toLowerCase(), key).not.toContain('memoryprobe');
    }
    for (const { file, code } of productionFiles()) {
      expect(code, `${file} must not name a memory probe`).not.toContain('memoryProbe');
    }
  });
});
