/**
 * Public contracts for the Jarvis Action Kernel.
 *
 * The kernel is NOT an authorization engine. It is a deterministic submission firewall in front of
 * QuickFurno Core. `executionAuthority` is always `NONE` and `canExecute` is always false, including
 * when Core returns ACCEPTED. Temporal is coordination only and gains no authority by invoking it.
 */
import type {
  CoreDecisionOutcome,
  CoreDecisionRequest,
  OrchestrationProposalKind,
} from '@qf-jarvis/agent-runtime';

export const ACTION_KERNEL_PROTOCOL = 'qfj.action-kernel.v2' as const;

export const ACTION_KERNEL_REASONS = [
  'core-accepted',
  'core-rejected',
  'core-human-review',
  'core-retry-later',
  'core-stale-revision',
  'core-unavailable',
  'kernel-core-threw',
  'kernel-identity-conflict',
] as const;
export type ActionKernelReason = (typeof ACTION_KERNEL_REASONS)[number];

export const ACTION_KERNEL_EVENT_TYPES = [
  'submission-started',
  'singleflight-joined',
  'identity-conflict-refused',
  'core-requested',
  'core-outcome-observed',
  'core-failure-normalized',
  'submission-completed',
] as const;
export type ActionKernelEventType = (typeof ACTION_KERNEL_EVENT_TYPES)[number];

export interface ActionKernelReceipt {
  readonly protocol: typeof ACTION_KERNEL_PROTOCOL;
  readonly status: 'CORE_DECISION' | 'REFUSED';
  readonly reason: ActionKernelReason;
  readonly identityKey: string;
  readonly requestFingerprint: string;
  readonly proposalId: string;
  readonly proposalVersion: number;
  readonly conversationId: string;
  readonly expectedRevision: number;
  readonly proposalKind: OrchestrationProposalKind;
  readonly coreOutcome: CoreDecisionOutcome | undefined;
  readonly coreInvoked: boolean;
  readonly executionAuthority: 'NONE';
  readonly canExecute: false;
}

/** Content-free observation: there is no field for proposal text, contacts, secrets or provider data. */
export interface ActionKernelEvent {
  readonly protocol: typeof ACTION_KERNEL_PROTOCOL;
  readonly type: ActionKernelEventType;
  readonly reason: ActionKernelReason | undefined;
  readonly identityKey: string;
  readonly requestFingerprint: string;
  readonly proposalId: string;
  readonly proposalVersion: number;
  readonly conversationId: string;
  readonly expectedRevision: number;
  readonly proposalKind: OrchestrationProposalKind;
  readonly coreOutcome: CoreDecisionOutcome | undefined;
  readonly executionAuthority: 'NONE';
}

export interface ActionKernelObservabilityHook {
  onEvent(event: ActionKernelEvent): void;
}

export const NOOP_ACTION_KERNEL_OBSERVABILITY: ActionKernelObservabilityHook = Object.freeze({
  onEvent: (_event: ActionKernelEvent): void => undefined,
});

export interface ActionKernelCapabilities {
  readonly protocol: typeof ACTION_KERNEL_PROTOCOL;
  readonly recommendationOnly: true;
  readonly quickFurnoCoreIsAuthority: true;
  readonly quickFurnoCoreAutomationIsExecutor: true;
  readonly temporalIsCoordinationOnly: true;
  readonly temporalCanAuthorize: false;
  readonly temporalCanExecuteBusinessEffects: false;
  readonly directBusinessMutation: 'FORBIDDEN';
  readonly directCoreAutomationCall: 'FORBIDDEN';
  readonly directProviderCall: 'FORBIDDEN';
  readonly holdsExecutionCredentials: false;
  readonly durableAuthorityCache: false;
  readonly executionAuthority: 'NONE';
}

export interface ActionKernel {
  submit(request: CoreDecisionRequest): Promise<ActionKernelReceipt>;
  capabilities(): ActionKernelCapabilities;
}
