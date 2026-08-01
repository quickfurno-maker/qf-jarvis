/**
 * The Anisha vendor-journey turn decision (QFJ-S3-D-A, ADR-0070).
 *
 * One deterministic function. It reads validated context and returns what SHOULD happen; it does not
 * make it happen. It calls no model, creates no proposal object, mutates nothing, and reaches no
 * transport — the merged pipeline (ADR-0055/0057/0059/0068) owns all of that, and this decision is an
 * input to it.
 *
 * The role boundary is enforced HERE, before anything else, because that is what makes "zero model
 * calls on a role violation" a structural property rather than a hope: a CLIENT turn is refused while
 * it is still data, long before the orchestrator would reach a port.
 *
 * `ANISHA` and `VENDOR` are not parameters. A caller cannot ask this module to act as another agent or
 * on another party type, which is the whole point of a role-bounded agent.
 */
import { AI_AGENT_ACTORS } from '@qf-jarvis/agent-runtime';
import type { RuntimeActor, RuntimePartyType, RuntimeReason } from '@qf-jarvis/agent-runtime';
import { z } from 'zod';

import { AnishaBehaviourError } from '../contracts/errors.js';
import { createVendorJourneyContext } from '../contracts/vendor-journey-context.js';
import type {
  VendorJourneyContext,
  VendorJourneyContextCompleteness,
  VendorJourneyContextField,
} from '../contracts/vendor-journey-context.js';
import {
  ANISHA_BEHAVIOUR_VERSION,
  classifyVendorJourneyIntent,
  isVendorJourneySignals,
} from '../contracts/vendor-journey-intent.js';
import type {
  AnishaBehaviourVersion,
  PackageReadinessBand,
  VendorJourneyIntent,
  VendorJourneySignals,
} from '../contracts/vendor-journey-intent.js';

/** The actor this package speaks as. Fixed, never a parameter. */
export const ANISHA_ACTOR = 'ANISHA' as const satisfies RuntimeActor;
/** The party type this package may serve. Fixed, never a parameter. */
export const ANISHA_SUPPORTED_PARTY = 'VENDOR' as const satisfies RuntimePartyType;

/**
 * What Anisha concluded the turn should lead to.
 *
 * Deliberately NOT a replacement for `OrchestrationResult` — that shape is owned by ADR-0055. This is
 * the narrower question "what should this vendor-journey turn do next?".
 */
export const ANISHA_DISPOSITIONS = [
  /** Draft a vendor-facing informational or acknowledgement reply through the merged model boundary. */
  'DRAFT_REPLY',
  /** Reply, but only to continue gathering context — nothing may be proposed yet. */
  'CONTINUE_CLARIFICATION',
  /** Request a Core-reviewed vendor follow-up. Never an approval, recharge or payment. */
  'PROPOSE_VENDOR_FOLLOW_UP',
  /**
   * Request escalation-required handling.
   *
   * Deliberately TARGET-NEUTRAL. Governance routes escalation to Jarvis; the merged M2 vocabulary
   * offers `ESCALATE_TO_HUMAN`. A behaviour kernel that named either would be asserting which
   * coordinator or person executes — a routing decision this package does not own and cannot see.
   * It states the need; S3-D-B maps it.
   */
  'REQUEST_VENDOR_ESCALATION',
  /** Decline safely. No model, no proposal. */
  'REFUSE',
] as const;
export type AnishaDisposition = (typeof ANISHA_DISPOSITIONS)[number];

export const ANISHA_DISPOSITIONS_FROZEN: readonly AnishaDisposition[] = Object.freeze([
  ...ANISHA_DISPOSITIONS,
]);

/** A bounded, versioned, opaque prompt reference. S3-I resolves it; this package never renders it. */
const PROMPT_REF = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9._:-]+$/);

export interface AnishaTurnInput {
  readonly partyType: RuntimePartyType;
  /** The actor that currently owns the conversation, when one is assigned. */
  readonly currentActor?: RuntimeActor;
  readonly signals: VendorJourneySignals;
  readonly context?: VendorJourneyContext;
  /** Opaque, versioned. Never prompt text. */
  readonly promptRef: string;
  readonly humanTakeover: boolean;
  readonly aiPaused: boolean;
}

