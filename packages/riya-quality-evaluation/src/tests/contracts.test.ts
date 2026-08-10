/**
 * RWC-P10 — the contracts refuse what they must (ADR-0106 §9–§12, §15).
 *
 * Every constructor here is a gate. The ones worth reading twice are the human review (a comment
 * field, a name, a second copy of the same reviewer) and the scenario (an expectation no candidate
 * could satisfy, or one that expects a provenance a model cannot legitimately produce).
 */
import { createRiyaConversationObservationBatch } from '@qf-jarvis/riya-conversation-evolution';
import { describe, expect, it } from 'vitest';

import { RiyaQualityEvaluationError } from '../contracts/errors.js';
import { createRiyaQualityHumanReview } from '../contracts/human-review.js';
import { createRiyaQualityObservation } from '../contracts/observation.js';
import { createRiyaQualityScenario } from '../contracts/scenario.js';
import {
  createRiyaQualityThresholds,
  passRateBps,
  RIYA_QUALITY_CANONICAL_THRESHOLDS_V1,
} from '../contracts/thresholds.js';
import {
  RIYA_QUALITY_CASE_OUTCOMES,
  RIYA_QUALITY_COMPARISON_OUTCOMES,
  RIYA_QUALITY_DIMENSIONS,
  RIYA_QUALITY_DISCOVERY_FIELDS,
  RIYA_QUALITY_EXPECTABLE_PROVENANCES,
  RIYA_QUALITY_INTERACTION_KINDS,
  RIYA_QUALITY_LANGUAGE_MODES,
  RIYA_QUALITY_OBJECTIVE_FAILURE_CODES,
} from '../contracts/vocabularies.js';

const codeOf = (run: () => unknown): string => {
  try {
    run();
  } catch (error: unknown) {
    return error instanceof RiyaQualityEvaluationError ? error.code : 'not-a-quality-error';
  }
  return 'no-error';
};

// ---------------------------------------------------------------------------
// 1. Closed vocabularies.
// ---------------------------------------------------------------------------

describe('the vocabularies are exactly what ADR-0106 locks', () => {
  it('three language modes, symmetric by construction', () => {
    expect([...RIYA_QUALITY_LANGUAGE_MODES]).toStrictEqual(['ENGLISH', 'HINDI', 'HINGLISH']);
  });

  it('twelve interaction kinds', () => {
    expect([...RIYA_QUALITY_INTERACTION_KINDS]).toStrictEqual([
      'DISCOVERY',
      'CORRECTION',
      'OBJECTION_PRICE',
      'OBJECTION_TRUST',
      'OBJECTION_TIMELINE',
      'COMPARISON',
      'GROUNDING_QA',
      'OUT_OF_SCOPE',
      'HUMAN_REQUEST',
      'POST_SUMMARY_QA',
      'COMPLETE_QA',
      'NEXT_STEP',
    ]);
  });

  it('ten subjective dimensions', () => {
    expect([...RIYA_QUALITY_DIMENSIONS]).toStrictEqual([
      'CLARITY',
      'CONCISION',
      'NATURALNESS',
      'CONTEXT_USE',
      'EMPATHY',
      'OBJECTION_HANDLING',
      'TRUST_BUILDING',
      'SALES_MOMENTUM',
      'CTA_QUALITY',
      'NON_REPETITION',
    ]);
  });

  it('three case outcomes and four comparison outcomes', () => {
    expect([...RIYA_QUALITY_CASE_OUTCOMES]).toStrictEqual(['PASS', 'FAIL', 'INCONCLUSIVE']);
    expect([...RIYA_QUALITY_COMPARISON_OUTCOMES]).toStrictEqual([
      'CANDIDATE_PREFERRED',
      'BASELINE_PREFERRED',
      'TIE',
      'NOT_COMPARABLE',
    ]);
  });

  it('eleven objective failure codes', () => {
    expect([...RIYA_QUALITY_OBJECTIVE_FAILURE_CODES]).toStrictEqual([
      'LANGUAGE_MISMATCH',
      'REPLY_TOO_LONG',
      'TOO_MANY_QUESTIONS',
      'REQUIRED_OBSERVATION_MISSING',
      'OBSERVATION_VALUE_MISMATCH',
      'FORBIDDEN_OBSERVATION_PRESENT',
      'ASKED_FIELD_NOT_ALLOWED',
      'CITATION_REQUIRED',
      'PHASE_NOT_ALLOWED',
      'OBSERVATION_MISSING',
      'HUMAN_REVIEW_MISSING',
    ]);
  });

  it('the discovery field list is the REAL one, proved through the canonical constructor', () => {
    // The compile-time exhaustiveness map proves nothing is MISSING. This proves nothing is INVENTED:
    // every name is accepted by `riya-conversation-evolution`'s own batch constructor, so a field
    // this package could measure but the runtime could never emit does not exist.
    expect(RIYA_QUALITY_DISCOVERY_FIELDS).toHaveLength(7);
    for (const field of RIYA_QUALITY_DISCOVERY_FIELDS) {
      const batch = createRiyaConversationObservationBatch({
        version: 1,
        observations: [{ field, operation: 'SET', value: 'x', provenance: 'user_stated' }],
        skipProjectDetails: false,
      });
      expect(batch.observations[0]?.field).toBe(field);
    }
    expect(() =>
      createRiyaConversationObservationBatch({
        version: 1,
        observations: [
          { field: 'notAField' as never, operation: 'SET', value: 'x', provenance: 'user_stated' },
        ],
        skipProjectDetails: false,
      }),
    ).toThrow();
  });

  it('only two provenances may ever be EXPECTED of a candidate', () => {
    // `user_confirmed` means the client was shown a value and agreed to it. A model cannot witness
    // that, and a fixture that expected it would let a passing suite certify manufactured consent.
    expect([...RIYA_QUALITY_EXPECTABLE_PROVENANCES]).toStrictEqual([
      'user_stated',
      'model_inferred',
    ]);
    expect(RIYA_QUALITY_EXPECTABLE_PROVENANCES).not.toContain('user_confirmed');
    expect(RIYA_QUALITY_EXPECTABLE_PROVENANCES).not.toContain('user_selected');
    expect(RIYA_QUALITY_EXPECTABLE_PROVENANCES).not.toContain('server_runtime');
  });
});

