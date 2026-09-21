import { describe, expect, it, vi } from 'vitest';

import { createQuickFurnoWhatsAppAuthorityStatePort } from '../quickfurno-whatsapp/authority-state-port.js';
import type { QuickFurnoWhatsAppAuthorityStateV2 } from '../quickfurno-whatsapp/contracts.js';

function state(
  over: Partial<QuickFurnoWhatsAppAuthorityStateV2> = {},
): QuickFurnoWhatsAppAuthorityStateV2 {
  return {
    protocol: 'qfj.whatsapp.turn-material',
    version: 2,
    requestId: '11111111-1111-4111-8111-111111111111',
    tenantId: 'quickfurno',
    conversationId: '22222222-2222-4222-8222-222222222222',
    revision: 7,
    assignedActor: 'RIYA',
    subjectType: 'client',
    partyType: 'CLIENT',
    conversationState: 'OPEN',
    jarvisAllowed: true,
    dataClass: 'HOSTED_ALLOWED',
    humanTakeover: false,
    aiPaused: false,
    cancelled: false,
    subjectStatus: 'clear',
    subjectRef: '44444444-4444-4444-8444-444444444444',
    observedAt: '2026-09-21T09:00:00.000Z',
    ...over,
  };
}

describe('QuickFurno WhatsApp authoritative state port', () => {
  it('performs a fresh QuickFurno authority read on every runtime read', async () => {
    const read = vi
      .fn()
      .mockResolvedValueOnce(state())
      .mockResolvedValueOnce(
        state({ revision: 8, conversationState: 'PAUSED', jarvisAllowed: false, aiPaused: true }),
      );
    const port = createQuickFurnoWhatsAppAuthorityStatePort({ read });
    const key = { tenantId: 'quickfurno', conversationId: '22222222-2222-4222-8222-222222222222' };
    expect((await port.read(key)).revision).toBe(7);
    expect(await port.read(key)).toMatchObject({ revision: 8, aiPaused: true });
    expect(read).toHaveBeenCalledTimes(2);
  });

  it('folds any QuickFurno Jarvis disable into a blocking runtime state', async () => {
    const port = createQuickFurnoWhatsAppAuthorityStatePort({
      read: vi.fn(() => Promise.resolve(state({ jarvisAllowed: false, aiPaused: false }))),
    });
    const result = await port.read({
      tenantId: 'quickfurno',
      conversationId: '22222222-2222-4222-8222-222222222222',
    });
    expect(result.aiPaused).toBe(true);
  });

  it('is read-only and exposes no provision or operator-control writer', () => {
    const port = createQuickFurnoWhatsAppAuthorityStatePort({
      read: vi.fn(() => Promise.resolve(state())),
    }) as unknown as Record<string, unknown>;
    expect(port['provision']).toBeUndefined();
    expect(port['applyControlCommand']).toBeUndefined();
    expect(Object.keys(port)).toEqual(['read']);
  });
});