/** A frozen decision. It carries no instruction that could be executed. */
export interface AnishaTurnDecision {
  readonly behaviourVersion: AnishaBehaviourVersion;
  readonly actor: typeof ANISHA_ACTOR;
  readonly intent: VendorJourneyIntent;
  readonly disposition: AnishaDisposition;
  readonly context: VendorJourneyContext | undefined;
  /**
   * Whether the merged model-reply boundary MAY be invoked for this turn.
   *
   * An eligibility decision, not a budget enforcer. It does not — and cannot — enforce process-wide
   * at-most-one invocation; that remains owned by the merged `orchestrateInbound` pipeline and the
   * `ModelReplyPort` / model-reply-adapter contracts (ADR-0055/0057). What this package guarantees is
   * narrower and structural: it invokes nothing itself, and it returns `false` on every pause,
   * takeover, role-violation, escalation and refusal path.
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
    context: z.unknown().optional(),
    promptRef: PROMPT_REF,
    humanTakeover: z.boolean(),
    aiPaused: z.boolean(),
  })
  .strict();

/**
 * Build one frozen decision.
 *
 * `context` is passed EXPLICITLY rather than read off `input`, so the canonical record is the only
 * one that can reach a decision. Reading `input.context` here is exactly the mistake this shape
 * prevents.
 */
function decision(
  input: AnishaTurnInput,
  context: VendorJourneyContext | undefined,
  intent: VendorJourneyIntent,
  disposition: AnishaDisposition,
  reason: RuntimeReason,
  modelReplyEligible: boolean,
): AnishaTurnDecision {
  return Object.freeze({
    behaviourVersion: ANISHA_BEHAVIOUR_VERSION,
    actor: ANISHA_ACTOR,
    intent,
    disposition,
    context,
    modelReplyEligible,
    reason,
    promptRef: input.promptRef,
  });
}

/** The exact own keys a materialized `VendorJourneyContext` carries. Every one, and nothing else. */
const MATERIALIZED_CONTEXT_KEYS = [
  'behaviourVersion',
  'vendorStageRef',
  'onboardingStepRef',
  'verificationStatusRef',
  'packageReadinessBand',
  'completeness',
  'missingFields',
] as const;

/**
 * Canonicalize a supplied context, returning a fresh constructor-created record.
 *
 * The caller already built one, but re-running the constructor re-checks every bound and every
 * contradiction rule, and — crucially — the value this RETURNS is what the decision carries. An
 * earlier version validated and then discarded the result, so a caller's own mutable object travelled
 * out on the decision while the frozen canonical one was thrown away. Validating one object and
 * forwarding a different one is not a boundary.
 *
 * The own-key set is checked exactly, including `behaviourVersion`. A forged record with a bogus
 * version or an extra key would otherwise have its recognised fields reconstructed successfully and
 * then be returned verbatim; refusing it is cheaper than reasoning about what else it carried. A key
 * whose value is legitimately `undefined` must still be PRESENT, because that is what the constructor
 * materializes and the shape is exact rather than merely sufficient.
 *
 * Every failure here — including one raised by the constructor — is normalized to
 * `invalid-turn-input`. The lower-level `invalid-vendor-journey-context` belongs to callers of
 * `createVendorJourneyContext` directly; leaking it through the turn boundary would report the wrong
 * contract and name an internal step the caller never invoked.
 */
function revalidated(supplied: unknown): VendorJourneyContext {
  // Typed as `unknown` deliberately. The declared parameter type says this is already a
  // `VendorJourneyContext`, which is exactly the assumption a forged object breaks — and a guard the
  // compiler believes is unreachable is a guard that gets deleted. At a trust boundary the runtime
  // shape is the only thing that is actually known.
  if (typeof supplied !== 'object' || supplied === null || Array.isArray(supplied)) {
    throw new AnishaBehaviourError('invalid-turn-input');
  }
  const candidate = supplied as Record<string, unknown>;
  const keys = Object.keys(candidate);
  if (
    keys.length !== MATERIALIZED_CONTEXT_KEYS.length ||
    !MATERIALIZED_CONTEXT_KEYS.every((key) => keys.includes(key))
  ) {
    throw new AnishaBehaviourError('invalid-turn-input');
  }
  if (candidate['behaviourVersion'] !== ANISHA_BEHAVIOUR_VERSION) {
    throw new AnishaBehaviourError('invalid-turn-input');
  }
  try {
    // Every value below is re-validated by the constructor's own schema, so passing them through
    // unchecked here is safe: an invalid one becomes a refusal, never a repair.
    return createVendorJourneyContext({
      ...(candidate['vendorStageRef'] === undefined
        ? {}
        : { vendorStageRef: candidate['vendorStageRef'] as string }),
      ...(candidate['onboardingStepRef'] === undefined
        ? {}
        : { onboardingStepRef: candidate['onboardingStepRef'] as string }),
      ...(candidate['verificationStatusRef'] === undefined
        ? {}
        : { verificationStatusRef: candidate['verificationStatusRef'] as string }),
      ...(candidate['packageReadinessBand'] === undefined
        ? {}
        : { packageReadinessBand: candidate['packageReadinessBand'] as PackageReadinessBand }),
      completeness: candidate['completeness'] as VendorJourneyContextCompleteness,
      missingFields: candidate['missingFields'] as readonly VendorJourneyContextField[],
    });
  } catch {
    throw new AnishaBehaviourError('invalid-turn-input');
  }
}

/** True when the turn must go to a person before anything else happens. */
function needsHumanReview(context: VendorJourneyContext | undefined): boolean {
  return context?.completeness === 'HUMAN_REVIEW_REQUIRED';
}

/**
 * Decide one Anisha vendor-journey turn.
 *
 * Throws `AnishaBehaviourError('invalid-turn-input')` on structurally invalid input, on an invalid
 * context, or when the signals and the context disagree about the readiness band. Otherwise it always
 * returns a decision — a refusal is a decision, not an exception.
 *
 * Gate order is load-bearing and mirrors the merged pipeline's own precedence: pause and takeover
 * outrank everything, then the role boundary, then intent. Each early gate returns
 * `modelReplyEligible: false`, which is what guarantees no model is reached on those paths.
 */
export function decideAnishaTurn(input: AnishaTurnInput): AnishaTurnDecision {
  const parsed = turnInputSchema.safeParse(input);
  if (!parsed.success || !isVendorJourneySignals(input.signals)) {
    throw new AnishaBehaviourError('invalid-turn-input');
  }
  // Canonicalize once. Everything downstream reads THIS value, never `input.context`, so the
  // caller's own object can neither be trusted nor returned.
  const validatedContext = input.context === undefined ? undefined : revalidated(input.context);

  if (validatedContext !== undefined) {
    // Two sources naming the same money-adjacent band must agree. Repairing a disagreement, or
    // silently preferring one side, would mean deciding a vendor's package position from a value
    // nobody reconciled — the exact failure the band rule exists to prevent.
    const signalBand = input.signals.packageReadinessBand;
    const contextBand = validatedContext.packageReadinessBand;
    if (signalBand !== undefined && contextBand !== undefined && signalBand !== contextBand) {
      throw new AnishaBehaviourError('invalid-turn-input');
    }
  }

  if (input.currentActor !== undefined && !AI_AGENT_ACTORS.has(input.currentActor)) {
    // HUMAN or SYSTEM already owns the turn; Anisha does not take it back on her own.
    return decision(
      input,
      validatedContext,
      'INSUFFICIENT_CONTEXT',
      'REFUSE',
      'runtime-human-takeover',
      false,
    );
  }
  if (input.aiPaused) {
    return decision(
      input,
      validatedContext,
      'INSUFFICIENT_CONTEXT',
      'REFUSE',
      'runtime-ai-paused',
      false,
    );
  }
  if (input.humanTakeover) {
    return decision(
      input,
      validatedContext,
      'INSUFFICIENT_CONTEXT',
      'REFUSE',
      'runtime-human-takeover',
      false,
    );
  }
  // The role boundary, refused while this is still data.
  if (input.partyType !== ANISHA_SUPPORTED_PARTY) {
    return decision(
      input,
      validatedContext,
      'INSUFFICIENT_CONTEXT',
      'REFUSE',
      'runtime-scope-violation',
      false,
    );
  }
  if (input.currentActor !== undefined && input.currentActor !== ANISHA_ACTOR) {
    // Another AI agent owns it. Coordination is Jarvis's job, not Anisha's.
    return decision(
      input,
      validatedContext,
      'INSUFFICIENT_CONTEXT',
      'REFUSE',
      'runtime-scope-violation',
      false,
    );
  }

  const intent = classifyVendorJourneyIntent(input.signals);
  const escalate = (): AnishaTurnDecision =>
    decision(
      input,
      validatedContext,
      intent,
      'REQUEST_VENDOR_ESCALATION',
      'runtime-escalation-required',
      false,
    );

  switch (intent) {
    case 'UNSUPPORTED_NON_VENDOR_REQUEST':
      return decision(
        input,
        validatedContext,
        intent,
        'REFUSE',
        'runtime-escalation-required',
        false,
      );

    case 'ESCALATION_REQUIRED_MATTER':
    case 'HUMAN_VENDOR_SUPPORT_REQUEST':
      return escalate();

    case 'COMPLAINT_INTAKE':
      // Acknowledge and intake only. Resolving a complaint is Core's, and a reply that promised a
      // resolution would be an outcome this agent has no authority to deliver.
      return needsHumanReview(validatedContext)
        ? escalate()
        : decision(input, validatedContext, intent, 'DRAFT_REPLY', 'runtime-assigned', true);

    case 'PACKAGE_OR_RECHARGE_READINESS':
      if (needsHumanReview(validatedContext)) {
        return escalate();
      }
      // A follow-up may be REQUESTED only on a snapshot Core can actually review. Absent context is
      // not sufficient context, so it continues clarification rather than proposing from a guess.
      return validatedContext?.completeness === 'SUFFICIENT_FOR_CORE_REVIEW'
        ? decision(
            input,
            validatedContext,
            intent,
            'PROPOSE_VENDOR_FOLLOW_UP',
            'runtime-assigned',
            true,
          )
        : decision(
            input,
            validatedContext,
            intent,
            'CONTINUE_CLARIFICATION',
            'runtime-assigned',
            true,
          );

    case 'ONBOARDING_OR_PROFILE_GUIDANCE':
    case 'LEAD_RESPONSE_GUIDANCE':
    case 'ROUTINE_VENDOR_QUERY':
      return needsHumanReview(validatedContext)
        ? escalate()
        : decision(input, validatedContext, intent, 'DRAFT_REPLY', 'runtime-assigned', true);

    case 'INSUFFICIENT_CONTEXT':
      return decision(
        input,
        validatedContext,
        intent,
        'CONTINUE_CLARIFICATION',
        'runtime-assigned',
        true,
      );
  }
}
