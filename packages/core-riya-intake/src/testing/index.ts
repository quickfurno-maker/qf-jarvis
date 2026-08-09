/**
 * Deterministic test support for the Core Riya intake boundary (RWC-P6, ADR-0101).
 *
 * A SEPARATE subpath so a fake can never become a production default, and here that matters more than
 * anywhere else in the repository: a reader that answered "contact ready, consent granted" would pass
 * every test while letting a conversation submit an enquiry nobody agreed to.
 *
 * Everything is synthetic. No real subject, no network, no key, and no contact detail of any kind.
 */
import { parseCoreRiyaIntakeStateV1 } from '../contract/intake-state.js';
import type { CoreRiyaIntakeReadInput, CoreRiyaIntakeStateV1 } from '../contract/intake-state.js';
import type { CoreRiyaIntakeLookupInput, CoreRiyaIntakePort } from '../contract/port.js';
import type { CoreRiyaIntakeSubmissionRequestV1 } from '../contract/submission.js';

/** A synthetic intake state. Defaults to the fully-ready case; override either side for a spec. */
export function syntheticIntakeState(
  over: {
    readonly stateRef?: string;
    readonly subjectRef?: string;
    readonly contact?: { readonly state: string; readonly evidenceRef?: string };
    readonly consent?: { readonly state: string; readonly evidenceRef?: string };
  } = {},
): CoreRiyaIntakeStateV1 {
  return parseCoreRiyaIntakeStateV1({
    version: 1,
    stateRef: over.stateRef ?? 'core.intake.state.synthetic.1',
    subjectRef: over.subjectRef ?? 'subject.synthetic.1',
    contact: over.contact ?? { state: 'READY', evidenceRef: 'core.contact.synthetic.1' },
    consent: over.consent ?? { state: 'GRANTED', evidenceRef: 'core.consent.synthetic.1' },
  });
}

/** What a spec may script. Raw values, so the malformed paths are reachable. */
export interface ScriptedCoreRiyaIntakeOptions {
  readonly readReturns?: unknown;
  readonly readRejects?: boolean;
  readonly lookupReturns?: unknown;
  readonly lookupRejects?: boolean;
  readonly submitReturns?: unknown;
  readonly submitRejects?: boolean;
}

/** A port that counts its calls and records what it was asked. */
export type ScriptedCoreRiyaIntakePort = CoreRiyaIntakePort & {
  readCalls(): number;
  lookupCalls(): number;
  submitCalls(): number;
  lastRead(): CoreRiyaIntakeReadInput | undefined;
  lastLookup(): CoreRiyaIntakeLookupInput | undefined;
  lastSubmission(): CoreRiyaIntakeSubmissionRequestV1 | undefined;
};

export function scriptedCoreRiyaIntakePort(
  over: ScriptedCoreRiyaIntakeOptions = {},
): ScriptedCoreRiyaIntakePort {
  let reads = 0;
  let lookups = 0;
  let submits = 0;
  let seenRead: CoreRiyaIntakeReadInput | undefined;
  let seenLookup: CoreRiyaIntakeLookupInput | undefined;
  let seenSubmission: CoreRiyaIntakeSubmissionRequestV1 | undefined;

  // A realistic failure carries exactly the kind of detail that must never escape.
  const failure = (): Error => new Error('core intake at 10.0.0.11 — token=abc123');

  return {
    readCurrent(input: CoreRiyaIntakeReadInput): Promise<unknown> {
      reads += 1;
      seenRead = input;
      if (over.readRejects === true) {
        return Promise.reject(failure());
      }
      return Promise.resolve(over.readReturns ?? syntheticIntakeState());
    },
    lookupSubmission(input: CoreRiyaIntakeLookupInput): Promise<unknown> {
      lookups += 1;
      seenLookup = input;
      if (over.lookupRejects === true) {
        return Promise.reject(failure());
      }
      return Promise.resolve(over.lookupReturns ?? { contractVersion: 1, status: 'NOT_FOUND' });
    },
    submit(request: CoreRiyaIntakeSubmissionRequestV1): Promise<unknown> {
      submits += 1;
      seenSubmission = request;
      if (over.submitRejects === true) {
        return Promise.reject(failure());
      }
      return Promise.resolve(
        over.submitReturns ?? {
          contractVersion: 1,
          idempotencyKey: request.idempotencyKey,
          outcome: 'ACCEPTED',
          completionEvidenceRef: 'core.intake.evidence.synthetic.1',
        },
      );
    },
    readCalls: () => reads,
    lookupCalls: () => lookups,
    submitCalls: () => submits,
    lastRead: () => seenRead,
    lastLookup: () => seenLookup,
    lastSubmission: () => seenSubmission,
  };
}
