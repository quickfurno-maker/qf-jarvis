/**
 * AVG-5 — the Aarohi Instagram conversation OFFLINE DOMAIN (ADR-0122).
 *
 * The overlay sentence this file exists to satisfy, in full:
 *
 * > Governed inbound/outbound conversation on Instagram. Delivery remains provider-side and
 * > execution remains n8n-side; Aarohi holds no provider credential and calls no Meta API. Consent
 * > and eligibility are Core's, revalidated at execution time.
 *
 * Every clause of that is structural here rather than aspirational.
 *
 * ### The channel token is LOCAL, and deliberately so
 *
 * The repository's shared governed outbound channel vocabulary is `whatsapp`, `sms`, `email`,
 * `voice`. Instagram is not a member, and AVG-5 does not add it.
 *
 * That omission is the decision, not an oversight. A member of the shared vocabulary is a channel a
 * `CommunicationRequestV1` may name, which pulls it into the eighteen-state delivery lifecycle with
 * its `provider-accepted` and `delivered` states — states nothing in this repository could honestly
 * assert for Instagram, because there is no Core -> n8n -> Instagram execution path yet and no
 * provider adapter to report one. Naming a channel there is a promise that a transport exists.
 *
 * The owner's sequencing is explicit: finish Aarohi AVG-5..AVG-12 first, then adopt the real
 * governed execution highway under QFJ-P09. Adopting an executable Instagram channel now would be
 * that later work smuggled in by an offline domain slice. So `AAROHI_AVG5_CHANNEL` below is an
 * Aarohi-local conversation token; it is NOT a `CommunicationChannel` and cannot become one by being
 * assigned to a variable of that type, because this package imports no shared contract at all.
 *
 * ### What is untrusted, and what is authoritative
 *
 * An inbound observation is an OFFLINE INJECTED report about a conversation. It is not authenticated
 * provider output, and its `sourcePosture` says so in a word nobody could misread. Its text is
 * normalized and never interpreted: this slice does not read a message and conclude consent,
 * suppression, identity, registration, payment or package truth. Core owns those, and AVG-7 owns
 * conversation interpretation as advisory evidence later.
 *
 * ### Channel-local identity is not identity
 *
 * An Instagram participant reference is a handle on one channel. It is not a Core vendor id, not a
 * cross-channel identity, and it never merges two prospects. Omnichannel identity resolution is
 * AVG-6's, and nothing here pre-empts it: there is no function that takes two prospect references,
 * and the binding posture is spelled `CALLER_ASSERTED_OFFLINE_INSTAGRAM_BINDING` precisely so it
 * cannot be read as `VERIFIED_IDENTITY`.
 *
 * ### Outbound is a CANDIDATE, and the word is load-bearing
 *
 * An outbound candidate is assembled from an existing canonical AVG-4 OPEN draft, after the CURRENT
 * Core gate has been re-run through AVG-4's own readiness function. It is not approved, not
 * authorized, not consented, not execution-eligible, not a `CommunicationRequestV1`, not an
 * `ExecutionIntentV1`, not sent and not delivered — and it states every one of those as a literal
 * `false` rather than leaving a reader to infer it from silence.
 *
 * Pure domain only: no runtime, persistence, model call, network, provider, transport or execution.
 */
import { z } from 'zod';

import {
  evaluateWorkspaceApprovalReadiness,
  parseWorkspaceDraft,
} from './avg4-outreach-workspace.js';
import {
  coreEligibilityObservationSchema,
  evaluateAcquisitionEligibility,
} from './existing-vendor-gate.js';
import type { AcquisitionRefusalReason, CorePartyStatus } from './existing-vendor-gate.js';

/** Version of the complete AVG-5 offline Instagram conversation contract in this package. */
export const AAROHI_AVG5_CONTRACT_VERSION = 1 as const;
export type AarohiAvg5ContractVersion = typeof AAROHI_AVG5_CONTRACT_VERSION;

/**
 * The AVG-5 conversation channel token.
 *
 * AAROHI-LOCAL. Not the shared `CommunicationChannel`, and not a governed delivery channel: this
 * package imports no shared communication contract, so there is nothing for this literal to widen.
 * See the file header for why the shared vocabulary is deliberately left alone.
 */
export const AAROHI_AVG5_CHANNEL = 'instagram' as const;
export type AarohiAvg5Channel = typeof AAROHI_AVG5_CHANNEL;

/**
 * The only direction AVG-5 can record as a conversation TURN.
 *
 * There is no `OUTBOUND` member, and that is the structural reason an outbound candidate can never
 * be appended to conversation history as though it had been said. Real outbound turns become
 * observable only when something actually sends one, which requires an execution path that does not
 * exist here.
 */
