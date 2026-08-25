/**
 * The governed JAO-3 memory operations (ADR-0117).
 *
 * ### Every operation is explicit. There is no loop here.
 *
 * No timer, no interval, no queue consumer, no sweeper, no scheduler and no auto-resume. An
 * investigation advances because something called one of these functions; nothing in this slice
 * advances one while nobody is looking. Ambient operation is JAO-5's to design and govern, and a
 * `setInterval` added here would be JAO-3 quietly taking that on -- so a spec asserts the absence
 * of every one of those names in the built source.
 *
 * ### Why there is no Mastra workflow in JAO-3
 *
 * JAO-1 and JAO-2 use `@mastra/core/workflows` because sequencing steps is what they prove. JAO-3
 * proves durability, and durability is a property of PostgreSQL records: Mastra's in-process state
 * is not durable and a harness that held any part of this would be a second, weaker store beside
 * the real one. ADR-0117 requires that removing Mastra entirely must not damage the memory format,
 * which is only true while the format lives in the schema and these contracts. So Mastra is
 * absent here on purpose, and a spec asserts it.
 *
 * ### Telemetry is not a second memory store
 *
 * Ids, counters, a status, a duration and a closed outcome. No summary, no hypothesis, no
 * correction statement, no evidence payload, no database message -- a telemetry pipeline is
 * exactly where content that was carefully kept out of the database tends to reappear.
 */
import {
  JAO3_ERROR_CODES,
  Jao3MemoryError,
  jao3TelemetryEventSchema,
  type Jao3AppendCheckpointInput,
  type Jao3AppendOwnerCorrectionInput,
  type Jao3Clock,
  type Jao3CreateInvestigationInput,
  type Jao3ErrorCode,
  type Jao3Investigation,
  type Jao3InvestigationView,
  type Jao3Operation,
  type Jao3ResumeInvestigationInput,
  type Jao3SupersedeInvestigationInput,
  type Jao3TelemetryHook,
  type Jao3TransitionInput,
} from './contracts.js';
import type {
  Jao3CheckpointAppendResult,
  Jao3CorrectionAppendResult,
  Jao3InvestigationStore,
} from './store-port.js';

export interface Jao3MemoryDependencies {
  readonly store: Jao3InvestigationStore;
  readonly clock: Jao3Clock;
  readonly telemetry?: Jao3TelemetryHook;
}

/** A read is performed by a run too, and an audit record that cannot say by whom is a weaker one. */
export interface Jao3ReadInput {
  readonly investigationId: string;
  readonly runId: string;
}

/**
 * The bounds JAO-3 operates under, as a machine-readable lock.
 *
 * Asserted by a spec so the claims in ADR-0117 and the PR are checkable rather than descriptive.
 */
export const JAO3_MEMORY_BOUNDS = Object.freeze({
  memoryClass: 'OPERATIONAL_NON_AUTHORITATIVE',
  durableStore: 'POSTGRES',
  modelCalls: 0,
  specialistCalls: 0,
  proposalsCreated: 0,
  approvalRequestsCreated: 0,
  executionIntentsCreated: 0,
  businessEffect: false,
  backgroundResume: false,
  scheduler: false,
  mastraMemoryOrStorage: false,
  managedMigrationAdopted: false,
  rememberedAuthorizationIsPermission: false,
  optimisticConcurrency: true,
  idempotentRetryableWrites: true,
  expiryEnforcedWithoutScheduler: true,
  supersessionEnforced: true,
  ownerCorrectionsAppendOnly: true,
  evidencePayloadsStored: false,
  chainOfThoughtStored: false,
});

export const JAO3_MEMORY_ERROR_CODES: readonly Jao3ErrorCode[] = Object.freeze([
  ...JAO3_ERROR_CODES,
]);

/**
 * The governed memory surface.
 *
 * Note what it does not have: no `authorize`, `approve`, `canExecute`, `execute`, `send`,
 * `dispatch`, `activateVendor` or `assignLead`; no `clearAll`, `deleteAll`, `reset`, `prune` or
 * `delete`; no `query`, `execute` or raw row access. A spec asserts each of those names is absent
 * from the built surface, because "we would never add that" is not a control.
 */
export interface Jao3MemoryOperations {
  createInvestigation(input: Jao3CreateInvestigationInput): Promise<Jao3Investigation>;
  readInvestigation(input: Jao3ReadInput): Promise<Jao3Investigation>;
  readInvestigationView(input: Jao3ReadInput): Promise<Jao3InvestigationView>;
  appendCheckpoint(input: Jao3AppendCheckpointInput): Promise<Jao3CheckpointAppendResult>;
  appendOwnerCorrection(input: Jao3AppendOwnerCorrectionInput): Promise<Jao3CorrectionAppendResult>;
  resumeInvestigation(input: Jao3ResumeInvestigationInput): Promise<Jao3Investigation>;
  pauseInvestigation(input: Jao3TransitionInput): Promise<Jao3Investigation>;
  completeInvestigation(input: Jao3TransitionInput): Promise<Jao3Investigation>;
  supersedeInvestigation(input: Jao3SupersedeInvestigationInput): Promise<Jao3Investigation>;
}

/**
 * What telemetry can say about a completed operation.
 *
 * `revision` is always known -- for an append it is the revision that write COMMITTED at, which is
 * the number a reader of the audit trail actually wants. `header` is present only for operations
 * that legitimately return current state: an append no longer returns the mutable header, and
 * telemetry does not go and fetch one, because a second read to enrich a log would report state
 * from a different instant than the operation it describes.
 */
