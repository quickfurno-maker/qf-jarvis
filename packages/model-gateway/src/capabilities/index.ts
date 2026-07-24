/**
 * The capability-registry composition surface (QFJ-P04.02, ADR-0050).
 *
 * Re-exports ONLY the stable composition + safe types. The internal match functions, the tuple-key
 * helper, and any mutable internal stay private. No provider instance, no secret is exported.
 */
export { MODEL_TASK_CLASSES, STRUCTURED_OUTPUT_MODES } from './task-classes.js';
export type { ModelTaskClass, StructuredOutputMode } from './task-classes.js';
export {
  createModelCapabilityProfile,
  type ModelCapabilityProfile,
  type ModelCapabilityProfileInput,
} from './capability-profile.js';
export {
  createModelCapabilityRequirement,
  deriveCapabilityRequirement,
  type ModelCapabilityRequirement,
  type ModelCapabilityRequirementInput,
  type RequiredStructuredMode,
} from './capability-requirement.js';
export {
  createModelCapabilityRegistry,
  type ModelCapabilityRegistry,
  type ModelCapabilityProfileSummary,
  type CapabilityResolution,
} from './capability-registry.js';
export {
  CAPABILITY_MATCH_REASONS,
  NOOP_CAPABILITY_OBSERVABILITY,
  type CapabilityMatchReason,
  type CapabilityEvent,
  type CapabilityObservabilityHook,
} from './capability-reasons.js';