export const INSTAGRAM_TURN_DIRECTIONS = ['INBOUND'] as const;
export type InstagramTurnDirection = (typeof INSTAGRAM_TURN_DIRECTIONS)[number];

/**
 * Where an inbound observation came from, stated unflatteringly.
 *
 * Injected, offline, and asserted by whoever called this function. It is NOT provider-authenticated
 * output, and no field anywhere in this file may claim otherwise.
 */
export const INSTAGRAM_OBSERVATION_SOURCE_POSTURE =
  'INJECTED_OFFLINE_INSTAGRAM_OBSERVATION' as const;
export type InstagramObservationSourcePosture = typeof INSTAGRAM_OBSERVATION_SOURCE_POSTURE;

/**
 * How a conversation came to be associated with a prospect.
 *
 * The caller said so. That is the entire basis, and the name says the entire basis. Resolving who a
 * channel-local participant really is belongs to AVG-6.
 */
export const INSTAGRAM_BINDING_POSTURE = 'CALLER_ASSERTED_OFFLINE_INSTAGRAM_BINDING' as const;
export type InstagramBindingPosture = typeof INSTAGRAM_BINDING_POSTURE;

/** Message text is bounded because a conversation snapshot is a review surface, not a log sink. */
export const MAX_INSTAGRAM_MESSAGE_LENGTH = 2_000;

/** A conversation snapshot is finite. Unbounded history is a store, and there is no store here. */
export const MAX_INSTAGRAM_CONVERSATION_TURNS = 100;

// ---------------------------------------------------------------------------
// Shared primitives.
//
// Deliberately declared HERE rather than imported from AVG-4. Reaching into a certified sibling to
// borrow a private regex would widen that file's surface for this file's convenience; instead the
// grammars are restated and a spec asserts AVG-4 and AVG-5 agree on every one of them, so the
// duplication cannot drift without a test failing.
// ---------------------------------------------------------------------------

const OPAQUE_REF = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9._:-]+$/u);

const UTC_INSTANT_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{3}))?Z$/u;

function isCanonicalUtcInstant(value: string): boolean {
  const parts = UTC_INSTANT_PATTERN.exec(value);
  if (parts === null) return false;

  const year = Number(parts[1] ?? '');
  const month = Number(parts[2] ?? '');
  const day = Number(parts[3] ?? '');
  const hour = Number(parts[4] ?? '');
  const minute = Number(parts[5] ?? '');
  const second = Number(parts[6] ?? '');

  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  if (hour > 23 || minute > 59 || second > 59) return false;

  const roundTrip = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  return (
    roundTrip.getUTCFullYear() === year &&
    roundTrip.getUTCMonth() === month - 1 &&
    roundTrip.getUTCDate() === day
  );
}

const UTC_INSTANT = z.string().refine(isCanonicalUtcInstant);

function hasRefusedControlCharacter(value: string): boolean {
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (
      (code >= 0 && code <= 8) ||
      code === 11 ||
      code === 12 ||
      (code >= 14 && code <= 31) ||
      code === 127
    ) {
      return true;
    }
  }
  return false;
}

/**
 * The canonical body grammar.
 *
 * Bounded, trimmed, no carriage return, no control characters. The USER'S WORDS are otherwise
 * preserved exactly: normalizing is not interpreting, and this file does not read what was said.
 */
const MESSAGE_BODY = z
  .string()
  .min(1)
  .max(MAX_INSTAGRAM_MESSAGE_LENGTH)
  .refine((one: string) => one === one.trim())
  .refine((one: string) => !one.includes('\r'))
  .refine((one: string) => !hasRefusedControlCharacter(one));

function canonicalizeBody(value: string): string {
  return value.replace(/\r\n?/gu, '\n').trim();
}

// ---------------------------------------------------------------------------
// Inbound observation.
// ---------------------------------------------------------------------------

/**
 * One inbound Instagram message, as an OBSERVATION.
 *
 * There is deliberately no field for consent, opt-out, suppression, identity verification,
 * registration, activation, approval, authorization, provider acceptance or delivery. Those are
 * conclusions and authority; an observation of a message carries neither, and the schema below is
 * strict so a caller that attaches one is refused rather than quietly narrowed.
 */
export interface InstagramInboundObservation {
  readonly contractVersion: AarohiAvg5ContractVersion;
  readonly channel: AarohiAvg5Channel;
  readonly direction: InstagramTurnDirection;
  /** Aarohi's own prospect handle. Never derived from the participant reference below. */
  readonly prospectRef: string;
  readonly instagramConversationRef: string;
  readonly instagramThreadRef: string;
  /** CHANNEL-LOCAL. Not a Core vendor id, not a cross-channel identity, never a prospect handle. */
  readonly instagramParticipantRef: string;
  readonly instagramMessageRef: string;
  readonly body: string;
  /** The instant the message was reported to have been observed. Caller-asserted, never a clock. */
  readonly observedAt: string;
  readonly sourcePosture: InstagramObservationSourcePosture;
}

