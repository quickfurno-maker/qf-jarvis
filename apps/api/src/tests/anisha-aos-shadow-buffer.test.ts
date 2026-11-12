import { describe, expect, it } from 'vitest';
import { runAosSupervisorShadowCycle } from '@qf-jarvis/proactive-worker';
import { createAnishaAosShadowBuffer } from '../quickfurno-whatsapp/anisha-aos-shadow-buffer.js';
import type { AnishaVerifiedAosAccountSignal } from '../quickfurno-whatsapp/anisha-core-context.js';

const at = '2026-11-12T13:30:00.000Z';
function signal(
  over: Partial<AnishaVerifiedAosAccountSignal> = {},
): AnishaVerifiedAosAccountSignal {
  return {
    source: 'QUICKFURNO_CORE_SANITIZED_VENDOR_CONTEXT',
    subjectRef: 'vendor:44444444-4444-4444-8444-444444444444',
    evidenceRef: 'qfj:anisha-core-context-turn:11111111-1111-4111-8111-111111111111',
    observedAt: at,
    packageReadinessBand: 'LOW_CREDITS',
    pendingBadLeadReportCount: 1,
    ...over,
  };
}

describe('Anisha signed Core facts to transient AOS SHADOW', () => {
  it('keeps only the latest bounded signal per vendor and drains once', () => {
    const buffer = createAnishaAosShadowBuffer({ capacity: 2 });
    buffer.observe(signal({ packageReadinessBand: 'READY' }));
    buffer.observe(signal({ packageReadinessBand: 'LOW_CREDITS' }));
    expect(buffer.drain(at)).toEqual([signal()]);
    expect(buffer.drain(at)).toEqual([]);
  });

  it('drops old or future signals, enforces capacity and has no persistence', () => {
    const buffer = createAnishaAosShadowBuffer({ capacity: 1 });
    buffer.observe(signal({ subjectRef: 'vendor:first' }));
    buffer.observe(signal({ subjectRef: 'vendor:last' }));
    expect(buffer.drain(at)).toMatchObject([{ subjectRef: 'vendor:last' }]);
    buffer.observe(signal({ observedAt: '2026-11-12T13:00:00.000Z' }));
    expect(buffer.drain(at)).toEqual([]);
    buffer.observe(signal({ observedAt: '2026-11-12T13:33:00.000Z' }));
    expect(buffer.drain(at)).toEqual([]);
  });

  it('runs the existing AOS supervisor without sending or authorizing an action', async () => {
    const buffer = createAnishaAosShadowBuffer();
    buffer.observe(signal());
    const accountSignals = buffer.drain(at);
    const result = await runAosSupervisorShadowCycle({
      cycleId: 'aos.anisha.signed-account-buffer',
      generatedAt: at,
      vendorAccounts: accountSignals,
    });
    expect(result.sourceSummary.vendorAccountSignals).toBe(1);
    expect(result.cases).toHaveLength(1);
    expect(result.recommendations[0]).toMatchObject({
      action: 'REQUEST_VENDOR_SUCCESS_FOLLOW_UP',
      executionAuthorized: false,
    });
    expect(result).toMatchObject({
      executionAuthority: 'NONE',
      businessEffect: false,
      productionMutation: false,
    });
    expect(result.modelCalls).toBe(0);
  });
});
