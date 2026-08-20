/**
 * The reading of ONE GPT-OSS-120B strict model-differential probe (POST-NRA1).
 *
 * ### Why a separate vocabulary, and why it duplicates no logic
 *
 * The tokens differ because the QUESTION differs: `REPRESENTATIVE_ACCEPTED` says an ordinary client
 * request was taken, while `STRICT_120B_ACCEPTED` says a DIFFERENT MODEL took the request the current
 * one refused. Reporting the second in the first's words would lose the only thing MD120B1 measures.
 *
 * But the HTTP reading is identical and is NOT re-implemented. Every branch below switches on
 * {@link PROVIDER_OUTCOME_ROLE} — the same total, reviewed role map the representative classifier
 * uses — so the two cannot drift, and the allowlist that keeps 401/403/404 out of "rejection" applies
 * here for free.
 *
 * ### The entitlement trap this vocabulary is shaped around
 *
 * The governed staging smoke runs against the 20B configuration. It proves the credential works; it
 * does NOT prove the account may call 120B. So an entitlement or routing answer — 401, 403, 404, or a
 * class nobody has governed — is `STRICT_120B_INCONCLUSIVE`, never a verdict about the model's
 * handling of the request.
 *
 * Reading "your account cannot call this model" as "120B also rejects our schema" would retire the
 * differential on evidence that never touched it.
 *
 * Pure: no clock, no I/O, no provider, no credential.
 */
import type {
  CandidateProviderErrorCode,
  CandidateProviderErrorType,
  CandidateProviderHttpClass,
} from '../candidate-transport-observation.js';
import { isProviderAccepted, PROVIDER_OUTCOME_ROLE } from './provider-outcome-classes.js';

/** The closed conclusions ONE differential probe can support. */
export const MODEL_DIFFERENTIAL_CLASSIFICATIONS = [
  /**
   * HTTP 2xx and the provider completed.
   *
   * The neutral production-built request that 20B refused was TAKEN by 120B, once. That is a model
   * differential and nothing more: not a release decision, not a quality verdict, not safety, not P10
   * eligibility, and not evidence about any other request.
   */
  'STRICT_120B_ACCEPTED',
  /**
   * 400, 413 or 422 — the provider judged the request and refused it.
   *
   * If this carries `JSON_VALIDATE_FAILED`, the strict-output failure is reproduced across BOTH
   * GPT-OSS models, and the next decision is an offline output-contract strategy rather than another
   * run. Literal type and code travel with it, uninterpreted.
   */
  'STRICT_120B_PROVIDER_REJECTED',
  /** HTTP 429. The provider declined to process. Not a verdict. */
  'STRICT_120B_RATE_LIMITED',
  /** Transport, capacity, cancellation or 5xx. The request never executed. */
  'STRICT_120B_INFRA_INTERRUPTED',
  /**
   * 401, 403, 404, an ungoverned class, or a probe that never ran.
   *
   * Most likely an ENTITLEMENT answer: the smoke checked a 20B configuration and cannot establish
   * that this account may call 120B at all. It says nothing about the request contract.
   */
  'STRICT_120B_INCONCLUSIVE',
] as const;
export type ModelDifferentialClassification = (typeof MODEL_DIFFERENTIAL_CLASSIFICATIONS)[number];

/** What the ONE probe did at the provider boundary. Content-free by construction. */
export interface ModelDifferentialOutcome {
  readonly stepId: 'M0_EXACT_NEUTRAL_CLIENT_GPT_OSS_120B_STRICT';
  readonly providerTransportStarted: boolean;
  readonly providerHttpStatus: number;
  readonly providerHttpClass: CandidateProviderHttpClass;
  readonly providerErrorType: CandidateProviderErrorType;
  readonly providerErrorCode: CandidateProviderErrorCode;
  readonly providerCompleted: boolean;
}

/** The reading: one token, with the literal observed fields preserved beside it. */
export interface ModelDifferentialAnalysis {
  readonly classification: ModelDifferentialClassification;
  readonly providerHttpStatus: number;
  readonly providerHttpClass: CandidateProviderHttpClass;
  readonly providerErrorType: CandidateProviderErrorType;
  readonly providerErrorCode: CandidateProviderErrorCode;
}

/**
 * Read the one probe.
 *
 * The switch is exhaustive over the role map, which is total by type — so a transport class added to
 * the observation vocabulary cannot reach a verdict here by falling through. There is no default
 * branch on purpose.
 */
export function analyseModelDifferential(
  outcome: ModelDifferentialOutcome | undefined,
): ModelDifferentialAnalysis {
  if (outcome === undefined) {
    // The probe never ran — refused by the ledger, or the run stopped before it.
    return Object.freeze({
      classification: 'STRICT_120B_INCONCLUSIVE' as const,
      providerHttpStatus: 0,
      providerHttpClass: 'NOT_REACHED' as const,
      providerErrorType: 'NONE' as const,
      providerErrorCode: 'NONE' as const,
    });
  }

  const observed = {
    providerHttpStatus: outcome.providerHttpStatus,
    providerHttpClass: outcome.providerHttpClass,
    providerErrorType: outcome.providerErrorType,
    providerErrorCode: outcome.providerErrorCode,
  };
  const result = (classification: ModelDifferentialClassification): ModelDifferentialAnalysis =>
    Object.freeze({ classification, ...observed });

  if (isProviderAccepted(outcome)) {
    return result('STRICT_120B_ACCEPTED');
  }

  switch (PROVIDER_OUTCOME_ROLE[outcome.providerHttpClass]) {
    case 'CONTRACT_REJECTION':
      // 400 / 413 / 422 only, and only with a real response behind them.
      return outcome.providerTransportStarted && outcome.providerHttpStatus >= 100
        ? result('STRICT_120B_PROVIDER_REJECTED')
        : result('STRICT_120B_INCONCLUSIVE');
    case 'RATE_LIMITED':
      return result('STRICT_120B_RATE_LIMITED');
    case 'EXECUTION_INTERRUPTED':
      return result('STRICT_120B_INFRA_INTERRUPTED');
    case 'NON_VERDICT_OTHER':
      // Entitlement, permission, configuration, ungoverned. Never a model verdict.
      return result('STRICT_120B_INCONCLUSIVE');
    case 'ACCEPTED':
      // A 2xx whose provider did not complete. Not acceptance, and not a refusal either.
      return result('STRICT_120B_INCONCLUSIVE');
  }
}
