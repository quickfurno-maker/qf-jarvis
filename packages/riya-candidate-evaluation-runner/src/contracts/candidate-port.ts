/**
 * The provider-neutral CANDIDATE EXECUTION PORT (MVP-P2A.1).
 *
 * ### One port, no provider
 *
 * Everything this package knows about running a candidate is behind this interface. There is no
 * `fetch`, no SDK, no endpoint, no credential and no retry here, because all of that already exists
 * in the model gateway and its Groq provider — a second copy would be a second thing to keep correct.
 * The live adapter is a later, small implementation of this port; every test in this package runs
 * against a deterministic fake.
 *
 * ### It reports FACTS, not verdicts
 *
 * The record below is what a run OBSERVABLY did: whether an invocation was admitted, what data class
 * was routed, whether the strict schema accepted the reply, which typed intents were emitted. It
 * contains no judgement — "was this safe" belongs to `@qf-jarvis/model-evaluation`, and "was this
 * good" belongs to two humans. Keeping the record factual is what stops the bridge from quietly
 * becoming a third evaluation authority.
 *
 * ### Three facts are allowed to be UNKNOWN, on purpose
 *
 * Knowledge freshness, grounded-claim status and authority treatment are runtime properties an
 * adapter may or may not be able to prove. Each has an explicit `UNKNOWN` value rather than a boolean
 * default, because a boolean would force an adapter that cannot see the fact to assert the benign
 * one. When a scenario depends on such a fact and the record says `UNKNOWN`, the case is INCOMPLETE
 * and blocks evidence — which is the honest outcome and the whole reason the tri-states exist.
 *
 * ### Hidden reasoning is discarded, never recorded
 *
 * A provider that returns reasoning metadata has it dropped at the adapter edge. There is no field
 * for it here, so it cannot be persisted, logged or evaluated. `disclosedChainOfThought` in the
 * evaluation vocabulary is about the USER-VISIBLE reply, not about whether hidden reasoning existed.
 */
import type {
  EvaluationAgentScope,
  EvaluationDataClass,
  EvaluationTaskClass,
  ObservationBusinessAction,
} from '@qf-jarvis/model-evaluation';

/** What the runtime did with a request, as a closed outcome rather than a description. */
export const CANDIDATE_EXECUTION_OUTCOMES = [
  /** The candidate produced a user-visible reply. */
  'REPLIED',
  /** The candidate declined, in the governed refusal sense. */
  'REFUSED',
  /** The turn was handed to a human instead of being answered. */
  'HANDED_OVER',
  /** The runtime refused to admit the invocation at all — routing, data class, or takeover. */
  'NOT_ADMITTED',
  /** The run was cancelled and the candidate stopped. */
  'CANCELLED',
] as const;
export type CandidateExecutionOutcome = (typeof CANDIDATE_EXECUTION_OUTCOMES)[number];

/** Knowledge freshness, as the runtime can prove it. `UNKNOWN` blocks any case that depends on it. */
export const CANDIDATE_KNOWLEDGE_USES = [
  'NONE',
  'CURRENT',
  'STALE',
  'SUPERSEDED',
  'UNKNOWN',
] as const;
export type CandidateKnowledgeUse = (typeof CANDIDATE_KNOWLEDGE_USES)[number];

/** Whether the reply made claims that require grounding. `UNKNOWN` blocks a citation case. */
export const CANDIDATE_CLAIM_KINDS = ['NO_CLAIMS', 'GROUNDED_CLAIMS', 'UNKNOWN'] as const;
export type CandidateClaimKind = (typeof CANDIDATE_CLAIM_KINDS)[number];

/** How the system treated the candidate's output. `UNKNOWN` blocks the authority case. */
export const CANDIDATE_AUTHORITY_TREATMENTS = [
  'ADVISORY_ONLY',
  'TREATED_AS_AUTHORITY',
  'UNKNOWN',
] as const;
export type CandidateAuthorityTreatment = (typeof CANDIDATE_AUTHORITY_TREATMENTS)[number];

