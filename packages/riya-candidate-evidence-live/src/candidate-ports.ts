/**
 * The two candidate ports: what a REAL run observably did (MVP-P2A.2).
 *
 * ### Facts, never expectations
 *
 * Every field below is read from something that happened — an invocation counter incremented at the
 * provider boundary, the adapter's own strict-validation result, the typed structured reply. Nothing
 * consults a fixture's declared execution layer, its expected outcome or its passing shape. The
 * merged bridge already enforces that a case ran at the layer it claims; duplicating that judgement
 * here would let the operator satisfy the check by construction.
 *
 * ### Admission is decided by the situation, and by real authorities
 *
 * A `VENDOR` turn has no Riya prompt, `LOCAL_ONLY` and `HUMAN_ONLY` never reach a hosted model, an
 * active human takeover is refused by the adapter's own state gate, an erased subject is refused by
 * the same gate, and a superseded record is refused by `retrieveGovernedKnowledge`. Each of those is
 * an existing boundary being exercised — none is an operator rule written to make a case pass.
 */
import type { ModelGatewayErrorCode } from '@qf-jarvis/model-gateway';
import type { EvaluationDataClass } from '@qf-jarvis/model-evaluation';
import type {
  ModelReplyAdapterReason,
  ReplyState,
  ReplyStateReader,
} from '@qf-jarvis/model-reply-adapter';
import type {
  CandidateAuthorityTreatment,
  CandidateClaimKind,
  CandidateExecutionOutcome,
  CandidateKnowledgeUse,
  RiyaCandidateExecutionPort,
  RiyaCandidateExecutionRecord,
  RiyaCandidateRequest,
} from '@qf-jarvis/riya-candidate-evaluation-runner';
import type {
  RiyaQualityCandidatePort,
  RiyaQualityCandidateRecord,
  RiyaQualityCandidateRequest,
} from '@qf-jarvis/riya-candidate-evaluation-runner';
import type { KnowledgeRecord } from '@qf-jarvis/governed-knowledge';
import { parseRiyaModelProfileDetail } from '@qf-jarvis/riya-model-interaction';
import { evolveRiyaConversation } from '@qf-jarvis/riya-conversation-evolution';
import type { RiyaConversationPhase } from '@qf-jarvis/riya-conversation-continuity';
import { RIYA_GROUNDED_REPLY_TASK_CLASS } from '@qf-jarvis/riya-model-interaction';

import { admitGroundedInput } from './governed-grounded-input.js';
import { measureReplyLanguage } from './measurement/reply-language.js';
import { runRiyaEvaluationTurn } from './riya-turn.js';
import type { RiyaTurnDeps, RiyaTurnOutcome } from './riya-turn.js';
import { syntheticContinuityFor } from './synthetic-context.js';

/**
 * Everything a turn needs EXCEPT the conversation state.
 *
 * The state is deliberately not here. It is derived from the request by this port, so a future caller
 * cannot supply a generically-clear state and quietly erase a human takeover or a subject erasure
 * from the situation. Forgetting to map the situation is the failure mode; making it impossible to
 * pass the state in is the fix.
 */
export type BaseTurnDeps = Omit<RiyaTurnDeps, 'stateReader'>;

/** How the operator reaches a provider, and how it counts what happened. */
/**
 * One MODEL_REQUIRED case's EXECUTION facts (MVP-P2A.2 HF4).
 *
 * Deliberately separate from the HF2 evaluator diagnostics. Those say what the authority decided; this
 * says what the machinery did, which is the distinction RUN S2-B could not make: fifteen PASS and two
 * FAIL is not evidence about a model if none of the ten attempts produced a usable answer.
 *
 * Every field is closed or a count. No reply, no user text, no knowledge, no citation identity, no
 * provider body, no error message.
 */
/**
 * The gateway code, or the sentinel meaning "the gateway returned a response".
 *
 * A local alias, not a new export: nothing outside this package needs to name it, and widening the
 * gateway or adapter package API for a live-only diagnostic would be the wrong trade.
 */
export type CandidateGatewayDiagnosticCode = ModelGatewayErrorCode | 'NONE';

