/**
 * What a caller supplies (QFJ-P09.01, ADR-0084).
 *
 * Two values, both treated as untrusted structural input. The runtime obtains neither: the intent
 * arrived from QuickFurno Core across a boundary that does not exist yet, and the approval evidence
 * may have been serialized, stored and read back by something that is not this runtime.
 *
 * ### What is deliberately NOT accepted here
 *
 * **No `ApprovalDecisionCorrelation`.** A correlation is a CONCLUSION, and accepting one would let a
 * caller assert the very thing this runtime exists to prove. The raw evidence goes back through the
 * public approval runtime every time.
 *
 * **No boolean.** Not `approved`, not `authorized`, not `canExecute`, not `consentValid`. A caller
 * that could hand over "this was approved" would be the authority, and the authority is Core.
 *
 * **No `CommunicationAuthorizationObservation`.** That artifact is recipient and channel ELIGIBILITY
 * evidence, and it carries no `approvedActionId` — joining the two here would reopen exactly the
 * heuristic ADR-0083 §11 locked out. A communication action needs both Core's action authorization
 * (this) and current communication eligibility revalidated at execution time (elsewhere); neither
 * substitutes for the other.
 */
import type { ExecutionIntentV1 } from '@qf-jarvis/contracts';
import type { ApprovalDecisionValidationInput } from '@qf-jarvis/approval-runtime';

/**
 * The approval evidence, exactly as the PUBLIC approval runtime consumes it.
 *
 * Aliased from `ApprovalDecisionValidationInput` rather than re-declared: writing the shape out
 * again would create a second definition of an input `@qf-jarvis/approval-runtime` already owns,
 * free to drift and silently left behind the next time that runtime changes.
 */
export type ExecutionApprovalEvidence = ApprovalDecisionValidationInput;

/** One Core-issued execution intent, and the approval evidence it claims to rest on. */
export interface ExecutionIntentValidationInput {
  /** Core's artifact. Re-validated by its own schema, never repaired and never constructed here. */
  readonly intent: ExecutionIntentV1;
  /** Raw evidence, re-proved through the public approval runtime. Mandatory — always. */
  readonly approval: ExecutionApprovalEvidence;
}
