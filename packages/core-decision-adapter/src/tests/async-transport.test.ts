/**
 * QFJ-M4 async-compatibility correction — genuinely asynchronous Core transport (ADR-0058).
 *
 * Async matrix (Core scope): the transport is awaited and invoked at most once with no adapter-owned
 * retry; a rejected transport Promise is normalized to a safe fail-closed outcome without an unhandled
 * rejection or a raw error; a state change that lands WHILE the transport Promise is pending is observed
 * by the awaited post-response read and blocks a Core `ACCEPTED`; a delivered ACCEPTED is never sent,
 * delivered, executed, or persisted.
 */
import { describe, expect, it } from 'vitest';

import { createCoreDecisionAdapter } from '../adapter/create-core-decision-adapter.js';
import type { CoreDecisionState, CoreDecisionStateReader } from '../contracts/state.js';
import type { CoreDecisionTransport } from '../transport/core-decision-transport.js';
import {
  coreRequest,
  fixedClock,
  scriptedCoreTransport,
  scriptedStateReader,
  syntheticState,
  throwingCoreTransport,
} from '../testing/index.js';

const clock = fixedClock();

/** A state reader over a mutable cell — lets an external change land between the awaited gate reads. */
function mutableStateReader(get: () => CoreDecisionState): CoreDecisionStateReader & {
  reads: () => number;
} {
  let n = 0;
  return {
    read: () => {
      n += 1;
      return Promise.resolve(get());
    },
    reads: () => n,
  };
}

describe('async Core transport — at most once, no retry, rejection normalized', () => {
  it('awaits the transport and invokes it exactly once on a clean ACCEPTED', async () => {
    const transport = scriptedCoreTransport('ACCEPTED');
    const adapter = createCoreDecisionAdapter({
      stateReader: scriptedStateReader(syntheticState()),
      clock,
      transport,
    });
    const result = await adapter.decideDetailed(coreRequest());
    expect(result.outcome).toBe('ACCEPTED');
    expect(transport.invoked()).toBe(1);
  });

  it('normalizes a rejected transport Promise to CORE_UNAVAILABLE with no retry or raw error', async () => {
    const transport = throwingCoreTransport();
    const adapter = createCoreDecisionAdapter({
      stateReader: scriptedStateReader(syntheticState()),
      clock,
      transport,
    });
    const result = await adapter.decideDetailed(coreRequest());
    expect(result.outcome).toBe('CORE_UNAVAILABLE');
    expect(result.reason).toBe('adapter-transport-error');
    expect(transport.invoked()).toBe(1);
    expect(JSON.stringify(result)).not.toContain('synthetic transport failure');
  });
});

describe('async Core transport — a change while the transport is pending blocks ACCEPTED', () => {
  it('sees a cancellation that lands during the awaited send and refuses the ACCEPTED', async () => {
    let cell = syntheticState();
    // The transport resolves ACCEPTED, but a cancellation lands during the awaited round-trip; the
    // adapter's awaited post-response read observes it and blocks the acceptance.
    const mutatingTransport: CoreDecisionTransport = {
      send: (serialized) => {
        cell = syntheticState({ cancelled: true });
        return scriptedCoreTransport('ACCEPTED').send(serialized);
      },
    };
    const reader = mutableStateReader(() => cell);
    const adapter = createCoreDecisionAdapter({
      stateReader: reader,
      clock,
      transport: mutatingTransport,
    });
    const result = await adapter.decideDetailed(coreRequest());
    expect(result.outcome).toBe('STALE_REVISION');
    expect(result.reason).toBe('adapter-state-blocked');
    expect(result.transportInvoked).toBe(true);
    expect(reader.reads()).toBe(2);
  });

  it('a delivered ACCEPTED is never sent, delivered, executed, or persisted', async () => {
    const adapter = createCoreDecisionAdapter({
      stateReader: scriptedStateReader(syntheticState()),
      clock,
      transport: scriptedCoreTransport('ACCEPTED'),
    });
    const result = await adapter.decideDetailed(coreRequest());
    expect(result.outcome).toBe('ACCEPTED');
    const surface = result as unknown as Record<string, unknown>;
    for (const forbidden of ['send', 'deliver', 'execute', 'persist', 'callN8n']) {
      expect(surface[forbidden]).toBeUndefined();
    }
  });
});
