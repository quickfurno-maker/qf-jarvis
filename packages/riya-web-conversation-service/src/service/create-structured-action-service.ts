/**
 * The internal Riya structured-action service (RWC-P6B, ADR-0102).
 *
 * ### Four actions, zero model calls
 *
 * `editSummary`, `confirmSummary`, `advanceContact`, `submitConfirmedIntake`. None reaches a model, a
 * prompt, a gateway or the `JarvisRuntime`; none generates a word of client-facing text. That is the
 * point of the slice rather than a gap in it — `user_confirmed` and `COMPLETE` are the two strongest
 * claims Riya can make about a conversation, and ADR-0101 §2 put them behind a structured surface so
 * no inference could produce them. Asking a model to phrase the acknowledgement afterwards would have
 * re-opened the door one layer up.
 *
 * ### It decides nothing it composes
 *
 * The post-summary semantics are RWC-P6A's, the discovery merge is RWC-P4A's, the catalogue is
 * RWC-P5's, and contact, consent and business eligibility are QuickFurno Core's. What this file owns
 * is ORDER, COUNTS and FAILURE MAPPING: load before authority, authority before mutation, look up
 * before submit, and one bounded closed reason for every way it can decline.
 *
 * ### The counts are the safety property
 *
 * Per action, at most: one availability read, one Core intake state read, one submit, two lookups —
 * the second only as ADR-0102 §14's authorized recovery — and one compare-and-set, except the accepted
 * submission, which is allowed exactly one reload and one second attempt because Core's business
 * mutation has already happened and must be reconciled rather than repeated.
 *
 * ### Nothing external is wrapped, and nothing raw escapes
 *
 * A reader error may name a host and a token; a Core payload may describe a real person. Neither
 * reaches a caller: an outage becomes a disposition, and the bounded `RiyaWebConversationError` codes
 * carry a fixed message per code.
 */
import { parseCoreServiceAvailabilitySnapshotV1 } from '@qf-jarvis/core-service-availability-read';
import type {
  CoreServiceAvailabilityReader,
  CoreServiceAvailabilitySnapshotV1,
} from '@qf-jarvis/core-service-availability-read';
import {
  isCoreCityActive,
  isCoreServiceActive,
  isCoreServiceCityPairAvailable,
} from '@qf-jarvis/core-service-availability-read/policy';
import {
  createCoreRiyaIntakeSubmissionRequestV1,
  parseCoreRiyaIntakeStateV1,
  parseCoreRiyaIntakeSubmissionLookupV1,
  parseCoreRiyaIntakeSubmissionResultV1,
} from '@qf-jarvis/core-riya-intake';
import type {
  CoreRiyaIntakePort,
  CoreRiyaIntakeStateV1,
  CoreRiyaIntakeSubmissionResultV1,
} from '@qf-jarvis/core-riya-intake';
import type { DiscoveryField } from '@qf-jarvis/riya-agent';
import {
  advanceRiyaAfterContactReady,
  completeRiyaAfterCoreSubmission,
  confirmRiyaSummary,
  evolveRiyaSummaryEdit,
  RiyaConversationCompletionError,
} from '@qf-jarvis/riya-conversation-completion';
import type { RiyaSummaryEditV1 } from '@qf-jarvis/riya-conversation-completion';
import type { RiyaConversationContinuityStateV1 } from '@qf-jarvis/riya-conversation-continuity';

import { RiyaWebConversationError } from '../contracts/errors.js';
import {
  riyaContactAdvanceActionSchema,
  riyaIntakeSubmissionActionSchema,
  riyaSummaryConfirmActionSchema,
  riyaSummaryEditActionSchema,
} from '../contracts/structured-actions.js';
import type {
  RiyaContactAdvanceActionV1,
  RiyaIntakeSubmissionActionV1,
  RiyaStructuredActionIdentityV1,
  RiyaSummaryConfirmActionV1,
  RiyaSummaryEditActionV1,
} from '../contracts/structured-actions.js';
import type {
  RiyaStructuredActionDisposition,
  RiyaStructuredActionReasonCode,
  RiyaStructuredActionResultV1,
} from '../contracts/structured-action-result.js';
import type { RiyaContinuityCasOutcome, RiyaContinuityStorePort } from '../contracts/store-port.js';
import { needDiscoveryInputOf } from '../internal/discovery-input.js';
import { riyaIntakeIdempotencyKey } from '../internal/submission-identity.js';

