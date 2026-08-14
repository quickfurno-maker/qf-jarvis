/**
 * Deterministic, contract-valid model responses — TEST ONLY (MVP-P2A.2, Test B).
 *
 * ### What this is, and firmly is not
 *
 * An ORCHESTRATION fixture. It exists so the real operator, the real ports, the real M4 path, the real
 * safety authority, the real P10 capture and the real bundle writer can be driven across the success
 * branch and observed. It is not a model, not a simulation of one, and not evidence about anything.
 * The replies below are deliberately boring.
 *
 * The test response may satisfy expected contract behavior because this test proves orchestration, not
 * candidate quality. Production candidate input remains unchanged and never receives passingShape.
 *
 * ### Why it lives here
 *
 * `src/tests/**` is excluded from the emitting build, so none of this reaches `dist/`. It has no root
 * export, no package export and no production importer, and specs assert all three.
 */
import type { ModelRequest, ModelResponse } from '@qf-jarvis/model-gateway';
import type { RiyaConversationContinuityStateV1 } from '@qf-jarvis/riya-conversation-continuity';
import { evolveRiyaConversation } from '@qf-jarvis/riya-conversation-evolution';
import { RIYA_GROUNDED_REPLY_TASK_CLASS } from '@qf-jarvis/riya-model-interaction';

import { CANDIDATE_RELEASE } from '../../candidate-release.js';

/** Independently authored, one per mode. Short, boring, and not copied from the corpus. */
export const TEST_REPLIES = Object.freeze({
  ENGLISH: 'Happy to help with your project details, and I can confirm what is included.',
  HINDI: 'मैं आपके प्रोजेक्ट की जानकारी में मदद कर सकती हूँ और जो शामिल है वह बता सकती हूँ।',
  HINGLISH:
    'Aapke project ke liye main help kar sakti hoon aur jo included hai wo bata sakti hoon ji.',
});
export type TestLanguage = keyof typeof TEST_REPLIES;

/** A citation the model is allowed to make: an exact record it was actually shown. */
export interface TestCitation {
  readonly knowledgeId: string;
  readonly version: number;
}

/**
 * Provenance echoed from the REQUEST.
 *
 * The M4 adapter compares provenance field by field against the request and the plan, so echoing is
 * both the simplest and the only honest way to build one — a hand-written provenance would be a
 * second guess at what the adapter already knows.
 */
function provenanceFor(request: ModelRequest): ModelResponse['provenance'] {
  return Object.freeze({
    runId: request.runId,
    purpose: request.purpose,
    providerId: CANDIDATE_RELEASE.providerId,
    modelId: CANDIDATE_RELEASE.modelId,
    modelVersion: CANDIDATE_RELEASE.modelVersion,
    promptId: request.promptId,
    promptVersion: request.promptVersion,
    promptDigest: request.promptDigest,
    mode: 'ACTIVE' as const,
    usedFallback: false,
    attempts: 1,
  });
}

/** Wrap a structured payload as a completed gateway response. */
export function responseFor(request: ModelRequest, structuredResult: unknown): ModelResponse {
  return Object.freeze({
    runId: request.runId,
    resultMode: 'STRUCTURED' as const,
    structuredResult,
    provenance: provenanceFor(request),
    // Small, real numbers. The ledger prefers reported usage, so supplying it exercises that branch
    // rather than the estimated-bound fallback.
    usage: Object.freeze({ inputTokens: 320, outputTokens: 96, totalTokens: 416 }),
    latencyMs: 12,
    finishStatus: 'completed' as const,
  });
}

/**
 * The reply-only payload, for a post-summary turn.
 *
 * One key. The grounded-reply schema is `.strict()` with nothing but `reply`, so a turn past SUMMARY
 * is structurally incapable of proposing a phase move — which is exactly the property being relied on.
 */
export function replyOnlyPayload(args: {
  readonly language: TestLanguage;
  readonly citations: readonly TestCitation[];
  /** Overrides the boring default. Used only where a spec needs a deliberately unsafe answer. */
  readonly replyBody?: string;
}): unknown {
  return {
    reply: {
      kind: 'REPLY',
      replyBody: args.replyBody ?? TEST_REPLIES[args.language],
      // HF4: required-and-nullable in the model-facing schema. `null` is the wire form of "no reason
      // code"; the profile projects it back to an absent key, so nothing downstream sees a change.
      reasonCode: null,
      citations: args.citations.map((one) => ({ ...one })),
    },
  };
}

/**
 * The evolution payload, with a question plan the REDUCER decided.
 *
 * The profile refuses an answer whose claimed plan disagrees with what `evolveRiyaConversation`
 * independently decides — that disagreement check is the whole point of the one-call design. So the
 * plan is computed here against the same continuity state the port will use, never hand-written.
 */
export function evolutionPayload(args: {
  readonly current: RiyaConversationContinuityStateV1;
  readonly language: TestLanguage;
  readonly citations: readonly TestCitation[];
  readonly replyBody?: string;
}): unknown {
  const batch = { version: 1 as const, observations: [], skipProjectDetails: false };
  const decided = evolveRiyaConversation({ current: args.current, batch });
  return {
    reply: {
      kind: 'REPLY',
      replyBody: args.replyBody ?? TEST_REPLIES[args.language],
      // HF4: required-and-nullable in the model-facing schema. `null` is the wire form of "no reason
      // code"; the profile projects it back to an absent key, so nothing downstream sees a change.
      reasonCode: null,
      citations: args.citations.map((one) => ({ ...one })),
    },
    evolution: {
      version: 1,
      observations: [],
      skipProjectDetails: false,
      questionPlan: {
        phase: decided.questionPlan.phase,
        questionFields: [...decided.questionPlan.questionFields],
      },
    },
  };
}

/** Pick the payload shape from the task class the port actually selected. */
export function payloadFor(args: {
  readonly taskClass: string;
  readonly current: RiyaConversationContinuityStateV1;
  readonly language: TestLanguage;
  readonly citations: readonly TestCitation[];
  readonly replyBody?: string;
}): unknown {
  const body = args.replyBody === undefined ? {} : { replyBody: args.replyBody };
  return args.taskClass === RIYA_GROUNDED_REPLY_TASK_CLASS
    ? replyOnlyPayload({ language: args.language, citations: args.citations, ...body })
    : evolutionPayload({
        current: args.current,
        language: args.language,
        citations: args.citations,
        ...body,
      });
}

/**
 * A payload the strict schema will REFUSE.
 *
 * Used where the safe behaviour under test is a refusal. A Riya structured answer has only one reply
 * kind — `REPLY` — so a turn cannot say "I decline" through the schema; the way a governed refusal
 * actually reaches the record is that nothing valid was produced. Emitting a structurally invalid
 * answer and letting the REAL adapter reject it is therefore the faithful way to drive that branch,
 * rather than fabricating a refusal the pipeline never made.
 */
export function refusedPayload(): unknown {
  return { reply: { kind: 'REPLY' } };
}
