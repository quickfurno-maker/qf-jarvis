/**
 * Deterministic authoritative-state fakes for tests (QFJ-M5, ADR-0059).
 *
 * The ONLY concrete `AuthoritativeConversationStatePort` implementations, shipped under `./testing`.
 * All synthetic — no real conversation, subject, database, or network. A recording source returns each
 * scripted control state in turn (last repeated) and counts reads, proving every lower reader delegates
 * to the SAME instance; a mutable source reads a shared cell, letting a change land while an external
 * Promise is pending. Async (ADR-0058 §4).
 */
import {
  applyConversationControlCommand,
  createConversationControlSnapshot,
} from '@qf-jarvis/conversation-control';
import type {
  ConversationControlCommand,
  ConversationControlDecision,
} from '@qf-jarvis/conversation-control';
import type { ConversationState } from '@qf-jarvis/agent-runtime';

import type {
  AuthoritativeConversationStatePort,
  ConversationControlState,
  ConversationStateKey,
  ConversationOperationsProjection,
  OperatorAuthoritativeConversationStatePort,
} from '../contracts/authoritative-state.js';

/**
 * Every fake below is TENANT-SCOPED (QFJ-P08-B1, ADR-0076).
 *
 * A fake that ignored the key would let a tenant-scoping regression pass, which is the one thing
 * these fakes now exist to catch. Each therefore verifies BOTH identifiers against the state it is
 * about to return, and refuses rather than answering about a conversation nobody asked for.
 */
function assertServes(key: ConversationStateKey, state: ConversationControlState): void {
  if (state.tenantId !== key.tenantId || state.conversationId !== key.conversationId) {
    throw new Error('synthetic-state-key-mismatch');
  }
}

/** A clear synthetic control state; override any field for a specific test. */
export function clearControlState(
  over: Partial<ConversationControlState> = {},
): ConversationControlState {
  return Object.freeze({
    conversationId: 'conv.1',
    tenantId: 'tenant.a',
    revision: 1,
    partyType: 'CLIENT',
    dataClass: 'HOSTED_ALLOWED',
    humanTakeover: false,
    aiPaused: false,
    cancelled: false,
    subjectStatus: 'clear',
    subjectRef: undefined,
    observedAt: '2026-07-25T00:00:00Z',
    ...over,
  });
}

/** A source that returns each scripted state in turn (last repeated); records the total read count. */
export interface RecordingAuthoritativeState extends AuthoritativeConversationStatePort {
  readonly reads: () => number;
}
export function scriptedAuthoritativeState(
  ...states: readonly ConversationControlState[]
): RecordingAuthoritativeState {
  let index = 0;
  const counter = { n: 0 };
  return Object.freeze({
    read(key: ConversationStateKey): Promise<ConversationControlState> {
      counter.n += 1;
      const value = states[Math.min(index, states.length - 1)] ?? clearControlState();
      index += 1;
      assertServes(key, value);
      return Promise.resolve(value);
    },
    reads: () => counter.n,
  });
}

/** A source that reads a shared mutable cell — a change to the cell is seen on the next awaited read. */
export interface MutableAuthoritativeState extends AuthoritativeConversationStatePort {
  readonly reads: () => number;
}
export function mutableAuthoritativeState(
  get: () => ConversationControlState,
): MutableAuthoritativeState {
  const counter = { n: 0 };
  return Object.freeze({
    read(key: ConversationStateKey): Promise<ConversationControlState> {
      counter.n += 1;
      const value = get();
      assertServes(key, value);
      return Promise.resolve(value);
    },
    reads: () => counter.n,
  });
}

/** A fixed canonical-instant clock. */
export function fixedClock(instant = '2026-07-25T00:00:00Z'): () => string {
  return () => instant;
}

// ---------------------------------------------------------------------------
// QFJ-P08-A (ADR-0075): a controllable authoritative source.
//
// TEST SUPPORT ONLY. This is the only implementation of the operator capabilities anywhere in the
// repository, it lives under `./testing`, and it is NOT persistence: process memory only, no restart
// survival, no cross-process concurrency, no durable command-id dedup, no transaction. A real
// persistent adapter must implement `applyControlCommand` as ONE atomic/CAS operation; this fake gets
// away with a closure because a single test has a single writer.
//
// It deliberately holds MUTABLE closure state, which production composition may never do.
// ---------------------------------------------------------------------------

