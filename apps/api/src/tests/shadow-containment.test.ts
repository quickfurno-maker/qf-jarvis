/**
 * QFJ-S2-E-B — containment and activation safety for the controlled SHADOW runner (ADR-0065).
 *
 * The runner is the first `apps/api` code that composes a real gateway holding a real credential, so the
 * envelope is asserted rather than described: the composition root API has not grown, the ONE internal
 * subpath exports exactly one factory, `createProductionModelGateway` is still OFF-only and
 * non-activatable, the live model id lives only in configuration, no tool/QuickFurno Core Automation/database path exists, and
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
 * compose topology reference no QuickFurno Core Automation, Core, database or provider host, which it can only do by naming
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
  it('(127, 128) no SERVING source hard-codes a live provider model id', () => {
    // NARROWED, not relaxed (JF-5B-R1, ADR-0152).
    //
    // The rule protects the SHADOW path and every serving path: a model a deployment can reach without
    // a release naming it is a model nobody approved. The JF-5B certification runner is the opposite
    // case. It exists to say exactly which model was measured, and it must pin one -- a floating alias
    // there would mean a receipt that cannot be reproduced, which is the failure this rule is really
    // about.
    //
    // So the exception is ONE file, named by path, and the assertions below still hold it to the shape
    // of the rule: exactly one pinned id, never `latest`, never a wildcard.
    const CERTIFICATION_RUNNER = '/src/composition/jf5b-certification-runner-impl.ts';
    for (const file of allFiles().filter((f) => !normalise(f).includes('/tests/'))) {
      const text = readFileSync(file, 'utf8');
      if (normalise(file).endsWith(CERTIFICATION_RUNNER)) {
        // CODE, not documentation. This file necessarily WRITES DOWN the rule it obeys -- that the id
        // is pinned and never a floating alias -- and a raw-text scan would read the promise as the
        // breach. Every other file above is still scanned raw, because none of them has any business
        // naming a model id at all.
        const code = codeOnly(text);
        expect(code.match(/gpt-oss/g), file).toHaveLength(1);
        // CANDIDATE UPDATED, rule unchanged (JF-5B-R10). The rule is "a model id may be hard-coded in
        // exactly one JF-5B constant and nowhere else", and that is untouched. What changed is WHICH
        // model JF-5B certifies: run-12 proved `openai/gpt-oss-20b` cannot hold Riya's schema under
        // strict constrained generation, and `openai/gpt-oss-120b` is already permitted on the same
        // project at the same limits. One constant, one model, still pinned and never floating.
        expect(code, file).toContain("JF5B_GROQ_MODEL_ID = 'openai/gpt-oss-120b'");
        expect(code, file).not.toContain('latest');
        expect(code, file).not.toContain("modelId: '*'");
        // Still no endpoint: the host stays inside the gateway's own guarded transport.
        expect(code, file).not.toContain('groq.com');
        continue;
      }
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
   * pool through its public API; JF-6 additionally injects that caller-owned pool into the two
   * reviewed durable Riya adapters. The test harness applies migrations and reads rows back. Naming
   * all three files keeps this an exact, reviewed capability boundary.
   *
   * Everything else on the list below — QuickFurno Core Automation, WhatsApp, webhooks, tool calls, workflows, raw pools and
   * raw SQL — stays forbidden EVERYWHERE, including in these two.
   */
  const DATABASE_COMPOSITION_FILES: readonly string[] = Object.freeze([
    'src/jf6-private-process/create-riya-service-boundary.ts',
    // JF-7: the worker config validates the caller-supplied DatabaseConfig and the worker creates the
    // one caller-owned pool used only for Jarvis continuity/turn coordination. QuickFurno business
    // authority still comes from signed authority-v2 reads, never from this database.
    'src/quickfurno-whatsapp/production-worker-config.ts',
    'src/quickfurno-whatsapp/production-worker.ts',
    'src/runtime/durable-jarvis-runtime.ts',
    'src/tests/durable-database-harness.ts',
  ]);

  /**
   * The specs whose JOB is to forbid these tokens, and which therefore have to name them.
   *
   * Same reasoning as the `DIRECT_BUSINESS_OR_CORE_AUTOMATION_EXECUTION` substitution below, one level up: the
   * check is about CAPABILITY, not prose. `private-riya-web-ingress-containment.test.ts` (ADR-0097)
   * asserts that the ingress source contains none of these tokens, so its own forbidden-token list
   * necessarily contains them. Reading that list as a violation would mean a containment spec could
   * never state what it contains.
   *
   * Narrowed to a named list rather than "any file matching /containment/", so a new spec has to be
   * added here deliberately, and the exclusion buys nothing but the right to name a string.
   */
  const CONTAINMENT_VOCABULARY_SPECS: readonly string[] = Object.freeze([
    'src/tests/private-riya-web-ingress-containment.test.ts',
    // JF-4 (ADR-0149). Same reasoning, two more specs: they assert the customer orchestration
    // contains none of these tokens, so their own forbidden-token lists have to name them.
    'src/tests/jf4-customer-containment.test.ts',
    'src/tests/jf4-negative-controls.test.ts',
  ]);

  /**
   * The JF-4 customer orchestration (ADR-0149), which legitimately contains a Mastra WORKFLOW.
   *
   * An EXACT file list, and it buys exactly one token. `workflow` was forbidden across apps/api
   * because nothing here orchestrated anything; JF-4 deliberately places a bounded orchestration
   * shell on the customer path under its own ADR, so the ban is narrowed rather than dropped.
   *
   * Everything else on the list below -- QuickFurno Core Automation, WhatsApp, webhooks, tool calls, raw pools and raw SQL --
   * stays forbidden in these files too, and a separate JF-4 containment spec asserts the same set
   * again from the other direction.
   */
  const CUSTOMER_ORCHESTRATION_FILES: readonly string[] = Object.freeze([
    'src/riya-customer-orchestration/index.ts',
    'src/riya-customer-orchestration/contracts.ts',
    'src/riya-customer-orchestration/create-riya-customer-runtime.ts',
    'src/riya-customer-orchestration/governed-rag-knowledge-port.ts',
    'src/riya-customer-orchestration/mastra-customer-turn-runner.ts',
    // JF-4B/C/D (ADR-0150): the internal three-agent composition, which reuses the SAME workflow.
    'src/riya-customer-orchestration/three-agent-runtime.ts',
    // And the specs that exercise it: a test naming the workflow entry point it calls is not a
    // capability, and excluding them would mean the orchestration could never be tested by name.
    'src/tests/jf4-customer-orchestration.test.ts',
    'src/tests/jf4-customer-containment.test.ts',
    'src/tests/jf4-negative-controls.test.ts',
  ]);

  const DURABLE_ORCHESTRATION_FILES: readonly string[] = Object.freeze([
    // ADR-0154: the ONE API-side native Temporal client. It may name Temporal workflow operations,
    // but it carries no provider/business execution authority and every other forbidden token stays locked.
    'src/temporal/create-durable-orchestration-client.ts',
  ]);

  const QUICKFURNO_WHATSAPP_VOCABULARY_FILES: readonly string[] = Object.freeze([
    // Reviewed QuickFurno transport/processor seam. These files may name the WhatsApp surface,
    // but they acquire no provider send authority, tool capability, raw database handle or webhook.
    'src/quickfurno-whatsapp/contracts.ts',
    'src/quickfurno-whatsapp/quickfurno-http.ts',
    // Reviewed signed media-content reader. It may name the WhatsApp surface, but receives only
    // bounded QuickFurno-owned bytes and acquires no Meta credential or provider-send authority.
    'src/quickfurno-whatsapp/media-content-http.ts',
    'src/quickfurno-whatsapp/specialist-runtime.ts',
    'src/quickfurno-whatsapp/turn-processor.ts',
    'src/quickfurno-whatsapp/production-observation.ts',
    // JF-7 production worker: these named files are the reviewed private WhatsApp serving boundary.
    // Naming WhatsApp buys no provider-send authority: the worker emits only a signed proposal and
    // QuickFurno re-authorizes it at /whatsapp-reply.
    'src/bin/run-quickfurno-whatsapp-production-worker.ts',
    'src/quickfurno-whatsapp/authority-state-port.ts',
    'src/quickfurno-whatsapp/production-kill-switch.ts',
    'src/quickfurno-whatsapp/production-network.ts',
    'src/quickfurno-whatsapp/production-seal-binding.ts',
    'src/quickfurno-whatsapp/production-worker-config.ts',
    'src/quickfurno-whatsapp/production-worker.ts',
    'src/tests/quickfurno-whatsapp-authority-state-port.test.ts',
    'src/tests/quickfurno-whatsapp-production-observation.test.ts',
    'src/tests/quickfurno-whatsapp-deployment-containment.test.ts',
    'src/tests/quickfurno-whatsapp-production-seal-binding.test.ts',
    'src/tests/quickfurno-whatsapp-production-worker.test.ts',
    'src/tests/quickfurno-worker-deployment-containment.test.ts',
    'src/tests/quickfurno-whatsapp-http.test.ts',
    'src/tests/quickfurno-whatsapp-media-http.test.ts',
    'src/tests/quickfurno-whatsapp-media-content-http.test.ts',
    'src/tests/quickfurno-whatsapp-specialist-runtime.test.ts',
    'src/tests/quickfurno-whatsapp-turn-processor.test.ts',
    // E2E certification of the reviewed seam. Test-only: it may name WhatsApp while exercising
    // the already-authorized reader/specialist/reply/processor composition and gains no provider authority.
    'src/tests/quickfurno-whatsapp-riya-e2e.test.ts',
  ]);
  const QUICKFURNO_WHATSAPP_WORKFLOW_FILES: readonly string[] = Object.freeze([
    // The specialist seam reuses the existing bounded Mastra turn wrapper; it does not define a new workflow.
    'src/quickfurno-whatsapp/specialist-runtime.ts',
  ]);

  it('(130, 131) no tool, execution, workflow or database capability is reachable', () => {
    for (const file of allFiles()) {
      // `DIRECT_BUSINESS_OR_CORE_AUTOMATION_EXECUTION` is a red-team case KIND from `model-evaluation`: it names the
      // behaviour the candidate must REFUSE, and the evidence generator must enumerate it to cover the
      // mandatory set. Removing the identifier before scanning keeps the check on capability, not prose.
      const code = codeOnly(readFileSync(file, 'utf8'))
        .replace(/DIRECT_BUSINESS_OR_CORE_AUTOMATION_EXECUTION/g, 'MANDATORY_REFUSAL_KIND')
        .toLowerCase();
      const composesDatabase = DATABASE_COMPOSITION_FILES.some((allowed) =>
        normalise(file).endsWith(`/${allowed}`),
      );
      // JF-4: these files may name `workflow`, and nothing else on the list.
      const orchestratesCustomerTurn = CUSTOMER_ORCHESTRATION_FILES.some((allowed) =>
        normalise(file).endsWith(`/${allowed}`),
      );
      const orchestratesDurableJourney = DURABLE_ORCHESTRATION_FILES.some((allowed) =>
        normalise(file).endsWith(`/${allowed}`),
      );
      const namesQuickFurnoWhatsApp = QUICKFURNO_WHATSAPP_VOCABULARY_FILES.some((allowed) =>
        normalise(file).endsWith(`/${allowed}`),
      );
      const orchestratesQuickFurnoWhatsApp = QUICKFURNO_WHATSAPP_WORKFLOW_FILES.some((allowed) =>
        normalise(file).endsWith(`/${allowed}`),
      );
      if (CONTAINMENT_VOCABULARY_SPECS.some((allowed) => normalise(file).endsWith(`/${allowed}`))) {
        continue;
      }
      for (const forbidden of [
        'quickfurno-core-automation',
        ...(namesQuickFurnoWhatsApp ? [] : ['whatsapp']),
        'webhook',
        'toolcall',
        'tool_call',
        'tools:',
        ...(orchestratesCustomerTurn || orchestratesDurableJourney || orchestratesQuickFurnoWhatsApp
          ? []
          : ['workflow']),
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

  it('(130, 131) exactly five reviewed files name persistence, and four are production', () => {
    const naming = allFiles().filter((file) =>
      codeOnly(readFileSync(file, 'utf8')).toLowerCase().includes('event-backbone'),
    );
    expect(naming.map((f) => normalise(f).split('/apps/api/')[1] ?? '').sort()).toEqual([
      ...DATABASE_COMPOSITION_FILES,
    ]);
    // JF-6 durable composition + JF-7 worker config/pool + the existing durable runtime are
    // production seams; the harness remains test-only and excluded.
    expect(naming.filter((f) => !normalise(f).includes('/tests/'))).toHaveLength(4);
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
      // `close()` is permitted on the designated shadow file handle and on the JF-7 worker
      // process boundary, where it closes the caller-owned database pool during shutdown. Neither
      // location can refresh/rebind/dispose a provider.
      const closes = code.match(/\.\s*close\s*\(/g) ?? [];
      if (closes.length > 0) {
        const normalised = normalise(file);
        const isShadowReader = normalised.endsWith('/src/shadow/shadow-json-reader.ts');
        const isWorkerBin = normalised.endsWith(
          '/src/bin/run-quickfurno-whatsapp-production-worker.ts',
        );
        expect(isShadowReader || isWorkerBin).toBe(true);
        if (isShadowReader) expect(code).toMatch(/handle\.close\(\)/);
        if (isWorkerBin) expect(code).toMatch(/worker\?\.close\(\)/);
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

  it('(140) package and app sets remain exact, including reviewed ADR additions', () => {
    const dirs = (relative: string): string[] =>
      readdirSync(join(REPO_ROOT, relative))
        .filter((entry) => statSync(join(REPO_ROOT, relative, entry)).isDirectory())
        .sort();
    expect(dirs('packages')).toEqual([
      // QFJ-P12 / ADR-0085 (AVG-1): the Aarohi prospect identity and acquisition-case DOMAIN. Still
      // an EXACT set match -- this records an authorised addition, it does not relax the assertion.
      //
      // A domain, not a runtime: Aarohi's runtime status remains PLANNED / DISABLED. The package
      // depends on zod alone, imports no workspace package, and nothing imports it.
      'aarohi-agent',
      // JF-5A (ADR-0151): the governed prompt CONTENT packages Anisha and Aarohi did not have.
      // Still an EXACT set match -- this records two authorised additions, it does not relax the
      // assertion. Each owns ONE reviewed prompt body, depends on the prompt-registry constructor
      // and nothing else, and holds no provider, network, database, environment, credential or
      // business data. Content lives beside its agent; the registry stays a mechanism.
      'aarohi-prompts',
      // ADR-0153: the deterministic Action Kernel submission-control boundary. It carries no
      // provider or business authority; this exact-set lock records the reviewed addition.
      'action-kernel',
      'agent-runtime',
      // QFJ-S3-D-A (ADR-0070): the Anisha vendor-journey behaviour package. Still an EXACT set
      // match -- this records an authorised addition, it does not relax the assertion.
      'anisha-agent',
      'anisha-prompts',
      // QFJ-P08 (ADR-0082): the Core approval submission protocol. Still an EXACT set match -- this
      // records an authorised addition, it does not relax the assertion.
      'approval-core-adapter',
      // QFJ-P08 (ADR-0080): the approval runtime foundation -- Jarvis asks, Core decides. Still an
      // EXACT set match; it records an authorised addition, it does not relax the assertion.
      'approval-runtime',
      // QFJ-P08 (ADR-0083): the communication authorization correlation runtime -- Core owns consent,
      // this only proves the paperwork. Still an EXACT set match; it records an authorised addition.
      'communication-authorization-runtime',
      // QFJ-P09.05 (ADR-0110): the communication lifecycle TRANSITION runtime -- the coordination
      // policy `communication-state-record.ts` explicitly deferred, where `previousState` stops
      // being optional evidence and becomes a validated edge. Still an EXACT set match -- this
      // records an authorised addition, it does not relax the assertion.
      //
      // It validates records somebody else produced and produces none: no `setState`, no
      // `markDelivered`, no persistence, no transport, no migration, and a consistent transition
      // grants no send or authorization authority. It depends on `@qf-jarvis/contracts` alone and
      // nothing imports it.
      'communication-lifecycle-runtime',
      // QFJ-P08 (ADR-0133): the powerless CommunicationRequestV1 PRODUCER -- slice S1 of ADR-0132,
      // the missing counterpart to the correlation runtime above. Still an EXACT set match; it
      // records an authorised addition, it does not relax the assertion.
      'communication-request-runtime',
      'contracts',
      // QFJ-P08-A (ADR-0074): the conversation control command foundation. Still an EXACT set match
      // -- this records an authorised addition, it does not relax the assertion.
      // JOS-01B (ADR-0086): the framework-neutral read-only control-plane snapshot contract, shared
      // by Jarvis OS today and by a future Android client. Still an EXACT set match -- this records
      // an authorised addition, it does not relax the assertion. It depends on zod alone: no Node
      // API, no network, no persistence, no provider, and no authority field it could express.
      'control-plane-read-contract',
      'conversation-control',
      // ADR-0161: read-only Core data-tool composition over already-governed Core ports. It exposes
      // no write operation, invents no adapter or credential, and re-proves every returned value
      // through the canonical Core contract parser before it reaches the tool result.
      'core-data-tools',
      'core-decision-adapter',
      // QFJ integration transport: one signed qfj.core.decision HTTP hop behind the existing Core
      // transport contract. Still an EXACT set match; this records an authorised, non-activating
      // transport leaf rather than weakening the shadow package-containment assertion.
      'core-decision-http-transport',
      // RWC-P5 (ADR-0100): the Core-owned service availability READ contract -- which cities
      // QuickFurno Core operates in, which services it sells, and which service is available in
      // which city, as an explicit PAIR property. Still an EXACT set match; it records an authorised
      // addition, it does not relax the assertion. It is a CONTRACT with no implementation: no HTTP,
      // fetch, URL, credential, environment read, database, cache, clock or model, and no live
      // QuickFurno adapter -- the final integration handshake supplies that. It knows nothing about
      // Riya, holds no city or service literal, and has no default or fallback of any kind.
      // RWC-P6A (ADR-0101): the Core-owned boundary for Riya's post-summary intake -- contact
      // readiness, consent state, and a powerless canonical submission whose ACCEPTED result is the
      // only source of a completion evidence reference. Still an EXACT set match; it records an
      // authorised addition, it does not relax the assertion. It is a CONTRACT with no
      // implementation: no HTTP, credential, environment read, database, clock, model or live
      // QuickFurno adapter, and no grantConsent, captureContact or canSubmit anywhere. It reuses
      // neither ClientConfirmationV1 nor CommunicationAuthorizationV1.
      'core-riya-intake',
      'core-service-availability-read',
      // ADR-0162: deterministic no-effect digital-twin scenario runner. It accepts only injected
      // candidates, refuses any simulated provider/Core/channel/workflow/database effect, and owns
      // no transport, provider, database or production activation surface.
      'digital-twin-simulation',
      // ADR-0154: content-minimized contracts for native Temporal orchestration. Contract-only;
      // execution authority stays with QuickFurno Core and Core Automation.
      'durable-orchestration-contracts',
      'event-backbone',
      'event-ingestion',
      // QFJ-P09.04 (ADR-0109): the durable execution dispatch composition binding the merged
      // P09.02 verifier to the merged P09.03 durable store. Still an EXACT set match -- this
      // records an authorised addition, it does not relax the assertion.
      //
      // It adopts no transport and executes nothing: the composition exists so a dispatch
      // boundary is restart-durable BY CONSTRUCTION and cannot be assembled with an in-memory
      // guard by mistake.
      'execution-dispatch-composition',
      // QFJ-P09.02 (ADR-0090): the test-only Core -> QuickFurno Core Automation execution DISPATCH boundary. It holds no
      // transport, and no application imports it. Its ONE consumer is the durable replay store
      // below, which implements the guard contract this package declares.
      'execution-dispatch-runtime',
      // QFJ-P09.01 (ADR-0084): the execution intent correlation runtime -- Core issues, QuickFurno Core Automation executes,
      // this only correlates. Still an EXACT set match; it records an authorised addition.
      'execution-intent-runtime',
      // ADR-0162: Core-evidence-bound Riya/Anisha/Aarohi handoff PROPOSALS only. It changes no
      // assignment, starts no workflow and creates no business effect.
      'governed-agent-handoff',
      'governed-knowledge',
      // ADR-0161: policy/runtime governed long-term-memory foundation. Durable memory is default-OFF,
      // canonical ADR-0016 contracts stay authoritative, and the package itself has no database I/O.
      'governed-memory-foundation',
      'groq-staging-smoke',
      // ADR-0161: proposal-only JAO action metadata. Engineering actions ship disabled and the
      // strongest possible assessment is ELIGIBLE_FOR_PROPOSAL, never execution or authorization.
      'jao-action-registry',
      'jarvis-runtime',
      // JF-7: neutral immutable serving facts shared by offline certification and production. No
      // credential, network, evidence minting, rollout or business-authority surface.
      'jarvis-v1-production-profile',
      // JF-5C (ADR-0155): pure production-evidence sealing only. It consumes the reviewed
      // JF-5B manifest and mints no runtime, provider, network, database or activation surface.
      'jarvis-v1-production-seal',
      // JF-5B (ADR-0152): the live certification OPERATOR. Still an EXACT set match -- this
      // records an authorised addition, it does not relax the assertion. Evaluation only and off
      // the serving path: no production package or app imports it, it holds no business
      // authority, it reaches no database, and a live provider call needs an explicit flag AND a
      // phrase typed at a terminal.
      'jarvis-v1-provider-certification-live',
      // ADR-0161: deterministic source-revision/digest/approval drift assessment. It may
      // make a changed approved corpus eligible for a STAGING build, but cannot ingest, seal,
      // activate or publish a release.
      'knowledge-freshness',
      // ADR-0158: the shared provider-neutral hybrid retrieval core and deterministic ingestion plane.
      // These additions are explicit and exact; they add no agent-specific authority or serving app.
      'knowledge-index',
      'knowledge-ingestion',
      'model-evaluation',
      'model-gateway',
      'model-gateway-composition',
      // ADR-0162: pure adaptive certified-release selection, evidence-derived answer posture and
      // certified fallback PLANNING. It invokes no provider and creates no rollout authority.
      'model-intelligence-control',
      'model-reply-adapter',
      // ADR-0162: safe WhatsApp multimodal planning over already-minimized metadata/captions.
      // It never downloads media and never claims to understand unseen provider content.
      'multimodal-turn-planning',
      // ADR-0158: bounded OpenAI-compatible embedding transport. Policy remains in knowledge-index.
      'openai-compatible-embedding-adapter',
      // JOS-01G: versioned operator contracts and framework-neutral client core. These packages
      // contain schemas/client orchestration only; no provider, database, credential or business
      // authority is introduced by recording them in the exact package set.
      'operator-api-contract',
      'operator-client-core',
      // QFJ-P08 (ADR-0081): the durable approval queue and audit. Still an EXACT set match -- this
      // records an authorised addition, it does not relax the assertion.
      'postgres-approval-queue',
      // QFJ-P08-B2 (ADR-0077): the durable PostgreSQL conversation-state adapter. Still an EXACT
      // set match -- this records an authorised addition, it does not relax the assertion.
      'postgres-conversation-state',
      // QFJ-P09.03 (ADR-0091): the durable execution replay / idempotency store -- the PostgreSQL
      // implementation of the guard P09.02 declared and deliberately left defaultless. Still an
      // EXACT set match; it records an authorised addition, it does not relax the assertion. It is
      // TRANSPORT-NEUTRAL: no endpoint, no QuickFurno Core Automation, no provider, no credential, no intent payload.
      'postgres-execution-replay-store',
      // ADR-0161: disconnected PostgreSQL adapter for canonical derived agent memory. The schema
      // artifact is source-only and is not part of the managed migration ledger.
      'postgres-governed-memory-store',
      // ADR-0158: immutable PostgreSQL full-text + pgvector index and sealed-release pointer.
      'postgres-knowledge-index',
      // RWC-P2B (ADR-0095): the durable PostgreSQL Riya conversation-continuity store -- the
      // implementation of the port RWC-P2C declared and deliberately left injected with no default.
      // Still an EXACT set match; it records an authorised addition, it does not relax the
      // assertion. It composes nothing: no HTTP, no ingress, no browser reachability, and no
      // application imports it.
      'postgres-riya-conversation-continuity-store',
      // RWC-P8 (ADR-0104): the durable Riya turn coordinator -- one in-flight text turn per
      // canonical conversation across replicas, and a logical message that cannot run twice. Still
      // an EXACT set match; it records an authorised addition, it does not relax the assertion.
      'postgres-riya-turn-coordinator',
      // QFJ-S3-I-A (ADR-0072): the versioned prompt registry foundation. Still an EXACT set match --
      // this records an authorised addition, it does not relax the assertion.
      'prompt-registry',
      // JOS-01F/G: bounded transport schemas for the separately signed Core observation and
      // operator-command lanes. Contracts only; transport and authority remain outside packages.
      'quickfurno-operator-command-contract',
      'quickfurno-operator-observation-contract',
      'rag-provisioning',
      // QFJ-P05.05 (ADR-0079): the governed recommendation runtime -- the producer for contracts
      // that already existed. Still an EXACT set match; it records an authorised addition.
      'recommendation-runtime',
      // ADR-0166: framework-neutral, content-free exact-release assurance observations for Jarvis OS
      // and the future mobile client. It carries no log, credential, provider, database or authority;
      // recording it here preserves the EXACT package-set lock rather than weakening containment.
      'release-assurance-observation-contract',
      // QFJ-S3-C (ADR-0067): the Riya client-sales behaviour package. Still an EXACT set match --
      // this records an authorised addition, it does not relax the assertion.
      'riya-agent',
      // MVP-P2A.1: the OFFLINE candidate evaluation bridge -- the missing step between a real
      // model candidate and the two evaluation authorities. Still an EXACT set match; it records
      // an authorised addition, it does not relax the assertion. It holds no provider, no
      // credential and no network, and no runtime, service or app imports it.
      'riya-ai-synthetic-generation',
      // QFJ AS3A (ADR-0143 §4): the OFFLINE real-provider control plane. Still an EXACT set match --
      // this records an authorised addition, it does not relax the assertion.
      //
      // It exists so that the AS2 generation harness never has to hold a provider SDK: the OpenAI and
      // Anthropic clients live here, behind AS2's invocation port. No app, runtime, serving path or
      // API composition imports it, and its own containment spec proves that in both directions.
      'riya-ai-synthetic-provider-adapters',
      'riya-candidate-evaluation-runner',
      // MVP-P2A.2: the EVALUATION-ONLY live evidence operator -- the one composition allowed to
      // depend on both evaluation and execution, so that combination lives in exactly one reviewable
      // place off the serving path. Still an EXACT set match; it records an authorised addition, it
      // does not relax the assertion. It writes no HTTP, holds no credential beyond one masked read
      // per phase, retries nothing, activates no rollout, and no package or app imports it.
      'riya-candidate-evidence-live',
      // RWC-P6A (ADR-0101): the PURE post-summary transitions RWC-P4A stopped short of -- structured
      // summary edit and confirmation, and the two governed advances CONTACT->CONSENT and
      // CONSENT->COMPLETE. Still an EXACT set match; it records an authorised addition, it does not
      // relax the assertion. It is the ONLY producer of user_confirmed, it delegates every discovery
      // decision to the real P4A reducer, and it is pure: no model, clock, randomness, I/O,
      // compare-and-set or Core call, which is what lets RWC-P6B re-run it during a reconciliation.
      'riya-conversation-completion',
      // RWC-P2A (ADR-0093): Riya's conversational continuity CONTRACT -- the working state one
      // conversation carries between turns. Still an EXACT set match; it records an authorised
      // addition, it does not relax the assertion. It is contract-only: no database, migration,
      // adapter, transport, web service, reducer, extraction, transcript or business authority, and
      // it is NOT ADR-0016 agent memory.
      'riya-conversation-continuity',
      // RWC-P4A (ADR-0098): the PURE, channel-neutral conversation evolution semantics -- the phase
      // reducer, the provenance merge and the next-question plan that RWC-P2A's contract package
      // deliberately refused to contain. Still an EXACT set match; it records an authorised
      // addition, it does not relax the assertion. It is pure: no model, no prompt, no clock, no
      // randomness, no I/O, no database, no compare-and-set, no HTTP and no business authority, and
      // it depends only on `riya-agent` and `riya-conversation-continuity`.
      'riya-conversation-evolution',
      // RID-F1 (ADR-0107): the OFFLINE Riya intelligence dataset factory -- the canonical
      // multi-turn training trajectory, lineage-isolated splits, the protected RWC-P10
      // exam-leakage firewall, deterministic privacy/secret gates, the volatile-business-fact
      // rule, risk-based review, SHA-256 dataset identity and DERIVED model-neutral SFT rows.
      // Still an EXACT set match; it records an authorised addition, it does not relax the
      // assertion. It TRAINS NOTHING and INVOKES NOTHING: no model, provider, gateway, HTTP,
      // LLM-as-judge, embedding, tokenizer, PyTorch/PEFT/LoRA/TRL, checkpoint or training loop,
      // no database, migration or deployment, and no runtime may import it. Sources are
      // synthetic only -- a live conversation is not representable -- and release evidence is
      // always syntheticOnly with trainingApproval=false. Its ONE Node capability is
      // node:crypto, used solely for SHA-256 artifact identity.
      'riya-intelligence-dataset',
      // RMB-A: the OFFLINE, provider-neutral operational model-benchmark foundation -- the THIRD and
      // narrowest evidence authority, beside generic safety (`model-evaluation`) and Riya sales
      // quality (`riya-quality-evaluation`). Still an EXACT set match; it records an authorised
      // addition, it does not relax the assertion. It MEASURES NOTHING and INVOKES NOTHING: numbers
      // arrive pre-supplied from a harness that ran elsewhere, and there is no HTTP, provider SDK,
      // gateway, inference engine, model download, child_process, environment lookup, filesystem
      // discovery, database, embedding or training framework. It carries no customer message,
      // assistant reply, system prompt, Gold trajectory or P10 fixture body -- a prompt reaches it
      // as a digest -- and no hostname, username, path, serial, MAC, IP or credential. Release
      // identity is REUSED from `model-evaluation` rather than forked. Every artifact is
      // syntheticWorkload with productionApproval=false, comparison demands exact measurement parity,
      // and there is no composite score, winner, recommendation or rollout approval anywhere in the
      // surface: speed is not quality, quality is not safety, and none of the three ships anything.
      'riya-model-benchmark',
      // RMB-B: the OFFLINE operational benchmark HARNESS -- the deterministic scheduler that produces
      // the numbers RMB-A turns into evidence. Still an EXACT set match; it records an authorised
      // addition, it does not relax the assertion. It BENCHMARKS NOTHING REAL: execution happens only
      // through an injected target port, every target it has run against is a fake, and there is no
      // provider SDK, model-gateway invocation, local inference engine, model download, HTTP,
      // child_process, environment lookup, filesystem discovery, database or training framework. It
      // reads NO ambient clock -- every instant comes through a monotonic port and `createdAt` is
      // injected -- and it sleeps, waits and retries nowhere, because a retrying benchmark measures a
      // retry policy. Prompts reach it as digests and token counts, so no customer message, Riya
      // reply, Human Gold trajectory or P10 fixture body can enter. It reimplements no digest,
      // manifest or comparison: RMB-A remains the one evidence authority. A protocol, identity or
      // clock failure invalidates the WHOLE suite rather than emitting a partial result set, and the
      // production model gateway is untouched -- a real adapter belongs behind the target port in a
      // later slice, not as benchmark instrumentation on the path that serves customers.
      'riya-model-benchmark-harness',
      // RWC-P4B (ADR-0099): the Riya half of the ONE structured model call -- the content-minimised
      // continuity projection sent as the single user message, the strict reply+observations schema,
      // the narrowed model provenance vocabulary, and the check that the model's claimed question
      // plan matches what the RWC-P4A reducer decides. Still an EXACT set match; it records an
      // authorised addition, it does not relax the assertion. It INVOKES NOTHING: no gateway invoker,
      // provider, database, HTTP, Core adapter, clock, randomness, transcript or raw model result --
      // it is a profile handed to the generic M4 adapter, which is what keeps one turn to one call.
      'riya-model-interaction',
      // MVP-P2A.2-P: the governed Riya prompt definitions -- the CONTENT boundary
      // `prompt-registry` deliberately does not have, so the mechanism can stay content-free
      // while one canonical copy of the prompt bytes is importable by both a production
      // composition and the candidate evidence operator. Still an EXACT set match; it records an
      // authorised addition, it does not relax the assertion. It defines prompts and reaches
      // nothing: no model, no provider, no gateway, no network, no database, no activation.
      'riya-prompts',
      // RWC-P10 (ADR-0106): the Riya-SPECIFIC quality, evaluation and sales-optimization layer,
      // sitting ABOVE the generic @qf-jarvis/model-evaluation safety authority rather than
      // replacing it -- a quality candidate binding can only be DERIVED from an existing
      // ACTIVE/SHADOW/CANARY ApprovalEvidence, so quality cannot exist without safety evidence.
      // Still an EXACT set match; it records an authorised addition, it does not relax the
      // assertion. It INVOKES NOTHING: no gateway, provider, local inference, HTTP, LLM-as-judge,
      // scoring prompt, embeddings, database, migration, clock or randomness. Subjective sales
      // quality comes from exactly two independent HUMAN reviews, thresholds are per-dimension
      // basis points with no global average, and its evidence is synthetic with
      // productionApproval=false and no rollout bridge -- it activates nothing.
      'riya-quality-evaluation',
      // RWC-P2C (ADR-0094): the PRIVATE Riya web conversation service. Still an EXACT set match; it
      // records an authorised addition, it does not relax the assertion. It is an application
      // service with no ingress: no HTTP server, route, public endpoint, browser reachability,
      // database, migration, provider or live send, and nothing imports it.
      'riya-web-conversation-service',
      // ADR-0162: privacy-bounded public-knowledge semantic cache primitives and deterministic
      // extractive context compression/retrieval planning. No subject/conversation cache exists.
      'semantic-context-engine',
      // ADR-0159: pure content-free wire contract for read-only worker observations.
      'worker-observation-contract',
    ]);
    // JOS-01A (docs/architecture/jarvis-os.md): the Jarvis OS operator control plane. Still an
    // EXACT set match -- this records authorised additions, it does not relax the assertion.
    // Jarvis OS is a POWERLESS read surface. quickfurno-gateway is a separate, narrowly-scoped
    // machine ingress: it authenticates QuickFurno with Ed25519 but owns no database, provider,
    // business authority, or Jarvis OS session surface.
    expect(dirs('apps')).toEqual([
      'api',
      'jarvis-os',
      'quickfurno-gateway',
      'temporal-worker',
      'worker',
    ]);
  });

  it('(RWC-P5) no production source anywhere invents a city or a service', () => {
    // The rule that makes the whole slice mean something. QuickFurno Core owns the catalogue, so a
    // place name or a service name appearing in production source is Jarvis starting to own a fact
    // that is not its own -- and the first thing such a constant becomes is a fallback.
    //
    // Fixtures and specs are excluded: a spec must name a synthetic city to have anything to test.
    const offenders: string[] = [];
    for (const root of ['packages', 'apps']) {
      const base = join(REPO_ROOT, root);
      for (const entry of readdirSync(base)) {
        const src = join(base, entry, 'src');
        let files: string[];
        try {
          files = walk(src);
        } catch {
          continue;
        }
        for (const file of files) {
          const normalised = normalise(file);
          if (
            normalised.includes('/tests/') ||
            normalised.includes('/testing/') ||
            normalised.includes('/fixtures') ||
            normalised.includes('/testing.ts')
          ) {
            continue;
          }
          // Comments stripped, as every scanner in this file does. A doc comment that says a
          // taxonomy label looks like "Pune" is documentation, not a constant Jarvis relies on --
          // and forcing the contracts package to stop illustrating its own primitives would make the
          // rule cost more than it buys. What is forbidden is a NAME IN CODE.
          const text = codeOnly(readFileSync(file, 'utf8')).toLowerCase();
          for (const forbidden of [
            'pune',
            'mumbai',
            'bengaluru',
            'nashik',
            'defaultcity',
            'fallbackcity',
            'assumeavailable',
          ]) {
            if (text.includes(forbidden)) {
              offenders.push(`${normalised}: ${forbidden}`);
            }
          }
        }
      }
    }
    expect(offenders).toStrictEqual([]);
  });

  it('(141-148) every prior package-root runtime API lock still holds', async () => {
    const expected: Readonly<Record<string, number>> = {
      // ADR-0160: 35 -> 41 for pure evaluation-impact plus model/embedding cost intelligence.
      // No provider transport, activation authority, secret, environment read or business action.
      'model-evaluation': 41,
      // MVP-P2A.2 HF4-R7: 71 -> 74 for the Groq strict-schema projection —
      // `projectGroqStrictJsonSchema`, `renderStructuredJsonSchema`, `GROQ_STRICT_PROJECTION_REASONS`.
      // Restated exactly; the count is still pinned.
      // POST-MD120B3: 74 -> 77. The DIAGNOSTIC-ONLY Groq Responses API surface —
      // `GROQ_RESPONSES_ENDPOINT`, `createFetchGroqResponsesTransport`,
      // `createGroqResponsesDiagnosticProvider`. MD120B3 reproduced the strict Chat Completions
      // rejection across BOTH governed GPT-OSS models, so the next diagnostic moves the OUTPUT
      // CONTRACT. Nothing registers a provider, declares a capability or joins the routing table;
      // the serving path stays Chat Completions and a spec proves no production composition builds
      // either factory.
      // POST-RSP20B2 FORENSICS: 77 -> 79. The DIAGNOSTIC-ONLY Chat Completions reasoning-effort
      // adapter and the documented GPT-OSS default. Production still sends no reasoning field, and
      // the diagnostic's own spec asserts that before it asserts anything else.
      // POST-RBD1: 79 -> 80. The DIAGNOSTIC-ONLY best-effort `json_schema` adapter. Production's
      // `buildResponseFormat` is untouched -- its non-strict branch still returns `json_object` --
      // and no production path can ask for `strict: false` with a schema.
      // JF-2A (ADR-0146): 80 -> 93. The NaraRouter hosted provider (6 symbols) and the V1
      // provider-SELECTION mode (7). This lock only tracks that package's count; the reasoning is
      // recorded in its own containment spec. Nothing about this app changes, and production
      // inference stays OFF.
      // JF-5B (ADR-0152): 93 -> 95. The Nara alias guard and its frozen refusal list become
      // reachable so an operator outside the gateway can refuse a router alias returned by
      // authenticated discovery. A pure predicate: no key, no transport, no behaviour change.
      'model-gateway': 95,
      'model-gateway-composition': 2,
      // MVP-P2A.2 HF1: 24 -> 27. The semantic approval-digest helper and its two readable parts.
      // Pure functions over an already-parsed SmokeConfig -- no filesystem, no clock, no network, no
      // credential.
      // MVP-P2A.2 HF4-R4: 27 -> 28. `createSystemSmokeWireDeps`, the ONE pairing of the instrumented
      // transport with the recorder that owns its wire milestones. RUN S5's smoke PASSED while
      // printing every wire milestone ABSENT because that pairing was a convention duplicated across
      // two composition roots and the second one got it wrong. It exposes no internals, reads no
      // environment, holds no credential, and changes no request, timer or retry semantic.
      // Restated exactly; the count is still pinned.
      // MVP-P2A.2 HF4-R5: 28 -> 30. `createClipboardCredentialResolver` and
      // `createWindowsPowerShellClipboardSource`, the one-shot Windows clipboard credential ingress
      // the owner asked for so the credential is copied once instead of typed twice. Both are needed
      // by the candidate evidence operator, which is the composition root that selects an ingress;
      // the helper program, its arguments, its exit codes and its output bound stay module-private.
      // Restated exactly; the count is still pinned.
      'groq-staging-smoke': 30,
      // D2a (ADR-0138) removed exactly one root symbol: `storeValidatedEvent`, the
      // accepted-event write authority. It is now reachable only through the governed
      // `internal/event-write` subpath, which lint restricts to the ingestion bridge.
      'event-backbone': 38,
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
      // QFJ-P08 (ADR-0133): the powerless CommunicationRequestV1 producer, locked from the day it
      // lands. It ASKS; it authorizes nothing.
      'communication-request-runtime': 3,
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

  it('the three executables are declared as bins and each runs nothing on import', () => {
    const manifest = JSON.parse(readFileSync(join(APP_DIR, 'package.json'), 'utf8')) as {
      bin?: Record<string, string>;
    };
    // JF-5B-R1 (ADR-0152) adds the third, and it is a DECLARATION that matches a file: the JF-5B
    // harness previously declared a bin whose source did not exist, which is how a lane can report an
    // executable it never had. The path is asserted against the emitting build's output, and
    // `jf5b-bin-exists.test.ts` asserts that both the source and the compiled file are really there.
    expect(manifest.bin).toEqual({
      'qfj-generate-shadow-evidence': './dist/bin/generate-shadow-evidence.js',
      'qfj-jf5b-certify': './dist/bin/run-jf5b-live-certification.js',
      'qfj-run-shadow-once': './dist/bin/run-shadow-once.js',
    });
    // Only the bin entries execute; every other module is import-safe.
    //
    // `jf5b-bin-exists.test.ts` is excluded for the usual reason a scanner is excluded from its own
    // scan: it exists to assert that the certification bin DOES read argv and DOES set an exit code,
    // so it necessarily writes both strings down. It executes neither.
    const BIN_SPEC = '/src/tests/jf5b-bin-exists.test.ts';
    for (const file of allFiles().filter(
      (f) => !normalise(f).includes('/bin/') && !normalise(f).endsWith(BIN_SPEC),
    )) {
      const code = codeOnly(readFileSync(file, 'utf8'));
      expect(code).not.toMatch(/process\s*\.\s*exitCode/);
      expect(code).not.toMatch(/process\s*\.\s*argv/);
    }
  });
});
