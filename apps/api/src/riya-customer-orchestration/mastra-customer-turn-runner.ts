/**
 * The Mastra customer-turn runner (JF-4, ADR-0149).
 *
 * ### What this is, and what it is emphatically not
 *
 * It is an orchestration SHELL: one Mastra workflow, one deterministic step, one call to the existing
 * channel-neutral Riya conversation service, and the service's own result handed back untouched.
 *
 * It is not a second Riya. It renders no prompt, chooses no model, calls no provider, retrieves no
 * knowledge, touches no continuity, acquires no turn lease, reaches no Core, and holds no memory. Riya
 * already does all of that, correctly, behind one entry point — and the value of putting Mastra here
 * is precisely that it can be shown to change none of it.
 *
 * ### The customer turn never enters Mastra's data plane
 *
 * The workflow's input and output schemas carry an opaque run marker and a status. The turn itself,
 * the reply, the continuity and any retrieved knowledge travel in a closure variable that exists for
 * the duration of one call and is never handed to the framework.
 *
 * That is deliberate on three counts. The result reaches the caller BY REFERENCE, so nothing can
 * reshape an authorized reply on the way out — a framework that serialized it could not preserve it
 * byte-for-byte, and "byte-for-byte" is the whole contract for text Core authorized. Mastra retains no
 * customer content, because it is never given any. And there is nowhere for a future step to reach in
 * and start assembling context, which is how a shell becomes a second brain.
 *
 * ### One call, and no second chance at it
 *
 * The step invokes the supplied service call exactly once. If it throws, the shell reports
 * `SERVICE_FAILED` and stops: no retry, no backoff, no second workflow run. Riya's turn semantics —
 * the logical-turn coordinator, continuity CAS, the model budget — are all built on a turn happening
 * at most once, and a retry here would quietly re-enter every one of them.
 *
 * ### Cancellation
 *
 * Checked before the step runs. An already-cancelled turn makes zero service calls. Once the service
 * has been entered, its own cancellation semantics apply and this shell does not interrupt it — a
 * turn abandoned mid-flight would leave the coordinator's claim in a state only the coordinator knows
 * how to resolve.
 */
import { createStep, createWorkflow } from '@mastra/core/workflows';
import type { RiyaConversationChannel } from '@qf-jarvis/riya-web-conversation-service';
import { z } from 'zod';

import type {
  RiyaCustomerOrchestrationObservability,
  RiyaCustomerOrchestrationRefusal,
} from './contracts.js';

/** The opaque marker the framework carries. No customer content, by construction. */
const runMarkerSchema = z.object({ runRef: z.string().min(1).max(128) }).strict();
const stepOutputSchema = z
  .object({ runRef: z.string().min(1).max(128), invoked: z.boolean() })
  .strict();

/** Raised when the orchestration shell itself could not complete. Never carries content. */
export class RiyaCustomerOrchestrationError extends Error {
  public readonly refusal: RiyaCustomerOrchestrationRefusal;

  public constructor(refusal: RiyaCustomerOrchestrationRefusal) {
    super(`Riya customer orchestration did not complete: ${refusal}`);
    this.name = 'RiyaCustomerOrchestrationError';
    this.refusal = refusal;
    Object.freeze(this);
  }
}

/** A monotonic per-process run counter. Opaque, not derived from any conversation identity. */
let runSequence = 0;
function nextRunRef(): string {
  runSequence += 1;
  return `riya.customer.run.${String(runSequence)}`;
}

export interface MastraCustomerTurnRunnerOptions {
  readonly observability?: RiyaCustomerOrchestrationObservability;
}

/**
 * Run one customer turn through one Mastra workflow.
 *
 * `invoke` is the service's OWN entry point, already bound to its turn by the caller. Passing the call
 * rather than the turn is what keeps channel mapping — `handleTurn` fixing the channel and mapping
 * `webTurnRef` — inside the service where RWC-P8 put it, instead of being reimplemented here.
 *
 * `channel` is the canonical RWC-P8 vocabulary type, imported rather than respelled. Writing the union
 * out here would be a second definition of which channels exist, and the two would drift the first
 * time one gained a member.
 */
export async function runCustomerTurnWorkflow<T>(
  invoke: () => Promise<T>,
  channel: RiyaConversationChannel,
  options: MastraCustomerTurnRunnerOptions,
  signal?: AbortSignal,
): Promise<T> {
  const runRef = nextRunRef();
  // A holder rather than plain locals: these are written inside the step closure, which runs during
  // `run.start`, and the compiler cannot see that -- it would narrow them to their initial values.
  const state = { captured: undefined as T | undefined, invocations: 0, serviceFailed: false };

  const turnStep = createStep({
    id: 'riya-customer-turn',
    inputSchema: runMarkerSchema,
    outputSchema: stepOutputSchema,
    execute: async ({ inputData }: { inputData: { runRef: string } }) => {
      if (signal?.aborted === true) {
        // Nothing has been entered yet, so nothing has to be unwound.
        throw new RiyaCustomerOrchestrationError('CANCELLED');
      }
      state.invocations += 1;
      try {
        state.captured = await invoke();
      } catch {
        // The service's own refusals are RESULTS, not exceptions -- so an exception here is a defect
        // or an infrastructure failure, and either way it is not retried. The thrown value is never
        // read: it may carry the message, the draft or a provider's error text.
        state.serviceFailed = true;
        throw new RiyaCustomerOrchestrationError('SERVICE_FAILED');
      }
      return { runRef: inputData.runRef, invoked: true };
    },
  });

  const workflow = createWorkflow({
    id: 'riya-customer-turn',
    inputSchema: runMarkerSchema,
    outputSchema: stepOutputSchema,
  })
    .then(turnStep)
    .commit();

  let refusal: RiyaCustomerOrchestrationRefusal | undefined;
  try {
    const run = await workflow.createRun();
    const outcome = await run.start({ inputData: { runRef } });
    if (outcome.status !== 'success') {
      refusal = state.serviceFailed ? 'SERVICE_FAILED' : 'WORKFLOW_FAILED';
    }
  } catch {
    refusal = state.serviceFailed
      ? 'SERVICE_FAILED'
      : signal?.aborted === true
        ? 'CANCELLED'
        : 'WORKFLOW_FAILED';
  }

  // A successful run that somehow produced no capture is a framework defect, not a Riya outcome. It
  // is reported as one rather than being papered over with a manufactured result -- an invented
  // "Riya said nothing" is indistinguishable to a caller from Riya actually having said nothing.
  if (refusal === undefined && state.captured === undefined) {
    refusal = 'WORKFLOW_FAILED';
  }

  options.observability?.onEvent(
    Object.freeze({
      type: 'riya-customer-turn' as const,
      runRef,
      channel,
      serviceInvocations: state.invocations === 0 ? (0 as const) : (1 as const),
      authorizedReplyPresent: refusal === undefined && hasAuthorizedReply(state.captured),
      refusal,
    }),
  );

  if (refusal !== undefined) {
    throw new RiyaCustomerOrchestrationError(refusal);
  }
  // BY REFERENCE. The exact object the conversation service returned, including the exact bytes Core
  // authorized. Nothing here reads it, copies it, reshapes it or adds to it.
  return state.captured as T;
}

/** Content-free: reads only whether the field is present, never what is in it. */
function hasAuthorizedReply(value: unknown): boolean {
  return (
    value !== null &&
    typeof value === 'object' &&
    (value as { authorizedReply?: unknown }).authorizedReply !== undefined
  );
}
