/**
 * RMB-A containment — this package measures nothing, judges nothing and authorizes nothing.
 *
 * ### The load-bearing one is the second authority
 *
 * A benchmark package that could reach an evaluator would eventually be asked to produce "one number
 * covering speed and quality", and once that number exists a fast model with a bad refusal rate
 * outranks a slower correct one. So the import of `@qf-jarvis/model-evaluation` is proved to be
 * IDENTITY ONLY — the release grammar, nothing else.
 *
 * ### The second is that it cannot run anything
 *
 * Not "does not" — cannot. No HTTP, no provider SDK, no gateway, no inference engine, no download, no
 * `child_process`, no env, no filesystem discovery. Its one Node capability is `node:crypto`, for
 * SHA-256 identity.
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
// 48–54. It invokes nothing.
// ---------------------------------------------------------------------------

describe('RMB-A invokes nothing and measures nothing', () => {
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

  it('reads no environment, no filesystem and spawns no process', () => {
    // A benchmark package is the one most likely to be handed "just read the GPU info" — which is
    // how a hostname ends up in a committed artifact.
    for (const { file, code } of productionFiles()) {
      for (const forbidden of [
        'process.env',
        'process.argv',
        'node:fs',
        'readFileSync',
        'writeFileSync',
        'readdirSync',
        'node:child_process',
        'execSync',
        'spawn(',
        'node:os',
        'hostname',
        'userInfo',
        'cpus(',
        'totalmem',
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
        /\bprompt-registry\b/u,
        /\bgoverned-knowledge\b/u,
        /\bgroq\b/iu,
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
        /\bembedding/iu,
      ]) {
        expect(forbidden.test(code), `${file} must not match ${String(forbidden)}`).toBe(false);
      }
    }
  });

  it('touches no database and adds no migration', () => {
    for (const { file, code } of productionFiles()) {
      for (const forbidden of ['pg', 'Pool', 'migration', 'event-backbone', 'postgres']) {
        expect(code.toLowerCase(), `${file} must not name ${forbidden}`).not.toContain(
          forbidden.toLowerCase(),
        );
      }
    }
    const migrations = readdirSync(
      join(REPO_ROOT, 'packages/event-backbone/src/persistence/migrations'),
    ).filter((name) => name.endsWith('.sql'));
    expect(migrations).toHaveLength(13);
    expect(migrations.some((name) => name.startsWith('0014'))).toBe(false);
  });

  it('uses node:crypto, and ONLY for SHA-256', () => {
    // The one intentional Node capability. Benchmark evidence gets copied between machines and quoted
    // months later, which a 32-bit-derived hash cannot underwrite.
    const users = productionFiles().filter(({ code }) => code.includes('node:crypto'));
    expect(users.map(({ file }) => file.replaceAll('\\', '/').split('/src/')[1])).toStrictEqual([
      'internal/digest.ts',
    ]);
    const source = users[0]?.code ?? '';
    expect(source).toContain("createHash('sha256')");
    for (const forbidden of ['randomBytes', 'randomUUID', 'createCipheriv', 'sign(']) {
      expect(source, forbidden).not.toContain(forbidden);
    }
  });

  it('reads no clock and no randomness', () => {
    // `createdAt` is injected. Two runs of the same inputs must produce one digest.
    for (const { file, code } of productionFiles()) {
      for (const forbidden of ['Date.now', 'new Date(', 'Math.random', 'performance.now']) {
        expect(code, `${file} must not name ${forbidden}`).not.toContain(forbidden);
      }
    }
  });

  it('depends on exactly two packages', () => {
    const manifest = JSON.parse(readFileSync(join(PKG, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
      exports?: Record<string, unknown>;
    };
    expect(Object.keys(manifest.dependencies ?? {}).sort()).toStrictEqual([
      '@qf-jarvis/model-evaluation',
      'zod',
    ]);
    expect(manifest.devDependencies).toBeUndefined();
    expect(Object.keys(manifest.exports ?? {}).sort()).toStrictEqual(['.', './testing']);
  });
});

// ---------------------------------------------------------------------------
// 55–57. It stays in its lane.
// ---------------------------------------------------------------------------

describe('RMB-A is the operational authority and nothing else', () => {
  it('imports ONLY release identity from the evaluation package', () => {
    // Everything else there is safety, and a benchmark package that could reach an evaluator would
    // eventually be asked to merge the two into one number.
    const ALLOWED = new Set([
      'createProviderReleaseRef',
      'ProviderReleaseRef',
      // The exactness predicate. Identity governance, not evaluation capability.
      'isExactGovernedIdentity',
    ]);
    for (const { file, code } of productionFiles()) {
      const imports = [...code.matchAll(/import[^;]*from '@qf-jarvis\/model-evaluation'/gu)];
      for (const match of imports) {
        const named = [...match[0].matchAll(/\b([A-Za-z][A-Za-z0-9_]*)\b/gu)]
          .map((one) => one[1] ?? '')
          .filter(
            (one) =>
              !['import', 'type', 'from', 'qf', 'jarvis', 'model', 'evaluation'].includes(one),
          );
        for (const symbol of named) {
          expect(ALLOWED.has(symbol), `${file} imports ${symbol}`).toBe(true);
        }
      }
    }
    for (const { file, code } of productionFiles()) {
      for (const forbidden of [
        'evaluateSuite',
        'createApprovalEvidence',
        'toRolloutApprovalReference',
        'createEvaluationSuite',
        'createSuiteThresholds',
        'createEvaluationScenario',
        'EVALUATION_SEVERITIES',
        'RED_TEAM',
      ]) {
        expect(code, `${file} must not name ${forbidden}`).not.toContain(forbidden);
      }
    }
  });

  it('has NO dependency on Human Gold or the P10 corpus', () => {
    for (const { file, code } of productionFiles()) {
      for (const forbidden of [
        'riya-intelligence-dataset',
        'riya-quality-evaluation',
        'gold-v1',
        'HUMAN_AUTHORED',
        'GOLDEN_FIXTURES',
        'wave-1',
      ]) {
        expect(code, `${file} must not name ${forbidden}`).not.toContain(forbidden);
      }
    }
  });

  it('is imported by no runtime, service or application', () => {
    // RMB-B adds the first and only permitted importer, and it is the opposite of a runtime:
    // `riya-model-benchmark-harness` is the offline scheduler that PRODUCES evidence and hands it
    // straight to these constructors. The direction is still one-way -- nothing that serves a customer
    // turn may name this package.
    const ALLOWED = new Set(['riya-model-benchmark-harness']);
    const importers: string[] = [];
    for (const root of [join(REPO_ROOT, 'packages'), join(REPO_ROOT, 'apps')]) {
      for (const entry of readdirSync(root)) {
        if (entry === 'riya-model-benchmark' || ALLOWED.has(entry)) continue;
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
          if (readFileSync(file, 'utf8').includes('@qf-jarvis/riya-model-benchmark')) {
            importers.push(file);
          }
        }
      }
    }
    expect(importers).toStrictEqual([]);
  });

  it('hard-codes no provider price and no chosen model', () => {
    // Pricing is mutable and commercial; this package owns performance. And no model is chosen before
    // evidence exists — naming one here would pre-empt the measurement.
    for (const { file, code } of productionFiles()) {
      for (const forbidden of [
        /\bprice\b/iu,
        /\bpricing\b/iu,
        /\bcostPer\b/iu,
        /\busd\b/iu,
        /\bdollar/iu,
        /\bqwen\b/iu,
        /\bmistral\b/iu,
        /\bgemma\b/iu,
        /\bdeepseek\b/iu,
        /\bphi-3\b/iu,
        /\bgpt-\d/iu,
      ]) {
        expect(forbidden.test(code), `${file} must not match ${String(forbidden)}`).toBe(false);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Content firewall.
// ---------------------------------------------------------------------------

describe('no artifact can carry content, identity or a credential', () => {
  it('the public surface has no field a message, prompt or transcript fits in', () => {
    const evidence = testingBarrel.syntheticEvidence();
    const serialized = JSON.stringify(evidence);
    for (const forbidden of ['prompt"', 'message', 'transcript', 'text"', 'content"', 'reply']) {
      expect(serialized.toLowerCase(), forbidden).not.toContain(forbidden.toLowerCase());
    }
    // The only prompt-shaped values are digests.
    expect(evidence.subject.promptDigest).toMatch(/^[0-9a-f]{64}$/u);
    expect(evidence.workload.promptProfileDigest).toMatch(/^[0-9a-f]{64}$/u);
  });

  it('contains no URL, contact detail or governed production name', () => {
    for (const { file, code } of productionFiles()) {
      for (const token of [
        'https://',
        'http://',
        '@gmail',
        '@example.com',
        'quickfurno',
        'onedecore',
      ]) {
        expect(code.toLowerCase(), `${file} must not name ${token}`).not.toContain(token);
      }
    }
  });

  it('the fixtures are obviously invented and make no performance claim', () => {
    const evidence = testingBarrel.syntheticEvidence();
    expect(evidence.subject.release.modelId).toBe('model.alpha');
    expect(evidence.subject.release.releaseId).toBe('release.beta');
    expect(evidence.environment.runtimeEngineId).toBe('engine.gamma');
  });
});

// ---------------------------------------------------------------------------
// 58–60. Public surface and integrity.
// ---------------------------------------------------------------------------

describe('the public surface is small, closed and free of verdicts', () => {
  it('exports exactly the approved symbols', () => {
    expect(Object.keys(barrel).sort()).toStrictEqual([
      'RIYA_BENCHMARK_ACCELERATOR_FAMILIES',
      'RIYA_BENCHMARK_ARCHITECTURE_FAMILIES',
      'RIYA_BENCHMARK_ENVIRONMENT_KINDS',
      'RIYA_BENCHMARK_ERROR_CODES',
      'RIYA_BENCHMARK_MAX_BYTES',
      'RIYA_BENCHMARK_MAX_CASES',
      'RIYA_BENCHMARK_MAX_CONCURRENCY',
      'RIYA_BENCHMARK_MAX_MICROS',
      'RIYA_BENCHMARK_MAX_REQUESTS',
      'RIYA_BENCHMARK_MAX_TOKENS',
      'RIYA_BENCHMARK_PARITY_MISMATCHES',
      'RiyaBenchmarkError',
      'aggregateOutputTokensPerSecond',
      'approximateDecodeTokensPerSecondP50',
      'approximateDecodeTokensPerSecondP95',
      'compareRiyaBenchmarkResultSets',
      'createRiyaBenchmarkEnvironment',
      'createRiyaBenchmarkEvidence',
      'createRiyaBenchmarkObservation',
      'createRiyaBenchmarkResultSet',
      'createRiyaBenchmarkSubject',
      'createRiyaBenchmarkWorkload',
      'isCanonicalBenchmarkInstant',
      'meanOutputTokensPerSuccess',
      'riyaBenchmarkEvidenceIntegrityHolds',
      'riyaBenchmarkResultSetIntegrityHolds',
      'successRateBasisPoints',
      // RMB-B: aggregate throughput, derived from the measured window rather than estimated from
      // concurrency and p50. Still an EXACT set; it records two authorised additions.
      'successfulRequestsPerSecondMilli',
      'verifyRiyaBenchmarkEvidence',
      'verifyRiyaBenchmarkResultSet',
      'workloadParityKey',
      'workloadSuiteKey',
    ]);
  });

  it('exports nothing that reads as a verdict, a score or an approval', () => {
    for (const key of Object.keys(barrel)) {
      const upper = key.toUpperCase();
      // 'GATE' is deliberately absent from this list: `aggregateOutputTokensPerSecond` contains it,
      // and a substring check on a four-letter word inside a longer one is a false positive waiting
      // to be silenced by renaming an honest symbol. ROLLOUT, APPROV and VERDICT cover the actual
      // concern.
      for (const forbidden of [
        'SCORE',
        'RANK',
        'WINNER',
        'BEST',
        'RECOMMEND',
        'APPROV',
        'VERDICT',
        'ROLLOUT',
        'THRESHOLD',
      ]) {
        expect(upper, `${key} must not contain ${forbidden}`).not.toContain(forbidden);
      }
    }
  });

  it('exports NO relation, dominance or Pareto vocabulary - it was removed, not hidden', () => {
    // A dominance verdict needs every axis on both sides, and memory is optional; an unmeasured axis
    // silently dropped out of the relation, so "equivalent" could mean "equal on the axes we happened
    // to share". Comparison returns named parity mismatches and deltas, and nothing that summarises.
    for (const gone of [
      'RIYA_BENCHMARK_PARETO_RELATIONS',
      'RiyaBenchmarkParetoRelation',
      'paretoRelation',
    ]) {
      expect(Object.keys(barrel), gone).not.toContain(gone);
    }
    // And the identifiers are absent from source, not merely unexported. Prose explaining the removal
    // is fine; a declaration is not, so these are the exact identifier spellings.
    for (const { file, code } of productionFiles()) {
      for (const forbidden of [
        'PARETO_RELATIONS',
        'ParetoRelation',
        'paretoRelation',
        'A_DOMINATES',
        'B_DOMINATES',
        'TRADEOFF',
        'NOT_COMPARABLE',
      ]) {
        expect(code, `${file} must not declare ${forbidden}`).not.toContain(forbidden);
      }
    }
  });

  it('exports no internal digest helper or schema', () => {
    for (const forbidden of ['sha256OfCanonical', 'canonicalJson', 'SHA256_HEX', 'subjectSchema']) {
      expect(Object.keys(barrel), forbidden).not.toContain(forbidden);
    }
  });

  it('the testing subpath owns the fixtures, and nothing else', () => {
    expect(Object.keys(testingBarrel).sort()).toStrictEqual([
      'SYNTHETIC_BENCHMARK_INSTANT',
      'syntheticDigest',
      'syntheticEvidence',
      'syntheticHostedEnvironment',
      'syntheticLocalEnvironment',
      'syntheticObservation',
      'syntheticSubject',
      'syntheticWorkload',
    ]);
    for (const key of Object.keys(barrel)) {
      expect(key.toUpperCase()).not.toContain('SYNTHETIC');
      expect(key.toUpperCase()).not.toContain('FIXTURE');
    }
  });

  it('every constructed artifact is frozen, all the way down', () => {
    const evidence = testingBarrel.syntheticEvidence();
    expect(Object.isFrozen(evidence)).toBe(true);
    expect(Object.isFrozen(evidence.subject)).toBe(true);
    expect(Object.isFrozen(evidence.subject.release)).toBe(true);
    expect(Object.isFrozen(evidence.environment)).toBe(true);
    expect(Object.isFrozen(evidence.workload)).toBe(true);
    expect(Object.isFrozen(evidence.observation)).toBe(true);
  });

  it('every error code is closed, and the class carries no measured value', () => {
    expect(barrel.RIYA_BENCHMARK_ERROR_CODES).toHaveLength(19);
    const error = new barrel.RiyaBenchmarkError('DIGEST_INVALID');
    expect(error.code).toBe('DIGEST_INVALID');
    expect(error.message).toBe('DIGEST_INVALID');
    expect(Object.keys(error)).not.toContain('value');
  });
});
