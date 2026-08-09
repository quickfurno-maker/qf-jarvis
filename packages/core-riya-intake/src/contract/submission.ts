/**
 * The canonical Riya intake submission (RWC-P6, ADR-0101 §10–§13).
 *
 * ### The request is powerless, and that is its whole design
 *
 * This is `ApprovalRequestV1`'s lesson applied to the customer journey: *Jarvis may state what it
 * wants and why. It may never state what it got.* So `producingSystem` is the literal `qf-jarvis`,
 * and there is no outcome, no `canSubmit`, no consent claim, no lead reference and no decided field
 * anywhere in the shape. The schema is `.strict()`, so a caller cannot add one.
 *
 * Core still decides everything that matters at submission time: is contact ready, is consent valid
 * NOW, is the service/city pair still sold, may this become an intake at all.
 *
 * ### What the request carries, and what it deliberately does not
 *
 * It carries the canonical `NeedDiscovery` — re-proved through the REAL `createNeedDiscovery`, so the
 * one definition of a valid discovery snapshot stays in ADR-0067 rather than being restated here.
 *
 * It does NOT carry field provenance. After a structured confirmation every displayed value is
 * already client-confirmed conversationally, and Core does not need Jarvis's merge bookkeeping to own
 * its own decision. Sending it would be exporting an internal reducer's state as though it were
 * evidence.
 *
 * It carries no contact, no consent boolean, no transcript, no model output, no reason prose and no
 * metadata bag. Each of those is either Core's own truth, or personal data, or a place for a payload
 * to hide.
 *
 * ### `availabilitySnapshotRef` is submission-time evidence, not history
 *
 * It records which Core availability view Jarvis validated against **when it submitted**. It is NOT
 * the snapshot the client saw when they confirmed — continuity does not store that, and this contract
 * must not pretend otherwise. Claiming the stronger thing would be inventing an audit trail.
 *
 * ### Idempotency binds the business payload, not the click
 *
 * The key is required here and derived by the composition (RWC-P6B), never inside this pure package.
 * Its identity is the tenant, the conversation, the subject and the canonical discovery VALUES —
 * deliberately not the continuity revision, the action reference, a timestamp, the snapshot reference
 * or a nonce. A retry of the same business intake must derive the same key even though an irrelevant
 * conversational revision moved; a materially changed discovery is a different submission and must
 * derive a different one.
 *
 * Its GRAMMAR is not this package's to define. `@qf-jarvis/contracts` owns `idempotencyKeySchema` and
 * every governed artifact in the repository already keys off it; idempotency is a system safety
 * contract, and here the thing it protects is a real person receiving one enquiry rather than two. A
 * local restatement would agree with the original on the day it was written and diverge on the day one
 * of them was corrected — and a compatibility spec can only prove today's agreement, never tomorrow's.
 */
import { idempotencyKeySchema } from '@qf-jarvis/contracts';
import { createNeedDiscovery } from '@qf-jarvis/riya-agent';
import type { NeedDiscovery } from '@qf-jarvis/riya-agent';
import { z } from 'zod';

import { CoreRiyaIntakeError } from '../errors.js';
import {
  coreRiyaIntakeEvidenceRefSchema,
  coreRiyaIntakeIdentifierSchema,
  coreRiyaIntakeReasonCodeSchema,
  coreRiyaIntakeStateRefSchema,
} from './primitives.js';

/** This contract's version. Bumped when the SHAPE changes, never when Core's data changes. */
export const CORE_RIYA_INTAKE_CONTRACT_VERSION = 1 as const;

/** The one system that may produce a submission request. A literal, so it cannot be claimed. */
export const CORE_RIYA_INTAKE_PRODUCING_SYSTEM = 'qf-jarvis' as const;

/**
 * The four summary-required discovery fields, restated as the submission precondition.
 *
 * A submission without them is a lead with nothing in it. The reducer already refuses to reach
 * `SUMMARY` without them, and this is the same rule stated where the request is built — because a
 * request assembled by a future adapter must fail here rather than at Core.
 */
