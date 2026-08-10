/**
 * RID-F1 — deep re-proof, release attestation binding, and business-fact authority
 * (owner correction on PR #112).
 *
 * ### Three holes, each of which let an unchecked thing reach a place that reads as a verdict
 *
 * **The trajectory constructor did not deep-re-prove.** It accepted `initialState` and `turns` as
 * unknown, checked that each turn was an object with a `type`, and returned the caller's objects. So
 * the JSONL promise — "parsing re-proves a record" — was false at the turn level: an annotation with
 * a chain-of-thought field, a context turn with a duplicate fact, a user turn with empty text all
 * survived a round trip.
 *
 * **The exam firewall and the coverage policy were optional arguments.** Omitting the index
 * substituted an empty one, which matches nothing, produces no finding, and yields `eligible: true`.
 * A release that looks clean precisely because the check never ran.
 *
 * **Release evidence paired a report and a manifest by COUNT.** Two different corpora of the same
 * size paired cleanly, so an eligible report for dataset A could attest a manifest for dataset B.
 *
 * **And the business-fact rule only proved cited refs existed.** `USE_CORE_TRUTH` with an empty
 * citation list — a turn claiming Core said something while citing nothing — was representable.
 */
import { describe, expect, it } from 'vitest';

import { RiyaDatasetError } from '../contracts/errors.js';
import { createRiyaDatasetCoveragePolicy } from '../contracts/coverage-policy.js';
import { createRiyaDatasetReleasePolicy } from '../contracts/release-policy.js';
import {
  createRiyaDatasetAssistantTurn,
  createRiyaDatasetAuthoritativeContextTurn,
  createRiyaDatasetUserTurn,
} from '../contracts/turns.js';
import type { RiyaDatasetTurnV1 } from '../contracts/turns.js';
import { createRiyaIntelligenceTrajectory } from '../contracts/trajectory.js';
import type { RiyaIntelligenceTrajectoryV1 } from '../contracts/trajectory.js';
import { createProtectedTextIndex } from '../internal/leakage.js';
import { detectVolatileClaimClasses } from '../internal/business-fact-scan.js';
import { SHA256_HEX } from '../internal/sha256.js';
import {
  riyaDatasetReportIntegrityHolds,
  validatedDatasetSha256FromManifestRecords,
} from '../internal/report-integrity.js';
import { buildRiyaIntelligenceDatasetManifest } from '../service/create-manifest.js';
import { createRiyaDatasetReleaseEvidence } from '../service/create-release-evidence.js';
import {
  parseRiyaTrajectoryJsonlLine,
  serializeRiyaTrajectoryJsonlLine,
} from '../service/jsonl.js';
import { validateRiyaIntelligenceDataset } from '../service/validate-dataset.js';
import {
  acceptedReviews,
  discoveryTurns,
  releasableOptions,
  releasePolicyFor,
  SYNTHETIC_DATASET_INSTANT,
  syntheticProtectedIndex,
  syntheticTrajectory,
} from '../testing/fixtures.js';

const codeOf = (run: () => unknown): string => {
  try {
    run();
  } catch (error: unknown) {
    return error instanceof RiyaDatasetError ? error.code : 'not-a-dataset-error';
  }
  return 'no-error';
};

/** A canonical trajectory, as a plain JSON object a caller could have assembled by hand. */
const asRaw = (trajectory: RiyaIntelligenceTrajectoryV1): Record<string, unknown> =>
  JSON.parse(serializeRiyaTrajectoryJsonlLine(trajectory)) as Record<string, unknown>;

const manifestOf = (trajectories: readonly RiyaIntelligenceTrajectoryV1[]) =>
  buildRiyaIntelligenceDatasetManifest({
    datasetId: 'riya-intelligence-v1',
    datasetVersion: 1,
    policyVersion: 1,
    createdAt: SYNTHETIC_DATASET_INSTANT,
    trajectories,
  });

// ---------------------------------------------------------------------------
// 1. Deep re-proof of nested state and turns.
// ---------------------------------------------------------------------------

