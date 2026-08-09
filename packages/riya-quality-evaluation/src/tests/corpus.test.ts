/**
 * RWC-P10 — the golden corpus is exactly 72, symmetric, and contains nothing real
 * (ADR-0106 §20, §21, §23).
 *
 * Two families of assertion. The MATRIX specs prove the corpus is not lopsided: 24 per language, six
 * per interaction kind, two per language-and-kind pair. A thinner set for Hindi or Hinglish is how a
 * system ends up measurably good in English and quietly bad everywhere else, and it happens by
 * accident rather than by decision.
 *
 * The CONTENT specs scan every synthetic string for the things a fixture corpus tends to acquire:
 * a phone number somebody used while testing, a real customer's name, a production URL. None of them
 * would fail anything — the corpus would keep passing — which is exactly why they need a scanner.
 *
 * There is also a self-test. Feeding the corpus its own passing shapes must produce an eligible
 * suite. That proves the EVALUATOR agrees with the fixtures; it proves nothing whatever about a real
 * model, and the ADR says so in the same words.
 */
import { describe, expect, it } from 'vitest';

import { createRiyaQualityEvidence } from '../service/create-evidence.js';
import { evaluateRiyaQualitySuite } from '../service/evaluate-suite.js';
import {
  RIYA_QUALITY_DIMENSIONS,
  RIYA_QUALITY_INTERACTION_KINDS,
  RIYA_QUALITY_LANGUAGE_MODES,
} from '../contracts/vocabularies.js';
import { buildRiyaQualityGoldenSuite, passingGoldenObservations } from '../testing/builders.js';
import {
  RIYA_QUALITY_GOLDEN_FIXTURES,
  RIYA_QUALITY_GOLDEN_FIXTURE_MANIFEST_ID,
  RIYA_QUALITY_GOLDEN_FIXTURE_MANIFEST_VERSION,
  RIYA_QUALITY_GOLDEN_SCENARIOS,
  RIYA_QUALITY_GOLDEN_SUITE_ID,
  RIYA_QUALITY_GOLDEN_SUITE_VERSION,
} from '../testing/golden-corpus.js';

const fixturesFor = (
  predicate: (fixture: (typeof RIYA_QUALITY_GOLDEN_FIXTURES)[number]) => boolean,
) => RIYA_QUALITY_GOLDEN_FIXTURES.filter(predicate);

// ---------------------------------------------------------------------------
// 1. The matrix.
// ---------------------------------------------------------------------------

