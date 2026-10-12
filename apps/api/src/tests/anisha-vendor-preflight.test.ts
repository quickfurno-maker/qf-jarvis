import { describe, expect, it, vi } from 'vitest';
import type { ProposedReplyJarvisRuntime } from '@qf-jarvis/jarvis-runtime';
import type { QuickFurnoWhatsAppTurnMaterialV2 } from '../quickfurno-whatsapp/contracts.js';
import { assessAnishaWhatsAppPreflight } from '../quickfurno-whatsapp/anisha-vendor-preflight.js';
import { createQuickFurnoWhatsAppSpecialistRuntime } from '../quickfurno-whatsapp/specialist-runtime.js';

function vendor(
  overrides: Partial<QuickFurnoWhatsAppTurnMaterialV2> = {},
): QuickFurnoWhatsAppTurnMaterialV2 {
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
    subjectRef: '44444444-4444-4444-8444-444444444444',
    observedAt: '2026-10-12T03:00:00.000Z',
    inboundMessageId: '33333333-3333-4333-8333-333333333333',
    receivedAt: '2026-10-12T03:00:00.000Z',
    normalizedText: 'Mere package credits kaise kaam karte hain?',
    inbound: {
      version: 1,
      messageType: 'text',
      normalizedText: 'Mere package credits kaise kaam karte hain?',
    },
    ...overrides,
  };
}

function createSpyRuntime() {
  const processInboundForProposedReply = vi.fn(
    async (envelope: { partyType: string; normalizedText: string }) => {
      await Promise.resolve();
      return {
        runtimeResult: {
          outcome: 'MODEL_DRAFTED',
          coreConsulted: false,
          modelDrafted: true,
          proposalId: 'anisha.proposal.1',
          boundRevision: 9,
        },
        proposedReply: {
          version: 1 as const,
          proposalId: 'anisha.proposal.1',
          boundRevision: 9,
          proposalKind: 'REPLY' as const,
          authorityStatus: 'PENDING_CORE_VALIDATION' as const,
          replyBody: envelope.partyType + ' informational reply',
        },
      };
    },
  );
  const runtime = createQuickFurnoWhatsAppSpecialistRuntime({
    runtimeId: 'qfj.anisha.a1.preflight',
    jarvisRuntime: { processInboundForProposedReply } as unknown as ProposedReplyJarvisRuntime,
  });
  return { runtime, processInboundForProposedReply };
}

