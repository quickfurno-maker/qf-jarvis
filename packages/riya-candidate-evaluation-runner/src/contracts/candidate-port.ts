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

import { RiyaCandidateRunnerError } from './errors.js';

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

/**
 * The lifecycle situation a synthetic knowledge input puts the candidate in (MVP-P2A.2 inputs).
 *
 * ### This is EXECUTION METADATA, not a business authority
 *
 * A scenario like `STALE_OR_SUPERSEDED_FACT` cannot be executed from request text alone: "quote me the
 * old figure" is a request, and whether the record behind it is current is a property of the KNOWLEDGE,
 * not of the sentence. Without this the bridge could only block the case as `UNKNOWN`, or an adapter
 * would be tempted to manufacture a benign fact — and a manufactured fact produces an artifact
 * indistinguishable from a real measurement.
 *
 * It is deliberately NOT the production freshness policy, and nothing that serves a real turn may read
 * it. A spec proves no production package names this type. The real admission boundary belongs to the
 * runtime; this only makes the situation executable and observable.
 */
export const CANDIDATE_KNOWLEDGE_INPUT_STATES = ['CURRENT', 'STALE', 'SUPERSEDED'] as const;
export type CandidateKnowledgeInputState = (typeof CANDIDATE_KNOWLEDGE_INPUT_STATES)[number];

/**
 * One synthetic governed record, minimized to exactly what a model may be shown.
 *
 * These five fields and no others. They mirror the five a real grounded turn minimizes a governed
 * record down to, so a later live adapter translates rather than reshapes — but the type is LOCAL,
 * because widening a production contract to carry evaluation metadata is how test vocabulary becomes
 * runtime vocabulary.
 */
export interface CandidateGroundedKnowledgeRecordInput {
  readonly knowledgeId: string;
  readonly version: number;
  readonly topic: string;
  readonly contentFormat: string;
  readonly content: string;
}

/**
 * The synthetic knowledge situation for one case.
 *
 * `state` is evaluation execution metadata and MUST NOT be serialized into what the model sees. Only
 * the five record fields may become the model's grounded context. Nothing the evaluator marks with —
 * an expected citation, `requiresCitation`, a pass expectation, a severity, a required dimension —
 * appears here, and a spec asserts the exact key set.
 */
export interface CandidateGroundedKnowledgeInput {
  readonly state: CandidateKnowledgeInputState;
  readonly records: readonly CandidateGroundedKnowledgeRecordInput[];
}

/** The same 1..8 ceiling a real grounded turn enforces, restated so this input cannot exceed it. */
export const MAX_CANDIDATE_GROUNDED_RECORDS = 8;

/** The exact key set a record may carry. An extra key is a refusal, never a silent drop. */
const RECORD_KEYS: readonly string[] = [
  'knowledgeId',
  'version',
  'topic',
  'contentFormat',
  'content',
];

function boundedText(value: string, max: number): boolean {
  return value.length > 0 && value.length <= max && value === value.trim();
}

/**
 * Prove a synthetic knowledge input is well formed and bounded, or refuse.
 *
 * Hand-rolled rather than a schema library: this package depends on the two evaluation authorities and
 * two Riya contract packages and nothing else, and a validator dependency added "just for fixtures"
 * would be a dependency the live adapter inherits. The checks are the same ones the production
 * grounded-context schema applies, restated for five fields.
 */
export function createCandidateGroundedKnowledgeInput(
  input: CandidateGroundedKnowledgeInput,
): CandidateGroundedKnowledgeInput {
  const states: readonly string[] = CANDIDATE_KNOWLEDGE_INPUT_STATES;
  if (!states.includes(input.state)) {
    throw new RiyaCandidateRunnerError('KNOWLEDGE_INPUT_INVALID');
  }
  if (input.records.length === 0 || input.records.length > MAX_CANDIDATE_GROUNDED_RECORDS) {
    throw new RiyaCandidateRunnerError('KNOWLEDGE_INPUT_INVALID');
  }
  const records = input.records.map((record) => {
    const keys = Object.keys(record).sort();
    if (keys.length !== RECORD_KEYS.length || !RECORD_KEYS.every((key) => keys.includes(key))) {
      throw new RiyaCandidateRunnerError('KNOWLEDGE_INPUT_INVALID');
    }
    if (
      !/^[A-Za-z0-9._:-]{1,128}$/u.test(record.knowledgeId) ||
      !Number.isInteger(record.version) ||
      record.version < 1 ||
      record.version > 1_000_000 ||
      !boundedText(record.topic, 128) ||
      !boundedText(record.contentFormat, 64) ||
      !boundedText(record.content, 8192)
    ) {
      throw new RiyaCandidateRunnerError('KNOWLEDGE_INPUT_INVALID');
    }
    return Object.freeze({
      knowledgeId: record.knowledgeId,
      version: record.version,
      topic: record.topic,
      contentFormat: record.contentFormat,
      content: record.content,
    });
  });
  return Object.freeze({ state: input.state, records: Object.freeze(records) });
}

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
  /**
   * The synthetic knowledge situation, on the cases whose scenario is ABOUT knowledge.
   *
   * Absent on every other case, because empty benign knowledge is itself a fact nobody supplied. A
   * candidate asked to cite a source it was never given is being marked on a situation it was never
   * placed in — which is the gap this field closes.
   */
  readonly groundedKnowledge?: CandidateGroundedKnowledgeInput;
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
