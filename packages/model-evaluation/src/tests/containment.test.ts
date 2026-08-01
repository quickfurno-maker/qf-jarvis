/**
 * QFJ-P04.04 — observability, authority, and containment (ADR-0052 §O, §P, §Q, §R).
 *
 * Matrix items 49–65: content-free events; evaluation grants no authority; scopes distinct; the
 * Conversation Operations Center is documented-mandatory but absent; no semantic/RAG; no live call/
 * provider SDK/DB/secret/n8n dependency; the public API is locked; migrations exact with no 0008; the
 * event-backbone root API remains 39; and no tracked source carries a control byte.
 */
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import * as barrel from '../index.js';
import { EVALUATION_AGENT_SCOPES, EVALUATION_APPROVAL_TARGETS } from '../contracts/vocabularies.js';
import type { EvaluationEvent, EvaluationObservabilityHook } from '../contracts/observability.js';
import { createCandidateObservation } from '../contracts/observation.js';
import { scenarioKey } from '../contracts/scenario.js';
import { evaluateSuite } from '../service/evaluate-suite.js';
import { createApprovalEvidence } from '../service/create-evidence.js';
import {
  SYNTHETIC_PROMPT_DIGEST,
  SYNTHETIC_PROMPT_TEMPLATE,
  buildFoundationScenarios,
  buildFoundationSuite,
  safeObservations,
} from '../testing/fixtures.js';

const REPO_ROOT = new URL('../../../../', import.meta.url);
const PKG_DIR = new URL('../../', import.meta.url);

function repoPath(rel: string): string {
  return fileURLToPath(new URL(rel, REPO_ROOT));
}
function readRepo(rel: string): string {
  return readFileSync(repoPath(rel), 'utf8');
}
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
const productionFiles = (): string[] =>
  walk(fileURLToPath(new URL('src', PKG_DIR))).filter(
    (f) => !f.replace(/\\/g, '/').includes('/tests/'),
  );

// eslint-disable-next-line no-control-regex
const CONTROL_BYTE = new RegExp('[\\x00-\\x08\\x0b-\\x1f\\x7f]');

const LOCKED_MIGRATION_HASHES: Record<string, string> = {
  '0001_event_log.sql': 'dbca835c394dc67f015176af8ae0582faa78e0c1299593ac8970c5abf4389d6a',
  '0002_event_runtime_grants.sql':
    '4a6536afc23e53eb8f4ab91516e8bdc6700495a27ec386a99dbfb072719f736c',
  '0003_ingestion_rejection_and_event_conflict.sql':
    '407bea56929b592d93337892f6ee95ac006f3b4001dedb135151ccfb5b36ab0c',
  '0004_projection_foundation.sql':
    '148b31ea95f3ae90274cdc74381b8d1fb3be9caa0dfe7ff96771240a7c29cc30',
  '0005_projection_event_positions.sql':
    '96d641ad0c3ea47843ab9de00cf4ab9847fad6a0164bbacadf5c7ed439ccccae',
  '0006_projection_failure_operations.sql':
    'e97059a506ec4377fa39194de4fdc54e7d2f237941fb1e5243a0b01ff40a83d4',
  '0007_subject_activity_projection.sql':
    '8823b528d9e5aaccad7ddb6e16ebe254662c9759d14321fd3a6fa2e62b6dee49',
};

function recorder(): { hook: EvaluationObservabilityHook; events: EvaluationEvent[] } {
  const events: EvaluationEvent[] = [];
  return { hook: { onEvent: (e) => events.push(e) }, events };
}

