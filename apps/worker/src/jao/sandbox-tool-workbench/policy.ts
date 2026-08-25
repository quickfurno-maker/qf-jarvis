/**
 * The JAO-4 workbench policy: the guards, as pure functions (ADR-0118).
 *
 * The same split JAO-3 uses. Every rule here is enforced by the workbench before a tool runs, and
 * every rule here is a real production function a unit test can call directly -- so the suite
 * proves the actual enforcement rather than a re-implementation of it.
 *
 * Pure: no clock, no network, no filesystem, no environment, no storage, no process.
 */
import {
  JAO4_AUTONOMY_RANK,
  JAO4_LIMITS,
  Jao4WorkbenchError,
  jao4ToolDescriptorSchema,
  type Jao4AutonomyLevel,
  type Jao4ToolDescriptor,
} from './contracts.js';

/**
 * Authority may narrow and may never widen.
 *
 * Two ceilings, both compared by RANK on parsed data: the requested level must not outrank the
 * caller's own, nor the tool's governed maximum. A caller holding `L1_READ` still may not invoke a
 * tool at a level that tool's governance does not grant.
 *
 * The absolutes -- network, secrets, host filesystem, process, shell, environment, database,
 * business effect, production mutation -- are NOT re-compared here. They are `z.literal` in the
 * descriptor schema, so a tool claiming any of them cannot be parsed at all; re-checking them would
 * be code TypeScript can already prove dead. The descriptor is re-parsed instead, so a value that
 * reached this function without ever being parsed carries the guarantee and not merely the type.
 */
export function assertJao4AuthorityCeiling(
  requestedLevel: Jao4AutonomyLevel,
  parentLevel: Jao4AutonomyLevel,
  descriptor: Jao4ToolDescriptor,
): void {
  const governed = jao4ToolDescriptorSchema.safeParse(descriptor);
  if (!governed.success) {
    throw new Jao4WorkbenchError('AUTHORITY_ESCALATION');
  }
  const requested = JAO4_AUTONOMY_RANK[requestedLevel];
  const parent = JAO4_AUTONOMY_RANK[parentLevel];
  const toolCeiling = JAO4_AUTONOMY_RANK[governed.data.maxAutonomyLevel];
  if (requested > parent || requested > toolCeiling) {
    throw new Jao4WorkbenchError('AUTHORITY_ESCALATION');
  }
}

/**
 * Every security-relevant descriptor field, as a TOTAL map.
 *
 * A field added to the descriptor schema and not listed here does not compile. That is the whole
 * point, and it is the lesson JAO-2 paid for: a binding check that silently ignored a new capability
 * field would go on authorizing one tool and invoking another the moment the descriptor grew -- and
 * it would keep passing its own tests while doing it.
 */
const JAO4_BINDING_FIELDS: Readonly<Record<keyof Jao4ToolDescriptor, true>> = Object.freeze({
  toolId: true,
  toolVersion: true,
  toolClass: true,
  governanceRef: true,
  availability: true,
  maxAutonomyLevel: true,
  dataClass: true,
  maxCallsPerRun: true,
  readOnly: true,
  businessEffect: true,
  productionMutation: true,
  mayNetwork: true,
  mayAccessSecrets: true,
  mayAccessHostFilesystem: true,
  mayWriteVirtualFilesystem: true,
  mayExecuteProcess: true,
  mayUseShell: true,
  mayAccessEnvironment: true,
  mayAccessDatabase: true,
  networkPolicy: true,
  secretPolicy: true,
  hostFilesystem: true,
  virtualFilesystem: true,
  processExecution: true,
  shell: true,
  environment: true,
  database: true,
  rollbackPosture: true,
  approvalPosture: true,
});

/** The names the binding compares. Derived from the total map so the two cannot disagree. */
export const JAO4_BINDING_FIELD_NAMES: readonly string[] = Object.freeze(
  Object.keys(JAO4_BINDING_FIELDS).sort(),
);

