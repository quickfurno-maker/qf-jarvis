/**
 * The Gold V1 coverage and release policies (HGV1-A, ADR-0108).
 *
 * ### The coverage numbers live here, not in the generic validator
 *
 * RID-F1's coverage contract deliberately hard-codes no target, and this is the slice that supplies
 * one. `360`, `120` per language and `30` per interaction are Gold V1's bar; a future targeted corpus
 * will have a different one and will not have to argue with this file.
 *
 * ### Floors, not quotas
 *
 * Persona, difficulty and risk minima are diversity FLOORS. Forcing equal persona counts would mean
 * writing a `PREMIUM` customer asking a completed-intake process question purely to balance a table,
 * and an unnatural scenario is worse than an uneven one — it teaches a customer who does not exist.
 * The sums deliberately do not add to 360.
 *
 * ### The protected corpus is PINNED by the caller
 *
 * `buildRiyaGoldV1ReleasePolicy` takes a `ProtectedTextIndex` and reads its count and digest. This
 * file contains no P10 identifier, no fixture text and no hard-coded `72`: the real corpus is loaded
 * from `@qf-jarvis/riya-quality-evaluation/testing` at authoring and verification time, and its
 * identity is derived rather than transcribed. Writing the real digest in here would freeze a value
 * nobody could re-derive, and writing the fixture ids would put the exam in the shipped bundle.
 */
import { createRiyaDatasetCoveragePolicy } from '../../contracts/coverage-policy.js';
import type { RiyaDatasetCoveragePolicyV1 } from '../../contracts/coverage-policy.js';
import { createRiyaDatasetReleasePolicy } from '../../contracts/release-policy.js';
import type { RiyaDatasetReleasePolicyV1 } from '../../contracts/release-policy.js';
import type { ProtectedTextIndex } from '../../internal/leakage.js';

/** Gold V1's coverage bar. Authored as data, exactly as ADR-0107 said it would be. */
export const RIYA_GOLD_V1_COVERAGE_POLICY: RiyaDatasetCoveragePolicyV1 =
  createRiyaDatasetCoveragePolicy({
    policyId: 'riya-gold-v1-coverage',
    policyVersion: 1,
    minimumTotalTrajectories: 360,
    minimumByLanguage: { ENGLISH: 120, HINDI: 120, HINGLISH: 120 },
    minimumByPrimaryInteraction: {
      DISCOVERY: 30,
      CORRECTION: 30,
      OBJECTION_PRICE: 30,
      OBJECTION_TRUST: 30,
      OBJECTION_TIMELINE: 30,
      COMPARISON: 30,
      GROUNDING_QA: 30,
      OUT_OF_SCOPE: 30,
      HUMAN_REQUEST: 30,
      POST_SUMMARY_QA: 30,
      COMPLETE_QA: 30,
      NEXT_STEP: 30,
    },
    // Diversity floors. Deliberately not quotas, and deliberately not summing to 360.
    minimumByPersona: {
      DECISIVE: 30,
      EXPLORING: 30,
      PRICE_SENSITIVE: 30,
      PREMIUM: 30,
      SKEPTICAL: 30,
      BUSY_SHORT_REPLY: 30,
      CONFUSED: 30,
      FRUSTRATED: 30,
    },
    minimumByDifficulty: { BASIC: 50, STANDARD: 150, HARD: 100, EDGE: 30 },
    minimumByRiskClass: { STANDARD: 180, HIGH_RISK: 90 },
  });

/** An opaque name for the exam corpus. Never its content, and never a fixture identifier. */
export const RIYA_GOLD_V1_PROTECTED_CORPUS_REF = 'protected.riya-quality-golden-v1';

/**
 * Build the Gold V1 release policy, pinned to the protected corpus the caller supplies.
 *
 * The caller loads the real P10 testing corpus and builds the index; this reads its `entryCount` and
 * `indexSha256`. Validation then refuses to bind if the index it is later handed differs — which is
 * what turns "the exam firewall ran, against the whole exam" into a checkable property rather than a
 * claim about how somebody invoked it.
 */
export function buildRiyaGoldV1ReleasePolicy(
  protectedIndex: ProtectedTextIndex,
): RiyaDatasetReleasePolicyV1 {
  return createRiyaDatasetReleasePolicy({
    policyId: 'riya-gold-v1-release',
    policyVersion: 1,
    coveragePolicy: RIYA_GOLD_V1_COVERAGE_POLICY,
    protectedCorpusRef: RIYA_GOLD_V1_PROTECTED_CORPUS_REF,
    protectedIndexSha256: protectedIndex.indexSha256,
    protectedEntryCount: protectedIndex.entryCount,
  });
}