const SUBMISSION_REQUIRED_VALUE_KEYS = [
  'serviceInterestRef',
  'locationRef',
  'budgetNote',
  'timelineNote',
] as const;

/** One canonical, powerless intake submission. */
export interface CoreRiyaIntakeSubmissionRequestV1 {
  readonly contractVersion: 1;
  readonly producingSystem: typeof CORE_RIYA_INTAKE_PRODUCING_SYSTEM;
  readonly tenantId: string;
  readonly conversationId: string;
  readonly subjectRef: string;
  readonly continuityRevision: number;
  readonly intakeStateRef: string;
  readonly availabilitySnapshotRef: string;
  readonly taxonomyVersion: number;
  readonly discovery: NeedDiscovery;
  /** Literal `true`. A submission of an unconfirmed summary is not a thing this contract can express. */
  readonly summaryConfirmed: true;
  readonly idempotencyKey: string;
}

const requestSchema = z
  .object({
    contractVersion: z.literal(CORE_RIYA_INTAKE_CONTRACT_VERSION),
    producingSystem: z.literal(CORE_RIYA_INTAKE_PRODUCING_SYSTEM),
    tenantId: coreRiyaIntakeIdentifierSchema,
    conversationId: coreRiyaIntakeIdentifierSchema,
    subjectRef: coreRiyaIntakeIdentifierSchema,
    continuityRevision: z.int().min(0).max(Number.MAX_SAFE_INTEGER),
    intakeStateRef: coreRiyaIntakeStateRefSchema,
    availabilitySnapshotRef: coreRiyaIntakeStateRefSchema,
    taxonomyVersion: z.int().min(1).max(1_000_000),
    // Re-proved separately through the REAL constructor, for the same reason the continuity state
    // does it: a second copy of the discovery rules here is how this package and ADR-0067 would come
    // to disagree about what a valid snapshot is.
    discovery: z.looseObject({}),
    summaryConfirmed: z.literal(true),
    idempotencyKey: idempotencyKeySchema,
  })
  .strict();

/**
 * Build a frozen, canonical submission request, or refuse.
 *
 * Throws `CoreRiyaIntakeError('invalid-submission-request')`. Nothing about the rejected value
 * reaches the error — the discovery it carries is a description of a real person's home.
 */
export function createCoreRiyaIntakeSubmissionRequestV1(
  input: unknown,
): CoreRiyaIntakeSubmissionRequestV1 {
  const parsed = requestSchema.safeParse(input);
  if (!parsed.success) {
    throw new CoreRiyaIntakeError('invalid-submission-request');
  }
  const data = parsed.data;

  let discovery: NeedDiscovery;
  try {
    // Widened to `unknown` first: the schema proved it is an object, and `createNeedDiscovery`
    // safe-parses it against the real schema, so nothing here assumes a shape it has not checked.
    discovery = createNeedDiscovery(
      data.discovery as unknown as Parameters<typeof createNeedDiscovery>[0],
    );
  } catch {
    throw new CoreRiyaIntakeError('invalid-submission-request');
  }

  for (const key of SUBMISSION_REQUIRED_VALUE_KEYS) {
    if (typeof discovery[key] !== 'string') {
      throw new CoreRiyaIntakeError('invalid-submission-request');
    }
  }

  return Object.freeze({
    contractVersion: CORE_RIYA_INTAKE_CONTRACT_VERSION,
    producingSystem: CORE_RIYA_INTAKE_PRODUCING_SYSTEM,
    tenantId: data.tenantId,
    conversationId: data.conversationId,
    subjectRef: data.subjectRef,
    continuityRevision: data.continuityRevision,
    intakeStateRef: data.intakeStateRef,
    availabilitySnapshotRef: data.availabilitySnapshotRef,
    taxonomyVersion: data.taxonomyVersion,
    // `createNeedDiscovery` already returned a frozen record built from parsed values.
    discovery,
    summaryConfirmed: true as const,
    idempotencyKey: data.idempotencyKey,
  });
}

