/**
 * Deterministic authoritative-state fakes for tests (QFJ-M5, ADR-0059).
 *
 * The ONLY concrete `AuthoritativeConversationStatePort` implementations, shipped under `./testing`.
 * All synthetic — no real conversation, subject, database, or network. A recording source returns each
 * scripted control state in turn (last repeated) and counts reads, proving every lower reader delegates
 * to the SAME instance; a mutable source reads a shared cell, letting a change land while an external
 * Promise is pending. Async (ADR-0058 §4).
 */
import type {
  AuthoritativeConversationStatePort,
  ConversationControlState,
} from '../contracts/authoritative-state.js';

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
    read(_conversationId: string): Promise<ConversationControlState> {
      counter.n += 1;
      const value = states[Math.min(index, states.length - 1)] ?? clearControlState();
      index += 1;
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
    read(_conversationId: string): Promise<ConversationControlState> {
      counter.n += 1;
      return Promise.resolve(get());
    },
    reads: () => counter.n,
  });
}

/** A fixed canonical-instant clock. */
export function fixedClock(instant = '2026-07-25T00:00:00Z'): () => string {
  return () => instant;
}
