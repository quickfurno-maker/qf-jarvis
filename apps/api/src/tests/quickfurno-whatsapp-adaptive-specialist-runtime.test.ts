import { describe, expect, it, vi } from 'vitest';

import type { QuickFurnoWhatsAppTurnMaterialV2 } from '../quickfurno-whatsapp/contracts.js';
import { createAdaptiveQuickFurnoWhatsAppSpecialistRuntime } from '../quickfurno-whatsapp/adaptive-specialist-runtime.js';

function material(text = 'Hello'): QuickFurnoWhatsAppTurnMaterialV2 {
  return {
    protocol: 'qfj.whatsapp.turn-material',
    version: 2,
    requestId: '11111111-1111-4111-8111-111111111111',
    tenantId: 'quickfurno',
    conversationId: '22222222-2222-4222-8222-222222222222',
    revision: 9,
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
    observedAt: '2026-09-29T12:00:00.000Z',
    inboundMessageId: '33333333-3333-4333-8333-333333333333',
    receivedAt: '2026-09-29T12:00:00.000Z',
    inbound: { version: 1, messageType: 'text', normalizedText: text },
    normalizedText: text,
  };
}

function service(label: string) {
  const process = vi.fn(async () => ({
    actor: 'RIYA' as const,
    proposalId: `proposal.${label}`,
    boundRevision: 9,
    body: label,
  }));
  return { runtime: { process }, process };
}

describe('QuickFurno adaptive specialist runtime', () => {
  it('routes simple and complex turns through different pre-composed active releases', async () => {
    const fast = service('fast');
    const strong = service('strong');
    const runtime = createAdaptiveQuickFurnoWhatsAppSpecialistRuntime({
      activeReleaseIds: ['release.fast', 'release.strong'],
      routes: {
        SIMPLE: { releaseId: 'release.fast', runtime: fast.runtime },
        STANDARD: { releaseId: 'release.fast', runtime: fast.runtime },
        COMPLEX: { releaseId: 'release.strong', runtime: strong.runtime },
      },
      signals: (turn) => ({
        normalizedTextChars: 'normalizedText' in turn ? (turn.normalizedText?.length ?? 0) : 0,
        conversationContextChars: 0,
        knowledgeHitCount: 0,
        ambiguitySignals: 0,
        requiresCoreVerification: false,
        multiStepReasoning: 'normalizedText' in turn && turn.normalizedText === 'complex',
        highRisk: false,
      }),
    });

    await expect(runtime.process(material('hello'))).resolves.toMatchObject({ body: 'fast' });
    await expect(runtime.process(material('complex'))).resolves.toMatchObject({ body: 'strong' });
    expect(fast.process).toHaveBeenCalledOnce();
    expect(strong.process).toHaveBeenCalledOnce();
  });

  it('refuses construction when a route names a release not in the active certified set', () => {
    const fast = service('fast');
    expect(() =>
      createAdaptiveQuickFurnoWhatsAppSpecialistRuntime({
        activeReleaseIds: ['release.fast'],
        routes: {
          SIMPLE: { releaseId: 'release.fast', runtime: fast.runtime },
          STANDARD: { releaseId: 'release.fast', runtime: fast.runtime },
          COMPLEX: { releaseId: 'release.uncertified', runtime: fast.runtime },
        },
        signals: () => ({
          normalizedTextChars: 0,
          conversationContextChars: 0,
          knowledgeHitCount: 0,
          ambiguitySignals: 0,
          requiresCoreVerification: false,
          multiStepReasoning: false,
          highRisk: false,
        }),
      }),
    ).toThrow('adaptive-specialist-route-invalid');
  });

  it('fails closed when complexity signals are invalid', async () => {
    const fast = service('fast');
    const runtime = createAdaptiveQuickFurnoWhatsAppSpecialistRuntime({
      activeReleaseIds: ['release.fast'],
      routes: {
        SIMPLE: { releaseId: 'release.fast', runtime: fast.runtime },
        STANDARD: { releaseId: 'release.fast', runtime: fast.runtime },
        COMPLEX: { releaseId: 'release.fast', runtime: fast.runtime },
      },
      signals: () => ({
        normalizedTextChars: 5000,
        conversationContextChars: 0,
        knowledgeHitCount: 0,
        ambiguitySignals: 0,
        requiresCoreVerification: false,
        multiStepReasoning: false,
        highRisk: false,
      }),
    });
    await expect(runtime.process(material())).resolves.toBeNull();
    expect(fast.process).not.toHaveBeenCalled();
  });
});
