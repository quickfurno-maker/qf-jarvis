/**
 * The reading of ONE Groq Responses API strict endpoint-differential probe (POST-MD120B3).
 *
 * ### Why a separate vocabulary, and why it duplicates no HTTP logic
 *
 * The tokens differ because the QUESTION differs. `STRICT_120B_ACCEPTED` said a different MODEL took
 * the request; `RESPONSES_20B_STRICT_ACCEPTED` says a different ENDPOINT took it, on the same model
 * that refused it. Reporting the second in the first's words would lose the only thing this run
 * measures.
 *
 * The HTTP reading is identical and is NOT re-implemented. Every branch switches on
 * {@link PROVIDER_OUTCOME_ROLE} — the same total, reviewed role map the model differential and the
 * representative classifier both use — so the three cannot drift, and the allowlist that keeps
 * 401/403/404 out of "rejection" applies here for free.
 *
 * ### The token this vocabulary has that the others do not
 *
 * `RESPONSES_20B_STRICT_LOCAL_VALIDATION_FAILED`.
 *
 * Every earlier gate could stop at the provider boundary, because every earlier gate was asking
 * whether the provider would ACCEPT the request. This one is asking whether a different output
 * contract produces a usable Riya reply, and those are not the same question: a 2xx from an endpoint
 * whose document does not satisfy Riya's canonical schema is a WORSE outcome than a 400, because it
 * looks like success. `json_validate_failed` on Chat Completions is at least the provider saying so
 * out loud.
 *
 * So local validation is a first-class result rather than a footnote, and it is deliberately NOT
 * collapsed into provider rejection: the provider did not reject anything, and filing it as though it
 * had would send the next reader to audit a request the endpoint accepted.
 *
 * ### The entitlement trap, in its endpoint form
 *
 * The governed staging smoke runs against the 20B CHAT COMPLETIONS configuration. It proves the
 * credential works on that contract; it does NOT prove the project may call `/openai/v1/responses`,
 * which Groq currently ships as beta. So an entitlement, enrolment or routing answer — 401, 403, 404,
 * or a class nobody has governed — is `RESPONSES_20B_STRICT_INCONCLUSIVE`, never a verdict about the
 * endpoint's handling of the request.
 *
 * Reading "this project cannot reach the Responses API" as "the Responses API also rejects our
 * schema" would retire the differential on evidence that never touched it.
 *
 * Pure: no clock, no I/O, no provider, no credential.
 */
import type {
  CandidateProviderErrorCode,
  CandidateProviderErrorType,
  CandidateProviderHttpClass,
} from '../candidate-transport-observation.js';
import { isProviderAccepted, PROVIDER_OUTCOME_ROLE } from './provider-outcome-classes.js';

/** The closed conclusions ONE Responses differential probe can support. */
export const RESPONSES_DIFFERENTIAL_CLASSIFICATIONS = [
  /**
   * HTTP 2xx, the provider completed, AND the local canonical validator accepted the document.
   *
   * The neutral production-built request that Chat Completions refused on both GPT-OSS models was
   * taken by the Responses API, once, and what came back is a valid Riya reply. That is an endpoint
   * differential and nothing more: not a release decision, not a migration, not a quality verdict,
   * not safety, not P10 eligibility, and not evidence about any other request. The endpoint is beta.
   */
  'RESPONSES_20B_STRICT_ACCEPTED',
  /**
   * 400, 413 or 422 — the provider judged the request and refused it.
   *
   * If this carries `JSON_VALIDATE_FAILED`, the strict-output failure is reproduced across BOTH
   * governed models AND both documented output contracts, and the next decision is an offline
   * output-contract strategy rather than another run. Literal type and code travel with it,
   * uninterpreted.
   */
  'RESPONSES_20B_STRICT_PROVIDER_REJECTED',
  /** HTTP 429. The provider declined to process. Not a verdict. */
  'RESPONSES_20B_STRICT_RATE_LIMITED',
  /** Transport, capacity, cancellation or 5xx. The request never executed. */
  'RESPONSES_20B_STRICT_INFRA_INTERRUPTED',
  /**
   * 401, 403, 404, an ungoverned class, or a probe that never ran.
   *
   * Most likely an ENTITLEMENT or BETA-ENROLMENT answer: the smoke checked a Chat Completions
   * configuration and cannot establish that this project may call the Responses API at all. It says
   * nothing about the request contract.
   */
  'RESPONSES_20B_STRICT_INCONCLUSIVE',
  /**
   * HTTP 2xx and a decoded document, which the LOCAL canonical validator then rejected.
   *
   * The provider accepted the request and returned something. It is not a Riya reply. Distinct from
   * `PROVIDER_REJECTED` because nobody rejected anything at the provider, and distinct from
   * `ACCEPTED` because the endpoint did not produce a usable result — a two-token collapse in either
   * direction would misdirect the next decision.
   */
  'RESPONSES_20B_STRICT_LOCAL_VALIDATION_FAILED',
] as const;
export type ResponsesDifferentialClassification =
  (typeof RESPONSES_DIFFERENTIAL_CLASSIFICATIONS)[number];