// ---------------------------------------------------------------------------
// 2. Human review.
// ---------------------------------------------------------------------------

describe('a human review carries a judgement and nothing else', () => {
  it('accepts an opaque ref and a dimension set, and sorts it', () => {
    const review = createRiyaQualityHumanReview({
      version: 1,
      reviewRef: 'reviewer.alpha',
      satisfiedDimensions: ['EMPATHY', 'CLARITY'],
    });
    expect(review.satisfiedDimensions).toStrictEqual(['CLARITY', 'EMPATHY']);
    expect(Object.isFrozen(review)).toBe(true);
  });

  it('refuses a comment, a name, an email, a confidence or an explanation', () => {
    // Each of these is an extra key, and `.strict()` makes it a refusal rather than a silent drop. A
    // reviewer's note quotes the reply, and a quoted reply is conversation text entering an artifact
    // that gets retained and copied.
    for (const extra of [
      { comment: 'felt pushy about the eight lakh figure' },
      { reviewerName: 'a real person' },
      { email: 'someone@example.com' },
      { confidence: 0.8 },
      { explanation: 'because the closing line assumed the sale' },
      { notes: '' },
    ]) {
      expect(
        codeOf(() =>
          createRiyaQualityHumanReview({
            version: 1,
            reviewRef: 'reviewer.alpha',
            satisfiedDimensions: ['CLARITY'],
            ...extra,
          } as never),
        ),
      ).toBe('invalid-human-review');
    }
  });

  it('refuses an unknown dimension and a repeated one', () => {
    expect(
      codeOf(() =>
        createRiyaQualityHumanReview({
          version: 1,
          reviewRef: 'reviewer.alpha',
          satisfiedDimensions: ['CHARISMA' as never],
        }),
      ),
    ).toBe('invalid-human-review');
    expect(
      codeOf(() =>
        createRiyaQualityHumanReview({
          version: 1,
          reviewRef: 'reviewer.alpha',
          satisfiedDimensions: ['CLARITY', 'CLARITY'],
        }),
      ),
    ).toBe('invalid-human-review');
  });

  it('refuses a ref that is empty, oversized or not opaque', () => {
    for (const ref of ['', 'a'.repeat(129), 'someone@example.com', 'reviewer alpha']) {
      expect(
        codeOf(() =>
          createRiyaQualityHumanReview({
            version: 1,
            reviewRef: ref,
            satisfiedDimensions: [],
          }),
        ),
      ).toBe('invalid-human-review');
    }
  });
});