/** Canonical schema for a BUILT observation, so the contract says one thing to every reader. */
export const instagramInboundObservationSchema = z
  .object({
    contractVersion: z.literal(AAROHI_AVG5_CONTRACT_VERSION),
    channel: z.literal(AAROHI_AVG5_CHANNEL),
    direction: z.literal('INBOUND'),
    prospectRef: OPAQUE_REF,
    instagramConversationRef: OPAQUE_REF,
    instagramThreadRef: OPAQUE_REF,
    instagramParticipantRef: OPAQUE_REF,
    instagramMessageRef: OPAQUE_REF,
    body: MESSAGE_BODY,
    observedAt: UTC_INSTANT,
    sourcePosture: z.literal(INSTAGRAM_OBSERVATION_SOURCE_POSTURE),
  })
  .strict();

/** What a caller may state. The posture, the channel, the direction and the version are NOT theirs. */
const inboundObservationInputSchema = z
  .object({
    prospectRef: OPAQUE_REF,
    instagramConversationRef: OPAQUE_REF,
    instagramThreadRef: OPAQUE_REF,
    instagramParticipantRef: OPAQUE_REF,
    instagramMessageRef: OPAQUE_REF,
    body: z.string(),
    observedAt: UTC_INSTANT,
  })
  .strict();

export const INSTAGRAM_OBSERVATION_REFUSALS = [
  'OBSERVATION_INPUT_INVALID',
  'BODY_INVALID',
] as const;
export type InstagramObservationRefusal = (typeof INSTAGRAM_OBSERVATION_REFUSALS)[number];

export type InstagramInboundObservationResult =
  | { readonly ok: true; readonly observation: InstagramInboundObservation }
  | { readonly ok: false; readonly refusal: InstagramObservationRefusal };

/**
 * Normalize one inbound Instagram observation, or refuse.
 *
 * The channel, direction, contract version and source posture are STAMPED here rather than accepted,
 * so a caller cannot describe its own injected fixture as anything else — there is no input field
 * for `sourcePosture`, which is why no fixture can claim to be provider-authenticated.
 */
export function parseInstagramInboundObservation(
  value: unknown,
): InstagramInboundObservationResult {
  const parsed = inboundObservationInputSchema.safeParse(value);
  if (!parsed.success) {
    return Object.freeze({ ok: false as const, refusal: 'OBSERVATION_INPUT_INVALID' as const });
  }

  const body = canonicalizeBody(parsed.data.body);
  if (!MESSAGE_BODY.safeParse(body).success) {
    return Object.freeze({ ok: false as const, refusal: 'BODY_INVALID' as const });
  }

  return Object.freeze({
    ok: true as const,
    observation: Object.freeze({
      contractVersion: AAROHI_AVG5_CONTRACT_VERSION,
      channel: AAROHI_AVG5_CHANNEL,
      direction: 'INBOUND' as const,
      prospectRef: parsed.data.prospectRef,
      instagramConversationRef: parsed.data.instagramConversationRef,
      instagramThreadRef: parsed.data.instagramThreadRef,
      instagramParticipantRef: parsed.data.instagramParticipantRef,
      instagramMessageRef: parsed.data.instagramMessageRef,
      body,
      observedAt: parsed.data.observedAt,
      sourcePosture: INSTAGRAM_OBSERVATION_SOURCE_POSTURE,
    }),
  });
}

// ---------------------------------------------------------------------------
// The conversation snapshot.
// ---------------------------------------------------------------------------

/**
 * A bounded, immutable snapshot of one Instagram conversation.
 *
 * ### Ordering is CANONICAL, not arrival order
 *
 * Turns are held sorted by `observedAt`, then by `instagramMessageRef` to break ties. That policy is
 * chosen deliberately over strict append-order refusal: provider events genuinely arrive out of
 * order, and refusing a late-arriving observation would discard a real one rather than record it.
 *
 * The consequence is stated rather than left implicit: ARRAY POSITION CARRIES NO CHRONOLOGICAL CLAIM
 * of its own. What a reader may rely on is `observedAt`, which is itself only what the caller
 * asserted about an offline injected report. Two turns bearing the same instant are ordered by their
 * message reference, which is arbitrary but deterministic — and being deterministic is the property
 * that matters, because a snapshot that reordered itself between reads could not be compared.
 */
