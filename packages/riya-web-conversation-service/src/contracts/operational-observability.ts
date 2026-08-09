/**
 * Content-free operational observability for the Riya text turn (RWC-P9, ADR-0105).
 *
 * ### What this is for
 *
 * An operator needs to know whether the service is shedding load, whether conversations are
 * contending, how often a logical message is being replayed, and — most of all — whether any turn has
 * become INDETERMINATE, because that is the one state that means a business effect may have happened
 * and cannot be re-run. None of those questions needs a single identifier or a single word a client
 * wrote.
 *
 * ### It is an AGGREGATE signal, not a trace
 *
 * Every field below is either a closed enum or a count. There is deliberately no tenant,
 * conversation, message, subject, channel reference, digest, request id, prompt, model, provider,
 * SQL, host, raw error or stack — and no message text or reply.
 *
 * That is not caution for its own sake. A telemetry stream is the least governed thing in a
 * deployment: it fans out to sinks nobody reviewed, is retained longer than anything else, and is
 * read by people who never saw the privacy contract. An event carrying a conversation id would make
 * every one of those a place a client's conversation can be followed. Counting is enough to run the
 * system; identifying is not needed to run it.
 *
 * ### It can never change what happens
 *
 * The hook is SYNCHRONOUS and its result is ignored. Nothing awaits it, nothing branches on it, and a
 * hook that throws on every event leaves the turn structurally identical — asserted by a spec that
 * runs the whole matrix twice, once with a no-op hook and once with a hook that throws.
 *
 * An asynchronous hook would be worse than useless here: it would either be awaited, putting a
 * metrics sink on the critical path of a client's answer, or fired and forgotten, in which case the
 * `Promise` rejection would surface as an unhandled rejection somewhere unrelated.
 */
import type { RiyaConversationPhase } from '@qf-jarvis/riya-conversation-continuity';

import type { RiyaConversationChannel } from './channel-turn.js';
import type { RiyaWebConversationErrorCode } from './errors.js';
import type { RiyaWebConversationDisposition } from './result.js';
import type { RiyaTurnBeginOutcome } from './turn-coordinator-port.js';

const EVENT_TYPE_VALUES = [
  /** A capacity slot was taken. The turn may now touch the coordinator. */
  'text-turn-admitted',
  /** No slot was free. Nothing downstream ran — no coordinator, no database, no model. */
  'text-turn-overloaded',
  /** The durable coordinator classified this logical message. */
  'text-turn-coordinator-outcome',
  /** The durable claim is written. From here the message is potentially spent. */
  'text-turn-processing-started',
  /** A normal bounded result is being returned. */
  'text-turn-completed',
  /** A bounded service failure. The CODE only, never the error. */
  'text-turn-failed',
] as const;

export type RiyaConversationOperationalEventType = (typeof EVENT_TYPE_VALUES)[number];

export const RIYA_CONVERSATION_OPERATIONAL_EVENT_TYPES: readonly RiyaConversationOperationalEventType[] =
  Object.freeze([...EVENT_TYPE_VALUES]);

/**
 * One operational observation. Frozen, closed, and countable.
 *
 * Every optional field is present only when it is meaningful to the event — an overload has no
 * disposition, a completion has no begin outcome.
 */
export interface RiyaConversationOperationalEvent {
  readonly type: RiyaConversationOperationalEventType;
  /** Which surface. A closed vocabulary, not a provider identity. */
  readonly channel?: RiyaConversationChannel;
  /** The phase the turn was served from. Says nothing about who is in it. */
  readonly phase?: RiyaConversationPhase;
  readonly beginOutcome?: RiyaTurnBeginOutcome;
  readonly disposition?: RiyaWebConversationDisposition;
  /** The BOUNDED service code. Never a message, a cause or a stack. */
  readonly errorCode?: RiyaWebConversationErrorCode;
  /** Capacity, for a gauge. Two integers; neither identifies anything. */
  readonly activeTurns?: number;
  readonly maxConcurrentTurns?: number;
}

/**
 * The injected sink.
 *
 * Synchronous and `void`. A deployment decides what it writes to; this package adds no logger, no
 * metrics client, no exporter and no transport.
 */
export interface RiyaConversationOperationalObservabilityHook {
  record(event: RiyaConversationOperationalEvent): void;
}

/** The default. Absent configuration means silence, not a crash and not a hidden logger. */
export const NOOP_RIYA_CONVERSATION_OPERATIONAL_OBSERVABILITY: RiyaConversationOperationalObservabilityHook =
  Object.freeze({
    record(): void {
      // Intentionally nothing.
    },
  });