/** The test-only controllable source: the read port plus both operator capabilities. */
export interface ControllableAuthoritativeState extends OperatorAuthoritativeConversationStatePort {
  /** How many times any lower reader delegated to THIS object. */
  readonly reads: () => number;
  /** How many control commands this object applied. */
  readonly controlApplications: () => number;
  /** How many operations projections this object served. */
  readonly operationsReads: () => number;
  /** The current full control state, as a frozen copy. Inspection only. */
  readonly current: () => ConversationControlState;
}

/**
 * A synthetic controllable authoritative source.
 *
 * `applyControlCommand` projects the full state down to the four-field control fragment, calls the
 * REAL `applyConversationControlCommand` reducer from `@qf-jarvis/conversation-control` — this fake
 * defines no semantics of its own — and, on `APPLIED` only, writes back `revision`, `humanTakeover`,
 * `aiPaused` and `observedAt`, preserving every other field. `NO_CHANGE` and `REFUSED` mutate nothing.
 *
 * It does NOT deduplicate `commandId` and does NOT retry a stale revision.
 */
export function controllableAuthoritativeState(
  initial: ConversationControlState = clearControlState(),
): ControllableAuthoritativeState {
  // Mutable, and allowed to be: this is test support, not a production adapter.
  let state: ConversationControlState = Object.freeze({ ...initial });
  let lastActivityAt = '2026-08-01T00:00:00.000Z';
  let auditRef = 'audit.initial';
  const counters = { reads: 0, controls: 0, operations: 0 };

  /**
   * SYNTHETIC TEST BEHAVIOUR ONLY. NOT A PRODUCTION BUSINESS RULE, and deliberately not exported as a
   * mapper: production composition copies `conversationState` from its source precisely so that
   * `jarvis-runtime` never defines conversation-state transitions as a side effect of a control flag.
   */
  const syntheticConversationState = (s: ConversationControlState): ConversationState => {
    if (s.humanTakeover) {
      return 'HUMAN_TAKEOVER';
    }
    return s.aiPaused ? 'WAITING_EXTERNAL' : 'ACTIVE_AI';
  };

  return Object.freeze({
    read(key: ConversationStateKey): Promise<ConversationControlState> {
      counters.reads += 1;
      assertServes(key, state);
      return Promise.resolve(state);
    },

    applyControlCommand(
      key: ConversationStateKey,
      command: ConversationControlCommand,
    ): Promise<ConversationControlDecision> {
      counters.controls += 1;
      assertServes(key, state);
      // The command names the conversation the key already scoped; disagreement is a wiring error.
      if (command.conversationId !== key.conversationId) {
        throw new Error('synthetic-command-key-mismatch');
      }
      const fragment = createConversationControlSnapshot({
        conversationId: state.conversationId,
        revision: state.revision,
        humanTakeover: state.humanTakeover,
        aiPaused: state.aiPaused,
      });
      const decision = applyConversationControlCommand(fragment, command);
      if (decision.outcome === 'APPLIED') {
        state = Object.freeze({
          ...state,
          revision: decision.nextState.revision,
          humanTakeover: decision.nextState.humanTakeover,
          aiPaused: decision.nextState.aiPaused,
          observedAt: command.issuedAt,
        });
        // TEST-ONLY projection evidence, so a spec can correlate a snapshot with the command that
        // produced it. A production source supplies these from its own authoritative store.
        lastActivityAt = command.issuedAt;
        auditRef = command.commandId;
      }
      return Promise.resolve(decision);
    },

    readOperationsProjection(key: ConversationStateKey): Promise<ConversationOperationsProjection> {
      counters.operations += 1;
      assertServes(key, state);
      return Promise.resolve(
        Object.freeze({
          state,
          conversationState: syntheticConversationState(state),
          lastActivityAt,
          // Fixed safe synthetic tokens. Acceptable ONLY here, in `./testing`.
          escalationStatus: 'none',
          followUpStatus: 'none',
          deliveryStatePlaceholder: 'not-implemented',
          auditRef,
        }),
      );
    },

    reads: () => counters.reads,
    controlApplications: () => counters.controls,
    operationsReads: () => counters.operations,
    current: () => state,
  });
}
