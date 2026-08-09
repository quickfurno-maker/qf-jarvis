/**
 * The private Riya web conversation service (RWC-P2C, ADR-0094).
 *
 * ### One turn, one runtime call, one bounded result
 *
 * 1. validate the turn;
 * 2. LOAD continuity, or initialize it atomically through the injected store;
 * 2a. read the CURRENT Core-owned service availability ONCE, and re-prove it. Without it the turn
 *     stops here: a model that cannot see which services Core sells where would invent an answer;
 * 3. build the existing `InboundEnvelope` with `WEB`/`CLIENT`/`INBOUND` fixed;
 * 4. delegate EXACTLY ONCE to the already-composed authoritative runtime, through its RWC-P4B
 *    `processInboundForRiyaConversationEvolution` capability (ADR-0099) — one call, one
 *    orchestration run, and therefore ONE model call that produces the reply and the observations
 *    together;
 * 5. evolve the loaded continuity by those observations and persist it through compare-and-set —
 *    withholding the authorized body if that compare-and-set lost a race, because a reply is bound
 *    to the continuity snapshot the model saw;
 * 6. map the outcome to a closed disposition, cross-check any Core-authorized body against the run
 *    that produced it, and return the FINAL authoritative continuity.
 *
 * Since RWC-P2D the result is `RiyaWebConversationResultV2` and MAY carry the exact body QuickFurno
 * Core authorized. It never carries a draft: `MODEL_DRAFTED` with no Core transport, a Core
 * rejection, an unavailability and a drifted revision all return no text at all. Core acceptance is
 * authorization, not delivery — this service still sends nothing and persists no reply.
 *
 * ### What it is not
 *
 * It is not a second orchestrator. It composes nothing, decides nothing about actors, prompts,
 * models or Core, and duplicates no gate: `humanTakeover`, `aiPaused`, `cancelled`, data class,
 * party type, subject status and the revision double-gate all remain the runtime's, and are reached
 * through the one public entry point it already exposes.
 *
 * It is not the Riya reducer either. Nothing here parses prose, classifies intent, decides
 * provenance precedence, advances a phase, confirms a summary, mints completion evidence or computes
 * `canSubmit`. Extraction happens inside the one model call, the semantics live in the pure RWC-P4A
 * reducer, and this file only composes the two with a durable write. And it fabricates no
 * `ClientSalesSignals`: `JarvisRuntimeConfig.behaviourInput` is
 * OPTIONAL, and its own documentation states that when absent "the runtime takes the legacy `REPLY`
 * path unchanged and Riya behaviour is never consulted". P2C reuses exactly that supported mode.
 * Inventing all-false signals to force the behaviour kernel to run would be manufacturing an input
 * no one supplied, in order to reach a code path this slice has no authority over.
 *
 * It is not a transport. There is no HTTP server, route, URL, cookie, CORS or browser reachability —
 * a QuickFurno server gateway is the only intended caller, and that ingress is a later slice. The
 * Core availability read is an INJECTED PORT with no implementation in this repository either: this
 * service calls it, and the final integration handshake supplies the adapter behind it.
 */
import type {
  JarvisCoreAuthorizedReplyV1,
  JarvisRuntimeOutcome,
  JarvisRuntimeResult,
  RiyaConversationEvolutionJarvisRuntime,
} from '@qf-jarvis/jarvis-runtime';
import type { DiscoveryField } from '@qf-jarvis/riya-agent';
import { createRiyaConversationContinuityState } from '@qf-jarvis/riya-conversation-continuity';
import type { RiyaConversationContinuityStateV1 } from '@qf-jarvis/riya-conversation-continuity';
import { parseCoreServiceAvailabilitySnapshotV1 } from '@qf-jarvis/core-service-availability-read';
import type {
  CoreServiceAvailabilityReader,
  CoreServiceAvailabilitySnapshotV1,
} from '@qf-jarvis/core-service-availability-read';
import { evolveRiyaConversation } from '@qf-jarvis/riya-conversation-evolution';
import type { RiyaConversationObservationBatchV1 } from '@qf-jarvis/riya-conversation-evolution';

