/**
 * The Jarvis Action Kernel.
 *
 * Jarvis recommends; QuickFurno Core authorizes. The kernel is the deterministic seam between those
 * facts. It deliberately owns NO business policy and NO execution mechanism.
 *
 * What it adds before the Core decision port:
 * - one in-process flight per exact proposal identity + content;
 * - same-identity/different-content conflict refusal while a request is in flight;
 * - fail-closed normalization if an injected Core port unexpectedly throws;
 * - content-free audit observations;
 * - receipts that can never be mistaken for execution authority.
 *
 * What it deliberately does NOT add:
 * - no durable cache of ACCEPTED (a later retry must re-pass current Core/state checks);
 * - no local approval or policy decision;
 * - no DB write, Core Automation call, provider call, message send, vendor assignment or lead mutation;
 * - no execution credential surface.
 */
import type {
  CoreDecisionOutcome,
  CoreDecisionPort,
  CoreDecisionRequest,
} from '@qf-jarvis/agent-runtime';

import {
  ACTION_KERNEL_PROTOCOL,
  NOOP_ACTION_KERNEL_OBSERVABILITY,
  type ActionKernel,
  type ActionKernelCapabilities,
  type ActionKernelEvent,
  type ActionKernelEventType,
  type ActionKernelObservabilityHook,
  type ActionKernelReason,
  type ActionKernelReceipt,
} from './contracts.js';
import { actionKernelIdentityKey, actionKernelRequestFingerprint } from './fingerprint.js';

export interface ActionKernelConfig {
  readonly coreDecision: CoreDecisionPort;
  readonly observability?: ActionKernelObservabilityHook;
}

interface InFlightSubmission {
  readonly fingerprint: string;
  readonly promise: Promise<ActionKernelReceipt>;
}

const CAPABILITIES: ActionKernelCapabilities = Object.freeze({
  protocol: ACTION_KERNEL_PROTOCOL,
  recommendationOnly: true,
  quickFurnoCoreIsAuthority: true,
  directBusinessMutation: 'FORBIDDEN',
  quickFurnoCoreAutomationIsExecutor: true,
  temporalIsCoordinationOnly: true,
  temporalCanAuthorize: false,
  temporalCanExecuteBusinessEffects: false,
  directCoreAutomationCall: 'FORBIDDEN',
  directProviderCall: 'FORBIDDEN',
  holdsExecutionCredentials: false,
  durableAuthorityCache: false,
  executionAuthority: 'NONE',
});

const OUTCOME_REASON: Readonly<Record<CoreDecisionOutcome, ActionKernelReason>> = Object.freeze({
  ACCEPTED: 'core-accepted',
  REJECTED: 'core-rejected',
  HUMAN_REVIEW_REQUIRED: 'core-human-review',
  RETRY_LATER: 'core-retry-later',
  STALE_REVISION: 'core-stale-revision',
  CORE_UNAVAILABLE: 'core-unavailable',
});

/** Freeze the exact semantic request the kernel fingerprints and hands to Core. */
function snapshotRequest(request: CoreDecisionRequest): CoreDecisionRequest {
  return Object.freeze({
    proposalId: request.proposalId,
    proposalVersion: request.proposalVersion,
    conversationId: request.conversationId,
    expectedRevision: request.expectedRevision,
    assignedActor: request.assignedActor,
    partyType: request.partyType,
    proposalKind: request.proposalKind,
    structuredIntent: Object.freeze({ ...request.structuredIntent }),
    policyRevision: request.policyRevision,
    evaluationRef: request.evaluationRef,
    citations: Object.freeze(request.citations.map((citation) => Object.freeze({ ...citation }))),
    proposedReplyBody: request.proposedReplyBody,
  });
}

