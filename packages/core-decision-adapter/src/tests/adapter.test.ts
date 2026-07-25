/**
 * QFJ-M3 — adapter decision flow (ADR-0056 §A, §F, §I, §L; ADR-0058 async transport).
 *
 * Matrix: a matching `ACCEPTED` succeeds; a rejection/human-review is never upgraded; a missing
 * transport, a rejected transport Promise (exception/timeout), a malformed response, and an identity
 * mismatch all fail closed to a safe `CORE_UNAVAILABLE` with no raw error; the double state gate blocks
 * before transport and after an `ACCEPTED`; the transport runs at most once and never auto-retries; the
 * adapter sends/executes nothing and the result is frozen. Every decision is awaited (ADR-0058).
 */
import { describe, expect, it } from 'vitest';

import { createCoreDecisionAdapter } from '../adapter/create-core-decision-adapter.js';
import {
  coreRequest,
  fixedClock,
  malformedCoreTransport,
  mismatchedCoreTransport,
  scriptedCoreTransport,
  scriptedStateReader,
  syntheticState,
  throwingCoreTransport,
} from '../testing/index.js';

const clock = fixedClock();

describe('adapter — Core is the sole acceptance authority', () => {
  it('returns ACCEPTED only when Core returns it against the exact identity with unchanged state', async () => {
    const transport = scriptedCoreTransport('ACCEPTED');
    const adapter = createCoreDecisionAdapter({
      stateReader: scriptedStateReader(syntheticState()),
      clock,
      transport,
    });
    const result = await adapter.decideDetailed(coreRequest());
    expect(result.outcome).toBe('ACCEPTED');
    expect(result.reason).toBe('core-accepted');
    expect(result.retryable).toBe(false);
    expect(result.transportInvoked).toBe(true);
    expect(result.response?.outcome).toBe('ACCEPTED');
    expect(transport.invoked()).toBe(1);
    expect(Object.isFrozen(result)).toBe(true);
  });

  it('never upgrades a rejection or a human-review to acceptance', async () => {
    for (const outcome of ['REJECTED', 'HUMAN_REVIEW_REQUIRED'] as const) {
      const adapter = createCoreDecisionAdapter({
        stateReader: scriptedStateReader(syntheticState()),
        clock,
        transport: scriptedCoreTransport(outcome),
      });
      const result = await adapter.decideDetailed(coreRequest());
      expect(result.outcome).toBe(outcome);
      expect(result.outcome).not.toBe('ACCEPTED');
    }
  });

  it('maps a Core RETRY_LATER to a retryable outcome without auto-retrying', async () => {
    const transport = scriptedCoreTransport('RETRY_LATER');
    const adapter = createCoreDecisionAdapter({
      stateReader: scriptedStateReader(syntheticState()),
      clock,
      transport,
    });
    const result = await adapter.decideDetailed(coreRequest());
    expect(result.outcome).toBe('RETRY_LATER');
    expect(result.reason).toBe('core-retry-later');
    expect(result.retryable).toBe(true);
    expect(transport.invoked()).toBe(1);
  });
});

describe('adapter — fail closed', () => {
  it('a missing transport yields CORE_UNAVAILABLE and never touches the wire', async () => {
    const adapter = createCoreDecisionAdapter({
      stateReader: scriptedStateReader(syntheticState()),
      clock,
    });
    const result = await adapter.decideDetailed(coreRequest());
    expect(result.outcome).toBe('CORE_UNAVAILABLE');
    expect(result.reason).toBe('adapter-transport-missing');
    expect(result.retryable).toBe(true);
    expect(result.transportInvoked).toBe(false);
  });

  it('a rejected transport Promise (exception/timeout) is normalized and no raw error escapes', async () => {
    const transport = throwingCoreTransport();
    const adapter = createCoreDecisionAdapter({
      stateReader: scriptedStateReader(syntheticState()),
      clock,
      transport,
    });
    // The rejected transport Promise never surfaces as an unhandled rejection: decideDetailed
    // resolves to a safe fail-closed outcome (awaiting it here would throw if it rejected).
    const result = await adapter.decideDetailed(coreRequest());
    expect(result.outcome).toBe('CORE_UNAVAILABLE');
    expect(result.reason).toBe('adapter-transport-error');
    expect(result.retryable).toBe(true);
    expect(transport.invoked()).toBe(1);
    expect(JSON.stringify(result)).not.toContain('synthetic transport failure');
  });

  it('a malformed (non-JSON) response fails closed as response-invalid', async () => {
    const adapter = createCoreDecisionAdapter({
      stateReader: scriptedStateReader(syntheticState()),
      clock,
      transport: malformedCoreTransport(),
    });
    const result = await adapter.decideDetailed(coreRequest());
    expect(result.outcome).toBe('CORE_UNAVAILABLE');
    expect(result.reason).toBe('adapter-response-invalid');
  });

  it('a mismatched-identity ACCEPTED fails closed and is never accepted', async () => {
    const adapter = createCoreDecisionAdapter({
      stateReader: scriptedStateReader(syntheticState()),
      clock,
      transport: mismatchedCoreTransport('ACCEPTED'),
    });
    const result = await adapter.decideDetailed(coreRequest());
    expect(result.outcome).toBe('CORE_UNAVAILABLE');
    expect(result.reason).toBe('adapter-identity-mismatch');
    expect(result.outcome).not.toBe('ACCEPTED');
  });
});