import { RiyaWebConversationError } from '../contracts/errors.js';
import type {
  RiyaWebConversationDisposition,
  RiyaWebConversationResultV2,
} from '../contracts/result.js';
import type { RiyaContinuityCasOutcome, RiyaContinuityStorePort } from '../contracts/store-port.js';
import { webConversationTurnSchema } from '../contracts/turn.js';
import type { RiyaWebConversationTurnV1 } from '../contracts/turn.js';
import { buildWebInboundEnvelope } from '../internal/envelope.js';

/** What a caller injects. Every collaborator is required; there is no default for any of them. */
export interface RiyaWebConversationServiceConfig {
  /**
   * The ALREADY-COMPOSED authoritative runtime, which MUST expose the RWC-P4B Riya-aware capability.
   * This service composes nothing.
   *
   * The capability is required rather than optional because the service returns `authorizedReply` in
   * its V2 result and now evolves continuity from the same run: a runtime without it could only ever
   * produce `undefined` for both, and a conversation that never learns anything is worse than a
   * refusal, because it looks like it is working.
   */
  readonly runtime: RiyaConversationEvolutionJarvisRuntime;
  /** The continuity store. Required — an in-memory default would lose state on restart. */
  readonly continuityStore: RiyaContinuityStorePort;
  /**
   * The Core-owned service availability reader (RWC-P5, ADR-0100). REQUIRED, and injected.
   *
   * There is deliberately no default, and the reason is sharper than for the store. A missing store
   * loses conversations; a missing availability reader would have to mean something, and the only
   * shape a default could take is "everything is available everywhere" — which would pass every test
   * in this repository and let Riya promise services in cities the business does not serve. Absent
   * authority must fail closed, never open.
   */
  readonly availabilityReader: CoreServiceAvailabilityReader;
  /** The governed runtime identifier stamped on every envelope. Configured, never caller-supplied. */
  readonly runtimeId: string;
}

/** The service. One capability. */
export interface RiyaWebConversationService {
  handleTurn(turn: RiyaWebConversationTurnV1): Promise<RiyaWebConversationResultV2>;
}

/** The M2 reply-body bound, restated. A body outside it never passed the orchestrator's schema. */
const REPLY_BODY_MAX = 8192;

/**
 * The three phases a TEXT turn may not change (RWC-P7, ADR-0103).
 *
 * Past `SUMMARY` the conversation is governed by RWC-P6's structured actions, which make zero model
 * calls. A client may still ask a business question and deserves a grounded answer — but that answer
 * must be structurally incapable of moving a phase, confirming a summary, recording consent or
 * submitting an intake. So the turn is routed to a capability whose schema has nowhere to express
 * any of it, and the branch below is the only place that decision is made.
 *
 * Widened to `readonly string[]` deliberately. `phase` is already the closed nine-value union, so the
 * compiler would treat this comparison as exhaustive — but the value arrives from a durable store,
 * and the check is about the phase that showed up at runtime, not the one the type promised.
 */
const POST_SUMMARY_PHASES: readonly string[] = Object.freeze(['CONTACT', 'CONSENT', 'COMPLETE']);

/**
 * The kinds whose text Core actually received, as plain strings.
 *
 * Widened to `readonly string[]` deliberately. The declared type of `proposalKind` is already
 * `'REPLY' | 'FOLLOW_UP'`, so a `===` comparison is statically always true and the compiler is right
 * to say so — but this is a PACKAGE BOUNDARY, and the value arrives from an injected runtime that a
 * test double, a future adapter or a defect could make disagree with its own type. The check is
 * about the value that showed up at runtime, not the one the type promised.
 */
const TEXT_CARRYING_KINDS: readonly string[] = Object.freeze(['REPLY', 'FOLLOW_UP']);

/**
 * Cross-check a materialization against the run it claims to belong to (RWC-P2D §12).
 *
 * The runtime already decides whether a body may exist; this is the service refusing to FORWARD one
 * whose evidence disagrees with itself. Everything checked here should be impossible, which is the
 * point: if it ever happens, the choice is between a refusal somebody investigates and a client
 * receiving text attributed to a proposal that did not produce it.
 */
