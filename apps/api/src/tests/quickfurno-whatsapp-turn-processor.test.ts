import { describe, expect, it, vi } from 'vitest';
import { QuickFurnoWhatsAppHttpError } from '../quickfurno-whatsapp/quickfurno-http.js';
import type {
  QuickFurnoWhatsAppConversationContextV1,
  QuickFurnoWhatsAppTurnMaterialV2,
} from '../quickfurno-whatsapp/contracts.js';
import {
  createQuickFurnoWhatsAppTurnProcessor,
  type QuickFurnoWhatsAppTurnQueue,
} from '../quickfurno-whatsapp/turn-processor.js';

const ref = Object.freeze({
  conversationId: '22222222-2222-4222-8222-222222222222',
  conversationRevision: 7,
  inboundMessageId: '33333333-3333-4333-8333-333333333333',
  assignedActor: 'RIYA' as const,
  subjectType: 'client' as const,
});

const material: QuickFurnoWhatsAppTurnMaterialV2 = Object.freeze({
  protocol: 'qfj.whatsapp.turn-material',
  version: 2,
  requestId: '11111111-1111-4111-8111-111111111111',
  tenantId: 'quickfurno',
  conversationId: ref.conversationId,
  revision: ref.conversationRevision,
  assignedActor: ref.assignedActor,
  subjectType: ref.subjectType,
  partyType: 'CLIENT',
  conversationState: 'OPEN',
  jarvisAllowed: true,
  dataClass: 'HOSTED_ALLOWED',
  humanTakeover: false,
  aiPaused: false,
  cancelled: false,
  subjectStatus: 'clear',
  observedAt: '2026-09-18T12:00:00.000Z',
  inboundMessageId: ref.inboundMessageId,
  receivedAt: '2026-09-18T12:00:00.000Z',
  inbound: Object.freeze({
    version: 1 as const,
    messageType: 'text' as const,
    normalizedText: 'hello',
  }),
  normalizedText: 'hello',
});


const readyMaterial: QuickFurnoWhatsAppTurnMaterialV2 = Object.freeze({
  ...material,
  normalizedText: 'Please send me 3 vendors nearby',
  inbound: Object.freeze({
    version: 1 as const,
    messageType: 'text' as const,
    normalizedText: 'Please send me 3 vendors nearby',
  }),
  clientJourney: Object.freeze({
    version: 1 as const,
    profileId: '44444444-4444-4444-8444-444444444444',
    profileRevision: 2,
    profileStatus: 'known' as const,
    isFirstContact: false,
    name: 'Rahul',
    missing: Object.freeze([]),
    activeRequirement: Object.freeze({
      requirementId: '55555555-5555-4555-8555-555555555555',
      revision: 4,
      status: 'discovering' as const,
      phase: 'SUMMARY' as const,
      summaryConfirmed: true,
      provenance: Object.freeze({
        serviceInterest: 'user_stated' as const,
        location: 'user_stated' as const,
      }),
      serviceInterest: 'INTERIOR_DESIGN',
      location: 'BANER',
    }),
  }),
  clientMatchDecision: Object.freeze({
    version: 1 as const,
    state: 'READY' as const,
    requirementId: '55555555-5555-4555-8555-555555555555',
    requirementRevision: 4,
    leadId: '66666666-6666-4666-8666-666666666666',
    assignmentCount: 0,
    missingFields: Object.freeze([]),
    reasonCode: 'CORE_MATCH_READY',
    coreReady: true,
    executionAuthorized: false as const,
  }),
});

const matchedMaterial: QuickFurnoWhatsAppTurnMaterialV2 = Object.freeze({
  ...readyMaterial,
  clientMatchDecision: Object.freeze({
    version: 1 as const,
    state: 'MATCHED' as const,
    requirementId: '55555555-5555-4555-8555-555555555555',
    requirementRevision: 4,
    leadId: '66666666-6666-4666-8666-666666666666',
    assignmentCount: 3,
    missingFields: Object.freeze([]),
    reasonCode: 'STANDARD_VENDOR_BATCH_ALREADY_RELEASED',
    coreReady: false,
    executionAuthorized: false as const,
  }),
});


