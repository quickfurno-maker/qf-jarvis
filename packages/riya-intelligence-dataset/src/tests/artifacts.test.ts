/**
 * RID-F1 — digests, manifest, JSONL, release evidence and SFT derivation
 * (ADR-0107 §26–§30).
 *
 * The two SHA specs that matter are opposites of each other. The ARTIFACT digest must change when a
 * reviewer is added, because the record genuinely changed. The conversation FINGERPRINT must not,
 * because duplicate detection has to see through relabelling — the same conversation filed under a
 * new id, persona and split is exactly what a cross-split leak looks like.
 */
import { describe, expect, it } from 'vitest';

import { canonicalJson } from '../internal/canonical-json.js';
import { SHA256_HEX } from '../internal/sha256.js';
import {
  trajectoryArtifactSha256,
  trajectoryConversationFingerprint,
} from '../internal/trajectory-digest.js';
import { RiyaDatasetError } from '../contracts/errors.js';
import { createRiyaDatasetCoveragePolicy } from '../contracts/coverage-policy.js';
import { createRiyaDatasetReleasePolicy } from '../contracts/release-policy.js';
import { riyaDatasetManifestIntegrityHolds } from '../contracts/manifest.js';
import { buildRiyaIntelligenceDatasetManifest } from '../service/create-manifest.js';
import { createRiyaDatasetReleaseEvidence } from '../service/create-release-evidence.js';
import { deriveRiyaSftSamples } from '../service/derive-sft-samples.js';
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
  supportedPriceTurns,
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

const manifestOf = (trajectories = [syntheticTrajectory()]) =>
  buildRiyaIntelligenceDatasetManifest({
    datasetId: 'riya-intelligence-v1',
    datasetVersion: 1,
    policyVersion: 1,
    createdAt: SYNTHETIC_DATASET_INSTANT,
    trajectories,
  });

// ---------------------------------------------------------------------------
// 1. Canonical JSON and SHA-256.
// ---------------------------------------------------------------------------

describe('digests are cryptographic, deterministic and order-free', () => {
  it('canonical JSON is key-order independent and drops absent optionals', () => {
    expect(canonicalJson({ b: 1, a: 2 })).toBe(canonicalJson({ a: 2, b: 1 }));
    expect(canonicalJson({ a: 1, b: undefined })).toBe(canonicalJson({ a: 1 }));
    // Arrays keep their order: a conversation is a sequence.
    expect(canonicalJson([1, 2])).not.toBe(canonicalJson([2, 1]));
  });

  it('a trajectory SHA is 64 lowercase hex and is deterministic', () => {
    const digest = trajectoryArtifactSha256(syntheticTrajectory());
    expect(digest).toMatch(SHA256_HEX);
    expect(trajectoryArtifactSha256(syntheticTrajectory())).toBe(digest);
  });

  it('one changed character changes the SHA', () => {
    const before = trajectoryArtifactSha256(syntheticTrajectory());
    const after = trajectoryArtifactSha256(
      syntheticTrajectory({
        turns: discoveryTurns({
          replyText: 'Congratulations on the new place. What budget range are you working with!',
        }),
      }),
    );
    expect(after).not.toBe(before);
  });

  it('adding a reviewer changes the ARTIFACT digest but NOT the conversation fingerprint', () => {
    // Opposite requirements, and both are load-bearing. The artifact genuinely changed; the
    // conversation did not, and duplicate detection has to see through the relabelling.
    const one = syntheticTrajectory({ review: acceptedReviews(1) });
    const two = syntheticTrajectory({ review: acceptedReviews(2) });
    expect(trajectoryArtifactSha256(two)).not.toBe(trajectoryArtifactSha256(one));
    expect(trajectoryConversationFingerprint(two)).toBe(trajectoryConversationFingerprint(one));
  });

  it('the fingerprint ignores id, split, persona and source, and tracks the words', () => {
    const base = syntheticTrajectory();
    const relabelled = syntheticTrajectory({
      trajectoryId: 'totally.different.id',
      lineageRootRef: 'totally.different.family',
      split: 'HOLDOUT',
    });
    expect(trajectoryConversationFingerprint(relabelled)).toBe(
      trajectoryConversationFingerprint(base),
    );

    const different = syntheticTrajectory({
      turns: discoveryTurns({ userText: 'A different opening entirely, about painting.' }),
    });
    expect(trajectoryConversationFingerprint(different)).not.toBe(
      trajectoryConversationFingerprint(base),
    );
  });

  it('the language mode is part of the fingerprint', () => {
    // The same words declared in a different mode are a different training example.
    expect(
      trajectoryConversationFingerprint(syntheticTrajectory({ languageMode: 'HINGLISH' })),
    ).not.toBe(trajectoryConversationFingerprint(syntheticTrajectory()));
  });
});

