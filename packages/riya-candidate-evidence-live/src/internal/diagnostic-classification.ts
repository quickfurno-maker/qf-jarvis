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
 * Each rule carries the preconditions that make its conclusion actually follow. `D1 accepted, D2
 * rejected` means the cap is implicated; it does NOT also mean `anyOf` is implicated just because D3
 * happened to fail behind a cap that already fails. So the `anyOf` and numeric-enum rules require D2
 * to have been accepted first. When two genuinely different findings both hold, the answer is
 * `MIXED_OR_INCONCLUSIVE` — an honest "the matrix disagrees with itself" beats a confident wrong
 * dimension, because the next phase spends a live authorization on whatever this says.
 */
import type { DiagnosticCanaryId } from '../diagnostic-canaries.js';
import { DIAGNOSTIC_CANARY_IDS } from '../diagnostic-canaries.js';
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
  const byId = new Map<DiagnosticCanaryId, CanaryOutcome>();
  for (const one of outcomes) {
    byId.set(one.canaryId, one);
  }
  if (!DIAGNOSTIC_CANARY_IDS.every((id) => byId.has(id))) {
    return 'DIAGNOSTIC_NOT_RUN';
  }

  if (DIAGNOSTIC_CANARY_IDS.every((id) => accepted(byId, id))) {
    return 'CURRENT_EXACT_REQUEST_ACCEPTED';
  }

  const matched = new Set<DiagnosticClassification>();

  // The floor. If the smallest documented strict schema is refused, every later canary is refused for
  // a reason that has nothing to do with what it was varying — so no other rule may fire.
  if (rejected(byId, 'D1')) {
    matched.add('MINIMAL_STRICT_REJECTED');
  }

  // A pair that disagrees across the cap and nothing else. Either pair is sufficient.
  if (
    (accepted(byId, 'D1') && rejected(byId, 'D2')) ||
    (accepted(byId, 'D7') && rejected(byId, 'D8'))
  ) {
    matched.add('HIGH_COMPLETION_CAP_SENSITIVE');
  }

  // These require D2 accepted as well as D1: behind a cap that already fails, a low-cap shape failing
  // says nothing about the shape.
  if (accepted(byId, 'D1') && accepted(byId, 'D2') && rejected(byId, 'D3')) {
    matched.add('ANYOF_NULLABLE_REJECTED');
  }
  if (accepted(byId, 'D1') && accepted(byId, 'D2') && rejected(byId, 'D4')) {
    matched.add('NUMERIC_ENUM_REJECTED');
  }

  // Every synthetic shape passed, so the real schema is the first thing that did not.
  if (
    accepted(byId, 'D1') &&
    accepted(byId, 'D2') &&
    accepted(byId, 'D3') &&
    accepted(byId, 'D4') &&
    rejected(byId, 'D5')
  ) {
    matched.add('REAL_RIYA_SCHEMA_REJECTED');
  }

  // The schema is fine at both caps, so what is left is the message shape.
  if (accepted(byId, 'D5') && accepted(byId, 'D6') && rejected(byId, 'D7')) {
    matched.add('EXACT_RIYA_MESSAGE_SHAPE_REJECTED');
  }

  if (matched.size === 1) {
    const [only] = [...matched];
    return only ?? 'MIXED_OR_INCONCLUSIVE';
  }
  // Zero rules fired, or two different findings both hold. Either way this matrix does not name one
  // dimension, and saying so is the useful answer.
  return 'MIXED_OR_INCONCLUSIVE';
}
