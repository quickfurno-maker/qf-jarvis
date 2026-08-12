/**
 * ONE evaluation turn on Riya's real serving path (MVP-P2A.2).
 *
 * Prompt registry → exact task class → real Riya structured profile → M4 adapter → existing gateway →
 * GPT-OSS 20B. There is no evaluation-only prompt, no plain chat shortcut and no second call: a
 * candidate measured through a different path is a measurement of that path.
 *
 * ### The task class comes from the SITUATION
 *
 * Which of the three governed CLIENT prompt identities serves a turn is decided by the phase and by
 * whether governed knowledge is in the payload — the same two facts the real serving path uses.
 * Deciding it from a fixture's expected output would mean the corpus chose the prompt, and a prompt
 * chosen by the answer key cannot be evidence about the prompt.
 *
 * ### `evaluationRef` and `evaluationPromptDigest` are BOTH absent
 *
 * Deliberately, and the adapter permits exactly this pair. Candidate evidence does not exist yet, so
 * there is nothing truthful to bind; supplying the smoke's ref, a placeholder or the ref this run is
 * about to produce would fabricate a governance identity. One without the other is a wiring error and
 * the adapter refuses it — which is why both are omitted rather than one being blanked.
 */
import { createHash } from 'node:crypto';

import {
  createInboundEnvelope,
  createOrchestrationContext,
  createReplyPlan,
} from '@qf-jarvis/agent-runtime';
import type { ModelReleaseRef, ReplyPlan } from '@qf-jarvis/agent-runtime';
import type { ModelGatewayInvoker } from '@qf-jarvis/model-reply-adapter';
import { createModelReplyAdapter } from '@qf-jarvis/model-reply-adapter';
import type { ModelReplyAdapterResult, ReplyStateReader } from '@qf-jarvis/model-reply-adapter';
import type { CandidateGroundedKnowledgeInput } from '@qf-jarvis/riya-candidate-evaluation-runner';
import type { RiyaConversationPhase } from '@qf-jarvis/riya-conversation-continuity';
import {
  createRiyaConversationModelProfile,
  createRiyaGroundedReplyModelProfile,
  RIYA_CONVERSATION_EVOLUTION_TASK_CLASS,
  RIYA_GROUNDED_CONVERSATION_EVOLUTION_TASK_CLASS,
  RIYA_GROUNDED_REPLY_TASK_CLASS,
} from '@qf-jarvis/riya-model-interaction';
import type { RiyaGroundedKnowledgeContextV1 } from '@qf-jarvis/riya-model-interaction';
import { createRiyaPromptRegistryV1 } from '@qf-jarvis/riya-prompts';
import {
  RIYA_CLIENT_SALES_PROMPT_ID,
  RIYA_CLIENT_SALES_PROMPT_VERSION,
} from '@qf-jarvis/riya-prompts';

import { CANDIDATE_POLICY_REVISION, CANDIDATE_RELEASE } from './candidate-release.js';
import { SYNTHETIC_AVAILABILITY, syntheticContinuityFor } from './synthetic-context.js';

/** The phases at or past `SUMMARY`, where the reply-only identity serves and no phase may move. */
const REPLY_ONLY_PHASES: readonly RiyaConversationPhase[] = Object.freeze([
  'SUMMARY',
  'CONTACT',
  'CONSENT',
  'COMPLETE',
]);

/**
 * Which governed CLIENT prompt identity serves this turn.
 *
 * Two inputs, both facts about the situation: where the conversation has reached, and whether the
 * runtime put governed knowledge in the payload. No fallback — the registry holds exactly these three
 * and a turn that matched none would be a turn nobody reviewed a prompt for.
 */
export function taskClassFor(args: {
  readonly phase: RiyaConversationPhase;
  readonly hasGroundedKnowledge: boolean;
}): string {
  if (REPLY_ONLY_PHASES.includes(args.phase)) {
    return RIYA_GROUNDED_REPLY_TASK_CLASS;
  }
  return args.hasGroundedKnowledge
    ? RIYA_GROUNDED_CONVERSATION_EVOLUTION_TASK_CLASS
    : RIYA_CONVERSATION_EVOLUTION_TASK_CLASS;
}

/**
 * Translate the bridge's synthetic input into the exact public Riya grounded-context shape.
 *
 * Only records whose lifecycle state is `CURRENT` are translatable. A `STALE` or `SUPERSEDED` record
 * reaching a hosted model is the violation the freshness scenario exists to catch, so this returns
 * `undefined` rather than a context — the caller must refuse the turn, not serialize the record.
 *
 * `state` itself is NEVER carried across: it is evaluation execution metadata, and the five fields
 * below are the whole of what a model may be shown.
 */
export function toGroundedContext(
  input: CandidateGroundedKnowledgeInput | undefined,
): RiyaGroundedKnowledgeContextV1 | undefined {
  if (input === undefined || input.state !== 'CURRENT') {
    return undefined;
  }
  return Object.freeze({
    version: 1 as const,
    records: Object.freeze(
      input.records.map((record) =>
        Object.freeze({
          knowledgeId: record.knowledgeId,
          version: record.version,
          topic: record.topic,
          contentFormat: record.contentFormat,
          content: record.content,
        }),
      ),
    ),
  });
}

/** What one evaluation turn needs to know. Situation only — no expectation of any kind. */
export interface RiyaTurnRequest {
  readonly caseId: string;
  readonly syntheticUserText: string;
  readonly phase: RiyaConversationPhase;
  readonly dataClass: 'HOSTED_ALLOWED' | 'LOCAL_ONLY' | 'HUMAN_ONLY';
  readonly humanTakeoverActive: boolean;
  readonly groundedKnowledge?: CandidateGroundedKnowledgeInput | undefined;
}

