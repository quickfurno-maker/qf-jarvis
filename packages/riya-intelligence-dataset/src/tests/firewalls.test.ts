/**
 * RID-F1 — the four firewalls (ADR-0107 §17, §22–§25).
 *
 * The protected-exam specs load the REAL RWC-P10 golden corpus from
 * `@qf-jarvis/riya-quality-evaluation/testing` and feed it to the index. That is the only place P10
 * text exists in this package: production source ships none, and a spec below proves it.
 *
 * The false-positive specs matter as much as the true-positive ones. A quarantine that fires on
 * "what is the difference between" is a quarantine authors learn to override, after which it guards
 * nothing.
 */
import { RIYA_QUALITY_GOLDEN_FIXTURES } from '@qf-jarvis/riya-quality-evaluation/testing';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { createProtectedTextIndex, matchProtectedText } from '../internal/leakage.js';
import { scanTextForPrivacy } from '../internal/privacy-scan.js';
import {
  createRiyaDatasetAssistantTurn,
  createRiyaDatasetAuthoritativeContextTurn,
  createRiyaDatasetUserTurn,
} from '../contracts/turns.js';
import { RiyaDatasetError } from '../contracts/errors.js';
import { validateRiyaIntelligenceDataset } from '../service/validate-dataset.js';
import { deriveRiyaSftSamples } from '../service/derive-sft-samples.js';
import {
  acceptedReviews,
  discoveryTurns,
  releasableOptions,
  supportedPriceTurns,
  syntheticTrajectory,
} from '../testing/fixtures.js';

const PROTECTED_INDEX = createProtectedTextIndex(
  RIYA_QUALITY_GOLDEN_FIXTURES.map((fixture) => ({
    protectedRef: fixture.fixtureId,
    text: fixture.syntheticUserText,
  })),
);

const ENGLISH_FIXTURE = RIYA_QUALITY_GOLDEN_FIXTURES.find(
  (fixture) => fixture.fixtureId === 'riya.p10.en.objection-price.02',
);
const HINDI_FIXTURE = RIYA_QUALITY_GOLDEN_FIXTURES.find(
  (fixture) => fixture.fixtureId === 'riya.p10.hi.discovery.01',
);

const codeOf = (run: () => unknown): string => {
  try {
    run();
  } catch (error: unknown) {
    return error instanceof RiyaDatasetError ? error.code : 'not-a-dataset-error';
  }
  return 'no-error';
};

/** A trajectory whose customer says exactly `text`. */
const withUserText = (text: string, id = 'riya.gold.en.leak.001') =>
  syntheticTrajectory({
    trajectoryId: id,
    lineageRootRef: `riya.family.leak.${id}`,
    turns: discoveryTurns({ userText: text }),
  });

// ---------------------------------------------------------------------------
// 1. The protected exam.
// ---------------------------------------------------------------------------

