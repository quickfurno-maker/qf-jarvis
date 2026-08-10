/**
 * RID-F1 containment — this package trains nothing and reaches nothing (ADR-0107 §7, §31, §40, §41).
 *
 * ### The load-bearing one is that no runtime can import it
 *
 * A dataset package a runtime could reach is a runtime that could reach training data — and, worse,
 * a path by which a live conversation could be appended to a corpus. The direction has to be
 * one-way, and it has to be checked rather than intended.
 *
 * ### The second is that no training framework exists here
 *
 * Not "is not used" — is not present. The moment PyTorch or PEFT is a dependency, "the dataset gates
 * passed" and "a run started" become one step apart, and the separation this whole slice is built on
 * is a convention rather than a fact.
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

// ---------------------------------------------------------------------------
// 1. No model, no training, no I/O.
// ---------------------------------------------------------------------------

describe('RID-F1 invokes nothing and trains nothing', () => {
  it('names no model, provider, gateway or inference client', () => {
    for (const { file, code } of productionFiles()) {
      for (const forbidden of [
        'model-gateway',
        'model-reply-adapter',
        'jarvis-runtime',
        'agent-runtime',
        'riya-model-interaction',
        'riya-web-conversation-service',
        'prompt-registry',
        'governed-knowledge',
        'model-evaluation',
        'groq',
        'Groq',
        'openai',
        'OpenAI',
        'anthropic',
        'Anthropic',
        'ollama',
        'huggingface',
        'transformers',
      ]) {
        expect(code, `${file} must not name ${forbidden}`).not.toContain(forbidden);
      }
    }
  });

  it('names no training framework, checkpoint or run', () => {
    for (const { file, code } of productionFiles()) {
      for (const forbidden of [
        /\bpytorch\b/iu,
        /\btorch\b/iu,
        /\bcuda\b/iu,
        /\bpeft\b/iu,
        /\bqlora\b/iu,
        /\blora\b/iu,
        /\btrl\b/iu,
        /\bcheckpoint\b/iu,
        /\btokenizer\b/iu,
        /\bfine[_-]?tune\b/iu,
        /\btrainingRun\b/iu,
        /\bstartTraining\b/iu,
        /\bdpo\b/iu,
        /\bpreferencePair\b/iu,
      ]) {
        expect(forbidden.test(code), `${file} must not match ${String(forbidden)}`).toBe(false);
      }
    }
  });

  it('names no judge, embedding or vector search', () => {
    // The near-match firewall is token overlap on purpose: an embedding would make this package
    // invoke a model, and a probabilistic gate would be non-deterministic.
    for (const { file, code } of productionFiles()) {
      for (const forbidden of [
        /\bllm\b/iu,
        /\bjudge\b/iu,
        /\bembedding/iu,
        /\bvector\b/iu,
        /\bcosine\b/iu,
        /\bfaiss\b/iu,
        /\bpinecone\b/iu,
        /\brerank/iu,
      ]) {
        expect(forbidden.test(code), `${file} must not match ${String(forbidden)}`).toBe(false);
      }
    }
  });

  it('performs no HTTP, database, environment or filesystem access', () => {
    for (const { file, code } of productionFiles()) {
      for (const forbidden of [
        'fetch(',
        'node:http',
        'undici',
        'axios',
        'WebSocket',
        'n8n',
        'node:fs',
        'readFileSync',
        'writeFileSync',
        'process.env',
        'Pool',
        'migration',
      ]) {
        expect(code, `${file} must not name ${forbidden}`).not.toContain(forbidden);
      }
    }
  });

  it('uses node:crypto, and ONLY for SHA-256', () => {
    // The one intentional Node capability. A dataset identity has to survive being copied between
    // machines and cited months later, which a 32-bit-derived hash cannot promise.
    const users = productionFiles().filter(({ code }) => code.includes('node:crypto'));
    expect(users.map(({ file }) => file.replaceAll('\\', '/').split('/src/')[1])).toStrictEqual([
      'internal/sha256.ts',
    ]);
    const source = users[0]?.code ?? '';
    expect(source).toContain("createHash('sha256')");
    for (const forbidden of [
      'randomBytes',
      'randomUUID',
      'createCipheriv',
      'generateKeyPair',
      'sign(',
      'privateEncrypt',
    ]) {
      expect(source, forbidden).not.toContain(forbidden);
    }
  });

  it('reads no clock and no randomness', () => {
    // Determinism is what "the same dataset produces the same SHA on every machine" rests on.
    for (const { file, code } of productionFiles()) {
      for (const forbidden of ['Date.now', 'new Date(', 'Math.random', 'crypto.randomUUID']) {
        expect(code, `${file} must not name ${forbidden}`).not.toContain(forbidden);
      }
    }
  });

  it('contains no QuickFurno data, contact detail or production URL', () => {
    // ONE exemption, and it is the scanner itself: a firewall that rejects governed production names
    // has to know them. Every other file is held to the plain rule.
    const SCANNER = 'internal/privacy-scan.ts';
    for (const { file, code } of productionFiles()) {
      const relative = file.replaceAll('\\', '/').split('/src/')[1] ?? file;
      const forbidden =
        relative === SCANNER
          ? ['https://', 'http://', '@gmail', '@example.com']
          : ['quickfurno', 'onedecore', 'https://', 'http://', '@gmail', '@example.com'];
      for (const token of forbidden) {
        expect(code.toLowerCase(), `${file} must not name ${token}`).not.toContain(token);
      }
    }
  });

  it('the scanner names a production string ONLY as a detection pattern', () => {
    // The exemption above is only safe if the names appear in the reject list and nowhere else --
    // not in an example, a default value or a fixture.
    const scanner = productionFiles().find(({ file }) =>
      file.replaceAll('\\', '/').endsWith('internal/privacy-scan.ts'),
    );
    expect(scanner).toBeDefined();
    const lines = (scanner?.code ?? '')
      .split('\n')
      .filter((line) => /quickfurno|onedecore/iu.test(line));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('PRODUCTION_NAMES');
  });

  it('depends on exactly four packages', () => {
    const manifest = JSON.parse(readFileSync(join(PKG, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    expect(Object.keys(manifest.dependencies ?? {}).sort()).toStrictEqual([
      '@qf-jarvis/riya-conversation-continuity',
      '@qf-jarvis/riya-conversation-evolution',
      '@qf-jarvis/riya-quality-evaluation',
      'zod',
    ]);
    expect(manifest.devDependencies).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 2. Nothing imports it.
// ---------------------------------------------------------------------------

describe('no runtime, service or application can reach the dataset factory', () => {
  it('is imported by nothing outside itself', () => {
    // A runtime that could reach this is a runtime that could reach training data, and a path by
    // which a live conversation could be appended to a corpus.
    const importers: string[] = [];
    for (const root of [join(REPO_ROOT, 'packages'), join(REPO_ROOT, 'apps')]) {
      for (const entry of readdirSync(root)) {
        if (entry === 'riya-intelligence-dataset') continue;
        let files: string[];
        try {
          files = walk(join(root, entry, 'src'), false);
        } catch {
          continue;
        }
        for (const file of files) {
          if (readFileSync(file, 'utf8').includes('@qf-jarvis/riya-intelligence-dataset')) {
            importers.push(file);
          }
        }
      }
    }
    expect(importers).toStrictEqual([]);
  });

  it('adds no migration', () => {
    const migrations = readdirSync(
      join(REPO_ROOT, 'packages/event-backbone/src/persistence/migrations'),
    ).filter((name) => name.endsWith('.sql'));
    expect(migrations).toHaveLength(12);
    expect(migrations.some((name) => name.startsWith('0013'))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 3. The public surface.
// ---------------------------------------------------------------------------

describe('the root surface is vocabularies, factories and services', () => {
  it('exports exactly the approved runtime symbols', () => {
    expect(Object.keys(barrel).sort()).toStrictEqual([
      'RIYA_DATASET_ASSISTANT_DECISIONS',
      'RIYA_DATASET_BASELINE_REVIEW_DIMENSIONS',
      'RIYA_DATASET_CONTEXT_AUTHORITIES',
      'RIYA_DATASET_DIFFICULTIES',
      'RIYA_DATASET_DISCOVERY_FIELDS',
      'RIYA_DATASET_ERROR_CODES',
      'RIYA_DATASET_FACT_CLASSES',
      'RIYA_DATASET_INTERACTION_KINDS',
      'RIYA_DATASET_LANGUAGE_MODES',
      'RIYA_DATASET_MAX_ASSISTANT_TURNS',
      'RIYA_DATASET_MAX_TURNS',
      'RIYA_DATASET_OBJECTION_REVIEW_DIMENSIONS',
      'RIYA_DATASET_PERSONAS',
      'RIYA_DATASET_QUALITY_DIMENSIONS',
      'RIYA_DATASET_REQUIRED_REVIEWS',
      'RIYA_DATASET_RESPONSE_OBJECTIVES',
      'RIYA_DATASET_REVIEW_DECISIONS',
      'RIYA_DATASET_RISK_CLASSES',
      'RIYA_DATASET_SCHEMA_VERSION',
      'RIYA_DATASET_SOURCE_KINDS',
      'RIYA_DATASET_SPLITS',
      'RIYA_DATASET_TURN_TYPES',
      'RiyaDatasetError',
      'buildRiyaIntelligenceDatasetManifest',
      'createProtectedTextIndex',
      'createRiyaDatasetAssistantTurn',
      'createRiyaDatasetAuthoritativeContextTurn',
      'createRiyaDatasetCoveragePolicy',
      'createRiyaDatasetReleaseEvidence',
      'createRiyaDatasetReleasePolicy',
      'createRiyaDatasetUserTurn',
      'createRiyaIntelligenceDatasetManifest',
      'createRiyaIntelligenceTrajectory',
      'createRiyaTrainingReview',
      'createRiyaTrainingState',
      'deriveRiyaSftSamples',
      'deriveRiyaSftSamplesForDataset',
      'parseRiyaTrajectoryJsonlLine',
      'riyaDatasetManifestIntegrityHolds',
      'riyaDatasetReportIntegrityHolds',
      'serializeRiyaTrajectoryJsonlLine',
      'validateRiyaIntelligenceDataset',
    ]);
  });

  it('exports no regex, schema, digest helper or near-match internal', () => {
    // A caller holding the near-match helper would tune it, and a tuned leakage gate is a gate that
    // reports what somebody wanted to hear.
    for (const forbidden of [
      'matchProtectedText',
      'collidesWithProtectedIdentity',
      'scanTextForPrivacy',
      'scanLocated',
      'normalizeForComparison',
      'tokenize',
      'ngrams',
      'jaccard',
      'longestCommonRun',
      'canonicalJson',
      'canonicalize',
      'sha256Hex',
      'sha256OfCanonical',
      'trajectoryArtifactSha256',
      'trajectoryConversationFingerprint',
      'SHA256_HEX',
      'P10_NEAR_MATCH_MIN_JACCARD',
      'trajectorySchema',
      'assistantSchema',
    ]) {
      expect(Object.keys(barrel), forbidden).not.toContain(forbidden);
    }
  });

  it('exports no fixture, corpus or protected content from the root', () => {
    for (const key of Object.keys(barrel)) {
      expect(key.toUpperCase()).not.toContain('FIXTURE');
      expect(key.toUpperCase()).not.toContain('GOLDEN');
      expect(key.toUpperCase()).not.toContain('SYNTHETIC_');
    }
    const serialized = JSON.stringify(Object.entries(barrel));
    expect(serialized).not.toContain('modular kitchen');
    expect(serialized).not.toContain('city.alpha');
  });

  it('the testing subpath owns the fixtures, and nothing else', () => {
    expect(Object.keys(testingBarrel).sort()).toStrictEqual([
      'SYNTHETIC_DATASET_INSTANT',
      'acceptedReviews',
      'discoveryTurns',
      'emptyTrainingState',
      'partialTrainingState',
      'releasableOptions',
      'releasePolicyFor',
      'supportedPriceTurns',
      'syntheticProtectedIndex',
      'syntheticTrajectory',
    ]);
  });

  it('hard-codes no Gold V1 target and no base model', () => {
    // 360 belongs to the Gold V1 release POLICY, authored as data by a later slice. And the base
    // model is chosen by a benchmark that has not run: naming one here would pre-empt it.
    for (const { file, code } of productionFiles()) {
      expect(code, `${file} must not hard-code the Gold target`).not.toMatch(/\b360\b/u);
      for (const model of ['qwen', 'llama', 'mistral', 'phi-3', 'gemma', 'deepseek']) {
        expect(code.toLowerCase(), `${file} must not name ${model}`).not.toContain(model);
      }
    }
  });
});
