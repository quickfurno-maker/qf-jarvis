/**
 * What a caller supplies (QFJ-P08, ADR-0083).
 *
 * Three values, all treated as untrusted structural input. The runtime obtains none of them: the
 * request was built elsewhere, the authorization arrived from a Core boundary that does not exist
 * yet, and the approval evidence may have been serialized, stored and read back by something that
 * is not this runtime.
 *
 * ### Why the approval evidence is OPTIONAL
 *
 * Because Core may refuse a communication **before any human approval exists**. A recipient who has
 * opted out, withdrawn consent, been suppressed, or sent STOP is refused on eligibility grounds
 * alone — and requiring an approval artifact before such a refusal could be recorded would mean
 * manufacturing one, which is the opposite of safe.
 *
 * An AUTHORIZED communication is the other way round entirely: it needs both a human's approval and
 * Core's eligibility check, and the runtime refuses to observe one without the other.
 */
import type { CommunicationAuthorizationV1, CommunicationRequestV1 } from '@qf-jarvis/contracts';
import type { ApprovalDecisionValidationInput } from '@qf-jarvis/approval-runtime';

/**
 * The approval evidence, exactly as the PUBLIC approval runtime consumes it.
 *
 * Aliased from `ApprovalDecisionValidationInput` rather than re-declared. Writing the shape out
 * again would create a second definition of an input `@qf-jarvis/approval-runtime` already owns —
 * free to drift, and silently left behind the next time that runtime changes.
 *
 * Note what is NOT accepted here: a caller-supplied `ApprovalDecisionCorrelation`. A correlation is
 * a CONCLUSION, and accepting one would let a caller assert the very thing this runtime exists to
 * prove. The raw evidence goes back through `validateDecision` every time.
 */
export type CommunicationAuthorizationEvidence = ApprovalDecisionValidationInput;

/** One communication ask, Core's answer to it, and — when Core said yes — why a human agreed. */
export interface CommunicationAuthorizationValidationInput {
  /** The powerless ask Jarvis produced. Re-validated, never trusted and never repaired. */
  readonly request: CommunicationRequestV1;
  /** Core's authoritative answer. Re-validated, never repaired, never reinterpreted. */
  readonly authorization: CommunicationAuthorizationV1;
  /** Mandatory when Core authorized; absent is legitimate when Core refused. */
  readonly approval?: CommunicationAuthorizationEvidence;
}