describe('the trajectory constructor re-proves every nested value', () => {
  it('refuses an initialState carrying a conversation identity', () => {
    const raw = asRaw(syntheticTrajectory());
    expect(
      codeOf(() =>
        createRiyaIntelligenceTrajectory({
          ...raw,
          initialState: { ...(raw['initialState'] as object), tenantId: 'tenant.a' },
        } as never),
      ),
    ).toBe('invalid-trajectory');
  });

  it('refuses an initialState whose value and provenance disagree', () => {
    const raw = asRaw(syntheticTrajectory());
    expect(
      codeOf(() =>
        createRiyaIntelligenceTrajectory({
          ...raw,
          initialState: {
            phase: 'NEED',
            discovery: { budget: 'budget.mid' },
            fieldProvenance: {},
            summaryConfirmed: false,
          },
        } as never),
      ),
    ).toBe('invalid-trajectory');
  });

  it('returns the CANONICAL state, not the caller object', () => {
    const supplied = {
      phase: 'NEED' as const,
      discovery: {},
      fieldProvenance: {},
      summaryConfirmed: false,
    };
    const trajectory = createRiyaIntelligenceTrajectory({
      ...asRaw(syntheticTrajectory()),
      initialState: supplied,
    } as never);
    expect(trajectory.initialState).not.toBe(supplied);
    expect(Object.isFrozen(trajectory.initialState)).toBe(true);
  });

  it.each([
    [
      'a USER turn with an extra key',
      { type: 'USER', turnRef: 'u1', text: 'Hello there.', channel: 'WEB' },
    ],
    ['a USER turn with empty text', { type: 'USER', turnRef: 'u1', text: '' }],
    ['an unknown turn type', { type: 'SYSTEM', turnRef: 's1', text: 'You are Riya.' }],
    ['a turn that is not an object', 'just a string'],
  ])('refuses %s', (_name, badTurn) => {
    const raw = asRaw(syntheticTrajectory());
    expect(
      codeOf(() =>
        createRiyaIntelligenceTrajectory({
          ...raw,
          turns: [badTurn, ...(raw['turns'] as unknown[]).slice(1)],
        } as never),
      ),
    ).toBe('invalid-turn');
  });

  it('refuses a CONTEXT turn with an extra key or a duplicate fact ref', () => {
    const base = {
      type: 'AUTHORITATIVE_CONTEXT',
      turnRef: 'c1',
      authority: 'CORE_RUNTIME_SYNTHETIC',
      facts: [{ factRef: 'f1', value: 'something synthetic', factClass: 'POLICY' }],
    };
    const raw = asRaw(syntheticTrajectory());
    const withContext = (context: unknown) => ({
      ...raw,
      turns: [context, ...(raw['turns'] as unknown[])],
    });

    expect(
      codeOf(() =>
        createRiyaIntelligenceTrajectory(withContext({ ...base, retrievedAt: 'now' }) as never),
      ),
    ).toBe('invalid-turn');
    expect(
      codeOf(() =>
        createRiyaIntelligenceTrajectory(
          withContext({
            ...base,
            facts: [
              { factRef: 'f1', value: 'a', factClass: 'POLICY' },
              { factRef: 'f1', value: 'b', factClass: 'POLICY' },
            ],
          }) as never,
        ),
      ),
    ).toBe('invalid-turn');
  });

  it('refuses an ASSISTANT turn with hidden reasoning, two questions or a bad batch', () => {
    const raw = asRaw(syntheticTrajectory());
    const withAssistant = (annotation: unknown) => ({
      ...raw,
      turns: [
        (raw['turns'] as unknown[])[0],
        { type: 'ASSISTANT', turnRef: 'a1', text: 'Understood.', annotation },
      ],
    });

    for (const annotation of [
      {
        decision: 'ANSWER_DIRECT',
        askedDiscoveryFields: [],
        supportedFactRefs: [],
        responseObjective: 'ANSWER',
        reasoning: 'the client seems price sensitive',
      },
      {
        decision: 'ASK_DISCOVERY',
        askedDiscoveryFields: ['budget', 'timeline'],
        supportedFactRefs: [],
        responseObjective: 'DISCOVER',
      },
      {
        decision: 'ANSWER_DIRECT',
        expectedObservationBatch: {
          version: 1,
          observations: [],
          skipProjectDetails: false,
          raw: 'x',
        },
        askedDiscoveryFields: [],
        supportedFactRefs: [],
        responseObjective: 'ANSWER',
      },
    ]) {
      expect(
        codeOf(() => createRiyaIntelligenceTrajectory(withAssistant(annotation) as never)),
        JSON.stringify(annotation).slice(0, 60),
      ).toBe('invalid-turn');
    }
  });

  it('returns CANONICAL frozen turns, annotations and facts', () => {
    const trajectory = createRiyaIntelligenceTrajectory(asRaw(syntheticTrajectory()) as never);
    for (const turn of trajectory.turns) {
      expect(Object.isFrozen(turn)).toBe(true);
      if (turn.type === 'ASSISTANT') {
        expect(Object.isFrozen(turn.annotation)).toBe(true);
      }
      if (turn.type === 'AUTHORITATIVE_CONTEXT') {
        for (const fact of turn.facts) {
          expect(Object.isFrozen(fact)).toBe(true);
        }
      }
    }
  });

  it('is idempotent: a canonical trajectory re-proves to itself', () => {
    const once = syntheticTrajectory();
    const twice = createRiyaIntelligenceTrajectory(once);
    expect(twice).toStrictEqual(once);
  });
});

