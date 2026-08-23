/**
 * The verdict (QFJ-P09.05, ADR-0110).
 *
 * ### What `ok: true` means, stated so it cannot be read as anything else
 *
 * It means LIFECYCLE CONSISTENT: these two canonical records describe the same governed
 * communication, the candidate evidences the departure it claims, time did not run backwards, and
 * the movement is an edge the approved communication model contains.
 *
 * It does NOT mean `canSend`, `canExecute`, `isAuthorized`, `consentValid`, `eligible`, `sent`,
 * `delivered`, `providerSucceeded` or `permissionGranted`, and none of those fields exists here --
 * not as a boolean, not as a status string a caller could compare, and not as a nested object.
 *
 * The distinction is the whole safety argument of this package. Consider the record most worth
 * getting wrong: a `delivered` record whose transition is perfectly consistent. `ok: true` says the
 * movement from `provider-accepted` to `delivered` is a legal one and the record evidences it with
 * an execution result id. It says nothing whatsoever about whether a message reached a person --
 * "no provider state becomes authoritative until Core records it", and this runtime never spoke to
 * Core, to n8n or to a provider. A consumer that renders a tick on `ok: true` has invented a fact.
 *
 * Equally, consistency is not permission looking forward. A consistent move into `authorized` does
 * not authorize anything: QuickFurno Core issued that authorization, this package merely observed
 * that the record describing it followed legally from the record before it, and eligibility is
 * re-validated at execution time by Core regardless.
 *
 * ### Why the failure carries a reason and the success carries nothing
 *
 * A refusal has to be actionable, so it names which of thirteen disagreements occurred. A success
 * has nothing to add: any field added to the success branch would be a fact about the communication
 * rather than about the transition, and a caller would start reading it as one. The records the
 * caller already holds are the source of truth about the communication; this result is a source of
 * truth about one edge and nothing more.
 */
import type { CommunicationLifecycleRefusalReason } from './reasons.js';

/** The transition is lifecycle-consistent. It is not permission, and it is not delivery truth. */
export interface CommunicationLifecycleConsistent {
  readonly ok: true;
}

/** The transition is refused, with exactly one closed, content-free reason. */
export interface CommunicationLifecycleRefused {
  readonly ok: false;
  readonly reason: CommunicationLifecycleRefusalReason;
}

/** Frozen. A verdict a caller can edit after the fact is not a verdict. */
export type CommunicationLifecycleTransitionResult =
  CommunicationLifecycleConsistent | CommunicationLifecycleRefused;