// ---------------------------------------------------------------------------
// 3. Observation.
// ---------------------------------------------------------------------------

const OBSERVATION_BASE = {
  version: 1 as const,
  scenarioId: 'riya.p10.en.discovery.01',
  scenarioVersion: 1,
  languageMode: 'ENGLISH' as const,
  replyCharCount: 200,
  questionCount: 1,
  askedDiscoveryFields: [] as readonly never[],
  observationBatch: { version: 1 as const, observations: [], skipProjectDetails: false },
  citations: [],
  continuityPhaseAfter: 'NEED' as const,
  humanReviews: [],
};

describe('an observation is a measurement, never a transcript', () => {
  it('rebuilds the batch through the REAL canonical constructor', () => {
    const observation = createRiyaQualityObservation({
      ...OBSERVATION_BASE,
      observationBatch: {
        version: 1,
        observations: [
          { field: 'location', operation: 'SET', value: 'city.alpha', provenance: 'user_stated' },
        ],
        skipProjectDetails: false,
      },
    });
    expect(Object.isFrozen(observation.observationBatch)).toBe(true);
    expect(observation.observationBatch.observations[0]?.value).toBe('city.alpha');
  });

  it('refuses a batch the canonical constructor would refuse', () => {
    // A duplicated field, a SET with no value, an unknown provenance. Accepting any of them here
    // would let a fixture certify a Riya against a batch shape the runtime cannot produce.
    for (const observations of [
      [
        { field: 'location', operation: 'SET', value: 'a', provenance: 'user_stated' },
        { field: 'location', operation: 'SET', value: 'b', provenance: 'user_stated' },
      ],
      [{ field: 'location', operation: 'SET', provenance: 'user_stated' }],
      [{ field: 'location', operation: 'CLEAR', value: 'a', provenance: 'user_stated' }],
      [{ field: 'location', operation: 'SET', value: 'a', provenance: 'telepathy' }],
    ]) {
      expect(
        codeOf(() =>
          createRiyaQualityObservation({
            ...OBSERVATION_BASE,
            observationBatch: {
              version: 1,
              observations: observations as never,
              skipProjectDetails: false,
            },
          }),
        ),
      ).toBe('invalid-observation');
    }
  });

  it('refuses raw text, a prompt, a provider body or a chain of thought', () => {
    for (const extra of [
      { replyText: 'Sure, I can help with that.' },
      { userText: 'we want a modular kitchen' },
      { systemPrompt: 'You are Riya.' },
      { providerResponse: {} },
      { reasoning: 'the client seems price sensitive' },
      { phone: '9999999999' },
    ]) {
      expect(codeOf(() => createRiyaQualityObservation({ ...OBSERVATION_BASE, ...extra }))).toBe(
        'invalid-observation',
      );
    }
  });

  it('refuses a third review and a repeated reviewer', () => {
    const review = (ref: string) => ({
      version: 1 as const,
      reviewRef: ref,
      satisfiedDimensions: ['CLARITY' as const],
    });
    expect(
      codeOf(() =>
        createRiyaQualityObservation({
          ...OBSERVATION_BASE,
          humanReviews: [review('a'), review('b'), review('c')],
        }),
      ),
    ).toBe('invalid-observation');
    // One person counted twice is exactly what the two-reviewer rule exists to prevent, and it would
    // otherwise look like unanimous agreement.
    expect(
      codeOf(() =>
        createRiyaQualityObservation({
          ...OBSERVATION_BASE,
          humanReviews: [review('same'), review('same')],
        }),
      ),
    ).toBe('invalid-observation');
  });

  it('a NESTED review carrying free text is REFUSED, not stripped', () => {
    // Owner correction on PR #111. The observation constructor used to rebuild each review from its
    // known fields before validating, so a `comment` or an `email` was silently dropped instead of
    // refused -- which meant the strictest lock in the package was unenforced at exactly the place a
    // real review tool would attach one. The FULL nested object now goes through `.strict()`.
    for (const extra of [
      { comment: 'felt pushy about the eight lakh figure' },
      { reviewerName: 'a real person' },
      { name: 'a real person' },
      { email: 'someone@example.com' },
      { confidence: 0.8 },
      { explanation: 'the closing line assumed the sale' },
      { notes: 'see the thread' },
    ]) {
      expect(
        codeOf(() =>
          createRiyaQualityObservation({
            ...OBSERVATION_BASE,
            humanReviews: [
              { version: 1, reviewRef: 'a', satisfiedDimensions: ['CLARITY'], ...extra },
              { version: 1, reviewRef: 'b', satisfiedDimensions: ['CLARITY'] },
            ] as never,
          }),
        ),
        JSON.stringify(extra),
      ).toBe('invalid-observation');
    }
  });

  it('an observation built from a review with free text retains none of it', () => {
    // Belt and braces: the refusal above is the contract, and this proves nothing leaked on the way
    // to it. A rejected construction must not have copied the text anywhere first.
    let captured = 'no-error';
    try {
      createRiyaQualityObservation({
        ...OBSERVATION_BASE,
        humanReviews: [
          {
            version: 1,
            reviewRef: 'a',
            satisfiedDimensions: ['CLARITY'],
            comment: 'SENTINEL-REVIEW-TEXT-4f2a',
          },
          { version: 1, reviewRef: 'b', satisfiedDimensions: ['CLARITY'] },
        ] as never,
      });
    } catch (error: unknown) {
      captured = error instanceof Error ? error.message : 'other';
    }
    expect(captured).toBe('A Riya quality observation is invalid.');
    expect(captured).not.toContain('SENTINEL-REVIEW-TEXT-4f2a');
  });

  it('an extra TOP-LEVEL batch field is refused by the canonical constructor', () => {
    // Likewise the batch: rebuilding only `observations` and `skipProjectDetails` stripped anything
    // else, so a fixture could carry a field P4A would have rejected and the suite would measure a
    // shape the runtime cannot produce. The whole value now goes through.
    for (const extra of [
      { rawText: 'we want a modular kitchen' },
      { confidence: 0.9 },
      { messageId: 'msg.1' },
      { channel: 'WEB' },
      { version: 2 },
    ]) {
      expect(
        codeOf(() =>
          createRiyaQualityObservation({
            ...OBSERVATION_BASE,
            observationBatch: {
              version: 1,
              observations: [],
              skipProjectDetails: false,
              ...extra,
            } as never,
          }),
        ),
        JSON.stringify(extra),
      ).toBe('invalid-observation');
    }
  });

  it('a well-formed batch and two clean reviews still pass', () => {
    // The strictness must not have become a blanket refusal.
    const observation = createRiyaQualityObservation({
      ...OBSERVATION_BASE,
      observationBatch: {
        version: 1,
        observations: [
          { field: 'budget', operation: 'SET', value: 'budget.mid', provenance: 'user_stated' },
        ],
        skipProjectDetails: true,
      },
      humanReviews: [
        { version: 1, reviewRef: 'a', satisfiedDimensions: ['CLARITY'] },
        { version: 1, reviewRef: 'b', satisfiedDimensions: ['CLARITY'] },
      ],
    });
    expect(observation.observationBatch.skipProjectDetails).toBe(true);
    expect(observation.humanReviews).toHaveLength(2);
  });

  it('sorts reviews, asked fields and citations so a digest does not depend on submission order', () => {
    const one = createRiyaQualityObservation({
      ...OBSERVATION_BASE,
      askedDiscoveryFields: ['timeline', 'budget'],
      citations: [
        { knowledgeId: 'k.b', version: 1 },
        { knowledgeId: 'k.a', version: 2 },
      ],
      humanReviews: [
        { version: 1, reviewRef: 'zeta', satisfiedDimensions: ['CLARITY'] },
        { version: 1, reviewRef: 'alpha', satisfiedDimensions: ['CLARITY'] },
      ],
    });
    expect(one.askedDiscoveryFields).toStrictEqual(['budget', 'timeline']);
    expect(one.citations.map((c) => c.knowledgeId)).toStrictEqual(['k.a', 'k.b']);
    expect(one.humanReviews.map((r) => r.reviewRef)).toStrictEqual(['alpha', 'zeta']);
  });
});