describe('observability and authority', () => {
  it('(49,50) emits content-free events with no prompt/output/subject/secret', () => {
    const suite = buildFoundationSuite();
    const safe = safeObservations(suite);
    const secret = buildFoundationScenarios().find(
      (s) => s.redTeamKind === 'REVEAL_SECRET_OR_PROMPT',
    );
    if (secret !== undefined) {
      safe.set(
        scenarioKey(secret.scenarioId, 1),
        createCandidateObservation({
          scenarioId: secret.scenarioId,
          scenarioVersion: 1,
          text: 'leak sk-REDACTED-SENTINEL',
          routedContentDataClass: 'HOSTED_ALLOWED',
        }),
      );
    }
    const { hook, events } = recorder();
    evaluateSuite(suite, safe, { observability: hook });
    expect(events.length).toBeGreaterThan(0);
    const serialized = JSON.stringify(events);
    for (const forbidden of ['sk-REDACTED-SENTINEL', 'safe synthetic output', 'leak ']) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it('(51,52) evaluation grants no authority and has no execute/send/callN8n method', () => {
    const suite = buildFoundationSuite();
    const result = evaluateSuite(suite, safeObservations(suite)) as unknown as Record<
      string,
      unknown
    >;
    const evidence = createApprovalEvidence(
      evaluateSuite(suite, safeObservations(suite)),
      'ACTIVE_MODEL_RELEASE',
    );
    for (const method of ['authorize', 'execute', 'send', 'callN8n', 'promote', 'activate']) {
      expect(result[method]).toBeUndefined();
      if (evidence.ok) {
        expect((evidence.evidence as unknown as Record<string, unknown>)[method]).toBeUndefined();
      }
    }
  });

  it('(53) keeps agent scopes distinct', () => {
    expect([...EVALUATION_AGENT_SCOPES]).toEqual(['CLIENT', 'VENDOR', 'COORDINATION', 'SYSTEM']);
    expect(new Set(EVALUATION_AGENT_SCOPES).size).toBe(EVALUATION_AGENT_SCOPES.length);
  });

  it('(54) documents the Conversation Operations Center as mandatory-later but implements none of it', () => {
    const adr = readRepo(
      'docs/decisions/ADR-0052-qfj-p04-04-evaluation-and-red-team-foundation.md',
    );
    expect(adr).toMatch(/Conversation Operations Center/);
    expect(adr).toMatch(/mandatory later phase/i);
    for (const file of productionFiles()) {
      const text = readFileSync(file, 'utf8').toLowerCase();
      expect(text).not.toContain('whatsapp');
      expect(text).not.toContain('dashboard');
    }
  });

  it('(55) keeps declared/observed/approved distinct — evidence is never production approval', () => {
    const suite = buildFoundationSuite();
    const evidence = createApprovalEvidence(
      evaluateSuite(suite, safeObservations(suite)),
      'ACTIVE_MODEL_RELEASE',
    );
    expect(evidence.ok && evidence.evidence.productionApproval).toBe(false);
    expect(evidence.ok && evidence.evidence.synthetic).toBe(true);
  });

  /**
   * QFJ-S2-C-B (ADR-0063 §3, §4). `CONNECTIVITY_SMOKE` joins the closed target vocabulary, and the
   * approval flags widen from literals to booleans so a future non-synthetic production path can exist.
   *
   * The target→rollout-mode ladder is NOT asserted here: it needs the gateway's `GatewayMode`, which
   * this package must never import. It lives — and is tested — in `@qf-jarvis/model-gateway-composition`.
   */
  it('(1) CONNECTIVITY_SMOKE is a member of the closed approval-target vocabulary', () => {
    expect([...EVALUATION_APPROVAL_TARGETS]).toContain('CONNECTIVITY_SMOKE');
    expect(EVALUATION_APPROVAL_TARGETS).toHaveLength(5);
    expect(new Set(EVALUATION_APPROVAL_TARGETS).size).toBe(5);
  });

  it('(8, 12, 15) the approval flags are booleans, evidence stays frozen, and none is production', () => {
    const suite = buildFoundationSuite();
    const result = evaluateSuite(suite, safeObservations(suite));
    for (const target of EVALUATION_APPROVAL_TARGETS) {
      const evidence = createApprovalEvidence(result, target);
      if (!evidence.ok) {
        continue;
      }
      // (8) booleans, not literals — the type widened, the runtime values did not.
      expect(typeof evidence.evidence.synthetic).toBe('boolean');
      expect(typeof evidence.evidence.productionApproval).toBe('boolean');
      // (15) this slice manufactures NO production artifact: the generator still emits synthetic-only.
      expect(evidence.evidence.synthetic).toBe(true);
      expect(evidence.evidence.productionApproval).toBe(false);
      // Synthetic AND production-approved is the combination that must never appear.
      expect(evidence.evidence.synthetic && evidence.evidence.productionApproval).toBe(false);
      // (12) still frozen.
      expect(Object.isFrozen(evidence.evidence)).toBe(true);
      expect(Object.isFrozen(evidence.evidence.binding)).toBe(true);
    }
  });

  it('(13, 14) the digest stays deterministic and the existing evidence gates are unchanged', () => {
    const suite = buildFoundationSuite();
    const a = createApprovalEvidence(
      evaluateSuite(suite, safeObservations(suite)),
      'CONNECTIVITY_SMOKE',
    );
    const b = createApprovalEvidence(
      evaluateSuite(suite, safeObservations(suite)),
      'CONNECTIVITY_SMOKE',
    );
    expect(a.ok && b.ok).toBe(true);
    if (a.ok && b.ok) {
      // (13) same inputs, same reference and same digests — no clock, no randomness.
      expect(a.evidence.evaluationRef).toBe(b.evidence.evaluationRef);
      expect(a.evidence.suiteResultDigest).toBe(b.evidence.suiteResultDigest);
      expect(a.evidence.caseSetDigest).toBe(b.evidence.caseSetDigest);
    }
    // (14) a tampered case-set digest is still refused by the pre-existing integrity gate.
    const result = evaluateSuite(suite, safeObservations(suite));
    const tampered = { ...result, caseSetDigest: 'deadbeef' };
    const refused = createApprovalEvidence(tampered, 'ACTIVE_MODEL_RELEASE');
    expect(refused).toEqual({ ok: false, code: 'evidence-digest-invalid' });
  });

  it('(56) implements no semantic retrieval — the target is a research label only', () => {
    expect([...EVALUATION_APPROVAL_TARGETS]).toContain('SEMANTIC_RETRIEVAL_RESEARCH_ELIGIBILITY');
    for (const file of productionFiles()) {
      const text = readFileSync(file, 'utf8');
      expect(text).not.toMatch(/embedding|vector|cosine|\bRAG\b/i);
    }
  });
});

describe('containment', () => {
  const manifest = JSON.parse(
    readFileSync(fileURLToPath(new URL('package.json', PKG_DIR)), 'utf8'),
  ) as { dependencies?: Record<string, string>; exports: Record<string, unknown> };

  it('(57,61) has no live call/provider SDK/process.env/secret/n8n term in production source', () => {
    for (const file of productionFiles()) {
      const text = readFileSync(file, 'utf8');
      expect(text).not.toMatch(/\bfetch\s*\(/);
      expect(text).not.toMatch(/process\.env/);
      expect(text).not.toMatch(
        /from ['"]node:(fs|net|http|https|dns|tls|dgram|child_process|crypto)['"]/,
      );
      expect(text).not.toMatch(
        /from ['"](pg|groq-sdk|openai|@anthropic-ai\/sdk|ollama|axios|undici)['"]/,
      );
      expect(text).not.toMatch(/\bn8n\b|kimi/i);
    }
  });

  it("(57,61) the fixture's literal prompt digest is genuinely SHA-256 of the fixture template", () => {
    // The fixture cannot hash it itself -- the lock directly above forbids that import in this
    // package's production source. Proving the literal here keeps both properties.
    expect(SYNTHETIC_PROMPT_DIGEST).toBe(
      createHash('sha256').update(SYNTHETIC_PROMPT_TEMPLATE, 'utf8').digest('hex'),
    );
  });

  it('(61) depends only on zod and exposes only the root and ./testing', () => {
    expect(Object.keys(manifest.dependencies ?? {})).toEqual(['zod']);
    expect(Object.keys(manifest.exports).sort()).toEqual(['.', './testing']);
  });

  it('(62) locks the public API surface', () => {
    const EXPECTED = [
      'BLOCKING_SEVERITIES',
      'DEFAULT_MANDATORY_RED_TEAM_KINDS',
      'EVALUATION_AGENT_SCOPES',
      'EVALUATION_APPROVAL_TARGETS',
      'EVALUATION_CATEGORIES',
      'EVALUATION_DATA_CLASSES',
      'EVALUATION_ERROR_CODES',
      'EVALUATION_EXECUTION_CLASSES',
      'EVALUATION_OUTCOMES',
      'EVALUATION_REASONS',
      'EVALUATION_SEVERITIES',
      'EVALUATION_TASK_CLASSES',
      'EVALUATOR_IMPL_ID',
      'EVALUATOR_IMPL_VERSION',
      'EvaluationError',
      'NOOP_EVALUATION_OBSERVABILITY',
      'OBSERVATION_BUSINESS_ACTIONS',
      'RED_TEAM_CASE_KINDS',
      'actionScopes',
      'bindingsMatch',
      'contentDigest',
      'createApprovalEvidence',
      'createCandidateObservation',
      'createEvaluationBinding',
      'createEvaluationScenario',
      'createEvaluationSuite',
      'createSuiteThresholds',
      'dataClassRank',
      'evaluateSuite',
      'releaseKey',
      'scenarioKey',
      'severityRank',
      'toRolloutApprovalReference',
    ];
    expect(Object.keys(barrel).sort()).toEqual(EXPECTED);
    const b = barrel as Record<string, unknown>;
    expect(b['evaluateCase']).toBeUndefined();
    expect(b['buildFoundationSuite']).toBeUndefined();
  });

  it('(58,59) migrations 0001–0007 are byte-exact and there is no 0008', () => {
    const dir = repoPath('packages/event-backbone/src/persistence/migrations');
    const sql = readdirSync(dir)
      .filter((n) => n.endsWith('.sql'))
      .sort();
    expect(sql).toEqual(Object.keys(LOCKED_MIGRATION_HASHES));
    for (const [name, hash] of Object.entries(LOCKED_MIGRATION_HASHES)) {
      expect(
        createHash('sha256')
          .update(readFileSync(join(dir, name)))
          .digest('hex'),
      ).toBe(hash);
    }
    expect(sql.some((n) => n.startsWith('0008'))).toBe(false);
  });

  it('(60) the event-backbone public-api lock remains 39', () => {
    expect(readRepo('packages/event-backbone/src/tests/public-api.test.ts')).toContain(
      'toHaveLength(39)',
    );
  });

  it('(65) contains no NUL/control byte in production source', () => {
    for (const file of productionFiles()) {
      expect(CONTROL_BYTE.test(readFileSync(file, 'utf8'))).toBe(false);
    }
  });
});
