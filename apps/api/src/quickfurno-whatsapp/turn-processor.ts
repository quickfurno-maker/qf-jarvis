import {
  AGENT_FLOW_TRACE_PROTOCOL,
  parseAgentFlowTraceEvent,
  type AgentFlowTraceEventKind,
  type AgentFlowTraceSink,
  type AgentFlowTraceStatus,
} from '@qf-jarvis/agent-flow-trace-contract';

import type { QuickFurnoWhatsAppWorkerMaterial } from './contracts.js';
import type {
  QuickFurnoClientMatchRequestWriter,
  QuickFurnoClientVendorFeedbackWriter,
  QuickFurnoWhatsAppConversationContextReader,
  QuickFurnoWhatsAppMaterialReader,
  QuickFurnoWhatsAppReplyWriter,
} from './quickfurno-http.js';
import { QuickFurnoWhatsAppHttpError } from './quickfurno-http.js';
import type { QuickFurnoWhatsAppSpecialistRuntime } from './specialist-runtime.js';
import { shouldRequestCoreMatch } from './client-intelligence-adapter.js';
import { feedbackForMaterial } from './client-vendor-feedback-adapter.js';

export interface QuickFurnoWhatsAppTurnReference {
  readonly conversationId: string;
  readonly conversationRevision: number;
  readonly inboundMessageId: string;
  readonly assignedActor: 'AAROHI' | 'ANISHA' | 'RIYA';
  readonly subjectType: 'unknown' | 'prospect' | 'client' | 'vendor';
  readonly turnPurpose?: 'lead_qualification';
  readonly qualificationRequestId?: string;
}

export interface QuickFurnoWhatsAppTurnClaimSelection {
  readonly allowedActors?: readonly QuickFurnoWhatsAppTurnReference['assignedActor'][];
  readonly excludedConversationIds?: readonly string[];
}

export interface QuickFurnoWhatsAppTurnQueue {
  claimNext(
    selection?: QuickFurnoWhatsAppTurnClaimSelection,
  ): Promise<QuickFurnoWhatsAppTurnReference | null>;
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
  processClaimed(ref: QuickFurnoWhatsAppTurnReference): Promise<QuickFurnoWhatsAppProcessorOutcome>;
  processOne(
    selection?: QuickFurnoWhatsAppTurnClaimSelection,
  ): Promise<QuickFurnoWhatsAppProcessorOutcome>;
}

export interface QuickFurnoWhatsAppTurnProcessorConfig {
  readonly queue: QuickFurnoWhatsAppTurnQueue;
  readonly materialReader: QuickFurnoWhatsAppMaterialReader;
  readonly conversationContextReader?: QuickFurnoWhatsAppConversationContextReader;
  readonly specialistRuntime: QuickFurnoWhatsAppSpecialistRuntime;
  readonly clientVendorFeedbackWriter?: QuickFurnoClientVendorFeedbackWriter;
  readonly clientMatchRequestWriter?: QuickFurnoClientMatchRequestWriter;
  readonly replyWriter: QuickFurnoWhatsAppReplyWriter;
  /** Optional content-free observer. It grants no action authority and must never affect a turn. */
  readonly traceSink?: AgentFlowTraceSink;
  readonly traceClock?: () => string;
}