export function createActionKernel(config: ActionKernelConfig): ActionKernel {
  const hook = config.observability ?? NOOP_ACTION_KERNEL_OBSERVABILITY;
  const inFlight = new Map<string, InFlightSubmission>();

  const emit = (
    request: CoreDecisionRequest,
    identityKey: string,
    fingerprint: string,
    type: ActionKernelEventType,
    reason?: ActionKernelReason,
    coreOutcome?: CoreDecisionOutcome,
  ): void => {
    hook.onEvent(
      Object.freeze({
        protocol: ACTION_KERNEL_PROTOCOL,
        type,
        reason,
        identityKey,
        requestFingerprint: fingerprint,
        proposalId: request.proposalId,
        proposalVersion: request.proposalVersion,
        conversationId: request.conversationId,
        expectedRevision: request.expectedRevision,
        proposalKind: request.proposalKind,
        coreOutcome,
        executionAuthority: 'NONE',
      } satisfies ActionKernelEvent),
    );
  };

  const receipt = (
    request: CoreDecisionRequest,
    identityKey: string,
    fingerprint: string,
    args: {
      readonly status: 'CORE_DECISION' | 'REFUSED';
      readonly reason: ActionKernelReason;
      readonly coreOutcome?: CoreDecisionOutcome;
      readonly coreInvoked: boolean;
    },
  ): ActionKernelReceipt =>
    Object.freeze({
      protocol: ACTION_KERNEL_PROTOCOL,
      status: args.status,
      reason: args.reason,
      identityKey,
      requestFingerprint: fingerprint,
      proposalId: request.proposalId,
      proposalVersion: request.proposalVersion,
      conversationId: request.conversationId,
      expectedRevision: request.expectedRevision,
      proposalKind: request.proposalKind,
      coreOutcome: args.coreOutcome,
      coreInvoked: args.coreInvoked,
      executionAuthority: 'NONE',
      canExecute: false,
    });

  async function callCore(
    request: CoreDecisionRequest,
    identityKey: string,
    fingerprint: string,
  ): Promise<ActionKernelReceipt> {
    emit(request, identityKey, fingerprint, 'core-requested');
    let coreOutcome: CoreDecisionOutcome;
    try {
      coreOutcome = (await config.coreDecision.decide(request)).outcome;
    } catch {
      const failed = receipt(request, identityKey, fingerprint, {
        status: 'CORE_DECISION',
        reason: 'kernel-core-threw',
        coreOutcome: 'CORE_UNAVAILABLE',
        coreInvoked: true,
      });
      emit(
        request,
        identityKey,
        fingerprint,
        'core-failure-normalized',
        failed.reason,
        failed.coreOutcome,
      );
      emit(
        request,
        identityKey,
        fingerprint,
        'submission-completed',
        failed.reason,
        failed.coreOutcome,
      );
      return failed;
    }

    const result = receipt(request, identityKey, fingerprint, {
      status: 'CORE_DECISION',
      reason: OUTCOME_REASON[coreOutcome],
      coreOutcome,
      coreInvoked: true,
    });
    emit(request, identityKey, fingerprint, 'core-outcome-observed', result.reason, coreOutcome);
    emit(request, identityKey, fingerprint, 'submission-completed', result.reason, coreOutcome);
    return result;
  }

  function submit(request: CoreDecisionRequest): Promise<ActionKernelReceipt> {
    const snapshot = snapshotRequest(request);
    const identityKey = actionKernelIdentityKey(snapshot);
    const fingerprint = actionKernelRequestFingerprint(snapshot);
    emit(snapshot, identityKey, fingerprint, 'submission-started');

    const active = inFlight.get(identityKey);
    if (active !== undefined) {
      if (active.fingerprint === fingerprint) {
        emit(snapshot, identityKey, fingerprint, 'singleflight-joined');
        return active.promise;
      }
      const conflict = receipt(snapshot, identityKey, fingerprint, {
        status: 'REFUSED',
        reason: 'kernel-identity-conflict',
        coreInvoked: false,
      });
      emit(snapshot, identityKey, fingerprint, 'identity-conflict-refused', conflict.reason);
      emit(snapshot, identityKey, fingerprint, 'submission-completed', conflict.reason);
      return Promise.resolve(conflict);
    }

    const promise = callCore(snapshot, identityKey, fingerprint).finally(() => {
      const current = inFlight.get(identityKey);
      if (current?.promise === promise) inFlight.delete(identityKey);
    });
    inFlight.set(identityKey, Object.freeze({ fingerprint, promise }));
    return promise;
  }

  return Object.freeze({
    submit,
    capabilities: (): ActionKernelCapabilities => CAPABILITIES,
  });
}