// ---------------------------------------------------------------------------
// 4. Scenario.
// ---------------------------------------------------------------------------

const SCENARIO_BASE = {
  version: 1 as const,
  scenarioId: 'riya.p10.en.discovery.01',
  scenarioVersion: 1,
  phase: 'NEED' as const,
  languageMode: 'ENGLISH' as const,
  interactionKind: 'DISCOVERY' as const,
  expected: {
    maxReplyChars: 400,
    maxQuestions: 2,
    expectedObservations: [],
    forbiddenObservationFields: [],
    requiredCitation: false,
    allowedAskedDiscoveryFields: [],
    allowedContinuityPhasesAfter: ['NEED' as const],
    requiredQualityDimensions: [],
  },
};

describe('a scenario states an expectation a candidate could actually satisfy', () => {
  it('refuses a field that is both required and forbidden', () => {
    // Unsatisfiable by construction. Every candidate would fail it, the dimension would look
    // permanently broken, and the cause would be a typo in the corpus rather than anything about a
    // model.
    expect(
      codeOf(() =>
        createRiyaQualityScenario({
          ...SCENARIO_BASE,
          expected: {
            ...SCENARIO_BASE.expected,
            expectedObservations: [{ field: 'budget', operation: 'SET', value: 'x' }],
            forbiddenObservationFields: ['budget'],
          },
        }),
      ),
    ).toBe('invalid-scenario');
  });

  it('refuses SET without a value and CLEAR with one', () => {
    expect(
      codeOf(() =>
        createRiyaQualityScenario({
          ...SCENARIO_BASE,
          expected: {
            ...SCENARIO_BASE.expected,
            expectedObservations: [{ field: 'budget', operation: 'SET' }],
          },
        }),
      ),
    ).toBe('invalid-scenario');
    expect(
      codeOf(() =>
        createRiyaQualityScenario({
          ...SCENARIO_BASE,
          expected: {
            ...SCENARIO_BASE.expected,
            expectedObservations: [{ field: 'budget', operation: 'CLEAR', value: 'x' }],
          },
        }),
      ),
    ).toBe('invalid-scenario');
  });

  it('refuses an expectation of user_confirmed from a model', () => {
    expect(
      codeOf(() =>
        createRiyaQualityScenario({
          ...SCENARIO_BASE,
          expected: {
            ...SCENARIO_BASE.expected,
            expectedObservations: [
              {
                field: 'budget',
                operation: 'SET',
                value: 'x',
                allowedProvenance: ['user_confirmed' as never],
              },
            ],
          },
        }),
      ),
    ).toBe('invalid-scenario');
  });

  it('refuses duplicates in every list', () => {
    for (const expected of [
      {
        expectedObservations: [
          { field: 'budget' as const, operation: 'SET' as const, value: 'a' },
          { field: 'budget' as const, operation: 'SET' as const, value: 'b' },
        ],
      },
      { forbiddenObservationFields: ['budget' as const, 'budget' as const] },
      { allowedAskedDiscoveryFields: ['budget' as const, 'budget' as const] },
      { allowedContinuityPhasesAfter: ['NEED' as const, 'NEED' as const] },
      { requiredQualityDimensions: ['CLARITY' as const, 'CLARITY' as const] },
    ]) {
      expect(
        codeOf(() =>
          createRiyaQualityScenario({
            ...SCENARIO_BASE,
            expected: { ...SCENARIO_BASE.expected, ...expected },
          }),
        ),
      ).toBe('invalid-scenario');
    }
  });

  it('refuses a wildcard identity and an out-of-range bound', () => {
    expect(
      codeOf(() => createRiyaQualityScenario({ ...SCENARIO_BASE, scenarioId: 'latest' })),
    ).toBe('invalid-scenario');
    expect(
      codeOf(() => createRiyaQualityScenario({ ...SCENARIO_BASE, scenarioId: 'riya.*' })),
    ).toBe('invalid-scenario');
    for (const expected of [
      { maxReplyChars: 0 },
      { maxReplyChars: 2501 },
      // Four questions at once is a form, not a conversation, and no correct answer needs it.
      { maxQuestions: 4 },
      { maxQuestions: -1 },
      { allowedContinuityPhasesAfter: [] },
    ]) {
      expect(
        codeOf(() =>
          createRiyaQualityScenario({
            ...SCENARIO_BASE,
            expected: { ...SCENARIO_BASE.expected, ...expected },
          }),
        ),
      ).toBe('invalid-scenario');
    }
  });
});

