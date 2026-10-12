import { describe, expect, it, vi } from 'vitest';
import type { QuickFurnoWhatsAppTurnMaterialV2 } from '../quickfurno-whatsapp/contracts.js';
import { createAnishaVendorMemoryLifecycle } from '../quickfurno-whatsapp/anisha-memory-lifecycle.js';
import { createAnishaVendorMemoryReader } from '../quickfurno-whatsapp/anisha-vendor-memory.js';

const now = '2026-10-12T10:00:00.000Z';
const vendorId = '44444444-4444-4444-8444-444444444444';

function material(): QuickFurnoWhatsAppTurnMaterialV2 {
  return {
    protocol: 'qfj.whatsapp.turn-material',
    version: 2,
    requestId: '11111111-1111-4111-8111-111111111111',
    tenantId: 'quickfurno',
    conversationId: '22222222-2222-4222-8222-222222222222',
    revision: 9,
    assignedActor: 'ANISHA',
    subjectType: 'vendor',
    partyType: 'VENDOR',
    conversationState: 'OPEN',
    jarvisAllowed: true,
    dataClass: 'HOSTED_ALLOWED',
    humanTakeover: false,
    aiPaused: false,
    cancelled: false,
    subjectStatus: 'clear',
    subjectRef: vendorId,
    observedAt: now,
    inboundMessageId: '33333333-3333-4333-8333-333333333333',
    receivedAt: now,
    normalizedText: 'Hinglish please',
    inbound: { version: 1, messageType: 'text', normalizedText: 'Hinglish please' },
  };
}

function consentReader(responseDelayMs: number) {
  return {
    read: vi.fn(async () => {
      await Promise.resolve();
      return {
        source: 'QUICKFURNO_CORE' as const,
        vendorId,
        decision: 'GRANTED' as const,
        observedAt: new Date(Date.parse(now) + responseDelayMs).toISOString(),
        consentRevision: 4,
        consentUpdatedAt: now,
        erasurePending: false,
      };
    }),
  };
}

describe('Anisha L1 real signed Core response clock window', () => {
  it('allows a valid consent response received 250 ms after the request clock was sampled', async () => {
    const consent = consentReader(250);
    const write = vi.fn(async () => {
      await Promise.resolve();
      return { decision: 'ALLOW_DURABLE' as const, policyRef: 'anisha.l1' };
    });
    const writer = createAnishaVendorMemoryLifecycle({
      environment: 'staging',
      mode: 'STAGING_ONLY',
      ownerApprovalRef: 'ANISHA_L1_APPROVAL',
      memory: { write, invalidate: vi.fn() },
      consent,
      clock: () => now,
    });
    expect(
      await writer.recordExplicitPreference(material(), { kind: 'language', value: 'hinglish' }),
    ).toBe('stored');
    expect(write).toHaveBeenCalledOnce();

    const readActive = vi.fn(async () => {
      await Promise.resolve();
      return [];
    });
    const reader = createAnishaVendorMemoryReader({
      policy: { enabled: true, ownerApprovalRef: 'ANISHA_L1_APPROVAL' },
      memory: { readActive },
      consent,
      clock: () => now,
    });
    expect(await reader.readForTurn(material())).toEqual({ status: 'empty' });
    expect(readActive).toHaveBeenCalledOnce();
  });

  it('rejects unreasonably future-dated Core consent rather than trusting it', async () => {
    const consent = consentReader(30_001);
    const write = vi.fn(async () => {
      await Promise.resolve();
      return { decision: 'ALLOW_DURABLE' as const, policyRef: 'anisha.l1' };
    });
    const writer = createAnishaVendorMemoryLifecycle({
      environment: 'staging',
      mode: 'STAGING_ONLY',
      ownerApprovalRef: 'ANISHA_L1_APPROVAL',
      memory: { write, invalidate: vi.fn() },
      consent,
      clock: () => now,
    });
    expect(
      await writer.recordExplicitPreference(material(), { kind: 'language', value: 'hinglish' }),
    ).toBe('blocked');
    expect(write).not.toHaveBeenCalled();

    const readActive = vi.fn(async () => {
      await Promise.resolve();
      return [];
    });
    const reader = createAnishaVendorMemoryReader({
      policy: { enabled: true, ownerApprovalRef: 'ANISHA_L1_APPROVAL' },
      memory: { readActive },
      consent,
      clock: () => now,
    });
    expect(await reader.readForTurn(material())).toEqual({ status: 'unavailable' });
    expect(readActive).not.toHaveBeenCalled();
  });
});
