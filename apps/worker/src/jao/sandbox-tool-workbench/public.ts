/**
 * The JAO-4 public surface (ADR-0118).
 *
 * Small, read-only, and non-authoritative. There is no `exec`, `run`, `spawn`, `shell`, `command`,
 * `fetch`, `navigate`, `write`, `install`, `authorize` or `approve` on it; no raw host path type;
 * and no way to register a tool at runtime. A spec asserts each of those names is absent from the
 * built barrel rather than trusting that nobody will add one.
 */
export {
  JAO4_AUTONOMY_LEVELS,
  JAO4_AUTONOMY_RANK,
  JAO4_CONTENT_CLASSES,
  JAO4_LIMITS,
  JAO4_OUTCOMES,
  JAO4_REFUSAL_REASONS,
  JAO4_TOOL_AVAILABILITY,
  JAO4_TOOL_IDS,
  Jao4WorkbenchError,
  jao4ArtifactBundleSchema,
  jao4ArtifactSchema,
  jao4CallSchema,
  jao4DigestEvidenceSchema,
  jao4EvidenceSchema,
  jao4HashCallSchema,
  jao4ListCallSchema,
  jao4ListEvidenceSchema,
  jao4ReadCallSchema,
  jao4ReadEvidenceSchema,
  jao4SearchCallSchema,
  jao4SearchEvidenceSchema,
  jao4TelemetryEventSchema,
  jao4ToolCallResultSchema,
  jao4ToolDescriptorSchema,
  jao4WorkbenchRequestSchema,
  jao4WorkbenchResultSchema,
  parseJao4PathPrefix,
  parseJao4VirtualPath,
} from './contracts.js';
export type {
  Jao4Artifact,
  Jao4ArtifactBundle,
  Jao4AutonomyLevel,
  Jao4Call,
  Jao4Clock,
  Jao4ContentClass,
  Jao4Evidence,
  Jao4HashCall,
  Jao4ListCall,
  Jao4Outcome,
  Jao4ReadCall,
  Jao4RefusalReason,
  Jao4SearchCall,
  Jao4TelemetryEvent,
  Jao4TelemetryHook,
  Jao4ToolAvailability,
  Jao4ToolCallResult,
  Jao4ToolDescriptor,
  Jao4ToolId,
  Jao4WorkbenchRequest,
  Jao4WorkbenchResult,
} from './contracts.js';

export { createJao4ArtifactSandbox } from './artifact-sandbox.js';
export type { Jao4ArtifactSandbox, Jao4SandboxEntry } from './artifact-sandbox.js';

export {
  JAO4_BINDING_FIELD_NAMES,
  assertJao4AuthorityCeiling,
  assertJao4CallBudget,
  assertJao4NotCancelled,
  assertJao4OutputBudget,
  assertJao4RunBinding,
  assertJao4ToolBinding,
  assertJao4ToolCallBudget,
} from './policy.js';

export {
  JAO4_EXPECTED_TOOL_IDS,
  JAO4_HASH_TOOL,
  JAO4_LIST_TOOL,
  JAO4_PRODUCTION_TOOLS,
  JAO4_READ_TOOL,
  JAO4_SEARCH_TOOL,
  assertJao4KnownTool,
  createJao4ToolRegistry,
  jao4RegisteredToolIds,
} from './tool-registry.js';
export type { Jao4RegistryLookup, Jao4ToolRegistry } from './tool-registry.js';

export { createJao4Tools, jao4OutputChars } from './tools.js';
export type { Jao4Tool, Jao4ToolOutput } from './tools.js';

export { JAO4_WORKBENCH_BOUNDS, runJao4Workbench } from './workbench.js';
export type { Jao4WorkbenchDependencies } from './workbench.js';