// ---------------------------------------------------------------------------
// 2. Manifest.
// ---------------------------------------------------------------------------

describe('the manifest is a sealed, content-free index', () => {
  it('sorts records and counts splits, whatever order it was handed', () => {
    const a = syntheticTrajectory({ trajectoryId: 'a.1', lineageRootRef: 'fam.a' });
    const b = syntheticTrajectory({
      trajectoryId: 'b.1',
      lineageRootRef: 'fam.b',
      split: 'VALIDATION',
      turns: discoveryTurns({ userText: 'Wardrobes for a rented place in city.beta please.' }),
    });
    const forward = manifestOf([a, b]);
    const reversed = manifestOf([b, a]);

    expect(forward.records.map((one) => one.trajectoryId)).toStrictEqual(['a.1', 'b.1']);
    expect(forward.counts).toStrictEqual({ TRAIN: 1, VALIDATION: 1, HOLDOUT: 0 });
    // Input order cannot change the identity of a dataset.
    expect(reversed.manifestSha256).toBe(forward.manifestSha256);
    expect(reversed).toStrictEqual(forward);
  });

  it('every record carries two 64-hex digests and no text', () => {
    const manifest = manifestOf();
    for (const record of manifest.records) {
      expect(record.sha256).toMatch(SHA256_HEX);
      expect(record.normalizedFingerprint).toMatch(SHA256_HEX);
      expect(Object.keys(record).sort()).toStrictEqual([
        'lineageRootRef',
        'normalizedFingerprint',
        'riskClass',
        'sha256',
        'sourceKind',
        'split',
        'trajectoryId',
        'trajectoryRevision',
      ]);
    }
    const serialized = JSON.stringify(manifest);
    expect(serialized).not.toContain('modular kitchen');
    expect(serialized).not.toContain('reviewer.alpha');
    expect(serialized).not.toContain('Congratulations');
  });

  it('detects a tampered record', () => {
    const manifest = manifestOf();
    expect(riyaDatasetManifestIntegrityHolds(manifest)).toBe(true);
    for (const tampered of [
      { ...manifest, datasetVersion: 99 },
      { ...manifest, counts: { TRAIN: 99, VALIDATION: 0, HOLDOUT: 0 } },
      {
        ...manifest,
        records: manifest.records.map((one) => ({ ...one, split: 'HOLDOUT' as const })),
      },
      { ...manifest, manifestSha256: 'a'.repeat(64) },
    ]) {
      expect(riyaDatasetManifestIntegrityHolds(tampered)).toBe(false);
    }
  });

  it('refuses a duplicate trajectory id', () => {
    expect(codeOf(() => manifestOf([syntheticTrajectory(), syntheticTrajectory()]))).toBe(
      'duplicate-trajectory',
    );
  });
});

// ---------------------------------------------------------------------------
// 3. Release report and evidence.
// ---------------------------------------------------------------------------

