import { describe, expect, it, vi } from 'vitest';
import type { ProposedReplyJarvisRuntime } from '@qf-jarvis/jarvis-runtime';
import type { QuickFurnoWhatsAppTurnMaterialV2 } from '../quickfurno-whatsapp/contracts.js';
import { createQuickFurnoWhatsAppSpecialistRuntime } from '../quickfurno-whatsapp/specialist-runtime.js';

function material(
  over: Partial<QuickFurnoWhatsAppTurnMaterialV2> = {},
): QuickFurnoWhatsAppTurnMaterialV2 {
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
    subjectRef: '44444444-4444-4444-8444-444444444444',
    observedAt: '2026-09-18T12:00:00.000Z',
    inboundMessageId: '33333333-3333-4333-8333-333333333333',
    receivedAt: '2026-09-18T12:00:00.000Z',
    inbound: { version: 1, messageType: 'text', normalizedText: 'Hello' },
    normalizedText: 'Hello',
    ...over,
  };
}

function runtime() {
  const agentCall = vi.fn((envelope: { partyType?: string }) =>
    Promise.resolve({
      runtimeResult: {
        outcome: 'MODEL_DRAFTED',
        coreConsulted: false,
        modelDrafted: true,
        proposalId: `prop.${String(envelope.partyType).toLowerCase()}`,
        boundRevision: 9,
      },
      proposedReply: {
        version: 1,
        proposalId: `prop.${String(envelope.partyType).toLowerCase()}`,
        boundRevision: 9,
        proposalKind: 'REPLY',
        authorityStatus: 'PENDING_CORE_VALIDATION',
        replyBody: `${String(envelope.partyType)} reply`,
      },
    }),
  );
  const jarvisRuntime = {
    processInboundForProposedReply: agentCall,
  } as unknown as ProposedReplyJarvisRuntime;

  return {
    service: createQuickFurnoWhatsAppSpecialistRuntime({
      runtimeId: 'qfj.whatsapp.prod',
      jarvisRuntime,
    }),
    agentCall,
  };
}

describe('QuickFurno WhatsApp specialist runtime', () => {
  it('routes an exact client through the stateless governed CLIENT proposal path', async () => {
    const r = runtime();
    const reply = await r.service.process(material());
    expect(reply).toMatchObject({ actor: 'RIYA', proposalId: 'prop.client', body: 'CLIENT reply' });
    expect(r.agentCall).toHaveBeenCalledOnce();
    expect(r.agentCall).toHaveBeenCalledWith(
      expect.objectContaining({
        partyType: 'CLIENT',
        channel: 'WHATSAPP',
        tenantId: 'quickfurno',
        dataClass: 'HOSTED_ALLOWED',
      }),
    );
  });

  it('routes a verified vendor through Anisha with a canonical VENDOR envelope', async () => {
    const r = runtime();
    const reply = await r.service.process(
      material({ assignedActor: 'ANISHA', subjectType: 'vendor' }),
    );
    expect(reply).toMatchObject({
      actor: 'ANISHA',
      proposalId: 'prop.vendor',
      body: 'VENDOR reply',
    });
    expect(r.agentCall).toHaveBeenCalledOnce();
    expect(r.agentCall).toHaveBeenCalledWith(
      expect.objectContaining({ partyType: 'VENDOR', channel: 'WHATSAPP' }),
    );
  });
  it('routes a prospect through Aarohi with a canonical PROSPECT envelope', async () => {
    const r = runtime();
    const reply = await r.service.process(
      material({ assignedActor: 'AAROHI', subjectType: 'prospect' }),
    );
    expect(reply).toMatchObject({
      actor: 'AAROHI',
      proposalId: 'prop.prospect',
      body: 'PROSPECT reply',
    });
    expect(r.agentCall).toHaveBeenCalledWith(
      expect.objectContaining({ partyType: 'PROSPECT', channel: 'WHATSAPP' }),
    );
  });

  it('refuses actor/subject mismatch before any agent runtime is invoked', async () => {
    const r = runtime();
    expect(
      await r.service.process(material({ assignedActor: 'ANISHA', subjectType: 'client' })),
    ).toBeNull();
    expect(r.agentCall).not.toHaveBeenCalled();
  });

  it('does not coerce LOCAL_ONLY media into the certified hosted text-model path', async () => {
    const r = runtime();
    const reply = await r.service.process(
      material({
        dataClass: 'LOCAL_ONLY',
        inbound: {
          version: 1,
          messageType: 'image',
          attachment: { kind: 'image', mediaId: 'media.123', mimeType: 'image/jpeg' },
        },
      }),
    );
    expect(reply).toBeNull();
    expect(r.agentCall).not.toHaveBeenCalled();
  });

  it('refuses a reply authorized against a different QuickFurno conversation revision', async () => {
    const r = runtime();
    const reply = await r.service.process(material({ revision: 10 }));
    expect(reply).toBeNull();
  });
});
