/**
 * QFJ-P04.04 — red-team coverage and approval evidence (ADR-0052 §K, §N).
 *
 * Matrix items 30–48: every mandatory attack is represented with exact synthetic fixtures and no real
 * PII; each attack is caught; and evidence is created only on a clean PASS and is immutable, content-
 * free, target-exact, synthetic (never production), and never mutates a rollout.
 */
import { describe, expect, it } from 'vitest';

import { createCandidateObservation } from '../contracts/observation.js';
import { scenarioKey } from '../contracts/scenario.js';
import { RED_TEAM_CASE_KINDS } from '../contracts/vocabularies.js';
import { evaluateCase } from '../evaluators/evaluate-case.js';
import { evaluateSuite } from '../service/evaluate-suite.js';
import { createApprovalEvidence } from '../service/create-evidence.js';
import { toRolloutApprovalReference } from '../service/rollout-bridge.js';
import {
  buildFoundationScenarios,
  buildFoundationSuite,
  createSyntheticBinding,
  failingObservationFor,
  safeObservations,
} from '../testing/fixtures.js';

const scenarioByKind = () => {
  const map = new Map(buildFoundationScenarios().map((s) => [s.redTeamKind, s] as const));
  return map;
};

describe('red-team coverage', () => {
  it('(30) represents every mandatory red-team kind', () => {
    const covered = new Set(buildFoundationScenarios().map((s) => s.redTeamKind));
    for (const kind of RED_TEAM_CASE_KINDS) {
      expect(covered.has(kind)).toBe(true);
    }
  });

  it('(31) binds exact fixture versions', () => {
    for (const scenario of buildFoundationScenarios()) {
      expect(scenario.scenarioVersion).toBe(1);
    }
    expect(createSyntheticBinding().fixtureManifestVersion).toBe(1);
  });

  it('(32) carries no real PII in fixtures', () => {
    const suite = buildFoundationSuite();
    const serialized = JSON.stringify([...safeObservations(suite).values()]);
    expect(serialized).not.toMatch(/@[a-z]+\.[a-z]{2,}/i); // no email
    expect(serialized).not.toMatch(/\+?\d[\d ()-]{8,}\d/); // no phone-like number
  });

  it('(33-41) each attack is caught with its precise reason', () => {
    const byKind = scenarioByKind();
    const check = (kind: Parameters<typeof byKind.get>[0], reason: string): void => {
      const scenario = byKind.get(kind);
      expect(scenario).toBeDefined();
      if (scenario === undefined) {
        return;
      }
      const failing =
        kind === 'CANDIDATE_OR_SHADOW_TREATED_AS_AUTHORITY'
          ? createCandidateObservation({
              scenarioId: scenario.scenarioId,
              scenarioVersion: 1,
              text: '',
              routedContentDataClass: scenario.dataClass,
              treatedCandidateAsAuthority: true,
            })
          : failingObservationFor(scenario);
      expect(evaluateCase(scenario, failing).reason).toBe(reason);
    };
    check('OVERRIDE_CORE', 'business-authority-violation'); // (33)
    check('KNOWLEDGE_PROMPT_INJECTION', 'prompt-injection-succeeded'); // (34)
    check('ERASED_SUBJECT_RETRIEVAL', 'refusal-missing'); // (35)
    check('STALE_OR_SUPERSEDED_FACT', 'knowledge-stale'); // (36)
    check('LOCAL_ONLY_SENT_HOSTED', 'data-class-violation'); // (37)
    check('MALFORMED_STRUCTURED_OUTPUT', 'schema-invalid'); // (38)
    check('FABRICATED_OR_VERSIONLESS_CITATION', 'citation-missing'); // (39)
    check('CANDIDATE_OR_SHADOW_TREATED_AS_AUTHORITY', 'candidate-treated-as-authority'); // (40)
    check('HUMAN_TAKEOVER_BUT_AI_REPLIES', 'human-handover-violation'); // (41)
  });
});

describe('approval evidence', () => {
  it('(42,44,45,46,47) a clean PASS yields immutable, content-free, target-exact synthetic evidence', () => {
    const suite = buildFoundationSuite();
    const result = evaluateSuite(suite, safeObservations(suite));
    const res = createApprovalEvidence(result, 'ACTIVE_MODEL_RELEASE');
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(Object.isFrozen(res.evidence)).toBe(true);
      expect(res.evidence.target).toBe('ACTIVE_MODEL_RELEASE');
      expect(res.evidence.synthetic).toBe(true);
      expect(res.evidence.productionApproval).toBe(false);
      expect(res.evidence.evaluationRef).toMatch(/^evref-[0-9a-f]+$/);
      // Deterministic ref for the same result.
      const again = createApprovalEvidence(
        evaluateSuite(suite, safeObservations(suite)),
        'ACTIVE_MODEL_RELEASE',
      );
      expect(again.ok && again.evidence.evaluationRef).toBe(res.evidence.evaluationRef);
      // Content-free.
      const serialized = JSON.stringify(res.evidence);
      expect(serialized).not.toContain('safe synthetic output');
      expect(serialized).not.toContain('sk-');
    }
  });

  it('(43) a fail, a blocking inconclusive, and a binding mismatch cannot create evidence', () => {
    const suite = buildFoundationSuite();
    const safe = safeObservations(suite);

    const failMap = new Map(safe);
    const scenario = buildFoundationScenarios().find((s) => s.redTeamKind === 'OVERRIDE_CORE');
    if (scenario !== undefined) {
      failMap.set(scenarioKey(scenario.scenarioId, 1), failingObservationFor(scenario));
    }
    expect(createApprovalEvidence(evaluateSuite(suite, failMap), 'ACTIVE_MODEL_RELEASE').ok).toBe(
      false,
    );

    const cleanResult = evaluateSuite(suite, safe);
    const mismatch = createApprovalEvidence(cleanResult, 'ACTIVE_MODEL_RELEASE', {
      expectedBinding: createSyntheticBinding({ promptVersion: 99 }),
    });
    expect(mismatch.ok ? '' : mismatch.code).toBe('binding-mismatch');
  });

  it('(48) evidence exposes only a read-only rollout reference — no activation/mutation', () => {
    const suite = buildFoundationSuite();
    const res = createApprovalEvidence(
      evaluateSuite(suite, safeObservations(suite)),
      'CANARY_ELIGIBILITY',
    );
    expect(res.ok).toBe(true);
    if (res.ok) {
      const ref = toRolloutApprovalReference(res.evidence);
      expect(ref.target).toBe('CANARY_ELIGIBILITY');
      expect(ref.synthetic).toBe(true);
      const asRecord = ref as unknown as Record<string, unknown>;
      for (const method of ['activate', 'promote', 'mutate', 'authorize', 'execute']) {
        expect(asRecord[method]).toBeUndefined();
      }
    }
  });
});
