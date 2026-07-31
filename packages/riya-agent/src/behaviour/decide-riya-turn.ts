/**
 * The Riya client-sales turn decision (QFJ-S3-C, ADR-0067).
 *
 * One deterministic function. It reads validated context and returns what SHOULD happen; it does not
 * make it happen. It calls no model, creates no proposal object, mutates nothing, and reaches no
 * transport — the merged pipeline (ADR-0055/0057/0059) owns all of that, and this decision is an
 * input to it.
 *
 * The role boundary is enforced HERE, before anything else, because that is what makes "zero model
 * calls on a role violation" a structural property rather than a hope: a VENDOR turn is refused
 * while it is still data, long before the orchestrator would reach a port.
 *
 * `RIYA` and `CLIENT` are not parameters. A caller cannot ask this module to act as another agent or
 * on another party type, which is the whole point of a role-bounded agent.
 */
import { AI_AGENT_ACTORS } from '@qf-jarvis/agent-runtime';
import type { RuntimeActor, RuntimePartyType, RuntimeReason } from '@qf-jarvis/agent-runtime';
import { z } from 'zod';

import { RiyaBehaviourError } from '../contracts/errors.js';
import type { NeedDiscovery } from '../contracts/need-discovery.js';
import { RIYA_BEHAVIOUR_VERSION, classifyClientSalesIntent } from '../contracts/sales-intent.js';
import type {
  ClientSalesIntent,
  ClientSalesSignals,
  RiyaBehaviourVersion,
} from '../contracts/sales-intent.js';

/** The actor this package speaks as. Fixed, never a parameter. */
export const RIYA_ACTOR = 'RIYA' as const satisfies RuntimeActor;
/** The party type this package may serve. Fixed, never a parameter. */
export const RIYA_SUPPORTED_PARTY = 'CLIENT' as const satisfies RuntimePartyType;

/**
 * What Riya concluded the turn should lead to.
 *
 * Deliberately NOT a replacement for `OrchestrationResult` — that shape is owned by ADR-0055 and is
 * what the pipeline returns. This is the narrower question "what should this sales turn do next?".
 */
export const RIYA_DISPOSITIONS = [
  /** Draft a client-facing reply through the merged model-reply boundary. */
  'DRAFT_REPLY',
  /** Reply, but only to continue discovery — nothing may be proposed yet. */
  'CONTINUE_DISCOVERY',
  /** Request a sales follow-up proposal for Core to validate. */
  'PROPOSE_SALES_FOLLOW_UP',
  /** Request that a human sales person takes over. */
  'REQUEST_HUMAN_SALES_CONTACT',
  /** Decline safely. No model, no proposal. */
  'REFUSE',
] as const;
export type RiyaDisposition = (typeof RIYA_DISPOSITIONS)[number];

export const RIYA_DISPOSITIONS_FROZEN: readonly RiyaDisposition[] = Object.freeze([
  ...RIYA_DISPOSITIONS,
]);

/** A bounded, versioned, opaque prompt reference. S3-I resolves it; this package never renders it. */
const PROMPT_REF = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9._:-]+$/);

export interface RiyaTurnInput {
  readonly partyType: RuntimePartyType;
  /** The actor that currently owns the conversation, when one is assigned. */
  readonly currentActor?: RuntimeActor;
  readonly signals: ClientSalesSignals;
  readonly needDiscovery?: NeedDiscovery;
  /** Opaque, versioned. Never prompt text. */
  readonly promptRef: string;
  readonly humanTakeover: boolean;
  readonly aiPaused: boolean;
}

/** A frozen decision. It carries no instruction that could be executed. */
export interface RiyaTurnDecision {
  readonly behaviourVersion: RiyaBehaviourVersion;
  readonly actor: typeof RIYA_ACTOR;
  readonly intent: ClientSalesIntent;
  readonly disposition: RiyaDisposition;
  readonly needDiscovery: NeedDiscovery | undefined;
  /**
   * Whether the merged model-reply boundary MAY be invoked for this turn.
   *
   * An eligibility decision, not a budget enforcer. It does not — and cannot — enforce process-wide
   * at-most-one invocation; that remains owned by the merged `orchestrateInbound` pipeline and the
   * `ModelReplyPort` / model-reply-adapter contracts (ADR-0055/0057). What this package guarantees is
   * narrower and structural: it invokes nothing itself, and it returns `false` on every pause,
   * takeover, role-violation and refusal path.
   */
  readonly modelReplyEligible: boolean;
  /** A closed runtime reason. Reused from agent-runtime — this package invents no reason codes. */
  readonly reason: RuntimeReason;
  readonly promptRef: string;
}

