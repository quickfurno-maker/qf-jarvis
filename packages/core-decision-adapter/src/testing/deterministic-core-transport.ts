/**
 * Deterministic Core transport + state fakes for tests (QFJ-M3, ADR-0056).
 *
 * The ONLY concrete transport/state implementations, shipped under `./testing`. All synthetic — no
 * real Core, network, auth, or secret. Every I/O-capable boundary is asynchronous (ADR-0058 §4): a
 * scripted transport echoes the command identity with a chosen outcome; throwing/malformed/mismatched
 * variants drive the fail-closed paths; a scripted state reader drives the double gate.
 */
import type { CoreDecisionOutcome } from '@qf-jarvis/agent-runtime';

import type { CoreDecisionState, CoreDecisionStateReader } from '../contracts/state.js';
import { canonicalJson } from '../contracts/digest.js';
import type { CoreDecisionTransport } from '../transport/core-decision-transport.js';

interface Recording {
  readonly invoked: () => number;
}

function parseCommand(serialized: string): Record<string, unknown> {
  return JSON.parse(serialized) as Record<string, unknown>;
}

/**
 * A transport that echoes the command identity with the scripted outcome. Records invocation.
 *
 * Since RWC-P2D (ADR-0096) it also echoes `proposalDigest`, exactly as a conforming Core must: it
 * returns the digest it was SENT rather than recomputing one, because a responder that recomputed
 * the digest from its own view of the proposal would agree with itself no matter what it received.
 */
export function scriptedCoreTransport(
  outcome: CoreDecisionOutcome,
): CoreDecisionTransport & Recording {
  const counter = { n: 0 };
  return Object.freeze({
    send(serializedCommand: string): Promise<string> {
      counter.n += 1;
      const c = parseCommand(serializedCommand);
      return Promise.resolve(
        canonicalJson({
          protocol: c['protocol'],
          commandId: c['commandId'],
          idempotencyKey: c['idempotencyKey'],
          proposalId: c['proposalId'],
          proposalVersion: c['proposalVersion'],
          conversationId: c['conversationId'],
          boundRevision: c['expectedRevision'],
          proposalDigest: c['proposalDigest'],
          outcome,
          reason: 'core-decided',
          decidedAt: '2026-07-25T00:00:05Z',
        }),
      );
    },
    invoked: () => counter.n,
  });
}

/**
 * A transport that REPLAYS one previously captured response, whatever it is now asked (RWC-P2D).
 *
 * This is the stale/cached-decision adversary. It models a Core — or a proxy, or a retry layer —
 * that has already answered for this proposal identity and returns that earlier answer again. Under
 * identity-only validation the replay is indistinguishable from a fresh decision, because
 * `proposalId` and `idempotencyKey` deliberately exclude model output. The captured response carries
 * the EARLIER `proposalDigest`, so the comparison in `validateResponse` is what tells them apart.
 *
 * `capture()` records the next real response; `replay(serialized)` fixes what will be returned from
 * then on.
 */
export interface ReplayingCoreTransport extends CoreDecisionTransport, Recording {
  /** The last response this transport produced, or `undefined` before the first send. */
  readonly last: () => string | undefined;
  /** Return `serialized` verbatim for every subsequent send. */
  readonly replay: (serialized: string) => void;
}
export function replayingCoreTransport(outcome: CoreDecisionOutcome): ReplayingCoreTransport {
  const inner = scriptedCoreTransport(outcome);
  const counter = { n: 0 };
  let lastResponse: string | undefined;
  let replayed: string | undefined;
  return Object.freeze({
    async send(serializedCommand: string): Promise<string> {
      counter.n += 1;
      if (replayed !== undefined) {
        return replayed;
      }
      lastResponse = await inner.send(serializedCommand);
      return lastResponse;
    },
    invoked: () => counter.n,
    last: () => lastResponse,
    replay: (serialized: string) => {
      replayed = serialized;
    },
  });
}

/** A transport that rejects (simulating an exception/timeout). Records invocation. */
export function throwingCoreTransport(): CoreDecisionTransport & Recording {
  const counter = { n: 0 };
  return Object.freeze({
    send(_serializedCommand: string): Promise<string> {
      counter.n += 1;
      return Promise.reject(new Error('synthetic transport failure (raw error must not escape)'));
    },
    invoked: () => counter.n,
  });
}

/** A transport that returns malformed (non-JSON) output. Records invocation. */
export function malformedCoreTransport(): CoreDecisionTransport & Recording {
  const counter = { n: 0 };
  return Object.freeze({
    send(_serializedCommand: string): Promise<string> {
      counter.n += 1;
      return Promise.resolve('not-json-at-all');
    },
    invoked: () => counter.n,
  });
}

/** A transport that returns a well-formed response with a MISMATCHED identity. Records invocation. */
export function mismatchedCoreTransport(
  outcome: CoreDecisionOutcome = 'ACCEPTED',
): CoreDecisionTransport & Recording {
  const counter = { n: 0 };
  return Object.freeze({
    send(serializedCommand: string): Promise<string> {
      counter.n += 1;
      const c = parseCommand(serializedCommand);
      return Promise.resolve(
        canonicalJson({
          protocol: c['protocol'],
          commandId: c['commandId'],
          idempotencyKey: c['idempotencyKey'],
          proposalId: 'wrong.proposal',
          proposalVersion: c['proposalVersion'],
          conversationId: c['conversationId'],
          boundRevision: c['expectedRevision'],
          // Correct digest, wrong proposalId: the mismatch this fixture models is still an IDENTITY
          // mismatch, so the digest must not be what fails. Otherwise the specs that use it would
          // start passing for a reason they do not name.
          proposalDigest: c['proposalDigest'],
          outcome,
          reason: 'core-decided',
          decidedAt: '2026-07-25T00:00:05Z',
        }),
      );
    },
    invoked: () => counter.n,
  });
}

/** A clear synthetic state; override any field for a specific test. */
export function syntheticState(over: Partial<CoreDecisionState> = {}): CoreDecisionState {
  return Object.freeze({
    revision: 1,
    partyType: 'CLIENT',
    humanTakeover: false,
    aiPaused: false,
    cancelled: false,
    subjectStatus: 'clear',
    ...over,
  });
}

/** A state reader that returns each scripted state in turn (last repeated); records read count. */
export interface RecordingStateReader extends CoreDecisionStateReader {
  readonly reads: () => number;
}
export function scriptedStateReader(...states: readonly CoreDecisionState[]): RecordingStateReader {
  let index = 0;
  const counter = { n: 0 };
  return Object.freeze({
    read(): Promise<CoreDecisionState> {
      counter.n += 1;
      const value = states[Math.min(index, states.length - 1)] ?? syntheticState();
      index += 1;
      return Promise.resolve(value);
    },
    reads: () => counter.n,
  });
}

/** A fixed canonical-instant clock. */
export function fixedClock(instant = '2026-07-25T00:00:00Z'): () => string {
  return () => instant;
}