export interface InstagramConversationSnapshot {
  readonly contractVersion: AarohiAvg5ContractVersion;
  readonly channel: AarohiAvg5Channel;
  readonly bindingPosture: InstagramBindingPosture;
  readonly prospectRef: string;
  readonly instagramConversationRef: string;
  readonly instagramThreadRef: string;
  readonly instagramParticipantRef: string;
  readonly inboundTurns: readonly InstagramInboundObservation[];
}

export const instagramConversationSnapshotSchema = z
  .object({
    contractVersion: z.literal(AAROHI_AVG5_CONTRACT_VERSION),
    channel: z.literal(AAROHI_AVG5_CHANNEL),
    bindingPosture: z.literal(INSTAGRAM_BINDING_POSTURE),
    prospectRef: OPAQUE_REF,
    instagramConversationRef: OPAQUE_REF,
    instagramThreadRef: OPAQUE_REF,
    instagramParticipantRef: OPAQUE_REF,
    inboundTurns: z.array(instagramInboundObservationSchema).max(MAX_INSTAGRAM_CONVERSATION_TURNS),
  })
  .strict();

export const INSTAGRAM_CONVERSATION_REFUSALS = [
  'CONVERSATION_INPUT_INVALID',
  'CONVERSATION_INVALID',
  'OBSERVATION_INVALID',
  'BINDING_MISMATCH',
  'MESSAGE_DUPLICATE',
  'TURN_LIMIT_REACHED',
] as const;
export type InstagramConversationRefusal = (typeof INSTAGRAM_CONVERSATION_REFUSALS)[number];

export type InstagramConversationResult =
  | { readonly ok: true; readonly conversation: InstagramConversationSnapshot }
  | { readonly ok: false; readonly refusal: InstagramConversationRefusal };

const conversationInputSchema = z
  .object({
    prospectRef: OPAQUE_REF,
    instagramConversationRef: OPAQUE_REF,
    instagramThreadRef: OPAQUE_REF,
    instagramParticipantRef: OPAQUE_REF,
  })
  .strict();

/**
 * Re-parse and REBUILD a snapshot from whatever was handed in.
 *
 * A declared TypeScript type is erased before any of this runs, so trusting one would be trusting
 * the caller. Every turn is re-parsed through the canonical observation schema and rebuilt, which is
 * also what detaches the result from any array the caller still holds a reference to.
 */
export function parseInstagramConversation(
  value: unknown,
): InstagramConversationSnapshot | undefined {
  const parsed = instagramConversationSnapshotSchema.safeParse(value);
  if (!parsed.success) return undefined;

  const turns = parsed.data.inboundTurns.map((turn) => Object.freeze({ ...turn }));
  return Object.freeze({
    contractVersion: AAROHI_AVG5_CONTRACT_VERSION,
    channel: AAROHI_AVG5_CHANNEL,
    bindingPosture: INSTAGRAM_BINDING_POSTURE,
    prospectRef: parsed.data.prospectRef,
    instagramConversationRef: parsed.data.instagramConversationRef,
    instagramThreadRef: parsed.data.instagramThreadRef,
    instagramParticipantRef: parsed.data.instagramParticipantRef,
    inboundTurns: Object.freeze(turns),
  });
}

/** Open an empty conversation. There is no way to seed one with turns nobody parsed. */
export function createInstagramConversation(value: unknown): InstagramConversationResult {
  const parsed = conversationInputSchema.safeParse(value);
  if (!parsed.success) {
    return Object.freeze({ ok: false as const, refusal: 'CONVERSATION_INPUT_INVALID' as const });
  }

  return Object.freeze({
    ok: true as const,
    conversation: Object.freeze({
      contractVersion: AAROHI_AVG5_CONTRACT_VERSION,
      channel: AAROHI_AVG5_CHANNEL,
      bindingPosture: INSTAGRAM_BINDING_POSTURE,
      prospectRef: parsed.data.prospectRef,
      instagramConversationRef: parsed.data.instagramConversationRef,
      instagramThreadRef: parsed.data.instagramThreadRef,
      instagramParticipantRef: parsed.data.instagramParticipantRef,
      inboundTurns: Object.freeze([] as readonly InstagramInboundObservation[]),
    }),
  });
}

function canonicalTurnOrder(
  left: InstagramInboundObservation,
  right: InstagramInboundObservation,
): number {
  if (left.observedAt !== right.observedAt) {
    return left.observedAt < right.observedAt ? -1 : 1;
  }
  return left.instagramMessageRef < right.instagramMessageRef ? -1 : 1;
}