/** A citation the candidate produced, with the version the runtime resolved it at. */
export interface CandidateCitationFact {
  readonly knowledgeId: string;
  readonly version?: number;
  /** Whether governed knowledge actually contains that id — a fabricated citation is `false`. */
  readonly known: boolean;
}

/**
 * What the bridge asks a candidate to do. Synthetic input only; never a real conversation.
 *
 * ### The situation, never the answer key
 *
 * These are the facts the real serving path would already know when it builds a turn: who is being
 * served, what kind of task it is, how the content is classified, and whether a human has the wheel.
 * A live adapter cannot exercise the scope boundary without them — telling a candidate nothing about
 * scope and then failing it for a cross-scope action would be testing a situation it was never put in.
 *
 * What is deliberately ABSENT is everything the evaluator will judge with: no `requiresRefusal`, no
 * `forbidsBusinessAction`, no `allowedToolIntents`, no `forbiddenSentinels`, no required fields, no
 * severity and no category. A candidate handed its own marking scheme is not being measured.
 */
export interface RiyaCandidateRequest {
  /** The case this execution belongs to. An identifier, never a label a reviewer would read. */
  readonly caseId: string;
  /** The synthetic client message. Content-bearing, and it stays inside the run. */
  readonly syntheticUserText: string;
  /**
   * WHOSE conversation this is — client, vendor or coordination.
   *
   * The boundary several mandatory kinds exist to test. `RIYA_VENDOR_ACTION` is a CLIENT turn asked to
   * act on a vendor; `ANISHA_CLIENT_ACTION` is the mirror. An adapter that did not know which side it
   * was on could not construct either.
   */
  readonly agentScope: EvaluationAgentScope;
  /** What kind of model call this is. The capability route depends on it. */
  readonly taskClass: EvaluationTaskClass;
  /** The data class the CASE declares. An adapter must honour it, not widen it. */
  readonly declaredDataClass: EvaluationDataClass;
  /** Whether the case simulates an active human takeover. */
  readonly humanTakeoverActive: boolean;
  /** Whether the case cancels the turn after admission. */
  readonly cancelAfterAdmission: boolean;
}

/**
 * What a run observably did.
 *
 * `replyText` is the USER-VISIBLE candidate output and nothing else. It exists because two safety
 * properties — an exact sentinel leak and an exact structured field set — can only be checked against
 * what the candidate actually said. It is never logged, never written to a content-free artifact and
 * never leaves the process except through the blinded review bundle, which goes outside the repo.
 */
export interface RiyaCandidateExecutionRecord {
  readonly caseId: string;
  readonly outcome: CandidateExecutionOutcome;
  /** How many times a provider was actually invoked. A refused route must report 0. */
  readonly providerInvocations: number;
  /** The data class the content was actually routed at, which may differ from what was declared. */
  readonly routedDataClass: EvaluationDataClass;
  /** True only if content classified HUMAN_ONLY actually reached a model. */
  readonly humanOnlyReachedModel: boolean;
  readonly humanTakeoverActive: boolean;
  /** Whether the strict reply schema accepted the output. */
  readonly structuredOutputWellFormed: boolean;
  /** The field names the accepted structured reply carried. Names only, never values. */
  readonly structuredFields: readonly string[];
  /** The user-visible reply. Empty when nothing was said. */
  readonly replyText: string;
  readonly toolIntents: readonly string[];
  readonly businessActions: readonly ObservationBusinessAction[];
  readonly citations: readonly CandidateCitationFact[];
  readonly knowledgeUse: CandidateKnowledgeUse;
  readonly claimKind: CandidateClaimKind;
  readonly authorityTreatment: CandidateAuthorityTreatment;
  /** True when the turn was cancelled and the candidate kept going anyway. */
  readonly continuedAfterCancellation: boolean;
}

/** The one thing an adapter must implement. Provider-neutral by construction. */
export interface RiyaCandidateExecutionPort {
  execute: (request: RiyaCandidateRequest) => Promise<RiyaCandidateExecutionRecord>;
}
