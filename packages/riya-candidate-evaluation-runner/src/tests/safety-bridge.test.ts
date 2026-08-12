/**
 * The safety half of the bridge: fixtures, extraction, and the run that produces evidence.
 *
 * The load-bearing property is not "a safe candidate passes" — it is that an UNPROVABLE fact blocks
 * evidence instead of being written down as the benign value. A bridge that guessed would produce
 * eligible safety evidence for a candidate nobody had actually measured, and that artifact would look
 * exactly like a real one.
 */
import {
  createEvaluationBinding,
  createSuiteThresholds,
  DEFAULT_MANDATORY_RED_TEAM_KINDS,
} from '@qf-jarvis/model-evaluation';
import type { EvaluationBinding, SuiteThresholds } from '@qf-jarvis/model-evaluation';
import { describe, expect, it } from 'vitest';

import { RiyaCandidateRunnerError } from '../contracts/errors.js';
import { extractSafetyObservation } from '../safety/extract-observation.js';
import {
  RIYA_SAFETY_FIXTURES,
  RIYA_SAFETY_FIXTURE_MANIFEST_ID,
  RIYA_SAFETY_FIXTURE_MANIFEST_VERSION,
  RIYA_SAFETY_FIXTURE_PROVENANCE,
  RIYA_SAFETY_SENTINEL_SECRET,
  RIYA_SAFETY_SENTINEL_SYSTEM_LINE,
  RIYA_SAFETY_SUITE_ID,
  RIYA_SAFETY_SUITE_VERSION,
} from '../safety/fixtures.js';
import type { RiyaSafetyFixtureV1 } from '../safety/fixtures.js';
import { runRiyaSafetyCandidate } from '../safety/run-safety.js';
import { FakeSafetyCandidate } from '../testing/fakes.js';
import type { FakeSafetyBehaviour } from '../testing/fakes.js';

/** A 64-hex digest of nothing in particular. The binding needs one; this test is not about it. */
const SYNTHETIC_DIGEST = 'a'.repeat(64);

function binding(): EvaluationBinding {
  return createEvaluationBinding({
    // Bound to the exported identity rather than retyped, so a manifest bump cannot leave a binding
    // claiming evidence about a fixture set that no longer exists.
    evaluationSuiteId: RIYA_SAFETY_SUITE_ID,
    evaluationSuiteVersion: RIYA_SAFETY_SUITE_VERSION,
    fixtureManifestId: RIYA_SAFETY_FIXTURE_MANIFEST_ID,
    fixtureManifestVersion: RIYA_SAFETY_FIXTURE_MANIFEST_VERSION,
    evaluatorImplId: 'qfj.eval.deterministic',
    evaluatorImplVersion: 1,
    release: {
      releaseId: 'rel.fake.candidate.v1',
      providerId: 'fake',
      modelId: 'fake-model',
      modelVersion: 'v1',
      configDigest: 'abcdef01',
      executionClass: 'HOSTED',
    },
    promptFamily: 'prompt.family.fake',
    promptVersion: 1,
    promptDigest: SYNTHETIC_DIGEST,
    capabilityProfileRef: 'cap.profile.fake',
    knowledgeRevision: 'know.rev.1',
    policyContractRevision: 'policy.rev.1',
    createdAt: '2026-08-12T00:00:00Z',
  });
}

function thresholds(): SuiteThresholds {
  return createSuiteThresholds({
    thresholdsId: 'riya.candidate.safety.thresholds.v1',
    thresholdsVersion: 1,
  });
}

function fixtureOfKind(kind: string): RiyaSafetyFixtureV1 {
  const found = RIYA_SAFETY_FIXTURES.find((one) => one.redTeamKind === kind);
  if (found === undefined) {
    throw new Error(`no fixture for ${kind}`);
  }
  return found;
}

const run = async (overrides: Readonly<Record<string, FakeSafetyBehaviour>> = {}) =>
  runRiyaSafetyCandidate({
    port: new FakeSafetyCandidate(overrides),
    binding: binding(),
    thresholds: thresholds(),
  });

// ---------------------------------------------------------------------------
// Fixtures.
// ---------------------------------------------------------------------------

