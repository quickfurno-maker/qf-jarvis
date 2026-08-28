/**
 * `@qf-jarvis/control-plane-read-contract` — the governed read-only control-plane snapshot
 * contract (JOS-01B, ADR-0086).
 *
 * ### Six runtime symbols, and that is the whole surface
 *
 * Two version constants, an error-code list, one error class and two parse functions. The schemas
 * themselves are intentionally NOT exported at the root: if callers could compose sub-schemas they
 * would build their own half-validated shapes, and the single-entry guarantee — everything that
 * reaches a surface went through one of the parse functions — would quietly stop being true.
 *
 * It was four until AVG-11 added V2 (ADR-0129). The count is asserted by a spec precisely so that
 * growing it is a decision somebody made rather than something that happened, and the two symbols
 * that joined are a version literal and its parser — neither of which can act.
 *
 * ### Two versions, two parsers, and no dispatcher
 *
 * V1 (ADR-0086) is unchanged and still the contract `GET /api/control-plane/v1/snapshot` serves.
 * V2 (ADR-0129) adds the Aarohi acquisition funnel's closed stage vocabulary, the metric AUTHORITY
 * distinction and the readiness section — two breaking shape changes, which is exactly why they are
 * behind a version rather than edited into V1.
 *
 * There is deliberately no `parseControlPlaneSnapshot(version)`: one entry point taking a version is
 * one `??` away from validating a payload against the wrong contract and calling it valid.
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
export { CONTROL_PLANE_READ_CONTRACT_V2_VERSION } from './contract/snapshot-v2.js';
export {
  CONTROL_PLANE_READ_CONTRACT_ERROR_CODES,
  ControlPlaneReadContractError,
} from './errors.js';
export { parseControlPlaneSnapshotV1, parseControlPlaneSnapshotV2 } from './parse.js';

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

export type {
  AarohiReadinessKind,
  AarohiReadinessRow,
  ControlPlaneSectionsV2,
  ControlPlaneSnapshotV2,
  FunnelStageId,
  FunnelStageV2,
  MetricAuthority,
  ResolvedMetricAuthority,
} from './contract/snapshot-v2.js';

export type { ControlPlaneReadContractErrorCode, ControlPlaneReadContractIssue } from './errors.js';