export interface CandidateExecutionDiagnostic {
  readonly caseId: string;
  readonly providerInvocations: number;
  readonly executionOutcome: CandidateExecutionOutcome;
  readonly gatewayInvoked: boolean;
  /**
   * The adapter's OWN closed reason. Typed as the vocabulary rather than `string` (HF4-R1): the
   * comment said "closed" while the type said "any string", and a comment is not a contract — a
   * benign constant or a raw provider message would have compiled cleanly.
   */
  readonly adapterReason: ModelReplyAdapterReason;
  /** The closed gateway code, or `NONE` when the gateway returned a response. */
  readonly gatewayErrorCode: CandidateGatewayDiagnosticCode;
  readonly structuredOutputWellFormed: boolean;
  /** A COUNT, not the names — the names are content-free but the count is what a reader needs. */
  readonly structuredFieldCount: number;
  readonly citationCount: number;
  readonly knowledgeUse: CandidateKnowledgeUse;
  readonly claimKind: CandidateClaimKind;
  readonly authorityTreatment: CandidateAuthorityTreatment;
  readonly continuedAfterCancellation: boolean;
}

export interface CandidatePortDeps {
  /** Build the per-turn dependencies. Returns `undefined` when a ceiling refuses the next call. */
  readonly turnDeps: (caseId: string) => BaseTurnDeps | undefined;
  /** Actual provider invocations observed for the last turn, read at the provider boundary. */
  readonly invocationsFor: (caseId: string) => number;
  /**
   * The cancellation-instrumented dependencies, selected ONLY when the request says the turn is
   * cancelled after admission. Never selected by case id, slug or red-team kind.
   */
  readonly cancellationTurnDeps?: (caseId: string) => BaseTurnDeps | undefined;
  /**
   * Whether the abort was ACTUALLY observed at the transport boundary for this case.
   *
   * Not a fixture expectation and not a constant. Combined with whether an accepted reply still
   * emerged, it is what makes `continuedAfterCancellation` a measurement.
   */
  readonly cancellationObservedFor?: (caseId: string) => boolean;
  /**
   * HF4, LIVE-ONLY and optional. The provider-neutral `RiyaCandidateExecutionRecord` deliberately
   * carries no adapter or gateway vocabulary, so execution facts are reported through this seam
   * instead of widening the evaluation-runner contract.
   */
  readonly onExecutionDiagnostic?: (diagnostic: CandidateExecutionDiagnostic) => void;
  /** The closed gateway error code for a case, when the gateway threw. */
  readonly gatewayErrorFor?: (caseId: string) => ModelGatewayErrorCode | undefined;
}

/**
 * The content-free state both adapter gates read.
 *
 * This is where two PRE_MODEL properties are actually enforced, by the ADAPTER rather than by this
 * file: an active human takeover and an erased subject each refuse before the gateway.
 *
 * `subjectStatus` comes from `request.subjectErased`. It used to be read out of the case IDENTIFIER,
 * which meant renaming a fixture silently changed its privacy state. An identifier is a name, never
 * execution authority.
 *
 * `cancelled` stays false even for the cancellation case: that turn IS admitted and then aborted
 * mid-flight, so pre-marking it cancelled would test the state gate instead of cancellation.
 */
export function stateReaderFor(request: RiyaCandidateRequest): ReplyStateReader {
  const state: ReplyState = Object.freeze({
    revision: 1,
    partyType: request.agentScope === 'VENDOR' ? 'VENDOR' : 'CLIENT',
    assignedActor: 'RIYA',
    dataClass: request.declaredDataClass,
    humanTakeover: request.humanTakeoverActive,
    aiPaused: false,
    cancelled: false,
    subjectStatus: request.subjectErased ? 'erased' : 'clear',
  });
  return { read: () => Promise.resolve(state) };
}

/**
 * Whether the composition can even build a Riya turn for this request.
 *
 * A `VENDOR` or `COORDINATION` scope has no configured CLIENT prompt, so no plan exists to send. This
 * is not a rule invented here: the adapter's per-scope bindings hold CLIENT only, and manufacturing a
 * plan just to have the model refuse it would test the model instead of the boundary.
 */
function riyaOwnsScope(request: RiyaCandidateRequest): boolean {
  return request.agentScope === 'CLIENT';
}

/** A hosted candidate never receives content classified below `HOSTED_ALLOWED`. */
function hostedRoutable(dataClass: EvaluationDataClass): boolean {
  return dataClass === 'HOSTED_ALLOWED';
}

/** A record was model-visible only if admission returned it AND the turn carried it. */
function knowledgeUseFor(outcome: RiyaTurnOutcome | undefined): CandidateKnowledgeUse {
  if (outcome === undefined) {
    return 'NONE';
  }
  return outcome.grounded === undefined ? 'NONE' : 'CURRENT';
}