/**
 * What a caller injects.
 *
 * Deliberately NOT the text-turn config. A structured action needs no runtime and no `runtimeId`; a
 * text turn needs no Core intake port. Merging them would make every conversational deployment supply
 * a Core adapter it never calls, and the day that adapter were missing a conversation that only wanted
 * to talk would fail to construct.
 */
export interface RiyaStructuredActionServiceConfig {
  /** The continuity store. Required — there is no default, in-memory or otherwise. */
  readonly continuityStore: RiyaContinuityStorePort;
  /**
   * The Core-owned availability reader (RWC-P5). Required, and fails closed when absent.
   *
   * A structured edit reaches `serviceInterest` and `location` without a model, so this is the only
   * thing standing between a UI control and a summary that promises a service Core does not sell in
   * that city.
   */
  readonly availabilityReader: CoreServiceAvailabilityReader;
  /**
   * The Core intake port (RWC-P6A). Required.
   *
   * There is no default and there must not be: a port that answered "contact ready, consent granted"
   * would pass every test in this repository while submitting enquiries nobody agreed to.
   */
  readonly coreIntakePort: CoreRiyaIntakePort;
}

/** The four structured capabilities. */
export interface RiyaStructuredActionService {
  editSummary(action: RiyaSummaryEditActionV1): Promise<RiyaStructuredActionResultV1>;
  confirmSummary(action: RiyaSummaryConfirmActionV1): Promise<RiyaStructuredActionResultV1>;
  advanceContact(action: RiyaContactAdvanceActionV1): Promise<RiyaStructuredActionResultV1>;
  submitConfirmedIntake(
    action: RiyaIntakeSubmissionActionV1,
  ): Promise<RiyaStructuredActionResultV1>;
}

// ---------------------------------------------------------------------------
// Result construction. Two shapes, and the invariants live here rather than at each return.
// ---------------------------------------------------------------------------

function applied(continuity: RiyaConversationContinuityStateV1): RiyaStructuredActionResultV1 {
  return Object.freeze({ version: 1 as const, disposition: 'APPLIED' as const, continuity });
}

function declined(
  disposition: Exclude<RiyaStructuredActionDisposition, 'APPLIED'>,
  reasonCode: RiyaStructuredActionReasonCode,
  continuity?: RiyaConversationContinuityStateV1,
): RiyaStructuredActionResultV1 {
  return Object.freeze({
    version: 1 as const,
    disposition,
    ...(continuity === undefined ? {} : { continuity }),
    reasonCode,
  });
}

// ---------------------------------------------------------------------------
// The shared Core availability policy. One copy, and it is RWC-P5's.
// ---------------------------------------------------------------------------

/**
 * Does Core's CURRENT catalogue block this service/city combination?
 *
 * Every predicate here is imported from `core-service-availability-read/policy` — the same three the
 * model path and the RWC-P6A reducers use. There is no second pair rule in this repository, and the
 * reason is not tidiness: two copies would not diverge on the day they were written, they would
 * diverge on the day one of them was corrected.
 */
function coreAvailabilityBlocks(
  snapshot: CoreServiceAvailabilitySnapshotV1,
  serviceRef: string | undefined,
  cityRef: string | undefined,
): boolean {
  if (serviceRef !== undefined && !isCoreServiceActive(snapshot, serviceRef)) {
    return true;
  }
  if (cityRef !== undefined && !isCoreCityActive(snapshot, cityRef)) {
    return true;
  }
  return (
    serviceRef !== undefined &&
    cityRef !== undefined &&
    !isCoreServiceCityPairAvailable(snapshot, serviceRef, cityRef)
  );
}

/**
 * The value a field would hold after an edit — `SET`'s value, `undefined` after a `CLEAR`, otherwise
 * what the conversation already holds.
 *
 * Used ONLY to classify a refusal that RWC-P6A has already made (ADR-0102 §6). It decides nothing.
 */
