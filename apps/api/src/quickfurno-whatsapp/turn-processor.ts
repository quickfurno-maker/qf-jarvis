import type {
  QuickFurnoWhatsAppMaterialReader,
  QuickFurnoWhatsAppReplyWriter,
} from './quickfurno-http.js';
import { QuickFurnoWhatsAppHttpError } from './quickfurno-http.js';
import type { QuickFurnoWhatsAppSpecialistRuntime } from './specialist-runtime.js';

export interface QuickFurnoWhatsAppTurnReference {
  readonly conversationId: string;
  readonly conversationRevision: number;
  readonly inboundMessageId: string;
  readonly assignedActor: 'AAROHI' | 'ANISHA' | 'RIYA';
  readonly subjectType: 'unknown' | 'prospect' | 'client' | 'vendor';
}

export interface QuickFurnoWhatsAppTurnQueue {
  claimNext(): Promise<QuickFurnoWhatsAppTurnReference | null>;
  complete(inboundMessageId: string): Promise<void>;
  fail(inboundMessageId: string): Promise<void>;
  release(inboundMessageId: string): Promise<void>;
}

export type QuickFurnoWhatsAppProcessorOutcome =
  | 'idle'
  | 'completed-no-reply'
  | 'completed-queued'
  | 'completed-stale'
  | 'released-pre-agent'
  | 'failed-indeterminate';

export interface QuickFurnoWhatsAppTurnProcessor {
  processOne(): Promise<QuickFurnoWhatsAppProcessorOutcome>;
}

export interface QuickFurnoWhatsAppTurnProcessorConfig {
  readonly queue: QuickFurnoWhatsAppTurnQueue;
  readonly materialReader: QuickFurnoWhatsAppMaterialReader;
  readonly specialistRuntime: QuickFurnoWhatsAppSpecialistRuntime;
  readonly replyWriter: QuickFurnoWhatsAppReplyWriter;
}

function materialMatches(
  ref: QuickFurnoWhatsAppTurnReference,
  material: {
    readonly conversationId: string;
    readonly conversationRevision: number;
    readonly inboundMessageId: string;
    readonly assignedActor: string;
    readonly subjectType: string;
  },
): boolean {
  return (
    material.conversationId === ref.conversationId &&
    material.conversationRevision === ref.conversationRevision &&
    material.inboundMessageId === ref.inboundMessageId &&
    material.assignedActor === ref.assignedActor &&
    material.subjectType === ref.subjectType
  );
}
export function createQuickFurnoWhatsAppTurnProcessor(
  config: QuickFurnoWhatsAppTurnProcessorConfig,
): QuickFurnoWhatsAppTurnProcessor {
  return Object.freeze({
    async processOne() {
      const ref = await config.queue.claimNext();
      if (ref === null) return 'idle';

      let material;
      try {
        material = await config.materialReader.read({
          conversationId: ref.conversationId,
          inboundMessageId: ref.inboundMessageId,
          expectedRevision: ref.conversationRevision,
        });
      } catch (error) {
        if (error instanceof QuickFurnoWhatsAppHttpError && error.code === 'request-failed') {
          await config.queue.release(ref.inboundMessageId);
          return 'released-pre-agent';
        }
        if (error instanceof QuickFurnoWhatsAppHttpError && error.code === 'stale-revision') {
          await config.queue.complete(ref.inboundMessageId);
          return 'completed-stale';
        }
        await config.queue.fail(ref.inboundMessageId);
        return 'failed-indeterminate';
      }

      if (!materialMatches(ref, material)) {
        await config.queue.fail(ref.inboundMessageId);
        return 'failed-indeterminate';
      }
      let authorized;
      try {
        authorized = await config.specialistRuntime.process(material);
      } catch {
        await config.queue.fail(ref.inboundMessageId);
        return 'failed-indeterminate';
      }
      if (authorized === null) {
        await config.queue.complete(ref.inboundMessageId);
        return 'completed-no-reply';
      }

      try {
        const outcome = await config.replyWriter.write({
          conversationId: ref.conversationId,
          expectedRevision: ref.conversationRevision,
          reply: authorized,
        });
        await config.queue.complete(ref.inboundMessageId);
        return outcome === 'stale' ? 'completed-stale' : 'completed-queued';
      } catch {
        // An agent/Core run has already occurred. Do not auto-rerun it after callback uncertainty.
        await config.queue.fail(ref.inboundMessageId);
        return 'failed-indeterminate';
      }
    },
  });
}
