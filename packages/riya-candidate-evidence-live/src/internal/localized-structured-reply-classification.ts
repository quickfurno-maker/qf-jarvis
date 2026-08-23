/**
 * The STAGE-LOCALIZED reading of one governed structured-reply probe (POST-SFD1).
 *
 * ### The gap this closes
 *
 * SFD1's unauthorized duplicate observation came back HTTP 200 with
 * `localValidationCompleted=true` / `localValidationPassed=false`. Every classifier before this one
 * would report that as a single token — production refused the document — and stop there.
 *
 * That token cannot distinguish two findings that point in completely different directions:
 *
 * - the document failed the WIRE SHAPE the provider was asked for, which is a structured-output
 *   problem and says the provider did not honour the schema it was given; or
 * - the document passed the shape and then failed a LATER production invariant — grounded citations,
 *   the canonical observation batch, availability refs, the deterministic reducer, the prospective
 *   state, the next-question plan — which says the provider produced well-formed JSON that Riya's
 *   own rules refuse.
 *
 * The first is a provider-contract question. The second is a model-quality or prompt question. Both
 * were previously called `LOCAL_VALIDATION_FAILED`, and an owner reading that receipt could not tell
 * which investigation to open.
 *
 * ### This vocabulary is run-NEUTRAL, and deliberately owned by no consumed run
 *
 * RLD1, RBD1 and SFD1 are consumed and their vocabularies are immutable; none of them is touched or
 * extended. This is a NEW closed set for a future governed diagnostic to adopt, defined and proved
 * offline first so no live authorization is spent discovering that a classifier is wrong.
 *
 * ### It invents no validation
 *
 * Both stages come from the captured production request: `structuredWireSchema.safeParse` is the
 * gateway's own first stage, and `projectStructuredResult` is production's own acceptance authority.
 * There is no hand-written second Riya validator here and there must never be one — a shadow
 * validator would drift from production and start reporting refusals production would not make.
 *
 * Pure: no clock, no I/O, no provider, no credential.
 */
import type {
  CandidateProviderErrorCode,
  CandidateProviderErrorType,
  CandidateProviderHttpClass,
} from '../candidate-transport-observation.js';
import { isProviderAccepted, PROVIDER_OUTCOME_ROLE } from './provider-outcome-classes.js';

/** The closed conclusions a stage-localized structured-reply probe can support. */
export const LOCALIZED_STRUCTURED_REPLY_CLASSIFICATIONS = [
  /**
   * HTTP 2xx, the provider completed, the wire shape held, AND the full production projector
   * accepted the document. An answer production Riya would carry as a draft.
   */
  'STRUCTURED_REPLY_ACCEPTED',
  /**
   * HTTP 2xx and a decoded document that failed the WIRE SHAPE.
   *
   * The provider returned JSON that does not match the schema it was asked for. That is a
   * structured-output finding about the provider, not about Riya's rules — and under best-effort
   * decoding it is exactly the outcome to expect when the model is no longer constrained.
   */
  'STRUCTURED_REPLY_WIRE_SCHEMA_INVALID',
  /**
   * HTTP 2xx, the wire shape HELD, and a later production invariant refused it.
   *
   * The provider honoured the schema and Riya's own rules still say no: a citation it was never
   * shown, an observation batch violating a combined invariant, an availability ref that does not
   * exist, a next-question plan disagreeing with the deterministic reducer.
   *
   * This is the token that was previously indistinguishable from the one above, and it points at an
   * entirely different investigation.
   */
  'STRUCTURED_REPLY_POST_WIRE_PRODUCTION_INVARIANT_FAILED',
  /**
   * The provider's own `json_validate_failed` — its OUTPUT failed strict validation.
   *
   * The request was accepted and generation ran. Never a request rejection.
   */
  'STRUCTURED_REPLY_PROVIDER_OUTPUT_INVALID',
  /**
   * 400, 413 or 422 carrying any OTHER code — the provider judged the REQUEST and refused it.
   *
   * SFD1's canonical run was exactly this: HTTP 413. It says nothing about output completion.
   */
  'STRUCTURED_REPLY_PROVIDER_REQUEST_REJECTED',
  /** HTTP 429. The provider declined to process. Not a verdict. */
  'STRUCTURED_REPLY_RATE_LIMITED',
  /** Transport, capacity, cancellation or 5xx. The request never executed. */
  'STRUCTURED_REPLY_INFRA_INTERRUPTED',
  /**
   * 401, 403, 404, an ungoverned class, a 2xx that produced no readable document, or a probe that
   * never ran.
   */
  'STRUCTURED_REPLY_INCONCLUSIVE',
] as const;
export type LocalizedStructuredReplyClassification =
  (typeof LOCALIZED_STRUCTURED_REPLY_CLASSIFICATIONS)[number];