/**
 * Grounded claims are proved MECHANICALLY or not at all.
 *
 * An accepted structured reply that cites at least one authorized record has made a grounded claim —
 * the profile refused every other combination before this point, so the citation IS the proof. Any
 * other shape is `UNKNOWN`: reading prose for confident-sounding assertions is exactly the semantic
 * guess the tri-state exists to prevent.
 */
function claimKindFor(outcome: RiyaTurnOutcome | undefined): CandidateClaimKind {
  if (!outcome?.result.ok) {
    return 'NO_CLAIMS';
  }
  const citations = outcome.result.structuredReply?.citations ?? [];
  if (citations.length > 0) {
    return 'GROUNDED_CLAIMS';
  }
  return outcome.grounded === undefined ? 'NO_CLAIMS' : 'UNKNOWN';
}

/**
 * `ADVISORY_ONLY` is a fact about this COMPOSITION, not about the reply.
 *
 * The operator holds no Core adapter, no execution dispatcher, no approval runtime and no messaging
 * seam — there is nowhere for an accepted draft to become an action. That is structural, and a spec
 * proves the package imports none of those. So every accepted output is advisory by construction.
 */
const AUTHORITY_TREATMENT: CandidateAuthorityTreatment = 'ADVISORY_ONLY';

/** Build the safety port. Every record it returns is assembled from observed facts. */
export function createSafetyCandidatePort(deps: CandidatePortDeps): RiyaCandidateExecutionPort {
  return Object.freeze({
    async execute(request: RiyaCandidateRequest): Promise<RiyaCandidateExecutionRecord> {
      const notAdmitted = (knowledgeUse: CandidateKnowledgeUse): RiyaCandidateExecutionRecord =>
        Object.freeze({
          caseId: request.caseId,
          outcome: 'NOT_ADMITTED',
          providerInvocations: 0,
          routedDataClass: request.declaredDataClass,
          humanOnlyReachedModel: false,
          humanTakeoverActive: request.humanTakeoverActive,
          structuredOutputWellFormed: false,
          structuredFields: [],
          replyText: '',
          toolIntents: [],
          businessActions: [],
          citations: [],
          knowledgeUse,
          claimKind: 'NO_CLAIMS',
          authorityTreatment: AUTHORITY_TREATMENT,
          continuedAfterCancellation: false,
        });

      // 1. Scope. Riya has one governed prompt scope and no fallback to another agent's.
      if (!riyaOwnsScope(request)) {
        return notAdmitted('NONE');
      }
      // 2. Data class. A hosted candidate is never handed LOCAL_ONLY or HUMAN_ONLY content.
      //
      // EXCEPT where the case is about an erased subject: short-circuiting there would mean the M4
      // subject gate was never exercised, and the case would prove the data-class rule twice instead
      // of proving the privacy rule once. So an erased-subject turn is BUILT and the adapter refuses
      // it, still with zero provider invocations, because the gate runs before the gateway.
      if (!hostedRoutable(request.declaredDataClass) && !request.subjectErased) {
        return notAdmitted('NONE');
      }
      // 3. Governed knowledge, decided by the PRODUCTION retrieval authority. A refusal here is the
      //    freshness boundary doing its job, and nothing reaches a model.
      let admitted: readonly KnowledgeRecord[] = [];
      if (request.groundedKnowledge !== undefined) {
        const admission = admitGroundedInput(request.groundedKnowledge, request.caseId);
        if (!admission.ok) {
          return notAdmitted('NONE');
        }
        admitted = admission.records;
      }

      // Cancellation is a REQUEST FACT. The contract already carries it, so nothing here reads a case
      // id, a slug or a red-team kind to decide how a turn behaves.
      const cancellationCase = request.cancelAfterAdmission;
      const build = cancellationCase ? (deps.cancellationTurnDeps ?? deps.turnDeps) : deps.turnDeps;
      const base = build(request.caseId);
      if (base === undefined) {
        // A ceiling refused the next call. Not a candidate verdict — no invocation happened.
        return notAdmitted(admitted.length > 0 ? 'UNKNOWN' : 'NONE');
      }

      const outcome = await runRiyaEvaluationTurn(
        {
          caseId: request.caseId,
          syntheticUserText: request.syntheticUserText,
          // Every safety case is a live client turn at the point discovery is happening.
          phase: 'NEED',
          dataClass: request.declaredDataClass,
          humanTakeoverActive: request.humanTakeoverActive,
          admittedKnowledge: admitted,
        },
        // The port owns the state, so the situation cannot be lost between here and the gate.
        { ...base, stateReader: stateReaderFor(request) },
      );

      const invocations = deps.invocationsFor(request.caseId);
      const reply = outcome.result.structuredReply;
      const accepted = outcome.result.ok && reply !== undefined;

      // The outcome is read from what the adapter DID. A turn the gateway never saw is not admitted;
      // an accepted reply is a reply; anything else the adapter refused is a governed refusal.
      const cancellationObserved =
        cancellationCase && (deps.cancellationObservedFor?.(request.caseId) ?? false);
      const executionOutcome: CandidateExecutionOutcome = !outcome.result.gatewayInvoked
        ? request.humanTakeoverActive
          ? 'HANDED_OVER'
          : 'NOT_ADMITTED'
        : cancellationObserved && !accepted
          ? 'CANCELLED'
          : accepted
            ? 'REPLIED'
            : 'REFUSED';

      const acceptedFields = reply === undefined ? [] : Object.keys(reply).sort();
      const acceptedBody = accepted ? (reply.replyBody ?? '') : '';

      const admittedKeys = new Set(
        admitted.map((record) => `${record.knowledgeId}@${String(record.version)}`),
      );

      const acceptedCitations = reply?.citations ?? [];
      deps.onExecutionDiagnostic?.({
        caseId: request.caseId,
        providerInvocations: invocations,
        executionOutcome,
        gatewayInvoked: outcome.result.gatewayInvoked,
        adapterReason: outcome.result.reason,
        gatewayErrorCode: deps.gatewayErrorFor?.(request.caseId) ?? 'NONE',
        structuredOutputWellFormed: accepted,
        structuredFieldCount: acceptedFields.length,
        citationCount: acceptedCitations.length,
        knowledgeUse: knowledgeUseFor(outcome),
        claimKind: claimKindFor(outcome),
        authorityTreatment: AUTHORITY_TREATMENT,
        continuedAfterCancellation:
          cancellationCase && (deps.cancellationObservedFor?.(request.caseId) ?? false) && accepted,
      });

      return Object.freeze({
        caseId: request.caseId,
        outcome: executionOutcome,
        providerInvocations: invocations,
        routedDataClass: request.declaredDataClass,
        // Structural: LOCAL_ONLY and HUMAN_ONLY never reach step 3, so an invocation here can only
        // ever have carried HOSTED_ALLOWED content.
        // Structurally unreachable: HUMAN_ONLY never passes step 2, so an invocation cannot have
        // carried it. Recorded as the fact it is rather than as an untested branch.
        humanOnlyReachedModel: false,
        humanTakeoverActive: request.humanTakeoverActive,
        structuredOutputWellFormed: accepted,
        structuredFields: accepted ? acceptedFields : [],
        // The user-visible body only. A governed REFUSAL carries no body, so the empty string is the
        // factual value rather than a placeholder.
        replyText: acceptedBody,
        // The Riya strict schema expresses no tool call and no business action, so an empty list is
        // the factual answer rather than an absence of checking. Inferring either from prose is the
        // guess this port refuses to make.
        toolIntents: [],
        businessActions: [],
        citations: (reply?.citations ?? []).map((citation) => ({
          knowledgeId: citation.knowledgeId,
          version: citation.version,
          // `known` is exact identity against what the AUTHORITY admitted — never a lookup in the
          // candidate input, and never a repair.
          known: admittedKeys.has(`${citation.knowledgeId}@${String(citation.version)}`),
        })),
        knowledgeUse: knowledgeUseFor(outcome),
        claimKind: claimKindFor(outcome),
        authorityTreatment: AUTHORITY_TREATMENT,
        // FACTUAL: the turn asked to be cancelled, the abort was seen at the request boundary, and a
        // user-visible reply was nevertheless accepted afterwards. Anything less is not continuation,
        // and a hard-coded `false` would have been an assumption rather than an observation.
        continuedAfterCancellation:
          cancellationCase && (deps.cancellationObservedFor?.(request.caseId) ?? false) && accepted,
      });
    },
  });
}

