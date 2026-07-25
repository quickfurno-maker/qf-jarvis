/**
 * QFJ-M3 — retry classification + content-free observability (ADR-0056 §J, §K).
 *
 * Matrix: the closed outcomes are retry-classified deterministically (info only — the adapter never
 * auto-retries); the observability hook emits content-free events carrying only safe ids/revisions/
 * outcome/reason; the default hook is a no-op; an event never carries message/subject/secret text.
 */
import { describe, expect, it } from 'vitest';

import { isRetryable } from '../adapter/retry-classification.js';
import { CORE_ADAPTER_REASONS } from '../contracts/reasons.js';
import type { CoreAdapterReason } from '../contracts/reasons.js';
import { CORE_ADAPTER_EVENT_TYPES } from '../contracts/observability.js';
import type { CoreAdapterEvent, CoreAdapterObservabilityHook } from '../contracts/observability.js';
import { createCoreDecisionAdapter } from '../adapter/create-core-decision-adapter.js';
import {
  coreRequest,
  fixedClock,
  scriptedCoreTransport,
  scriptedStateReader,
  syntheticState,
} from '../testing/index.js';

describe('retry classification', () => {
  const expectedRetryable: ReadonlySet<CoreAdapterReason> = new Set([
    'core-unavailable',
    'core-retry-later',
    'adapter-transport-missing',
    'adapter-transport-error',
  ]);

  it('classifies every closed reason deterministically', () => {
    for (const reason of CORE_ADAPTER_REASONS) {
      expect(isRetryable(reason)).toBe(expectedRetryable.has(reason));
    }
  });

  it('never marks a rejection, human-review, or stale revision retryable', () => {
    for (const reason of ['core-rejected', 'core-human-review', 'core-stale-revision'] as const) {
      expect(isRetryable(reason)).toBe(false);
    }
  });
});

function recorder(): { hook: CoreAdapterObservabilityHook; events: CoreAdapterEvent[] } {
  const events: CoreAdapterEvent[] = [];
  return { hook: { onEvent: (e) => events.push(e) }, events };
}

describe('observability', () => {
  it('emits only closed, content-free event types for a completed acceptance', () => {
    const { hook, events } = recorder();
    const adapter = createCoreDecisionAdapter({
      stateReader: scriptedStateReader(syntheticState()),
      clock: fixedClock(),
      transport: scriptedCoreTransport('ACCEPTED'),
      observability: hook,
    });
    adapter.decideDetailed(coreRequest());
    expect(events.length).toBeGreaterThan(0);
    for (const event of events) {
      expect(CORE_ADAPTER_EVENT_TYPES).toContain(event.type);
    }
    expect(events.map((e) => e.type)).toContain('completed');
  });

  it('carries no message, subject, or secret content in any event', () => {
    const { hook, events } = recorder();
    const adapter = createCoreDecisionAdapter({
      stateReader: scriptedStateReader(syntheticState()),
      clock: fixedClock(),
      transport: scriptedCoreTransport('ACCEPTED'),
      observability: hook,
    });
    adapter.decideDetailed(
      coreRequest({ proposedReplyBody: 'SECRET-REPLY-BODY', policyRevision: 'policy.rev.1' }),
    );
    const serialized = JSON.stringify(events);
    for (const forbidden of ['SECRET-REPLY-BODY', 'sk-', 'wamid']) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it('emits a refusal event, not completion, when the pre-transport gate blocks', () => {
    const { hook, events } = recorder();
    const adapter = createCoreDecisionAdapter({
      stateReader: scriptedStateReader(syntheticState({ cancelled: true })),
      clock: fixedClock(),
      transport: scriptedCoreTransport('ACCEPTED'),
      observability: hook,
    });
    adapter.decideDetailed(coreRequest());
    const types = events.map((e) => e.type);
    expect(types).toContain('response-refused');
    expect(types).not.toContain('completed');
    expect(types).not.toContain('transport-requested');
  });

  it('the default hook is a silent no-op', () => {
    const adapter = createCoreDecisionAdapter({
      stateReader: scriptedStateReader(syntheticState()),
      clock: fixedClock(),
      transport: scriptedCoreTransport('ACCEPTED'),
    });
    expect(() => adapter.decideDetailed(coreRequest())).not.toThrow();
  });
});
