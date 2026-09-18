import { describe, expect, it, vi } from 'vitest';
import { QuickFurnoWhatsAppHttpError } from '../quickfurno-whatsapp/quickfurno-http.js';
import type { QuickFurnoWhatsAppTurnMaterialV1 } from '../quickfurno-whatsapp/contracts.js';
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

const material: QuickFurnoWhatsAppTurnMaterialV1 = Object.freeze({
  protocol: 'qfj.whatsapp.turn-material',
  version: 1,
  requestId: '11111111-1111-4111-8111-111111111111',
  ...ref,
  tenantId: 'quickfurno.marketplace',
  dataClass: 'HOSTED_ALLOWED',
  receivedAt: '2026-09-18T12:00:00.000Z',
  inbound: { version: 1, messageType: 'text', normalizedText: 'hello' },
  normalizedText: 'hello',
});

function fixture(
  over: {
    materialRead?: () => Promise<QuickFurnoWhatsAppTurnMaterialV1>;
    specialist?: () => Promise<unknown>;
    write?: () => Promise<'queued' | 'stale'>;
  } = {},
) {
  const claimNext = vi.fn(() => Promise.resolve(ref));
  const complete = vi.fn((_id: string) => Promise.resolve());
  const fail = vi.fn((_id: string) => Promise.resolve());
  const release = vi.fn((_id: string) => Promise.resolve());
  const queue: QuickFurnoWhatsAppTurnQueue = { claimNext, complete, fail, release };
  const read = vi.fn(over.materialRead ?? (() => Promise.resolve(material)));
  const process = vi.fn(
    over.specialist ??
      (() =>
        Promise.resolve({ actor: 'RIYA', proposalId: 'prop.1', boundRevision: 7, body: 'reply' })),
  );
  const write = vi.fn(over.write ?? (() => Promise.resolve('queued' as const)));
  const processor = createQuickFurnoWhatsAppTurnProcessor({
    queue,
    materialReader: { read },
    specialistRuntime: { process: process as never },
    replyWriter: { write },
  });
  return { processor, claimNext, complete, fail, release, read, process, write };
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

  it('fails closed if QuickFurno material disagrees with the durable reference', async () => {
    const wrong = { ...material, assignedActor: 'ANISHA' as const, subjectType: 'vendor' as const };
    const f = fixture({ materialRead: () => Promise.resolve(wrong) });
    expect(await f.processor.processOne()).toBe('failed-indeterminate');
    expect(f.process).not.toHaveBeenCalled();
    expect(f.fail).toHaveBeenCalledOnce();
  });
});
