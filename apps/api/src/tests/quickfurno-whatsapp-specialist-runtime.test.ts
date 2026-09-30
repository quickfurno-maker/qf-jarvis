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

  it('adds QuickFurno-owned conversation context as explicitly non-authoritative input', async () => {
    const r = runtime();
    await r.service.process(material({ normalizedText: 'What about the budget?' }), {
      version: 1,
      authority: 'NON_AUTHORITATIVE_CONVERSATION_CONTEXT',
      text: 'USER: I need a kitchen renovation.\nASSISTANT: Which area is the property in?',
      includedTurns: 2,
      truncated: false,
    });
    const envelope = r.agentCall.mock.calls[0]?.[0] as { normalizedText?: string };
    expect(envelope.normalizedText).toContain(
      'Recent conversation context (non-authoritative; never use as Core/business truth):',
    );
    expect(envelope.normalizedText).toContain('USER: I need a kitchen renovation.');
    expect(envelope.normalizedText).toContain('Current user message:');
    expect(envelope.normalizedText).toContain('What about the budget?');
  });

  it('passes only minimized V2 lifetime context to Riya and strips Core entity identifiers', async () => {
    const processRiya = vi.fn(() =>
      Promise.resolve({
        runtimeResult: {
          outcome: 'MODEL_DRAFTED',
          coreConsulted: false,
          modelDrafted: true,
          proposalId: 'prop.riya.v2',
          boundRevision: 9,
        },
        proposedReply: {
          version: 1,
          proposalId: 'prop.riya.v2',
          boundRevision: 9,
          proposalKind: 'REPLY',
          authorityStatus: 'PENDING_CORE_VALIDATION',
          replyBody: 'Welcome back. Is this for the Baner property?',
        },
        observationBatch: undefined,
        clientProfileObservation: undefined,
      }),
    );
    const service = createQuickFurnoWhatsAppSpecialistRuntime({
      runtimeId: 'qfj.whatsapp.prod',
      jarvisRuntime: {
        processInboundForProposedReply: vi.fn(),
        processInboundForRiyaConversationEvolution: processRiya,
      } as never,
    });

    const journey = {
      version: 2 as const,
      profileId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      profileRevision: 12,
      profileStatus: 'known' as const,
      isFirstContact: false,
      isReturningClient: true,
      createdAt: '2025-09-10T05:00:00.000Z',
      lastSeenAt: '2026-09-30T04:00:00.000Z',
      name: 'Rahul',
      preferredLanguage: 'hinglish' as const,
      missing: [] as const,
      activeRequirement: {
        requirementId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        revision: 4,
        status: 'discovering' as const,
        phase: 'PROJECT_DETAILS' as const,
        summaryConfirmed: false,
        provenance: {
          serviceInterest: 'user_stated' as const,
          location: 'user_stated' as const,
          budget: 'user_stated' as const,
          timeline: 'user_stated' as const,
        },
        serviceInterest: 'PAINTING',
        location: 'PUNE',
        budget: 'OPEN',
        timeline: 'NOW',
      },
      properties: [
        {
          propertyId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
          relation: 'current' as const,
          area: 'Baner',
          propertyType: 'Apartment',
          bhk: '3BHK',
          projectStage: 'occupied',
        },
      ],
      pastRequirements: [
        {
          requirementId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
          categoryRef: 'INTERIOR_DESIGN',
          propertyId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
          status: 'converted' as const,
          closedAt: '2025-12-01T10:00:00.000Z',
        },
      ],
    };
    const availability = {
      version: 1 as const,
      snapshotRef: 'availability.1',
      taxonomyVersion: 1,
      cities: [{ ref: 'PUNE', displayName: 'Pune' }],
      services: [{ ref: 'PAINTING', displayName: 'Painting' }],
      availability: [{ serviceRef: 'PAINTING', cityRefs: ['PUNE'] as readonly string[] }],
    };

    const reply = await service.process(
      material({
        clientJourney: journey,
        coreAvailability: availability,
        normalizedText: 'Need painting now',
      }),
    );
    expect(reply).toMatchObject({
      actor: 'RIYA',
      body: 'Welcome back. Is this for the Baner property?',
    });
    const input = (processRiya.mock.calls as unknown as [[Record<string, unknown>]])[0][0];
    expect(input['clientLifetime']).toEqual({
      version: 1,
      authority: 'QUICKFURNO_CORE_CONTEXT',
      isReturningClient: true,
      lastSeenAt: '2026-09-30T04:00:00.000Z',
      properties: [
        {
          relation: 'current',
          area: 'Baner',
          propertyType: 'Apartment',
          bhk: '3BHK',
          projectStage: 'occupied',
        },
      ],
      pastServices: [{ serviceRef: 'INTERIOR_DESIGN', status: 'converted' }],
    });
    expect(JSON.stringify(input['clientLifetime'])).not.toContain('aaaaaaaa-');
    expect(JSON.stringify(input['clientLifetime'])).not.toContain('bbbbbbbb-');
    expect(JSON.stringify(input['clientLifetime'])).not.toContain('cccccccc-');
    expect(JSON.stringify(input['clientLifetime'])).not.toContain('dddddddd-');
  });

  it('keeps the V1 Riya lane compatible with no lifetime context', async () => {
    const processRiya = vi.fn(() =>
      Promise.resolve({
        runtimeResult: {
          outcome: 'MODEL_DRAFTED',
          coreConsulted: false,
          modelDrafted: true,
          proposalId: 'prop.riya.v1',
          boundRevision: 9,
        },
        proposedReply: {
          version: 1,
          proposalId: 'prop.riya.v1',
          boundRevision: 9,
          proposalKind: 'REPLY',
          authorityStatus: 'PENDING_CORE_VALIDATION',
          replyBody: 'How can I help?',
        },
        observationBatch: undefined,
        clientProfileObservation: undefined,
      }),
    );
    const service = createQuickFurnoWhatsAppSpecialistRuntime({
      runtimeId: 'qfj.whatsapp.prod',
      jarvisRuntime: {
        processInboundForProposedReply: vi.fn(),
        processInboundForRiyaConversationEvolution: processRiya,
      } as never,
    });
    await service.process(
      material({
        clientJourney: {
          version: 1,
          profileId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          profileRevision: 1,
          profileStatus: 'discovering',
          isFirstContact: true,
          missing: ['name', 'serviceInterest', 'location', 'budget', 'timeline'],
          activeRequirement: {
            requirementId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
            revision: 0,
            status: 'discovering',
            phase: 'INTRO',
            summaryConfirmed: false,
            provenance: {},
          },
        },
        coreAvailability: {
          version: 1,
          snapshotRef: 'availability.1',
          taxonomyVersion: 1,
          cities: [],
          services: [],
          availability: [],
        },
      }),
    );
    const call = (processRiya.mock.calls as unknown as [[Record<string, unknown>]])[0][0];
    expect(call).not.toHaveProperty('clientLifetime');
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