describe('release evidence records that gates passed, and authorizes nothing', () => {
  const eligible = () => {
    const trajectories = [syntheticTrajectory()];
    return {
      report: validateRiyaIntelligenceDataset(trajectories, releasableOptions()),
      manifest: manifestOf(trajectories),
    };
  };

  it('an eligible corpus produces deterministic, synthetic, non-approving evidence', () => {
    const { report, manifest } = eligible();
    expect(report.eligible).toBe(true);

    const first = createRiyaDatasetReleaseEvidence({
      report,
      manifest,
    });
    expect(first.ok).toBe(true);
    if (!first.ok) {
      throw new Error('expected evidence');
    }
    expect(first.evidence.syntheticOnly).toBe(true);
    // The mandatory one. Clearing dataset gates never starts a run.
    expect(first.evidence.trainingApproval).toBe(false);
    expect(first.evidence.manifestSha256).toBe(manifest.manifestSha256);
    expect(Object.isFrozen(first.evidence)).toBe(true);

    const second = eligible();
    const repeat = createRiyaDatasetReleaseEvidence({
      report: second.report,
      manifest: second.manifest,
    });
    if (!repeat.ok) {
      throw new Error('expected evidence');
    }
    expect(repeat.evidence.datasetRef).toBe(first.evidence.datasetRef);
  });

  it('an INELIGIBLE report produces no evidence', () => {
    const trajectories = [syntheticTrajectory({ review: [] })];
    const attempt = createRiyaDatasetReleaseEvidence({
      report: validateRiyaIntelligenceDataset(trajectories, releasableOptions()),
      manifest: manifestOf(trajectories),
    });
    expect(attempt).toStrictEqual({ ok: false, code: 'dataset-not-eligible' });
  });

  it('a TAMPERED manifest is refused before eligibility is considered', () => {
    const { report, manifest } = eligible();
    const attempt = createRiyaDatasetReleaseEvidence({
      report,
      manifest: { ...manifest, datasetVersion: 99 },
    });
    expect(attempt).toStrictEqual({ ok: false, code: 'manifest-digest-invalid' });
  });

  it('a report paired with a manifest of a different size is refused', () => {
    const { report } = eligible();
    const bigger = manifestOf([
      syntheticTrajectory(),
      syntheticTrajectory({
        trajectoryId: 'b.1',
        lineageRootRef: 'fam.b',
        turns: discoveryTurns({ userText: 'Wardrobes for a rented place in city.beta please.' }),
      }),
    ]);
    expect(createRiyaDatasetReleaseEvidence({ report, manifest: bigger })).toStrictEqual({
      ok: false,
      code: 'release-binding-invalid',
    });
  });

  it('the report is counts and locations only', () => {
    const report = validateRiyaIntelligenceDataset([syntheticTrajectory()], releasableOptions());
    expect(report.totalTrajectories).toBe(1);
    expect(report.totalAssistantTurns).toBe(1);
    expect(report.countsByLanguage).toStrictEqual({ ENGLISH: 1 });
    expect(report.countsBySourceKind).toStrictEqual({ HUMAN_AUTHORED_SYNTHETIC: 1 });
    const serialized = JSON.stringify(report);
    expect(serialized).not.toContain('Congratulations');
    expect(serialized).not.toContain('modular kitchen');
  });
});

// ---------------------------------------------------------------------------
// 4. Coverage policy.
// ---------------------------------------------------------------------------

describe('coverage minima are policy data, never hard-coded', () => {
  it('reports a shortfall against the BOUND coverage policy', () => {
    const protectedIndex = syntheticProtectedIndex();
    const releasePolicy = createRiyaDatasetReleasePolicy({
      policyId: 'riya-gold-v1',
      policyVersion: 1,
      coveragePolicy: createRiyaDatasetCoveragePolicy({
        policyId: 'riya-gold-coverage-v1',
        policyVersion: 1,
        minimumTotalTrajectories: 3,
        minimumByLanguage: { ENGLISH: 1, HINDI: 1, HINGLISH: 1 },
      }),
      protectedCorpusRef: 'protected.corpus.synthetic',
      protectedIndexSha256: protectedIndex.indexSha256,
      protectedEntryCount: protectedIndex.entryCount,
    });
    const report = validateRiyaIntelligenceDataset([syntheticTrajectory()], {
      protectedIndex,
      releasePolicy,
    });
    expect(report.coverageShortfalls.map((one) => one.key).sort()).toStrictEqual([
      'HINDI',
      'HINGLISH',
      'TOTAL',
    ]);
    expect(report.eligible).toBe(false);
  });

  it('an absent minimum is deliberately ungated', () => {
    const report = validateRiyaIntelligenceDataset([syntheticTrajectory()], releasableOptions());
    expect(report.coverageShortfalls).toStrictEqual([]);
    expect(report.eligible).toBe(true);
  });

  it('the report names the coverage policy by id, version AND digest', () => {
    // A policy edited in place without a version bump must stop attesting old releases.
    const report = validateRiyaIntelligenceDataset([syntheticTrajectory()], releasableOptions());
    expect(report.coveragePolicyId).toBe('riya-dataset-coverage-v1');
    expect(report.coveragePolicyVersion).toBe(1);
    expect(report.coveragePolicySha256).toMatch(SHA256_HEX);

    const stricter = releasePolicyFor(syntheticProtectedIndex(), { minimumTotalTrajectories: 1 });
    const other = validateRiyaIntelligenceDataset([syntheticTrajectory()], {
      protectedIndex: syntheticProtectedIndex(),
      releasePolicy: stricter,
    });
    expect(other.coveragePolicySha256).not.toBe(report.coveragePolicySha256);
  });

  it('refuses an unknown key rather than ignoring it', () => {
    // A typo here is a minimum somebody believes is enforced and is not.
    expect(
      codeOf(() =>
        createRiyaDatasetCoveragePolicy({
          policyId: 'p',
          policyVersion: 1,
          minimumByLanguage: { MARATHI: 3 } as never,
        }),
      ),
    ).toBe('invalid-manifest');
  });
});