describe('adapter — the double state gate', () => {
  const blocking = [
    { label: 'revision drift', over: { revision: 2 } },
    { label: 'party change', over: { partyType: 'VENDOR' as const } },
    { label: 'human takeover', over: { humanTakeover: true } },
    { label: 'ai paused', over: { aiPaused: true } },
    { label: 'cancelled', over: { cancelled: true } },
    { label: 'non-clear subject', over: { subjectStatus: 'erased' as const } },
  ];

  for (const { label, over } of blocking) {
    it(`blocks before transport on ${label} and never sends`, async () => {
      const transport = scriptedCoreTransport('ACCEPTED');
      const adapter = createCoreDecisionAdapter({
        stateReader: scriptedStateReader(syntheticState(over)),
        clock,
        transport,
      });
      const result = await adapter.decideDetailed(coreRequest());
      expect(result.outcome).toBe('STALE_REVISION');
      expect(result.reason).toBe('adapter-state-blocked');
      expect(result.transportInvoked).toBe(false);
      expect(transport.invoked()).toBe(0);
    });
  }

  it('blocks AFTER an ACCEPTED when the state changed during the round-trip', async () => {
    const reader = scriptedStateReader(syntheticState(), syntheticState({ cancelled: true }));
    const adapter = createCoreDecisionAdapter({
      stateReader: reader,
      clock,
      transport: scriptedCoreTransport('ACCEPTED'),
    });
    const result = await adapter.decideDetailed(coreRequest());
    expect(result.outcome).toBe('STALE_REVISION');
    expect(result.reason).toBe('adapter-state-blocked');
    expect(result.transportInvoked).toBe(true);
    expect(reader.reads()).toBe(2);
  });

  it('does not re-read state after a non-ACCEPTED outcome', async () => {
    const reader = scriptedStateReader(syntheticState());
    const adapter = createCoreDecisionAdapter({
      stateReader: reader,
      clock,
      transport: scriptedCoreTransport('REJECTED'),
    });
    expect((await adapter.decideDetailed(coreRequest())).outcome).toBe('REJECTED');
    expect(reader.reads()).toBe(1);
  });
});

describe('adapter — approval only, no execution', () => {
  it('exposes only decide/decideDetailed — no send, deliver, execute, or persist', () => {
    const adapter = createCoreDecisionAdapter({
      stateReader: scriptedStateReader(syntheticState()),
      clock,
      transport: scriptedCoreTransport('ACCEPTED'),
    });
    expect(Object.keys(adapter).sort()).toEqual(['decide', 'decideDetailed']);
    const surface = adapter as unknown as Record<string, unknown>;
    for (const forbidden of ['send', 'deliver', 'execute', 'persist', 'callN8n', 'authorize']) {
      expect(surface[forbidden]).toBeUndefined();
    }
    expect(Object.isFrozen(adapter)).toBe(true);
  });

  it('decide() returns the closed outcome only, matching decideDetailed', async () => {
    const adapter = createCoreDecisionAdapter({
      stateReader: scriptedStateReader(syntheticState()),
      clock,
      transport: scriptedCoreTransport('ACCEPTED'),
    });
    const simple = await adapter.decide(coreRequest());
    expect(Object.keys(simple)).toEqual(['outcome']);
    expect(simple.outcome).toBe('ACCEPTED');
  });
});