describe('Anisha A1 vendor WhatsApp preflight', () => {
  it('passes an authoritative identified vendor through to a single VENDOR model proposal', async () => {
    const { runtime, processInboundForProposedReply } = createSpyRuntime();
    expect(assessAnishaWhatsAppPreflight(vendor())).toBe('ANISHA_TURN_READY');
    expect(await runtime.process(vendor())).toMatchObject({
      actor: 'ANISHA',
      body: 'VENDOR informational reply',
      boundRevision: 9,
    });
    expect(processInboundForProposedReply).toHaveBeenCalledOnce();
    expect(processInboundForProposedReply).toHaveBeenCalledWith(
      expect.objectContaining({ channel: 'WHATSAPP', partyType: 'VENDOR' }),
    );
  });

  const refused: readonly {
    readonly reason: string;
    readonly change: Partial<QuickFurnoWhatsAppTurnMaterialV2>;
    readonly code: string;
  }[] = [
    {
      reason: 'wrong agent',
      change: { assignedActor: 'RIYA' },
      code: 'ANISHA_WRONG_ACTOR_OR_SUBJECT',
    },
    {
      reason: 'client subject',
      change: { subjectType: 'client' },
      code: 'ANISHA_WRONG_ACTOR_OR_SUBJECT',
    },
    {
      reason: 'wrong Core party',
      change: { partyType: 'CLIENT' },
      code: 'ANISHA_WRONG_ACTOR_OR_SUBJECT',
    },
    {
      reason: 'missing vendor identity',
      change: { subjectRef: undefined as never },
      code: 'ANISHA_VENDOR_IDENTITY_UNBOUND',
    },
    {
      reason: 'malformed vendor identity',
      change: { subjectRef: 'vendor:somebody' },
      code: 'ANISHA_VENDOR_IDENTITY_UNBOUND',
    },
    {
      reason: 'closed conversation',
      change: { conversationState: 'CLOSED' },
      code: 'ANISHA_CONVERSATION_INACTIVE',
    },
    {
      reason: 'paused conversation',
      change: { conversationState: 'PAUSED' },
      code: 'ANISHA_CONVERSATION_INACTIVE',
    },
    {
      reason: 'human takeover',
      change: { humanTakeover: true },
      code: 'ANISHA_CORE_AUTHORITY_BLOCKED',
    },
    { reason: 'AI pause', change: { aiPaused: true }, code: 'ANISHA_CORE_AUTHORITY_BLOCKED' },
    {
      reason: 'Core disables Jarvis',
      change: { jarvisAllowed: false },
      code: 'ANISHA_CORE_AUTHORITY_BLOCKED',
    },
    {
      reason: 'cancelled turn',
      change: { cancelled: true },
      code: 'ANISHA_CORE_AUTHORITY_BLOCKED',
    },
    {
      reason: 'erased subject',
      change: { subjectStatus: 'erased' },
      code: 'ANISHA_PRIVACY_OR_ERASURE_BLOCKED',
    },
    {
      reason: 'anonymised subject',
      change: { subjectStatus: 'anonymised' },
      code: 'ANISHA_PRIVACY_OR_ERASURE_BLOCKED',
    },
    {
      reason: 'LOCAL_ONLY data',
      change: { dataClass: 'LOCAL_ONLY' },
      code: 'ANISHA_HOSTED_TEXT_UNAVAILABLE',
    },
    {
      reason: 'HUMAN_ONLY data',
      change: { dataClass: 'HUMAN_ONLY' },
      code: 'ANISHA_HOSTED_TEXT_UNAVAILABLE',
    },
    {
      reason: 'missing text',
      change: { normalizedText: undefined as never },
      code: 'ANISHA_HOSTED_TEXT_UNAVAILABLE',
    },
    {
      reason: 'blank text',
      change: { normalizedText: '   ' },
      code: 'ANISHA_HOSTED_TEXT_UNAVAILABLE',
    },
  ];

  it.each(refused)('refuses $reason at the pure Core-authority boundary', ({ change, code }) => {
    expect(assessAnishaWhatsAppPreflight(vendor(change))).toBe(code);
  });

  it.each(refused.filter(({ change }) => change.assignedActor === undefined))(
    'never invokes the model on $reason',
    async ({ change }) => {
      const { runtime, processInboundForProposedReply } = createSpyRuntime();
      expect(await runtime.process(vendor(change))).toBeNull();
      expect(processInboundForProposedReply).not.toHaveBeenCalled();
    },
  );

  it('uses bounded short-term conversation context as non-authoritative, never as Core payment truth', async () => {
    const { runtime, processInboundForProposedReply } = createSpyRuntime();
    await runtime.process(vendor({ normalizedText: 'Aur credits?' }), {
      version: 1,
      authority: 'NON_AUTHORITATIVE_CONVERSATION_CONTEXT',
      text: 'USER: Mere credits kab expire honge?\nASSISTANT: Main check karti hoon.',
      includedTurns: 2,
      truncated: false,
    });
    expect(processInboundForProposedReply).toHaveBeenCalledOnce();
    const argument = processInboundForProposedReply.mock.calls[0]?.[0];
    expect(argument?.normalizedText).toContain(
      'non-authoritative; never use as Core/business truth',
    );
    expect(argument?.normalizedText).toContain('Current user message:');
    expect(argument?.normalizedText).toContain('Aur credits?');
  });
});
