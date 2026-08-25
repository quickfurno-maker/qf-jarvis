/**
 * The JAO-3 public surface (ADR-0117).
 *
 * Small, and non-authoritative by construction. Everything here remembers; nothing here permits.
 * There is no `authorize`, `approve`, `canExecute`, `execute`, `send`, `dispatch`,
 * `activateVendor` or `assignLead`; no `clearAll`, `deleteAll`, `reset`, `prune` or `delete`; and
 * no raw SQL, row type or query method. A spec asserts each of those names is absent from the
 * built barrel rather than trusting that nobody will add one.
 */
export {
  JAO3_BUDGET_LIMITS,
  JAO3_CORRECTION_TARGET_TYPES,
  JAO3_DEFAULT_BUDGET,
  JAO3_EPISTEMIC_STATUSES,
  JAO3_ERROR_CODES,
  JAO3_EVIDENCE_SOURCE_CLASSES,
  JAO3_INVESTIGATION_STATUSES,
  JAO3_OPERATIONS,
  JAO3_STATUS_ACCEPTS_WRITES,
  JAO3_WORKFLOW_STATES,
  Jao3MemoryError,
  jao3AppendCheckpointInputSchema,
  jao3AppendOwnerCorrectionInputSchema,
  jao3BudgetSchema,
  jao3CheckpointSchema,
  jao3CreateInvestigationInputSchema,
  jao3EvidenceRefSchema,
  jao3HypothesisSchema,
  jao3InstantSchema,
  jao3InvestigationIdSchema,
  jao3InvestigationSchema,
  jao3InvestigationViewSchema,
  jao3OwnerCorrectionSchema,
  jao3ResumeInvestigationInputSchema,
  jao3SupersedeInvestigationInputSchema,
  jao3TelemetryEventSchema,
  jao3TransitionInputSchema,
} from './contracts.js';
export type {
  Jao3AppendCheckpointInput,
  Jao3AppendOwnerCorrectionInput,
  Jao3Budget,
  Jao3Checkpoint,
  Jao3Clock,
  Jao3CorrectionTargetType,
  Jao3CreateInvestigationInput,
  Jao3EpistemicStatus,
  Jao3ErrorCode,
  Jao3EvidenceRef,
  Jao3EvidenceSourceClass,
  Jao3Hypothesis,
  Jao3Instant,
  Jao3Investigation,
  Jao3InvestigationStatus,
  Jao3InvestigationView,
  Jao3Operation,
  Jao3OwnerCorrection,
  Jao3ResumeInvestigationInput,
  Jao3SupersedeInvestigationInput,
  Jao3TelemetryEvent,
  Jao3TelemetryHook,
  Jao3TransitionInput,
  Jao3WorkflowState,
} from './contracts.js';

export {
  assertJao3CheckpointBudget,
  assertJao3CorrectionBudget,
  assertJao3EvidenceAndHypothesisBudget,
  assertJao3ExpectedRevision,
  assertJao3IdentityBinding,
  assertJao3ResumeBudget,
  assertJao3RootRunUnchanged,
  assertJao3SupersessionTarget,
  assertJao3Writable,
  jao3HasExpired,
  jao3InstantFromMs,
  jao3SemanticDigest,
  parseJao3InvestigationId,
} from './policy.js';

export type {
  Jao3CheckpointAppendResult,
  Jao3CorrectionAppendResult,
  Jao3InvestigationStore,
} from './store-port.js';

export { classifyJao3DatabaseError, createJao3PostgresStore } from './postgres-store.js';

export {
  JAO3_MEMORY_BOUNDS,
  JAO3_MEMORY_ERROR_CODES,
  createJao3MemoryOperations,
} from './operations.js';
export type { Jao3MemoryDependencies, Jao3MemoryOperations, Jao3ReadInput } from './operations.js';