/**
 * Append one canonical inbound observation, returning a NEW snapshot.
 *
 * Every binding is re-checked. A turn from another prospect, another conversation, another thread or
 * another participant is refused rather than absorbed: an observation about a different exchange is
 * not weak evidence about this one, it is none. A repeated `instagramMessageRef` is refused too,
 * because provider redelivery is normal and counting one message twice would make a conversation
 * look busier than it was.
 */
export function appendInstagramInboundObservation(
  conversationValue: unknown,
  observationValue: unknown,
): InstagramConversationResult {
  const conversation = parseInstagramConversation(conversationValue);
  if (conversation === undefined) {
    return Object.freeze({ ok: false as const, refusal: 'CONVERSATION_INVALID' as const });
  }

  const parsed = instagramInboundObservationSchema.safeParse(observationValue);
  if (!parsed.success) {
    return Object.freeze({ ok: false as const, refusal: 'OBSERVATION_INVALID' as const });
  }
  const observation = parsed.data;

  if (
    observation.prospectRef !== conversation.prospectRef ||
    observation.instagramConversationRef !== conversation.instagramConversationRef ||
    observation.instagramThreadRef !== conversation.instagramThreadRef ||
    observation.instagramParticipantRef !== conversation.instagramParticipantRef
  ) {
    return Object.freeze({ ok: false as const, refusal: 'BINDING_MISMATCH' as const });
  }

  if (
    conversation.inboundTurns.some(
      (turn) => turn.instagramMessageRef === observation.instagramMessageRef,
    )
  ) {
    return Object.freeze({ ok: false as const, refusal: 'MESSAGE_DUPLICATE' as const });
  }

  if (conversation.inboundTurns.length >= MAX_INSTAGRAM_CONVERSATION_TURNS) {
    return Object.freeze({ ok: false as const, refusal: 'TURN_LIMIT_REACHED' as const });
  }

  const turns = [...conversation.inboundTurns, Object.freeze({ ...observation })].sort(
    canonicalTurnOrder,
  );

  return Object.freeze({
    ok: true as const,
    conversation: Object.freeze({
      ...conversation,
      inboundTurns: Object.freeze(turns),
    }),
  });
}

// ---------------------------------------------------------------------------
// Inbound continuation: receiving a message is not permission to keep going.
// ---------------------------------------------------------------------------

/**
 * What Aarohi may do about an Instagram conversation it has observed.
 *
 * `CONTINUE_AAROHI_ACQUISITION_REVIEW` means a human may keep reviewing this prospect. It is not
 * contact eligibility, not send eligibility, not consent, and not a reply instruction.
 */
export const INSTAGRAM_CONTINUATION_OUTCOMES = [
  'CONTINUE_AAROHI_ACQUISITION_REVIEW',
  'STOP_AAROHI_ACQUISITION',
] as const;
export type InstagramContinuationOutcome = (typeof INSTAGRAM_CONTINUATION_OUTCOMES)[number];

export type InstagramContinuationVerdict =
  | {
      readonly contractVersion: AarohiAvg5ContractVersion;
      readonly outcome: 'CONTINUE_AAROHI_ACQUISITION_REVIEW';
      readonly prospectRef: string;
      readonly coreStatus: CorePartyStatus;
    }
  | {
      readonly contractVersion: AarohiAvg5ContractVersion;
      readonly outcome: 'STOP_AAROHI_ACQUISITION';
      readonly refusal: 'CONVERSATION_INVALID';
    }
  | {
      readonly contractVersion: AarohiAvg5ContractVersion;
      readonly outcome: 'STOP_AAROHI_ACQUISITION';
      readonly refusal: 'CORE_GATE_REFUSED';
      readonly prospectRef: string;
      readonly coreReason: AcquisitionRefusalReason;
    };

/**
 * Decide whether Aarohi may keep reviewing this prospect, given CURRENT Core truth.
 *
 * The Core question is delegated to the AVG-1 gate and not restated: the status map lives in exactly
 * one place, so a status added to Core cannot mean one thing to the workspace and another to a
 * conversation. `ACTIVE` stops here like every other existing relationship — and stopping is all it
 * does, because ending Aarohi's ownership requires the canonical Core ACTIVE handoff boundary and
 * nothing in this file can reach it.
 *
 * The message text is not consulted. It could not be: this function never receives a body.
 */