/**
 * What the ONE probe did, at the provider boundary AND at the local validator. Content-free.
 *
 * `localValidationCompleted` and `localValidationPassed` are two booleans rather than one tri-state
 * because they answer two different questions: whether the validator ever ran (it cannot, if nothing
 * came back), and what it said. A single flag would make "never checked" and "checked and failed"
 * indistinguishable, which is the exact confusion this token set exists to prevent.
 */
export interface ResponsesDifferentialOutcome {
  readonly stepId: 'E0_EXACT_NEUTRAL_CLIENT_GPT_OSS_20B_RESPONSES_STRICT';
  readonly providerTransportStarted: boolean;
  readonly providerHttpStatus: number;
  readonly providerHttpClass: CandidateProviderHttpClass;
  readonly providerErrorType: CandidateProviderErrorType;
  readonly providerErrorCode: CandidateProviderErrorCode;
  readonly providerCompleted: boolean;
  /** Whether the local canonical validator was reached at all. False unless a document came back. */
  readonly localValidationCompleted: boolean;
  /** What it said. Meaningless — and always false — unless `localValidationCompleted`. */
  readonly localValidationPassed: boolean;
}

/** The reading: one token, with the literal observed fields preserved beside it. */
export interface ResponsesDifferentialAnalysis {
  readonly classification: ResponsesDifferentialClassification;
  readonly providerHttpStatus: number;
  readonly providerHttpClass: CandidateProviderHttpClass;
  readonly providerErrorType: CandidateProviderErrorType;
  readonly providerErrorCode: CandidateProviderErrorCode;
  readonly localValidationCompleted: boolean;
  readonly localValidationPassed: boolean;
}

/**
 * Read the one probe.
 *
 * The switch is exhaustive over the role map, which is total by type — so a transport class added to
 * the observation vocabulary cannot reach a verdict here by falling through. There is no default
 * branch on purpose.
 *
 * The acceptance branch is the only one that consults the local validator, and it requires the
 * validator to have PASSED. A 2xx alone never reaches `ACCEPTED`.
 */
export function analyseResponsesDifferential(
  outcome: ResponsesDifferentialOutcome | undefined,
): ResponsesDifferentialAnalysis {
  if (outcome === undefined) {
    // The probe never ran — refused by the ledger, or the run stopped before it.
    return Object.freeze({
      classification: 'RESPONSES_20B_STRICT_INCONCLUSIVE' as const,
      providerHttpStatus: 0,
      providerHttpClass: 'NOT_REACHED' as const,
      providerErrorType: 'NONE' as const,
      providerErrorCode: 'NONE' as const,
      localValidationCompleted: false,
      localValidationPassed: false,
    });
  }

  const observed = {
    providerHttpStatus: outcome.providerHttpStatus,
    providerHttpClass: outcome.providerHttpClass,
    providerErrorType: outcome.providerErrorType,
    providerErrorCode: outcome.providerErrorCode,
    localValidationCompleted: outcome.localValidationCompleted,
    localValidationPassed: outcome.localValidationPassed,
  };
  const result = (
    classification: ResponsesDifferentialClassification,
  ): ResponsesDifferentialAnalysis => Object.freeze({ classification, ...observed });

  if (isProviderAccepted(outcome)) {
    // The provider took the request. Whether the ENDPOINT answered the question is now the local
    // validator's call, and a 2xx does not get to speak for it.
    return outcome.localValidationCompleted && outcome.localValidationPassed
      ? result('RESPONSES_20B_STRICT_ACCEPTED')
      : result('RESPONSES_20B_STRICT_LOCAL_VALIDATION_FAILED');
  }

  switch (PROVIDER_OUTCOME_ROLE[outcome.providerHttpClass]) {
    case 'CONTRACT_REJECTION':
      // 400 / 413 / 422 only, and only with a real response behind them.
      return outcome.providerTransportStarted && outcome.providerHttpStatus >= 100
        ? result('RESPONSES_20B_STRICT_PROVIDER_REJECTED')
        : result('RESPONSES_20B_STRICT_INCONCLUSIVE');
    case 'RATE_LIMITED':
      return result('RESPONSES_20B_STRICT_RATE_LIMITED');
    case 'EXECUTION_INTERRUPTED':
      return result('RESPONSES_20B_STRICT_INFRA_INTERRUPTED');
    case 'NON_VERDICT_OTHER':
      // Entitlement, beta enrolment, permission, configuration, ungoverned. Never an endpoint verdict.
      return result('RESPONSES_20B_STRICT_INCONCLUSIVE');
    case 'ACCEPTED': {
      // A 2xx whose provider did not complete — the payload carried no readable structured document.
      //
      // Deliberately NOT `LOCAL_VALIDATION_FAILED`: nothing reached the local validator, so saying it
      // failed would be a claim about a check that never ran. It is a 2xx that produced no result,
      // which is exactly what INCONCLUSIVE means.
      return result('RESPONSES_20B_STRICT_INCONCLUSIVE');
    }
  }
}
