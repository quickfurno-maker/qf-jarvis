import { describe, expect, it, vi } from 'vitest';
import type { QuickFurnoWhatsAppTurnMaterialV2 } from '../quickfurno-whatsapp/contracts.js';
import { createAnishaMemoryReenrollment } from '../quickfurno-whatsapp/anisha-memory-reenrollment.js';

const vendorId = '44444444-4444-4444-8444-444444444444';
const now = '2026-10-12T07:00:00.000Z';
const turn = (
  overrides: Partial<QuickFurnoWhatsAppTurnMaterialV2> = {},
): QuickFurnoWhatsAppTurnMaterialV2 => ({
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
  normalizedText: 'Please use Hinglish',
  inbound: { version: 1, messageType: 'text', normalizedText: 'Please use Hinglish' },
  ...overrides,
});
function gate(override: Record<string, unknown> = {}) {
  const rearm = vi.fn(async () => {
    await Promise.resolve();
    return { cleared: true };
  });
  const consent = vi.fn(async () => {
    await Promise.resolve();
    return {
      source: 'QUICKFURNO_CORE' as const,
      vendorId,
      decision: 'GRANTED' as const,
      observedAt: now,
      consentRevision: 4,
      consentUpdatedAt: now,
      erasurePending: false,
      ...override,
    };
  });
  const system = createAnishaMemoryReenrollment({
    environment: 'staging',
    mode: 'STAGING_ONLY',
    ownerApprovalRef: 'owner.anisha.rearm.approved',
    consent: { read: consent },
    rearm,
    clock: () => now,
  });
  return { system, consent, rearm };
}

describe('Anisha governed staging re-enrollment after erasure', () => {
  it('disabled by default and never enabled in production', async () => {
    const system = createAnishaMemoryReenrollment({ mode: 'DISABLED', environment: 'production' });
    await expect(system.execute(turn())).resolves.toBe('disabled');
    expect(() =>
      createAnishaMemoryReenrollment({
        mode: 'STAGING_ONLY',
        environment: 'production',
      }),
    ).toThrow('anisha-memory-rearm-staging-only');
    expect(() =>
      createAnishaMemoryReenrollment({
        mode: 'STAGING_ONLY',
        environment: 'staging',
      }),
    ).toThrow('anisha-memory-rearm-requires-core-and-owner');
  });
  it('requires a fresh specifically granted Core decision, never a model assertion', async () => {
    const { system, consent, rearm } = gate();
    await expect(system.execute(turn())).resolves.toBe('cleared');
    expect(consent).toHaveBeenCalledWith({
      tenantId: 'quickfurno',
      vendorId,
      conversationId: turn().conversationId,
      expectedRevision: 9,
    });
    expect(rearm).toHaveBeenCalledWith(
      expect.objectContaining({
        vendorId,
        consentRevision: 4,
        consentUpdatedAt: now,
        ownerApprovalRef: 'owner.anisha.rearm.approved',
      }),
    );
  });
  it.each([
    ['denied', { decision: 'DENIED' }],
    ['pending purge', { erasurePending: true }],
    ['old grant epoch', { consentRevision: 2 }],
    ['missing Core timestamp', { consentUpdatedAt: null }],
    ['wrong vendor', { vendorId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }],
    ['stale proof', { observedAt: '2026-10-12T05:00:00.000Z' }],
  ])('blocks %s', async (_label, proof) => {
    const { system, rearm } = gate(proof);
    await expect(system.execute(turn())).resolves.toBe('blocked');
    expect(rearm).not.toHaveBeenCalled();
  });
  it('rejects erased identity, human takeover and old Core turn before checking consent', async () => {
    const { system, consent } = gate();
    for (const changes of [
      { humanTakeover: true },
      { aiPaused: true },
      { subjectStatus: 'erased' as const },
      { assignedActor: 'RIYA' as const },
      { observedAt: '2026-10-12T06:00:00.000Z' },
    ])
      await expect(system.execute(turn(changes))).resolves.toBe('blocked');
    expect(consent).not.toHaveBeenCalled();
  });
});