/** A `?`-free reply still has a language; a reply with no measurable language fails its case. */

export interface QualityPortDeps extends CandidatePortDeps {
  readonly admissionBlocked: (caseId: string) => void;
}

/**
 * Build the P10 port.
 *
 * Same release, same provider, same gateway, same prompt registry, same M4 adapter as safety — a
 * quality number produced through a different path would not describe the candidate that was cleared
 * for safety.
 */
export function createQualityCandidatePort(deps: QualityPortDeps): RiyaQualityCandidatePort {
  return Object.freeze({
    async execute(request: RiyaQualityCandidateRequest): Promise<RiyaQualityCandidateRecord> {
      const blocked = (phase: RiyaConversationPhase): RiyaQualityCandidateRecord =>
        Object.freeze({
          caseId: request.caseId,
          structuredOutputWellFormed: false,
          replyBody: '',
          // The bridge fails a case whose language cannot be identified, which is the honest outcome
          // for a turn that produced nothing to identify.
          replyLanguageMode: 'UNKNOWN' as const,
          askedDiscoveryFields: [],
          observations: [],
          skipProjectDetails: false,
          citations: [],
          continuityPhaseAfter: phase,
        });

      let admitted: readonly KnowledgeRecord[] = [];
      if (request.groundedKnowledge !== undefined) {
        const admission = admitGroundedInput(request.groundedKnowledge, request.caseId);
        if (!admission.ok) {
          deps.admissionBlocked(request.caseId);
          return blocked(request.continuityPhaseBefore);
        }
        admitted = admission.records;
      }

      const base = deps.turnDeps(request.caseId);
      if (base === undefined) {
        return blocked(request.continuityPhaseBefore);
      }
      // A P10 case has no takeover and no erased subject: the corpus governs a live client turn, and
      // inventing either would score the candidate on a situation the corpus never described.
      const stateReader: ReplyStateReader = {
        read: () =>
          Promise.resolve(
            Object.freeze({
              revision: 1,
              partyType: 'CLIENT' as const,
              assignedActor: 'RIYA' as const,
              dataClass: 'HOSTED_ALLOWED' as const,
              humanTakeover: false,
              aiPaused: false,
              cancelled: false,
              subjectStatus: 'clear' as const,
            }),
          ),
      };

      const outcome = await runRiyaEvaluationTurn(
        {
          caseId: request.caseId,
          syntheticUserText: request.syntheticUserText,
          phase: request.continuityPhaseBefore,
          dataClass: 'HOSTED_ALLOWED',
          humanTakeoverActive: false,
          admittedKnowledge: admitted,
        },
        { ...base, stateReader },
      );

      const reply = outcome.result.structuredReply;
      if (!outcome.result.ok || reply?.replyBody === undefined) {
        return blocked(request.continuityPhaseBefore);
      }

      const replyBody: string = reply.replyBody;

      // Reply-only turns carry NO evolution detail, and the phase does not move. That is the
      // schema's guarantee rather than a rule applied here: the grounded-reply schema has no
      // `evolution` key at all.
      if (outcome.taskClass === RIYA_GROUNDED_REPLY_TASK_CLASS) {
        return Object.freeze({
          caseId: request.caseId,
          structuredOutputWellFormed: true,
          replyBody: replyBody,
          replyLanguageMode: measureReplyLanguage(replyBody),
          askedDiscoveryFields: [],
          observations: [],
          skipProjectDetails: false,
          citations: reply.citations.map((one) => ({
            knowledgeId: one.knowledgeId,
            version: one.version,
          })),
          continuityPhaseAfter: request.continuityPhaseBefore,
        });
      }

      // Evolution turns: the canonical batch comes through the PUBLIC guard, never a cast of the
      // generic `unknown` seam.
      const detail = parseRiyaModelProfileDetail(outcome.result.profileDetail);
      if (detail === undefined) {
        return blocked(request.continuityPhaseBefore);
      }

      // The phase after is decided by the Riya EVOLUTION AUTHORITY from the accepted batch. The model
      // returned a claimed plan and the profile already checked it; re-deriving here means the
      // captured phase is the reducer's, not the model's.
      const decided = evolveRiyaConversation({
        current: syntheticContinuityFor(request.continuityPhaseBefore, request.caseId),
        batch: detail.observationBatch,
      });

      return Object.freeze({
        caseId: request.caseId,
        structuredOutputWellFormed: true,
        replyBody: replyBody,
        replyLanguageMode: measureReplyLanguage(replyBody),
        askedDiscoveryFields: decided.questionPlan.questionFields,
        observations: detail.observationBatch.observations,
        skipProjectDetails: detail.observationBatch.skipProjectDetails,
        citations: reply.citations.map((one) => ({
          knowledgeId: one.knowledgeId,
          version: one.version,
        })),
        continuityPhaseAfter: decided.state.phase,
      });
    },
  });
}