function materializationAgreesWithRun(
  runtimeResult: JarvisRuntimeResult,
  authorizedReply: JarvisCoreAuthorizedReplyV1,
): boolean {
  return (
    runtimeResult.outcome === 'CORE_ACCEPTED' &&
    runtimeResult.modelDrafted &&
    runtimeResult.proposalId !== undefined &&
    runtimeResult.boundRevision !== undefined &&
    authorizedReply.proposalId === runtimeResult.proposalId &&
    authorizedReply.boundRevision === runtimeResult.boundRevision &&
    TEXT_CARRYING_KINDS.includes(authorizedReply.proposalKind) &&
    authorizedReply.replyBody.length > 0 &&
    authorizedReply.replyBody.length <= REPLY_BODY_MAX
  );
}

/**
 * Map the runtime's outcome onto a closed disposition.
 *
 * Exhaustive by construction: the parameter is the runtime's own union, and the `default` branch is
 * unreachable while every member is listed. A new outcome added upstream therefore fails to compile
 * here rather than being silently swallowed into a disposition somebody guessed.
 *
 * `PROCESSED` deliberately does not mean "replied". The runtime returns no client-facing text at
 * all, so no disposition here may imply one.
 */
function dispositionFor(outcome: JarvisRuntimeOutcome): RiyaWebConversationDisposition {
  switch (outcome) {
    case 'MODEL_DRAFTED':
    case 'CORE_ACCEPTED':
      return 'PROCESSED';
    case 'REFUSED':
    case 'CORE_REJECTED':
      // A decision was made, and it was no. Core rejecting a proposal is a refusal of the action,
      // not an outage, and collapsing it into NOT_READY would invite a caller to retry a decision.
      return 'REFUSED';
    case 'HUMAN_REVIEW_REQUIRED':
    case 'RETRY_LATER':
    case 'STALE_REVISION':
    case 'CORE_UNAVAILABLE':
    case 'NO_ACTION':
      // Not servable right now, and possibly servable later. Reporting any of these as PROCESSED
      // would tell a browser something happened when nothing did.
      return 'NOT_READY';
  }
}

/**
 * What a brand-new conversation is missing: the FOUR summary-blocking fields (RWC-P4B §20).
 *
 * Restated here rather than imported, because the reducer keeps its required-field list internal on
 * purpose — exporting it would make half a reducer public. The agreement is proved instead: a test
 * merges an EMPTY batch into this very initial state and asserts the reducer reports no change, so
 * the two lists cannot drift apart without a red test. The order matches the reducer's, which is
 * what makes that a value comparison rather than a set comparison.
 */
const RIYA_INITIAL_MISSING_FIELDS: readonly DiscoveryField[] = Object.freeze([
  'serviceInterest',
  'location',
  'budget',
  'timeline',
]);

/**
 * The canonical initial state for a conversation nobody has seen before.
 *
 * Built through the REAL P2A constructor rather than assembled by hand: hand-constructing a state
 * would bypass every invariant P2A enforces, and the first thing it would bypass is the one that
 * refuses a summary of nothing.
 */
function initialContinuity(
  tenantId: string,
  conversationId: string,
): RiyaConversationContinuityStateV1 {
  return createRiyaConversationContinuityState({
    version: 1,
    tenantId,
    conversationId,
    continuityRevision: 0,
    phase: 'INTRO',
    discovery: {
      completeness: 'MORE_DISCOVERY_REQUIRED',
      // The FOUR summary-required fields, not all seven (RWC-P4B §20; ADR-0098). `propertyType`,
      // `scope` and `consultationPreference` are genuinely optional and never block a summary, so
      // listing them as missing would make every conversation look permanently unfinished — and
      // would disagree with what the reducer recomputes on the very next turn.
      missingFields: [...RIYA_INITIAL_MISSING_FIELDS],
    },
    summaryConfirmed: false,
  });
}

/**
 * What one persistence attempt reports back.
 *
 * `reconciledAfterConflict` is true from the moment the FIRST compare-and-set returns
 * `REVISION_CONFLICT`, whether the reconciliation then wrote or found nothing left to write. The
 * question it answers is not "did we persist?" but "did the conversation move underneath the reply
 * this turn already produced?", and a lost first attempt answers that on its own.
 */
