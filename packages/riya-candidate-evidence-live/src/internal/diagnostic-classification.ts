/**
 * The DIFFERENTIAL reading of a canary matrix (MVP-P2A.2 HF4-R8).
 *
 * ### What this is for
 *
 * S9 and S10 each ended with nine identical HTTP 400s and no way to say which dimension the provider
 * objected to. The canaries vary one axis at a time; this turns their outcomes into ONE closed
 * classification, so the next decision is made from a named finding rather than from a reader's
 * impression of eight status codes.
 *
 * ### It is pure, and that is load-bearing
 *
 * No clock, no I/O, no provider, no credential. It consumes closed outcome records and returns a
 * closed token, which is what lets every rule below be asserted directly on fixtures — including the
 * ones that must NOT fire. A classifier that can only be exercised by a live run is a classifier
 * nobody can check before spending the run.
 *
 * ### It refuses to over-claim
 *
 * Each rule carries the preconditions that make its conclusion actually follow. When two genuinely
 * different findings both hold, the answer is `MIXED_OR_INCONCLUSIVE` — an honest "the matrix
 * disagrees with itself" beats a confident wrong dimension, because the next phase spends a live
 * authorization on whatever this says.
 *
 * ### The precedence defect S11 exposed, and the repair
 *
 * The original preconditions used the WRONG control. The shape rules — `anyOf`, numeric enum, real
 * Riya schema — each required D2 to have been ACCEPTED, on the reasoning that "behind a cap that
 * already fails, a shape failing says nothing about the shape".
 *
 * That reasoning is sound but it named the wrong canary. D2 is the HIGH-cap canary. D3, D4, D5 and
 * D7 all run at LOW_512, so D2's fate cannot explain any of them; the control that shares their cap
 * is D1. Gating low-cap shape rules on a high-cap result meant any high-cap sensitivity silently
 * suppressed every low-cap shape finding.
 *
 * S11 is exactly that matrix. D1 accepted at 512 and D2 was rejected at 65,536, while D5 — the real
 * projected Riya schema at 512 — was independently rejected. The cap rule fired, the real-schema rule
 * could not, and a matrix carrying two findings was reported as the single cause
 * `HIGH_COMPLETION_CAP_SENSITIVE`. The completion-cap repair alone would then have been read as the
 * whole fix, and the next live authorization would have been spent rediscovering D5.
 *
 * Every shape rule now gates on its OWN cap's control. The cap axis is read from `CANARY_CAP_PAIRS`
 * rather than a hand-picked subset, so the matrix and the classifier cannot drift. And because
 * `MIXED_OR_INCONCLUSIVE` is deliberately unspecific, {@link analyseDiagnosticCanaries} also returns
 * the findings that held — a reader should not have to re-derive which two collided.
 */
import type { DiagnosticCanaryId } from '../diagnostic-canaries.js';
import { CANARY_CAP_PAIRS, DIAGNOSTIC_CANARY_IDS } from '../diagnostic-canaries.js';
import type {
  CandidateProviderErrorCode,
  CandidateProviderErrorType,
  CandidateProviderHttpClass,
} from '../candidate-transport-observation.js';

/** The closed diagnostic conclusions. One of these, always. */
export const DIAGNOSTIC_CLASSIFICATIONS = [
  /** The smallest documented strict schema was rejected. Nothing about Riya is implicated. */
  'MINIMAL_STRICT_REJECTED',
  /** A pair disagreed across the completion cap and nothing else. */
  'HIGH_COMPLETION_CAP_SENSITIVE',
  /** The documented nullable-union form was rejected. */
  'ANYOF_NULLABLE_REJECTED',
  /** A numeric singleton enum was rejected. */
  'NUMERIC_ENUM_REJECTED',
  /** Every synthetic shape passed and the real projected Riya schema did not. */
  'REAL_RIYA_SCHEMA_REJECTED',
  /** The Riya schema passed; the full production message shape did not. */
  'EXACT_RIYA_MESSAGE_SHAPE_REJECTED',
  /** Every canary was accepted. The S9/S10 failure is not reproducible under this matrix. */
  'CURRENT_EXACT_REQUEST_ACCEPTED',
  /** Two different findings both hold, or the pattern fits none of the rules. */
  'MIXED_OR_INCONCLUSIVE',
  /** The matrix did not run, or did not run completely. The default, and S9/S10's own answer. */
  'DIAGNOSTIC_NOT_RUN',
] as const;
export type DiagnosticClassification = (typeof DIAGNOSTIC_CLASSIFICATIONS)[number];

/**
 * What ONE canary did at the provider boundary.
 *
 * The same content-free vocabulary HF4-R4 established for the safety path, deliberately: a canary is
 * observed by the same transport observer as a real request, so there is no second way of describing
 * what happened and no field here that a raw provider body could occupy.
 */
export interface CanaryOutcome {
  readonly canaryId: DiagnosticCanaryId;
  readonly providerTransportStarted: boolean;
  /** The exact HTTP status, bounded 100-599 by the observer. `0` means none was received. */
  readonly providerHttpStatus: number;
  readonly providerHttpClass: CandidateProviderHttpClass;
  readonly providerErrorType: CandidateProviderErrorType;
  readonly providerErrorCode: CandidateProviderErrorCode;
  /** The provider returned a response the gateway did not classify as a failure. */
  readonly providerCompleted: boolean;
  /**
   * Whether the returned value satisfied the LOCAL schema, where one applies.
   *
   * Recorded and deliberately NOT used by the rules below. This matrix measures REQUEST ACCEPTANCE:
   * a synthetic prompt that produces a structurally wrong answer still proves the provider accepted
   * the request, which is the only question being asked.
   */
  readonly localValidationAccepted?: boolean;
}