describe('the corpus is exactly 3 x 12 x 2', () => {
  it('is 72 fixtures', () => {
    expect(RIYA_QUALITY_GOLDEN_FIXTURES).toHaveLength(72);
    expect(RIYA_QUALITY_GOLDEN_SCENARIOS).toHaveLength(72);
  });

  it('is 24 English, 24 Hindi and 24 Hinglish', () => {
    for (const languageMode of RIYA_QUALITY_LANGUAGE_MODES) {
      expect(
        fixturesFor((f) => f.languageMode === languageMode),
        languageMode,
      ).toHaveLength(24);
    }
  });

  it('gives every interaction kind exactly six', () => {
    for (const kind of RIYA_QUALITY_INTERACTION_KINDS) {
      expect(
        fixturesFor((f) => f.interactionKind === kind),
        kind,
      ).toHaveLength(6);
    }
  });

  it('gives every language-and-kind pair exactly two', () => {
    for (const languageMode of RIYA_QUALITY_LANGUAGE_MODES) {
      for (const kind of RIYA_QUALITY_INTERACTION_KINDS) {
        expect(
          fixturesFor((f) => f.languageMode === languageMode && f.interactionKind === kind),
          `${languageMode}/${kind}`,
        ).toHaveLength(2);
      }
    }
  });

  it('has stable, unique, exactly-specified ids', () => {
    const ids = RIYA_QUALITY_GOLDEN_FIXTURES.map((f) => f.fixtureId);
    expect(new Set(ids).size).toBe(72);
    // Spot-checked against the written scheme, so the generated matrix is verified against an
    // expectation rather than trusted to be whatever it produced.
    expect(ids).toContain('riya.p10.en.discovery.01');
    expect(ids).toContain('riya.p10.hi.objection-price.01');
    expect(ids).toContain('riya.p10.hinglish.grounding-qa.02');
    expect(ids).toContain('riya.p10.en.human-request.02');
    expect(ids).toContain('riya.p10.hi.complete-qa.02');
    for (const id of ids) {
      expect(id).toMatch(/^riya\.p10\.(en|hi|hinglish)\.[a-z-]+\.0[12]$/u);
    }
    // The scenario id and the fixture id are the same value, so a corpus entry cannot drift from the
    // scenario an observation will be matched against.
    for (const fixture of RIYA_QUALITY_GOLDEN_FIXTURES) {
      expect(fixture.scenario.scenarioId).toBe(fixture.fixtureId);
      expect(fixture.scenario.languageMode).toBe(fixture.languageMode);
      expect(fixture.scenario.interactionKind).toBe(fixture.interactionKind);
    }
  });

  it('names one manifest, one suite and one threshold set', () => {
    expect(RIYA_QUALITY_GOLDEN_FIXTURE_MANIFEST_ID).toBe('riya-quality-golden-v1');
    expect(RIYA_QUALITY_GOLDEN_FIXTURE_MANIFEST_VERSION).toBe(1);
    expect(RIYA_QUALITY_GOLDEN_SUITE_ID).toBe('riya-quality-v1');
    expect(RIYA_QUALITY_GOLDEN_SUITE_VERSION).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 2. Coverage of the situations that actually matter commercially.
// ---------------------------------------------------------------------------

describe('the corpus covers the conversation, not just the happy path', () => {
  const kindsOf = (languageMode: (typeof RIYA_QUALITY_LANGUAGE_MODES)[number]) =>
    new Set(fixturesFor((f) => f.languageMode === languageMode).map((f) => f.interactionKind));

  it('every language covers every kind — no language gets a thinner corpus', () => {
    for (const languageMode of RIYA_QUALITY_LANGUAGE_MODES) {
      expect([...kindsOf(languageMode)].sort()).toStrictEqual(
        [...RIYA_QUALITY_INTERACTION_KINDS].sort(),
      );
    }
  });

  it('discovery captures several facts in one turn, and does not re-ask a known one', () => {
    const multi = RIYA_QUALITY_GOLDEN_FIXTURES.find(
      (f) => f.fixtureId === 'riya.p10.en.discovery.01',
    );
    expect(multi?.scenario.expected.expectedObservations).toHaveLength(3);

    const known = RIYA_QUALITY_GOLDEN_FIXTURES.find(
      (f) => f.fixtureId === 'riya.p10.en.discovery.02',
    );
    expect(known?.scenario.expected.expectedObservations.map((one) => one.field)).toStrictEqual([
      'budget',
      'timeline',
    ]);
    // The client already gave service and location. Asking again is the failure this case is for.
    expect(known?.scenario.expected.allowedAskedDiscoveryFields).not.toContain('serviceInterest');
    expect(known?.scenario.expected.allowedAskedDiscoveryFields).not.toContain('location');
  });

  it('corrections expect the NEW value, not the old one', () => {
    const city = RIYA_QUALITY_GOLDEN_FIXTURES.find(
      (f) => f.fixtureId === 'riya.p10.hi.correction.01',
    );
    expect(city?.scenario.expected.expectedObservations[0]).toMatchObject({
      field: 'location',
      operation: 'SET',
      value: 'city.beta',
    });
    const money = RIYA_QUALITY_GOLDEN_FIXTURES.find(
      (f) => f.fixtureId === 'riya.p10.hinglish.correction.02',
    );
    expect(money?.scenario.expected.expectedObservations.map((one) => one.field)).toStrictEqual([
      'budget',
      'timeline',
    ]);
  });

  it('all three objection kinds are covered in all three languages', () => {
    for (const kind of ['OBJECTION_PRICE', 'OBJECTION_TRUST', 'OBJECTION_TIMELINE'] as const) {
      for (const languageMode of RIYA_QUALITY_LANGUAGE_MODES) {
        expect(
          fixturesFor((f) => f.interactionKind === kind && f.languageMode === languageMode),
        ).toHaveLength(2);
      }
    }
  });

  it('a trust objection may not be answered with another discovery question', () => {
    // Somebody questioning whether the work will last wants an answer. A question back is deflection.
    for (const fixture of fixturesFor((f) => f.interactionKind === 'OBJECTION_TRUST')) {
      expect(fixture.scenario.expected.allowedAskedDiscoveryFields).toStrictEqual([]);
    }
  });

  it('grounded, post-summary and COMPLETE questions all REQUIRE a citation', () => {
    // An ungrounded factual answer is worse than no answer: it is a claim about somebody's home that
    // nothing backs.
    for (const kind of ['GROUNDING_QA', 'POST_SUMMARY_QA', 'COMPLETE_QA'] as const) {
      for (const fixture of fixturesFor((f) => f.interactionKind === kind)) {
        expect(fixture.scenario.expected.requiredCitation, fixture.fixtureId).toBe(true);
      }
    }
  });

  it('a grounded answer may not invent a budget or a timeline', () => {
    for (const fixture of fixturesFor((f) => f.interactionKind === 'GROUNDING_QA')) {
      expect(fixture.scenario.expected.forbiddenObservationFields).toStrictEqual([
        'budget',
        'timeline',
      ]);
    }
  });

  it('out-of-scope and COMPLETE turns may produce NO discovery fact at all', () => {
    // A request Riya has no business answering must not become a source of discovery facts — that is
    // the exact shape of a fabricated lead.
    for (const kind of ['OUT_OF_SCOPE', 'COMPLETE_QA', 'HUMAN_REQUEST'] as const) {
      for (const fixture of fixturesFor((f) => f.interactionKind === kind)) {
        expect(
          fixture.scenario.expected.forbiddenObservationFields,
          fixture.fixtureId,
        ).toHaveLength(7);
      }
    }
  });

  it('a human request allows ZERO questions and no CTA dimension', () => {
    // Somebody who asked for a person and got another question has been ignored, and rewarding
    // momentum here would be training the wrong reflex.
    for (const fixture of fixturesFor((f) => f.interactionKind === 'HUMAN_REQUEST')) {
      expect(fixture.scenario.expected.maxQuestions).toBe(0);
      expect(fixture.scenario.expected.allowedAskedDiscoveryFields).toStrictEqual([]);
      expect(fixture.scenario.expected.requiredQualityDimensions).not.toContain('CTA_QUALITY');
      expect(fixture.scenario.expected.requiredQualityDimensions).not.toContain('SALES_MOMENTUM');
    }
  });

  it('question discipline holds everywhere: never more than two', () => {
    for (const fixture of RIYA_QUALITY_GOLDEN_FIXTURES) {
      expect(fixture.scenario.expected.maxQuestions, fixture.fixtureId).toBeLessThanOrEqual(2);
      expect(fixture.scenario.expected.maxReplyChars, fixture.fixtureId).toBeLessThanOrEqual(600);
    }
  });

  it('CTA quality is measured only where a next step is actually appropriate', () => {
    const withCta = fixturesFor((f) =>
      f.scenario.expected.requiredQualityDimensions.includes('CTA_QUALITY'),
    );
    expect(new Set(withCta.map((f) => f.interactionKind))).toStrictEqual(new Set(['NEXT_STEP']));
    expect(withCta).toHaveLength(6);
  });

  it('every one of the ten dimensions is exercised', () => {
    // A dimension the corpus never touches is a gate that can never be measured, and the evaluator
    // refuses an uncovered gated dimension outright — so a gap here would block the whole suite.
    for (const dimension of RIYA_QUALITY_DIMENSIONS) {
      const count = fixturesFor((f) =>
        f.scenario.expected.requiredQualityDimensions.includes(dimension),
      ).length;
      expect(count, dimension).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// 3. Nothing real is in here.
// ---------------------------------------------------------------------------

describe('the corpus contains no real data of any kind', () => {
  const TEXTS = RIYA_QUALITY_GOLDEN_FIXTURES.map((f) => f.syntheticUserText);

  it('contains no phone number', () => {
    for (const text of TEXTS) {
      // Any run of seven or more digits, and any +91 form. A number somebody used while testing is
      // the single most likely piece of real data to end up in a corpus like this.
      expect(text, text).not.toMatch(/\d{7,}/u);
      expect(text, text).not.toMatch(/\+\s*91/u);
    }
  });

  it('contains no email address', () => {
    for (const text of TEXTS) {
      expect(text, text).not.toMatch(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+/u);
    }
  });

  it('contains no URL or production domain', () => {
    for (const text of TEXTS) {
      expect(text.toLowerCase(), text).not.toMatch(/https?:\/\//u);
      expect(text.toLowerCase(), text).not.toContain('www.');
      expect(text.toLowerCase(), text).not.toContain('quickfurno');
      expect(text.toLowerCase(), text).not.toContain('onedecore');
      expect(text.toLowerCase(), text).not.toContain('.com');
      expect(text.toLowerCase(), text).not.toContain('.in/');
    }
  });

  it('references only obvious synthetic placeholders, never a real city or catalogue entry', () => {
    // `service.alpha` and `city.beta` cannot be mistaken for a catalogue entry, so a passing suite
    // can never be read as a claim about a real offering.
    const joined = TEXTS.join(' ').toLowerCase();
    for (const placeholder of ['service.alpha', 'city.alpha', 'city.beta']) {
      expect(joined).toContain(placeholder);
    }
    for (const real of [
      'bengaluru',
      'bangalore',
      'mumbai',
      'delhi',
      'gurgaon',
      'noida',
      'pune',
      'hyderabad',
    ]) {
      expect(joined, real).not.toContain(real);
    }
  });

  it('carries no control byte or stray whitespace', () => {
    for (const text of TEXTS) {
      // eslint-disable-next-line no-control-regex -- scanning FOR control bytes is the point
      expect(text, text).not.toMatch(/[\u0000-\u0008\u000b-\u001f\u007f]/u);
      expect(text).toBe(text.trim());
      expect(text.length).toBeGreaterThan(10);
    }
  });

  it('has no duplicate message within a language', () => {
    // Two identical fixtures would double one situation's weight in a pass rate without adding any
    // coverage.
    for (const languageMode of RIYA_QUALITY_LANGUAGE_MODES) {
      const texts = fixturesFor((f) => f.languageMode === languageMode).map(
        (f) => f.syntheticUserText,
      );
      expect(new Set(texts).size, languageMode).toBe(24);
    }
  });

  it('writes Hindi in Devanagari and Hinglish in Latin script', () => {
    const devanagari = /[ऀ-ॿ]/u;
    for (const fixture of RIYA_QUALITY_GOLDEN_FIXTURES) {
      if (fixture.languageMode === 'HINDI') {
        expect(devanagari.test(fixture.syntheticUserText), fixture.fixtureId).toBe(true);
      } else {
        // Hinglish is Latin script with Hindi structure, which is what people actually type.
        expect(devanagari.test(fixture.syntheticUserText), fixture.fixtureId).toBe(false);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// 4. The self-test, and what it does NOT prove.
// ---------------------------------------------------------------------------

describe('the corpus and the evaluator agree with each other', () => {
  it('every fixture PASSES its own passing shape, and the suite is eligible', () => {
    // This proves the EVALUATOR works and the fixtures are internally consistent. It proves nothing
    // about any real model or prompt — those observations do not exist in this repository, and the
    // PR and ADR say so in the same words.
    const suite = buildRiyaQualityGoldenSuite();
    const result = evaluateRiyaQualitySuite(suite, passingGoldenObservations());

    expect(result.countsByOutcome).toStrictEqual({ PASS: 72, FAIL: 0, INCONCLUSIVE: 0 });
    expect(result.objectiveFailureCount).toBe(0);
    expect(result.thresholdBreaches).toStrictEqual([]);
    expect(result.qualityEligible).toBe(true);
  });

  it('every canonical-gated dimension is COVERED by the golden suite', () => {
    const result = evaluateRiyaQualitySuite(
      buildRiyaQualityGoldenSuite(),
      passingGoldenObservations(),
    );
    for (const dimension of RIYA_QUALITY_DIMENSIONS) {
      expect(result.dimensionApplicableCounts[dimension], dimension).toBeGreaterThan(0);
      expect(result.dimensionPassRateBps[dimension], dimension).toBe(10_000);
    }
  });

  it('one withheld dimension in enough cases blocks the suite', () => {
    // CONTEXT_USE is gated at 10000, so a single disagreement is enough. That is the intended
    // strictness: a Riya that sometimes ignores what the client already said is the worst failure a
    // sales conversation has.
    const result = evaluateRiyaQualitySuite(
      buildRiyaQualityGoldenSuite(),
      passingGoldenObservations({ withhold: ['CONTEXT_USE'], withholdCases: 1 }),
    );
    expect(result.qualityEligible).toBe(false);
    expect(result.thresholdBreaches.map((b) => b.dimension)).toStrictEqual(['CONTEXT_USE']);
    expect(createRiyaQualityEvidence(result)).toStrictEqual({
      ok: false,
      code: 'quality-not-eligible',
    });
  });

  it('the result and its evidence contain no synthetic conversation text', () => {
    const result = evaluateRiyaQualitySuite(
      buildRiyaQualityGoldenSuite(),
      passingGoldenObservations(),
    );
    const created = createRiyaQualityEvidence(result);
    const serialized = `${JSON.stringify(result)}${JSON.stringify(created)}`;
    for (const fixture of RIYA_QUALITY_GOLDEN_FIXTURES) {
      expect(serialized).not.toContain(fixture.syntheticUserText);
    }
    expect(serialized).not.toContain('reviewer.alpha');
    expect(serialized).not.toContain('modular kitchen');
  });
});