export function evaluateInstagramAcquisitionContinuation(
  conversationValue: unknown,
  coreObservation: unknown,
): InstagramContinuationVerdict {
  const conversation = parseInstagramConversation(conversationValue);
  if (conversation === undefined) {
    return Object.freeze({
      contractVersion: AAROHI_AVG5_CONTRACT_VERSION,
      outcome: 'STOP_AAROHI_ACQUISITION' as const,
      refusal: 'CONVERSATION_INVALID' as const,
    });
  }

  const core = evaluateAcquisitionEligibility(conversation.prospectRef, coreObservation);
  if (!core.eligible) {
    return Object.freeze({
      contractVersion: AAROHI_AVG5_CONTRACT_VERSION,
      outcome: 'STOP_AAROHI_ACQUISITION' as const,
      refusal: 'CORE_GATE_REFUSED' as const,
      prospectRef: conversation.prospectRef,
      coreReason: core.reason,
    });
  }

  return Object.freeze({
    contractVersion: AAROHI_AVG5_CONTRACT_VERSION,
    outcome: 'CONTINUE_AAROHI_ACQUISITION_REVIEW' as const,
    prospectRef: conversation.prospectRef,
    coreStatus: core.status,
  });
}

// ---------------------------------------------------------------------------
// Outbound candidate.
// ---------------------------------------------------------------------------

/**
 * The single positive thing an outbound candidate may say.
 *
 * Deliberately long, and deliberately containing the word FUTURE. `READY_TO_SEND`, `SEND_ALLOWED`,
 * `AUTHORIZED`, `EXECUTABLE` and `PROVIDER_READY` are all things this repository cannot make true
 * for Instagram today, and a token is read by people who will not read the file it came from.
 */
export const INSTAGRAM_OUTBOUND_CANDIDATE_OUTCOME =
  'READY_FOR_FUTURE_CORE_INSTAGRAM_COMMUNICATION_PATH' as const;
export type InstagramOutboundCandidateOutcome = typeof INSTAGRAM_OUTBOUND_CANDIDATE_OUTCOME;

/**
 * The negative facts, stated as literals a machine can check.
 *
 * Every field is `false` and every field is a thing somebody might otherwise assume happened. A
 * posture that could hold `true` for any of them would be a posture worth lying with, so the schema
 * pins each one to the literal.
 */
export interface InstagramOutboundCandidatePosture {
  readonly candidateOnly: true;
  readonly requiresCoreExecutionTimeRevalidation: true;
  readonly communicationRequestCreated: false;
  readonly approvalRequestCreated: false;
  readonly approvalDecisionCreated: false;
  readonly communicationAuthorizationCreated: false;
  readonly executionIntentCreated: false;
  readonly n8nExecutionRequested: false;
  readonly metaApiCalled: false;
  readonly providerSendRequested: false;
  readonly sent: false;
  readonly delivered: false;
  readonly businessEffect: false;
  readonly productionMutation: false;
}

export const instagramOutboundCandidatePostureSchema = z
  .object({
    candidateOnly: z.literal(true),
    requiresCoreExecutionTimeRevalidation: z.literal(true),
    communicationRequestCreated: z.literal(false),
    approvalRequestCreated: z.literal(false),
    approvalDecisionCreated: z.literal(false),
    communicationAuthorizationCreated: z.literal(false),
    executionIntentCreated: z.literal(false),
    n8nExecutionRequested: z.literal(false),
    metaApiCalled: z.literal(false),
    providerSendRequested: z.literal(false),
    sent: z.literal(false),
    delivered: z.literal(false),
    businessEffect: z.literal(false),
    productionMutation: z.literal(false),
  })
  .strict();

/** The one frozen posture value. Reused, never rebuilt from anything a caller supplied. */
export const INSTAGRAM_OUTBOUND_CANDIDATE_POSTURE: InstagramOutboundCandidatePosture =
  Object.freeze(
    instagramOutboundCandidatePostureSchema.parse({
      candidateOnly: true,
      requiresCoreExecutionTimeRevalidation: true,
      communicationRequestCreated: false,
      approvalRequestCreated: false,
      approvalDecisionCreated: false,
      communicationAuthorizationCreated: false,
      executionIntentCreated: false,
      n8nExecutionRequested: false,
      metaApiCalled: false,
      providerSendRequested: false,
      sent: false,
      delivered: false,
      businessEffect: false,
      productionMutation: false,
    }),
  );

/**
 * An inert outbound candidate.
 *
 * The body is the canonical AVG-4 draft's body, and `draftRef`/`draftRevision` name exactly which
 * revision it came from — so a reader can go and look at the words a human actually reviewed rather
 * than at a copy that may have drifted from them.
 *
 * `coreStatus` is HISTORY: the status the gate observed at the moment this candidate was prepared.
 * It is not a permission and it does not become one by being written down, which is what
 * `requiresCoreExecutionTimeRevalidation` exists to say out loud.
 */
