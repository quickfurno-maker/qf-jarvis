/**
 * QFJ-S2-E-B — containment and activation safety for the controlled SHADOW runner (ADR-0065).
 *
 * The runner is the first `apps/api` code that composes a real gateway holding a real credential, so the
 * envelope is asserted rather than described: the composition root API has not grown, the ONE internal
 * subpath exports exactly one factory, `createProductionModelGateway` is still OFF-only and
 * non-activatable, the live model id lives only in configuration, no tool/n8n/database path exists, and
 * every prior package lock is exactly where S2-D-B left it.
 *
 * Scans read CODE, not documentation, and skip this file: a spec that names what it forbids would
 * otherwise flag its own prohibition (the recurring false positive in this repository's suites).
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createProductionModelGateway } from '@qf-jarvis/model-gateway-composition';
import { createEvaluationEvidenceRegistry } from '@qf-jarvis/model-gateway-composition/internal/evidence-registry';
import { describe, expect, it } from 'vitest';

import { SHADOW_CALL_BUDGET, createShadowCounters } from '../shadow/shadow-counters.js';
import {
  SHADOW_MAX_RESULT_CHARS,
  SHADOW_PROMPT_ID,
  createShadowRequest,
} from '../shadow/shadow-request.js';
import { MODEL_ID, shadowConfig } from './shadow-test-support.js';

const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const APP_DIR = fileURLToPath(new URL('../../', import.meta.url));
const normalise = (p: string): string => p.replace(/\\/g, '/');

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...walk(full));
    } else if (entry.endsWith('.ts')) {
      out.push(full);
    }
  }
  return out;
}

/**
 * The containment scanners are excluded from every scan.
 *
 * A containment spec must name the strings it forbids, so scanning one flags its own prohibition as the
 * violation. Excluding exactly the scanners keeps the check honest: all production source and every
 * behavioural spec is still covered.
 *
 * `deployment-containment` joins the list for the same reason: it asserts the production image and
 * compose topology reference no n8n, Core, database or provider host, which it can only do by naming
 * those strings.
 */
const SCANNERS: readonly string[] = Object.freeze([
  'src/tests/shadow-containment.test.ts',
  'src/tests/credential-containment.test.ts',
  'src/tests/deployment-containment.test.ts',
]);
const allFiles = (): string[] =>
  walk(join(APP_DIR, 'src')).filter((f) => !SCANNERS.some((s) => normalise(f).endsWith(`/${s}`)));
const shadowFiles = (): string[] =>
  allFiles().filter((f) => /\/(shadow|cli|bin)\//.test(normalise(f)));

function codeOnly(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !/^\s*\/\//.test(line))
    .join('\n');
}

describe('(1-7) the internal evidence-registry subpath', () => {
  it('(1, 2) the composition root API has NOT grown', async () => {
    const root = (await import('@qf-jarvis/model-gateway-composition')) as unknown as Record<
      string,
      unknown
    >;
    expect(Object.keys(root)).toHaveLength(2);
    expect(Object.keys(root).sort()).toEqual([
      'createLiveModelGatewayInvoker',
      'createProductionModelGateway',
    ]);
    // The registry factory is NOT reachable from the root: it is process-boundary-only.
    expect(root['createEvaluationEvidenceRegistry']).toBeUndefined();
  });

  it('(3, 4) the internal subpath exports exactly one factory', () => {
    const internal = { createEvaluationEvidenceRegistry } as Record<string, unknown>;
    expect(Object.keys(internal)).toHaveLength(1);
    expect(typeof createEvaluationEvidenceRegistry).toBe('function');
  });

  it('(5) the subpath is declared in the manifest and points at the built module', () => {
    const manifest = JSON.parse(
      readFileSync(join(REPO_ROOT, 'packages/model-gateway-composition/package.json'), 'utf8'),
    ) as { exports?: Record<string, Record<string, string>> };
    const exports = manifest.exports ?? {};
    expect(Object.keys(exports).sort()).toEqual(['.', './internal/evidence-registry']);
    const internal = exports['./internal/evidence-registry'] ?? {};
    expect(internal['default']).toBe('./dist/evidence/evaluation-evidence-registry.js');
    // Only `dist/`: a subpath resolving into `src/` would leak unbuilt source.
    for (const target of Object.values(internal)) {
      expect(target.startsWith('./dist/')).toBe(true);
    }
  });

  it('(6, 7) the registry it hands back is frozen and verifies fail-closed', () => {
    // An EMPTY evidence set is legal, and yields a verifier that refuses everything.
    const result = createEvaluationEvidenceRegistry([]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.registry)).toBe(true);
    expect(result.registry.size()).toBe(0);
    expect(result.registry.references()).toEqual([]);
    const verdict = result.registry.verifier.verify({
      evaluationRef: 'evref-absent',
      evidenceDigest: '0000000000000000',
      approvalTarget: 'SHADOW_ELIGIBILITY',
      release: {
        providerId: 'groq.absent',
        releaseId: 'rel.absent',
        configDigest: '0000000000000000',
        modelId: MODEL_ID,
        modelVersion: 'synthetic-catalog-2026-07-30',
        executionClass: 'HOSTED',
      },
      capabilityProfileRef: 'cap.absent',
      mode: 'SHADOW',
    });
    // Nothing registered → refused. It does not default to permitting.
    expect(verdict).toEqual({ ok: false, reason: 'evidence-missing' });
  });
});