// ---------------------------------------------------------------------------
// 2. The boundaries re-prove too.
// ---------------------------------------------------------------------------

describe('JSONL, validation and the manifest builder all re-prove at their boundary', () => {
  const fabricated = () => {
    const raw = asRaw(syntheticTrajectory());
    return {
      ...raw,
      turns: [
        (raw['turns'] as unknown[])[0],
        {
          type: 'ASSISTANT',
          turnRef: 'a1',
          text: 'Understood.',
          annotation: {
            decision: 'ANSWER_DIRECT',
            askedDiscoveryFields: [],
            supportedFactRefs: [],
            responseObjective: 'ANSWER',
            chainOfThought: 'step one, step two',
          },
        },
      ],
    };
  };

  it('a valid canonical line still round-trips', () => {
    const trajectory = syntheticTrajectory();
    expect(
      parseRiyaTrajectoryJsonlLine(serializeRiyaTrajectoryJsonlLine(trajectory)),
    ).toStrictEqual(trajectory);
  });

  it('JSONL refuses a malformed nested STATE', () => {
    const raw = asRaw(syntheticTrajectory());
    expect(
      codeOf(() =>
        parseRiyaTrajectoryJsonlLine(
          JSON.stringify({
            ...raw,
            initialState: { ...(raw['initialState'] as object), tenantId: 't' },
          }),
        ),
      ),
    ).toBe('invalid-trajectory');
  });

  it('JSONL refuses a nested USER or ASSISTANT extra key', () => {
    const raw = asRaw(syntheticTrajectory());
    expect(
      codeOf(() =>
        parseRiyaTrajectoryJsonlLine(
          JSON.stringify({
            ...raw,
            turns: [{ type: 'USER', turnRef: 'u1', text: 'Hi.', locale: 'en-IN' }],
          }),
        ),
      ),
    ).toBe('invalid-turn');
    expect(codeOf(() => parseRiyaTrajectoryJsonlLine(JSON.stringify(fabricated())))).toBe(
      'invalid-turn',
    );
  });

  it('validateRiyaIntelligenceDataset refuses a fabricated nested object', () => {
    // Gating whatever a caller claimed to hand over is not gating.
    expect(
      codeOf(() => validateRiyaIntelligenceDataset([fabricated() as never], releasableOptions())),
    ).toBe('invalid-turn');
  });

  it('the manifest builder refuses a fabricated nested object', () => {
    // A digest over an invalid record is a precise identity for something invalid, which is worse
    // than no identity: it makes the invalid record citable.
    expect(codeOf(() => manifestOf([fabricated() as never]))).toBe('invalid-turn');
  });
});

// ---------------------------------------------------------------------------
// 3. The protected index has an identity, and the release policy pins it.
// ---------------------------------------------------------------------------

