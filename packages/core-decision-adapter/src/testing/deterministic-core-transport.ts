/**
 * Deterministic Core transport + state fakes for tests (QFJ-M3, ADR-0056).
 *
 * The ONLY concrete transport/state implementations, shipped under `./testing`. All synthetic — no
 * real Core, network, auth, or secret. A scripted transport echoes the command identity with a chosen
 * outcome; throwing/malformed/mismatched variants drive the fail-closed paths; a scripted state reader
 * drives the double gate.
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

/** A transport that echoes the command identity with the scripted outcome. Records invocation. */
export function scriptedCoreTransport(
  outcome: CoreDecisionOutcome,
): CoreDecisionTransport & Recording {
  const counter = { n: 0 };
  return Object.freeze({
    send(serializedCommand: string): string {
      counter.n += 1;
      const c = parseCommand(serializedCommand);
      return canonicalJson({
        protocol: c['protocol'],
        commandId: c['commandId'],
        idempotencyKey: c['idempotencyKey'],
        proposalId: c['proposalId'],
        proposalVersion: c['proposalVersion'],
        conversationId: c['conversationId'],
        boundRevision: c['expectedRevision'],
        outcome,
        reason: 'core-decided',
        decidedAt: '2026-07-25T00:00:05Z',
      });
    },
    invoked: () => counter.n,
  });
}

/** A transport that throws (simulating an exception/timeout). Records invocation. */
export function throwingCoreTransport(): CoreDecisionTransport & Recording {
  const counter = { n: 0 };
  return Object.freeze({
    send(_serializedCommand: string): string {
      counter.n += 1;
      throw new Error('synthetic transport failure (raw error must not escape)');
    },
    invoked: () => counter.n,
  });
}

/** A transport that returns malformed (non-JSON) output. Records invocation. */
export function malformedCoreTransport(): CoreDecisionTransport & Recording {
  const counter = { n: 0 };
  return Object.freeze({
    send(_serializedCommand: string): string {
      counter.n += 1;
      return 'not-json-at-all';
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
    send(serializedCommand: string): string {
      counter.n += 1;
      const c = parseCommand(serializedCommand);
      return canonicalJson({
        protocol: c['protocol'],
        commandId: c['commandId'],
        idempotencyKey: c['idempotencyKey'],
        proposalId: 'wrong.proposal',
        proposalVersion: c['proposalVersion'],
        conversationId: c['conversationId'],
        boundRevision: c['expectedRevision'],
        outcome,
        reason: 'core-decided',
        decidedAt: '2026-07-25T00:00:05Z',
      });
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
    read(): CoreDecisionState {
      counter.n += 1;
      const value = states[Math.min(index, states.length - 1)] ?? syntheticState();
      index += 1;
      return value;
    },
    reads: () => counter.n,
  });
}

/** A fixed canonical-instant clock. */
export function fixedClock(instant = '2026-07-25T00:00:00Z'): () => string {
  return () => instant;
}
