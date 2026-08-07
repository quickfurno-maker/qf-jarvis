/**
 * `RiyaConversationContinuityStateV1` — the working state Riya carries between turns
 * (RWC-P2A, ADR-0093).
 *
 * ### What this is
 *
 * The minimum non-authoritative, content-minimised state one Riya conversation needs so the next
 * turn is not the first turn. Where the conversation has reached, what has been discovered, how
 * each discovered thing was learned, whether the client has agreed the summary, and — only at the
 * end — an opaque reference to the evidence that a governed confirmation completed.
 *
 * ### What this is NOT
 *
 * **It is not ADR-0016 agent memory.** That contract governs derived, rebuildable,
 * `authoritative: false` records with non-empty `sourceEventIds`, isolated per agent and shared
 * across conversations. This is the opposite kind of thing: operational state for ONE conversation,
 * not derived from an event stream, never read as a belief in another conversation, never a
 * customer profile, never a CRM record and never training data. The two are kept apart rather than
 * merged, and none of ADR-0016's literals appear here — borrowing `rebuildable: true` and an
 * invented `sourceEventIds` would disguise working state as memory and weaken the contract that
 * makes memory safe to delete.
 *
 * **It is not business truth.** It is authoritative only for the current conversational workflow.
 * Consent, contact identity, city validity, vendor availability, pricing, lead creation and
 * business `canSubmit` belong to QuickFurno Core, and there is no field here that could express any
 * of them.
 *
 * **It carries no channel.** WEB and WhatsApp are the same governed Riya (ADR-0092), so a channel
 * field would be the beginning of a second one. Before RWC-P8's explicit Core-authorized link, the
 * two surfaces stay separate by having separate CONVERSATION IDENTITIES — not by channel-specific
 * state.
 *
 * **It holds no transcript.** No message history, no rolling summary, no recent turns, no context
 * window. `NeedDiscovery` already carries bounded structured context, and a second free-text blob
 * would be a transcript with a friendlier name.
 */
import { createNeedDiscovery } from '@qf-jarvis/riya-agent';
import type { DiscoveryField, NeedDiscovery, NeedDiscoveryInput } from '@qf-jarvis/riya-agent';
import { DISCOVERY_FIELDS_FROZEN } from '@qf-jarvis/riya-agent';
import { z } from 'zod';

import { RiyaConversationContinuityError } from './errors.js';
import {
  PHASES_AFTER_SUMMARY,
  PHASES_BEFORE_SUMMARY,
  RIYA_CONVERSATION_PHASES,
  RIYA_FIELD_PROVENANCE_SOURCES,
} from './vocabularies.js';
import type { RiyaConversationPhase, RiyaFieldProvenance } from './vocabularies.js';
import { DISCOVERY_VALUE_KEY, SUMMARY_REQUIRED_DISCOVERY_FIELDS } from '../internal/field-map.js';

/**
 * The canonical runtime identifier grammar, restated.
 *
 * `[A-Za-z0-9._:-]`, 1–128 — the same shape `@qf-jarvis/agent-runtime` uses for `tenantId` and
 * `conversationId`, so a continuity state keys on exactly what the runtime keys on. It is restated
 * rather than imported because that schema is private to the runtime kernel, and taking a
 * dependency on a whole runtime to borrow a regex would create an edge this package does not need.
 *
 * The excluded characters do work: no `@`, no `+`, no whitespace, so an email address, an E.164
 * number or a sentence cannot become an identifier here.
 */
const IDENTIFIER = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9._:-]+$/u);

/**
 * A conversation revision, not an authored version: 0 is the legitimate starting value.
 *
 * Bounded by `Number.MAX_SAFE_INTEGER` for the reason ADR-0055 records about the orchestration
 * revision — a ceiling of one million is a ceiling a long-lived conversation eventually hits, and
 * it hits it silently, long after deployment.
 */
const CONTINUITY_REVISION = z.int().min(0).max(Number.MAX_SAFE_INTEGER);

/** Per-field provenance. Only the seven canonical discovery fields, each optional. */
export type RiyaContinuityFieldProvenanceMap = Readonly<
  Partial<Record<DiscoveryField, RiyaFieldProvenance>>
>;