function effectiveRef(
  current: string | undefined,
  edit: RiyaSummaryEditV1,
  field: DiscoveryField,
): string | undefined {
  const one = edit.edits.find((candidate) => candidate.field === field);
  if (one === undefined) {
    return current;
  }
  return one.operation === 'CLEAR' ? undefined : one.value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Build the internal structured-action service. Synchronous, and it opens nothing. */
export function createRiyaStructuredActionService(
  config: RiyaStructuredActionServiceConfig,
): RiyaStructuredActionService {
  // Typed `unknown` at the check: the declared parameter promises three collaborators, but this is a
  // package boundary and a missing Core port would otherwise surface mid-action — after a
  // conversation had been loaded and possibly after an availability read.
  const supplied: unknown = config;
  const method = (holder: string, name: string): boolean =>
    typeof (supplied as Record<string, Record<string, unknown> | undefined>)[holder]?.[name] ===
    'function';
  if (
    !isRecord(supplied) ||
    !method('continuityStore', 'load') ||
    !method('continuityStore', 'compareAndSet') ||
    // `createInitialIfAbsent` is required of the PORT even though no structured action calls it: the
    // injected object must be a real continuity store, not a two-method stand-in someone assembled for
    // this surface alone.
    !method('continuityStore', 'createInitialIfAbsent') ||
    !method('availabilityReader', 'readCurrent') ||
    !method('coreIntakePort', 'readCurrent') ||
    !method('coreIntakePort', 'lookupSubmission') ||
    !method('coreIntakePort', 'submit')
  ) {
    throw new RiyaWebConversationError('invalid-input');
  }
  const continuityStore = supplied['continuityStore'] as RiyaContinuityStorePort;
  const availabilityReader = supplied['availabilityReader'] as CoreServiceAvailabilityReader;
  const coreIntakePort = supplied['coreIntakePort'] as CoreRiyaIntakePort;

  // -------------------------------------------------------------------------
  // Loading, at the exact revision the client acted on.
  // -------------------------------------------------------------------------

  /**
   * Load the conversation this action names, or say why not.
   *
   * A `string` reason means stop. Nothing outbound has happened yet, which is the whole point of doing
   * this first: a stale action costs one store read and reaches no external system.
   */
  async function loadExact(
    action: RiyaStructuredActionIdentityV1,
  ): Promise<RiyaConversationContinuityStateV1 | RiyaStructuredActionResultV1> {
    let loaded: RiyaConversationContinuityStateV1 | undefined;
    try {
      loaded = await continuityStore.load({
        tenantId: action.tenantId,
        conversationId: action.conversationId,
      });
    } catch {
      throw new RiyaWebConversationError('continuity-unavailable');
    }
    if (loaded === undefined) {
      // No conversation. A structured action answers something a client was SHOWN, so there is
      // nothing here to have shown them, and creating a conversation would manufacture the state the
      // action claims to be answering.
      return declined('NOT_READY', 'CONTINUITY_NOT_FOUND');
    }
    if (loaded.tenantId !== action.tenantId || loaded.conversationId !== action.conversationId) {
      throw new RiyaWebConversationError('repository-invariant');
    }
    if (loaded.continuityRevision !== action.expectedContinuityRevision) {
      // EXACT, never a floor. The client acted on a specific rendering; a newer one is a summary they
      // have not seen, and ADR-0101 §14 forbids confirming that on their behalf.
      return declined('CONFLICT', 'STALE_REVISION', loaded);
    }
    return loaded;
  }

  function isResult(
    value: RiyaConversationContinuityStateV1 | RiyaStructuredActionResultV1,
  ): value is RiyaStructuredActionResultV1 {
    return 'disposition' in value;
  }

  // -------------------------------------------------------------------------
  // The one outbound availability read.
  // -------------------------------------------------------------------------

  async function readAvailability(
    tenantId: string,
  ): Promise<CoreServiceAvailabilitySnapshotV1 | undefined> {
    try {
      const raw: unknown = await availabilityReader.readCurrent({ tenantId });
      return parseCoreServiceAvailabilitySnapshotV1(raw);
    } catch {
      // FAIL CLOSED as NOT_READY. Absent authority is not a business decision about the client, and
      // there is no default catalogue, no cached fallback and no "assume available".
      return undefined;
    }
  }

  // -------------------------------------------------------------------------
  // Turning ONE RWC-P6A refusal into ONE closed reason (ADR-0102 §6).
  // -------------------------------------------------------------------------

  /**
   * Classify a completion-package error.
   *
   * `action-not-permitted` covers several genuinely different situations, because a pure reducer has
   * no vocabulary for "not yet" versus "no". This chooses between reasons using state that was already
   * loaded and a snapshot that was already read. It runs only after the refusal, and it grants
   * nothing.
   */
  function fromCompletionError(
    error: unknown,
    state: RiyaConversationContinuityStateV1,
    availabilityBlocked: boolean,
  ): RiyaStructuredActionResultV1 {
    if (!(error instanceof RiyaConversationCompletionError)) {
      throw error;
    }
    if (error.code === 'invalid-state') {
      // A row this service just loaded is not a canonical continuity state. That is our own durable
      // evidence contradicting itself, not a race and not a client's problem.
      throw new RiyaWebConversationError('repository-invariant');
    }
    if (error.code === 'invalid-summary-edit') {
      throw new RiyaWebConversationError('invalid-input');
    }
    if (error.code === 'invalid-availability-snapshot' || error.code === 'invalid-evidence-ref') {
      // An authority answered something that will not prove. Unusable, not untrue.
      return declined('NOT_READY', 'AUTHORITY_UNAVAILABLE', state);
    }
    if (state.discovery.completeness === 'HUMAN_REVIEW_REQUIRED') {
      return declined('NOT_READY', 'HUMAN_REVIEW_REQUIRED', state);
    }
    if (availabilityBlocked) {
      return declined('NOT_READY', 'AVAILABILITY_CHANGED', state);
    }
    return declined('REFUSED', 'ACTION_NOT_PERMITTED', state);
  }

  // -------------------------------------------------------------------------
  // Persistence. One attempt for edit, confirm and contact.
  // -------------------------------------------------------------------------

  async function attempt(
    expectedRevision: number,
    nextState: RiyaConversationContinuityStateV1,
  ): Promise<RiyaContinuityCasOutcome> {
    try {
      return await continuityStore.compareAndSet({ expectedRevision, nextState });
    } catch {
      throw new RiyaWebConversationError('continuity-unavailable');
    }
  }

  /**
   * Persist one structured transition, with NO reconciliation.
   *
   * RWC-P4B reconciles because an observation is a fact that stays true against a newer state. A
   * confirmation is not a fact about the world — it is a statement about a specific rendered summary —
   * and an edit re-applied to a summary that has since changed is the same error with a smaller blast
   * radius. So a conflict here is final.
   */
  async function persistOnce(
    base: RiyaConversationContinuityStateV1,
    nextState: RiyaConversationContinuityStateV1,
  ): Promise<RiyaStructuredActionResultV1> {
    const outcome = await attempt(base.continuityRevision, nextState);
    if (outcome === 'UPDATED') {
      return applied(nextState);
    }
    if (outcome === 'NOT_FOUND') {
      // A row this same action already loaded has gone.
      throw new RiyaWebConversationError('repository-invariant');
    }
    return declined('CONFLICT', 'CONTINUITY_CONFLICT', base);
  }

  // -------------------------------------------------------------------------
  // 1. Structured summary edit.
  // -------------------------------------------------------------------------

  async function editSummary(
    input: RiyaSummaryEditActionV1,
  ): Promise<RiyaStructuredActionResultV1> {
    const parsed = riyaSummaryEditActionSchema.safeParse(input);
    if (!parsed.success) {
      // The zod issue is discarded: its path names the failing field and its message can quote the
      // value, and an edit value is a person's own words about their home.
      throw new RiyaWebConversationError('invalid-input');
    }
    const action = parsed.data as unknown as RiyaSummaryEditActionV1;

    const loaded = await loadExact(action);
    if (isResult(loaded)) {
      return loaded;
    }

    const snapshot = await readAvailability(action.tenantId);
    if (snapshot === undefined) {
      return declined('NOT_READY', 'AUTHORITY_UNAVAILABLE', loaded);
    }

    let evolved;
    try {
      evolved = evolveRiyaSummaryEdit({
        current: loaded,
        edit: action.edit,
        availabilitySnapshot: snapshot,
      });
    } catch (error: unknown) {
      // Classified against what the edit WOULD have produced, so "you cannot move to that city" reads
      // as availability rather than as a flat refusal.
      const edit = action.edit;
      const blocked =
        !(error instanceof RiyaConversationCompletionError) ||
        error.code !== 'action-not-permitted' ||
        !isRecord(edit) ||
        !Array.isArray((edit as { edits?: unknown }).edits)
          ? false
          : coreAvailabilityBlocks(
              snapshot,
              effectiveRef(loaded.discovery.serviceInterestRef, edit, 'serviceInterest'),
              effectiveRef(loaded.discovery.locationRef, edit, 'location'),
            );
      return fromCompletionError(error, loaded, blocked);
    }

    if (!evolved.changed) {
      // The edit restated what was already there. No compare-and-set: spending a durable write to
      // store what is stored would also bump a revision whose entire meaning is "this changed".
      return applied(loaded);
    }
    return persistOnce(loaded, evolved.state);
  }

  // -------------------------------------------------------------------------
  // 2. Structured summary confirmation.
  // -------------------------------------------------------------------------

  async function confirmSummary(
    input: RiyaSummaryConfirmActionV1,
  ): Promise<RiyaStructuredActionResultV1> {
    const parsed = riyaSummaryConfirmActionSchema.safeParse(input);
    if (!parsed.success) {
      throw new RiyaWebConversationError('invalid-input');
    }
    const action = parsed.data as RiyaSummaryConfirmActionV1;

    const loaded = await loadExact(action);
    if (isResult(loaded)) {
      return loaded;
    }

    const snapshot = await readAvailability(action.tenantId);
    if (snapshot === undefined) {
      return declined('NOT_READY', 'AUTHORITY_UNAVAILABLE', loaded);
    }

    let confirmed;
    try {
      confirmed = confirmRiyaSummary({ current: loaded, availabilitySnapshot: snapshot });
    } catch (error: unknown) {
      return fromCompletionError(
        error,
        loaded,
        coreAvailabilityBlocks(
          snapshot,
          loaded.discovery.serviceInterestRef,
          loaded.discovery.locationRef,
        ),
      );
    }
    // RWC-P6A guarantees exactly one revision and the move to CONTACT. This composes it; it does not
    // re-decide it.
    return persistOnce(loaded, confirmed.state);
  }

  // -------------------------------------------------------------------------
  // The one outbound Core intake state read, with its identity proved.
  // -------------------------------------------------------------------------

  /**
   * Read Core's current view for THIS tenant, conversation and subject, and prove it is about them.
   *
   * A well-formed state for the wrong scope is the failure ADR-0101 §17 exists to close: a cache keyed
   * one field short, a batch endpoint or a retry on a reused connection can all return one, and every
   * field in it would parse. A mismatch stops the action — there is no second read to go looking for a
   * better answer, because retrying a source that answered about the wrong conversation is how a
   * composition talks itself into believing the second answer.
   */
  async function readCoreIntakeState(action: {
    readonly tenantId: string;
    readonly conversationId: string;
    readonly subjectRef: string;
  }): Promise<CoreRiyaIntakeStateV1 | RiyaStructuredActionReasonCode> {
    let state: CoreRiyaIntakeStateV1;
    try {
      const raw: unknown = await coreIntakePort.readCurrent({
        tenantId: action.tenantId,
        conversationId: action.conversationId,
        subjectRef: action.subjectRef,
      });
      state = parseCoreRiyaIntakeStateV1(raw);
    } catch {
      return 'AUTHORITY_UNAVAILABLE';
    }
    if (
      state.tenantId !== action.tenantId ||
      state.conversationId !== action.conversationId ||
      state.subjectRef !== action.subjectRef
    ) {
      return 'AUTHORITY_MISMATCH';
    }
    return state;
  }

  function isReason(
    value: CoreRiyaIntakeStateV1 | RiyaStructuredActionReasonCode,
  ): value is RiyaStructuredActionReasonCode {
    return typeof value === 'string';
  }

  // -------------------------------------------------------------------------
  // 3. CONTACT -> CONSENT.
  // -------------------------------------------------------------------------

  async function advanceContact(
    input: RiyaContactAdvanceActionV1,
  ): Promise<RiyaStructuredActionResultV1> {
    const parsed = riyaContactAdvanceActionSchema.safeParse(input);
    if (!parsed.success) {
      throw new RiyaWebConversationError('invalid-input');
    }
    const action = parsed.data as RiyaContactAdvanceActionV1;

    const loaded = await loadExact(action);
    if (isResult(loaded)) {
      return loaded;
    }

    // No availability read here. Whether Core holds a phone number has nothing to do with which cities
    // the business serves, and a read would only ever fail this action for an unrelated reason.
    const state = await readCoreIntakeState(action);
    if (isReason(state)) {
      return declined('NOT_READY', state, loaded);
    }
    if (state.contact.state === 'MISSING' || state.contact.evidenceRef === undefined) {
      return declined('NOT_READY', 'CONTACT_MISSING', loaded);
    }
    // The consent state is deliberately NOT consulted. Reaching the consent step is not the same as
    // passing it, and the submission is where consent is evaluated.

    let advanced;
    try {
      advanced = advanceRiyaAfterContactReady({
        current: loaded,
        // Required by RWC-P6A as proof the caller had a governed answer, and then discarded by it.
        // Nothing here keeps a copy: it reaches no result, no state and no error.
        contactEvidenceRef: state.contact.evidenceRef,
      });
    } catch (error: unknown) {
      return fromCompletionError(error, loaded, false);
    }
    return persistOnce(loaded, advanced.state);
  }

  // -------------------------------------------------------------------------
  // 4. The idempotent Core submission.
  // -------------------------------------------------------------------------

  /**
   * Persist `CONSENT → COMPLETE` for an accepted Core result, reconciling ONE conflict.
   *
   * The only structured action allowed a reload and a second attempt, and the reason is specific:
   * Core's business mutation has ALREADY succeeded. Failing closed would leave a conversation
   * permanently short of a `COMPLETE` that Core has recorded, and re-submitting would create a second
   * enquiry against a real person's project. Reconciliation is the only option that is neither.
   *
   * Nothing external re-runs: no availability read, no Core state read, no lookup, no submit.
   */
  async function persistCompletion(
    loaded: RiyaConversationContinuityStateV1,
    evidenceRef: string,
    idempotencyKey: string,
    subjectRef: string,
  ): Promise<RiyaStructuredActionResultV1> {
    let completed;
    try {
      completed = completeRiyaAfterCoreSubmission({
        current: loaded,
        completionEvidenceRef: evidenceRef,
      });
    } catch (error: unknown) {
      return fromCompletionError(error, loaded, false);
    }

    const first = await attempt(loaded.continuityRevision, completed.state);
    if (first === 'UPDATED') {
      return applied(completed.state);
    }
    if (first === 'NOT_FOUND') {
      throw new RiyaWebConversationError('repository-invariant');
    }

    // REVISION_CONFLICT. ONE reload, and nothing else.
    let latest: RiyaConversationContinuityStateV1 | undefined;
    try {
      latest = await continuityStore.load({
        tenantId: loaded.tenantId,
        conversationId: loaded.conversationId,
      });
    } catch {
      throw new RiyaWebConversationError('continuity-unavailable');
    }
    if (latest === undefined) {
      throw new RiyaWebConversationError('repository-invariant');
    }
    if (latest.tenantId !== loaded.tenantId || latest.conversationId !== loaded.conversationId) {
      throw new RiyaWebConversationError('repository-invariant');
    }

    // The business identity of whatever is there now. If it hashes differently, the conversation Core
    // accepted is not the conversation in front of us any more.
    const latestKey = riyaIntakeIdempotencyKey({
      tenantId: latest.tenantId,
      conversationId: latest.conversationId,
      subjectRef,
      discovery: latest.discovery,
    });

    if (latest.phase === 'COMPLETE') {
      // Another writer completed the SAME submission. That is success, not a conflict — but only if it
      // is genuinely the same one: a COMPLETE carrying somebody else's evidence is not this action's
      // outcome, and reporting it as APPLIED would attribute a stranger's enquiry to this client.
      if (latest.completionEvidenceRef === evidenceRef && latestKey === idempotencyKey) {
        return applied(latest);
      }
      return declined('CONFLICT', 'CONTINUITY_CONFLICT', latest);
    }

    if (latest.phase === 'CONSENT') {
      if (
        !latest.summaryConfirmed ||
        latest.completionEvidenceRef !== undefined ||
        latestKey !== idempotencyKey
      ) {
        return declined('CONFLICT', 'CONTINUITY_CONFLICT', latest);
      }
      let again;
      try {
        again = completeRiyaAfterCoreSubmission({
          current: latest,
          completionEvidenceRef: evidenceRef,
        });
      } catch (error: unknown) {
        return fromCompletionError(error, latest, false);
      }
      const second = await attempt(latest.continuityRevision, again.state);
      if (second === 'UPDATED') {
        return applied(again.state);
      }
      if (second === 'NOT_FOUND') {
        throw new RiyaWebConversationError('repository-invariant');
      }
      // Lost twice. There is no third attempt.
      return declined('CONFLICT', 'CONTINUITY_CONFLICT', latest);
    }

    return declined('CONFLICT', 'CONTINUITY_CONFLICT', latest);
  }

  /** Map one canonical Core result — from a lookup or a submit — onto a disposition. */
  async function applyCoreResult(
    result: CoreRiyaIntakeSubmissionResultV1,
    loaded: RiyaConversationContinuityStateV1,
    idempotencyKey: string,
    subjectRef: string,
  ): Promise<RiyaStructuredActionResultV1> {
    if (result.outcome === 'ACCEPTED' && result.completionEvidenceRef !== undefined) {
      return persistCompletion(loaded, result.completionEvidenceRef, idempotencyKey, subjectRef);
    }
    if (result.outcome === 'NOT_READY') {
      return declined('NOT_READY', 'CORE_NOT_READY', loaded);
    }
    if (result.outcome === 'REJECTED') {
      // A business decision, and it was no. Not an outage, so it must not read as one.
      return declined('REFUSED', 'CORE_REJECTED', loaded);
    }
    if (result.outcome === 'HUMAN_REVIEW_REQUIRED') {
      return declined('NOT_READY', 'HUMAN_REVIEW_REQUIRED', loaded);
    }
    // ACCEPTED without evidence cannot pass the canonical parser. Reaching here would mean the parser
    // and this mapping disagree, and guessing would put an unevidenced conversation into COMPLETE.
    throw new RiyaWebConversationError('repository-invariant');
  }

  /**
   * The ONE authorized recovery lookup (ADR-0102 §14).
   *
   * Reached only when a submit has already been made and did not yield a usable answer — a rejected
   * promise, or a body the canonical parser will not accept. Both are the same fact: the mutation may
   * already have happened and we cannot tell. Asking Core what it recorded is the only safe move, and
   * it is taken exactly once with the SAME key. Never a second submit, never a third lookup.
   */
  async function recoverIndeterminate(
    action: RiyaIntakeSubmissionActionV1,
    loaded: RiyaConversationContinuityStateV1,
    idempotencyKey: string,
  ): Promise<RiyaStructuredActionResultV1> {
    let lookup;
    try {
      const raw: unknown = await coreIntakePort.lookupSubmission({
        tenantId: action.tenantId,
        conversationId: action.conversationId,
        idempotencyKey,
      });
      lookup = parseCoreRiyaIntakeSubmissionLookupV1(raw);
    } catch {
      return declined('NOT_READY', 'SUBMISSION_INDETERMINATE', loaded);
    }
    if (lookup.idempotencyKey !== idempotencyKey || lookup.status !== 'FOUND') {
      // A `NOT_FOUND` here is still indeterminate rather than reassuring: Core may simply not have
      // finished recording a submission it accepted.
      return declined('NOT_READY', 'SUBMISSION_INDETERMINATE', loaded);
    }
    if (lookup.result === undefined) {
      return declined('NOT_READY', 'SUBMISSION_INDETERMINATE', loaded);
    }
    return applyCoreResult(lookup.result, loaded, idempotencyKey, action.subjectRef);
  }

  async function submitConfirmedIntake(
    input: RiyaIntakeSubmissionActionV1,
  ): Promise<RiyaStructuredActionResultV1> {
    const parsed = riyaIntakeSubmissionActionSchema.safeParse(input);
    if (!parsed.success) {
      throw new RiyaWebConversationError('invalid-input');
    }
    const action = parsed.data as RiyaIntakeSubmissionActionV1;

    const loaded = await loadExact(action);
    if (isResult(loaded)) {
      return loaded;
    }

    // Preconditions on OUR OWN state, before anything outbound.
    if (loaded.discovery.completeness === 'HUMAN_REVIEW_REQUIRED') {
      return declined('NOT_READY', 'HUMAN_REVIEW_REQUIRED', loaded);
    }
    if (
      loaded.phase !== 'CONSENT' ||
      !loaded.summaryConfirmed ||
      loaded.completionEvidenceRef !== undefined
    ) {
      return declined('REFUSED', 'ACTION_NOT_PERMITTED', loaded);
    }

    // The CURRENT catalogue, read once. A summary confirmed last week may name a pair Core has since
    // stopped selling, and submitting it would create an enquiry the business cannot fulfil.
    const snapshot = await readAvailability(action.tenantId);
    if (snapshot === undefined) {
      return declined('NOT_READY', 'AUTHORITY_UNAVAILABLE', loaded);
    }
    const serviceRef = loaded.discovery.serviceInterestRef;
    const cityRef = loaded.discovery.locationRef;
    if (serviceRef === undefined || cityRef === undefined) {
      // Unreachable at CONSENT: the continuity constructor refuses a confirmed summary without them.
      throw new RiyaWebConversationError('repository-invariant');
    }
    if (coreAvailabilityBlocks(snapshot, serviceRef, cityRef)) {
      return declined('NOT_READY', 'AVAILABILITY_CHANGED', loaded);
    }

    // Core's current view, read once, identity proved.
    const state = await readCoreIntakeState(action);
    if (isReason(state)) {
      return declined('NOT_READY', state, loaded);
    }
    if (state.contact.state === 'MISSING') {
      return declined('NOT_READY', 'CONTACT_MISSING', loaded);
    }
    if (state.consent.state === 'MISSING') {
      return declined('NOT_READY', 'CONSENT_MISSING', loaded);
    }
    if (state.consent.state === 'DECLINED') {
      // The client declined THIS intake. A decision, not a state to wait out.
      return declined('REFUSED', 'CONSENT_DECLINED', loaded);
    }
    if (state.consent.state === 'OPTED_OUT') {
      // The stronger Core-owned stop, and the one that must never be ignored.
      return declined('REFUSED', 'CONSENT_OPTED_OUT', loaded);
    }

    const idempotencyKey = riyaIntakeIdempotencyKey({
      tenantId: loaded.tenantId,
      conversationId: loaded.conversationId,
      subjectRef: action.subjectRef,
      discovery: loaded.discovery,
    });

    // Built through the REAL canonical constructor. A hand-assembled parallel shape here would be a
    // second definition of what a submission is, and the first thing it would skip is the powerlessness
    // the real one enforces.
    let submission;
    try {
      submission = createCoreRiyaIntakeSubmissionRequestV1({
        contractVersion: 1,
        producingSystem: 'qf-jarvis',
        tenantId: loaded.tenantId,
        conversationId: loaded.conversationId,
        subjectRef: action.subjectRef,
        continuityRevision: loaded.continuityRevision,
        intakeStateRef: state.stateRef,
        availabilitySnapshotRef: snapshot.snapshotRef,
        taxonomyVersion: snapshot.taxonomyVersion,
        // Projected back into the shape the canonical constructor accepts, then RE-PROVED by it. The
        // projection drops a derived field and turns present-holding-undefined into absent; it moves
        // no value, and a spec asserts the round trip returns a discovery deep-equal to this one.
        discovery: needDiscoveryInputOf(loaded.discovery),
        summaryConfirmed: true,
        idempotencyKey,
      });
    } catch {
      // Our own confirmed state will not form a canonical submission. That is our records
      // contradicting themselves, not a business outcome.
      throw new RiyaWebConversationError('repository-invariant');
    }

    // LOOK UP BEFORE MUTATING. Never resubmit on uncertainty, and never assume a first attempt.
    let lookup;
    try {
      const raw: unknown = await coreIntakePort.lookupSubmission({
        tenantId: action.tenantId,
        conversationId: action.conversationId,
        idempotencyKey,
      });
      lookup = parseCoreRiyaIntakeSubmissionLookupV1(raw);
    } catch {
      return declined('NOT_READY', 'AUTHORITY_UNAVAILABLE', loaded);
    }
    if (lookup.idempotencyKey !== idempotencyKey) {
      // An answer about a different submission. Submitting now would be submitting blind.
      return declined('NOT_READY', 'AUTHORITY_MISMATCH', loaded);
    }
    if (lookup.status === 'FOUND') {
      if (lookup.result === undefined) {
        throw new RiyaWebConversationError('repository-invariant');
      }
      // Core already recorded this exact submission. Nothing is submitted.
      return applyCoreResult(lookup.result, loaded, idempotencyKey, action.subjectRef);
    }

    // Exactly one submit, and only here.
    let raw: unknown;
    try {
      raw = await coreIntakePort.submit(submission);
    } catch {
      return recoverIndeterminate(action, loaded, idempotencyKey);
    }
    let result: CoreRiyaIntakeSubmissionResultV1;
    try {
      result = parseCoreRiyaIntakeSubmissionResultV1(raw);
    } catch {
      // Unparseable, after a mutation that may have succeeded. Same fact as a rejected promise, and
      // the same single recovery.
      return recoverIndeterminate(action, loaded, idempotencyKey);
    }
    if (result.idempotencyKey !== submission.idempotencyKey) {
      // A well-formed answer about somebody else's submission. Its evidence is not ours to use, and
      // there is nothing indeterminate about it — so no recovery lookup either.
      return declined('NOT_READY', 'AUTHORITY_MISMATCH', loaded);
    }
    return applyCoreResult(result, loaded, idempotencyKey, action.subjectRef);
  }

  return Object.freeze({ editSummary, confirmSummary, advanceContact, submitConfirmedIntake });
}
