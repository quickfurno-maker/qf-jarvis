/**
 * AS2 containment — the generator reaches nothing, and nothing reaches the generator (ADR-0143).
 *
 * ### The load-bearing one is that no serving path can import this package
 *
 * A runtime that could reach the generator is a path by which a live conversation could become
 * training data. The direction has to be one-way as a checked fact, not as an intention, because the
 * import that breaks it will look reasonable on the day somebody adds it.
 *
 * ### The second is that the protected exam is unreachable from here
 *
 * ADR-0143 §7. The exam reaches the AS1 VALIDATOR after a candidate exists. Nothing in generation may
 * import a fixture, name a fixture id, or read the protected index — and notably, we do NOT hand the
 * exam to a model so it can "avoid matching it", which would put the exam in the prompt.
 *
 * Scans read production source with comments stripped, because this package documents at length the
 * things it refuses to be.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import * as datasetRoot from '@qf-jarvis/riya-intelligence-dataset';
import * as datasetAiSynthetic from '@qf-jarvis/riya-intelligence-dataset/ai-synthetic';

import * as barrel from '../index.js';

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

/**
 * Read a file that another suite may delete underneath us.
 *
 * Several suites in this repo write short-lived probe files while these walkers are running, so a
 * path can vanish between `readdir` and `readFileSync`. A file that no longer exists cannot be
 * importing anything, so skipping it is correct rather than lenient -- and it keeps a containment
 * failure meaning "somebody imported this", never "two suites raced".
 */
const readIfPresent = (file: string): string => {
  try {
    return readFileSync(file, 'utf8');
  } catch {
    return '';
  }
};