/** The frozen continuity state. */
export interface RiyaConversationContinuityStateV1 {
  readonly version: 1;
  /** Scope. Never a person, and never a browser. */
  readonly tenantId: string;
  /** The conversation this state belongs to. Unique only WITHIN a tenant (ADR-0076 §3). */
  readonly conversationId: string;
  /** Monotonic compare-and-set counter for THIS state. Not the conversation-control revision. */
  readonly continuityRevision: number;
  /** Where the conversation has reached. Not a UI step and not a business state. */
  readonly phase: RiyaConversationPhase;
  /** The REUSED `NeedDiscovery` from ADR-0067. Not a second requirement draft. */
  readonly discovery: NeedDiscovery;
  /** How each present discovery value was learned. */
  readonly fieldProvenance: RiyaContinuityFieldProvenanceMap;
  /** A CONVERSATIONAL fact: the client agreed the summary was right. **Not consent.** */
  readonly summaryConfirmed: boolean;
  /** Opaque evidence that a governed confirmation completed. Only ever set at `COMPLETE`. */
  readonly completionEvidenceRef: string | undefined;
}

/** What a caller supplies. Treated as untrusted. */
export interface RiyaConversationContinuityStateInput {
  readonly version: 1;
  readonly tenantId: string;
  readonly conversationId: string;
  readonly continuityRevision: number;
  readonly phase: RiyaConversationPhase;
  readonly discovery: NeedDiscoveryInput;
  readonly fieldProvenance?: RiyaContinuityFieldProvenanceMap;
  readonly summaryConfirmed: boolean;
  readonly completionEvidenceRef?: string;
}

/**
 * The provenance map, keyed ONLY by the seven canonical discovery fields.
 *
 * Built from `DISCOVERY_FIELDS_FROZEN` rather than a hand-written literal, so an eighth discovery
 * field in ADR-0067 cannot leave a field silently unvalidated here.
 */
const provenanceSource = z.enum(RIYA_FIELD_PROVENANCE_SOURCES).optional();

const provenanceMapSchema = z
  .object(
    // `Object.fromEntries` cannot preserve key types, so the assertion is unavoidable -- but it is
    // safe for a checkable reason: the keys come from `DISCOVERY_VALUE_KEY`, which is pinned by
    // `satisfies Readonly<Record<DiscoveryField, keyof NeedDiscovery>>`. An eighth discovery field
    // in ADR-0067 breaks THAT first, so this can never silently describe a stale key set.
    Object.fromEntries(
      (Object.keys(DISCOVERY_VALUE_KEY) as readonly DiscoveryField[]).map((field) => [
        field,
        provenanceSource,
      ]),
    ) as Record<DiscoveryField, typeof provenanceSource>,
  )
  .strict();

const envelopeSchema = z
  .object({
    version: z.literal(1),
    tenantId: IDENTIFIER,
    conversationId: IDENTIFIER,
    continuityRevision: CONTINUITY_REVISION,
    phase: z.enum(RIYA_CONVERSATION_PHASES),
    // Validated separately, through the REAL `createNeedDiscovery`. Accepting an object here and
    // re-proving it there is what keeps ADR-0067 the single definition of a discovery snapshot.
    discovery: z.looseObject({}),
    fieldProvenance: provenanceMapSchema.optional(),
    summaryConfirmed: z.boolean(),
    // Opaque and bounded. The identifier grammar refuses prose, an email and a phone number, so a
    // completion reference cannot become a place a lead payload is smuggled.
    completionEvidenceRef: IDENTIFIER.optional(),
  })
  .strict();

function invalid(code: 'invalid-input' | 'invalid-phase-state' | 'invalid-provenance'): never {
  throw new RiyaConversationContinuityError(code);
}

/**
 * Build one frozen continuity state, or refuse.
 *
 * Pure. It reads no clock, no randomness, no environment and no network, and it opens no
 * connection — a continuity state is a value, and two callers building the same input must get the
 * same value.
 *
 * There is deliberately no phase transition, no extraction from prose and no provenance merge.
 * RWC-P4 owns all three. This constructor answers exactly one question: **is this a state Riya
 * could legitimately be in?**
 */