const vendorFeedbackMaterial: QuickFurnoWhatsAppTurnMaterialV2 = Object.freeze({
  ...matchedMaterial,
  normalizedText: "Vendor 2 didn't call me",
  inbound: Object.freeze({
    version: 1 as const,
    messageType: 'text' as const,
    normalizedText: "Vendor 2 didn't call me",
  }),
  clientVendorJourney: Object.freeze({
    version: 1 as const,
    requirementId: '55555555-5555-4555-8555-555555555555',
    requirementRevision: 4,
    vendorsReleased: 3,
    vendorNoContactCount: 0,
    allReleasedVendorsContacted: false,
    satisfactionState: 'UNKNOWN' as const,
    serviceRecoveryNeeded: false,
    reassignmentState: 'NONE' as const,
    followUpDue: true,
  }),
});

const vendorFeedbackRecordedMaterial: QuickFurnoWhatsAppTurnMaterialV2 = Object.freeze({
  ...vendorFeedbackMaterial,
  clientVendorJourney: Object.freeze({
    version: 1 as const,
    requirementId: '55555555-5555-4555-8555-555555555555',
    requirementRevision: 4,
    vendorsReleased: 3,
    vendorNoContactCount: 1,
    allReleasedVendorsContacted: false,
    satisfactionState: 'UNKNOWN' as const,
    serviceRecoveryNeeded: true,
    reassignmentState: 'NONE' as const,
    followUpDue: true,
  }),
});

