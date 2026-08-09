/**
 * The current Core-owned intake state (RWC-P6, ADR-0101 §8).
 *
 * ### What this answers, and what it deliberately cannot
 *
 * Two questions, both Core's: has contact been captured, and what did the client decide about
 * consent. Jarvis reads the answers and moves a conversation; it never computes them, never stores
 * them, and has no field in which it could.
 *
 * The authority matrix is explicit — *Consent: READ for every agent, Core final authority,
 * PROHIBITED to change for all agents* — and this contract is what makes that operational rather
 * than aspirational. There is no `grantConsent`, no `captureContact`, and no writable field
 * anywhere in this package.
 *
 * ### Evidence, not booleans
 *
 * Every non-`MISSING` state carries an opaque Core reference. A bare `true` is a claim, and a claim
 * is worth nothing at the moment it is challenged; a reference is a lookup. This is the same reason
 * `ClientConfirmationV1` points at an event rather than setting a flag — and it is why the schema
 * makes the evidence REQUIRED rather than optional: a state that says "granted" with nothing to point
 * at is precisely the shape of an inference somebody wrote down.
 *
 * Conversely `MISSING` FORBIDS evidence. Evidence of an absence is not a thing, and permitting it
 * would let a caller attach a reference to nothing and have it look answered.
 *
 * ### Why `DECLINED` and `OPTED_OUT` are different states
 *
 * Declining this intake is not a global stop. A client who says "not right now" about one enquiry has
 * not withdrawn from being contacted at all, and collapsing the two would either over-apply a refusal
 * or — far worse — under-apply an opt-out. `OPTED_OUT` is the stronger Core-owned stop, and the one
 * that must never be ignored.
 *
 * ### Scope: tenant AND conversation AND subject
 *
 * That distinction is exactly why a subject is not enough to key this state on. `DECLINED` means the
 * client declined THIS intake, so the same person can hold `GRANTED` on one conversation and
 * `DECLINED` on another, and a subject-keyed read cannot tell those apart — it would return one of
 * them and the composition would act on it as though it were the answer to the other.
 *
 * Contact may well be subject-level inside Core. The composed state is still attributed to one
 * conversation, because consent is intake-scoped and splitting the two into separate reads would
 * invent a boundary Core does not have.
 *
 * ### The state echoes its own identity, and that is not redundancy
 *
 * A future adapter — a cache keyed one field short, a batch endpoint, a retry that reuses a
 * connection — can return a perfectly well-formed state for the wrong tenant, conversation or subject.
 * Every field in it would parse. So the answer carries the question: RWC-P6B compares all three
 * against the structured action before it may read `READY`, `GRANTED`, `DECLINED`, `OPTED_OUT`, an
 * evidence reference or the state reference, and any mismatch fails closed with no advance, no
 * submission and no second call to go hunting for a better state.
 *
 * `stateRef` is not that proof. It is opaque, Core mints it, and Jarvis must never parse identity out
 * of it.
 *
 * ### What is not here
 *
 * No phone, email or name. No consent wording, no policy text, no captured-at prose, no channel
 * transcript, no lead reference, no `canSubmit`. None is needed to move a conversation from CONTACT
 * to CONSENT, and every one of them would be business or personal data crossing a boundary for no
 * reason.
 */
import { z } from 'zod';

import { CoreRiyaIntakeError } from '../errors.js';
import {
  coreRiyaIntakeEvidenceRefSchema,
  coreRiyaIntakeIdentifierSchema,
  coreRiyaIntakeStateRefSchema,
} from './primitives.js';

/** Whether Core holds usable contact details for this subject. */
export const CORE_RIYA_CONTACT_STATES = ['MISSING', 'READY'] as const;
export type CoreRiyaContactState = (typeof CORE_RIYA_CONTACT_STATES)[number];

/** What the client decided about this intake, as Core recorded it. */
export const CORE_RIYA_CONSENT_STATES = ['MISSING', 'GRANTED', 'DECLINED', 'OPTED_OUT'] as const;
export type CoreRiyaConsentState = (typeof CORE_RIYA_CONSENT_STATES)[number];

export interface CoreRiyaIntakeContactV1 {
  readonly state: CoreRiyaContactState;
  /** Present exactly when `state` is `READY`. Opaque; Jarvis never interprets it. */
  readonly evidenceRef?: string;
}

