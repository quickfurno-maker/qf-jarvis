/**
 * The private Riya web conversation service (RWC-P2C, ADR-0094).
 *
 * ### One turn, one runtime call, one bounded result
 *
 * 1. validate the turn;
 * 2. LOAD continuity, or initialize it atomically through the injected store;
 * 3. build the existing `InboundEnvelope` with `WEB`/`CLIENT`/`INBOUND` fixed;
 * 4. delegate EXACTLY ONCE to the already-composed authoritative runtime, through its RWC-P2D
 *    `processInboundForCoreAuthorizedReply` capability (ADR-0096) — one call, one orchestration run;
 * 5. map the outcome to a closed disposition, cross-check any Core-authorized body against the run
 *    that produced it, and return the continuity UNCHANGED.
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
 * It is not RWC-P4. Nothing here parses prose, classifies intent, updates `NeedDiscovery`, merges
 * provenance, advances a phase, confirms a summary, mints completion evidence or computes
 * `canSubmit`. And it fabricates no `ClientSalesSignals`: `JarvisRuntimeConfig.behaviourInput` is
 * OPTIONAL, and its own documentation states that when absent "the runtime takes the legacy `REPLY`
 * path unchanged and Riya behaviour is never consulted". P2C reuses exactly that supported mode.
 * Inventing all-false signals to force the behaviour kernel to run would be manufacturing an input
 * no one supplied, in order to reach a code path this slice has no authority over.
 *
 * It is not a transport. There is no HTTP server, route, URL, cookie, CORS or browser reachability —
 * a QuickFurno server gateway is the only intended caller, and that ingress is a later slice.
 */
import type {
  CoreAuthorizedReplyJarvisRuntime,
  JarvisCoreAuthorizedReplyV1,
  JarvisRuntimeOutcome,
  JarvisRuntimeResult,
} from '@qf-jarvis/jarvis-runtime';
import { DISCOVERY_FIELDS_FROZEN } from '@qf-jarvis/riya-agent';
import { createRiyaConversationContinuityState } from '@qf-jarvis/riya-conversation-continuity';
import type { RiyaConversationContinuityStateV1 } from '@qf-jarvis/riya-conversation-continuity';

import { RiyaWebConversationError } from '../contracts/errors.js';
import type {
  RiyaWebConversationDisposition,
  RiyaWebConversationResultV2,
} from '../contracts/result.js';
import type { RiyaContinuityStorePort } from '../contracts/store-port.js';
import { webConversationTurnSchema } from '../contracts/turn.js';
import type { RiyaWebConversationTurnV1 } from '../contracts/turn.js';
import { buildWebInboundEnvelope } from '../internal/envelope.js';

/** What a caller injects. Every collaborator is required; there is no default for any of them. */
export interface RiyaWebConversationServiceConfig {
  /**
   * The ALREADY-COMPOSED authoritative runtime, which MUST expose the RWC-P2D content-bearing
   * capability. This service composes nothing.
   *
   * The capability is required rather than optional because the service returns `authorizedReply` in
   * its V2 result: a runtime without it could only ever produce `undefined`, and a permanently-empty
   * field is exactly the dead branch RWC-P2C refused to add in the first place.
   */
  readonly runtime: CoreAuthorizedReplyJarvisRuntime;
  /** The continuity store. Required — an in-memory default would lose state on restart. */
  readonly continuityStore: RiyaContinuityStorePort;
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
      missingFields: [...DISCOVERY_FIELDS_FROZEN],
    },
    summaryConfirmed: false,
  });
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
    typeof (supplied['continuityStore'] as { load?: unknown } | undefined)?.load !== 'function' ||
    typeof (supplied['continuityStore'] as { createInitialIfAbsent?: unknown } | undefined)
      ?.createInitialIfAbsent !== 'function' ||
    typeof (supplied['continuityStore'] as { compareAndSet?: unknown } | undefined)
      ?.compareAndSet !== 'function' ||
    typeof supplied['runtimeId'] !== 'string' ||
    supplied['runtimeId'].length === 0
  ) {
    throw new RiyaWebConversationError('invalid-input');
  }
  const runtime = supplied['runtime'] as CoreAuthorizedReplyJarvisRuntime;
  const continuityStore = supplied['continuityStore'] as RiyaContinuityStorePort;
  const runtimeId = supplied['runtimeId'];

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

    // 2. The envelope, with the three values fixed by this service.
    const envelope = buildWebInboundEnvelope(turn, runtimeId);

    // 3. EXACTLY ONE delegation to the authoritative runtime. No retry, no second call, no fallback
    //    path — a retry inside a boundary that has already reached a model is how one turn becomes
    //    two proposals.
    let outcome: JarvisRuntimeOutcome;
    let refusalReason: RiyaWebConversationResultV2['reason'];
    let authorizedReply: JarvisCoreAuthorizedReplyV1 | undefined;
    try {
      // The content-bearing capability, called ONCE. Ordinary `processInbound` is NOT called in
      // addition: that would be a second orchestration run, a second model call and a second Core
      // decision for one inbound turn.
      const detailed = await runtime.processInboundForCoreAuthorizedReply(envelope);
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

    // 4. Continuity is returned exactly as it was loaded or created. RWC-P4 owns evolution, and
    //    there is deliberately no `compareAndSet` on this path.
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
