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
import type {
  ModelReplyAdapterResult,
  ModelReplyStructuredOutputProfile,
  ReplyStateReader,
} from '@qf-jarvis/model-reply-adapter';
import type { KnowledgeRecord } from '@qf-jarvis/governed-knowledge';
import type {
  RiyaConversationContinuityStateV1,
  RiyaConversationPhase,
} from '@qf-jarvis/riya-conversation-continuity';
import {
  createRiyaConversationModelProfile,
  createRiyaGroundedReplyModelProfile,
  RIYA_CONVERSATION_EVOLUTION_TASK_CLASS,
  RIYA_GROUNDED_CONVERSATION_EVOLUTION_TASK_CLASS,
  RIYA_GROUNDED_REPLY_TASK_CLASS,
} from '@qf-jarvis/riya-model-interaction';
import type { RiyaGroundedKnowledgeContextV1 } from '@qf-jarvis/riya-model-interaction';
import { RIYA_COMPLETION_BUDGET_TOKENS } from '@qf-jarvis/riya-model-interaction';
import { createRiyaPromptRegistryV1 } from '@qf-jarvis/riya-prompts';
import {
  RIYA_CLIENT_SALES_PROMPT_ID,
  RIYA_CLIENT_SALES_PROMPT_VERSION,
} from '@qf-jarvis/riya-prompts';

import {
  CANDIDATE_CAPABILITY_PROFILE_REF,
  CANDIDATE_POLICY_REVISION,
  CANDIDATE_RELEASE,
} from './candidate-release.js';
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
 * Project ADMITTED governed records into the exact public Riya grounded-context shape.
 *
 * The input is what `retrieveGovernedKnowledge` RETURNED, never the candidate input object — a record
 * the production authority refused has nothing to project, because it never reaches this function.
 *
 * Five fields cross, and only five. `contentFormat` is mapped back from the governed vocabulary to
 * the wire value the Riya context declares. Nothing about lifecycle, permissions, approval, owner,
 * source or supersession travels: that is governance metadata about who may see the record, and a
 * model that could read it could describe it to a client.
 */
export function toGroundedContext(
  records: readonly KnowledgeRecord[],
): RiyaGroundedKnowledgeContextV1 | undefined {
  if (records.length === 0) {
    return undefined;
  }
  return Object.freeze({
    version: 1 as const,
    records: Object.freeze(
      records.map((record) =>
        Object.freeze({
          knowledgeId: record.knowledgeId,
          version: record.version,
          topic: record.topic,
          contentFormat: record.contentFormat === 'PLAIN_TEXT' ? 'text/plain' : 'text/markdown',
          content: record.content,
        }),
      ),
    ),
  });
}

/**
 * What one evaluation turn needs to know. Situation only — no expectation of any kind.
 *
 * `admittedKnowledge` is what the PRODUCTION authority returned, already. The turn does not re-decide
 * admission and has no access to the candidate input's lifecycle state, so a refused record cannot
 * reach a model through this path even by mistake.
 */
export interface RiyaTurnRequest {
  readonly caseId: string;
  readonly syntheticUserText: string;
  readonly phase: RiyaConversationPhase;
  readonly dataClass: 'HOSTED_ALLOWED' | 'LOCAL_ONLY' | 'HUMAN_ONLY';
  readonly humanTakeoverActive: boolean;
  readonly admittedKnowledge?: readonly KnowledgeRecord[] | undefined;
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
/**
 * The structured-output profile ONE evaluation turn runs under, and the context it was built from.
 *
 * `profile.projectStructuredResult` is the PRODUCTION acceptance authority for a Riya answer. It is
 * emphatically not `structuredSchema.safeParse` — that is only the first stage. After the wire shape
 * parses, the profile still checks grounded citations, rebuilds the observation batch through
 * `createRiyaConversationObservationBatch` (which enforces the combined duplicate, conflict and limit
 * invariants), checks every asserted service and location ref against the availability snapshot, runs
 * `evolveRiyaConversation` and checks the PROSPECTIVE state, and finally requires the model's claimed
 * next-question plan to agree exactly with the reducer's — phase and field order included.
 *
 * A document can pass the wire schema and fail every one of those.
 */
export interface RiyaEvaluationProfile {
  readonly taskClass: string;
  readonly current: RiyaConversationContinuityStateV1;
  /** The context the model would be shown, or `undefined` on an ungrounded turn. */
  readonly grounded: RiyaGroundedKnowledgeContextV1 | undefined;
  readonly profile: ModelReplyStructuredOutputProfile;
}

/**
 * Build the EXACT profile an evaluation turn for this request runs under.
 *
 * ### Why this is a function rather than four lines inside the turn
 *
 * POST-MD120B3 the Responses endpoint differential has to answer a question no earlier gate asked:
 * not "did the provider accept the request" but "is what came back a usable Riya reply". Only
 * `projectStructuredResult` can answer that, and it is meaningless unless it is bound to the SAME
 * continuity state, the SAME availability snapshot and the SAME grounded source the turn would use.
 *
 * Reconstructing that context beside the turn would be a second opinion about what production
 * accepts, which is exactly the class of approximation `diagnostic-canary-materials.ts` exists to
 * refuse for the request. So there is ONE construction site and both callers go through it.
 *
 * Pure: no provider, no credential, no network, no clock. Two calls with the same request produce
 * independent but identically-configured profiles — shared construction authority is the property,
 * not shared instances.
 */
export function createRiyaEvaluationProfile(request: RiyaTurnRequest): RiyaEvaluationProfile {
  const grounded = toGroundedContext(request.admittedKnowledge ?? []);
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

  return Object.freeze({ taskClass, current, grounded, profile });
}

export async function runRiyaEvaluationTurn(
  request: RiyaTurnRequest,
  deps: RiyaTurnDeps,
): Promise<RiyaTurnOutcome> {
  // The ONE profile-construction site. A diagnostic capture calls the same function with the same
  // request, so "the capture validates through the profile this turn ran under" is a property of the
  // code rather than a claim in a comment.
  const { taskClass, current, grounded, profile } = createRiyaEvaluationProfile(request);

  const release: ModelReleaseRef = CANDIDATE_RELEASE;

  const adapter = createModelReplyAdapter({
    release,
    // The GOVERNED capability profile, not the release id. Both are strings and both typecheck; only
    // one names the reviewed statement about what this model can actually do.
    capabilityProfileRef: CANDIDATE_CAPABILITY_PROFILE_REF,
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
    //
    // POST-S11: and a COMPLETION budget, derived from the Riya output schema's own maxima. Without
    // it the Groq provider put its configured model ceiling — 65,536 — on the wire for every one of
    // these turns, which is the dimension S11's D1/D2 pair showed the request path is sensitive to.
    budgets: { retryBudget: 0, completionBudget: RIYA_COMPLETION_BUDGET_TOKENS },
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