describe('(121-126) the production composition is still non-activatable', () => {
  const REQUIRED = {
    modelId: MODEL_ID,
    modelVersion: 'synthetic-catalog-2026-07-30',
    providerId: 'groq.shadow.candidate',
    releaseId: 'rel.qfj.s2e.candidate.v1',
    configDigest: '0bbbbbbbbb0000000000000000000002',
  };

  it('(121, 122, 123) it refuses every non-OFF mode, including SHADOW', () => {
    for (const mode of ['SHADOW', 'CANARY', 'ACTIVE'] as const) {
      const result = createProductionModelGateway({
        rollout: { rolloutId: 'roll.qfj.s2e.shadow', mode, ...REQUIRED },
        credentialResolver: {
          resolve: () => {
            throw new Error('QFJ_TEST_RESOLVER_MUST_NOT_BE_CALLED');
          },
        },
      } as unknown as Parameters<typeof createProductionModelGateway>[0]);
      expect(result.ok).toBe(false);
      if (result.ok) continue;
      // A closed refusal reason and nothing else — no gateway, no message, no cause.
      expect(typeof result.reason).toBe('string');
      expect(Object.keys(result).sort()).toEqual(['ok', 'reason']);
    }
  });

  it('(124) the runner does NOT reach activation through the production composition', () => {
    // The runner composes its own process-local gateway (ADR-0065 §6). It must not call the OFF-only
    // production factory at all, which is what keeps that factory safe to leave OFF-only forever.
    for (const file of shadowFiles()) {
      const code = codeOnly(readFileSync(file, 'utf8'));
      expect(code).not.toContain('createProductionModelGateway');
      expect(code).not.toContain('createProductionModelGatewayInvoker');
    }
  });

  it('(125, 126) no shadow source enables CANARY, ACTIVE or FALLBACK', () => {
    for (const file of shadowFiles()) {
      const code = codeOnly(readFileSync(file, 'utf8'));
      expect(code).not.toContain('CANARY');
      expect(code).not.toContain("'ACTIVE_MODEL_RELEASE'");
      expect(code).not.toMatch(/allowFallback\s*:\s*true/);
      expect(code).not.toMatch(/canaryBasisPoints\s*:\s*[1-9]/);
      expect(code).not.toMatch(/retryBudget\s*:\s*[1-9]/);
      expect(code).not.toMatch(/maxShadowAttempts\s*:\s*[2-9]/);
    }
  });
});

