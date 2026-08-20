/**
 * The reading of an O0-O3 operational acceptance matrix.
 *
 * ### What this matrix is, and what it is NOT
 *
 * Every token below describes WHAT HAPPENED IN ONE RUN. None of them names a cause.
 *
 * That restraint is not stylistic. The production Groq request body carries no `temperature`, no
 * `top_p` and no `seed` — Groq documents temperature as defaulting to 1 — so two calls that are
 * identical in every authored field are still two independent generation draws. O2 and O3 therefore
 * are NOT a controlled A/B experiment, and an earlier revision of this module said they were.
 *
 * The fix is to bound the wording rather than to control the variable: adding a diagnostic-only
 * temperature, seed or retry would make the harness deterministic while making it measure a request
 * posture production does not send, which is worse than an honestly-bounded observation.
 *
 * So the pair stays, because "the representative request was refused in the same run that the
 * synthetic one was taken" is a genuinely useful description. It is just not a demonstration that the
 * messages caused it.
 *
 * ### The strongest success wins the headline
 *
 * O3 is the closest thing to a real Riya turn this harness can send: the exact repaired schema, the
 * governed operational budget, and the captured representative production messages. If the provider
 * takes it, that is the finding, and a surprising rejection further down cannot overturn it — those
 * stay visible in `rejectedStepIds` as facts about that probe in that run.
 *
 * ### Control and completeness come first
 *
 * A rejected control means the operational envelope itself was refused, so nothing after it is
 * interpretable. An incomplete matrix supports no conclusion about the probes that did settle.
 *
 * POST-OAD3, "incomplete" also covers a probe the provider never judged ON CONTRACT GROUNDS. OAD3
 * returned HTTP 429 on `O1` and `O3` while `O0` and `O2` returned 200, and the harness emitted
 * `OPERATIONAL_REPRESENTATIVE_REJECTED_AFTER_SYNTHETIC_ACCEPTED` — a token pointing at the message
 * shape, on evidence that was a rate limit. A 429 means the provider declined to process; it is not a
 * verdict on the schema or the messages. Those rows are now inconclusive, so the same matrix would
 * read `MIXED_OR_INCONCLUSIVE` instead.
 *
 * The same is true of a credential, permission or configuration failure. Only 400, 413 and 422 carry
 * contract evidence; a 401 says the caller was not authorised, which is a different problem entirely.
 *
 * The historical OAD3 receipt keeps the token it emitted. Only future analysis changes.
 *
 * Pure: no clock, no I/O, no provider, no credential.
 */
import type {
  CandidateProviderErrorCode,
  CandidateProviderErrorType,
  CandidateProviderHttpClass,
} from '../candidate-transport-observation.js';
import type { OperationalAcceptanceStepId } from './operational-acceptance-plan.js';
import { OPERATIONAL_ACCEPTANCE_STEP_IDS } from './operational-acceptance-plan.js';
import {
  isProviderAccepted,
  isProviderContractRejected,
  isProviderOutcomeInconclusive,
} from './provider-outcome-classes.js';