// ---------------------------------------------------------------------------
// 5. JSONL.
// ---------------------------------------------------------------------------

describe('JSONL is one canonical line per trajectory', () => {
  it('round-trips exactly, and is deterministic', () => {
    const trajectory = syntheticTrajectory();
    const line = serializeRiyaTrajectoryJsonlLine(trajectory);
    expect(line).not.toContain('\n');
    expect(serializeRiyaTrajectoryJsonlLine(trajectory)).toBe(line);
    expect(parseRiyaTrajectoryJsonlLine(line)).toStrictEqual(trajectory);
    // And the round-trip preserves identity, which is what a manifest depends on.
    expect(trajectoryArtifactSha256(parseRiyaTrajectoryJsonlLine(line))).toBe(
      trajectoryArtifactSha256(trajectory),
    );
  });

  it('escapes an embedded newline rather than breaking the line', () => {
    const trajectory = syntheticTrajectory({
      turns: discoveryTurns({ userText: 'Line one.\nLine two about the kitchen.' }),
    });
    const line = serializeRiyaTrajectoryJsonlLine(trajectory);
    expect(line.split('\n')).toHaveLength(1);
    expect(line).toContain('\\n');
    expect(parseRiyaTrajectoryJsonlLine(line).turns[0]).toStrictEqual(trajectory.turns[0]);
  });

  it('re-proves on parse rather than trusting the file', () => {
    // JSONL is where data arrives from elsewhere, so it is exactly the boundary an unvalidated record
    // would enter through.
    const raw = JSON.parse(serializeRiyaTrajectoryJsonlLine(syntheticTrajectory())) as Record<
      string,
      unknown
    >;
    expect(codeOf(() => parseRiyaTrajectoryJsonlLine(JSON.stringify({ ...raw, extra: 1 })))).toBe(
      'invalid-trajectory',
    );
    expect(
      codeOf(() =>
        parseRiyaTrajectoryJsonlLine(
          JSON.stringify({
            ...raw,
            turns: [
              { type: 'ASSISTANT', turnRef: 'x', text: 'hi', annotation: { decision: 'NOPE' } },
            ],
          }),
        ),
      ),
      // `invalid-turn`, not `invalid-trajectory`: the nested value now reaches the constructor
      // that OWNS it, so the code says which layer refused (owner correction on PR #112).
    ).toBe('invalid-turn');
  });

  it('refuses an empty line, malformed JSON, an array and a second object', () => {
    const line = serializeRiyaTrajectoryJsonlLine(syntheticTrajectory());
    for (const bad of ['', '   ', '{not json', '[]', `${line}${line}`]) {
      expect(
        codeOf(() => parseRiyaTrajectoryJsonlLine(bad)),
        JSON.stringify(bad.slice(0, 20)),
      ).toBe('invalid-jsonl');
    }
  });
});

// ---------------------------------------------------------------------------
// 6. SFT derivation.
// ---------------------------------------------------------------------------