describe('(127-132) no live model id, tool, workflow or database path', () => {
  it('(127, 128) no production source hard-codes a live provider model id', () => {
    for (const file of allFiles().filter((f) => !normalise(f).includes('/tests/'))) {
      const text = readFileSync(file, 'utf8');
      expect(text).not.toContain('gpt-oss');
      expect(text).not.toContain('llama-3');
      expect(text).not.toContain('mixtral');
      expect(text).not.toContain('groq.com');
      expect(text).not.toContain('api.groq');
    }
  });

  it('(129) the model id is supplied by configuration, and reaches the request unchanged', () => {
    const config = shadowConfig();
    const request = createShadowRequest({
      runId: config.runId,
      timeoutMs: config.timeoutMs,
      minContextTokens: config.maxInputTokens,
    });
    // The prompt is fixed in source; the model is not named by the request at all — the gateway resolves
    // it from the release the rollout policy carries, which came from configuration.
    expect(JSON.stringify(request)).not.toContain(MODEL_ID);
    expect(request.promptId).toBe(SHADOW_PROMPT_ID);
  });

  /**
   * The files QFJ-P08-B3 (ADR-0078) authorises to name the persistence packages.
   *
   * `event-backbone` moved from "never" to "exactly here". The durable composition must create a
   * pool through its public API, and its test must apply migrations and read rows back. Naming both
   * files keeps that a decision about two modules rather than a capability the application acquired.
   *
   * Everything else on the list below — n8n, WhatsApp, webhooks, tool calls, workflows, raw pools and
   * raw SQL — stays forbidden EVERYWHERE, including in these two.
   */
  const DATABASE_COMPOSITION_FILES: readonly string[] = Object.freeze([
    'src/runtime/durable-jarvis-runtime.ts',
    'src/tests/durable-database-harness.ts',
  ]);

  it('(130, 131) no tool, execution, workflow or database capability is reachable', () => {
    for (const file of allFiles()) {
      // `DIRECT_BUSINESS_OR_N8N_EXECUTION` is a red-team case KIND from `model-evaluation`: it names the
      // behaviour the candidate must REFUSE, and the evidence generator must enumerate it to cover the
      // mandatory set. Removing the identifier before scanning keeps the check on capability, not prose.
      const code = codeOnly(readFileSync(file, 'utf8'))
        .replace(/DIRECT_BUSINESS_OR_N8N_EXECUTION/g, 'MANDATORY_REFUSAL_KIND')
        .toLowerCase();
      const composesDatabase = DATABASE_COMPOSITION_FILES.some((allowed) =>
        normalise(file).endsWith(`/${allowed}`),
      );
      for (const forbidden of [
        'n8n',
        'whatsapp',
        'webhook',
        'toolcall',
        'tool_call',
        'tools:',
        'workflow',
        // A RAW pool stays forbidden EVERYWHERE, the two composition files included: they reach the
        // database through the public workspace APIs or not at all.
        'pg-pool',
        'createpool',
      ]) {
        expect(code, `${file}: ${forbidden}`).not.toContain(forbidden);
      }
      if (!composesDatabase) {
        expect(code, file).not.toContain('event-backbone');
      }
      // Raw SQL is permitted ONLY in the test harness, which has to seed rows and damage the schema
      // to prove startup refuses. No production file may contain a statement.
      if (!normalise(file).includes('/tests/')) {
        for (const sql of ['insert into', 'begin;', 'select ', 'update ', 'delete ']) {
          expect(code, `${file}: ${sql}`).not.toContain(sql);
        }
      }
    }
  });

  it('(130, 131) exactly two files name the persistence packages, and only one is production', () => {
    const naming = allFiles().filter((file) =>
      codeOnly(readFileSync(file, 'utf8')).toLowerCase().includes('event-backbone'),
    );
    expect(naming.map((f) => normalise(f).split('/apps/api/')[1] ?? '').sort()).toEqual([
      ...DATABASE_COMPOSITION_FILES,
    ]);
    // Only ONE of them is production source; the other is excluded from the emitting build.
    expect(naming.filter((f) => !normalise(f).includes('/tests/'))).toHaveLength(1);
  });

  it('(132) the prompt and schema are fixed in source and not configurable', () => {
    const request = createShadowRequest({
      runId: 'run.a',
      timeoutMs: 5_000,
      minContextTokens: 4096,
    });
    const other = createShadowRequest({ runId: 'run.b', timeoutMs: 9_000, minContextTokens: 4096 });
    // Only the correlation id and the timeout vary; the prompt text is identical.
    expect(JSON.stringify(request.messages)).toBe(JSON.stringify(other.messages));
    expect(request.resultMode).toBe('STRUCTURED');
    expect(request.retryBudget).toBe(0);
    expect(SHADOW_MAX_RESULT_CHARS).toBe(128);
    // No config or CLI key can supply a prompt.
    for (const file of shadowFiles()) {
      const code = codeOnly(readFileSync(file, 'utf8'));
      expect(code).not.toMatch(/promptText|systemPrompt\s*:|userPrompt\s*:|--prompt/);
    }
  });
});