/** The closed conclusions an operational acceptance matrix can support. */
export const OPERATIONAL_ACCEPTANCE_CLASSIFICATIONS = [
  /** The control was refused at the operational budget, so nothing else is interpretable. */
  'OPERATIONAL_CONTROL_INVALID',
  /**
   * The representative operational request contract was ACCEPTED ONCE.
   *
   * The strongest result this harness can produce, and still narrow: it is sufficient to move to
   * bounded safety replication. It is not a quality verdict, not safety eligibility, not P10
   * eligibility and not release readiness, and it evaluates nothing.
   */
  'OPERATIONAL_EXACT_REPRESENTATIVE_ACCEPTED',
  /**
   * O2 was accepted and O3 was rejected, IN THIS RUN.
   *
   * The token is named for the sequence rather than for a cause, because that is all it observes. The
   * message shape is a plausible differentiator — the pair does share its schema object — but the two
   * probes are separate uncontrolled generation draws, so run-to-run and model variability is NOT
   * excluded and this token must never be read as isolating the messages.
   */
  'OPERATIONAL_REPRESENTATIVE_REJECTED_AFTER_SYNTHETIC_ACCEPTED',
  /**
   * O3 and O2 rejected while O1 was accepted, in this run.
   *
   * The evolution group was taken and the full document was not. Which top-level interaction is
   * involved is deliberately not guessed.
   */
  'OPERATIONAL_FULL_SCHEMA_REJECTED',
  /**
   * O3, O2 and O1 all rejected, in this run.
   *
   * SRV1's evolution-group rejection is REPRODUCED at the operational budget. That does not exclude
   * the budget as a factor and does not establish any cause; it says only that raising the cap from
   * 512 to the governed operational budget did not produce a healthy acceptance in this run, so the
   * 512 cap is not supported as a sufficient or sole explanation. The provider error code on each row
   * carries the remaining detail.
   */
  'OPERATIONAL_EVOLUTION_GROUP_REJECTED',
  /** The matrix did not run completely, or transport failures prevent a clean reading. */
  'MIXED_OR_INCONCLUSIVE',
] as const;
export type OperationalAcceptanceClassification =
  (typeof OPERATIONAL_ACCEPTANCE_CLASSIFICATIONS)[number];

/** What ONE probe did at the provider boundary. Content-free by construction. */
export interface OperationalAcceptanceOutcome {
  readonly stepId: OperationalAcceptanceStepId;
  readonly providerTransportStarted: boolean;
  readonly providerHttpStatus: number;
  readonly providerHttpClass: CandidateProviderHttpClass;
  readonly providerErrorType: CandidateProviderErrorType;
  /**
   * The provider's own closed error code.
   *
   * SRV1's V3/V4 carried `JSON_VALIDATE_FAILED`, which the observer maps only from the literal Groq
   * envelope code and never infers from an HTTP status. It is preserved through this analysis
   * unchanged and WITHOUT interpreting its undocumented internal cause: what is established is that
   * Groq returned that literal code, so `400 + JSON_VALIDATE_FAILED` can be distinguished from
   * `400 + OTHER_OR_ABSENT`. Nothing more. That distinction alone is worth preserving, because losing
   * it would cost the next authorization.
   */
  readonly providerErrorCode: CandidateProviderErrorCode;
  readonly providerCompleted: boolean;
}

/** The full reading: a summary token, every step id bucketed, and the error codes that were seen. */
export interface OperationalAcceptanceAnalysis {
  readonly classification: OperationalAcceptanceClassification;
  readonly acceptedStepIds: readonly OperationalAcceptanceStepId[];
  readonly rejectedStepIds: readonly OperationalAcceptanceStepId[];
  readonly inconclusiveStepIds: readonly OperationalAcceptanceStepId[];
  /**
   * The closed provider error code for each rejected step, in step order.
   *
   * Reported so a reader can tell one literal provider code from another. It is deliberately not
   * accompanied by any statement about what the provider did internally to produce it.
   */
  readonly rejectedErrorCodes: readonly {
    readonly stepId: OperationalAcceptanceStepId;
    readonly providerErrorCode: CandidateProviderErrorCode;
  }[];
}

/** Accepted means the provider TOOK the request. Local semantics are not consulted. */
const accepted = isProviderAccepted;

/**
 * Refused BY the provider on CONTRACT grounds, as distinct from any other way a request can fail.
 *
 * POST-OAD3 this narrowed twice. The original predicate counted every non-2xx response with a status
 * as a rejection, which put HTTP 429 beside HTTP 400 — and OAD3's `O1` and `O3` were both 429s, so
 * the run emitted a token naming the message shape when the provider had simply declined to process.
 *
 * The first repair excluded a list of infrastructure classes and kept the leftovers as rejections,
 * which was still wrong in the other direction: `UNAUTHORIZED_401`, `FORBIDDEN_403`, `NOT_FOUND_404`
 * and `OTHER_HTTP` remained in the leftover set. A mistyped second candidate credential would have
 * reached `OPERATIONAL_REPRESENTATIVE_REJECTED_AFTER_SYNTHETIC_ACCEPTED` as if it were evidence about
 * Riya's schema.
 *
 * Contract rejection is now an explicit ALLOWLIST — 400, 413, 422 — over a role map that is total by
 * type. Everything else lands in `inconclusiveStepIds`, where the existing completeness rule turns
 * the matrix into `MIXED_OR_INCONCLUSIVE` before any acceptance branch runs.
 *
 * Still no new token and no new precedence: only which evidence reaches which branch.
 */
