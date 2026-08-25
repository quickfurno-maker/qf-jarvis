/**
 * The JAO-2 governed specialist delegation supervisor (ADR-0116).
 *
 * ### What this proves, and what it deliberately does not
 *
 * It proves ONE supervisor-to-specialist delegation seam: an explicit synthetic envelope is parsed,
 * a governed local registry is consulted, the authority ceiling is enforced, and exactly one bounded
 * call reaches an independently governed specialist's PURE BEHAVIOUR surface. Then it stops.
 *
 * It makes ZERO model calls. JAO-2 is about delegation governance, not inference -- JAO-1 already
 * owns the one-gateway-call operational-health proof and is untouched by this slice. There is no
 * gateway, no bridge and no provider reachable from anywhere in this directory.
 *
 * ### The order of the gates is the governance
 *
 * envelope -> run identity -> registry availability -> authority ceiling -> specialist binding ->
 * specialist.
 *
 * Availability is decided BEFORE invocation, so a PLANNED or DISABLED specialist is never called and
 * a run that refuses reports `delegationCalls: 0`. Authority is decided before invocation too, so an
 * escalating request never reaches a specialist that might have honoured it.
 *
 * ### Authorization and invocation are the same specialist, structurally
 *
 * The registry authorizes a DESCRIPTOR; the composition supplies an ADAPTER. Those are two objects,
 * and a supervisor that checked one and called the other would be keeping an audit trail about a
 * specialist it did not delegate to. The binding gate proves they are the same governed specialist
 * in every field, and it publishes the adapter it checked into `boundSpecialist` -- which is the
 * invoking step's ONLY route to a specialist. Skipping the gate does not produce an unchecked call;
 * it produces no call.
 *
 * ### One run identity
 *
 * The workflow is started with a run id and the envelope carries one. They must be the same run. A
 * mismatch is refused rather than reconciled: normalising either into the other would file the
 * delegation under a run that never asked for it.
 *
 * ### No fallback, ever
 *
 * A refusal is terminal. There is no second specialist, no nearest match, no retry, no substitute
 * chosen by a model and no dynamic agent creation. `maxCalls` is a literal `1` in the envelope and
 * the counter is enforced here as well, so the budget is not merely declared.
 *
 * Mastra is the harness and nothing more: `@mastra/core/workflows` sequences two steps and holds no
 * authority, no credential, no provider and no state.
 */
import { createStep, createWorkflow } from '@mastra/core/workflows';

import {
  JAO2_REFUSAL_REASONS,
  jao2AdvisoryResultSchema,
  jao2DelegationEnvelopeSchema,
  jao2DelegationStepOutputSchema,
  jao2RunResultSchema,
  jao2TelemetryEventSchema,
  jao2WorkflowInputSchema,
  type Jao2Clock,
  type Jao2DelegationStepOutput,
  type Jao2RefusalReason,
  type Jao2RunResult,
  type Jao2SpecialistAvailability,
  type Jao2TelemetryHook,
  type Jao2WorkflowInput,
} from './contracts.js';
import {
  evaluateDelegationAuthority,
  evaluateSpecialistBinding,
  type Jao2SpecialistRegistry,
} from './registry.js';
import { Jao2SpecialistError, type Jao2SpecialistAdapter } from './riya-adapter.js';

const TASK_TYPE = 'jarvis.operations.governed-specialist-delegation' as const;
const PARENT_AUTONOMY_LEVEL = 'L1_READ' as const;
const MAX_DELEGATION_CALLS = 1;

export interface Jao2DelegationSupervisorDependencies {
  readonly registry: Jao2SpecialistRegistry;
  readonly specialist: Jao2SpecialistAdapter;
  readonly clock: Jao2Clock;
  readonly telemetry?: Jao2TelemetryHook;
}