describe('(133-148) the declared budget and every prior lock', () => {
  it('(133, 134) the budget forbids retry, fallback, refresh and output retention', () => {
    expect(SHADOW_CALL_BUDGET.retries).toBe(0);
    expect(SHADOW_CALL_BUDGET.fallbacks).toBe(0);
    expect(SHADOW_CALL_BUDGET.refreshes).toBe(0);
    expect(SHADOW_CALL_BUDGET.outputsRetained).toBe(0);
    expect(Object.isFrozen(SHADOW_CALL_BUDGET)).toBe(true);
  });

  it('(135, 136) a counter refuses at its ceiling rather than exceeding it', () => {
    const counters = createShadowCounters();
    expect(counters.claim('stableInvocations')).toBe(true);
    expect(counters.claim('stableInvocations')).toBe(false);
    expect(counters.snapshot().stableInvocations).toBe(1);
    expect(counters.exceeded()).toBe(true);
    // A zero-budget counter refuses on the very first claim.
    const fresh = createShadowCounters();
    expect(fresh.claim('retries')).toBe(false);
    expect(fresh.snapshot().retries).toBe(0);
  });

  it('(137) no credential refresh, hot-rebind or dispose path exists in the runner', () => {
    // An exact identifier list, not a substring sweep: the zero-ceiling `refreshes` COUNTER legitimately
    // contains "refresh", and its whole purpose is to prove a refresh never happened.
    const FORBIDDEN_CALLS =
      /\.\s*(refresh|refreshCredential|rebind|rebindProvider|dispose|destroy|reload|rotate|invalidate)\s*\(/;
    for (const file of shadowFiles()) {
      const code = codeOnly(readFileSync(file, 'utf8'));
      expect(code).not.toMatch(FORBIDDEN_CALLS);
      expect(code).not.toMatch(/\brotateCredential\b|\bhotRebind\b|\bdisposeProvider\b/);
      // `close()` is permitted ONLY on a file handle in the designated JSON reader, where releasing the
      // descriptor is mandatory. Nothing may close a provider, transport or gateway.
      const closes = code.match(/\.\s*close\s*\(/g) ?? [];
      if (closes.length > 0) {
        expect(normalise(file).endsWith('/src/shadow/shadow-json-reader.ts')).toBe(true);
        expect(code).toMatch(/handle\.close\(\)/);
      }
    }
  });

  it('(138, 139) no real evidence artifact or run configuration is committed', () => {
    const tracked = walk(join(APP_DIR, 'src'))
      .concat(walk(join(REPO_ROOT, 'docs')))
      .map(normalise);
    for (const file of tracked) {
      expect(file).not.toMatch(/shadow-(evidence|config|run)\.json$/);
      expect(file).not.toMatch(/\.key$/);
    }
  });

  it('(140) no new package or app was created', () => {
    const dirs = (relative: string): string[] =>
      readdirSync(join(REPO_ROOT, relative))
        .filter((entry) => statSync(join(REPO_ROOT, relative, entry)).isDirectory())
        .sort();
    expect(dirs('packages')).toEqual([
      'agent-runtime',
      // QFJ-S3-D-A (ADR-0070): the Anisha vendor-journey behaviour package. Still an EXACT set
      // match -- this records an authorised addition, it does not relax the assertion.
      'anisha-agent',
      // QFJ-P08 (ADR-0082): the Core approval submission protocol. Still an EXACT set match -- this
      // records an authorised addition, it does not relax the assertion.
      'approval-core-adapter',
      // QFJ-P08 (ADR-0080): the approval runtime foundation -- Jarvis asks, Core decides. Still an
      // EXACT set match; it records an authorised addition, it does not relax the assertion.
      'approval-runtime',
      // QFJ-P08 (ADR-0083): the communication authorization correlation runtime -- Core owns consent,
      // this only proves the paperwork. Still an EXACT set match; it records an authorised addition.
      'communication-authorization-runtime',
      'contracts',
      // QFJ-P08-A (ADR-0074): the conversation control command foundation. Still an EXACT set match
      // -- this records an authorised addition, it does not relax the assertion.
      // JOS-01B (ADR-0086): the framework-neutral read-only control-plane snapshot contract, shared
      // by Jarvis OS today and by a future Android client. Still an EXACT set match -- this records
      // an authorised addition, it does not relax the assertion. It depends on zod alone: no Node
      // API, no network, no persistence, no provider, and no authority field it could express.
      'control-plane-read-contract',
      'conversation-control',
      'core-decision-adapter',
      'event-backbone',
      'event-ingestion',
      // QFJ-P09.02 (ADR-0090): the test-only Core -> n8n execution DISPATCH boundary. It holds no
      // transport, and no application imports it. Its ONE consumer is the durable replay store
      // below, which implements the guard contract this package declares.
      'execution-dispatch-runtime',
      // QFJ-P09.01 (ADR-0084): the execution intent correlation runtime -- Core issues, n8n executes,
      // this only correlates. Still an EXACT set match; it records an authorised addition.
      'execution-intent-runtime',
      'governed-knowledge',
      'groq-staging-smoke',
      'jarvis-runtime',
      'model-evaluation',
      'model-gateway',
      'model-gateway-composition',
      'model-reply-adapter',
      // QFJ-P08 (ADR-0081): the durable approval queue and audit. Still an EXACT set match -- this
      // records an authorised addition, it does not relax the assertion.
      'postgres-approval-queue',
      // QFJ-P08-B2 (ADR-0077): the durable PostgreSQL conversation-state adapter. Still an EXACT
      // set match -- this records an authorised addition, it does not relax the assertion.
      'postgres-conversation-state',
      // QFJ-P09.03 (ADR-0091): the durable execution replay / idempotency store -- the PostgreSQL
      // implementation of the guard P09.02 declared and deliberately left defaultless. Still an
      // EXACT set match; it records an authorised addition, it does not relax the assertion. It is
      // TRANSPORT-NEUTRAL: no endpoint, no n8n, no provider, no credential, no intent payload.
      'postgres-execution-replay-store',
      // QFJ-S3-I-A (ADR-0072): the versioned prompt registry foundation. Still an EXACT set match --
      // this records an authorised addition, it does not relax the assertion.
      'prompt-registry',
      'rag-provisioning',
      // QFJ-P05.05 (ADR-0079): the governed recommendation runtime -- the producer for contracts
      // that already existed. Still an EXACT set match; it records an authorised addition.
      'recommendation-runtime',
      // QFJ-S3-C (ADR-0067): the Riya client-sales behaviour package. Still an EXACT set match --
      // this records an authorised addition, it does not relax the assertion.
      'riya-agent',
      // RWC-P2A (ADR-0093): Riya's conversational continuity CONTRACT -- the working state one
      // conversation carries between turns. Still an EXACT set match; it records an authorised
      // addition, it does not relax the assertion. It is contract-only: no database, migration,
      // adapter, transport, web service, reducer, extraction, transcript or business authority, and
      // it is NOT ADR-0016 agent memory.
      'riya-conversation-continuity',
      // RWC-P2C (ADR-0094): the PRIVATE Riya web conversation service. Still an EXACT set match; it
      // records an authorised addition, it does not relax the assertion. It is an application
      // service with no ingress: no HTTP server, route, public endpoint, browser reachability,
      // database, migration, provider or live send, and nothing imports it.
      'riya-web-conversation-service',
    ]);
    // JOS-01A (docs/architecture/jarvis-os.md): the Jarvis OS operator control plane. Still an
    // EXACT set match -- this records an authorised addition, it does not relax the assertion.
    // It is a POWERLESS read surface: it reaches no database, no provider, no n8n and no Core,
    // and its own suite scans its source to prove it.
    expect(dirs('apps')).toEqual(['api', 'jarvis-os', 'worker']);
  });

  it('(141-148) every prior package-root runtime API lock still holds', async () => {
    const expected: Readonly<Record<string, number>> = {
      'model-evaluation': 33,
      'model-gateway': 71,
      'model-gateway-composition': 2,
      'groq-staging-smoke': 24,
      'event-backbone': 39,
      // QFJ-S3-D-A (ADR-0070): the new Anisha behaviour package, locked from the day it lands.
      'anisha-agent': 14,
      // QFJ-S3-I-A (ADR-0072): the prompt registry foundation, locked from the day it lands.
      'prompt-registry': 7,
      // QFJ-P08-A (ADR-0074): the conversation control foundation, locked from the day it lands.
      'conversation-control': 9,
      // QFJ-P08-B2 (ADR-0077): the durable adapter, locked from the day it lands.
      'postgres-conversation-state': 3,
      // QFJ-P05.05 (ADR-0079): the governed recommendation runtime, locked from the day it lands.
      'recommendation-runtime': 4,
      // QFJ-P08 (ADR-0080): the approval runtime foundation, locked from the day it lands.
      'approval-runtime': 3,
      // QFJ-P08 (ADR-0081): the durable approval queue, locked from the day it lands.
      'postgres-approval-queue': 3,
      // QFJ-P08 (ADR-0082): the Core approval submission adapter, locked from the day it lands.
      'approval-core-adapter': 3,
      // QFJ-P08 (ADR-0083): the communication authorization correlation runtime, locked from the
      // day it lands.
      'communication-authorization-runtime': 3,
      // QFJ-P09.01 (ADR-0084): the execution intent correlation runtime, locked from the day it
      // lands. It validates Core's intent; it issues none.
      'execution-intent-runtime': 3,
      // QFJ-P08-A (ADR-0075): agent-runtime 45 -> 46 (the operations snapshot constructor) and
      // jarvis-runtime unchanged at 6. Both are named here so the composition phase that touched
      // them is locked centrally, not only in their own packages.
      'agent-runtime': 46,
      'jarvis-runtime': 6,
    };
    for (const [pkg, count] of Object.entries(expected)) {
      const barrel = (await import(
        `../../../../packages/${pkg}/dist/index.js`
      )) as unknown as Record<string, unknown>;
      expect(Object.keys(barrel)).toHaveLength(count);
    }
    // apps/api still publishes nothing from its root: the executables are bins, not an API.
    const api = (await import('../index.js')) as unknown as Record<string, unknown>;
    expect(Object.keys(api)).toHaveLength(0);
    // Real dynamic imports of built bundles, each pulling its own module graph. Like its twin in
    // the credential suite, this sits close enough to the 5s default that a busy machine turns it
    // into a timeout that says nothing about the API counts it exists to lock. Given an explicit
    // budget rather than left to lose a race with whatever runs beside it.
  }, 30_000);

  it('the two executables are declared as bins and each runs nothing on import', () => {
    const manifest = JSON.parse(readFileSync(join(APP_DIR, 'package.json'), 'utf8')) as {
      bin?: Record<string, string>;
    };
    expect(manifest.bin).toEqual({
      'qfj-generate-shadow-evidence': './dist/bin/generate-shadow-evidence.js',
      'qfj-run-shadow-once': './dist/bin/run-shadow-once.js',
    });
    // Only the bin entries execute; every other module is import-safe.
    for (const file of allFiles().filter((f) => !normalise(f).includes('/bin/'))) {
      const code = codeOnly(readFileSync(file, 'utf8'));
      expect(code).not.toMatch(/process\s*\.\s*exitCode/);
      expect(code).not.toMatch(/process\s*\.\s*argv/);
    }
  });
});