// ---------------------------------------------------------------------------
// The result.
// ---------------------------------------------------------------------------

/**
 * What Core decided. Four outcomes, and they are not interchangeable.
 *
 * `REJECTED` is a business decision. `NOT_READY` is a business state that may change. Neither means
 * a transport failed — a transport failure is not in this vocabulary at all, because this package
 * has no transport, and letting "we could not reach Core" arrive as `REJECTED` would turn an outage
 * into a refusal a client is told about.
 */
export const CORE_RIYA_INTAKE_OUTCOMES = [
  'ACCEPTED',
  'NOT_READY',
  'REJECTED',
  'HUMAN_REVIEW_REQUIRED',
] as const;
export type CoreRiyaIntakeOutcome = (typeof CORE_RIYA_INTAKE_OUTCOMES)[number];

export interface CoreRiyaIntakeSubmissionResultV1 {
  readonly contractVersion: 1;
  /** Echoed exactly. A result that does not name the submission it answers is unattributable. */
  readonly idempotencyKey: string;
  readonly outcome: CoreRiyaIntakeOutcome;
  /** Present exactly on `ACCEPTED`. The ONLY value that may reach continuity's evidence field. */
  readonly completionEvidenceRef?: string;
  /** Present on every non-accepted outcome. A token to count, never a sentence to read. */
  readonly reasonCode?: string;
}

const resultSchema = z
  .object({
    contractVersion: z.literal(CORE_RIYA_INTAKE_CONTRACT_VERSION),
    idempotencyKey: idempotencyKeySchema,
    outcome: z.enum(CORE_RIYA_INTAKE_OUTCOMES),
    completionEvidenceRef: coreRiyaIntakeEvidenceRefSchema.optional(),
    reasonCode: coreRiyaIntakeReasonCodeSchema.optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.outcome === 'ACCEPTED') {
      if (value.completionEvidenceRef === undefined) {
        ctx.addIssue({ code: 'custom', message: 'ACCEPTED requires completion evidence.' });
      }
      // A reason on an acceptance is a note about a decision that went the client's way; there is
      // nothing to count and nothing to explain.
      if (value.reasonCode !== undefined) {
        ctx.addIssue({ code: 'custom', message: 'ACCEPTED carries no reason code.' });
      }
      return;
    }
    if (value.completionEvidenceRef !== undefined) {
      ctx.addIssue({ code: 'custom', message: 'Only ACCEPTED carries completion evidence.' });
    }
    if (value.reasonCode === undefined) {
      ctx.addIssue({ code: 'custom', message: 'A non-accepted outcome requires a reason code.' });
    }
  });

/** Parse, prove and freeze a Core submission result. */
export function parseCoreRiyaIntakeSubmissionResultV1(
  value: unknown,
): CoreRiyaIntakeSubmissionResultV1 {
  const parsed = resultSchema.safeParse(value);
  if (!parsed.success) {
    throw new CoreRiyaIntakeError('invalid-submission-result');
  }
  const data = parsed.data;
  return Object.freeze({
    contractVersion: CORE_RIYA_INTAKE_CONTRACT_VERSION,
    idempotencyKey: data.idempotencyKey,
    outcome: data.outcome,
    ...(data.completionEvidenceRef === undefined
      ? {}
      : { completionEvidenceRef: data.completionEvidenceRef }),
    ...(data.reasonCode === undefined ? {} : { reasonCode: data.reasonCode }),
  });
}

// ---------------------------------------------------------------------------
// The lookup.
// ---------------------------------------------------------------------------