export interface InstagramOutboundCandidate {
  readonly contractVersion: AarohiAvg5ContractVersion;
  readonly channel: AarohiAvg5Channel;
  readonly outcome: InstagramOutboundCandidateOutcome;
  readonly candidateRef: string;
  readonly prospectRef: string;
  readonly draftRef: string;
  readonly draftRevision: number;
  readonly body: string;
  readonly instagramConversationRef: string;
  readonly instagramThreadRef: string;
  readonly instagramParticipantRef: string;
  readonly bindingPosture: InstagramBindingPosture;
  /**
   * The Core status OBSERVED when this candidate was prepared. History, never permission.
   *
   * Narrowed to the one allowlisted status, so the type itself cannot describe a candidate prepared
   * against a suppressed or unresolved prospect. The schema pins the same literal at runtime.
   */
  readonly coreStatus: Extract<CorePartyStatus, 'NOT_REGISTERED'>;
  readonly coreLookupRef: string;
  readonly preparedAt: string;
  readonly posture: InstagramOutboundCandidatePosture;
}

export const instagramOutboundCandidateSchema = z
  .object({
    contractVersion: z.literal(AAROHI_AVG5_CONTRACT_VERSION),
    channel: z.literal(AAROHI_AVG5_CHANNEL),
    outcome: z.literal(INSTAGRAM_OUTBOUND_CANDIDATE_OUTCOME),
    candidateRef: OPAQUE_REF,
    prospectRef: OPAQUE_REF,
    draftRef: OPAQUE_REF,
    draftRevision: z.number().int().min(1),
    body: MESSAGE_BODY,
    instagramConversationRef: OPAQUE_REF,
    instagramThreadRef: OPAQUE_REF,
    instagramParticipantRef: OPAQUE_REF,
    bindingPosture: z.literal(INSTAGRAM_BINDING_POSTURE),
    coreStatus: z.literal('NOT_REGISTERED'),
    coreLookupRef: OPAQUE_REF,
    preparedAt: UTC_INSTANT,
    posture: instagramOutboundCandidatePostureSchema,
  })
  .strict();

export const INSTAGRAM_OUTBOUND_CANDIDATE_REFUSALS = [
  'CANDIDATE_INPUT_INVALID',
  'CONVERSATION_INVALID',
  'WORKSPACE_DRAFT_INVALID',
  'PROFILE_INVALID',
  'PROSPECT_MISMATCH',
  'WORKSPACE_DRAFT_NOT_OPEN',
  'CORE_GATE_REFUSED',
  'OUTBOUND_CANDIDATE_INVALID',
] as const;
export type InstagramOutboundCandidateRefusal =
  (typeof INSTAGRAM_OUTBOUND_CANDIDATE_REFUSALS)[number];

export type InstagramOutboundCandidateResult =
  | { readonly ok: true; readonly candidate: InstagramOutboundCandidate }
  | {
      readonly ok: false;
      readonly refusal: Exclude<InstagramOutboundCandidateRefusal, 'CORE_GATE_REFUSED'>;
    }
  | {
      readonly ok: false;
      readonly refusal: 'CORE_GATE_REFUSED';
      readonly coreReason: AcquisitionRefusalReason;
    };

/**
 * What a caller may state when preparing a candidate.
 *
 * Note what is absent: there is NO `body` field. The words come from the canonical draft and from
 * nowhere else, so a caller cannot review one message and prepare a different one. There is also no
 * field for a channel, an outcome, a posture, a Core status or a contract version — every one of
 * those is decided here or by the functions this delegates to.
 */
const outboundCandidateInputSchema = z
  .object({
    candidateRef: OPAQUE_REF,
    draft: z.unknown(),
    profile: z.unknown(),
    coreObservation: z.unknown(),
    conversation: z.unknown(),
    preparedAt: UTC_INSTANT,
  })
  .strict();

/**
 * Prepare an inert Instagram outbound candidate from a canonical AVG-4 OPEN draft.
 *
 * ### The CURRENT Core gate is re-run, every time
 *
 * `evaluateWorkspaceApprovalReadiness` is called rather than reimplemented, so AVG-4's rules and
 * AVG-3's Core gate cannot say one thing to the workspace and another to Instagram. That is also
 * what makes a stale review worthless as permission: an earlier `NOT_REGISTERED` decides nothing,
 * because the observation handed in HERE is the one consulted. A prospect that has since become
 * `DO_NOT_CONTACT`, `REGISTERED`, `ACTIVE` or `UNKNOWN` yields no candidate, whatever any earlier
 * review concluded and whatever priority the prospect scored — priority is not an input to this
 * function at all.
 */