describe('the protected corpus is pinned, so the exam firewall provably ran', () => {
  it('exposes an entry count and a 64-hex digest', () => {
    const index = syntheticProtectedIndex();
    expect(index.entryCount).toBe(2);
    expect(index.indexSha256).toMatch(SHA256_HEX);
  });

  it('is order-invariant: the same entries in any order are the same corpus', () => {
    const entries = [
      {
        protectedRef: 'protected.alpha.en.one.01',
        text: 'A protected synthetic evaluation sentence.',
      },
      {
        protectedRef: 'protected.alpha.en.two.01',
        text: 'A second protected synthetic evaluation sentence.',
      },
    ];
    expect(createProtectedTextIndex([...entries].reverse()).indexSha256).toBe(
      createProtectedTextIndex(entries).indexSha256,
    );
  });

  it('one changed protected WORD changes the digest', () => {
    const changed = createProtectedTextIndex([
      {
        protectedRef: 'protected.alpha.en.one.01',
        text: 'A protected synthetic evaluation phrase.',
      },
      {
        protectedRef: 'protected.alpha.en.two.01',
        text: 'A second protected synthetic evaluation sentence.',
      },
    ]);
    expect(changed.indexSha256).not.toBe(syntheticProtectedIndex().indexSha256);
  });

  it('a difference normalization deliberately erases does NOT change the digest', () => {
    // Trailing punctuation and case are folded before hashing, so the same exam sentence typed two
    // ways is one corpus. That is the same normalization the leakage match uses, and the identity
    // must agree with it or a policy would pin a corpus the firewall does not recognise.
    const respaced = createProtectedTextIndex([
      {
        protectedRef: 'protected.alpha.en.one.01',
        text: '  A Protected   Synthetic Evaluation Sentence  ',
      },
      {
        protectedRef: 'protected.alpha.en.two.01',
        text: 'A second protected synthetic evaluation sentence.',
      },
    ]);
    expect(respaced.indexSha256).toBe(syntheticProtectedIndex().indexSha256);
  });

  it('refuses a conflicting duplicate protectedRef', () => {
    // The ref-to-text pair IS the identity. Keeping the first silently would let two different
    // corpora hash the same.
    expect(
      codeOf(() =>
        createProtectedTextIndex([
          { protectedRef: 'protected.alpha.en.one.01', text: 'one' },
          { protectedRef: 'protected.alpha.en.one.01', text: 'two' },
        ]),
      ),
    ).toBe('invalid-protected-index');
  });

  it('a MISSING release policy blocks eligibility', () => {
    const report = validateRiyaIntelligenceDataset([syntheticTrajectory()]);
    expect(report.releaseBindingFailures).toStrictEqual(['RELEASE_POLICY_MISSING']);
    expect(report.eligible).toBe(false);
    expect(report.releasePolicyId).toBeUndefined();
  });

  it('a MISSING protected index blocks, even under a policy', () => {
    // THE hole. An empty substitute index matches nothing and produced a clean report.
    const report = validateRiyaIntelligenceDataset([syntheticTrajectory()], {
      releasePolicy: releasePolicyFor(syntheticProtectedIndex()),
    });
    expect(report.releaseBindingFailures).toContain('PROTECTED_INDEX_MISSING');
    expect(report.eligible).toBe(false);
  });

  it('an EMPTY index where entries were expected blocks', () => {
    const report = validateRiyaIntelligenceDataset([syntheticTrajectory()], {
      protectedIndex: createProtectedTextIndex([]),
      releasePolicy: releasePolicyFor(syntheticProtectedIndex()),
    });
    expect([...report.releaseBindingFailures].sort()).toStrictEqual([
      'PROTECTED_INDEX_COUNT_MISMATCH',
      'PROTECTED_INDEX_DIGEST_MISMATCH',
    ]);
    expect(report.eligible).toBe(false);
  });

  it('a WRONG index with the SAME count blocks on the digest alone', () => {
    const wrong = createProtectedTextIndex([
      { protectedRef: 'protected.alpha.en.one.01', text: 'Something else entirely.' },
      { protectedRef: 'protected.alpha.en.two.01', text: 'And another different sentence.' },
    ]);
    const report = validateRiyaIntelligenceDataset([syntheticTrajectory()], {
      protectedIndex: wrong,
      releasePolicy: releasePolicyFor(syntheticProtectedIndex()),
    });
    expect(report.releaseBindingFailures).toStrictEqual(['PROTECTED_INDEX_DIGEST_MISMATCH']);
    expect(report.eligible).toBe(false);
  });

  it('a correctly bound run is eligible and names what gated it', () => {
    const report = validateRiyaIntelligenceDataset([syntheticTrajectory()], releasableOptions());
    expect(report.releaseBindingFailures).toStrictEqual([]);
    expect(report.eligible).toBe(true);
    expect(report.releasePolicyId).toBe('riya-dataset-release-v1');
    expect(report.protectedCorpusRef).toBe('protected.corpus.synthetic');
    expect(report.protectedEntryCount).toBe(2);
    expect(report.protectedIndexSha256).toBe(syntheticProtectedIndex().indexSha256);
    // And no protected TEXT reaches the report.
    expect(JSON.stringify(report)).not.toContain('A protected synthetic evaluation sentence');
  });

  it('a release policy refuses a zero protected entry count', () => {
    // A policy expecting no exam corpus is a policy disabling the firewall. That is an ADR, not a
    // field somebody sets to 0.
    expect(
      codeOf(() =>
        createRiyaDatasetReleasePolicy({
          policyId: 'p',
          policyVersion: 1,
          coveragePolicy: createRiyaDatasetCoveragePolicy({ policyId: 'c', policyVersion: 1 }),
          protectedCorpusRef: 'corpus',
          protectedIndexSha256: 'a'.repeat(64),
          protectedEntryCount: 0,
        }),
      ),
    ).toBe('invalid-release-policy');
  });
});