/**
 * What Core previously recorded for an idempotency key.
 *
 * This exists for one situation, and it is the one that matters most: a submission whose transport
 * outcome was indeterminate. Jarvis must never resubmit on uncertainty — that is how a client gets
 * two enquiries — so the only safe recovery is to ask Core what it already recorded.
 *
 * A lookup authorizes nothing. It reports.
 *
 * ### Every lookup echoes the key it answers — including `NOT_FOUND`
 *
 * A bare `NOT_FOUND` cannot say WHICH key was not found, and that is the one thing the recovery path
 * needs to know. Ask for key A, let a buggy adapter or a stale cache answer `NOT_FOUND` for key B, and
 * the artifact carries nothing to catch it with: the composition concludes A was never submitted and
 * submits it again. The mechanism that exists to prevent a duplicate enquiry has produced one.
 *
 * So the key is REQUIRED on both statuses, and on `FOUND` the nested result's key must equal it
 * exactly. Two identifiers that must agree, checked here rather than left to each caller to remember —
 * because the caller who forgets is the one recovering from an outage at the worst moment.
 *
 * The parser proves internal agreement. It cannot know what the caller ASKED for, so RWC-P6B carries
 * the other half: `lookup.idempotencyKey` must equal the key it queried, and a mismatch fails closed
 * without submitting, without retrying under another key, and without being read as `NOT_FOUND`.
 */
export const CORE_RIYA_INTAKE_LOOKUP_STATUSES = ['NOT_FOUND', 'FOUND'] as const;
export type CoreRiyaIntakeLookupStatus = (typeof CORE_RIYA_INTAKE_LOOKUP_STATUSES)[number];

export interface CoreRiyaIntakeSubmissionLookupV1 {
  readonly contractVersion: 1;
  /** The key this answer is ABOUT. Required on every status; an unattributed answer is unusable. */
  readonly idempotencyKey: string;
  readonly status: CoreRiyaIntakeLookupStatus;
  /** Present exactly when `status` is `FOUND`, and keyed identically. */
  readonly result?: CoreRiyaIntakeSubmissionResultV1;
}

const lookupSchema = z
  .object({
    contractVersion: z.literal(CORE_RIYA_INTAKE_CONTRACT_VERSION),
    idempotencyKey: idempotencyKeySchema,
    status: z.enum(CORE_RIYA_INTAKE_LOOKUP_STATUSES),
    result: z.unknown().optional(),
  })
  .strict();

/** Parse, prove and freeze a Core submission lookup. */
export function parseCoreRiyaIntakeSubmissionLookupV1(
  value: unknown,
): CoreRiyaIntakeSubmissionLookupV1 {
  const parsed = lookupSchema.safeParse(value);
  if (!parsed.success) {
    throw new CoreRiyaIntakeError('invalid-lookup-result');
  }
  const data = parsed.data;
  if (data.status === 'NOT_FOUND') {
    if (data.result !== undefined) {
      throw new CoreRiyaIntakeError('invalid-lookup-result');
    }
    return Object.freeze({
      contractVersion: CORE_RIYA_INTAKE_CONTRACT_VERSION,
      idempotencyKey: data.idempotencyKey,
      status: 'NOT_FOUND',
    });
  }
  if (data.result === undefined) {
    throw new CoreRiyaIntakeError('invalid-lookup-result');
  }
  // The nested result is re-proved through the REAL result parser, not trusted because it arrived
  // inside a lookup. A forged result smuggled through a wrapper would otherwise be the one path into
  // continuity's completion evidence that skipped every rule.
  let result: CoreRiyaIntakeSubmissionResultV1;
  try {
    result = parseCoreRiyaIntakeSubmissionResultV1(data.result);
  } catch {
    throw new CoreRiyaIntakeError('invalid-lookup-result');
  }
  // A wrapper saying "here is the answer for key A" around a result that answers key B is not a
  // formatting slip: it is two different submissions being conflated, and the completion evidence
  // inside it belongs to somebody else's enquiry.
  if (result.idempotencyKey !== data.idempotencyKey) {
    throw new CoreRiyaIntakeError('invalid-lookup-result');
  }
  return Object.freeze({
    contractVersion: CORE_RIYA_INTAKE_CONTRACT_VERSION,
    idempotencyKey: data.idempotencyKey,
    status: 'FOUND' as const,
    result,
  });
}
