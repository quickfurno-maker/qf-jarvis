/**
 * The JAO-4 sandbox tool workbench (ADR-0118).
 *
 * ### The order of the gates is the governance
 *
 * request -> bundle identity -> sandbox -> per call: cancellation -> run identity -> registry
 * availability -> authority ceiling -> tool binding -> call budget -> invoke -> evidence parse ->
 * output budget.
 *
 * Everything above `invoke` is decided BEFORE anything runs, so an unknown, planned, disabled,
 * version-mismatched, escalating or wrongly-bound tool is never called even once. A refused call
 * reports zero output and no evidence.
 *
 * ### The call plan is fixed before the sandbox is opened
 *
 * `calls` is parsed from the request and never grows. Nothing in this file reads artifact content
 * to decide what to do next: there is no loop that consults a tool result to append a call, no
 * planner, no model and no interpretation step. That is what makes prompt injection inert here --
 * a malicious artifact is text that a bounded excerpt may quote back, and there is no mechanism it
 * could influence even if something wanted to be influenced.
 *
 * ### No Mastra
 *
 * JAO-1 and JAO-2 use `@mastra/core/workflows` because sequencing steps is what they prove. JAO-4
 * proves isolation, and a harness that sequenced these four calls would add a dependency to the
 * one slice whose whole claim is about what it cannot reach. A spec asserts no `@mastra` import.
 */
import {
  JAO4_LIMITS,
  Jao4WorkbenchError,
  jao4EvidenceSchema,
  jao4TelemetryEventSchema,
  jao4ToolCallResultSchema,
  jao4WorkbenchRequestSchema,
  jao4WorkbenchResultSchema,
  type Jao4Call,
  type Jao4Clock,
  type Jao4RefusalReason,
  type Jao4TelemetryHook,
  type Jao4ToolCallResult,
  type Jao4WorkbenchRequest,
  type Jao4WorkbenchResult,
} from './contracts.js';
import { createJao4ArtifactSandbox } from './artifact-sandbox.js';
import {
  assertJao4AuthorityCeiling,
  assertJao4CallBudget,
  assertJao4NotCancelled,
  assertJao4OutputBudget,
  assertJao4RunBinding,
  assertJao4ToolBinding,
  assertJao4ToolCallBudget,
} from './policy.js';
import { createJao4ToolRegistry, type Jao4ToolRegistry } from './tool-registry.js';
import { createJao4Tools, jao4OutputChars, type Jao4Tool } from './tools.js';

/**
 * What a PUBLIC caller may supply. Deliberately: a clock, and somewhere to send telemetry.
 *
 * ### Why there is no `tools` field here
 *
 * There used to be, and owner review found it. Descriptor binding compares the registry's
 * descriptor to the one an implementation carries -- which proves METADATA IDENTITY and nothing at
 * all about behaviour. An implementation can copy the exact canonical descriptor while its
 * `invoke` does whatever its own module can reach:
 *
 * ```
 * { descriptor: EXACT_CANONICAL_DESCRIPTOR, invoke() { ...anything... } }
 * ```
 *
 * The containment specs read the JAO-4 source tree. They cannot read code injected from outside
 * it, so with a public `tools` field the claims "no host filesystem, no network, no process, no
 * shell, no environment, no database" were true of this directory and unproven of the thing that
 * actually ran.
 *
 * A runtime brand, marker string, secret field or descriptor flag would not fix it either: an
 * implementation that can copy a descriptor can copy a brand exactly as easily. The only thing
 * that works is COMPOSITION PINNING -- the public runner constructs the canonical tools itself and
 * offers no parameter that could replace them.
 *
 * Descriptor binding stays, as defence in depth against a wrongly-composed internal seam. It is no
 * longer the mechanism the isolation claims rest on.
 */
export interface Jao4WorkbenchDependencies {
  readonly clock: Jao4Clock;
  readonly telemetry?: Jao4TelemetryHook;
}

/**
 * The INTERNAL composition seam. Trusted, source-level, and not public.
 *
 * It exists so the threat-model suite can inject a hostile implementation and prove why pinning is
 * necessary -- a proof that requires being able to attempt the thing being prevented. It is
 * exported from this module and from nowhere else: `public.ts` and `index.ts` do not re-export it,
 * so it is unreachable through the JAO-4 barrel, and a spec asserts exactly that.
 *
 * Any future PRODUCTION pluggable tool loader or broker is a different thing entirely and needs its
 * own authorization boundary, loading model and threat model. This is not that, and must not become
 * it by being exported one day.
 */
export interface Jao4InternalWorkbenchDependencies extends Jao4WorkbenchDependencies {
  readonly registry?: Jao4ToolRegistry;
  readonly tools?: Readonly<Record<string, Jao4Tool>>;
}

/**
 * The bounds JAO-4 operates under, as a machine-readable lock.
 *
 * Asserted by a spec so the claims in ADR-0118 and the PR are checkable rather than descriptive.
 */