interface Jao3OperationOutcome {
  readonly revision: number;
  readonly header: Jao3Investigation | null;
}

/** The closed error code for anything that escaped, without reading what it carried. */
function toErrorCode(error: unknown): Jao3ErrorCode {
  return error instanceof Jao3MemoryError ? error.code : 'DATABASE_UNAVAILABLE';
}

export function createJao3MemoryOperations(
  dependencies: Jao3MemoryDependencies,
): Jao3MemoryOperations {
  const { store, clock, telemetry } = dependencies;

  /**
   * Run one operation, and emit exactly one bounded event for it either way.
   *
   * A refusal is telemetered as carefully as a success: an operational memory whose failures are
   * invisible tells an operator only about the paths that worked.
   */
  async function observed<T>(
    operation: Jao3Operation,
    identity: { readonly investigationId: string; readonly runId: string },
    work: (nowMs: number) => Promise<T>,
    outcomeOf: (value: T) => Jao3OperationOutcome,
  ): Promise<T> {
    const startedAt = clock.nowMs();
    try {
      const value = await work(startedAt);
      emit(operation, identity, clock.nowMs() - startedAt, outcomeOf(value), null);
      return value;
    } catch (error) {
      emit(operation, identity, clock.nowMs() - startedAt, null, toErrorCode(error));
      throw error;
    }
  }

  function emit(
    operation: Jao3Operation,
    identity: { readonly investigationId: string; readonly runId: string },
    elapsedMs: number,
    outcome: Jao3OperationOutcome | null,
    errorCode: Jao3ErrorCode | null,
  ): void {
    if (telemetry === undefined) {
      return;
    }
    const parsed = jao3TelemetryEventSchema.safeParse({
      investigationId: identity.investigationId,
      runId: identity.runId,
      operation,
      revision: outcome?.revision ?? 0,
      status: outcome?.header?.status ?? null,
      checkpointCount: outcome?.header?.checkpointCount ?? 0,
      ownerCorrectionCount: outcome?.header?.ownerCorrectionCount ?? 0,
      resumeCount: outcome?.header?.resumeCount ?? 0,
      durationMs: Math.max(0, Math.min(600_000, Math.trunc(elapsedMs))),
      outcome: errorCode === null ? 'COMPLETED' : 'REFUSED',
      errorCode,
      memoryClass: 'OPERATIONAL_NON_AUTHORITATIVE',
      modelCalls: 0,
      specialistCalls: 0,
      businessEffect: false,
    });
    if (!parsed.success) {
      // A telemetry event that cannot be bounded is dropped rather than emitted unbounded. The
      // operation itself is unaffected: memory is the product here, and telemetry is a report.
      return;
    }
    telemetry.record(parsed.data);
  }

  return Object.freeze({
    async createInvestigation(input: Jao3CreateInvestigationInput): Promise<Jao3Investigation> {
      return observed(
        'CREATE',
        { investigationId: input.investigationId, runId: input.rootRunId },
        async (nowMs) => store.createInvestigation(input, nowMs),
        (value) => ({ revision: value.revision, header: value }),
      );
    },

    async readInvestigation(input: Jao3ReadInput): Promise<Jao3Investigation> {
      return observed(
        'READ',
        input,
        async () => store.readInvestigation(input.investigationId),
        (value) => ({ revision: value.revision, header: value }),
      );
    },

    async readInvestigationView(input: Jao3ReadInput): Promise<Jao3InvestigationView> {
      return observed(
        'READ',
        input,
        async () => store.readInvestigationView(input.investigationId),
        (value) => ({ revision: value.investigation.revision, header: value.investigation }),
      );
    },

    async appendCheckpoint(input: Jao3AppendCheckpointInput): Promise<Jao3CheckpointAppendResult> {
      return observed(
        'APPEND_CHECKPOINT',
        input,
        async (nowMs) => store.appendCheckpoint(input, nowMs),
        (value) => ({ revision: value.committedRevision, header: null }),
      );
    },

    async appendOwnerCorrection(
      input: Jao3AppendOwnerCorrectionInput,
    ): Promise<Jao3CorrectionAppendResult> {
      return observed(
        'APPEND_OWNER_CORRECTION',
        input,
        async (nowMs) => store.appendOwnerCorrection(input, nowMs),
        (value) => ({ revision: value.committedRevision, header: null }),
      );
    },

    async resumeInvestigation(input: Jao3ResumeInvestigationInput): Promise<Jao3Investigation> {
      return observed(
        'RESUME',
        { investigationId: input.investigationId, runId: input.nextRunId },
        async (nowMs) => store.resumeInvestigation(input, nowMs),
        (value) => ({ revision: value.revision, header: value }),
      );
    },

    async pauseInvestigation(input: Jao3TransitionInput): Promise<Jao3Investigation> {
      return observed(
        'PAUSE',
        input,
        async (nowMs) => store.pauseInvestigation(input, nowMs),
        (value) => ({ revision: value.revision, header: value }),
      );
    },

    async completeInvestigation(input: Jao3TransitionInput): Promise<Jao3Investigation> {
      return observed(
        'COMPLETE',
        input,
        async (nowMs) => store.completeInvestigation(input, nowMs),
        (value) => ({ revision: value.revision, header: value }),
      );
    },

    async supersedeInvestigation(
      input: Jao3SupersedeInvestigationInput,
    ): Promise<Jao3Investigation> {
      return observed(
        'SUPERSEDE',
        input,
        async (nowMs) => store.supersedeInvestigation(input, nowMs),
        (value) => ({ revision: value.revision, header: value }),
      );
    },
  });
}
