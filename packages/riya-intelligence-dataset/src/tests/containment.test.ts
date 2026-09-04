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
import * as goldBarrel from '../gold-v1/index.js';
import * as aiBarrel from '../ai-synthetic/index.js';
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

/**
 * The TWO files allowed to contain a forbidden name, because their job is to reject it.
 *
 * A firewall that rejects governed production names has to know them, and a brief validator that
 * refuses an authoring instruction naming a model provider has to know those too. The exemption is
 * narrow — these exact paths — and each is separately proved below to carry the names only inside a
 * named reject list, never in an example, a default or a fixture.
 */
const PRIVACY_SCANNER = 'internal/privacy-scan.ts';
const BRIEF_SCANNER = 'gold-v1/service/validate-plan.ts';
const SCANNERS = new Set([PRIVACY_SCANNER, BRIEF_SCANNER]);

// ---------------------------------------------------------------------------
// 1. No model, no training, no I/O.
// ---------------------------------------------------------------------------

describe('RID-F1 invokes nothing and trains nothing', () => {
  it('names no model, provider, gateway or inference client', () => {
    // The provider names are the scanners' business; the IMPORT paths are nobody's, so those stay
    // enforced everywhere including inside the scanners.
    const PROVIDER_NAMES = new Set(['groq', 'Groq', 'openai', 'OpenAI', 'anthropic', 'Anthropic']);
    for (const { file, relative, code } of productionFiles()) {
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
        if (SCANNERS.has(relative) && PROVIDER_NAMES.has(forbidden)) continue;
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
    // Two exemptions, both scanners, and neither is exempt from the URL and contact rules. Every
    // other file is held to the plain rule.
    for (const { file, relative, code } of productionFiles()) {
      const forbidden = SCANNERS.has(relative)
        ? ['https://', 'http://', '@gmail', '@example.com']
        : ['quickfurno', 'onedecore', 'https://', 'http://', '@gmail', '@example.com'];
      for (const token of forbidden) {
        expect(code.toLowerCase(), `${file} must not name ${token}`).not.toContain(token);
      }
    }
  });

  it.each([
    [PRIVACY_SCANNER, 'PRODUCTION_NAMES'],
    [BRIEF_SCANNER, 'FORBIDDEN_NAMES'],
  ])('%s names a production string ONLY inside %s', (path, list) => {
    // The exemptions above are only safe if the names appear in the reject list and nowhere else --
    // not in an example, a default value or a fixture.
    const scanner = productionFiles().find(({ relative }) => relative === path);
    expect(scanner, path).toBeDefined();
    const code = scanner?.code ?? '';

    // The declaration's exact span: from the list's name to the parenthesis that closes it.
    const start = code.indexOf(list);
    expect(start, `${path} declares ${list}`).toBeGreaterThanOrEqual(0);
    const end = code.indexOf(']);', start);
    expect(end, `${path} closes ${list}`).toBeGreaterThan(start);

    // Every occurrence, anywhere in the file, falls inside that span.
    const occurrences = [...code.matchAll(/quickfurno|onedecore/giu)].map((match) => match.index);
    expect(occurrences.length, `${path} lists the production names`).toBeGreaterThan(0);
    for (const at of occurrences) {
      expect(at, `${path}: occurrence at ${String(at)} is outside ${list}`).toBeGreaterThan(start);
      expect(at, `${path}: occurrence at ${String(at)} is outside ${list}`).toBeLessThan(end);
    }
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
  it('is imported by nothing but the offline generation harness', () => {
    // A runtime that could reach this is a runtime that could reach training data, and a path by
    // which a live conversation could be appended to a corpus.
    //
    // Exactly TWO importers are permitted, both offline: the AS2 generation harness (ADR-0143),
    // which assembles candidates from these contracts. The firewall is not weakened by it, because the
    // harness is itself proved unreachable from every app and runtime by its own containment spec --
    // so `runtime -> harness -> dataset` stays broken at the first link, and the chain is checked at
    // both ends rather than assumed at either. Any OTHER importer is the failure this test exists to
    // catch, and still fails.
    //
    // AS3A (ADR-0143 §4) permits a SECOND, and it is offline for the same reason. The provider
    // adapters build the role output schemas from these vocabularies and end a pilot in this
    // package's own validator; they exist so the generation harness never has to hold a provider SDK.
    // The chain is `runtime -> adapters -> dataset`, and it is broken at the first link by that
    // package's own containment spec, which proves nothing imports it at all.
    const OFFLINE_IMPORTERS: readonly string[] = [
      'riya-ai-synthetic-generation',
      'riya-ai-synthetic-provider-adapters',
    ];
    const importers: string[] = [];
    for (const root of [join(REPO_ROOT, 'packages'), join(REPO_ROOT, 'apps')]) {
      for (const entry of readdirSync(root)) {
        if (entry === 'riya-intelligence-dataset' || OFFLINE_IMPORTERS.includes(entry)) continue;
        let files: string[];
        try {
          files = walk(join(root, entry, 'src'), false);
        } catch {
          continue;
        }
        for (const file of files) {
          // RAW source, deliberately. `codeOnly` strips block comments with a regex, and a regex is
          // not a TypeScript lexer -- a comment token inside a string literal would hide an import
          // from it. That trade is fine for a broad "does this file NAME X?" scan and wrong at an
          // import firewall, where a false negative is the expensive direction. Production comments
          // are worded to avoid the exact specifier instead.
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
    expect(migrations).toHaveLength(13);
    expect(migrations.some((name) => name.startsWith('0014'))).toBe(false);
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

  it('the Gold V1 authoring system is a SEPARATE subpath, off the root', () => {
    // Nothing on a production import path can reach the plan, the briefs or the Gold policies, and
    // the root surface is unchanged by HGV1-A.
    for (const key of Object.keys(barrel)) {
      expect(key.toUpperCase(), key).not.toContain('GOLD');
    }
    const manifest = JSON.parse(readFileSync(join(PKG, 'package.json'), 'utf8')) as {
      exports?: Record<string, unknown>;
    };
    expect(Object.keys(manifest.exports ?? {}).sort()).toStrictEqual([
      '.',
      './ai-synthetic',
      './gold-v1',
      './testing',
    ]);
  });

  it('the AI-synthetic slice reaches no exam, no provider and no protected fixture', () => {
    // ADR-0143 section 20: the protected corpus is a VALIDATION-ONLY input. It enters the acceptance
    // validator after a candidate already exists, and no planning, provenance or critic contract has
    // a field it could travel in. AS2 inherits this boundary.
    for (const { file, relative, code } of productionFiles()) {
      if (!relative.startsWith('ai-synthetic/')) continue;
      expect(code, file).not.toContain('riya.p10.');
      expect(code, file).not.toContain('RIYA_QUALITY_GOLDEN_FIXTURES');
      expect(code, file).not.toContain('syntheticUserText');
      expect(code, file).not.toContain('/testing');
    }
    const serialized = JSON.stringify(Object.entries(aiBarrel));
    expect(serialized).not.toContain('riya.p10.');
  });

  it('the AI-synthetic subpath carries no dialogue and no critic prose', () => {
    // A scenario is a PLAN. The strongest way to say there is no generated conversation here is to
    // show the exported surface has nowhere to put one.
    const exported = Object.keys(aiBarrel);
    expect(exported).toContain('createRiyaAiSyntheticScenario');
    expect(exported).toContain('validateRiyaAiSyntheticCorpus');
    const serialized = JSON.stringify(Object.entries(aiBarrel));
    for (const shape of ['"type":"USER"', '"type":"ASSISTANT"', 'annotation', 'turnRef']) {
      expect(serialized, shape).not.toContain(shape);
    }
    for (const key of exported) {
      const upper = key.toUpperCase();
      expect(upper, key).not.toContain('TRANSCRIPT');
      expect(upper, key).not.toContain('RATIONALE');
      expect(upper, key).not.toContain('PROMPT');
    }
  });

  it('the Gold subpath ships the authoring system and NO Gold conversation', () => {
    // HGV1-A builds the system; humans author Wave 1 in the next content PR. The strongest way to
    // say "there is no Gold dialogue here" is to show the exported surface has nowhere to put one.
    const exported = Object.keys(goldBarrel);
    expect(exported).toContain('generateRiyaGoldV1Plan');
    expect(exported).toContain('RIYA_GOLD_V1_WAVE_1_BRIEFS');
    for (const key of exported) {
      const upper = key.toUpperCase();
      expect(upper, key).not.toContain('TRAJECTOR');
      expect(upper, key).not.toContain('CORPUS_V1');
      expect(upper, key).not.toContain('CONVERSATION');
      expect(upper, key).not.toContain('TRANSCRIPT');
    }
    // And no exported value is or contains an annotated turn.
    const serialized = JSON.stringify(Object.entries(goldBarrel));
    for (const shape of ['"type":"USER"', '"type":"ASSISTANT"', 'annotation', 'turnRef']) {
      expect(serialized, shape).not.toContain(shape);
    }
  });

  it('the Gold slice quotes no P10 identifier and no protected text', () => {
    // The exam corpus is loaded at verification time and its identity DERIVED. A fixture id written
    // into production source would put the exam in the shipped bundle, which is the exact failure the
    // leakage firewall exists to catch.
    for (const { file, relative, code } of productionFiles()) {
      if (!relative.startsWith('gold-v1/')) continue;
      expect(code, file).not.toContain('riya.p10.');
      expect(code, file).not.toContain('RIYA_QUALITY_GOLDEN_FIXTURES');
      expect(code, file).not.toContain('syntheticUserText');
      expect(code, file).not.toContain('/testing');
    }
    // Neither does the Gold barrel at runtime.
    const serialized = JSON.stringify(Object.entries(goldBarrel));
    expect(serialized).not.toContain('riya.p10.');
  });

  it('the briefs carry no dialogue, and the plan carries no text a model could learn', () => {
    // A brief is instructions ABOUT a conversation. Every field is prose or a code, never a reply --
    // so the prose fields carry no quotation mark and no speaker prefix, and there is no field a turn
    // would fit in.
    for (const brief of goldBarrel.RIYA_GOLD_V1_WAVE_1_BRIEFS) {
      for (const prose of [brief.customerSituation, brief.conversationGoal]) {
        expect(prose, brief.briefRef).not.toMatch(/["“”]/u);
        expect(prose, brief.briefRef).not.toMatch(
          /(?:^|\s)(?:user|customer|assistant|riya|bot|agent)\s*:/iu,
        );
      }
      for (const absent of ['turns', 'exampleReply', 'text', 'transcript']) {
        expect(Object.keys(brief), `${brief.briefRef}/${absent}`).not.toContain(absent);
      }
    }
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

  it('hard-codes the Gold V1 target in the Gold slice ONLY, and no base model anywhere', () => {
    // ADR-0107 said 360 belongs to the Gold V1 coverage POLICY, authored as data by a later slice.
    // HGV1-A is that slice, so the lock is RESTATED rather than dropped: the generic factory still
    // knows nothing about Gold's size, and the two Gold files that carry the target are named here.
    //
    // The base model is chosen by a benchmark that has not run, so naming one is still forbidden
    // everywhere -- except in the brief scanner's reject list, whose whole job is to refuse an
    // authoring instruction that names one.
    const TARGET_HOLDERS = new Set([
      'gold-v1/contracts/vocabularies.ts',
      'gold-v1/policy/gold-policy.ts',
    ]);
    for (const { file, relative, code } of productionFiles()) {
      if (!TARGET_HOLDERS.has(relative)) {
        expect(code, `${file} must not hard-code the Gold target`).not.toMatch(/\b360\b/u);
      }
      for (const model of ['qwen', 'llama', 'mistral', 'phi-3', 'gemma', 'deepseek']) {
        if (relative === BRIEF_SCANNER) continue;
        expect(code.toLowerCase(), `${file} must not name ${model}`).not.toContain(model);
      }
    }
    // And the generic RID-F1 factory still carries no Gold number at all.
    for (const { file, relative, code } of productionFiles()) {
      if (relative.startsWith('gold-v1/')) continue;
      expect(code, `${file} must not name a Gold wave total`).not.toMatch(/\b(?:360|288|72)\b/u);
    }
  });
});