/** What the turn observably produced, plus the exact prompt identity it ran under. */
export interface RiyaTurnOutcome {
  readonly taskClass: string;
  readonly plan: ReplyPlan;
  readonly result: ModelReplyAdapterResult;
  /** The context the model was actually shown, or `undefined` on an ungrounded turn. */
  readonly grounded: RiyaGroundedKnowledgeContextV1 | undefined;
}

export interface RiyaTurnDeps {
  readonly invoker: ModelGatewayInvoker;
  /** Injected canonical-instant clock. The operator owns wall-clock reads, nothing below it does. */
  readonly clock: () => string;
  /** The adapter's OWN state-reader contract, reused rather than restated. */
  readonly stateReader: ReplyStateReader;
}

/**
 * Run one turn through the real path.
 *
 * The adapter is constructed PER TURN because the Riya profile is bound to one continuity state and
 * one availability snapshot captured for that turn — a profile reused across turns would answer the
 * second one against the first one's context. Construction is pure and reaches no provider; the ONE
 * gateway call happens inside `draftReplyDetailed`.
 */
export async function runRiyaEvaluationTurn(
  request: RiyaTurnRequest,
  deps: RiyaTurnDeps,
): Promise<RiyaTurnOutcome> {
  const grounded = toGroundedContext(request.groundedKnowledge);
  const taskClass = taskClassFor({
    phase: request.phase,
    hasGroundedKnowledge: grounded !== undefined,
  });
  const current = syntheticContinuityFor(request.phase, request.caseId);

  // The reply-only identity gets the reply-only profile, whose schema has no `evolution` key at all —
  // so a post-summary turn is structurally incapable of proposing a phase move.
  const profileArgs = {
    current,
    availabilitySnapshot: SYNTHETIC_AVAILABILITY,
    ...(grounded === undefined ? {} : { groundedKnowledgeSource: () => grounded }),
  };
  const profile =
    taskClass === RIYA_GROUNDED_REPLY_TASK_CLASS
      ? createRiyaGroundedReplyModelProfile(profileArgs)
      : createRiyaConversationModelProfile(profileArgs);

  const release: ModelReleaseRef = CANDIDATE_RELEASE;

  const adapter = createModelReplyAdapter({
    release,
    capabilityProfileRef: CANDIDATE_RELEASE.releaseId,
    // Per-scope bindings, CLIENT only. Riya has no VENDOR or COORDINATION prompt and inventing one
    // to make a case runnable would widen the agent rather than measure it.
    //
    // NOTE the two absent keys: `evaluationRef` and `evaluationPromptDigest`. Both omitted, which the
    // adapter accepts and which is the only truthful state before evidence exists.
    promptBindings: {
      CLIENT: {
        promptFamily: RIYA_CLIENT_SALES_PROMPT_ID,
        promptVersion: RIYA_CLIENT_SALES_PROMPT_VERSION,
      },
    },
    promptRegistry: createRiyaPromptRegistryV1(),
    structuredOutputProfile: profile,
    stateReader: deps.stateReader,
    clock: deps.clock,
    invoker: deps.invoker,
    // Restated at the request level too: the gateway is configured without fallback and every
    // request carries a zero retry budget, so neither layer can quietly acquire one.
    budgets: { retryBudget: 0 },
  });

  const context = createOrchestrationContext({
    conversationId: current.conversationId,
    tenantId: current.tenantId,
    partyType: 'CLIENT',
    dataClass: request.dataClass,
    revision: current.continuityRevision,
    humanTakeover: request.humanTakeoverActive,
  });

  const envelope = createInboundEnvelope({
    runtimeId: `run.${request.caseId}`.slice(0, 128),
    conversationId: current.conversationId,
    messageId: `msg.${request.caseId}`.slice(0, 128),
    tenantId: current.tenantId,
    channel: 'WEB',
    partyType: 'CLIENT',
    direction: 'INBOUND',
    receivedAt: deps.clock(),
    providerMessageRef: `provider.msg.${request.caseId}`.slice(0, 128),
    dataClass: request.dataClass,
    normalizedText: request.syntheticUserText,
  });

  // The real public builder, never a cast. Every identity below is checked by the adapter against its
  // own configuration, so a plan that disagreed with the port would be refused rather than sent.
  const plan = createReplyPlan({
    context,
    envelope,
    assignedActor: 'RIYA',
    modelPort: adapter,
    promptIdentity: {
      promptFamily: RIYA_CLIENT_SALES_PROMPT_ID,
      promptVersion: RIYA_CLIENT_SALES_PROMPT_VERSION,
    },
    policyRevision: CANDIDATE_POLICY_REVISION,
    taskClass,
    // The citations M2 authorized from the ONE retrieval — exactly the records the profile was given,
    // so the profile's own plan-agreement check passes on identity rather than on trust.
    //
    // `source` and `digest` are required by the kernel contract. Both are derived from the record the
    // candidate was actually shown: the source names this synthetic corpus rather than a retrieval
    // system that did not run, and the digest is SHA-256 over the exact bytes in the payload — so a
    // record whose content changed could not keep the same authorization.
    citations: (grounded?.records ?? []).map((record) => ({
      knowledgeId: record.knowledgeId,
      version: record.version,
      source: 'synthetic-evaluation-corpus',
      digest: createHash('sha256').update(record.content, 'utf8').digest('hex'),
    })),
  });

  const result = await adapter.draftReplyDetailed(plan);
  return { taskClass, plan, result, grounded };
}