function materialMatches(
  ref: QuickFurnoWhatsAppTurnReference,
  material: {
    readonly conversationId: string;
    readonly revision: number;
    readonly inboundMessageId: string;
    readonly assignedActor: string;
    readonly subjectType?: string;
    readonly purpose?: string;
    readonly qualification?: { readonly requestId: string };
  },
): boolean {
  if (
    material.conversationId !== ref.conversationId ||
    material.revision !== ref.conversationRevision ||
    material.inboundMessageId !== ref.inboundMessageId ||
    material.assignedActor !== ref.assignedActor
  )
    return false;
  if (ref.turnPurpose === 'lead_qualification') {
    return (
      material.purpose === 'lead_qualification' &&
      material.qualification?.requestId === ref.qualificationRequestId
    );
  }
  return material.purpose === undefined && material.subjectType === ref.subjectType;
}
export function createQuickFurnoWhatsAppTurnProcessor(
  config: QuickFurnoWhatsAppTurnProcessorConfig,
): QuickFurnoWhatsAppTurnProcessor {
  const traceClock = config.traceClock ?? (() => new Date().toISOString());

  const processClaimed = async (
    ref: QuickFurnoWhatsAppTurnReference,
  ): Promise<QuickFurnoWhatsAppProcessorOutcome> => {
    let traceSequence = 0;
    const traceActor = ref.assignedActor;
    const tracePrefix =
      traceActor === 'RIYA' ? 'riya' : traceActor === 'ANISHA' ? 'anisha' : 'aarohi';
    const traceFlow =
      traceActor === 'RIYA'
        ? { flowId: 'agent-flow.riya.whatsapp-client.v1', flowVersion: 1 }
        : traceActor === 'ANISHA'
          ? { flowId: 'agent-flow.anisha.whatsapp-vendor.v1', flowVersion: 1 }
          : { flowId: 'agent-flow.aarohi.whatsapp-prospect.v1', flowVersion: 1 };
    const traceNodeId = (suffix: string): string => `${tracePrefix}.${suffix}`;
    const emitTrace = (
      kind: AgentFlowTraceEventKind,
      status: AgentFlowTraceStatus,
      nodeId?: string,
      resultCode?: string,
    ): void => {
      if (config.traceSink === undefined) return;
      const sequence = traceSequence;
      traceSequence += 1;
      try {
        config.traceSink.record(
          parseAgentFlowTraceEvent({
            protocol: AGENT_FLOW_TRACE_PROTOCOL,
            traceId: ref.inboundMessageId,
            flowId: traceFlow.flowId,
            flowVersion: traceFlow.flowVersion,
            actor: traceActor,
            conversationId: ref.conversationId,
            inboundMessageId: ref.inboundMessageId,
            sequence,
            kind,
            ...(nodeId === undefined ? {} : { nodeId }),
            status,
            at: traceClock(),
            ...(resultCode === undefined ? {} : { resultCode }),
          }),
        );
      } catch {
        // Observation is powerless by design. A malformed clock or broken sink cannot affect a turn.
      }
    };

    const traceNode = async <T>(
      nodeId: string,
      operation: () => Promise<T>,
      successCode: (value: T) => string = () => 'ok',
    ): Promise<T> => {
      emitTrace('NODE_ENTERED', 'RUNNING', nodeId);
      try {
        const value = await operation();
        emitTrace('NODE_EXITED', 'SUCCEEDED', nodeId, successCode(value));
        return value;
      } catch (error) {
        emitTrace('NODE_EXITED', 'FAILED', nodeId, 'error');
        throw error;
      }
    };

    const traceSync = <T>(
      nodeId: string,
      operation: () => T,
      successCode: (value: T) => string = () => 'ok',
    ): T => {
      emitTrace('NODE_ENTERED', 'RUNNING', nodeId);
      try {
        const value = operation();
        emitTrace('NODE_EXITED', 'SUCCEEDED', nodeId, successCode(value));
        return value;
      } catch (error) {
        emitTrace('NODE_EXITED', 'FAILED', nodeId, 'error');
        throw error;
      }
    };

    const observeNode = (nodeId: string, resultCode: string): void => {
      emitTrace('NODE_OBSERVED', 'OBSERVED', nodeId, resultCode);
    };
    const finish = (outcome: Exclude<QuickFurnoWhatsAppProcessorOutcome, 'idle'>) => {
      emitTrace(
        'RUN_COMPLETED',
        outcome === 'failed-indeterminate' ? 'FAILED' : 'SUCCEEDED',
        undefined,
        outcome,
      );
      return outcome;
    };
    const completeTurn = () =>
      traceNode(
        traceNodeId('queue.complete'),
        () => config.queue.complete(ref.inboundMessageId),
        () => 'completed',
      );

    emitTrace('RUN_STARTED', 'RUNNING');
    observeNode(traceNodeId('trigger.whatsapp-inbound'), 'admitted-before-worker');
    observeNode(traceNodeId('queue.claim-turn'), 'claimed');

    let material: QuickFurnoWhatsAppWorkerMaterial;
    let conversationContext;
    try {
      const contextReader = config.conversationContextReader;
      const contextPromise =
        ref.turnPurpose === 'lead_qualification' || contextReader === undefined
          ? Promise.resolve(undefined)
          : traceNode(
              traceNodeId('context.conversation'),
              () =>
                contextReader.read({
                    conversationId: ref.conversationId,
                    inboundMessageId: ref.inboundMessageId,
                    expectedRevision: ref.conversationRevision,
                  })
                  .then((envelope) => envelope.context),
              () => 'loaded',
            ).catch(() => undefined);
      [material, conversationContext] = await Promise.all([
        traceNode(
          traceNodeId('context.turn-material'),
          () =>
            config.materialReader.read({
              conversationId: ref.conversationId,
              inboundMessageId: ref.inboundMessageId,
              expectedRevision: ref.conversationRevision,
              ...(ref.turnPurpose === 'lead_qualification'
                ? {
                    turnPurpose: 'lead_qualification' as const,
                    qualificationRequestId: ref.qualificationRequestId,
                  }
                : {}),
            }),
          () => 'loaded',
        ),
        contextPromise,
      ]);
    } catch (error) {
      if (error instanceof QuickFurnoWhatsAppHttpError && error.code === 'request-failed') {
        await config.queue.release(ref.inboundMessageId);
        return finish('released-pre-agent');
      }
      if (error instanceof QuickFurnoWhatsAppHttpError && error.code === 'stale-revision') {
        await completeTurn();
        return finish('completed-stale');
      }
      await config.queue.fail(ref.inboundMessageId);
      return finish('failed-indeterminate');
    }

    if (!materialMatches(ref, material)) {
      await config.queue.fail(ref.inboundMessageId);
      return finish('failed-indeterminate');
    }
    if (traceActor === 'RIYA') {
      observeNode('riya.memory.client-journey', 'material-projection');
      observeNode('riya.memory.lifetime', 'material-projection');
      observeNode('riya.memory.vendor-journey', 'material-projection');
      observeNode('riya.context.core-availability', 'material-projection');
    } else {
      observeNode(traceNodeId('context.authority-scope'), 'core-authority-projection');
      observeNode(traceNodeId('intelligence.domain'), 'domain-input-ready');
    }

    const vendorFeedbackWriter = config.clientVendorFeedbackWriter;
    if (
      ref.turnPurpose !== 'lead_qualification' &&
      vendorFeedbackWriter !== undefined &&
      'subjectType' in material
    ) {
      const feedbackMaterial = material;
      const feedback = traceSync(
        'riya.detect.vendor-feedback',
        () => feedbackForMaterial(feedbackMaterial),
        (value) => (value === null ? 'none' : 'detected'),
      );
      if (feedback !== null) {
        let feedbackResult;
        try {
          feedbackResult = await traceNode(
            'riya.action.record-vendor-feedback',
            () => vendorFeedbackWriter.record({ material: feedbackMaterial, feedback }),
            (value) => value.outcome,
          );
        } catch (error) {
          if (error instanceof QuickFurnoWhatsAppHttpError && error.code === 'request-failed') {
            await config.queue.release(ref.inboundMessageId);
            return finish('released-pre-agent');
          }
          await config.queue.fail(ref.inboundMessageId);
          return finish('failed-indeterminate');
        }

        if (feedbackResult.outcome === 'stale') {
          await completeTurn();
          return finish('completed-stale');
        }
        if (feedbackResult.outcome === 'retry_later') {
          await config.queue.release(ref.inboundMessageId);
          return finish('released-pre-agent');
        }
        if (feedbackResult.outcome === 'blocked') {
          await config.queue.fail(ref.inboundMessageId);
          return finish('failed-indeterminate');
        }

        try {
          material = await traceNode(
            'riya.context.refresh-after-feedback',
            () =>
              config.materialReader.read({
                conversationId: ref.conversationId,
                inboundMessageId: ref.inboundMessageId,
                expectedRevision: ref.conversationRevision,
              }),
            () => 'loaded',
          );
        } catch (error) {
          if (error instanceof QuickFurnoWhatsAppHttpError && error.code === 'request-failed') {
            await config.queue.release(ref.inboundMessageId);
            return finish('released-pre-agent');
          }
          if (error instanceof QuickFurnoWhatsAppHttpError && error.code === 'stale-revision') {
            await completeTurn();
            return finish('completed-stale');
          }
          await config.queue.fail(ref.inboundMessageId);
          return finish('failed-indeterminate');
        }
        if (!materialMatches(ref, material)) {
          await config.queue.fail(ref.inboundMessageId);
          return finish('failed-indeterminate');
        }
      }
    }

    const matchRequestWriter = config.clientMatchRequestWriter;
    if (
      ref.turnPurpose !== 'lead_qualification' &&
      matchRequestWriter !== undefined &&
      'subjectType' in material &&
      material.assignedActor === 'RIYA' &&
      material.subjectType === 'client'
    ) {
      const matchMaterial = material;
      const shouldMatch = traceSync(
        'riya.intelligence.client-os',
        () =>
          traceSync(
            'riya.condition.request-match',
            () => shouldRequestCoreMatch(matchMaterial),
            (value) => (value ? 'request-match' : 'no-match'),
          ),
        (value) => (value ? 'request-match' : 'no-match'),
      );

      if (shouldMatch) {
        let actionResult;
        try {
          actionResult = await traceNode(
            'riya.action.request-match',
            () => matchRequestWriter.request({ material: matchMaterial }),
            (value) => value.outcome,
          );
        } catch (error) {
          if (error instanceof QuickFurnoWhatsAppHttpError && error.code === 'request-failed') {
            await config.queue.release(ref.inboundMessageId);
            return finish('released-pre-agent');
          }
          await config.queue.fail(ref.inboundMessageId);
          return finish('failed-indeterminate');
        }

        if (actionResult.outcome === 'stale') {
          await completeTurn();
          return finish('completed-stale');
        }
        if (actionResult.outcome === 'retry_later') {
          await config.queue.release(ref.inboundMessageId);
          return finish('released-pre-agent');
        }

        try {
          material = await traceNode(
            'riya.context.refresh-after-match',
            () =>
              config.materialReader.read({
                conversationId: ref.conversationId,
                inboundMessageId: ref.inboundMessageId,
                expectedRevision: ref.conversationRevision,
              }),
            () => 'loaded',
          );
        } catch (error) {
          if (error instanceof QuickFurnoWhatsAppHttpError && error.code === 'request-failed') {
            await config.queue.release(ref.inboundMessageId);
            return finish('released-pre-agent');
          }
          if (error instanceof QuickFurnoWhatsAppHttpError && error.code === 'stale-revision') {
            await completeTurn();
            return finish('completed-stale');
          }
          await config.queue.fail(ref.inboundMessageId);
          return finish('failed-indeterminate');
        }
        if (!materialMatches(ref, material)) {
          await config.queue.fail(ref.inboundMessageId);
          return finish('failed-indeterminate');
        }
        if (
          actionResult.outcome === 'blocked' &&
          'clientMatchDecision' in material &&
          material.clientMatchDecision.state === 'READY'
        ) {
          await config.queue.fail(ref.inboundMessageId);
          return finish('failed-indeterminate');
        }
      }
    }

    let proposal;
    try {
      proposal = await traceNode(
        'riya.agent.specialist-runtime',
        () =>
          config.traceSink === undefined
            ? config.specialistRuntime.process(material, conversationContext)
            : config.specialistRuntime.process(material, conversationContext, (observation) => {
                emitTrace(
                  'NODE_OBSERVED',
                  'OBSERVED',
                  traceNodeId('agent.specialist-runtime'),
                  `model-route:${observation.complexity}:${observation.releaseId}`,
                );
              }),
        (value) => (value === null ? 'no-reply' : 'proposal'),
      );
    } catch {
      await config.queue.fail(ref.inboundMessageId);
      return finish('failed-indeterminate');
    }
    if (proposal === null) {
      await completeTurn();
      return finish('completed-no-reply');
    }

    try {
      const outcome = await traceNode(
        traceNodeId('action.write-reply'),
        () =>
          config.replyWriter.write({
            conversationId: ref.conversationId,
            expectedRevision: ref.conversationRevision,
            proposal,
          }),
        (value) => value,
      );
      await completeTurn();
      return finish(outcome === 'stale' ? 'completed-stale' : 'completed-queued');
    } catch {
      // An agent/Core run has already occurred. Do not auto-rerun it after callback uncertainty.
      await config.queue.fail(ref.inboundMessageId);
      return finish('failed-indeterminate');
    }
  };

  return Object.freeze({
    processClaimed,
    async processOne(selection: QuickFurnoWhatsAppTurnClaimSelection = {}) {
      const ref = await config.queue.claimNext(selection);
      return ref === null ? 'idle' : processClaimed(ref);
    },
  });
}