export const JAO4_WORKBENCH_BOUNDS = Object.freeze({
  sandboxClass: 'VIRTUAL_ARTIFACT_READ_ONLY',
  hostFilesystemAccess: false,
  networkAccess: false,
  secretSourceAccess: false,
  processExecution: false,
  shellExecution: false,
  environmentAccess: false,
  databaseAccess: false,
  businessEffect: false,
  productionMutation: false,
  commandRunner: false,
  dynamicToolInstall: false,
  arbitraryRegex: false,
  backgroundExecution: false,
  mastraUsed: false,
  modelCalls: 0,
  specialistCalls: 0,
  memoryWrites: 0,
  ...JAO4_LIMITS,
});

function refusedCall(call: Jao4Call, reason: Jao4RefusalReason): Jao4ToolCallResult {
  return jao4ToolCallResultSchema.parse({
    callId: call.callId,
    toolId: call.toolId,
    toolVersion: call.toolVersion,
    outcome: 'REFUSED',
    refusalReason: reason,
    untrustedEvidence: true,
    inputCharsExamined: 0,
    outputChars: 0,
    evidence: null,
  });
}

/** The closed code for anything that escaped, without reading what it carried. */
function toRefusal(error: unknown): Jao4RefusalReason {
  return error instanceof Jao4WorkbenchError ? error.code : 'TOOL_FAILED';
}

/**
 * Run one bounded workbench session over an injected artifact bundle. THE PUBLIC ENTRY POINT.
 *
 * The canonical registry and the canonical tool implementations are constructed HERE, from this
 * module's own imports. There is no parameter through which a caller could replace either, so the
 * implementations that run are the ones the containment specs actually read.
 *
 * Returns a result rather than throwing for a governance refusal: a refused run is a legitimate
 * outcome that carries counters and posture, and a caller needs those as much as it needs a
 * successful one.
 */
export function runJao4Workbench(
  request: unknown,
  dependencies: Jao4WorkbenchDependencies,
  signal?: AbortSignal,
): Jao4WorkbenchResult {
  // Pinned. Not defaulted -- `??` on a caller-supplied field is exactly the shape that let an
  // implementation through, and a default is only a pin until someone passes a value.
  return runJao4WorkbenchInternal(
    request,
    {
      clock: dependencies.clock,
      ...(dependencies.telemetry === undefined ? {} : { telemetry: dependencies.telemetry }),
    },
    signal,
  );
}

/**
 * The internal runner. NOT PUBLIC -- see `Jao4InternalWorkbenchDependencies`.
 *
 * Identical governance to the public path; the only difference is that a trusted source-level
 * caller may substitute the registry or the implementations in order to prove that the gates
 * refuse what they are supposed to refuse.
 */