/** Accepted means the provider took the request. Local semantics are explicitly not consulted. */
function accepted(
  outcomes: ReadonlyMap<DiagnosticCanaryId, CanaryOutcome>,
  id: DiagnosticCanaryId,
): boolean {
  const one = outcomes.get(id);
  return one !== undefined && one.providerCompleted && one.providerHttpClass === 'SUCCESS_2XX';
}

function rejected(
  outcomes: ReadonlyMap<DiagnosticCanaryId, CanaryOutcome>,
  id: DiagnosticCanaryId,
): boolean {
  const one = outcomes.get(id);
  return one !== undefined && !accepted(outcomes, id);
}

/**
 * Classify a complete canary matrix.
 *
 * An INCOMPLETE matrix is `DIAGNOSTIC_NOT_RUN` rather than a partial verdict. That is what makes S9's
 * and S10's transcripts classify honestly: neither ran a canary, so neither supports any conclusion
 * about which dimension failed, and retrofitting one onto them would be inventing evidence.
 */
export function classifyDiagnosticCanaries(
  outcomes: readonly CanaryOutcome[],
): DiagnosticClassification {
  return analyseDiagnosticCanaries(outcomes).classification;
}

/** Every rule that holds for a COMPLETE matrix. Split out so the analysis below can report them. */
function matchedFindings(
  byId: ReadonlyMap<DiagnosticCanaryId, CanaryOutcome>,
): ReadonlySet<DiagnosticClassification> {
  const matched = new Set<DiagnosticClassification>();

  // The floor. If the smallest documented strict schema is refused AT THE LOW CAP, every later canary
  // is refused for a reason that has nothing to do with what it was varying — so no shape rule below
  // may fire, and each one re-checks `accepted(D1)` to say so.
  if (rejected(byId, 'D1')) {
    matched.add('MINIMAL_STRICT_REJECTED');
  }

  // Any governed cap pair that disagrees. Read from CANARY_CAP_PAIRS — the same constant the matrix
  // declares — so a pair added there is read here rather than silently ignored.
  if (CANARY_CAP_PAIRS.some(([low, high]) => accepted(byId, low) && rejected(byId, high))) {
    matched.add('HIGH_COMPLETION_CAP_SENSITIVE');
  }

  // The LOW-cap shape rules. Their control is D1 — the canary that shares their completion cap — and
  // deliberately NOT D2. See the module note: gating these on the high-cap canary is what let S11's
  // real-schema rejection be masked by its cap sensitivity.
  if (accepted(byId, 'D1') && rejected(byId, 'D3')) {
    matched.add('ANYOF_NULLABLE_REJECTED');
  }
  if (accepted(byId, 'D1') && rejected(byId, 'D4')) {
    matched.add('NUMERIC_ENUM_REJECTED');
  }

  // Every synthetic shape passed at this cap, so the real schema is the first thing that did not.
  if (
    accepted(byId, 'D1') &&
    accepted(byId, 'D3') &&
    accepted(byId, 'D4') &&
    rejected(byId, 'D5')
  ) {
    matched.add('REAL_RIYA_SCHEMA_REJECTED');
  }

  // The real schema is fine at this cap, so what D7 adds — the production message shape — is what is
  // left. Its control is D5, which carries the same schema at the same cap.
  if (accepted(byId, 'D5') && rejected(byId, 'D7')) {
    matched.add('EXACT_RIYA_MESSAGE_SHAPE_REJECTED');
  }

  return matched;
}

/**
 * The full reading of a matrix: the classification, and every finding that held.
 *
 * `MIXED_OR_INCONCLUSIVE` is honest but unspecific, and S11 is precisely the case where the detail
 * matters — "cap-sensitive AND the real schema was rejected" is two pieces of work, and a reader who
 * only sees `MIXED` has to re-derive both from eight status codes. The findings are the same closed
 * tokens, so nothing content-bearing is added by reporting them.
 */
export interface DiagnosticAnalysis {
  readonly classification: DiagnosticClassification;
  /** Every rule that fired, in vocabulary order. Empty when the matrix fits no rule. */
  readonly findings: readonly DiagnosticClassification[];
}

export function analyseDiagnosticCanaries(outcomes: readonly CanaryOutcome[]): DiagnosticAnalysis {
  const byId = new Map<DiagnosticCanaryId, CanaryOutcome>();
  for (const one of outcomes) {
    byId.set(one.canaryId, one);
  }
  if (!DIAGNOSTIC_CANARY_IDS.every((id) => byId.has(id))) {
    return Object.freeze({ classification: 'DIAGNOSTIC_NOT_RUN' as const, findings: [] });
  }
  if (DIAGNOSTIC_CANARY_IDS.every((id) => accepted(byId, id))) {
    return Object.freeze({
      classification: 'CURRENT_EXACT_REQUEST_ACCEPTED' as const,
      findings: Object.freeze(['CURRENT_EXACT_REQUEST_ACCEPTED' as const]),
    });
  }

  const matched = matchedFindings(byId);
  // Vocabulary order, so two runs of the same matrix report the same list.
  const findings = DIAGNOSTIC_CLASSIFICATIONS.filter((one) => matched.has(one));
  if (matched.size === 1) {
    const [only] = findings;
    return Object.freeze({
      classification: only ?? 'MIXED_OR_INCONCLUSIVE',
      findings: Object.freeze(findings),
    });
  }
  // Zero rules fired, or two different findings both hold. Either way this matrix does not name ONE
  // dimension. Saying so — and naming the ones that did hold — is the useful answer.
  return Object.freeze({
    classification: 'MIXED_OR_INCONCLUSIVE' as const,
    findings: Object.freeze(findings),
  });
}