describe('SFT samples are derived, prefix-bounded and model-neutral', () => {
  const threeTurnTrajectory = () =>
    syntheticTrajectory({
      trajectoryId: 'riya.gold.en.price.010',
      lineageRootRef: 'riya.family.price.010',
      primaryInteractionKind: 'OBJECTION_PRICE',
      riskClass: 'HIGH_RISK',
      turns: supportedPriceTurns(),
      review: acceptedReviews(2, { objection: true }),
    });

  it('produces exactly one sample per assistant turn', () => {
    expect(deriveRiyaSftSamples(syntheticTrajectory())).toHaveLength(1);
    expect(deriveRiyaSftSamples(threeTurnTrajectory())).toHaveLength(1);

    const twoAssistant = syntheticTrajectory({
      trajectoryId: 'multi.1',
      lineageRootRef: 'fam.multi',
      turns: [
        ...discoveryTurns(),
        {
          ...discoveryTurns()[0],
          turnRef: 't3',
          text: 'Around 8 lakh, before the festive season.',
        } as never,
        { ...discoveryTurns()[1], turnRef: 't4' } as never,
      ],
    });
    expect(deriveRiyaSftSamples(twoAssistant)).toHaveLength(2);
  });

  it('ids are deterministic and derived from the source', () => {
    const first = deriveRiyaSftSamples(threeTurnTrajectory());
    const second = deriveRiyaSftSamples(threeTurnTrajectory());
    expect(first.map((one) => one.sampleId)).toStrictEqual(['riya.gold.en.price.010#a01']);
    expect(second).toStrictEqual(first);
  });

  it('the prefix contains only turns BEFORE the target, and never a future one', () => {
    // The single easiest thing to get wrong in a dataset pipeline, and it improves the validation
    // score while making the product worse.
    const sample = deriveRiyaSftSamples(threeTurnTrajectory())[0];
    expect(sample?.conversationPrefix).toStrictEqual([
      {
        role: 'USER',
        text: 'I got a 7 lakh quote from another company. What would this cost with you?',
      },
    ]);
    expect(JSON.stringify(sample?.conversationPrefix)).not.toContain(
      sample?.target.replyText ?? 'x',
    );
  });

  it('the authoritative context contains only facts supplied BEFORE the target', () => {
    const sample = deriveRiyaSftSamples(threeTurnTrajectory())[0];
    expect(sample?.authoritativeContext.map((one) => one.factRef)).toStrictEqual([
      'fact.price.alpha',
    ]);
    expect(sample?.authoritativeContext[0]?.authority).toBe('CORE_RUNTIME_SYNTHETIC');
  });

  it('the target carries the exact annotation, and nothing about review', () => {
    const sample = deriveRiyaSftSamples(threeTurnTrajectory())[0];
    expect(sample?.target.decision).toBe('USE_CORE_TRUTH');
    expect(sample?.target.responseObjective).toBe('ADDRESS_OBJECTION');
    expect(Object.keys(sample?.target ?? {}).sort()).toStrictEqual([
      'askedDiscoveryFields',
      'decision',
      'replyText',
      'responseObjective',
    ]);
    const serialized = JSON.stringify(sample);
    for (const forbidden of [
      'reviewRef',
      'reviewer.alpha',
      'ACCEPTED',
      'satisfiedQualityDimensions',
      'manifestSha256',
    ]) {
      expect(serialized, forbidden).not.toContain(forbidden);
    }
  });

  it('carries NO model-specific formatting', () => {
    // Those belong to a specific model and would bake the base-model choice into the data before the
    // benchmark that is supposed to make it.
    const serialized = JSON.stringify(deriveRiyaSftSamples(threeTurnTrajectory()));
    for (const forbidden of [
      '<|im_start|>',
      '<|im_end|>',
      '[INST]',
      '<s>',
      'systemPrompt',
      'chatml',
      'tokenizer',
      'qwen',
      'llama',
    ]) {
      expect(serialized.toLowerCase(), forbidden).not.toContain(forbidden.toLowerCase());
    }
    const sample = deriveRiyaSftSamples(threeTurnTrajectory())[0];
    expect(Object.keys(sample ?? {}).sort()).toStrictEqual([
      'authoritativeContext',
      'conversationPrefix',
      'languageMode',
      'lineageRootRef',
      'sampleId',
      'sourceTrajectoryId',
      'sourceTrajectoryRevision',
      'split',
      'stateBefore',
      'target',
      'version',
    ]);
  });
});
