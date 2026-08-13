/**
 * RWC-P10 containment — this package invokes nothing and judges nothing (ADR-0106 §8, §29, §30).
 *
 * The behaviour specs prove what the evaluator measures. These prove what it cannot do at all.
 *
 * ### The load-bearing one is NO MODEL
 *
 * An evaluator that could call a model would, sooner or later, be asked to score with one. An
 * LLM-as-judge shares the failure modes of the model it grades — the same verbosity preference, the
 * same politeness bias, the same blind spot for a confidently invented warranty — so it
 * systematically approves the answers it would itself have given. Using a model to certify a model is
 * a closed loop with no outside reference, and the number it produces looks exactly as authoritative
 * as a real measurement. The only durable defence is that the capability is absent: no client, no
 * transport, no prompt, no scoring template.
 *
 * Scans read production source with comments stripped, because this package documents at length the
 * things it refuses to be, and scanning the prose would report every prohibition as a violation.
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

function codeOnly(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//gu, '')
    .split('\n')
    .filter((line) => !/^\s*\/\//u.test(line))
    .join('\n');
}

const productionFiles = (): readonly { readonly file: string; readonly code: string }[] =>
  walk(SRC, true).map((file) => ({ file, code: codeOnly(readFileSync(file, 'utf8')) }));

// ---------------------------------------------------------------------------
// 1. No model, no provider, no judge.
// ---------------------------------------------------------------------------

describe('RWC-P10 can neither call a model nor be one', () => {
  it('names no gateway, provider, inference client or transport', () => {
    for (const { file, code } of productionFiles()) {
      for (const forbidden of [
        'model-gateway',
        'ModelGateway',
        'model-reply-adapter',
        'jarvis-runtime',
        'riya-web-conversation-service',
        'prompt-registry',
        'governed-knowledge',
        'groq',
        'Groq',
        'openai',
        'OpenAI',
        'anthropic',
        'Anthropic',
        'ollama',
        'llama.cpp',
        'fetch(',
        'node:http',
        'undici',
        'axios',
        'WebSocket',
        'n8n',
        'pg',
        'Pool',
      ]) {
        expect(code, `${file} must not name ${forbidden}`).not.toContain(forbidden);
      }
    }
  });

  it('names no judge, scoring prompt, voting scheme or embedding', () => {
    for (const { file, code } of productionFiles()) {
      for (const forbidden of [
        /\bjudge\b/iu,
        /\bllm\b/iu,
        /\bsystemPrompt\b/iu,
        /\bscoringPrompt\b/iu,
        /\bevaluatorPrompt\b/iu,
        /\bcompletion\b/iu,
        /\btemperature\b/iu,
        /\bembedding/iu,
        /\bvector\b/iu,
        /\brerank/iu,
        /\bcosine\b/iu,
        /\bvot(e|ing)\b/iu,
        /\bquorum\b/iu,
      ]) {
        expect(forbidden.test(code), `${file} must not match ${String(forbidden)}`).toBe(false);
      }
    }
  });

  it('has no global score, average, weight or star rating anywhere', () => {
    // A single number is how a pushier-but-clearer candidate gets approved. There is deliberately no
    // way to express one.
    for (const { file, code } of productionFiles()) {
      for (const forbidden of [
        /\baverage\b/iu,
        /\boverallScore\b/iu,
        /\btotalScore\b/iu,
        /\bweighted\b/iu,
        /\bstarRating\b/iu,
        /\bcompositeScore\b/iu,
      ]) {
        expect(forbidden.test(code), `${file} must not match ${String(forbidden)}`).toBe(false);
      }
    }
  });

  it('reads no clock, no randomness, no environment and no filesystem', () => {
    // Determinism is the whole basis of candidate comparison: the same suite and the same
    // observations must produce the same digest on every machine, or a "difference" could be the
    // machine.
    for (const { file, code } of productionFiles()) {
      for (const forbidden of [
        'Date.now',
        'new Date(',
        'Math.random',
        'crypto.randomUUID',
        'process.env',
        'node:fs',
        'node:crypto',
        'readFileSync',
        'setTimeout',
        'console.',
      ]) {
        expect(code, `${file} must not name ${forbidden}`).not.toContain(forbidden);
      }
    }
  });

  it('activates, promotes and deploys nothing', () => {
    // `@qf-jarvis/model-evaluation` has a rollout bridge because generic SAFETY evidence is what a
    // rollout ladder consumes. Sales quality is not, and must never become, an activation signal.
    for (const { file, code } of productionFiles()) {
      for (const forbidden of [
        /\brollout\b/iu,
        /\bpromote\b/iu,
        /\bactivateRelease\b/iu,
        /\bkillSwitch\b/iu,
        /\bcanaryPercent\b/iu,
        /\bdeploy\b/iu,
      ]) {
        expect(forbidden.test(code), `${file} must not match ${String(forbidden)}`).toBe(false);
      }
    }
    expect(Object.keys(barrel)).not.toContain('toRolloutApprovalReference');
  });

  it('depends on exactly four packages', () => {
    const manifest = JSON.parse(readFileSync(join(PKG, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    expect(Object.keys(manifest.dependencies ?? {}).sort()).toStrictEqual([
      '@qf-jarvis/model-evaluation',
      '@qf-jarvis/riya-conversation-continuity',
      '@qf-jarvis/riya-conversation-evolution',
      'zod',
    ]);
    expect(manifest.devDependencies).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 2. The public surface.
// ---------------------------------------------------------------------------

describe('the root surface is a vocabulary, factories and three services', () => {
  it('exports exactly the approved runtime symbols', () => {
    expect(Object.keys(barrel).sort()).toStrictEqual([
      'RIYA_QUALITY_CANONICAL_COMPARISON_POLICY_V1',
      'RIYA_QUALITY_CANONICAL_THRESHOLDS_V1',
      'RIYA_QUALITY_CASE_OUTCOMES',
      'RIYA_QUALITY_COMPARISON_OUTCOMES',
      'RIYA_QUALITY_DIMENSIONS',
      'RIYA_QUALITY_DISCOVERY_FIELDS',
      'RIYA_QUALITY_ELIGIBLE_SAFETY_TARGETS',
      'RIYA_QUALITY_ERROR_CODES',
      'RIYA_QUALITY_EVALUATOR_IMPL_ID',
      'RIYA_QUALITY_EVALUATOR_IMPL_VERSION',
      'RIYA_QUALITY_EXPECTABLE_PROVENANCES',
      'RIYA_QUALITY_INTERACTION_KINDS',
      'RIYA_QUALITY_LANGUAGE_MODES',
      'RIYA_QUALITY_MAX_SCENARIOS',
      'RIYA_QUALITY_OBJECTIVE_FAILURE_CODES',
      'RIYA_QUALITY_REQUIRED_HUMAN_REVIEWS',
      'RiyaQualityEvaluationError',
      'compareRiyaQualityCandidates',
      'createRiyaQualityCandidateBinding',
      'createRiyaQualityComparisonPolicy',
      'createRiyaQualityEvidence',
      'createRiyaQualityHumanReview',
      'createRiyaQualityObservation',
      'createRiyaQualityScenario',
      'createRiyaQualitySuite',
      'createRiyaQualityThresholds',
      'evaluateRiyaQualitySuite',
    ]);
  });

  it('exports no schema, no digest helper and no per-case evaluator', () => {
    // A caller holding a schema could build a scenario the constructor never checked; a caller
    // holding the per-case evaluator could run a second evaluation loop beside the suite one.
    for (const forbidden of [
      'scenarioSchema',
      'observationSchema',
      'reviewSchema',
      'thresholdsSchema',
      'contentDigest',
      'evaluateRiyaQualityCase',
      'passRateBps',
      'riyaQualityParityKey',
      'riyaQualityScenarioKey',
      'observationKey',
      'reviewSatisfies',
      'proveGenericSafetyEvidence',
      'riyaQualityCaseSetDigest',
      'riyaQualityResultDigest',
      'riyaQualityResultIntegrityHolds',
      'compareRiyaQualityRates',
    ]) {
      expect(Object.keys(barrel), forbidden).not.toContain(forbidden);
    }
  });

  it('the root exports NO synthetic fixture, corpus or builder', () => {
    for (const key of Object.keys(barrel)) {
      expect(key.toUpperCase()).not.toContain('GOLDEN');
      expect(key.toUpperCase()).not.toContain('FIXTURE');
      expect(key.toUpperCase()).not.toContain('SYNTHETIC');
    }
    const serialized = JSON.stringify(Object.entries(barrel).map(([key, value]) => [key, value]));
    // No synthetic conversation text is reachable from the production import path at all.
    expect(serialized).not.toContain('modular kitchen');
    expect(serialized).not.toContain('lakh');
  });

  it('the testing subpath owns the corpus and the builders, and nothing else', () => {
    expect(Object.keys(testingBarrel).sort()).toStrictEqual([
      'RIYA_QUALITY_GOLDEN_FIXTURES',
      'RIYA_QUALITY_GOLDEN_FIXTURE_MANIFEST_ID',
      'RIYA_QUALITY_GOLDEN_FIXTURE_MANIFEST_VERSION',
      'RIYA_QUALITY_GOLDEN_SCENARIOS',
      'RIYA_QUALITY_GOLDEN_SUITE_ID',
      'RIYA_QUALITY_GOLDEN_SUITE_VERSION',
      'SYNTHETIC_INSTANT',
      'buildRiyaQualityGoldenSuite',
      'createSyntheticQualityBinding',
      'createSyntheticSafetyEvidence',
      'passingGoldenObservations',
      'passingObservationFor',
      'twoReviews',
    ]);
  });

  it('raw synthetic text lives in exactly ONE file', () => {
    // If a sentence appeared anywhere else, the content boundary would already have leaked.
    const carriers = walk(SRC, true).filter((file) =>
      readFileSync(file, 'utf8').includes('modular kitchen'),
    );
    expect(carriers.map((file) => file.replaceAll('\\', '/').split('/src/')[1])).toStrictEqual([
      'testing/golden-corpus.ts',
    ]);
  });
});

// ---------------------------------------------------------------------------
// 3. Nothing in the repository composes it.
// ---------------------------------------------------------------------------

describe('no runtime, service or application reaches this package', () => {
  it('is imported by nothing that runs a conversation', () => {
    // P10 changes no runtime behaviour, so nothing that SERVES a turn may name it. A single import
    // from `jarvis-runtime` or the web service would make an evaluator part of the thing it
    // evaluates.
    //
    // RID-F1 (ADR-0107) adds the first and only permitted importer, and it is the opposite of a
    // runtime: `riya-intelligence-dataset` is OFFLINE authoring infrastructure that reuses P10's
    // language, interaction, dimension and discovery-field vocabularies rather than forking them.
    // A second sales taxonomy beside P10's would make dataset coverage and evaluation coverage
    // incomparable -- you could not say "the corpus covers what the exam measures" -- and the two
    // would drift the first time either was extended.
    //
    // MVP-P2A.1 adds the second, and it is the one this package always needed to exist. P10 judges
    // observations that arrive from somewhere else, and until now nothing could produce them from a
    // real candidate -- so the exam had never been sat. `riya-candidate-evaluation-runner` is that
    // step: it runs the governed corpus through an injected port, builds observations through THIS
    // package's own constructors, and hands them back. The direction is one way and stays that way;
    // an evaluator that could reach a provider is one that eventually will.
    //
    // The set is pinned EXACTLY and no APPLICATION may import the contract at all.
    //
    // MVP-P2A.2 adds the third and last, and it is the one that finally sits the exam:
    // `riya-candidate-evidence-live` is the offline operator leaf that runs the governed corpus
    // through a real hosted candidate and writes a blinded bundle for two humans. It composes P10;
    // P10 knows nothing about it, and the operator's own spec proves nothing composes the operator.
    //
    // Still EXACT, and still no application may import the contract at all.
    const ALLOWED_PACKAGE_IMPORTERS = [
      'riya-candidate-evaluation-runner',
      'riya-candidate-evidence-live',
      'riya-intelligence-dataset',
    ];
    const importingPackages = new Set<string>();
    const importingApps: string[] = [];

    for (const [root, isApp] of [
      [join(REPO_ROOT, 'packages'), false],
      [join(REPO_ROOT, 'apps'), true],
    ] as const) {
      for (const entry of readdirSync(root)) {
        if (entry === 'riya-quality-evaluation') continue;
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
          if (readFileSync(file, 'utf8').includes('@qf-jarvis/riya-quality-evaluation')) {
            if (isApp) {
              importingApps.push(file);
            } else {
              importingPackages.add(entry);
            }
          }
        }
      }
    }
    expect(importingApps).toStrictEqual([]);
    expect([...importingPackages].sort()).toStrictEqual(ALLOWED_PACKAGE_IMPORTERS);
  });

  it('adds no migration', () => {
    const migrations = readdirSync(
      join(REPO_ROOT, 'packages/event-backbone/src/persistence/migrations'),
    ).filter((name) => name.endsWith('.sql'));
    expect(migrations).toHaveLength(12);
    expect(migrations.some((name) => name.startsWith('0013'))).toBe(false);
  });
});
