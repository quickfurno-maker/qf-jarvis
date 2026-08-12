/**
 * Cancellation is measured at the TRANSPORT boundary.
 *
 * The ordering specs are the whole file. A cancellation case only means something if the abort lands
 * after the provider is committed to the request — abort earlier and the case proves an admission
 * boundary while claiming to prove that a candidate stops when told to.
 */
import type { GroqTransport } from '@qf-jarvis/model-gateway';
import { describe, expect, it } from 'vitest';

import {
  createTransportBoundaryAbort,
  createTransportStartHook,
} from '../cancellation-transport.js';

/** A transport that records what it was handed. It performs no I/O of any kind. */
function recordingTransport(): {
  readonly transport: GroqTransport;
  readonly calls: () => number;
  readonly abortedOnEntry: () => readonly boolean[];
} {
  let calls = 0;
  const abortedOnEntry: boolean[] = [];
  return {
    transport: {
      send: (_request, signal) => {
        calls += 1;
        abortedOnEntry.push(signal.aborted);
        return Promise.resolve({
          status: 200,
          bodyText: '{}',
          retryAfterSeconds: null,
        } as Awaited<ReturnType<GroqTransport['send']>>);
      },
    },
    calls: () => calls,
    abortedOnEntry: () => abortedOnEntry,
  };
}

const REQUEST = {
  url: 'https://example.invalid/synthetic',
  headers: {},
  body: '{}',
  timeoutMs: 1_000,
} as Parameters<GroqTransport['send']>[0];

describe('the hook fires exactly at the request boundary', () => {
  it('ABORT IS NOT SET BEFORE THE TRANSPORT IS ENTERED', async () => {
    const abort = createTransportBoundaryAbort();
    const underlying = recordingTransport();
    const instrumented = createTransportStartHook(underlying.transport, abort.onTransportStarted);

    // Nothing has happened yet, so nothing may be cancelled yet.
    expect(abort.controller.signal.aborted).toBe(false);
    expect(abort.started()).toBe(0);

    await instrumented.send(REQUEST, abort.controller.signal);

    expect(abort.started()).toBe(1);
    expect(abort.controller.signal.aborted).toBe(true);
  });

  it('the underlying transport is entered exactly once, and delegated to unchanged', async () => {
    const abort = createTransportBoundaryAbort();
    const underlying = recordingTransport();
    const instrumented = createTransportStartHook(underlying.transport, abort.onTransportStarted);
    await instrumented.send(REQUEST, abort.controller.signal);
    expect(underlying.calls()).toBe(1);
    expect(abort.started()).toBe(1);
  });

  it('THE ABORT LANDS AT THE BOUNDARY, AND THE UNDERLYING CALL CARRIES IT', async () => {
    // The decisive ordering, stated precisely. Before the request boundary is crossed the turn is
    // NOT cancelled; crossing it cancels, and the underlying transport therefore receives an
    // already-aborted signal. That is the intended consequence rather than an accident: the request
    // reached the provider's own transport, which is the strongest "after admission" boundary a
    // PUBLIC seam can prove, and the real HTTP client then abandons it immediately.
    //
    // The honest limit: this proves the request reached the transport, not that a socket was opened
    // or a byte left the machine. Proving that would need a private seam.
    const abort = createTransportBoundaryAbort();
    const underlying = recordingTransport();
    const instrumented = createTransportStartHook(underlying.transport, abort.onTransportStarted);

    expect(abort.controller.signal.aborted).toBe(false);
    await instrumented.send(REQUEST, abort.controller.signal);

    expect(underlying.abortedOnEntry()).toStrictEqual([true]);
    expect(abort.controller.signal.aborted).toBe(true);
  });

  it('a repeated boundary crossing does not abort twice', async () => {
    const abort = createTransportBoundaryAbort();
    const underlying = recordingTransport();
    const instrumented = createTransportStartHook(underlying.transport, abort.onTransportStarted);
    await instrumented.send(REQUEST, abort.controller.signal);
    await instrumented.send(REQUEST, abort.controller.signal);
    expect(abort.started()).toBe(2);
    // Still one cancellation: a turn already cancelled is not cancelled again.
    expect(abort.controller.signal.aborted).toBe(true);
  });

  it('an uninstrumented transport is never aborted by this seam', async () => {
    // Every non-cancellation case uses the ordinary transport, which this module never touches.
    const abort = createTransportBoundaryAbort();
    const underlying = recordingTransport();
    await underlying.transport.send(REQUEST, abort.controller.signal);
    expect(abort.started()).toBe(0);
    expect(abort.controller.signal.aborted).toBe(false);
  });
});