export interface CoreRiyaIntakeConsentV1 {
  readonly state: CoreRiyaConsentState;
  /** Present for every state except `MISSING`. A decision is a thing that happened somewhere. */
  readonly evidenceRef?: string;
}

/** The current Core-owned view, for ONE tenant, conversation and subject. Deeply frozen. */
export interface CoreRiyaIntakeStateV1 {
  readonly version: 1;
  /** Echoed scope. All three, so the answer can be proved to belong to the question. */
  readonly tenantId: string;
  /** Consent is intake-scoped, so a conversation is part of this state's identity, not context. */
  readonly conversationId: string;
  /** The opaque Core customer reference this state is about. Never a contact detail. */
  readonly subjectRef: string;
  /** Core's identifier for THIS view. Binding evidence for a later submission, never permission. */
  readonly stateRef: string;
  readonly contact: CoreRiyaIntakeContactV1;
  readonly consent: CoreRiyaIntakeConsentV1;
}

const contactSchema = z
  .object({
    state: z.enum(CORE_RIYA_CONTACT_STATES),
    evidenceRef: coreRiyaIntakeEvidenceRefSchema.optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.state === 'READY' && value.evidenceRef === undefined) {
      ctx.addIssue({ code: 'custom', message: 'READY requires evidence.' });
    }
    if (value.state === 'MISSING' && value.evidenceRef !== undefined) {
      ctx.addIssue({ code: 'custom', message: 'MISSING forbids evidence.' });
    }
  });

const consentSchema = z
  .object({
    state: z.enum(CORE_RIYA_CONSENT_STATES),
    evidenceRef: coreRiyaIntakeEvidenceRefSchema.optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    // Every DECISION carries evidence -- granted, declined and opted-out alike. A refusal is as much
    // a thing that happened as an agreement, and the one that most needs proving later.
    if (value.state !== 'MISSING' && value.evidenceRef === undefined) {
      ctx.addIssue({ code: 'custom', message: 'A recorded consent decision requires evidence.' });
    }
    if (value.state === 'MISSING' && value.evidenceRef !== undefined) {
      ctx.addIssue({ code: 'custom', message: 'MISSING forbids evidence.' });
    }
  });

const stateSchema = z
  .object({
    version: z.literal(1),
    tenantId: coreRiyaIntakeIdentifierSchema,
    conversationId: coreRiyaIntakeIdentifierSchema,
    subjectRef: coreRiyaIntakeIdentifierSchema,
    stateRef: coreRiyaIntakeStateRefSchema,
    contact: contactSchema,
    consent: consentSchema,
  })
  .strict();

/**
 * Parse, prove and freeze a Core intake state.
 *
 * Throws `CoreRiyaIntakeError('invalid-intake-state')`. Nothing about the rejected value is carried
 * in the error.
 */
export function parseCoreRiyaIntakeStateV1(value: unknown): CoreRiyaIntakeStateV1 {
  const parsed = stateSchema.safeParse(value);
  if (!parsed.success) {
    throw new CoreRiyaIntakeError('invalid-intake-state');
  }
  const data = parsed.data;
  return Object.freeze({
    version: 1 as const,
    tenantId: data.tenantId,
    conversationId: data.conversationId,
    subjectRef: data.subjectRef,
    stateRef: data.stateRef,
    // Rebuilt rather than passed through: the caller's nested objects stay the caller's, and an
    // absent evidence reference is an ABSENT KEY rather than one holding `undefined`.
    contact: Object.freeze({
      state: data.contact.state,
      ...(data.contact.evidenceRef === undefined ? {} : { evidenceRef: data.contact.evidenceRef }),
    }),
    consent: Object.freeze({
      state: data.consent.state,
      ...(data.consent.evidenceRef === undefined ? {} : { evidenceRef: data.consent.evidenceRef }),
    }),
  });
}

/**
 * What a reader is asked for: the full scope, never a subset.
 *
 * `conversationId` is mandatory rather than optional because consent is intake-scoped. An optional
 * conversation would make the subject-wide read the easy default, and the easy default is the one that
 * silently returns another conversation's `GRANTED`.
 */
export interface CoreRiyaIntakeReadInput {
  readonly tenantId: string;
  readonly conversationId: string;
  readonly subjectRef: string;
}