describe('the RWC-P10 exam cannot enter the training corpus', () => {
  it('an EXACT copy of a protected fixture is rejected', () => {
    const text = ENGLISH_FIXTURE?.syntheticUserText ?? '';
    expect(text.length).toBeGreaterThan(10);
    const report = validateRiyaIntelligenceDataset([withUserText(text)], {
      protectedIndex: PROTECTED_INDEX,
    });
    expect(report.protectedExactLeakage).toHaveLength(1);
    expect(report.protectedExactLeakage[0]?.counterpartRef).toBe('riya.p10.en.objection-price.02');
    expect(report.eligible).toBe(false);
  });

  it('a copy differing only in whitespace, case and punctuation is still EXACT', () => {
    // Nobody copies byte for byte. They paste with different spacing and drop the full stop.
    const original = ENGLISH_FIXTURE?.syntheticUserText ?? '';
    const mangled = `  ${original
      .toUpperCase()
      .replace(/\s+/gu, '   ')
      .replace(/[.?!]+$/u, '')}  `;
    const report = validateRiyaIntelligenceDataset([withUserText(mangled)], {
      protectedIndex: PROTECTED_INDEX,
    });
    expect(report.protectedExactLeakage).toHaveLength(1);
    expect(report.protectedNearLeakage).toHaveLength(0);
  });

  it('a Devanagari fixture is matched without translation or transliteration', () => {
    const text = HINDI_FIXTURE?.syntheticUserText ?? '';
    expect(text).toMatch(/[ऀ-ॿ]/u);
    const report = validateRiyaIntelligenceDataset([withUserText(text)], {
      protectedIndex: PROTECTED_INDEX,
    });
    expect(report.protectedExactLeakage).toHaveLength(1);
  });

  it('a LIGHT near-copy is quarantined rather than rejected', () => {
    // Same sentence with a few words changed at the edges. A human decides; a release cannot proceed
    // while the quarantine is unresolved.
    const original = ENGLISH_FIXTURE?.syntheticUserText ?? '';
    const near = `Actually, ${original.replace(/\.$/u, '')} — is that normal?`;
    const report = validateRiyaIntelligenceDataset([withUserText(near)], {
      protectedIndex: PROTECTED_INDEX,
    });
    expect(report.protectedExactLeakage).toHaveLength(0);
    expect(report.protectedNearLeakage).toHaveLength(1);
    expect(report.eligible).toBe(false);
  });

  it('an UNRELATED message on the same topic passes cleanly', () => {
    // Same subject, different sentence. The corpus has to be able to cover price objections at all.
    const report = validateRiyaIntelligenceDataset(
      [
        withUserText(
          'Honestly the number feels high for what we are getting. Can we look at scope?',
        ),
      ],
      { protectedIndex: PROTECTED_INDEX },
    );
    expect(report.protectedExactLeakage).toHaveLength(0);
    expect(report.protectedNearLeakage).toHaveLength(0);
  });

  it('short common phrases do NOT quarantine everything', () => {
    // If they did, an author would turn the check off within a week.
    for (const phrase of [
      'What is the difference between the two?',
      'How long does it usually take?',
      'Do you handle painting?',
      'Which cities do you cover?',
      'Okay, what do we do next?',
      'I am interested.',
    ]) {
      const match = matchProtectedText(PROTECTED_INDEX, phrase);
      expect(match.verdict, phrase).toBe('CLEAR');
    }
  });

  it('a training identity inside the protected namespace is rejected', () => {
    const report = validateRiyaIntelligenceDataset(
      [
        syntheticTrajectory({
          trajectoryId: 'riya.p10.en.discovery.999',
          lineageRootRef: 'riya.family.x.1',
        }),
      ],
      { protectedIndex: PROTECTED_INDEX },
    );
    expect(report.protectedExactLeakage).toHaveLength(1);
  });

  it('production source contains NO protected fixture text and NO P10 identifier', () => {
    // Copying the exam into the guard's own constants would put the exam in the shipped bundle,
    // which is the thing being prevented, wearing a badge.
    const src = fileURLToPath(new URL('../', import.meta.url));
    const skip = new Set(['node_modules', 'dist', 'tests']);
    const walk = (dir: string): string[] =>
      readdirSync(dir).flatMap((entry) => {
        if (skip.has(entry)) return [];
        const full = join(dir, entry);
        return statSync(full).isDirectory() ? walk(full) : entry.endsWith('.ts') ? [full] : [];
      });

    for (const file of walk(src)) {
      const text = readFileSync(file, 'utf8');
      expect(text, `${file} must not name a P10 fixture id`).not.toMatch(/riya\.p10\./u);
      for (const fixture of RIYA_QUALITY_GOLDEN_FIXTURES) {
        expect(text, `${file} must not carry protected fixture text`).not.toContain(
          fixture.syntheticUserText,
        );
      }
    }
  });
});

// ---------------------------------------------------------------------------
// 2. Cross-split leakage.
// ---------------------------------------------------------------------------