function refusal(
  runId: string,
  delegationId: string | null,
  reason: Jao2RefusalReason,
  specialistId: string | null,
  capabilityId: string | null,
  delegationCalls: number,
): Jao2DelegationStepOutput {
  return {
    runId,
    delegationId,
    outcome: reason === 'SPECIALIST_UNKNOWN' ? 'NO_ELIGIBLE_SPECIALIST' : 'REFUSED',
    refusalReason: reason,
    specialistId,
    capabilityId,
    advisory: null,
    delegatedAutonomyLevel: null,
    delegationCalls,
    modelCalls: 0,
    businessEffect: false,
  };
}

function mapSpecialistFailure(error: unknown, signal?: AbortSignal): Jao2RefusalReason {
  if (signal?.aborted === true) {
    return 'CANCELLED';
  }
  if (error instanceof Jao2SpecialistError) {
    return error.code === 'cancelled' ? 'CANCELLED' : 'SPECIALIST_INPUT_INVALID';
  }
  // Anything the specialist threw is normalised. The thrown object is never read, so nothing it
  // carries -- a path, a stack, a message quoting private context -- can reach the record.
  return 'SPECIALIST_FAILED';
}

export async function runJao2GovernedDelegation(
  input: Jao2WorkflowInput,
  dependencies: Jao2DelegationSupervisorDependencies,
  signal?: AbortSignal,
): Promise<Jao2RunResult> {
  const startedAt = dependencies.clock.nowMs();

  /**
   * The adapter, read out of `dependencies` EXACTLY ONCE.
   *
   * `readonly` is a compile-time promise about an object this function was handed. Reading
   * `dependencies.specialist` twice -- once to bind it, once to invoke it -- would leave a window
   * between the two in which what was authorized stops being what runs. One read closes it.
   */
  const specialist = dependencies.specialist;

  /**
   * Published ONLY by a passing binding gate, and the invoking step's only route to a specialist.
   *
   * Structural rather than procedural: the delegate step holds no other reference to an adapter, so
   * "invoked something the registry never authorized" is not a state this code can reach.
   */
  let boundSpecialist: Jao2SpecialistAdapter | null = null;

  let delegationCalls = 0;
  let availabilityDecision: Jao2SpecialistAvailability | null = null;
  let governanceRef: string | null = null;
  let behaviourVersion: string | null = null;

  const authorizeStep = createStep({
    id: 'jao2-authorize-delegation',
    inputSchema: jao2WorkflowInputSchema,
    outputSchema: jao2DelegationStepOutputSchema,
    // Mastra's `ExecuteFunction` returns a Promise. This decision is entirely synchronous -- a parse,
    // a registry lookup and two comparisons -- so it is adapted with `Promise.resolve` rather than
    // written as an `async` function that awaits nothing, which would be fake async the repository's
    // `require-await` rule rightly refuses.
    execute: ({ inputData }) => Promise.resolve(authorize(inputData)),
  });

  function authorize(inputData: Jao2WorkflowInput): Jao2DelegationStepOutput {
    {
      if (signal?.aborted === true) {
        return refusal(inputData.runId, null, 'CANCELLED', null, null, delegationCalls);
      }

      const parsed = jao2DelegationEnvelopeSchema.safeParse(inputData.envelope);
      if (!parsed.success) {
        return refusal(inputData.runId, null, 'ENVELOPE_INVALID', null, null, delegationCalls);
      }
      const envelope = parsed.data;

      // ONE RUN IDENTITY, before any registry work. The refusal deliberately adopts none of the
      // envelope's identity -- not its delegation id, not its specialist -- because attaching those
      // to this run id is precisely the false pairing being refused.
      if (inputData.runId !== envelope.runId) {
        return refusal(inputData.runId, null, 'RUN_ID_MISMATCH', null, null, delegationCalls);
      }

      // AVAILABILITY FIRST. A PLANNED or DISABLED specialist must never be invoked, so the decision
      // happens here rather than inside an adapter that would already have been reached.
      const lookup = dependencies.registry.lookup(envelope.specialistId, envelope.capabilityId);
      if (!lookup.ok) {
        return refusal(
          inputData.runId,
          envelope.delegationId,
          lookup.refusal,
          envelope.specialistId,
          envelope.capabilityId,
          delegationCalls,
        );
      }
      availabilityDecision = lookup.descriptor.availability;
      governanceRef = lookup.descriptor.governanceRef;

      // THE CEILING. Delegated authority may narrow and may never widen.
      const authority = evaluateDelegationAuthority(envelope, lookup.descriptor);
      if (!authority.ok) {
        return refusal(
          inputData.runId,
          envelope.delegationId,
          authority.refusal,
          envelope.specialistId,
          envelope.capabilityId,
          delegationCalls,
        );
      }

      // THE BINDING. Everything above was decided about the REGISTRY's descriptor; this is what
      // makes those decisions true of the adapter that actually runs. Checked here, in the governance
      // step, and published rather than re-derived later -- so the object that passed the gate is
      // the object that gets called.
      const binding = evaluateSpecialistBinding(lookup.descriptor, specialist.descriptor);
      if (!binding.ok) {
        return refusal(
          inputData.runId,
          envelope.delegationId,
          binding.refusal,
          envelope.specialistId,
          envelope.capabilityId,
          delegationCalls,
        );
      }
      boundSpecialist = specialist;

      return {
        runId: inputData.runId,
        delegationId: envelope.delegationId,
        outcome: 'DELEGATION_COMPLETED' as const,
        refusalReason: null,
        specialistId: envelope.specialistId,
        capabilityId: envelope.capabilityId,
        advisory: null,
        delegatedAutonomyLevel: envelope.requestedAutonomyLevel,
        delegationCalls,
        modelCalls: 0 as const,
        businessEffect: false as const,
      };
    }
  }

  const delegateStep = createStep({
    id: 'jao2-invoke-governed-specialist',
    inputSchema: jao2DelegationStepOutputSchema,
    outputSchema: jao2DelegationStepOutputSchema,
    execute: async ({ inputData }) => {
      if (inputData.refusalReason !== null || inputData.delegationId === null) {
        return inputData;
      }
      if (signal?.aborted === true) {
        return refusal(
          inputData.runId,
          inputData.delegationId,
          'CANCELLED',
          inputData.specialistId,
          inputData.capabilityId,
          delegationCalls,
        );
      }
      if (delegationCalls >= MAX_DELEGATION_CALLS) {
        return refusal(
          inputData.runId,
          inputData.delegationId,
          'BUDGET_EXHAUSTED',
          inputData.specialistId,
          inputData.capabilityId,
          delegationCalls,
        );
      }

      // The ONLY specialist reference this step has. Unreachable while the authorize step runs
      // first -- and kept anyway, because an edit that drops the binding gate should stop delegating
      // rather than start invoking whatever the composition injected.
      const bound = boundSpecialist;
      if (bound === null) {
        return refusal(
          inputData.runId,
          inputData.delegationId,
          'SPECIALIST_BINDING_MISMATCH',
          inputData.specialistId,
          inputData.capabilityId,
          delegationCalls,
        );
      }

      // The envelope was parsed in the previous step; re-parse rather than carrying an object
      // across the step boundary, so what reaches the specialist has been validated on this side too.
      const parsed = jao2DelegationEnvelopeSchema.safeParse(input.envelope);
      if (!parsed.success) {
        return refusal(
          inputData.runId,
          inputData.delegationId,
          'ENVELOPE_INVALID',
          inputData.specialistId,
          inputData.capabilityId,
          delegationCalls,
        );
      }
      // Re-parsing means re-checking what the parse is for: the run identity is proved again on this
      // side of the boundary rather than inherited from a step that has already returned.
      if (parsed.data.runId !== inputData.runId) {
        return refusal(
          inputData.runId,
          inputData.delegationId,
          'RUN_ID_MISMATCH',
          inputData.specialistId,
          inputData.capabilityId,
          delegationCalls,
        );
      }

      delegationCalls += 1;

      try {
        // The adapter is synchronous because the governed behaviour it delegates to is; `await`
        // consumes an ordinary value perfectly well and keeps this call site identical in shape to
        // JAO-1's, so a reader comparing the two sees one pattern rather than two.
        const raw = await bound.invoke(parsed.data.input, signal);
        const advisory = jao2AdvisoryResultSchema.safeParse(raw);
        if (!advisory.success) {
          return refusal(
            inputData.runId,
            inputData.delegationId,
            'SPECIALIST_OUTPUT_INVALID',
            inputData.specialistId,
            inputData.capabilityId,
            delegationCalls,
          );
        }
        behaviourVersion = advisory.data.behaviourVersion;
        return {
          ...inputData,
          advisory: advisory.data,
          delegationCalls,
        };
      } catch (error) {
        return refusal(
          inputData.runId,
          inputData.delegationId,
          mapSpecialistFailure(error, signal),
          inputData.specialistId,
          inputData.capabilityId,
          delegationCalls,
        );
      }
    },
  });

  const workflow = createWorkflow({
    id: 'jao2-governed-specialist-delegation',
    inputSchema: jao2WorkflowInputSchema,
    outputSchema: jao2DelegationStepOutputSchema,
  })
    .then(authorizeStep)
    .then(delegateStep)
    .commit();

  let output: Jao2DelegationStepOutput;
  try {
    const run = await workflow.createRun();
    const result = await run.start({ inputData: input });
    if (result.status !== 'success') {
      throw new Error('Mastra workflow did not complete successfully');
    }
    output = jao2DelegationStepOutputSchema.parse(result.result);
  } catch {
    output = jao2DelegationStepOutputSchema.parse(
      refusal(
        input.runId,
        null,
        signal?.aborted === true ? 'CANCELLED' : 'WORKFLOW_FAILED',
        null,
        null,
        delegationCalls,
      ),
    );
  }

  const endedAt = dependencies.clock.nowMs();
  const durationMs = Math.max(0, Math.min(600_000, Math.trunc(endedAt - startedAt)));
  const specialistsInvoked =
    output.advisory === null ? [] : ([output.advisory.specialistId] as const);

  const finalResult = jao2RunResultSchema.parse({
    ...output,
    taskType: TASK_TYPE,
    parentAutonomyLevel: PARENT_AUTONOMY_LEVEL,
    specialistsInvoked,
    governanceRef: output.advisory === null ? null : governanceRef,
    durationMs,
  });

  const telemetry = jao2TelemetryEventSchema.parse({
    runId: finalResult.runId,
    delegationId: finalResult.delegationId,
    triggerType: 'EXPLICIT_SHADOW_PROOF',
    taskType: TASK_TYPE,
    parentAutonomyLevel: PARENT_AUTONOMY_LEVEL,
    delegatedAutonomyLevel: finalResult.delegatedAutonomyLevel,
    specialistId: finalResult.specialistId,
    capabilityId: finalResult.capabilityId,
    availabilityDecision,
    behaviourVersion,
    delegationCalls: finalResult.delegationCalls,
    modelCalls: 0,
    durationMs: finalResult.durationMs,
    outcome: finalResult.outcome,
    refusalReason: finalResult.refusalReason,
  });

  dependencies.telemetry?.record(telemetry);

  return Object.freeze(finalResult);
}

export const JAO2_DELEGATION_BOUNDS = Object.freeze({
  maxDelegationCalls: MAX_DELEGATION_CALLS,
  maxModelCalls: 0,
  maxProposals: 0,
  maxExecutions: 0,
  retries: 0,
  parentAutonomyLevel: PARENT_AUTONOMY_LEVEL,
  delegatedAutonomyCeiling: 'L0_REASON',
  persistence: false,
  businessEffect: false,
  dynamicSpecialistSpawning: false,
  fallbackSpecialist: false,
  specialistBindingEnforced: true,
  runIdBindingEnforced: true,
});

export const JAO2_DELEGATION_REFUSALS = Object.freeze([...JAO2_REFUSAL_REASONS]);
