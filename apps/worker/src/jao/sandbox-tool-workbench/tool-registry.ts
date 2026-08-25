/**
 * The JAO-4 static tool registry (ADR-0118).
 *
 * ### Static, and staying static
 *
 * Four tools, written down. There is no dynamic registration, no discovery, no plugin loader, no
 * install, no nearest match, no fallback and no model-selected substitute: a call either names a
 * tool that is registered at the exact version, governed for this class and available -- or it is
 * refused before anything runs. Registry lookup never consults artifact content or model output.
 *
 * The registry stays inside the worker JAO composition rather than becoming a shared
 * capability-broker package. One consumer does not justify an abstraction, and a broker contract
 * invented before its second caller would harden guesses into an interface other slices then
 * depend on.
 *
 * ### ACTIVE is scoped, and the scope matters
 *
 * `ACTIVE` means available to THIS offline shadow workbench. It says nothing about production
 * rollout, and the descriptor carries no channel, rollout, transport or enablement field for that
 * reason. A reader who mistakes this table for rollout truth would be reading a shadow proof as a
 * launch.
 *
 * Pure: no clock, no network, no filesystem, no environment, no storage, no process.
 */
import {
  JAO4_TOOL_IDS,
  Jao4WorkbenchError,
  jao4ToolDescriptorSchema,
  type Jao4ToolDescriptor,
  type Jao4ToolId,
} from './contracts.js';

/**
 * The capability posture every first-proof tool shares.
 *
 * Parsed rather than asserted at module load, so every literal in the descriptor schema is enforced
 * before the registry exists: a tool claiming network, secrets, host filesystem, process execution,
 * shell, environment, database or production-mutation capability cannot be constructed even
 * momentarily.
 */
function denyAll(
  toolId: Jao4ToolId,
  governanceRef: string,
  availability: 'ACTIVE' | 'PLANNED' | 'DISABLED' = 'ACTIVE',
): Jao4ToolDescriptor {
  return Object.freeze(
    jao4ToolDescriptorSchema.parse({
      toolId,
      toolVersion: '1',
      toolClass: 'VIRTUAL_ARTIFACT_READ_ONLY',
      governanceRef,
      availability,
      maxAutonomyLevel: 'L1_READ',
      dataClass: 'SYNTHETIC_OR_SANITIZED_OPERATIONAL_ARTIFACTS',
      maxCallsPerRun: 4,

      readOnly: true,
      businessEffect: false,
      productionMutation: false,

      mayNetwork: false,
      mayAccessSecrets: false,
      mayAccessHostFilesystem: false,
      mayWriteVirtualFilesystem: false,
      mayExecuteProcess: false,
      mayUseShell: false,
      mayAccessEnvironment: false,
      mayAccessDatabase: false,

      networkPolicy: 'DENY',
      secretPolicy: 'DENY_SOURCE_ACCESS',
      hostFilesystem: 'DENY',
      virtualFilesystem: 'READ_ONLY',
      processExecution: 'DENY',
      shell: 'DENY',
      environment: 'DENY',
      database: 'DENY',

      rollbackPosture: 'NOT_REQUIRED_READ_ONLY',
      approvalPosture: 'OFFLINE_SHADOW_ONLY',
    }),
  );
}

export const JAO4_LIST_TOOL = denyAll('artifact.list.v1', 'ADR-0118.jao4-virtual-artifact-sandbox');
export const JAO4_READ_TOOL = denyAll('artifact.read.v1', 'ADR-0118.jao4-virtual-artifact-sandbox');
export const JAO4_SEARCH_TOOL = denyAll(
  'artifact.search-literal.v1',
  'ADR-0118.jao4-virtual-artifact-sandbox',
);
export const JAO4_HASH_TOOL = denyAll(
  'artifact.sha256.v1',
  'ADR-0118.jao4-virtual-artifact-sandbox',
);