const rejected = isProviderContractRejected;

/** Read an operational acceptance matrix. Every declared step lands in exactly one bucket. */
export function analyseOperationalAcceptance(
  outcomes: readonly OperationalAcceptanceOutcome[],
): OperationalAcceptanceAnalysis {
  const byId = new Map<OperationalAcceptanceStepId, OperationalAcceptanceOutcome>();
  for (const one of outcomes) {
    byId.set(one.stepId, one);
  }

  const acceptedIds: OperationalAcceptanceStepId[] = [];
  const rejectedIds: OperationalAcceptanceStepId[] = [];
  const inconclusiveIds: OperationalAcceptanceStepId[] = [];
  const rejectedErrorCodes: {
    readonly stepId: OperationalAcceptanceStepId;
    readonly providerErrorCode: CandidateProviderErrorCode;
  }[] = [];

  for (const stepId of OPERATIONAL_ACCEPTANCE_STEP_IDS) {
    const one = byId.get(stepId);
    if (one === undefined || isProviderOutcomeInconclusive(one)) {
      // Never sent, or sent and never judged ON CONTRACT GROUNDS. Both are an ABSENCE of evidence.
      inconclusiveIds.push(stepId);
    } else if (accepted(one)) {
      acceptedIds.push(stepId);
    } else if (rejected(one)) {
      rejectedIds.push(stepId);
      rejectedErrorCodes.push(Object.freeze({ stepId, providerErrorCode: one.providerErrorCode }));
    } else {
      inconclusiveIds.push(stepId);
    }
  }

  const result = (
    classification: OperationalAcceptanceClassification,
  ): OperationalAcceptanceAnalysis =>
    Object.freeze({
      classification,
      acceptedStepIds: Object.freeze([...acceptedIds]),
      rejectedStepIds: Object.freeze([...rejectedIds]),
      inconclusiveStepIds: Object.freeze([...inconclusiveIds]),
      rejectedErrorCodes: Object.freeze([...rejectedErrorCodes]),
    });

  const control = byId.get('O0_MINIMAL_CONTROL_OPERATIONAL');
  if (control === undefined || !accepted(control)) {
    return result('OPERATIONAL_CONTROL_INVALID');
  }
  if (inconclusiveIds.length > 0) {
    return result('MIXED_OR_INCONCLUSIVE');
  }

  // The strongest success wins, whatever the wrappers did. A surprising O1 or O2 rejection stays in
  // the set as a fact about that probe in this run; it cannot overturn a representative request the
  // provider actually took.
  if (!rejectedIds.includes('O3_EXACT_REPRESENTATIVE_OPERATIONAL')) {
    return result('OPERATIONAL_EXACT_REPRESENTATIVE_ACCEPTED');
  }
  // O3 was refused while O2 was taken. Reported as the SEQUENCE it is: the pair shares a schema
  // object, but they are two uncontrolled generation draws, so this does not isolate the messages.
  if (!rejectedIds.includes('O2_EXACT_SYNTHETIC_OPERATIONAL')) {
    return result('OPERATIONAL_REPRESENTATIVE_REJECTED_AFTER_SYNTHETIC_ACCEPTED');
  }
  if (!rejectedIds.includes('O1_EVOLUTION_GROUP_OPERATIONAL')) {
    return result('OPERATIONAL_FULL_SCHEMA_REJECTED');
  }
  return result('OPERATIONAL_EVOLUTION_GROUP_REJECTED');
}
