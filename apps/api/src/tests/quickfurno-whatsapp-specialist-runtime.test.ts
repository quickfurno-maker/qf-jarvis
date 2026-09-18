import { describe, expect, it, vi } from 'vitest';
import type { CoreAuthorizedReplyJarvisRuntime } from '@qf-jarvis/jarvis-runtime';
import type { RiyaCustomerTurnRunner } from '../riya-customer-orchestration/create-riya-customer-runtime.js';
import type { QuickFurnoWhatsAppTurnMaterialV1 } from '../quickfurno-whatsapp/contracts.js';
import { createQuickFurnoWhatsAppSpecialistRuntime } from '../quickfurno-whatsapp/specialist-runtime.js';

function material(
  over: Partial<QuickFurnoWhatsAppTurnMaterialV1> = {},
): QuickFurnoWhatsAppTurnMaterialV1 {
  return {
    protocol: 'qfj.whatsapp.turn-material',
    version: 1,
    requestId: '11111111-1111-4111-8111-111111111111',
    conversationId: '22222222-2222-4222-8222-222222222222',
    inboundMessageId: '33333333-3333-4333-8333-333333333333',
    conversationRevision: 9,
    assignedActor: 'RIYA',
    subjectType: 'client',
    tenantId: 'quickfurno.marketplace',
    dataClass: 'HOSTED_ALLOWED',
    subjectRef: '44444444-4444-4444-8444-444444444444',
    receivedAt: '2026-09-18T12:00:00.000Z',
    normalizedText: 'Hello',
    ...over,
  };
}

function runtime() {
  const riyaCall = vi.fn((_turn: unknown) =>
    Promise.resolve({
      authorizedReply: {
        version: 1,
        proposalId: 'prop.riya',
        boundRevision: 9,
        proposalKind: 'REPLY',
        replyBody: 'Riya reply',
      },
    }),
  );
  const agentCall = vi.fn((_envelope: unknown) =>
    Promise.resolve({
      runtimeResult: { outcome: 'CORE_ACCEPTED' },
      authorizedReply: {
        version: 1,
        proposalId: 'prop.agent',
        boundRevision: 9,
        proposalKind: 'REPLY',
        replyBody: 'Agent reply',
      },
    }),
  );
  const riya = {
    handleTurn: vi.fn(),
    handleConversationTurn: riyaCall,
  } as unknown as RiyaCustomerTurnRunner;
  const jarvisRuntime = {
    processInboundForCoreAuthorizedReply: agentCall,
  } as unknown as CoreAuthorizedReplyJarvisRuntime;

  return {
    service: createQuickFurnoWhatsAppSpecialistRuntime({
      runtimeId: 'qfj.whatsapp.prod',
      riya,
      jarvisRuntime,
    }),
    riyaCall,
    agentCall,
  };
}

describe('QuickFurno WhatsApp specialist runtime', () => {
  it('routes an exact client only through the channel-neutral Riya service', async () => {
    const r = runtime();
    const reply = await r.service.process(material());
    expect(reply).toMatchObject({ actor: 'RIYA', proposalId: 'prop.riya', body: 'Riya reply' });
    expect(r.riyaCall).toHaveBeenCalledOnce();
    expect(r.riyaCall).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: 'WHATSAPP',
        tenantId: 'quickfurno.marketplace',
        dataClass: 'HOSTED_ALLOWED',
      }),
    );
    expect(r.agentCall).not.toHaveBeenCalled();
  });

  it('routes a verified vendor through Anisha with a canonical VENDOR envelope', async () => {
    const r = runtime();
    const reply = await r.service.process(
      material({ assignedActor: 'ANISHA', subjectType: 'vendor' }),
    );
    expect(reply).toMatchObject({ actor: 'ANISHA', proposalId: 'prop.agent', body: 'Agent reply' });
    expect(r.riyaCall).not.toHaveBeenCalled();
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
    expect(reply).toMatchObject({ actor: 'AAROHI', proposalId: 'prop.agent', body: 'Agent reply' });
    expect(r.agentCall).toHaveBeenCalledWith(
      expect.objectContaining({ partyType: 'PROSPECT', channel: 'WHATSAPP' }),
    );
  });

  it('refuses actor/subject mismatch before any agent runtime is invoked', async () => {
    const r = runtime();
    expect(
      await r.service.process(material({ assignedActor: 'ANISHA', subjectType: 'client' })),
    ).toBeNull();
    expect(r.riyaCall).not.toHaveBeenCalled();
    expect(r.agentCall).not.toHaveBeenCalled();
  });

  it('refuses a reply authorized against a different QuickFurno conversation revision', async () => {
    const r = runtime();
    const reply = await r.service.process(material({ conversationRevision: 10 }));
    expect(reply).toBeNull();
  });
});
