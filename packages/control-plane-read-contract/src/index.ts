/**
 * `@qf-jarvis/control-plane-read-contract` — the governed read-only control-plane snapshot
 * contract (JOS-01B, ADR-0086).
 *
 * ### Four runtime symbols, and that is the whole surface
 *
 * A version constant, an error-code list, one error class and one parse function. The schemas
 * themselves are intentionally NOT exported at the root: if callers could compose sub-schemas they
 * would build their own half-validated shapes, and the single-entry guarantee — everything that
 * reaches a surface went through `parseControlPlaneSnapshotV1` — would quietly stop being true.
 *
 * Types are exported freely. A type cannot be used to bypass a check.
 *
 * ### Framework-neutral on purpose
 *
 * zod is the only dependency. There is no Next, no React, no Node API, no filesystem, no network,
 * no clock, no database, no provider, no Core or n8n client and no `process.env`. That is what lets
 * a future React Native / Expo Android client compile this package unchanged and inherit the same
 * contract, rather than growing a second, drifting definition of what the operator surface means.
 *
 * ### It carries no authority
 *
 * Jarvis recommends and observes. QuickFurno Core authorizes and owns business truth. n8n executes
 * approved intents. Providers deliver. Nothing in this contract can say otherwise: there is no
 * `canSend`, `canExecute`, `isAuthorized`, `consentValid`, `approvalGranted` or `dispatchAllowed`,
 * every object is strict, `rollout.enabled` is the literal `false`, and there are no methods.
 */
export { CONTROL_PLANE_READ_CONTRACT_VERSION } from './contract/primitives.js';
export {
  CONTROL_PLANE_READ_CONTRACT_ERROR_CODES,
  ControlPlaneReadContractError,
} from './errors.js';
export { parseControlPlaneSnapshotV1 } from './parse.js';

export type {
  AgentId,
  CanonicalInstant,
  CapabilityLifecycle,
  HealthState,
  SectionAvailability,
} from './contract/primitives.js';

export type {
  ActivityEntry,
  ApprovalRow,
  AttentionItem,
  AuthorityBoundary,
  ControlPlaneSections,
  ControlPlaneSnapshotV1,
  ConversationControlRow,
  DistributionSlice,
  EvaluationDimension,
  FunnelStage,
  KnowledgeNamespace,
  ModelProfile,
  OwnershipRow,
  RoadmapMarker,
  RolloutPosture,
  SeriesPoint,
  SeriesSection,
  SnapshotAgent,
  SnapshotCapability,
  SnapshotMetric,
  SnapshotSource,
  SystemComponent,
  WorkerNode,
} from './contract/snapshot.js';

export type { ControlPlaneReadContractErrorCode, ControlPlaneReadContractIssue } from './errors.js';