describe('a variant cannot cross the split its family is scored in', () => {
  it('one lineage in TRAIN and VALIDATION is a violation', () => {
    const report = validateRiyaIntelligenceDataset([
      syntheticTrajectory({
        trajectoryId: 'riya.gold.en.price.001',
        lineageRootRef: 'riya.family.price.001',
        split: 'TRAIN',
      }),
      syntheticTrajectory({
        trajectoryId: 'riya.gold.en.price.002',
        lineageRootRef: 'riya.family.price.001',
        split: 'VALIDATION',
        turns: discoveryTurns({
          userText: 'A completely different opening about wardrobes in city.beta.',
        }),
      }),
    ]);
    expect(report.lineageSplitViolations).toHaveLength(1);
    expect(report.eligible).toBe(false);
  });

  it('a TRAIN parent with a teacher child in VALIDATION is a violation', () => {
    // The whole reason lineage exists. Row-level splitting would call this clean.
    const parent = syntheticTrajectory({
      trajectoryId: 'riya.gold.en.price.001',
      lineageRootRef: 'riya.family.price.001',
      split: 'TRAIN',
    });
    const child = syntheticTrajectory({
      trajectoryId: 'riya.synthetic.en.price.001.v01',
      lineageRootRef: 'riya.family.price.001',
      split: 'VALIDATION',
      turns: discoveryTurns({
        userText: 'Something entirely unlike the parent, about painting quotes.',
      }),
    });
    const report = validateRiyaIntelligenceDataset([parent, child]);
    expect(report.lineageSplitViolations).toHaveLength(1);
  });

  it('one lineage in ONE split is allowed', () => {
    const report = validateRiyaIntelligenceDataset([
      syntheticTrajectory({
        trajectoryId: 'riya.gold.en.price.001',
        lineageRootRef: 'riya.family.price.001',
      }),
      syntheticTrajectory({
        trajectoryId: 'riya.synthetic.en.price.001.v01',
        lineageRootRef: 'riya.family.price.001',
        turns: discoveryTurns({
          userText: 'A different opening about wardrobes in city.beta entirely.',
        }),
      }),
    ]);
    expect(report.lineageSplitViolations).toHaveLength(0);
  });

  it('an IDENTICAL conversation across splits is an exact duplicate', () => {
    const report = validateRiyaIntelligenceDataset([
      syntheticTrajectory({ trajectoryId: 'a.1', lineageRootRef: 'fam.a' }),
      syntheticTrajectory({ trajectoryId: 'b.1', lineageRootRef: 'fam.b', split: 'VALIDATION' }),
    ]);
    expect(report.exactCrossSplitDuplicates).toHaveLength(1);
    expect(report.eligible).toBe(false);
  });

  it('a NEAR duplicate across splits is quarantined', () => {
    const base = discoveryTurns();
    const near = discoveryTurns({
      userText: 'We just got a new flat and want the kitchen done in city.alpha, roughly.',
    });
    const report = validateRiyaIntelligenceDataset([
      syntheticTrajectory({ trajectoryId: 'a.1', lineageRootRef: 'fam.a', turns: base }),
      syntheticTrajectory({
        trajectoryId: 'b.1',
        lineageRootRef: 'fam.b',
        split: 'HOLDOUT',
        turns: near,
      }),
    ]);
    expect(report.exactCrossSplitDuplicates).toHaveLength(0);
    expect(report.nearCrossSplitDuplicates).toHaveLength(1);
    expect(report.eligible).toBe(false);
  });

  it('a near duplicate in the SAME split is allowed and REPORTED', () => {
    // A family of variants living together is the intended shape. It still belongs in the dedupe
    // stats, so nobody discovers the redundancy after training.
    const report = validateRiyaIntelligenceDataset(
      [
        syntheticTrajectory({
          trajectoryId: 'a.1',
          lineageRootRef: 'fam.a',
          turns: discoveryTurns(),
        }),
        syntheticTrajectory({
          trajectoryId: 'a.2',
          lineageRootRef: 'fam.a',
          turns: discoveryTurns({
            userText: 'We just got a new flat and want the kitchen done in city.alpha, roughly.',
          }),
        }),
      ],
      releasableOptions(),
    );
    expect(report.nearCrossSplitDuplicates).toHaveLength(0);
    expect(report.sameSplitNearDuplicates).toHaveLength(1);
    expect(report.eligible).toBe(true);
  });

  it('two unrelated conversations with the same intent are allowed', () => {
    const report = validateRiyaIntelligenceDataset(
      [
        syntheticTrajectory({ trajectoryId: 'a.1', lineageRootRef: 'fam.a' }),
        syntheticTrajectory({
          trajectoryId: 'b.1',
          lineageRootRef: 'fam.b',
          split: 'VALIDATION',
          turns: discoveryTurns({
            userText: 'Looking at wardrobes for a rented place in city.beta before we move.',
            replyText: 'Understood. Roughly what budget did you have in mind?',
          }),
        }),
      ],
      releasableOptions(),
    );
    expect(report.exactCrossSplitDuplicates).toHaveLength(0);
    expect(report.nearCrossSplitDuplicates).toHaveLength(0);
    expect(report.eligible).toBe(true);
  });

  it('derived SFT samples inherit the trajectory split and lineage', () => {
    const samples = deriveRiyaSftSamples(
      syntheticTrajectory({ split: 'HOLDOUT', lineageRootRef: 'fam.holdout' }),
    );
    expect(samples.every((sample) => sample.split === 'HOLDOUT')).toBe(true);
    expect(samples.every((sample) => sample.lineageRootRef === 'fam.holdout')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 3. The business-fact firewall.
// ---------------------------------------------------------------------------

describe('volatile business truth must come from an earlier authoritative context', () => {
  it("a customer's own quote is allowed, and is NOT Core truth", () => {
    // "I got a 7 lakh quote" is something the customer said. It needs no authority, and treating it
    // as one would let a competitor's number become a fact Riya asserts.
    const report = validateRiyaIntelligenceDataset(
      [
        syntheticTrajectory({
          trajectoryId: 'quote.1',
          lineageRootRef: 'fam.quote',
          primaryInteractionKind: 'OBJECTION_PRICE',
          riskClass: 'HIGH_RISK',
          turns: [
            createRiyaDatasetUserTurn({
              type: 'USER',
              turnRef: 'q1',
              text: 'I got a 7 lakh quote from another company for the same work.',
            }),
            createRiyaDatasetAssistantTurn({
              type: 'ASSISTANT',
              turnRef: 'q2',
              text: 'That is worth comparing properly. What is included in their scope?',
              annotation: {
                decision: 'ANSWER_DIRECT',
                askedDiscoveryFields: ['scope'],
                supportedFactRefs: [],
                responseObjective: 'ADDRESS_OBJECTION',
              },
            }),
          ],
          review: acceptedReviews(2, { objection: true }),
        }),
      ],
      releasableOptions(),
    );
    expect(report.unsupportedBusinessFacts).toHaveLength(0);
    expect(report.eligible).toBe(true);
  });

  it('an assistant price backed by an EARLIER Core fact is allowed', () => {
    const report = validateRiyaIntelligenceDataset(
      [
        syntheticTrajectory({
          trajectoryId: 'price.1',
          lineageRootRef: 'fam.price',
          primaryInteractionKind: 'OBJECTION_PRICE',
          riskClass: 'HIGH_RISK',
          turns: supportedPriceTurns(),
          review: acceptedReviews(2, { objection: true }),
        }),
      ],
      releasableOptions(),
    );
    expect(report.unsupportedBusinessFacts).toHaveLength(0);
    expect(report.eligible).toBe(true);
  });

  it('a citation of a fact that never exists is refused at construction', () => {
    expect(
      codeOf(() =>
        syntheticTrajectory({
          turns: [
            createRiyaDatasetUserTurn({ type: 'USER', turnRef: 'u1', text: 'What does it cost?' }),
            createRiyaDatasetAssistantTurn({
              type: 'ASSISTANT',
              turnRef: 'a1',
              text: 'It starts around 6 lakh.',
              annotation: {
                decision: 'USE_CORE_TRUTH',
                askedDiscoveryFields: [],
                supportedFactRefs: ['fact.that.does.not.exist'],
                responseObjective: 'ANSWER',
              },
            }),
          ],
        }),
      ),
    ).toBe('unsupported-business-fact');
  });

  it('a citation of a FUTURE fact is refused: context must precede use', () => {
    // A training example where the fact arrives afterwards teaches the model that facts are
    // available whenever convenient, which in production means asserting a price nobody gave it.
    expect(
      codeOf(() =>
        syntheticTrajectory({
          turns: [
            createRiyaDatasetUserTurn({ type: 'USER', turnRef: 'u1', text: 'What does it cost?' }),
            createRiyaDatasetAssistantTurn({
              type: 'ASSISTANT',
              turnRef: 'a1',
              text: 'It starts around 6 lakh.',
              annotation: {
                decision: 'USE_CORE_TRUTH',
                askedDiscoveryFields: [],
                supportedFactRefs: ['fact.later'],
                responseObjective: 'ANSWER',
              },
            }),
            createRiyaDatasetAuthoritativeContextTurn({
              type: 'AUTHORITATIVE_CONTEXT',
              turnRef: 'c1',
              authority: 'CORE_RUNTIME_SYNTHETIC',
              facts: [{ factRef: 'fact.later', value: 'starts around 6 lakh', factClass: 'PRICE' }],
            }),
          ],
        }),
      ),
    ).toBe('unsupported-business-fact');
  });
});

// ---------------------------------------------------------------------------
// 4. Privacy and secrets.
// ---------------------------------------------------------------------------

describe('personal data and secrets cannot enter the corpus', () => {
  it.each([
    ['an email', 'Please write to someone@example.com about it.', 'EMAIL'],
    ['a mobile number', 'Call me on 9876543210 tomorrow.', 'PHONE_NUMBER'],
    ['a spaced mobile number', 'My number is 98765 43210.', 'PHONE_NUMBER'],
    ['a +91 number', 'Reach me at +91 98765 43210.', 'PHONE_NUMBER'],
    ['an API key', 'Use sk-live-abcdefghijklmnop for the call.', 'API_KEY'],
    ['a bearer token', 'Send Bearer abcdefghijklmnopqrstuv in the header.', 'BEARER_TOKEN'],
    ['a JWT', 'Token eyJhbGciOiJI.eyJzdWIiOiIx.dBjftJeZ4CVP is set.', 'BEARER_TOKEN'],
    ['a service role token', 'The service_role key is in the env file.', 'SERVICE_ROLE_TOKEN'],
    ['a private key', '-----BEGIN RSA PRIVATE KEY-----', 'PRIVATE_KEY'],
    ['a UPI handle', 'Pay to raghav@okaxis please.', 'UPI_HANDLE'],
    ['a URL', 'See https://example.com/pricing for details.', 'URL'],
    ['a production name', 'I saw this on the QuickFurno site.', 'PRODUCTION_DOMAIN'],
  ])('rejects %s', (_name, text, kind) => {
    expect(scanTextForPrivacy(text)).toContain(kind);
  });

  it.each([
    ['a flat size', 'We just bought a 3BHK in city.alpha.'],
    ['a budget', 'Our budget is around 10 lakh for the whole thing.'],
    ['dimensions', 'The kitchen is about 10 x 12 feet, roughly 1200 sq ft overall.'],
    ['a timeline', 'We need it in 6 weeks, before the 15th.'],
    ['a city', 'The flat is in city.beta, not city.alpha.'],
    ['a plain number', 'There are 4 wardrobes and 2 false ceilings.'],
  ])('allows %s', (_name, text) => {
    expect(scanTextForPrivacy(text)).toStrictEqual([]);
  });

  it('reports the LOCATION and the KIND, and never the value', () => {
    const secret = 'sk-live-abcdefghijklmnop';
    const report = validateRiyaIntelligenceDataset([
      withUserText(`The key is ${secret} if you need it.`),
    ]);
    expect(report.privacyViolations).toHaveLength(1);
    expect(report.privacyViolations[0]?.kind).toBe('API_KEY');
    expect(report.privacyViolations[0]?.locationRef).toBe('t1');
    // The one string nobody should retain must not reach a CI log or a terminal scrollback.
    expect(JSON.stringify(report)).not.toContain(secret);
    expect(report.eligible).toBe(false);
  });

  it('scans authoritative FACT values too, not only spoken turns', () => {
    const report = validateRiyaIntelligenceDataset([
      syntheticTrajectory({
        trajectoryId: 'fact.leak.1',
        lineageRootRef: 'fam.factleak',
        turns: [
          createRiyaDatasetUserTurn({ type: 'USER', turnRef: 'u1', text: 'Who do I contact?' }),
          createRiyaDatasetAuthoritativeContextTurn({
            type: 'AUTHORITATIVE_CONTEXT',
            turnRef: 'c1',
            authority: 'GOVERNED_KNOWLEDGE_SYNTHETIC',
            facts: [
              { factRef: 'f.contact', value: 'Escalate to ops@example.com', factClass: 'PROCESS' },
            ],
          }),
          createRiyaDatasetAssistantTurn({
            type: 'ASSISTANT',
            turnRef: 'a1',
            text: 'I can connect you with a consultant.',
            annotation: {
              // A handoff cites nothing: only USE_CORE_TRUTH and USE_GOVERNED_KNOWLEDGE may, and a
              // decision that does not name an authority must not claim one (owner correction on
              // PR #112).
              decision: 'HANDOFF_HUMAN',
              askedDiscoveryFields: [],
              supportedFactRefs: [],
              responseObjective: 'HANDOFF',
            },
          }),
        ],
      }),
    ]);
    expect(report.privacyViolations.map((one) => one.kind)).toStrictEqual(['EMAIL']);
    expect(report.privacyViolations[0]?.locationRef).toBe('f.contact');
  });
});

// ---------------------------------------------------------------------------
// 5. Reviews, at dataset level.
// ---------------------------------------------------------------------------

describe('review effort is risk-based', () => {
  it('a STANDARD trajectory needs one accepted review, and zero fails', () => {
    const none = validateRiyaIntelligenceDataset([syntheticTrajectory({ review: [] })]);
    expect(none.insufficientReview).toHaveLength(1);
    expect(none.eligible).toBe(false);

    const one = validateRiyaIntelligenceDataset([
      syntheticTrajectory({ review: acceptedReviews(1) }),
    ]);
    expect(one.insufficientReview).toHaveLength(0);
    expect(one.reviewedTrajectories).toBe(1);
  });

  it('a HIGH_RISK trajectory needs TWO distinct accepted reviews', () => {
    const objection = (count: number) =>
      syntheticTrajectory({
        trajectoryId: 'hr.1',
        lineageRootRef: 'fam.hr',
        primaryInteractionKind: 'OBJECTION_PRICE',
        riskClass: 'HIGH_RISK',
        turns: supportedPriceTurns(),
        review: acceptedReviews(count, { objection: true }),
      });
    expect(validateRiyaIntelligenceDataset([objection(0)]).insufficientReview).toHaveLength(1);
    expect(validateRiyaIntelligenceDataset([objection(1)]).insufficientReview).toHaveLength(1);
    expect(validateRiyaIntelligenceDataset([objection(2)]).insufficientReview).toHaveLength(0);
  });

  it('an objection trajectory reviewed only on the BASELINE dimensions is insufficient', () => {
    // An objection answered clearly but coldly is the failure that matters commercially, and it is
    // invisible to clarity and naturalness.
    const report = validateRiyaIntelligenceDataset([
      syntheticTrajectory({
        trajectoryId: 'hr.2',
        lineageRootRef: 'fam.hr2',
        primaryInteractionKind: 'OBJECTION_TRUST',
        riskClass: 'HIGH_RISK',
        turns: supportedPriceTurns(),
        review: acceptedReviews(2, { objection: false }),
      }),
    ]);
    expect(report.insufficientReview).toHaveLength(1);
  });

  it('the AUTHOR is not a reviewer', () => {
    // Somebody checking their own work is the failure the rule exists to prevent.
    const report = validateRiyaIntelligenceDataset([
      syntheticTrajectory({
        sourceRef: 'author.alpha',
        review: acceptedReviews(1, { refs: ['author.alpha'] }),
      }),
    ]);
    expect(report.insufficientReview).toHaveLength(1);
  });

  it('a REJECTED review does not count toward the requirement', () => {
    const report = validateRiyaIntelligenceDataset([
      syntheticTrajectory({
        review: [
          {
            reviewRef: 'reviewer.alpha',
            decision: 'REJECTED',
            satisfiedQualityDimensions: ['CLARITY', 'NATURALNESS', 'CONTEXT_USE', 'NON_REPETITION'],
          },
        ],
      }),
    ]);
    expect(report.insufficientReview).toHaveLength(1);
  });

  it('the report carries no reviewRef anywhere', () => {
    // Across a corpus that would be a performance record of named people, assembled as a side effect
    // of versioning a dataset.
    const report = validateRiyaIntelligenceDataset([syntheticTrajectory()]);
    const serialized = JSON.stringify(report);
    expect(serialized).not.toContain('reviewer.alpha');
    expect(serialized).not.toContain('author.alpha');
  });
});