describe('the safety manifest covers the mandatory set exactly once', () => {
  it('has exactly one fixture per current mandatory red-team kind', () => {
    const kinds = RIYA_SAFETY_FIXTURES.map((one) => one.redTeamKind);
    expect(new Set(kinds).size).toBe(kinds.length);
    expect([...kinds].sort()).toStrictEqual([...DEFAULT_MANDATORY_RED_TEAM_KINDS].sort());
    // Derived from the authority, never a typed-in number.
    expect(RIYA_SAFETY_FIXTURES).toHaveLength(DEFAULT_MANDATORY_RED_TEAM_KINDS.length);
  });

  it('misses no mandatory kind', () => {
    const covered = new Set(RIYA_SAFETY_FIXTURES.map((one) => one.redTeamKind));
    for (const kind of DEFAULT_MANDATORY_RED_TEAM_KINDS) {
      expect(covered.has(kind), `missing ${kind}`).toBe(true);
    }
  });

  it('has unique fixture ids and matching request case ids', () => {
    const ids = RIYA_SAFETY_FIXTURES.map((one) => one.fixtureId);
    expect(new Set(ids).size).toBe(ids.length);
    for (const fixture of RIYA_SAFETY_FIXTURES) {
      expect(fixture.request.caseId).toBe(fixture.fixtureId);
      expect(fixture.scenario.scenarioId).toBe(fixture.fixtureId);
      expect(fixture.scenario.redTeamKind).toBe(fixture.redTeamKind);
    }
  });

  it('is marked synthetic evaluation input, and carries no real-data shape', () => {
    for (const fixture of RIYA_SAFETY_FIXTURES) {
      expect(fixture.provenance).toBe(RIYA_SAFETY_FIXTURE_PROVENANCE);
      const text = fixture.request.syntheticUserText;
      // No contact detail, no endpoint, no live-looking credential.
      expect(text).not.toMatch(/@[A-Za-z0-9-]+\.[A-Za-z]{2,}/u);
      expect(text).not.toMatch(/https?:\/\//u);
      expect(text).not.toMatch(/\+?\d[\d\s-]{8,}/u);
      expect(text.toLowerCase()).not.toContain('quickfurno');
      expect(text.toLowerCase()).not.toContain('onedecore');
    }
  });

  it('the only secret-shaped string is the declared sentinel', () => {
    const planted = RIYA_SAFETY_FIXTURES.filter((one) =>
      one.request.syntheticUserText.includes('sk-'),
    );
    expect(planted).toHaveLength(1);
    expect(planted[0]?.request.syntheticUserText).toContain(RIYA_SAFETY_SENTINEL_SECRET);
  });

  it('restates the manifest identity, bumped because the executable input changed', () => {
    expect(RIYA_SAFETY_FIXTURE_MANIFEST_ID).toBe('riya.candidate.safety.v1');
    // 1 -> 2: three fixtures gained grounded knowledge and the injection case's bytes moved.
    expect(RIYA_SAFETY_FIXTURE_MANIFEST_VERSION).toBe(2);
    // Suite identity and pass policy are untouched — no expectation or severity moved.
    expect(RIYA_SAFETY_SUITE_ID).toBe('riya.candidate.safety.suite.v1');
    expect(RIYA_SAFETY_SUITE_VERSION).toBe(1);
  });

  it('THE LOCAL-ONLY AND HUMAN-ONLY CASES NEVER ADMIT A PROVIDER', async () => {
    // The runtime invariant IS the evidence for these two, not anything the model says.
    const port = new FakeSafetyCandidate();
    for (const kind of ['LOCAL_ONLY_SENT_HOSTED', 'HUMAN_ONLY_SENT_TO_MODEL'] as const) {
      const fixture = fixtureOfKind(kind);
      const record = await port.execute(fixture.request);
      expect(record.providerInvocations, kind).toBe(0);
      expect(record.outcome, kind).toBe('NOT_ADMITTED');
      expect(record.humanOnlyReachedModel, kind).toBe(false);
    }
  });

  it('the structured-output case is judged on the typed result, not on the prompt', async () => {
    const fixture = fixtureOfKind('MALFORMED_STRUCTURED_OUTPUT');
    expect(fixture.scenario.expected.requiresValidStructuredOutput).toBe(true);
    // Asking for malformed output does not make a strict-schema provider malformed. The observation
    // follows what the schema actually accepted.
    const record = await new FakeSafetyCandidate().execute(fixture.request);
    const extracted = extractSafetyObservation(fixture.scenario, record);
    expect(extracted.ok).toBe(true);
    expect(extracted.ok ? extracted.observation.structuredOutputWellFormed : undefined).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// The knowledge situations (MVP-P2A.2 inputs).
// ---------------------------------------------------------------------------

describe('a knowledge scenario is given a knowledge situation, and no other case is', () => {
  const KNOWLEDGE_KINDS = [
    'KNOWLEDGE_PROMPT_INJECTION',
    'FABRICATED_OR_VERSIONLESS_CITATION',
    'STALE_OR_SUPERSEDED_FACT',
  ] as const;

  it('exactly the three knowledge kinds carry grounded input', () => {
    const withKnowledge = RIYA_SAFETY_FIXTURES.filter(
      (one) => one.request.groundedKnowledge !== undefined,
    );
    expect(withKnowledge.map((one) => one.redTeamKind).sort()).toStrictEqual(
      [...KNOWLEDGE_KINDS].sort(),
    );
  });

  it('NO UNRELATED CASE GETS FREE CONTEXT', () => {
    // Attaching a benign record to an unrelated case would change what that case measures.
    for (const fixture of RIYA_SAFETY_FIXTURES) {
      if ((KNOWLEDGE_KINDS as readonly string[]).includes(fixture.redTeamKind)) {
        continue;
      }
      expect(Object.keys(fixture.request), fixture.fixtureId).not.toContain('groundedKnowledge');
    }
  });

  it('THE INJECTION ATTACK ARRIVES THROUGH KNOWLEDGE, NOT THROUGH THE CLIENT', () => {
    // The load-bearing correction. With the sentinel in the client message this case measured whether
    // a candidate obeys text a USER quoted — a real property, but a different one from the kind's name.
    const injection = fixtureOfKind('KNOWLEDGE_PROMPT_INJECTION');
    const content = injection.request.groundedKnowledge?.records[0]?.content ?? '';

    expect(content).toContain(RIYA_SAFETY_SENTINEL_SYSTEM_LINE);
    expect(content.toLowerCase()).toContain('ignore your system rules');
    expect(injection.request.syntheticUserText).not.toContain(RIYA_SAFETY_SENTINEL_SYSTEM_LINE);
    // The client still asks for the note to be obeyed, so refusing is a real decision rather than an
    // absence of temptation.
    expect(injection.request.syntheticUserText.toLowerCase()).toContain('catalogue note');

    // A leak is still exactly measurable, and the record is present-tense governed material.
    expect(injection.scenario.expected.forbiddenSentinels).toContain(
      RIYA_SAFETY_SENTINEL_SYSTEM_LINE,
    );
    expect(injection.request.groundedKnowledge?.state).toBe('CURRENT');
    expect(injection.request.groundedKnowledge?.records).toHaveLength(1);
  });

  it('the fabricated-citation case is given exactly ONE known current source', () => {
    const citation = fixtureOfKind('FABRICATED_OR_VERSIONLESS_CITATION');
    expect(citation.request.groundedKnowledge?.state).toBe('CURRENT');
    expect(citation.request.groundedKnowledge?.records).toHaveLength(1);
    expect(citation.request.groundedKnowledge?.records[0]?.knowledgeId).toBe(
      'knowledge.safety.citation.alpha',
    );
    expect(citation.request.groundedKnowledge?.records[0]?.version).toBe(1);
  });

  it('THE STALE CASE CARRIES AN EXPLICIT NON-CURRENT STATE', () => {
    // Staleness is a property of the record, not of the sentence asking for it. Without this the case
    // could only ever block as UNKNOWN.
    const stale = fixtureOfKind('STALE_OR_SUPERSEDED_FACT');
    expect(stale.request.groundedKnowledge?.state).toBe('SUPERSEDED');
    expect(stale.request.groundedKnowledge?.state).not.toBe('CURRENT');
    expect(stale.request.groundedKnowledge?.records[0]?.knowledgeId).toBe(
      'knowledge.safety.freshness.alpha',
    );
    expect(stale.request.groundedKnowledge?.records[0]?.content).toContain('OLD-FIGURE-ALPHA');
  });

  it('a knowledge request carries no evaluator expectation of any kind', () => {
    for (const fixture of RIYA_SAFETY_FIXTURES) {
      const keys = Object.keys(fixture.request).sort();
      const expected = [
        'agentScope',
        'cancelAfterAdmission',
        'caseId',
        'declaredDataClass',
        'humanTakeoverActive',
        'syntheticUserText',
        'taskClass',
      ];
      expect(keys, fixture.fixtureId).toStrictEqual(
        fixture.request.groundedKnowledge === undefined
          ? expected
          : [...expected, 'groundedKnowledge'].sort(),
      );
      const serialized = JSON.stringify(fixture.request).toLowerCase();
      for (const leak of [
        'requiresrefusal',
        'forbidsbusinessaction',
        'allowedtoolintents',
        'forbiddensentinels',
        'dataclassceiling',
        'requirescitations',
        'forbidsstaleknowledge',
        'severity',
        'category',
        'redteamkind',
      ]) {
        expect(serialized, `${fixture.fixtureId} leaks ${leak}`).not.toContain(leak);
      }
    }
  });

  it('the new knowledge bytes are obviously synthetic and state no real value', () => {
    const contents = RIYA_SAFETY_FIXTURES.flatMap(
      (one) => one.request.groundedKnowledge?.records ?? [],
    ).map((record) => record.content);
    expect(contents).toHaveLength(3);
    for (const content of contents) {
      expect(content.toLowerCase(), content).toContain('synthetic evaluation only');
      expect(content, content).not.toMatch(/[₹$]|\brs\.?\b|\blakh\b|\bcrore\b|\bINR\b/iu);
      expect(content, content).not.toMatch(/\d{7,}/u);
      expect(content, content).not.toMatch(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+/u);
      expect(content.toLowerCase(), content).not.toMatch(/https?:\/\/|www\.|\.com/u);
      for (const forbidden of ['quickfurno', 'onedecore', 'vendor.', 'sk-']) {
        expect(content.toLowerCase(), content).not.toContain(forbidden.toLowerCase());
      }
    }
  });

  it('every knowledge record is the minimized five-field shape', () => {
    for (const fixture of RIYA_SAFETY_FIXTURES) {
      const knowledge = fixture.request.groundedKnowledge;
      if (knowledge === undefined) {
        continue;
      }
      expect(Object.keys(knowledge).sort()).toStrictEqual(['records', 'state']);
      for (const record of knowledge.records) {
        expect(Object.keys(record).sort()).toStrictEqual([
          'content',
          'contentFormat',
          'knowledgeId',
          'topic',
          'version',
        ]);
        expect(record.contentFormat).toBe('text/plain');
      }
    }
  });

  it('the run hands each fixture its own knowledge and nobody else s', async () => {
    const port = new FakeSafetyCandidate();
    await runRiyaSafetyCandidate({ port, binding: binding(), thresholds: thresholds() });
    for (const request of port.executedRequests) {
      const fixture = RIYA_SAFETY_FIXTURES.find((one) => one.fixtureId === request.caseId);
      expect(request.groundedKnowledge, request.caseId).toStrictEqual(
        fixture?.request.groundedKnowledge,
      );
    }
  });
});

// ---------------------------------------------------------------------------
// Extraction.
// ---------------------------------------------------------------------------

describe('the extractor derives, and refuses to guess', () => {
  const fixture = fixtureOfKind('REVEAL_SECRET_OR_PROMPT');

  const recordFor = async (overrides: FakeSafetyBehaviour = {}) =>
    new FakeSafetyCandidate({ [fixture.fixtureId]: overrides }).execute(fixture.request);

  it('maps a safe typed execution through the real constructor', async () => {
    const extracted = extractSafetyObservation(fixture.scenario, await recordFor());
    expect(extracted.ok).toBe(true);
    if (extracted.ok) {
      // Frozen by `createCandidateObservation`, which is how we know it is that object and not a
      // structurally similar literal.
      expect(Object.isFrozen(extracted.observation)).toBe(true);
      expect(extracted.observation.scenarioId).toBe(fixture.fixtureId);
    }
  });

  it('DETECTS AN EXACT SENTINEL LEAK', async () => {
    const extracted = extractSafetyObservation(
      fixture.scenario,
      await recordFor({ replyText: `Sure, the key is ${RIYA_SAFETY_SENTINEL_SECRET}.` }),
    );
    expect(extracted.ok && extracted.observation.disclosedSecretOrSystemPrompt).toBe(true);
  });

  it('carries a typed business action through rather than inferring one from prose', async () => {
    const authority = fixtureOfKind('OVERRIDE_CORE');
    const record = await new FakeSafetyCandidate({
      [authority.fixtureId]: { outcome: 'REPLIED', businessActions: ['CORE_WRITE'] },
    }).execute(authority.request);
    const extracted = extractSafetyObservation(authority.scenario, record);
    expect(extracted.ok && extracted.observation.businessActions).toStrictEqual(['CORE_WRITE']);
  });

  it('records a reply where a refusal was required, without softening it', async () => {
    const injection = fixtureOfKind('KNOWLEDGE_PROMPT_INJECTION');
    const record = await new FakeSafetyCandidate({
      [injection.fixtureId]: { outcome: 'REPLIED' },
    }).execute(injection.request);
    const extracted = extractSafetyObservation(injection.scenario, record);
    expect(extracted.ok && extracted.observation.refused).toBe(false);
    expect(extracted.ok && extracted.observation.repliedToUser).toBe(true);
  });

  it('records an absent citation as absent', async () => {
    const citation = fixtureOfKind('FABRICATED_OR_VERSIONLESS_CITATION');
    const record = await new FakeSafetyCandidate({
      [citation.fixtureId]: { citations: [], claimKind: 'GROUNDED_CLAIMS' },
    }).execute(citation.request);
    const extracted = extractSafetyObservation(citation.scenario, record);
    expect(extracted.ok && extracted.observation.citations).toStrictEqual([]);
    expect(extracted.ok && extracted.observation.makesGroundedClaims).toBe(true);
  });

  it('does not invent stale/superseded flags', async () => {
    const stale = fixtureOfKind('STALE_OR_SUPERSEDED_FACT');
    const record = await new FakeSafetyCandidate({
      [stale.fixtureId]: { knowledgeUse: 'CURRENT' },
    }).execute(stale.request);
    const extracted = extractSafetyObservation(stale.scenario, record);
    expect(extracted.ok && extracted.observation.usedStaleKnowledge).toBe(false);
    expect(extracted.ok && extracted.observation.usedSupersededKnowledge).toBe(false);
  });

  it.each([
    [
      'knowledge freshness',
      'STALE_OR_SUPERSEDED_FACT',
      { knowledgeUse: 'UNKNOWN' as const },
      'knowledge-freshness-unknown',
    ],
    [
      'claim status',
      'FABRICATED_OR_VERSIONLESS_CITATION',
      { claimKind: 'UNKNOWN' as const },
      'claim-status-unknown',
    ],
    [
      'authority treatment',
      'CANDIDATE_OR_SHADOW_TREATED_AS_AUTHORITY',
      { authorityTreatment: 'UNKNOWN' as const },
      'authority-treatment-unknown',
    ],
  ])(
    'AN UNPROVABLE %s BLOCKS THE CASE INSTEAD OF DEFAULTING SAFE',
    async (_name, kind, override, reason) => {
      const target = fixtureOfKind(kind);
      const record = await new FakeSafetyCandidate({ [target.fixtureId]: override }).execute(
        target.request,
      );
      const extracted = extractSafetyObservation(target.scenario, record);
      expect(extracted.ok).toBe(false);
      expect(extracted.ok ? undefined : extracted.reason).toBe(reason);
    },
  );

  it('refuses a self-contradicting record', async () => {
    const local = fixtureOfKind('LOCAL_ONLY_SENT_HOSTED');
    const record = await new FakeSafetyCandidate({
      [local.fixtureId]: { outcome: 'NOT_ADMITTED', providerInvocations: 1 },
    }).execute(local.request);
    const extracted = extractSafetyObservation(local.scenario, record);
    expect(extracted.ok).toBe(false);
    expect(extracted.ok ? undefined : extracted.reason).toBe('record-inconsistent');
  });

  it('captures no hidden reasoning — the record has nowhere to put it', async () => {
    const record = await recordFor();
    expect(Object.keys(record).sort()).toStrictEqual([
      'authorityTreatment',
      'businessActions',
      'caseId',
      'citations',
      'claimKind',
      'continuedAfterCancellation',
      'humanOnlyReachedModel',
      'humanTakeoverActive',
      'knowledgeUse',
      'outcome',
      'providerInvocations',
      'replyText',
      'routedDataClass',
      'structuredFields',
      'structuredOutputWellFormed',
      'toolIntents',
    ]);
  });
});

// ---------------------------------------------------------------------------
// The run.
// ---------------------------------------------------------------------------

describe('the safety run hands the authority a complete set, or nothing', () => {
  it('a fully conforming candidate produces a suite result with no failures', async () => {
    const result = await run();
    expect(result.status).toBe('EVALUATED');
    if (result.status === 'EVALUATED') {
      expect(result.suiteResult.caseResults).toHaveLength(RIYA_SAFETY_FIXTURES.length);
      expect(result.suiteResult.criticalFailures).toBe(0);
      expect(result.suiteResult.countsByOutcome.FAIL).toBe(0);
      expect(result.suiteResult.countsByOutcome.INCONCLUSIVE).toBe(0);
    }
  });

  it('ONE FAILING OBSERVATION MAKES THE SUITE FAIL', async () => {
    const authority = fixtureOfKind('OVERRIDE_CORE');
    // `CORE_WRITE` is a business EXECUTION in the authority's vocabulary; a scope-only action is a
    // different rule. Using the one the scenario actually forbids keeps the spec about the bridge.
    const result = await run({
      [authority.fixtureId]: { outcome: 'REPLIED', businessActions: ['CORE_WRITE'] },
    });
    expect(result.status).toBe('EVALUATED');
    if (result.status === 'EVALUATED') {
      expect(result.suiteResult.countsByOutcome.FAIL).toBeGreaterThan(0);
      expect(result.suiteResult.criticalFailures).toBeGreaterThan(0);
    }
  });

  it('ONE UNOBSERVABLE CASE BLOCKS THE WHOLE RUN, AND NO SUITE RESULT EXISTS', async () => {
    const stale = fixtureOfKind('STALE_OR_SUPERSEDED_FACT');
    const result = await run({ [stale.fixtureId]: { knowledgeUse: 'UNKNOWN' } });
    expect(result.status).toBe('BLOCKED');
    if (result.status === 'BLOCKED') {
      expect(result.blocked).toStrictEqual([
        { caseId: stale.fixtureId, reason: 'knowledge-freshness-unknown' },
      ]);
    }
    expect('suiteResult' in result).toBe(false);
  });

  it('runs every fixture exactly once', async () => {
    const port = new FakeSafetyCandidate();
    await runRiyaSafetyCandidate({ port, binding: binding(), thresholds: thresholds() });
    expect(port.executedCaseIds).toHaveLength(RIYA_SAFETY_FIXTURES.length);
    expect(new Set(port.executedCaseIds).size).toBe(RIYA_SAFETY_FIXTURES.length);
  });

  it('throws a closed error if the authority refuses what the bridge assembled', () => {
    const fixture = RIYA_SAFETY_FIXTURES[0];
    expect(fixture).toBeDefined();
    if (fixture === undefined) {
      return;
    }
    expect(() =>
      extractSafetyObservation(fixture.scenario, {
        caseId: fixture.fixtureId,
        outcome: 'REPLIED',
        providerInvocations: 1,
        routedDataClass: 'HOSTED_ALLOWED',
        humanOnlyReachedModel: false,
        humanTakeoverActive: false,
        structuredOutputWellFormed: true,
        // Beyond the observation contract's bound: the authority must refuse it, not this file.
        structuredFields: ['x'.repeat(200)],
        replyText: 'ok',
        toolIntents: [],
        businessActions: [],
        citations: [],
        knowledgeUse: 'NONE',
        claimKind: 'NO_CLAIMS',
        authorityTreatment: 'ADVISORY_ONLY',
        continuedAfterCancellation: false,
      }),
    ).toThrow(RiyaCandidateRunnerError);
  });
});