/**
 * Bind registry AUTHORIZATION to the implementation that will actually RUN.
 *
 * The registry authorizes a DESCRIPTOR; the composition supplies an IMPLEMENTATION carrying its own
 * descriptor. Those are two objects, and looking one up never made the other the thing it described.
 * A composition pairing a descriptor that passes every availability and authority gate with an
 * implementation governed as something else would run the second while the audit record named the
 * first -- and a registry whose verdict is about a different object than the one invoked is
 * decoration.
 *
 * `invoked` is `unknown` because at runtime it is: the implementation arrives from a caller, and a
 * type annotation is not a parse. Values are compared as `unknown` read out of maps, because
 * comparing the typed fields directly would compare single-member literal types -- provably true
 * before it runs, and therefore no check at all.
 */
export function assertJao4ToolBinding(authorized: Jao4ToolDescriptor, invoked: unknown): void {
  const left = jao4ToolDescriptorSchema.safeParse(authorized);
  const right = jao4ToolDescriptorSchema.safeParse(invoked);
  if (!left.success || !right.success) {
    throw new Jao4WorkbenchError('TOOL_BINDING_MISMATCH');
  }

  const authorizedFields = new Map<string, unknown>(Object.entries(left.data));
  const invokedFields = new Map<string, unknown>(Object.entries(right.data));
  for (const field of JAO4_BINDING_FIELD_NAMES) {
    if (!Object.is(authorizedFields.get(field), invokedFields.get(field))) {
      throw new Jao4WorkbenchError('TOOL_BINDING_MISMATCH');
    }
  }
}

/**
 * One run identity.
 *
 * A call naming a different run than the request executing it is invalid provenance, not a
 * formatting difference, so neither id is normalised into the other. The JAO-2 and JAO-3 lesson:
 * evidence filed under a run that did not gather it is an audit trail that quietly lies.
 */
export function assertJao4RunBinding(requestRunId: string, callRunId: string): void {
  if (requestRunId !== callRunId) {
    throw new Jao4WorkbenchError('RUN_ID_MISMATCH');
  }
}

/**
 * The run-wide call budget, counted rather than declared.
 *
 * The request schema already caps the calls array, so this is the second mechanism: enforced
 * against work actually done, which is what would still hold if a future caller found a way to
 * submit more calls than the array allows.
 */
export function assertJao4CallBudget(callsMade: number): void {
  if (callsMade >= JAO4_LIMITS.maxToolCallsPerRun) {
    throw new Jao4WorkbenchError('CALL_BUDGET_EXHAUSTED');
  }
}

/**
 * The PER-TOOL budget, taken from the tool's own governed descriptor.
 *
 * This is what makes `maxCallsPerRun` load-bearing rather than decorative: a tool governed for one
 * call per run gets one, whatever the run-wide budget still allows. A ceiling that no reachable
 * input can hit is not a ceiling -- it is a comment that happens to compile.
 */
export function assertJao4ToolCallBudget(callsMadeForTool: number, maxCallsPerRun: number): void {
  if (callsMadeForTool >= maxCallsPerRun) {
    throw new Jao4WorkbenchError('CALL_BUDGET_EXHAUSTED');
  }
}

/**
 * The total output ceiling, checked against the result a tool ACTUALLY produced.
 *
 * Measured after the tool runs and before the result is admitted, so an over-budget result is
 * discarded whole. Returning the part that fits would be worse than refusing: a silently truncated
 * excerpt is evidence that looks complete and is not, and nothing downstream could tell.
 */
export function assertJao4OutputBudget(totalOutputChars: number, additionalChars: number): void {
  if (totalOutputChars + additionalChars > JAO4_LIMITS.maxTotalOutputChars) {
    throw new Jao4WorkbenchError('OUTPUT_BUDGET_EXHAUSTED');
  }
}

/** Cancellation is checked before every call, so a cancelled run invokes nothing. */
export function assertJao4NotCancelled(signal?: AbortSignal): void {
  if (signal?.aborted === true) {
    throw new Jao4WorkbenchError('CANCELLED');
  }
}
