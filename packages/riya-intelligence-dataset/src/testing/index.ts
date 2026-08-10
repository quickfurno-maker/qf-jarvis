/**
 * `@qf-jarvis/riya-intelligence-dataset/testing` — tiny synthetic fixtures (RID-F1, ADR-0107).
 *
 * A SEPARATE subpath, so fixture content can never be reached from a production import and can never
 * be mistaken for released training data. Everything here is invented: no QuickFurno package, price,
 * lead, customer or vendor, no contact detail, no production transcript, no key and no token.
 *
 * This is NOT the Gold corpus. RID-F1 builds the factory; HUMAN GOLD V1 authors the content.
 */
export {
  SYNTHETIC_DATASET_INSTANT,
  emptyTrainingState,
  partialTrainingState,
  acceptedReviews,
  discoveryTurns,
  supportedPriceTurns,
  syntheticTrajectory,
  releasePolicyFor,
  syntheticProtectedIndex,
  releasableOptions,
} from './fixtures.js';
export type { SyntheticTrajectoryOptions } from './fixtures.js';