export function createRiyaConversationContinuityState(
  input: RiyaConversationContinuityStateInput,
): RiyaConversationContinuityStateV1 {
  // Typed `unknown` at the boundary: the declared parameter promises a shape, but a caller that
  // built this from JSON, or an untyped caller, can supply anything — including an array, which
  // `typeof` reports as an object.
  const supplied: unknown = input;
  if (typeof supplied !== 'object' || supplied === null || Array.isArray(supplied)) {
    return invalid('invalid-input');
  }

  const parsed = envelopeSchema.safeParse(supplied);
  if (!parsed.success) {
    // The zod issue is discarded rather than wrapped: its path names the failing field and its
    // message can quote the value, and both are conversational content.
    return invalid('invalid-input');
  }
  const envelope = parsed.data;

  // Re-proved through the REAL contract. A second copy of the discovery rules living here is how
  // this package and ADR-0067 would come to disagree about what a valid snapshot is.
  // Widened to `unknown` first: the schema proved it is an object, and `createNeedDiscovery`
  // safe-parses it against the real schema, so nothing here assumes a shape it has not checked.
  const discoveryInput: unknown = envelope.discovery;
  let discovery: NeedDiscovery;
  try {
    discovery = createNeedDiscovery(discoveryInput as NeedDiscoveryInput);
  } catch {
    throw new RiyaConversationContinuityError('invalid-discovery');
  }

  const provenance: Partial<Record<DiscoveryField, RiyaFieldProvenance>> = {};
  const missing = new Set<DiscoveryField>(discovery.missingFields);

  for (const field of DISCOVERY_FIELDS_FROZEN) {
    const value = discovery[DISCOVERY_VALUE_KEY[field]];
    const hasValue = typeof value === 'string';
    const source = envelope.fieldProvenance?.[field];

    // A value with no provenance is a value nobody can account for, and a provenance with no value
    // is a claim about something that is not there — usually the fossil of a field the client
    // corrected away. Both are refused rather than repaired: inferring `model_inferred` for an
    // unaccounted value would be this package inventing the very thing provenance exists to record.
    if (hasValue && source === undefined) {
      return invalid('invalid-provenance');
    }
    if (!hasValue && source !== undefined) {
      return invalid('invalid-provenance');
    }
    // `missingFields` says the field is still outstanding. A value present at the same time is a
    // snapshot contradicting itself, and it is the shape a half-applied update would leave behind.
    if (hasValue && missing.has(field)) {
      return invalid('invalid-provenance');
    }
    if (source !== undefined) {
      provenance[field] = source;
    }
  }

  // `summaryConfirmed` is a conversational fact, and the phases bound it from both sides. Before a
  // summary has been shown it cannot be true; after the client has moved past it, it cannot be
  // false — a CONTACT phase with an unconfirmed summary describes a conversation that skipped the
  // step it depends on.
  if (PHASES_BEFORE_SUMMARY.includes(envelope.phase) && envelope.summaryConfirmed) {
    return invalid('invalid-phase-state');
  }
  if (PHASES_AFTER_SUMMARY.includes(envelope.phase) && !envelope.summaryConfirmed) {
    return invalid('invalid-phase-state');
  }

  // SUMMARY READINESS. A summary is a thing shown to a client and confirmed by them, so there has
  // to be something to show. RWC-P0B/P1B froze the four: service, city, budget, timeline.
  //
  // Without this, `SUMMARY` — and `CONTACT`, `CONSENT` and `COMPLETE` after it — accepted an
  // entirely EMPTY discovery. That is not a state Riya could legitimately be in, and it is exactly
  // the shape a lost or half-applied update leaves behind, which is precisely when a summary card
  // would be rendered blank and asked to be confirmed.
  //
  // Structural only. Whether `locationRef` names a validated city, an area, a pincode or a
  // catalogue entity is RWC-P5's question, and nothing here resolves, validates or infers it.
  // Optional fields never block. And `completeness` is deliberately NOT consulted: ADR-0067's
  // completeness answers whether CORE may review a lead proposal, and borrowing it as a summary
  // gate would silently redefine it.
  if (!PHASES_BEFORE_SUMMARY.includes(envelope.phase)) {
    for (const field of SUMMARY_REQUIRED_DISCOVERY_FIELDS) {
      if (typeof discovery[DISCOVERY_VALUE_KEY[field]] !== 'string') {
        return invalid('invalid-phase-state');
      }
    }
  }

  // COMPLETE is reached only through a governed confirmation outcome (RWC-P0B), so it must carry
  // the evidence that one happened. The evidence is opaque and proves nothing about authority: it
  // does not mean Jarvis created a lead, and RWC-P6 owns the real submission integration.
  const isComplete = envelope.phase === 'COMPLETE';
  if (isComplete && envelope.completionEvidenceRef === undefined) {
    return invalid('invalid-phase-state');
  }
  if (!isComplete && envelope.completionEvidenceRef !== undefined) {
    return invalid('invalid-phase-state');
  }

  return Object.freeze({
    version: 1 as const,
    tenantId: envelope.tenantId,
    conversationId: envelope.conversationId,
    continuityRevision: envelope.continuityRevision,
    phase: envelope.phase,
    // `createNeedDiscovery` already returned a frozen record built from parsed values, so the
    // caller's object is not reachable through it.
    discovery,
    fieldProvenance: Object.freeze(provenance),
    summaryConfirmed: envelope.summaryConfirmed,
    completionEvidenceRef: envelope.completionEvidenceRef,
  });
}