export function runJao4WorkbenchInternal(
  request: unknown,
  dependencies: Jao4InternalWorkbenchDependencies,
  signal?: AbortSignal,
): Jao4WorkbenchResult {
  const startedAt = dependencies.clock.nowMs();

  // Read ONCE. `readonly` is a compile-time promise about an object this function was handed, and
  // reading a collaborator twice -- once to bind it, once to invoke it -- leaves a window in which
  // what was authorized stops being what runs. The JAO-2 lesson.
  const registry = dependencies.registry ?? createJao4ToolRegistry();
  const tools = dependencies.tools ?? createJao4Tools();

  let sessionId = 'jao4.session.unknown';
  let runId = 'jao4.run.unknown';
  const toolCalls: Jao4ToolCallResult[] = [];
  let totalOutputChars = 0;
  let totalInputCharsExamined = 0;
  const callsPerTool = new Map<string, number>();
  /**
   * Implementations actually entered. Incremented ONCE, immediately before `invoke`, and never
   * derived from whether the result was accepted afterwards.
   */
  let toolInvocations = 0;
  let runRefusal: Jao4RefusalReason | null = null;

  try {
    const parsed = jao4WorkbenchRequestSchema.safeParse(request);
    if (!parsed.success) {
      throw new Jao4WorkbenchError('REQUEST_INVALID');
    }
    const governed: Jao4WorkbenchRequest = parsed.data;
    sessionId = governed.sessionId;
    runId = governed.runId;

    // The request names a bundle and carries one. They must be the same bundle: a request whose
    // stated subject is not the subject it supplied is invalid provenance, not a mismatch to
    // reconcile.
    if (governed.artifactBundleId !== governed.artifactBundle.bundleId) {
      throw new Jao4WorkbenchError('ARTIFACT_BUNDLE_INVALID');
    }

    assertJao4NotCancelled(signal);

    const sandbox = createJao4ArtifactSandbox(governed.artifactBundle);

    for (const call of governed.calls) {
      try {
        assertJao4NotCancelled(signal);
        assertJao4RunBinding(governed.runId, call.runId);

        // AVAILABILITY FIRST, so a planned or disabled tool is never reached by an implementation
        // that would happily have run.
        const lookup = registry.lookup(call.toolId, call.toolVersion);
        if (!lookup.ok) {
          throw new Jao4WorkbenchError(lookup.refusal);
        }

        assertJao4AuthorityCeiling(
          governed.requestedAutonomyLevel,
          governed.parentAutonomyLevel,
          lookup.descriptor,
        );

        // THE BINDING. Everything above was decided about the REGISTRY's descriptor; this is what
        // makes those decisions true of the implementation that actually runs.
        const implementation = tools[call.toolId];
        if (implementation === undefined) {
          throw new Jao4WorkbenchError('TOOL_UNKNOWN');
        }
        assertJao4ToolBinding(lookup.descriptor, implementation.descriptor);

        // Counted against work actually done, not merely declared by the array bound -- and
        // against the tool's OWN governed ceiling, which a run-wide bound would not enforce.
        assertJao4CallBudget(toolCalls.length);
        assertJao4ToolCallBudget(
          callsPerTool.get(call.toolId) ?? 0,
          lookup.descriptor.maxCallsPerRun,
        );

        callsPerTool.set(call.toolId, (callsPerTool.get(call.toolId) ?? 0) + 1);

        // THE AUDIT POINT. Everything above this line is a pre-invocation refusal and leaves the
        // count at zero; everything below it happened, whatever became of the output.
        toolInvocations += 1;
        const output = implementation.invoke(sandbox, call);

        // Re-parsed on this side of the call: a tool that returned something the evidence contract
        // refuses is a refusal, never a result passed on.
        const evidence = jao4EvidenceSchema.safeParse(output.evidence);
        if (!evidence.success) {
          throw new Jao4WorkbenchError('TOOL_OUTPUT_INVALID');
        }

        // Measured on what will ACTUALLY be returned, then admitted or discarded WHOLE. Returning
        // the part that fits would be evidence that looks complete and is not.
        const outputChars = jao4OutputChars(evidence.data);
        assertJao4OutputBudget(totalOutputChars, outputChars);

        totalOutputChars += outputChars;
        totalInputCharsExamined += output.inputCharsExamined;
        toolCalls.push(
          jao4ToolCallResultSchema.parse({
            callId: call.callId,
            toolId: call.toolId,
            toolVersion: call.toolVersion,
            outcome: 'COMPLETED',
            refusalReason: null,
            untrustedEvidence: true,
            inputCharsExamined: output.inputCharsExamined,
            outputChars,
            evidence: evidence.data,
          }),
        );
      } catch (error) {
        // Normalised. The thrown object is never read, so nothing it carries -- a path, a stack, a
        // message quoting artifact content -- can reach the record.
        const reason = toRefusal(error);
        toolCalls.push(refusedCall(call, reason));
        if (reason === 'CANCELLED') {
          runRefusal = reason;
          break;
        }
      }
    }
  } catch (error) {
    runRefusal = toRefusal(error);
  }

  const endedAt = dependencies.clock.nowMs();
  const durationMs = Math.max(0, Math.min(600_000, Math.trunc(endedAt - startedAt)));
  const anyRefused = runRefusal !== null || toolCalls.some((one) => one.outcome === 'REFUSED');

  const result = jao4WorkbenchResultSchema.parse({
    sessionId,
    runId,
    sandboxClass: 'VIRTUAL_ARTIFACT_READ_ONLY',
    outcome: anyRefused ? 'REFUSED' : 'COMPLETED',
    refusalReason:
      runRefusal ?? toolCalls.find((one) => one.outcome === 'REFUSED')?.refusalReason ?? null,
    toolCalls,
    // Call RECORDS processed. `toolInvocations` is the execution count -- the two differ exactly
    // when a call was refused, which is the fact an auditor is looking for.
    totalCalls: toolCalls.length,
    toolInvocations,
    totalInputCharsExamined,
    totalOutputChars,
    // A reference per completed call, so a later slice can cite this evidence without copying it.
    evidenceRefs: toolCalls.filter((one) => one.outcome === 'COMPLETED').map((one) => one.callId),

    // Restated as literals rather than described. A run that somehow did reach a network or a shell
    // could not report itself as one that had not.
    networkAccess: false,
    secretSourceAccess: false,
    hostFilesystemAccess: false,
    processExecution: false,
    shellExecution: false,
    environmentAccess: false,
    databaseAccess: false,
    businessEffect: false,
    productionMutation: false,
    modelCalls: 0,
    specialistCalls: 0,
    memoryWrites: 0,

    durationMs,
  });

  if (dependencies.telemetry !== undefined) {
    const event = jao4TelemetryEventSchema.safeParse({
      sessionId: result.sessionId,
      runId: result.runId,
      sandboxClass: 'VIRTUAL_ARTIFACT_READ_ONLY',
      outcome: result.outcome,
      refusalReason: result.refusalReason,
      totalCalls: result.totalCalls,
      toolInvocations: result.toolInvocations,
      totalInputCharsExamined: result.totalInputCharsExamined,
      totalOutputChars: result.totalOutputChars,
      durationMs: result.durationMs,
      networkAccess: false,
      hostFilesystemAccess: false,
      processExecution: false,
      businessEffect: false,
      modelCalls: 0,
      specialistCalls: 0,
    });
    if (event.success) {
      dependencies.telemetry.record(event.data);
    }
  }

  return Object.freeze(result);
}
