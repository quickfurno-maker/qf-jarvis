/**
 * `@qf-jarvis/riya-quality-evaluation/testing` — the synthetic golden corpus and its builders
 * (RWC-P10, ADR-0106 §20).
 *
 * A SEPARATE subpath so synthetic conversation text can never be reached from a production import,
 * and so nothing here can be mistaken for real data, a real approval or a real reviewer. Everything
 * exported below is invented: no QuickFurno package, price, lead, customer or vendor, no contact
 * detail, no production transcript, no key and no token.
 */
export {
  RIYA_QUALITY_GOLDEN_FIXTURES,
  RIYA_QUALITY_GOLDEN_SCENARIOS,
  RIYA_QUALITY_GOLDEN_FIXTURE_MANIFEST_ID,
  RIYA_QUALITY_GOLDEN_FIXTURE_MANIFEST_VERSION,
  RIYA_QUALITY_GOLDEN_SUITE_ID,
  RIYA_QUALITY_GOLDEN_SUITE_VERSION,
} from './golden-corpus.js';
export type {
  RiyaQualityGoldenFixture,
  RiyaQualityGoldenGroundedKnowledge,
  RiyaQualityGoldenKnowledgeRecord,
  RiyaQualityGoldenKnowledgeState,
  RiyaQualityGoldenPassingShape,
} from './golden-corpus.js';

export {
  SYNTHETIC_INSTANT,
  createSyntheticSafetyEvidence,
  createSyntheticQualityBinding,
  buildRiyaQualityGoldenSuite,
  twoReviews,
  passingObservationFor,
  passingGoldenObservations,
} from './builders.js';
export type { SyntheticSafetyEvidenceOptions } from './builders.js';