function fixture(
  over: {
    materialRead?: () => Promise<QuickFurnoWhatsAppTurnMaterialV2>;
    contextRead?: () => Promise<{ readonly context: QuickFurnoWhatsAppConversationContextV1 }>;
    specialist?: (...args: unknown[]) => Promise<unknown>;
    vendorFeedback?: (...args: unknown[]) => Promise<unknown>;
    matchRequest?: (...args: unknown[]) => Promise<unknown>;
    write?: () => Promise<'queued' | 'stale'>;
  } = {},
) {
  const claimNext = vi.fn(() => Promise.resolve(ref));
  const complete = vi.fn((_id: string) => Promise.resolve());
  const fail = vi.fn((_id: string) => Promise.resolve());
  const release = vi.fn((_id: string) => Promise.resolve());
  const queue: QuickFurnoWhatsAppTurnQueue = { claimNext, complete, fail, release };
  const read = vi.fn(over.materialRead ?? (() => Promise.resolve(material)));
  const context = Object.freeze({
    version: 1 as const,
    authority: 'NON_AUTHORITATIVE_CONVERSATION_CONTEXT' as const,
    text: 'USER: Earlier question',
    includedTurns: 1,
    truncated: false,
  });
  const contextRead = vi.fn(over.contextRead ?? (() => Promise.resolve({ context })));
  const process = vi.fn(
    over.specialist ??
      (() =>
        Promise.resolve({ actor: 'RIYA', proposalId: 'prop.1', boundRevision: 7, body: 'reply' })),
  );
  const vendorFeedback =
    over.vendorFeedback === undefined ? undefined : vi.fn(over.vendorFeedback as never);
  const matchRequest =
    over.matchRequest === undefined ? undefined : vi.fn(over.matchRequest as never);
  const write = vi.fn(over.write ?? (() => Promise.resolve('queued' as const)));
  const processor = createQuickFurnoWhatsAppTurnProcessor({
    queue,
    materialReader: { read },
    conversationContextReader: { read: contextRead as never },
    specialistRuntime: { process: process as never },
    ...(vendorFeedback === undefined
      ? {}
      : { clientVendorFeedbackWriter: { record: vendorFeedback as never } }),
    ...(matchRequest === undefined ? {} : { clientMatchRequestWriter: { request: matchRequest as never } }),
    replyWriter: { write },
  });
  return {
    processor,
    claimNext,
    complete,
    fail,
    release,
    read,
    contextRead,
    context,
    process,
    vendorFeedback,
    matchRequest,
    write,
  };
}
describe('QuickFurno WhatsApp turn processor', () => {
  it('queues an authorized reply then terminalizes the turn', async () => {
    const f = fixture();
    expect(await f.processor.processOne()).toBe('completed-queued');
    expect(f.read).toHaveBeenCalledOnce();
    expect(f.process).toHaveBeenCalledOnce();
    expect(f.write).toHaveBeenCalledOnce();
    expect(f.complete).toHaveBeenCalledWith(ref.inboundMessageId);
    expect(f.release).not.toHaveBeenCalled();
    expect(f.fail).not.toHaveBeenCalled();
  });

  it('passes bounded conversation context to the specialist runtime', async () => {
    const f = fixture();
    expect(await f.processor.processOne()).toBe('completed-queued');
    expect(f.contextRead).toHaveBeenCalledOnce();
    expect(f.process).toHaveBeenCalledWith(material, f.context);
  });

  it('continues safely when optional conversation context is unavailable', async () => {
    const f = fixture({
      contextRead: () => Promise.reject(new QuickFurnoWhatsAppHttpError('request-failed')),
    });
    expect(await f.processor.processOne()).toBe('completed-queued');
    expect(f.process).toHaveBeenCalledWith(material, undefined);
    expect(f.release).not.toHaveBeenCalled();
    expect(f.fail).not.toHaveBeenCalled();
  });

  it('releases only a pre-agent transport failure so it can be retried safely', async () => {
    const f = fixture({
      materialRead: () => Promise.reject(new QuickFurnoWhatsAppHttpError('request-failed')),
    });
    expect(await f.processor.processOne()).toBe('released-pre-agent');
    expect(f.process).not.toHaveBeenCalled();
    expect(f.release).toHaveBeenCalledWith(ref.inboundMessageId);
    expect(f.fail).not.toHaveBeenCalled();
  });

  it('terminalizes a stale QuickFurno revision without invoking an agent', async () => {
    const f = fixture({
      materialRead: () => Promise.reject(new QuickFurnoWhatsAppHttpError('stale-revision')),
    });
    expect(await f.processor.processOne()).toBe('completed-stale');
    expect(f.process).not.toHaveBeenCalled();
    expect(f.complete).toHaveBeenCalledOnce();
  });

  it('marks agent execution uncertainty failed rather than automatically rerunning', async () => {
    const f = fixture({
      specialist: () => Promise.reject(new Error('model-outcome-unknown')),
    });
    expect(await f.processor.processOne()).toBe('failed-indeterminate');
    expect(f.fail).toHaveBeenCalledWith(ref.inboundMessageId);
    expect(f.release).not.toHaveBeenCalled();
    expect(f.write).not.toHaveBeenCalled();
  });
  it('marks callback uncertainty failed after the agent run instead of replaying the model', async () => {
    const f = fixture({
      write: () => Promise.reject(new QuickFurnoWhatsAppHttpError('request-failed')),
    });
    expect(await f.processor.processOne()).toBe('failed-indeterminate');
    expect(f.process).toHaveBeenCalledOnce();
    expect(f.fail).toHaveBeenCalledWith(ref.inboundMessageId);
    expect(f.release).not.toHaveBeenCalled();
  });

  it('completes with no callback when the governed runtime produces no authorized reply', async () => {
    const f = fixture({ specialist: () => Promise.resolve(null) });
    expect(await f.processor.processOne()).toBe('completed-no-reply');
    expect(f.write).not.toHaveBeenCalled();
    expect(f.complete).toHaveBeenCalledOnce();
  });


  it('records explicit client vendor feedback before Riya and refreshes Core journey', async () => {
    let reads = 0;
    const f = fixture({
      materialRead: () => {
        reads += 1;
        return Promise.resolve(
          reads === 1 ? vendorFeedbackMaterial : vendorFeedbackRecordedMaterial,
        );
      },
      vendorFeedback: () =>
        Promise.resolve({
          protocol: 'qfj.client-vendor-feedback.request',
          version: 1,
          requestId: '88888888-8888-4888-8888-888888888888',
          outcome: 'recorded',
          assignmentOrdinal: 2,
          eventType: 'client_reported_no_contact',
          reasonCode: 'CLIENT_VENDOR_FEEDBACK_RECORDED',
          providerAuthority: 'quickfurno-core',
        }),
    });
    expect(await f.processor.processOne()).toBe('completed-queued');
    expect(f.read).toHaveBeenCalledTimes(2);
    expect(f.vendorFeedback).toHaveBeenCalledOnce();
    expect(f.process).toHaveBeenCalledWith(vendorFeedbackRecordedMaterial, f.context);
    expect(f.vendorFeedback!.mock.invocationCallOrder[0]).toBeLessThan(
      f.process.mock.invocationCallOrder[0]!,
    );
    expect(f.write).toHaveBeenCalledOnce();
  });

  it('fails closed before Riya when Core rejects explicit vendor feedback evidence', async () => {
    const f = fixture({
      materialRead: () => Promise.resolve(vendorFeedbackMaterial),
      vendorFeedback: () =>
        Promise.resolve({
          protocol: 'qfj.client-vendor-feedback.request',
          version: 1,
          requestId: '88888888-8888-4888-8888-888888888888',
          outcome: 'blocked',
          assignmentOrdinal: 2,
          eventType: 'client_reported_no_contact',
          reasonCode: 'CLIENT_VENDOR_FEEDBACK_EVIDENCE_MISMATCH',
          providerAuthority: 'quickfurno-core',
        }),
    });
    expect(await f.processor.processOne()).toBe('failed-indeterminate');
    expect(f.vendorFeedback).toHaveBeenCalledOnce();
    expect(f.process).not.toHaveBeenCalled();
    expect(f.write).not.toHaveBeenCalled();
    expect(f.fail).toHaveBeenCalledWith(ref.inboundMessageId);
  });

  it('executes deterministic Core matching before Riya and refreshes Core state', async () => {
    let reads = 0;
    const f = fixture({
      materialRead: () => {
        reads += 1;
        return Promise.resolve(reads === 1 ? readyMaterial : matchedMaterial);
      },
      matchRequest: () =>
        Promise.resolve({
          protocol: 'qfj.client-match.request',
          version: 1,
          requestId: '77777777-7777-4777-8777-777777777777',
          outcome: 'matched',
          leadId: '66666666-6666-4666-8666-666666666666',
          assignmentCount: 3,
          reasonCode: 'STANDARD_VENDOR_BATCH_ALREADY_RELEASED',
          providerAuthority: 'quickfurno-core',
        }),
    });
    expect(await f.processor.processOne()).toBe('completed-queued');
    expect(f.read).toHaveBeenCalledTimes(2);
    expect(f.matchRequest).toHaveBeenCalledOnce();
    expect(f.process).toHaveBeenCalledOnce();
    expect(f.process).toHaveBeenCalledWith(matchedMaterial, f.context);
    expect(f.matchRequest!.mock.invocationCallOrder[0]).toBeLessThan(
      f.process.mock.invocationCallOrder[0]!,
    );
    expect(f.write).toHaveBeenCalledOnce();
  });

  it('releases before Riya when match execution transport is uncertain', async () => {
    const f = fixture({
      materialRead: () => Promise.resolve(readyMaterial),
      matchRequest: () => Promise.reject(new QuickFurnoWhatsAppHttpError('request-failed')),
    });
    expect(await f.processor.processOne()).toBe('released-pre-agent');
    expect(f.matchRequest).toHaveBeenCalledOnce();
    expect(f.process).not.toHaveBeenCalled();
    expect(f.write).not.toHaveBeenCalled();
    expect(f.release).toHaveBeenCalledWith(ref.inboundMessageId);
    expect(f.fail).not.toHaveBeenCalled();
  });

  it('fails closed if QuickFurno material disagrees with the durable reference', async () => {
    const wrong = { ...material, assignedActor: 'ANISHA' as const, subjectType: 'vendor' as const };
    const f = fixture({ materialRead: () => Promise.resolve(wrong) });
    expect(await f.processor.processOne()).toBe('failed-indeterminate');
    expect(f.process).not.toHaveBeenCalled();
    expect(f.fail).toHaveBeenCalledOnce();
  });
});