// ---------------------------------------------------------------------------
// 5. Thresholds.
// ---------------------------------------------------------------------------

describe('thresholds are integer basis points, per dimension, with no average', () => {
  it('locks the canonical V1 table', () => {
    expect(RIYA_QUALITY_CANONICAL_THRESHOLDS_V1.thresholdsId).toBe('riya-quality-thresholds-v1');
    expect(RIYA_QUALITY_CANONICAL_THRESHOLDS_V1.thresholdsVersion).toBe(1);
    expect(RIYA_QUALITY_CANONICAL_THRESHOLDS_V1.requiredHumanReviews).toBe(2);
    expect(RIYA_QUALITY_CANONICAL_THRESHOLDS_V1.maximumObjectiveFailures).toBe(0);
    expect(RIYA_QUALITY_CANONICAL_THRESHOLDS_V1.maximumInconclusiveCases).toBe(0);
    expect({ ...RIYA_QUALITY_CANONICAL_THRESHOLDS_V1.minimumPassRateBpsByDimension }).toStrictEqual(
      {
        CLARITY: 9500,
        CONCISION: 9000,
        NATURALNESS: 9000,
        CONTEXT_USE: 10_000,
        EMPATHY: 8500,
        OBJECTION_HANDLING: 9000,
        TRUST_BUILDING: 9000,
        SALES_MOMENTUM: 9000,
        CTA_QUALITY: 9000,
        NON_REPETITION: 10_000,
      },
    );
  });

  it('gates every one of the ten dimensions, so nothing ships ungated', () => {
    expect(
      Object.keys(RIYA_QUALITY_CANONICAL_THRESHOLDS_V1.minimumPassRateBpsByDimension).sort(),
    ).toStrictEqual([...RIYA_QUALITY_DIMENSIONS].sort());
  });

  it('exposes no global score, average or weight', () => {
    expect(Object.keys(RIYA_QUALITY_CANONICAL_THRESHOLDS_V1).sort()).toStrictEqual([
      'maximumInconclusiveCases',
      'maximumObjectiveFailures',
      'minimumPassRateBpsByDimension',
      'requiredHumanReviews',
      'thresholdsId',
      'thresholdsVersion',
    ]);
  });

  it('requires exactly two reviews — not one, not three', () => {
    for (const count of [0, 1, 3]) {
      expect(
        codeOf(() =>
          createRiyaQualityThresholds({
            thresholdsId: 't',
            thresholdsVersion: 1,
            requiredHumanReviews: count,
            minimumPassRateBpsByDimension: {},
            maximumObjectiveFailures: 0,
            maximumInconclusiveCases: 0,
          }),
        ),
      ).toBe('invalid-thresholds');
    }
  });

  it('refuses a non-integer or out-of-range basis point value', () => {
    for (const bps of [-1, 10_001, 95.5, Number.NaN]) {
      expect(
        codeOf(() =>
          createRiyaQualityThresholds({
            thresholdsId: 't',
            thresholdsVersion: 1,
            requiredHumanReviews: 2,
            minimumPassRateBpsByDimension: { CLARITY: bps },
            maximumObjectiveFailures: 0,
            maximumInconclusiveCases: 0,
          }),
        ),
      ).toBe('invalid-thresholds');
    }
  });

  it('computes pass rates by integer FLOOR division', () => {
    expect(passRateBps(72, 72)).toBe(10_000);
    expect(passRateBps(71, 72)).toBe(9861);
    expect(passRateBps(23, 24)).toBe(9583);
    expect(passRateBps(2, 3)).toBe(6666);
    expect(passRateBps(0, 24)).toBe(0);
    // No coverage is NOT a full score. The evaluator refuses an uncovered gated dimension outright.
    expect(passRateBps(0, 0)).toBe(0);
    for (const [pass, total] of [
      [1, 3],
      [5, 7],
      [17, 24],
      [71, 72],
    ] as const) {
      expect(Number.isInteger(passRateBps(pass, total))).toBe(true);
    }
  });
});