interface PersistedEvolution {
  readonly state: RiyaConversationContinuityStateV1;
  readonly reconciledAfterConflict: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Build the private web conversation service. Synchronous, and it opens nothing. */
export function createRiyaWebConversationService(
  config: RiyaWebConversationServiceConfig,
): RiyaWebConversationService {
  // Typed `unknown` at the check: the declared parameter promises three collaborators, but this is
  // a package boundary and a missing store would otherwise surface as a crash mid-turn — after the
  // envelope was built and possibly after the runtime ran.
  const supplied: unknown = config;
  const runtimeCandidate = supplied as { runtime?: Record<string, unknown> } | undefined;
  const hasRuntimeMethod = (name: string): boolean =>
    typeof runtimeCandidate?.runtime?.[name] === 'function';
  if (
    !isRecord(supplied) ||
    // The MATURE runtime surface, all three methods -- not just the one this service calls. A bare
    // `{ processInboundForCoreAuthorizedReply }` object is a content provider someone assembled, and
    // duck-typing one as the authoritative runtime is how a gate stops being reached.
    !hasRuntimeMethod('processInbound') ||
    !hasRuntimeMethod('applyConversationControlCommand') ||
    !hasRuntimeMethod('readConversationOperationsSnapshot') ||
    // ...plus the RWC-P2D capability. Fail CLOSED at construction: discovering this mid-turn would
    // mean a model had already run.
    !hasRuntimeMethod('processInboundForCoreAuthorizedReply') ||
    // ...plus the RWC-P4B capability this service actually calls. Also closed at construction: a
    // runtime without it could never produce observations, so continuity would silently stop
    // evolving while every turn still returned PROCESSED.
    !hasRuntimeMethod('processInboundForRiyaConversationEvolution') ||
    // ...plus the RWC-P7 post-summary capability (ADR-0103). Closed at construction for the same
    // reason as the others: a runtime without it would serve INTRO..SUMMARY normally and then start
    // failing every turn the moment a client confirmed their summary -- a defect that only surfaces
    // once a real conversation is most of the way through.
    !hasRuntimeMethod('processInboundForRiyaGroundedReply') ||
    typeof (supplied['continuityStore'] as { load?: unknown } | undefined)?.load !== 'function' ||
    typeof (supplied['continuityStore'] as { createInitialIfAbsent?: unknown } | undefined)
      ?.createInitialIfAbsent !== 'function' ||
    typeof (supplied['continuityStore'] as { compareAndSet?: unknown } | undefined)
      ?.compareAndSet !== 'function' ||
    // The RWC-P5 authority reader. Also closed at construction: discovering this mid-turn would mean
    // a conversation had already been loaded and a client was already waiting.
    typeof (supplied['availabilityReader'] as { readCurrent?: unknown } | undefined)
      ?.readCurrent !== 'function' ||
    typeof supplied['runtimeId'] !== 'string' ||
    supplied['runtimeId'].length === 0
  ) {
    throw new RiyaWebConversationError('invalid-input');
  }
  const runtime = supplied['runtime'] as RiyaConversationEvolutionJarvisRuntime;
  const continuityStore = supplied['continuityStore'] as RiyaContinuityStorePort;
  const availabilityReader = supplied['availabilityReader'] as CoreServiceAvailabilityReader;
  const runtimeId = supplied['runtimeId'];

  /**
   * Evolve one loaded continuity by one batch and persist it (RWC-P4B §22–§23, ADR-0099).
   *
   * At most TWO compare-and-set attempts, with exactly ONE reload between them, and in neither
   * attempt a second model call, runtime call, Core decision or re-extraction. The reducer is pure,
   * so re-merging the SAME captured batch against a newer state is a re-computation, not a second
   * observation — that purity is the whole reason one bounded reconciliation is safe.
   *
   * It reports `reconciledAfterConflict` because the CALLER needs it: the reply this turn produced
   * was written against `base`, and if `base` lost its compare-and-set then the conversation moved
   * underneath that reply. Observations can be re-merged; a sentence cannot.
   */
  async function persistEvolution(
    base: RiyaConversationContinuityStateV1,
    batch: RiyaConversationObservationBatchV1,
  ): Promise<PersistedEvolution> {
    let evolved;
    try {
      evolved = evolveRiyaConversation({ current: base, batch });
    } catch {
      // The runtime refuses to observe a state past the SUMMARY ceiling before it ever reaches a
      // model, so a throw here means the state that produced this batch and the state being merged
      // disagree. That is contradictory evidence, not a race.
      throw new RiyaWebConversationError('repository-invariant');
    }
    if (!evolved.changed) {
      // Nothing moved — the turn re-stated what was already known. No compare-and-set at all:
      // spending a durable write to store what is already stored would also bump a revision whose
      // entire meaning is "this conversation changed".
      return { state: base, reconciledAfterConflict: false };
    }

    let first: RiyaContinuityCasOutcome;
    try {
      first = await continuityStore.compareAndSet({
        expectedRevision: base.continuityRevision,
        nextState: evolved.state,
      });
    } catch {
      throw new RiyaWebConversationError('continuity-unavailable');
    }
    if (first === 'UPDATED') {
      // The state the reply was written against is still the state this turn extended. Nothing moved
      // underneath it, so the reply remains valid.
      return { state: evolved.state, reconciledAfterConflict: false };
    }
    if (first === 'NOT_FOUND') {
      // A row this same turn already loaded has gone. Creating a fresh one would restart a
      // conversation somebody is having, so the honest answer is that the durable evidence
      // contradicts itself.
      throw new RiyaWebConversationError('repository-invariant');
    }

    // REVISION_CONFLICT. ONE reload, one pure re-merge, one final attempt.
    let latest: RiyaConversationContinuityStateV1 | undefined;
    try {
      latest = await continuityStore.load({
        tenantId: base.tenantId,
        conversationId: base.conversationId,
      });
    } catch {
      throw new RiyaWebConversationError('continuity-unavailable');
    }
    if (latest === undefined) {
      throw new RiyaWebConversationError('repository-invariant');
    }
    if (latest.tenantId !== base.tenantId || latest.conversationId !== base.conversationId) {
      // The store answered about a different conversation, again.
      throw new RiyaWebConversationError('repository-invariant');
    }

    let remerged;
    try {
      remerged = evolveRiyaConversation({ current: latest, batch });
    } catch {
      // The winner of the race moved this conversation somewhere the reducer will not merge into —
      // past the SUMMARY ceiling, into RWC-P6's territory. Reconciliation genuinely lost; it is not
      // an inconsistent record.
      throw new RiyaWebConversationError('continuity-conflict');
    }
    if (!remerged.changed) {
      // Whoever won said the same thing, or something that outranks it. There is nothing left to
      // write, and the winner's state is the authoritative one.
      //
      // Still `reconciledAfterConflict: true`. The batch turning out to be redundant says nothing
      // about the REPLY: the winning turn may have recorded a fact this turn's reply is about to ask
      // for, and the merge being a no-op is exactly the case where that is most likely.
      return { state: latest, reconciledAfterConflict: true };
    }

    let second: RiyaContinuityCasOutcome;
    try {
      second = await continuityStore.compareAndSet({
        expectedRevision: latest.continuityRevision,
        nextState: remerged.state,
      });
    } catch {
      throw new RiyaWebConversationError('continuity-unavailable');
    }
    if (second === 'UPDATED') {
      return { state: remerged.state, reconciledAfterConflict: true };
    }
    if (second === 'NOT_FOUND') {
      throw new RiyaWebConversationError('repository-invariant');
    }
    // Lost twice. There is no third attempt: an unbounded retry loop holds one client's turn open
    // while other writers keep moving the state, and this service will not spin waiting for a
    // conversation nobody is watching to converge.
    throw new RiyaWebConversationError('continuity-conflict');
  }

  async function handleTurn(
    input: RiyaWebConversationTurnV1,
  ): Promise<RiyaWebConversationResultV2> {
    const parsed = webConversationTurnSchema.safeParse(input);
    if (!parsed.success) {
      // The zod issue is discarded: its path names the failing field and its message can quote the
      // value, and the value here is a person's own words.
      throw new RiyaWebConversationError('invalid-input');
    }
    const turn = parsed.data as RiyaWebConversationTurnV1;

    // 1. Continuity BEFORE the runtime. A turn that could not establish its own continuity must not
    //    reach a model: it would produce a proposal about a conversation nobody can account for.
    let continuity: RiyaConversationContinuityStateV1;
    try {
      const loaded = await continuityStore.load({
        tenantId: turn.tenantId,
        conversationId: turn.conversationId,
      });
      if (loaded === undefined) {
        // Two simultaneous first turns may compute the same candidate. Only the store decides which
        // one won, and BOTH callers then use the state it hands back — a service that trusted its
        // own candidate would give one of them a state the store never stored.
        const created = await continuityStore.createInitialIfAbsent({
          state: initialContinuity(turn.tenantId, turn.conversationId),
        });
        continuity = created.state;
      } else {
        continuity = loaded;
      }
    } catch (error: unknown) {
      // Uncertainty is never converted into a served turn. An unavailable store is exactly when a
      // conversation would silently restart from nothing.
      if (error instanceof RiyaWebConversationError) {
        throw error;
      }
      throw new RiyaWebConversationError('continuity-unavailable');
    }

    if (
      continuity.tenantId !== turn.tenantId ||
      continuity.conversationId !== turn.conversationId
    ) {
      // The store answered about a different conversation. Serving the turn anyway would attach one
      // client's continuity to another's message.
      throw new RiyaWebConversationError('repository-invariant');
    }

    // 2. The CURRENT Core-owned availability, read EXACTLY ONCE and re-proved (RWC-P5, ADR-0100).
    //
    //    After continuity, because a turn that could not establish its own conversation must not
    //    reach Core either — and before the envelope, because there is no point building one for a
    //    turn that cannot run.
    //
    //    Read on EVERY discovery turn, unconditionally. The alternative is inspecting the client's
    //    prose first to guess whether city or service authority will be needed, and that guess is a
    //    second natural-language path with no model behind it — wrong exactly when a client corrects
    //    their city in a sentence nobody predicted.
    let availabilitySnapshot: CoreServiceAvailabilitySnapshotV1;
    try {
      const raw: unknown = await availabilityReader.readCurrent({ tenantId: turn.tenantId });
      availabilitySnapshot = parseCoreServiceAvailabilitySnapshotV1(raw);
    } catch {
      // FAIL CLOSED, and specifically fail closed as NOT_READY rather than as a refusal.
      //
      // Authority this turn needs is temporarily unavailable. That is not a business decision about
      // the client, so it must not read as one — and it is not an inconsistency in our own records,
      // so it is not `repository-invariant` either. `NOT_READY` already means exactly this: not
      // servable now, possibly servable later.
      //
      // Nothing from the reader's error escapes: it may name a host, a token or a Core payload.
      //
      // No runtime call, no model call, no Core decision, no compare-and-set. There is no default
      // city, no cached fallback and no "assume available" — an outage must never become a promise.
      return Object.freeze({
        version: 2 as const,
        tenantId: turn.tenantId,
        conversationId: turn.conversationId,
        messageId: turn.messageId,
        disposition: 'NOT_READY' as const,
        reason: undefined,
        continuity,
        authorizedReply: undefined,
      });
    }

    // 3. The envelope, with the three values fixed by this service.
    const envelope = buildWebInboundEnvelope(turn, runtimeId);

    // 4. EXACTLY ONE delegation to the authoritative runtime. No retry, no second call, no fallback
    //    path — a retry inside a boundary that has already reached a model is how one turn becomes
    //    two proposals.
    let outcome: JarvisRuntimeOutcome;
    let refusalReason: RiyaWebConversationResultV2['reason'];
    let authorizedReply: JarvisCoreAuthorizedReplyV1 | undefined;
    let observationBatch: RiyaConversationObservationBatchV1 | undefined;
    try {
      // EXACTLY ONE Riya-aware capability, chosen by the loaded PHASE (RWC-P7, ADR-0103).
      //
      // Never both, and never one after the other refuses. Discovery phases go to the RWC-P4B
      // evolution capability, which extracts observations; post-summary phases go to the RWC-P7
      // reply-only capability, which cannot. Retrying with the other after a refusal would be a
      // second orchestration run, a second model call and a second Core decision for one turn — and
      // it would let a turn refused as a state change be re-served as a conversation.
      //
      // Neither `processInbound` nor `processInboundForCoreAuthorizedReply` is called in addition:
      // that would be two independent extractions of one sentence, which could disagree.
      //
      // The SAME snapshot object read above goes to whichever is selected. It is captured once for
      // the turn and is never re-read — in particular not during a compare-and-set reconciliation,
      // where a fresher authority could invalidate text no second model call is permitted to
      // replace.
      let detailed: {
        readonly runtimeResult: JarvisRuntimeResult;
        readonly authorizedReply: JarvisCoreAuthorizedReplyV1 | undefined;
      };
      if (POST_SUMMARY_PHASES.includes(continuity.phase)) {
        detailed = await runtime.processInboundForRiyaGroundedReply({
          envelope,
          continuity,
          availabilitySnapshot,
        });
        // `observationBatch` is deliberately left `undefined`. The grounded reply result has no such
        // field at all, so a post-summary turn cannot produce one — and therefore cannot reach the
        // evolution and compare-and-set below.
      } else {
        const evolved = await runtime.processInboundForRiyaConversationEvolution({
          envelope,
          continuity,
          availabilitySnapshot,
        });
        observationBatch = evolved.observationBatch;
        detailed = evolved;
      }
      outcome = detailed.runtimeResult.outcome;
      refusalReason = detailed.runtimeResult.refusalReason;
      if (detailed.authorizedReply !== undefined) {
        if (!materializationAgreesWithRun(detailed.runtimeResult, detailed.authorizedReply)) {
          // Fail closed on self-contradicting evidence, using the EXISTING bounded invariant code.
          // Nothing about the body is put in the error -- the code names the kind of fault, and the
          // fixed message carries no identifier, no outcome and no text.
          throw new RiyaWebConversationError('repository-invariant');
        }
        authorizedReply = detailed.authorizedReply;
      }
    } catch (error: unknown) {
      // A refusal this service already decided is re-thrown unchanged. Only the RUNTIME's own error
      // is collapsed: it is a different bounded vocabulary, and wrapping it would make this
      // service's surface open-ended.
      if (error instanceof RiyaWebConversationError) {
        throw error;
      }
      throw new RiyaWebConversationError('runtime-unavailable');
    }

    // 5. Evolve and persist, from the observations that ONE model call produced.
    //
    //    Deliberately independent of what Core decided: a client said what they said, and Core
    //    declining to send a reply does not unsay it. What gates persistence is whether the
    //    structured model answer passed the adapter's own gates — which is exactly what the presence
    //    of a canonical batch means.
    if (observationBatch !== undefined) {
      const persisted = await persistEvolution(continuity, observationBatch);
      continuity = persisted.state;
      if (persisted.reconciledAfterConflict) {
        // 5a. WITHHOLD the Core-authorized body (RWC-P4B owner correction; ADR-0099 §13a).
        //
        // The reply was drafted from, and authorized against, the continuity snapshot this turn
        // loaded — and that snapshot lost its compare-and-set, so another writer changed the
        // conversation while this turn was in flight. The reply can therefore be about a
        // conversation that no longer exists: it might ask which area the client is in, moments
        // after they told a concurrent turn exactly that.
        //
        // Re-checking the question plan would not be enough. The body is free text and may restate
        // ANY fact from the old snapshot, so the only safe reading is that a reply is bound to the
        // snapshot the model saw.
        //
        // The observations still persist — a fact is a fact, and the reducer re-merged it against
        // the winner. Only the TEXT capability is withheld, and nothing is re-run to replace it:
        // no second model call, no second Core decision, no generated stand-in. The V2 contract has
        // always permitted PROCESSED with no `authorizedReply`, and the private ingress already
        // treats the body's PRESENCE as the sole text gate.
        authorizedReply = undefined;
      }
    }

    // 6. The FINAL authoritative continuity — evolved and persisted when this turn observed
    //    something, and the state as loaded when it did not.
    return Object.freeze({
      version: 2 as const,
      tenantId: turn.tenantId,
      conversationId: turn.conversationId,
      messageId: turn.messageId,
      disposition: dispositionFor(outcome),
      reason: refusalReason,
      continuity,
      authorizedReply,
    });
  }

  return Object.freeze({ handleTurn });
}