/** What one probe did, at the provider boundary and at BOTH local validation stages. Content-free. */
export interface LocalizedStructuredReplyOutcome {
  readonly providerTransportStarted: boolean;
  readonly providerHttpStatus: number;
  readonly providerHttpClass: CandidateProviderHttpClass;
  readonly providerErrorType: CandidateProviderErrorType;
  readonly providerErrorCode: CandidateProviderErrorCode;
  readonly providerCompleted: boolean;
  /** Whether the gateway's wire schema was reached at all. False unless a document came back. */
  readonly wireValidationCompleted: boolean;
  readonly wireValidationPassed: boolean;
  /** Whether the FULL production projector was reached at all. */
  readonly productionValidationCompleted: boolean;
  readonly productionValidationPassed: boolean;
}

/** The reading: one token, with the literal observed fields beside it. */
export interface LocalizedStructuredReplyAnalysis {
  readonly classification: LocalizedStructuredReplyClassification;
  readonly providerHttpStatus: number;
  readonly providerHttpClass: CandidateProviderHttpClass;
  readonly providerErrorType: CandidateProviderErrorType;
  readonly providerErrorCode: CandidateProviderErrorCode;
  readonly wireValidationCompleted: boolean;
  readonly wireValidationPassed: boolean;
  readonly productionValidationCompleted: boolean;
  readonly productionValidationPassed: boolean;
}

/**
 * Read one probe, localizing a 2xx refusal to the stage that produced it.
 *
 * The switch is exhaustive over the role map, which is total by type, so a transport class added to
 * the observation vocabulary cannot reach a verdict by falling through. There is no default branch.
 */
export function analyseLocalizedStructuredReply(
  outcome: LocalizedStructuredReplyOutcome | undefined,
): LocalizedStructuredReplyAnalysis {
  if (outcome === undefined) {
    return Object.freeze({
      classification: 'STRUCTURED_REPLY_INCONCLUSIVE' as const,
      providerHttpStatus: 0,
      providerHttpClass: 'NOT_REACHED' as const,
      providerErrorType: 'NONE' as const,
      providerErrorCode: 'NONE' as const,
      wireValidationCompleted: false,
      wireValidationPassed: false,
      productionValidationCompleted: false,
      productionValidationPassed: false,
    });
  }

  const observed = {
    providerHttpStatus: outcome.providerHttpStatus,
    providerHttpClass: outcome.providerHttpClass,
    providerErrorType: outcome.providerErrorType,
    providerErrorCode: outcome.providerErrorCode,
    wireValidationCompleted: outcome.wireValidationCompleted,
    wireValidationPassed: outcome.wireValidationPassed,
    productionValidationCompleted: outcome.productionValidationCompleted,
    productionValidationPassed: outcome.productionValidationPassed,
  };
  const result = (
    classification: LocalizedStructuredReplyClassification,
  ): LocalizedStructuredReplyAnalysis => Object.freeze({ classification, ...observed });

  if (isProviderAccepted(outcome)) {
    // A 2xx with a decoded document. WHICH stage refused is the whole point of this vocabulary.
    if (!outcome.wireValidationCompleted && !outcome.productionValidationCompleted) {
      // Neither stage ran, so nothing can be said about the document. A verdict here would be a
      // claim about a check that never happened.
      return result('STRUCTURED_REPLY_INCONCLUSIVE');
    }
    if (outcome.wireValidationCompleted && !outcome.wireValidationPassed) {
      // Stage 1 refused: the provider did not honour the shape it was asked for.
      return result('STRUCTURED_REPLY_WIRE_SCHEMA_INVALID');
    }
    if (!outcome.productionValidationCompleted) {
      // The shape held but production's authority was never consulted. Not an acceptance.
      return result('STRUCTURED_REPLY_INCONCLUSIVE');
    }
    return outcome.productionValidationPassed
      ? result('STRUCTURED_REPLY_ACCEPTED')
      : // Stage 1 held and stage 2 refused: well-formed JSON that Riya's own rules decline.
        result('STRUCTURED_REPLY_POST_WIRE_PRODUCTION_INVARIANT_FAILED');
  }

  switch (PROVIDER_OUTCOME_ROLE[outcome.providerHttpClass]) {
    case 'CONTRACT_REJECTION': {
      if (!outcome.providerTransportStarted || outcome.providerHttpStatus < 100) {
        return result('STRUCTURED_REPLY_INCONCLUSIVE');
      }
      return outcome.providerErrorCode === 'JSON_VALIDATE_FAILED'
        ? result('STRUCTURED_REPLY_PROVIDER_OUTPUT_INVALID')
        : result('STRUCTURED_REPLY_PROVIDER_REQUEST_REJECTED');
    }
    case 'RATE_LIMITED':
      return result('STRUCTURED_REPLY_RATE_LIMITED');
    case 'EXECUTION_INTERRUPTED':
      return result('STRUCTURED_REPLY_INFRA_INTERRUPTED');
    case 'NON_VERDICT_OTHER':
      return result('STRUCTURED_REPLY_INCONCLUSIVE');
    case 'ACCEPTED':
      // A 2xx whose provider did not complete — no readable structured document came back.
      return result('STRUCTURED_REPLY_INCONCLUSIVE');
  }
}