/**
 * The tools JAO-4 ships. Exactly four, all ACTIVE, all read-only.
 *
 * PLANNED and DISABLED descriptors are deliberately absent from production. Their refusal is proved
 * with test fixtures rather than by shipping placeholder tools nobody governs -- so the production
 * table stays honest, at the cost of those two paths being exercised through injected descriptors.
 */
export const JAO4_PRODUCTION_TOOLS: readonly Jao4ToolDescriptor[] = Object.freeze([
  JAO4_LIST_TOOL,
  JAO4_READ_TOOL,
  JAO4_SEARCH_TOOL,
  JAO4_HASH_TOOL,
]);

export type Jao4RegistryLookup =
  | { readonly ok: true; readonly descriptor: Jao4ToolDescriptor }
  | {
      readonly ok: false;
      readonly refusal: 'TOOL_UNKNOWN' | 'TOOL_VERSION_MISMATCH' | 'TOOL_PLANNED' | 'TOOL_DISABLED';
    };

export interface Jao4ToolRegistry {
  readonly descriptors: readonly Jao4ToolDescriptor[];
  lookup(toolId: string, toolVersion: string): Jao4RegistryLookup;
}

/**
 * Build the registry over an explicit descriptor list.
 *
 * The list is a parameter so a spec can register a PLANNED or DISABLED tool and prove it is refused.
 * Production callers pass nothing and get the four ACTIVE tools.
 *
 * Availability is decided BEFORE anything is invoked, and the four unavailable outcomes stay
 * distinct: "there is no such tool", "not at that version", "it is planned" and "it is switched
 * off" are different facts, and an operator reading a refusal deserves the right one.
 */
export function createJao4ToolRegistry(
  descriptors: readonly Jao4ToolDescriptor[] = JAO4_PRODUCTION_TOOLS,
): Jao4ToolRegistry {
  const frozen = Object.freeze([...descriptors]);
  return Object.freeze({
    descriptors: frozen,
    lookup(toolId: string, toolVersion: string): Jao4RegistryLookup {
      const byId = frozen.filter((one) => one.toolId === toolId);
      if (byId.length === 0) {
        return Object.freeze({ ok: false as const, refusal: 'TOOL_UNKNOWN' as const });
      }
      const descriptor = byId.find((one) => one.toolVersion === toolVersion);
      if (descriptor === undefined) {
        // Registered, but not at the version asked for. A version is part of the identity, not a
        // hint: silently serving v1 for a v2 request is how a caller ends up trusting a contract
        // that was never agreed.
        return Object.freeze({ ok: false as const, refusal: 'TOOL_VERSION_MISMATCH' as const });
      }
      if (descriptor.availability === 'PLANNED') {
        return Object.freeze({ ok: false as const, refusal: 'TOOL_PLANNED' as const });
      }
      if (descriptor.availability === 'DISABLED') {
        return Object.freeze({ ok: false as const, refusal: 'TOOL_DISABLED' as const });
      }
      return Object.freeze({ ok: true as const, descriptor });
    },
  });
}

/** The registered tool ids, for a spec that pins the shipped set exactly. */
export function jao4RegisteredToolIds(registry: Jao4ToolRegistry): readonly string[] {
  return Object.freeze(registry.descriptors.map((one) => one.toolId).sort());
}

/** The closed set, so a spec can assert nothing was added. */
export const JAO4_EXPECTED_TOOL_IDS: readonly string[] = Object.freeze([...JAO4_TOOL_IDS].sort());

/** Refuse a descriptor list carrying a tool id outside the closed vocabulary. */
export function assertJao4KnownTool(toolId: string): Jao4ToolId {
  const known = (JAO4_TOOL_IDS as readonly string[]).includes(toolId);
  if (!known) {
    throw new Jao4WorkbenchError('TOOL_UNKNOWN');
  }
  // Narrowed against the closed vocabulary rather than cast: a value outside it never gets here.
  return toolId as Jao4ToolId;
}
