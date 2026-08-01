/**
 * The ONE authoritative content-free conversation-state source (QFJ-M5, ADR-0059 §C, §D).
 *
 * This is the single source of conversation-control truth the composition root wires ALL lower state
 * readers to (the M2 conversation-context port, the M3 `CoreDecisionStateReader`, the M4
 * `ReplyStateReader`, and the privacy gate). There is no module-local competing state authority; every
 * gate re-reads THIS source across each awaited boundary, so a change during an await is observed and
 * fails closed. It is provider-neutral, content-free, and asynchronous (a live read is database-backed,
 * ADR-0058 §1). It reads no message/reply/prompt/knowledge content; the only concrete implementation is
 * the deterministic fake under `./testing`. It carries NO business rule — QuickFurno Core stays
 * authoritative.
 */
import type {
  ConversationState,
  RuntimeDataClass,
  RuntimePartyType,
  RuntimeSubjectStatus,
} from '@qf-jarvis/agent-runtime';
import type {
  ConversationControlCommand,
  ConversationControlDecision,
} from '@qf-jarvis/conversation-control';

/** The safe, content-free control state of one conversation, keyed by conversation id. */
export interface ConversationControlState {
  readonly conversationId: string;
  readonly tenantId: string;
  readonly revision: number;
  readonly partyType: RuntimePartyType;
  readonly dataClass: RuntimeDataClass;
  readonly humanTakeover: boolean;
  readonly aiPaused: boolean;
  readonly cancelled: boolean;
  /** The subject privacy/tombstone status; only `clear` permits proceeding. */
  readonly subjectStatus: RuntimeSubjectStatus;
  /** An optional OPAQUE subject reference (never subject content); its presence triggers the privacy gate. */
  readonly subjectRef: string | undefined;
  /** A canonical observed-at instant/reference (safe; for correlation only). */
  readonly observedAt: string;
}

/**
 * The composite key that addresses one conversation's state (QFJ-P08-B1, ADR-0076).
 *
 * `conversationId` is NOT assumed globally unique. No tracked governance guarantees it, and the
 * runtime has always carried `tenantId` and `conversationId` as two separate identifiers -- so a
 * lookup by conversation alone is an unscoped query that a future persistent store could answer from
 * the wrong tenant.
 *
 * The previous shape read by conversation and compared the tenant AFTERWARDS. That is post-hoc tenant
 * checking: it detects a cross-tenant answer only once the wrong row has already been read, and only
 * on the inbound path, which was the one place a tenant existed to compare against -- the operator
 * control and query paths had nothing to compare with at all. Scoping the key makes cross-tenant
 * addressing unrepresentable rather than merely detectable.
 */
export interface ConversationStateKey {
  readonly tenantId: string;
  readonly conversationId: string;
}

/** Supplies the current authoritative content-free control state for a conversation. Awaited. */
export interface AuthoritativeConversationStatePort {
  read(key: ConversationStateKey): Promise<ConversationControlState>;
}

/**
 * The OPTIONAL operator capabilities the same source may also implement (QFJ-P08-A, ADR-0075).
 *
 * These EXTEND the read port above; they do not replace it, and `read` is unchanged, so every
 * existing read-only implementation stays valid and every existing inbound path is untouched.
 *
 * Crucially there is still exactly ONE `authoritativeState` field on `JarvisRuntimeConfig`. A second
 * writable-state field would be a split brain: an operator could set a takeover on one object while
 * the next inbound turn read another and kept replying. The runtime therefore DETECTS these
 * capabilities on the same object it already reads from, rather than accepting a second source.
 */

/**
 * A source that can also APPLY an operator control command.
 *
 * This is an ATOMIC boundary, not a convenience wrapper. An implementation must:
 *
 * - apply exactly the semantics of `applyConversationControlCommand` from
 *   `@qf-jarvis/conversation-control` (ADR-0074) — it may not invent its own;
 * - compare `expectedRevision` against the authoritative CURRENT revision;
 * - make an `APPLIED` control state authoritative before the promise resolves, so the very next
 *   `read` observes it;
 * - leave control state untouched on `NO_CHANGE` and `REFUSED`;
 * - combine read + decide + write into ONE atomic/transactional/compare-and-set operation. A
 *   persistent implementation that read, decided, then wrote would let a second operator change the
 *   revision in between, and the later write would silently clobber a decision made against state
 *   that no longer existed;
 * - never silently retry a stale command, and never alter `commandId`, `operatorRef` or `reasonRef`;
 * - return the exact decision and evidence for THIS application.
 *
 * It performs no business authorization. QuickFurno Core remains the final business authority.
 *
 * **No persistent implementation exists in this repository.** The only implementation is the
 * deterministic in-process fake under `@qf-jarvis/jarvis-runtime/testing`, which is test support and
 * not durability: no restart survival, no cross-process concurrency, no durable command-id dedup.
 */
export interface WritableAuthoritativeConversationStatePort extends AuthoritativeConversationStatePort {
  applyControlCommand(
    key: ConversationStateKey,
    command: ConversationControlCommand,
  ): Promise<ConversationControlDecision>;
}

/**
 * One authoritative operations projection.
 *
 * The nested `state` is the SAME authoritative control record the inbound path reads, so
 * `conversationId`, `revision`, `partyType`, `humanTakeover` and `aiPaused` all come from one record
 * rather than from a second projection cache that could disagree with it. A persistent adapter can
 * fetch the record and its six supplemental tokens atomically from its own store.
 *
 * There is deliberately NO `assignedActor` field. The Jarvis composition computes the actor with M1's
 * `assignAgent`; letting a projection source name it would make an injected object an assignment
 * authority, which ADR-0054 reserves for that one function.
 */
export interface ConversationOperationsProjection {
  readonly state: ConversationControlState;
  readonly conversationState: ConversationState;
  readonly lastActivityAt: string;
  readonly escalationStatus: string;
  readonly followUpStatus: string;
  readonly deliveryStatePlaceholder: string;
  readonly auditRef: string;
}

/** A source that can also supply the operations projection for a conversation. */
export interface OperationsProjectingAuthoritativeConversationStatePort extends AuthoritativeConversationStatePort {
  readOperationsProjection(key: ConversationStateKey): Promise<ConversationOperationsProjection>;
}

/** A source implementing both operator capabilities. Neither is required by the inbound path. */
export interface OperatorAuthoritativeConversationStatePort
  extends
    WritableAuthoritativeConversationStatePort,
    OperationsProjectingAuthoritativeConversationStatePort {}