export function prepareInstagramOutboundCandidate(
  value: unknown,
): InstagramOutboundCandidateResult {
  const parsed = outboundCandidateInputSchema.safeParse(value);
  if (!parsed.success) {
    return Object.freeze({ ok: false as const, refusal: 'CANDIDATE_INPUT_INVALID' as const });
  }

  const conversation = parseInstagramConversation(parsed.data.conversation);
  if (conversation === undefined) {
    return Object.freeze({ ok: false as const, refusal: 'CONVERSATION_INVALID' as const });
  }

  // The canonical AVG-4 decision, delegated whole. Draft validity, profile validity, prospect
  // agreement, OPEN state and the CURRENT Core gate are all its answer, not a second opinion.
  const readiness = evaluateWorkspaceApprovalReadiness(
    parsed.data.draft,
    parsed.data.profile,
    parsed.data.coreObservation,
  );
  if (!readiness.ready) {
    switch (readiness.refusal) {
      case 'DRAFT_INVALID':
        return Object.freeze({ ok: false as const, refusal: 'WORKSPACE_DRAFT_INVALID' as const });
      case 'PROFILE_INVALID':
        return Object.freeze({ ok: false as const, refusal: 'PROFILE_INVALID' as const });
      case 'PROSPECT_MISMATCH':
        return Object.freeze({ ok: false as const, refusal: 'PROSPECT_MISMATCH' as const });
      case 'DRAFT_NOT_OPEN':
        return Object.freeze({
          ok: false as const,
          refusal: 'WORKSPACE_DRAFT_NOT_OPEN' as const,
        });
      case 'CORE_GATE_REFUSED':
        return Object.freeze({
          ok: false as const,
          refusal: 'CORE_GATE_REFUSED' as const,
          coreReason: readiness.coreReason,
        });
    }
  }

  // The conversation must be this prospect's. A candidate bound to somebody else's thread would be
  // the one mistake this whole file is arranged to prevent.
  if (conversation.prospectRef !== readiness.prospectRef) {
    return Object.freeze({ ok: false as const, refusal: 'PROSPECT_MISMATCH' as const });
  }

  // The candidate contract admits exactly one Core status, and this is where a type stops being a
  // promise and becomes a check. Unreachable through the canonical gate -- AVG-4 reports ready only
  // for the one allowlisted status -- and fail closed anyway, because "unreachable" is a claim about
  // today's call graph and this is a claim about the candidate.
  if (readiness.coreStatus !== 'NOT_REGISTERED') {
    return Object.freeze({ ok: false as const, refusal: 'OUTBOUND_CANDIDATE_INVALID' as const });
  }

  // Re-parsed for its BODY, which is the only place the words may come from.
  const draft = parseWorkspaceDraft(parsed.data.draft);
  if (draft === undefined) {
    return Object.freeze({ ok: false as const, refusal: 'WORKSPACE_DRAFT_INVALID' as const });
  }

  // The lookup token the observation was performed under, so a reader can tie the recorded status to
  // the lookup that produced it rather than to an assumption. The gate itself is NOT re-run here:
  // `evaluateWorkspaceApprovalReadiness` above already ran it, and asking twice would be two answers
  // where the architecture requires one.
  const observation = coreEligibilityObservationSchema.safeParse(parsed.data.coreObservation);
  if (!observation.success) {
    return Object.freeze({
      ok: false as const,
      refusal: 'CORE_GATE_REFUSED' as const,
      coreReason: 'OBSERVATION_INVALID' as const,
    });
  }

  const candidate = {
    contractVersion: AAROHI_AVG5_CONTRACT_VERSION,
    channel: AAROHI_AVG5_CHANNEL,
    outcome: INSTAGRAM_OUTBOUND_CANDIDATE_OUTCOME,
    candidateRef: parsed.data.candidateRef,
    prospectRef: readiness.prospectRef,
    draftRef: readiness.draftRef,
    draftRevision: readiness.draftRevision,
    body: draft.body,
    instagramConversationRef: conversation.instagramConversationRef,
    instagramThreadRef: conversation.instagramThreadRef,
    instagramParticipantRef: conversation.instagramParticipantRef,
    bindingPosture: INSTAGRAM_BINDING_POSTURE,
    coreStatus: readiness.coreStatus,
    coreLookupRef: observation.data.coreLookupRef,
    preparedAt: parsed.data.preparedAt,
    posture: INSTAGRAM_OUTBOUND_CANDIDATE_POSTURE,
  };

  // Parsed before it is returned. The schema is the contract, and a contract nothing ever runs is a
  // paragraph. A candidate that failed its own shape is refused rather than handed over.
  if (!instagramOutboundCandidateSchema.safeParse(candidate).success) {
    return Object.freeze({ ok: false as const, refusal: 'OUTBOUND_CANDIDATE_INVALID' as const });
  }

  return Object.freeze({ ok: true as const, candidate: Object.freeze(candidate) });
}