const codeOnly = (text: string): string =>
  text
    .replace(/\/\*[\s\S]*?\*\//gu, '')
    .split('\n')
    .filter((line) => !/^\s*\/\//u.test(line))
    .join('\n');

const relativeOf = (file: string): string => file.replaceAll('\\', '/').split('/src/')[1] ?? file;

const productionFiles = (): readonly {
  readonly file: string;
  readonly relative: string;
  readonly code: string;
}[] =>
  walk(SRC, true).map((file) => ({
    file,
    relative: relativeOf(file),
    code: codeOnly(readFileSync(file, 'utf8')),
  }));

// ---------------------------------------------------------------------------
// 1. Nothing imports it.
// ---------------------------------------------------------------------------

describe('no runtime, application or serving path can reach the generator', () => {
  it('is imported by nothing outside itself', () => {
    const importers: string[] = [];
    for (const area of ['apps', 'packages']) {
      const root = join(REPO_ROOT, area);
      for (const file of walk(root, false)) {
        const relative = file.replaceAll('\\', '/');
        if (relative.includes('/riya-ai-synthetic-generation/')) continue;
        if (readIfPresent(file).includes('@qf-jarvis/riya-ai-synthetic-generation')) {
          importers.push(relative);
        }
      }
    }

    expect(importers).toStrictEqual([]);
  });

  it('is not imported by apps/api, named explicitly', () => {
    // The other half of the two-sided firewall. The dataset package now permits exactly ONE external
    // importer -- this harness -- so the guarantee "no runtime can reach training data" rests on this
    // package being unreachable from every app. apps/api is named rather than merely swept, because
    // it is the app that would reach for it first.
    for (const file of walk(join(REPO_ROOT, 'apps', 'api', 'src'), false)) {
      expect(readIfPresent(file).includes('@qf-jarvis/riya-ai-synthetic-generation'), file).toBe(
        false,
      );
    }
  });

  it('proves the canonical trajectory digests live on the subpath, not the dataset root', () => {
    // AS2 needs these to build acceptance evidence. They are exported from ./ai-synthetic and NOT
    // from the dataset root, whose surface deliberately exposes no digest helper.
    expect(Object.keys(datasetAiSynthetic)).toContain('trajectoryArtifactSha256');
    expect(Object.keys(datasetAiSynthetic)).toContain('trajectoryConversationFingerprint');
    expect(Object.keys(datasetRoot)).not.toContain('trajectoryArtifactSha256');
    expect(Object.keys(datasetRoot)).not.toContain('trajectoryConversationFingerprint');
  });

  it('reimplements no trajectory digest of its own', () => {
    // A second notion of trajectory identity would drift, and on the day it did the validator would
    // recompute a digest this harness could never match -- every candidate failing for a reason
    // nothing could explain.
    for (const { file, relative, code } of productionFiles()) {
      if (relative === 'internal/digest.ts') continue;
      expect(code, `${file} must not hash directly`).not.toContain('createHash');
    }
    const orchestrator = readFileSync(join(SRC, 'service', 'generate-candidate.ts'), 'utf8');
    expect(orchestrator).toContain('trajectoryArtifactSha256');
    expect(orchestrator).toContain('trajectoryConversationFingerprint');
  });

  it('keeps its own digest helper generic, with no trajectory identity in it', () => {
    // `internal/digest.ts` exists for input, config and plan digests. It must not grow a notion of
    // what a trajectory IS -- that lives in the dataset package, and one canonical answer is the
    // whole point.
    const digest = readFileSync(join(SRC, 'internal', 'digest.ts'), 'utf8').toLowerCase();

    expect(digest).not.toContain('trajectory');
    expect(digest).not.toContain('fingerprint');
    expect(digest).not.toContain('conversation');
  });

  it('adds no migration', () => {
    for (const { file, code } of productionFiles()) {
      expect(code, `${file} must not name a migration`).not.toContain('migration');
    }
  });
});

// ---------------------------------------------------------------------------
// 2. No provider network code, no credential.
// ---------------------------------------------------------------------------

describe('AS2 ships the port and deterministic fakes, and no provider network code', () => {
  it('names no provider SDK, gateway or inference client', () => {
    // GPT and Claude are inventory DATA. Production source must not know either exists -- that is
    // exactly what makes the harness provider-independent rather than provider-agnostic in comment
    // form only.
    for (const { file, code } of productionFiles()) {
      for (const forbidden of [
        'openai',
        'OpenAI',
        'anthropic',
        'Anthropic',
        'groq',
        'Groq',
        'ollama',
        'huggingface',
        'model-gateway',
        'jarvis-runtime',
        'agent-runtime',
        'riya-model-interaction',
        'riya-web-conversation-service',
        'prompt-registry',
        'governed-knowledge',
      ]) {
        expect(code, `${file} must not name ${forbidden}`).not.toContain(forbidden);
      }
    }
  });

  it('performs no HTTP and reads no environment', () => {
    for (const { file, code } of productionFiles()) {
      for (const forbidden of [
        'fetch(',
        'node:http',
        'undici',
        'axios',
        'WebSocket',
        'process.env',
        'Pool',
      ]) {
        expect(code, `${file} must not name ${forbidden}`).not.toContain(forbidden);
      }
    }
  });

  it('holds no credential literal and prints nothing', () => {
    for (const { file, code } of productionFiles()) {
      for (const forbidden of [
        'OPENAI_API_KEY',
        'ANTHROPIC_API_KEY',
        'Bearer ',
        'console.log',
        'console.error',
      ]) {
        expect(code, `${file} must not name ${forbidden}`).not.toContain(forbidden);
      }
      expect(/\bsk-[A-Za-z0-9]{8,}/u.test(code), file).toBe(false);
    }
  });

  it('uses node:crypto in ONE file, and only for SHA-256', () => {
    const users = productionFiles().filter(({ code }) => code.includes('node:crypto'));

    expect(users.map(({ relative }) => relative)).toStrictEqual(['internal/digest.ts']);
    const source = users[0]?.code ?? '';
    expect(source).toContain("createHash('sha256')");
    for (const forbidden of ['randomBytes', 'randomUUID', 'createCipheriv', 'privateEncrypt']) {
      expect(source, forbidden).not.toContain(forbidden);
    }
  });

  it('reads no clock and no randomness', () => {
    // Determinism is what "the same plan produces the same schedule" rests on, and it is why
    // timestamps are injected rather than read.
    for (const { file, code } of productionFiles()) {
      for (const forbidden of ['Date.now', 'new Date(', 'Math.random', 'crypto.randomUUID']) {
        expect(code, `${file} must not name ${forbidden}`).not.toContain(forbidden);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// 3. The protected exam is unreachable, and so is live data.
// ---------------------------------------------------------------------------

describe('the protected exam never reaches a generator or a critic', () => {
  it('imports no protected fixture, golden corpus or testing subpath', () => {
    for (const { file, code } of productionFiles()) {
      for (const forbidden of [
        'riya.p10.',
        'RIYA_QUALITY_GOLDEN_FIXTURES',
        'syntheticUserText',
        '/testing',
        'protectedIndex',
        'createProtectedTextIndex',
        'model-evaluation',
      ]) {
        expect(code, `${file} must not name ${forbidden}`).not.toContain(forbidden);
      }
    }
  });

  it('exposes no role input field a protected corpus could travel in', () => {
    // The strongest way to say the exam cannot reach a model is to show there is nowhere to put it.
    const roleInput = readFileSync(join(SRC, 'contracts', 'role-input.ts'), 'utf8');
    for (const forbidden of ['protected', 'golden', 'exam', 'fixture']) {
      expect(codeOnly(roleInput).toLowerCase(), forbidden).not.toContain(forbidden);
    }
  });

  it('has no live-data input surface', () => {
    for (const { file, code } of productionFiles()) {
      for (const forbidden of [
        'LIVE_CHAT',
        'WHATSAPP_EXPORT',
        'CRM_EXPORT',
        'PRODUCTION_EXPORT',
        'REAL_CUSTOMER',
        'importConversations',
        'importTranscript',
      ]) {
        expect(code, `${file} must not name ${forbidden}`).not.toContain(forbidden);
      }
    }
  });

  it('contains no contact detail or production URL', () => {
    for (const { file, code } of productionFiles()) {
      expect(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/u.test(code), file).toBe(false);
      expect(/\bhttps?:\/\/(?!json\.schemastore\.org)/u.test(code), file).toBe(false);
      expect(/\+91[0-9]{10}/u.test(code), file).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// 4. No training, and no corpus.
// ---------------------------------------------------------------------------

describe('AS2 trains nothing and commits no corpus', () => {
  it('names no training framework, optimizer or checkpoint', () => {
    for (const { file, code } of productionFiles()) {
      for (const forbidden of [
        /\bpytorch\b/iu,
        /\btorch\b/iu,
        /\bpeft\b/iu,
        /\bqlora\b/iu,
        /\blora\b/iu,
        /\btrl\b/iu,
        /\bcheckpoint\b/iu,
        /\bfine[_-]?tune\b/iu,
        /\boptimizer\b/iu,
        /\btrainingRun\b/iu,
        /\bstartTraining\b/iu,
      ]) {
        expect(forbidden.test(code), `${file} must not match ${String(forbidden)}`).toBe(false);
      }
    }
  });

  it('ships no data directory and no corpus artifact', () => {
    const entries = readdirSync(PKG);

    expect(entries).not.toContain('data');
    for (const entry of entries) {
      expect(entry.endsWith('.jsonl'), entry).toBe(false);
    }
  });

  it('offers no API for generating a whole conversation in one call', () => {
    // Turn-by-turn is the architecture, not a convention. A one-shot transcript API would script both
    // sides at once and leak the ending into the opening.
    for (const key of Object.keys(barrel)) {
      const upper = key.toUpperCase();
      expect(upper, key).not.toContain('CONVERSATION');
      expect(upper, key).not.toContain('TRANSCRIPT');
      expect(upper, key).not.toContain('GENERATECORPUS');
      expect(upper, key).not.toContain('GENERATEALL');
    }
  });
});

// ---------------------------------------------------------------------------
// 5. The public surface.
// ---------------------------------------------------------------------------

describe('the public surface is contracts, the port, the scheduler and the fakes', () => {
  it('exports no parser internal, digest helper or secret loader', () => {
    for (const forbidden of [
      'canonicalJson',
      'sha256Hex',
      'sha256OfCanonical',
      'canonicalize',
      'loadCredentials',
      'renderPayload',
    ]) {
      expect(Object.keys(barrel), forbidden).not.toContain(forbidden);
    }
  });

  it('exports exactly one subpath from the manifest', () => {
    const manifest = JSON.parse(readFileSync(join(PKG, 'package.json'), 'utf8')) as {
      exports?: Record<string, unknown>;
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };

    expect(Object.keys(manifest.exports ?? {})).toStrictEqual(['.']);
    expect(Object.keys(manifest.dependencies ?? {}).sort()).toStrictEqual([
      '@qf-jarvis/riya-conversation-continuity',
      '@qf-jarvis/riya-intelligence-dataset',
      'zod',
    ]);
    expect(manifest.devDependencies).toBeUndefined();
  });

  it('exposes no value carrying generated dialogue', () => {
    const serialized = JSON.stringify(Object.entries(barrel));
    for (const shape of ['"type":"USER"', '"type":"ASSISTANT"', 'turnRef', 'assistantText']) {
      expect(serialized, shape).not.toContain(shape);
    }
  });
});