// ---------------------------------------------------------------------------
// 4. Report and release-evidence binding.
// ---------------------------------------------------------------------------

describe('a release attestation is bound to the exact dataset it validated', () => {
  const datasetA = () => [syntheticTrajectory()];
  const datasetB = () => [
    syntheticTrajectory({
      trajectoryId: 'b.1',
      lineageRootRef: 'fam.b',
      turns: discoveryTurns({
        userText: 'Wardrobes for a rented place in city.beta before we move in.',
        replyText: 'Understood. Roughly what budget did you have in mind?',
      }),
    }),
  ];

  const reportFor = (trajectories: readonly RiyaIntelligenceTrajectoryV1[]) =>
    validateRiyaIntelligenceDataset(trajectories, releasableOptions());

  it('the manifest recomputes the report dataset digest', () => {
    const trajectories = datasetA();
    const report = reportFor(trajectories);
    expect(report.validatedDatasetSha256).toMatch(SHA256_HEX);
    expect(validatedDatasetSha256FromManifestRecords(manifestOf(trajectories).records)).toBe(
      report.validatedDatasetSha256,
    );
  });

  it('the report digest covers the report, and recomputes', () => {
    const report = reportFor(datasetA());
    expect(report.reportSha256).toMatch(SHA256_HEX);
    expect(riyaDatasetReportIntegrityHolds(report)).toBe(true);
  });

  it('an UNTOUCHED exact pair is accepted', () => {
    const trajectories = datasetA();
    const created = createRiyaDatasetReleaseEvidence({
      report: reportFor(trajectories),
      manifest: manifestOf(trajectories),
    });
    expect(created.ok).toBe(true);
    if (!created.ok) {
      throw new Error('expected evidence');
    }
    expect(created.evidence.syntheticOnly).toBe(true);
    expect(created.evidence.trainingApproval).toBe(false);
    expect(created.evidence.releasePolicyId).toBe('riya-dataset-release-v1');
    expect(created.evidence.protectedIndexSha256).toBe(syntheticProtectedIndex().indexSha256);
    expect(created.evidence.validatedDatasetSha256).toMatch(SHA256_HEX);
  });

  it('a SAME-SIZE swap — report A with manifest B — is refused', () => {
    // THE laundering hole. Counting could not tell these apart.
    expect(
      createRiyaDatasetReleaseEvidence({
        report: reportFor(datasetA()),
        manifest: manifestOf(datasetB()),
      }),
    ).toStrictEqual({ ok: false, code: 'release-binding-invalid' });
  });

  it('the same ids with ONE changed character are refused', () => {
    const edited = [
      syntheticTrajectory({
        turns: discoveryTurns({
          userText: 'We just got a new flat and want the kitchen done in city.alphaa.',
        }),
      }),
    ];
    expect(
      createRiyaDatasetReleaseEvidence({
        report: reportFor(datasetA()),
        manifest: manifestOf(edited),
      }),
    ).toStrictEqual({ ok: false, code: 'release-binding-invalid' });
  });

  it('the same count and splits but a different LINEAGE is refused', () => {
    const relineaged = [syntheticTrajectory({ lineageRootRef: 'riya.family.other.001' })];
    expect(
      createRiyaDatasetReleaseEvidence({
        report: reportFor(datasetA()),
        manifest: manifestOf(relineaged),
      }),
    ).toStrictEqual({ ok: false, code: 'release-binding-invalid' });
  });

  it('an input-order permutation of the SAME dataset is accepted', () => {
    const pair = [...datasetA(), ...datasetB()];
    const report = reportFor(pair);
    const reversed = manifestOf([...pair].reverse());
    const created = createRiyaDatasetReleaseEvidence({ report, manifest: reversed });
    expect(created.ok).toBe(true);
  });

  /** A genuine INELIGIBLE report, so a tamper that "fixes" it is a real edit rather than a no-op. */
  const flawedReport = () =>
    validateRiyaIntelligenceDataset(
      [
        syntheticTrajectory({
          turns: discoveryTurns({
            userText: 'Call me on 9876543210 about the kitchen in city.alpha.',
          }),
        }),
      ],
      releasableOptions(),
    );

  it.each([
    ['the eligibility verdict', (r: ReturnType<typeof reportFor>) => ({ ...r, eligible: true })],
    [
      'the dataset digest',
      (r: ReturnType<typeof reportFor>) => ({ ...r, validatedDatasetSha256: 'a'.repeat(64) }),
    ],
    [
      'the release policy identity',
      (r: ReturnType<typeof reportFor>) => ({ ...r, releasePolicyId: 'some-other-policy' }),
    ],
    [
      'the trajectory count',
      (r: ReturnType<typeof reportFor>) => ({ ...r, totalTrajectories: 99 }),
    ],
    [
      'an erased finding',
      (r: ReturnType<typeof reportFor>) => ({ ...r, privacyViolations: [], eligible: true }),
    ],
    [
      'the protected index digest',
      (r: ReturnType<typeof reportFor>) => ({ ...r, protectedIndexSha256: 'b'.repeat(64) }),
    ],
  ])('a report with %s edited, without a new reportSha256, is refused', (_name, tamper) => {
    // Against a FLAWED report, so "erase the finding" and "flip the verdict" are genuine edits. An
    // already-clean report is unchanged by either, and a spec that edits nothing proves nothing.
    const tampered = tamper(flawedReport());
    expect(riyaDatasetReportIntegrityHolds(tampered)).toBe(false);
    expect(
      createRiyaDatasetReleaseEvidence({ report: tampered, manifest: manifestOf(datasetA()) }),
    ).toStrictEqual({ ok: false, code: 'manifest-digest-invalid' });
  });

  it('an UNBOUND report can never be attested, however clean', () => {
    const trajectories = datasetA();
    const unbound = validateRiyaIntelligenceDataset(trajectories);
    expect(unbound.eligible).toBe(false);
    expect(
      createRiyaDatasetReleaseEvidence({ report: unbound, manifest: manifestOf(trajectories) }),
    ).toStrictEqual({ ok: false, code: 'dataset-not-eligible' });
  });

  it('evidence takes the policy identity from the REPORT — there is no override', () => {
    // Accepting a caller-supplied id was how an unbound validation could be attested under a policy
    // it had never applied.
    const trajectories = datasetA();
    const created = createRiyaDatasetReleaseEvidence({
      report: reportFor(trajectories),
      manifest: manifestOf(trajectories),
      releasePolicyId: 'a-policy-nobody-validated-against',
      releasePolicyVersion: 99,
    } as never);
    if (!created.ok) {
      throw new Error('expected evidence');
    }
    expect(created.evidence.releasePolicyId).toBe('riya-dataset-release-v1');
    expect(created.evidence.releasePolicyVersion).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 5. Business-fact authority.
// ---------------------------------------------------------------------------

const coreFact = (turnRef: string, factRef: string, factClass: string, value: string) =>
  createRiyaDatasetAuthoritativeContextTurn({
    type: 'AUTHORITATIVE_CONTEXT',
    turnRef,
    authority: 'CORE_RUNTIME_SYNTHETIC',
    facts: [{ factRef, value, factClass: factClass as never }],
  });

const governedFact = (turnRef: string, factRef: string, factClass: string, value: string) =>
  createRiyaDatasetAuthoritativeContextTurn({
    type: 'AUTHORITATIVE_CONTEXT',
    turnRef,
    authority: 'GOVERNED_KNOWLEDGE_SYNTHETIC',
    facts: [{ factRef, value, factClass: factClass as never }],
  });

const reply = (text: string, decision: string, supportedFactRefs: readonly string[]) =>
  createRiyaDatasetAssistantTurn({
    type: 'ASSISTANT',
    turnRef: 'a1',
    text,
    annotation: {
      decision: decision as never,
      askedDiscoveryFields: [],
      supportedFactRefs,
      responseObjective: 'ANSWER',
    },
  });

const build = (turns: readonly RiyaDatasetTurnV1[]) =>
  codeOf(() =>
    syntheticTrajectory({
      trajectoryId: 'fact.1',
      lineageRootRef: 'fam.fact',
      turns,
      review: acceptedReviews(1),
    }),
  );

describe('a decision that names an authority must actually rest on it', () => {
  const ask = createRiyaDatasetUserTurn({
    type: 'USER',
    turnRef: 'u1',
    text: 'What would this cost with you?',
  });

  it('USE_CORE_TRUTH with NO citation is refused', () => {
    // The commonest failure, and it was representable: a turn claiming Core said something while
    // citing nothing.
    expect(build([ask, reply('It starts around 6 lakh.', 'USE_CORE_TRUTH', [])])).toBe(
      'unsupported-business-fact',
    );
  });

  it('USE_GOVERNED_KNOWLEDGE with NO citation is refused', () => {
    expect(
      build([ask, reply('We cover painting as part of interiors.', 'USE_GOVERNED_KNOWLEDGE', [])]),
    ).toBe('unsupported-business-fact');
  });

  it('a Core decision citing a GOVERNED fact is refused, and the reverse too', () => {
    // Two authorities with different update paths and different consequences for being wrong. A
    // corpus that blurred them would teach the model they are interchangeable.
    expect(
      build([
        ask,
        governedFact('c1', 'f.price', 'PRICE', 'standard scope starts around 6 lakh'),
        reply('It starts around 6 lakh.', 'USE_CORE_TRUTH', ['f.price']),
      ]),
    ).toBe('unsupported-business-fact');
    expect(
      build([
        ask,
        coreFact('c1', 'f.price', 'PRICE', 'standard scope starts around 6 lakh'),
        reply('It starts around 6 lakh.', 'USE_GOVERNED_KNOWLEDGE', ['f.price']),
      ]),
    ).toBe('unsupported-business-fact');
  });

  it('a matching authority and class is accepted', () => {
    expect(
      build([
        ask,
        coreFact('c1', 'f.price', 'PRICE', 'standard scope starts around 6 lakh'),
        reply('It starts around 6 lakh.', 'USE_CORE_TRUTH', ['f.price']),
      ]),
    ).toBe('no-error');
    expect(
      build([
        ask,
        governedFact('c1', 'f.paint', 'SERVICE_AVAILABILITY', 'painting is offered with interiors'),
        reply('We offer painting as part of the interior scope.', 'USE_GOVERNED_KNOWLEDGE', [
          'f.paint',
        ]),
      ]),
    ).toBe('no-error');
  });

  it('a decision that names NO authority may not cite a fact', () => {
    expect(
      build([
        ask,
        coreFact('c1', 'f.price', 'PRICE', 'standard scope starts around 6 lakh'),
        reply('Let me connect you with a consultant.', 'HANDOFF_HUMAN', ['f.price']),
      ]),
    ).toBe('unsupported-business-fact');
  });

  it('a dangling or FUTURE citation is still refused', () => {
    expect(build([ask, reply('It starts around 6 lakh.', 'USE_CORE_TRUTH', ['f.nope'])])).toBe(
      'unsupported-business-fact',
    );
    expect(
      build([
        ask,
        reply('It starts around 6 lakh.', 'USE_CORE_TRUTH', ['f.later']),
        coreFact('c1', 'f.later', 'PRICE', 'starts around 6 lakh'),
      ]),
    ).toBe('unsupported-business-fact');
  });
});

describe('an obvious volatile claim needs a matching fact', () => {
  const ask = (text: string) => createRiyaDatasetUserTurn({ type: 'USER', turnRef: 'u1', text });

  it('an unsupported PRICE assertion is refused, and a supported one is accepted', () => {
    expect(
      build([
        ask('What would this cost?'),
        reply('Our price starts around 6 lakh for a standard scope.', 'ANSWER_DIRECT', []),
      ]),
    ).toBe('unsupported-business-fact');
    expect(
      build([
        ask('What would this cost?'),
        coreFact('c1', 'f.price', 'PRICE', 'standard scope starts around 6 lakh'),
        reply('Our price starts around 6 lakh for a standard scope.', 'USE_CORE_TRUTH', [
          'f.price',
        ]),
      ]),
    ).toBe('no-error');
  });

  it('an unsupported WARRANTY assertion is refused', () => {
    expect(
      build([
        ask('What warranty do you give?'),
        reply('We provide a 10 year warranty on the carcass.', 'ANSWER_DIRECT', []),
      ]),
    ).toBe('unsupported-business-fact');
    expect(
      build([
        ask('What warranty do you give?'),
        governedFact('c1', 'f.warranty', 'WARRANTY', 'carcass warranty is 10 years'),
        reply('We provide a 10 year warranty on the carcass.', 'USE_GOVERNED_KNOWLEDGE', [
          'f.warranty',
        ]),
      ]),
    ).toBe('no-error');
  });

  it('an unsupported AVAILABILITY assertion is refused', () => {
    expect(
      build([
        ask('Do you work in city.beta?'),
        reply('Yes, we operate in city.beta as well.', 'ANSWER_DIRECT', []),
      ]),
    ).toBe('unsupported-business-fact');
  });

  it('a citation of the WRONG class does not satisfy a claim', () => {
    expect(
      build([
        ask('What would this cost?'),
        coreFact('c1', 'f.process', 'PROCESS', 'a consultant visits first'),
        reply('Our price starts around 6 lakh.', 'USE_CORE_TRUTH', ['f.process']),
      ]),
    ).toBe('unsupported-business-fact');
  });

  it('the CUSTOMER stating a quote or a budget needs no authority', () => {
    // Their own position, not a claim about the business. Treating it as one would make a
    // competitor's number into something Riya must have been told.
    expect(
      build([
        ask('I got a 7 lakh quote elsewhere and our budget is 10 lakh.'),
        reply('That is worth comparing properly. What was included in it?', 'ANSWER_DIRECT', []),
      ]),
    ).toBe('no-error');
  });

  it('the scanner is narrow, and never echoes what it read', () => {
    // Ambiguous language must not trip it, or authors turn it off.
    for (const text of [
      'That is worth comparing properly.',
      'Budgets in that range vary quite a lot.',
      'Your 7 lakh quote may not include the same scope.',
      'What budget range are you working with?',
      'I can share the details once a consultant has measured.',
    ]) {
      expect(detectVolatileClaimClasses(text), text).toStrictEqual([]);
    }
    expect(detectVolatileClaimClasses('Our price starts around 6 lakh.')).toStrictEqual(['PRICE']);

    // The finding is a closed class. The text stays where it was.
    let message = '';
    try {
      build([
        createRiyaDatasetUserTurn({ type: 'USER', turnRef: 'u1', text: 'Cost?' }),
        reply('Our price starts around 6 lakh.', 'ANSWER_DIRECT', []),
      ]);
      syntheticTrajectory({
        trajectoryId: 'echo.1',
        lineageRootRef: 'fam.echo',
        turns: [
          createRiyaDatasetUserTurn({ type: 'USER', turnRef: 'u1', text: 'Cost?' }),
          reply('Our price starts around 6 lakh.', 'ANSWER_DIRECT', []),
        ],
        review: acceptedReviews(1),
      });
    } catch (error: unknown) {
      message = error instanceof Error ? error.message : '';
    }
    expect(message).toBe(
      'An assistant turn asserts a business fact with no earlier authoritative support.',
    );
    expect(message).not.toContain('6 lakh');
  });
});
