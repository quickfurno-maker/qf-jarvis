/**
 * The QuickFurno Core decision adapter (QFJ-M3, ADR-0056 §A, §F, §I, §L).
 *
 * A concrete `CoreDecisionPort` (M2): it applies the pre-transport state gate, builds a versioned
 * command, sends it through the injected transport at most once, strictly validates the response
 * identity, and applies the post-response state gate — returning `ACCEPTED` ONLY when Core returns it
 * against the exact identity with unchanged state. A missing transport → `CORE_UNAVAILABLE`; a
 * transport exception/timeout is normalized to a safe fail-closed outcome with no raw error. The
 * adapter contains no business rule and cannot fabricate or upgrade an outcome; it sends/executes
 * nothing.
 */
import type {
  CoreDecisionOutcome,
  CoreDecisionPort,
  CoreDecisionRequest,
  CoreDecisionResponse,
} from '@qf-jarvis/agent-runtime';

import { buildCoreCommand, idempotencyKeyFor } from '../contracts/command.js';
import type { CoreCommandResponse } from '../contracts/response.js';
import { DEFAULT_CORE_DECISION_PROTOCOL } from '../contracts/protocol.js';
import type { CoreDecisionProtocol } from '../contracts/protocol.js';
import type { CoreAdapterReason } from '../contracts/reasons.js';
import type { CoreDecisionStateReader } from '../contracts/state.js';
import type {
  CoreAdapterEvent,
  CoreAdapterEventType,
  CoreAdapterObservabilityHook,
} from '../contracts/observability.js';
import { NOOP_CORE_ADAPTER_OBSERVABILITY } from '../contracts/observability.js';
import type { CoreDecisionTransport } from '../transport/core-decision-transport.js';
import { serializeCommand } from '../transport/core-decision-transport.js';
import { validateResponse } from './validate-response.js';
import { isStateBlocked } from './state-gates.js';
import { isRetryable } from './retry-classification.js';

/** The detailed result of an adapter decision — outcome, safe reason, retry class, and identity. */
export interface CoreAdapterResult {
  readonly outcome: CoreDecisionOutcome;
  readonly reason: CoreAdapterReason;
  readonly retryable: boolean;
  readonly idempotencyKey: string;
  readonly transportInvoked: boolean;
  readonly response: CoreCommandResponse | undefined;
}

/** A Core decision adapter: an M2 `CoreDecisionPort` plus a detailed decision method. */
export interface CoreDecisionAdapter extends CoreDecisionPort {
  decideDetailed(request: CoreDecisionRequest): Promise<CoreAdapterResult>;
}

export interface CoreDecisionAdapterConfig {
  readonly stateReader: CoreDecisionStateReader;
  /** Injected canonical-instant clock (no wall-clock read inside the adapter). */
  readonly clock: () => string;
  readonly protocol?: CoreDecisionProtocol;
  readonly transport?: CoreDecisionTransport;
  readonly correlationId?: string;
  readonly observability?: CoreAdapterObservabilityHook;
}

const OUTCOME_REASON: Readonly<Record<CoreDecisionOutcome, CoreAdapterReason>> = Object.freeze({
  ACCEPTED: 'core-accepted',
  REJECTED: 'core-rejected',
  HUMAN_REVIEW_REQUIRED: 'core-human-review',
  RETRY_LATER: 'core-retry-later',
  STALE_REVISION: 'core-stale-revision',
  CORE_UNAVAILABLE: 'core-unavailable',
});

/** Build a Core decision adapter from injected collaborators. */
export function createCoreDecisionAdapter(config: CoreDecisionAdapterConfig): CoreDecisionAdapter {
  const protocol = config.protocol ?? DEFAULT_CORE_DECISION_PROTOCOL;
  const hook = config.observability ?? NOOP_CORE_ADAPTER_OBSERVABILITY;
  const correlationId = config.correlationId ?? 'run.default';

  async function decideDetailed(request: CoreDecisionRequest): Promise<CoreAdapterResult> {
    const idempotencyKey = idempotencyKeyFor({
      protocol,
      proposalId: request.proposalId,
      proposalVersion: request.proposalVersion,
      conversationId: request.conversationId,
      expectedRevision: request.expectedRevision,
    });
    const commandId = `${request.conversationId}-${request.proposalId}-r${String(request.expectedRevision)}`;

    const emit = (
      type: CoreAdapterEventType,
      reason: CoreAdapterReason,
      outcome?: CoreDecisionOutcome,
    ): void => {
      hook.onEvent(
        Object.freeze({
          type,
          commandId,
          idempotencyKey,
          conversationId: request.conversationId,
          proposalId: request.proposalId,
          expectedRevision: request.expectedRevision,
          protocolName: protocol.name,
          protocolVersion: protocol.version,
          outcome,
          reason,
        } satisfies CoreAdapterEvent),
      );
    };
    const result = (
      outcome: CoreDecisionOutcome,
      reason: CoreAdapterReason,
      transportInvoked: boolean,
      response?: CoreCommandResponse,
    ): CoreAdapterResult =>
      Object.freeze({
        outcome,
        reason,
        retryable: isRetryable(reason),
        idempotencyKey,
        transportInvoked,
        response,
      });

    // Pre-transport state gate — a changed/blocking state stops before any transport.
    if (isStateBlocked(await config.stateReader.read(), request)) {
      emit('response-refused', 'adapter-state-blocked', 'STALE_REVISION');
      return result('STALE_REVISION', 'adapter-state-blocked', false);
    }

    const command = buildCoreCommand({
      request,
      protocol,
      correlationId,
      createdAt: config.clock(),
    });
    emit('command-created', 'core-unavailable');

    // Missing transport → fail closed.
    if (config.transport === undefined) {
      emit('response-refused', 'adapter-transport-missing', 'CORE_UNAVAILABLE');
      return result('CORE_UNAVAILABLE', 'adapter-transport-missing', false);
    }

    // Transport at most once. An exception/timeout is normalized; no raw error escapes.
    emit('transport-requested', 'core-unavailable');
    let serialized: string;
    try {
      serialized = await config.transport.send(serializeCommand(command));
    } catch {
      emit('response-refused', 'adapter-transport-error', 'CORE_UNAVAILABLE');
      return result('CORE_UNAVAILABLE', 'adapter-transport-error', true);
    }

    // Strict response-identity validation.
    const validated = validateResponse(serialized, command);
    if (!validated.ok) {
      emit('response-refused', validated.reason, 'CORE_UNAVAILABLE');
      return result('CORE_UNAVAILABLE', validated.reason, true);
    }
    const response = validated.response;
    emit('response-received', OUTCOME_REASON[response.outcome], response.outcome);

    // Post-response state gate — a change after the response prevents ACCEPTED.
    if (
      response.outcome === 'ACCEPTED' &&
      isStateBlocked(await config.stateReader.read(), request)
    ) {
      emit('response-refused', 'adapter-state-blocked', 'STALE_REVISION');
      return result('STALE_REVISION', 'adapter-state-blocked', true, response);
    }

    // The outcome comes SOLELY from the Core response — never fabricated or upgraded.
    const reason = OUTCOME_REASON[response.outcome];
    emit('completed', reason, response.outcome);
    return result(response.outcome, reason, true, response);
  }

  async function decide(request: CoreDecisionRequest): Promise<CoreDecisionResponse> {
    return { outcome: (await decideDetailed(request)).outcome };
  }

  return Object.freeze({ decide, decideDetailed });
}