const turnInputSchema = z
  .object({
    partyType: z.string(),
    currentActor: z.string().optional(),
    signals: z.object({}).loose(),
    needDiscovery: z.unknown().optional(),
    promptRef: PROMPT_REF,
    humanTakeover: z.boolean(),
    aiPaused: z.boolean(),
  })
  .strict();

function decision(
  input: RiyaTurnInput,
  intent: ClientSalesIntent,
  disposition: RiyaDisposition,
  reason: RuntimeReason,
  modelReplyEligible: boolean,
): RiyaTurnDecision {
  return Object.freeze({
    behaviourVersion: RIYA_BEHAVIOUR_VERSION,
    actor: RIYA_ACTOR,
    intent,
    disposition,
    needDiscovery: input.needDiscovery,
    modelReplyEligible,
    reason,
    promptRef: input.promptRef,
  });
}

/**
 * Decide one Riya client-sales turn.
 *
 * Throws `RiyaBehaviourError('invalid-turn-input')` on structurally invalid input. Otherwise it always
 * returns a decision — a refusal is a decision, not an exception.
 *
 * Gate order is load-bearing and matches the merged pipeline's own precedence: pause and takeover
 * outrank everything, then the role boundary, then intent. Each of the first three returns
 * `modelReplyEligible: false`, which is what guarantees no model is reached on those paths.
 */
export function decideRiyaTurn(input: RiyaTurnInput): RiyaTurnDecision {
  const parsed = turnInputSchema.safeParse(input);
  if (!parsed.success) {
    throw new RiyaBehaviourError('invalid-turn-input');
  }
  if (input.currentActor !== undefined && !AI_AGENT_ACTORS.has(input.currentActor)) {
    // HUMAN or SYSTEM already owns the turn; Riya does not take it back on its own.
    return decision(input, 'INSUFFICIENT_CONTEXT', 'REFUSE', 'runtime-human-takeover', false);
  }
  if (input.aiPaused) {
    return decision(input, 'INSUFFICIENT_CONTEXT', 'REFUSE', 'runtime-ai-paused', false);
  }
  if (input.humanTakeover) {
    return decision(input, 'INSUFFICIENT_CONTEXT', 'REFUSE', 'runtime-human-takeover', false);
  }
  // The role boundary, refused while this is still data.
  if (input.partyType !== RIYA_SUPPORTED_PARTY) {
    return decision(input, 'INSUFFICIENT_CONTEXT', 'REFUSE', 'runtime-scope-violation', false);
  }
  if (input.currentActor !== undefined && input.currentActor !== RIYA_ACTOR) {
    // Another AI agent owns it. Coordination is Jarvis's job, not Riya's.
    return decision(input, 'INSUFFICIENT_CONTEXT', 'REFUSE', 'runtime-scope-violation', false);
  }

  const intent = classifyClientSalesIntent(input.signals);

  switch (intent) {
    case 'UNSUPPORTED_NON_SALES_REQUEST':
      return decision(input, intent, 'REFUSE', 'runtime-escalation-required', false);

    case 'HUMAN_SALES_ASSISTANCE_REQUEST':
      return decision(
        input,
        intent,
        'REQUEST_HUMAN_SALES_CONTACT',
        'runtime-escalation-required',
        false,
      );

    case 'INSUFFICIENT_CONTEXT':
      return decision(input, intent, 'CONTINUE_DISCOVERY', 'runtime-assigned', true);

    case 'QUOTE_OR_CONSULTATION_INTEREST':
    case 'SALES_FOLLOW_UP':
      // A proposal may be REQUESTED only when discovery is complete enough for Core to review it.
      // Anything less continues discovery instead of manufacturing a lead from guesses.
      return input.needDiscovery?.completeness === 'SUFFICIENT_FOR_CORE_REVIEW'
        ? decision(input, intent, 'PROPOSE_SALES_FOLLOW_UP', 'runtime-assigned', true)
        : decision(input, intent, 'CONTINUE_DISCOVERY', 'runtime-assigned', true);

    case 'REQUIREMENT_DISCOVERY':
    case 'PROJECT_READINESS_CLARIFICATION':
    case 'INITIAL_SERVICE_DISCOVERY':
      return input.needDiscovery?.completeness === 'HUMAN_REVIEW_REQUIRED'
        ? decision(
            input,
            intent,
            'REQUEST_HUMAN_SALES_CONTACT',
            'runtime-escalation-required',
            false,
          )
        : decision(input, intent, 'DRAFT_REPLY', 'runtime-assigned', true);
  }
}
