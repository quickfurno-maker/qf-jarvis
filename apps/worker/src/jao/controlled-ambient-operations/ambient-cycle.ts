/**
 * The JAO-5 explicit ambient cycle (ADR-0119).
 *
 * ### Ambient does not mean running
 *
 * This is a function somebody calls. There is no `setInterval`, no recurring `setTimeout`, no cron
 * entry, no queue consumer, no webhook, no EventEmitter subscription and no background thread
 * anywhere in this slice, and a spec asserts every one of those absences over comment-stripped
 * source. What it proves is that schedule and event ELIGIBILITY are decided deterministically from
 * durable state and an injected instant -- which is the hard part, and the part a real scheduler
 * would need to be built on top of. A production scheduler or event ingress is a separate
 * activation review.
 *
 * ### The order of the gates is the governance
 *
 * enrollment -> definition binding -> cancellation -> kill -> expiry -> status -> quiet ->
 * trigger due / event match -> snapshot pre-validation -> cycle claim budget -> DURABLE CLAIM ->
 * canonical JAO-1 investigation -> DURABLE FINALIZE.
 *
 * Everything before the claim is decided without consuming anything, so a monitor that is killed,
 * expired, quieted, not due, duplicated or handed a malformed signal spends no budget and starts no
 * investigation.
 *
 * ### The claim commits before the investigation, and no transaction spans it
 *
 * `claimAmbientRun` returns after its transaction commits. JAO-1's capability read and its single
 * model call then run with nothing locked, and `finalizeAmbientRun` opens a second short
 * transaction. A row lock held across model inference would make one slow provider a stalled
 * database.
 *
 * ### Crash after claim
 *
 * If the process dies between claim and finalize, the claim stays and the budget stays consumed --
 * because external work may already have begun and nothing here can know whether it did. The same
 * trigger identity will not run again: `UNIQUE (dedupe_key)` refuses it. That is the deliberate
 * trade for a first proof. **Duplicate suppression matters more than automatic retry**, because a
 * duplicated investigation means a duplicated model call and a second piece of attention about the
 * same thing, while a missed one means the next cadence slot picks it up.
 *
 * ### Attention is not authority
 *
 * The only thing a cycle can produce is JAO-1's own inert `SHADOW_OPERATIONAL_ATTENTION`. JAO-5
 * creates no proposal, no approval request, no execution intent, no Core mutation, no channel send
 * and no n8n run -- and the result schema has literal zeros where those counts would go.
 */
import { parseControlPlaneSnapshotV1 } from '@qf-jarvis/control-plane-read-contract';
import type { DatabasePool } from '@qf-jarvis/event-backbone';
import type { ModelGateway } from '@qf-jarvis/model-gateway';

import {
  createJao1ModelGatewayBridge,
  createSnapshotSystemHealthCapability,
  runJao1ShadowSupervisor,
  type Jao1RunResult,
} from '../mastra-supervisor/index.js';
import {
  JAO5_LIMITS,
  Jao5AmbientError,
  jao5AmbientCycleRequestSchema,
  jao5AmbientCycleResultSchema,
  jao5AmbientRunResultSchema,
  type Jao5AmbientCycleResult,
  type Jao5AmbientOutcome,
  type Jao5AmbientRunResult,
  type Jao5ApprovedEvent,
  type Jao5Clock,
  type Jao5MonitorDefinition,
  type Jao5MonitorInstance,
  type Jao5RefusalReason,
  type Jao5TelemetryHook,
} from './contracts.js';
import {
  createJao5MonitorRegistry,
  jao5DefinitionDigest,
  type Jao5MonitorRegistry,
} from './monitor-registry.js';
import {
  assertJao5Claimable,
  assertJao5DefinitionBinding,
  assertJao5EventMatches,
  assertJao5NotCancelled,
  jao5DueScheduledSlot,
  jao5EventDedupeKey,
  jao5QuietUntilMs,
  jao5ScheduledDedupeKey,
} from './policy.js';
import { createJao5PostgresStore } from './postgres-store.js';
import type { Jao5AmbientStore } from './store-port.js';

/**
 * What a PUBLIC caller supplies: outer boundaries, and nothing that decides anything.
 *
 * ### Why there is no `investigate` field here
 *
 * The JAO-4 owner-review lesson, applied before it could be repeated. A public investigator
 * callback would let a caller replace the thing every gate exists to govern -- the containment
 * specs read this source tree and cannot read a function supplied from outside it, so "one
 * capability call, one model call, QF Model Gateway only, no business effect" would be true of this
 * directory and unproven of what actually ran.
 *
 * A marker, brand or descriptor flag would not help: anything that can supply a function can copy a
 * brand. The public runner therefore CONSTRUCTS the canonical JAO-1 composition itself, from its
 * own imports, and offers no parameter that could replace it.
 *
 * `gateway` is a genuine outer boundary rather than an escape hatch: it is the QF Model Gateway
 * seam JAO-1 already requires, and JAO-5 never sees a provider credential.
 */
export interface Jao5AmbientDependencies {
  /**
   * The trusted PERSISTENCE INFRASTRUCTURE boundary -- not a store.
   *
   * A `Jao5AmbientStore` would hand a public caller `claimAmbientRun`, whose trigger kind, trigger
   * reference, dedupe key, scheduled slot, event id, definition digest, budget window and
   * per-window limit are all caller-supplied. The adapter re-checks them against the locked row,
   * but it cannot reconstruct canonical monitor policy -- so it cannot know whether the slot was
   * due, whether the event matched the monitor's own type and scope, or whether those budget
   * numbers are the reviewed ones. A caller could therefore skip this function entirely, or
   * substitute a store of its own, and the public surface would stop being the governance boundary
   * it claims to be.
   */
  readonly pool: DatabasePool;
  readonly gateway: ModelGateway;
  readonly clock: Jao5Clock;
  readonly telemetry?: Jao5TelemetryHook;
}

/** What runs an investigation once JAO-5's gates have allowed one to start. */
export type Jao5Investigator = (
  input: { readonly runId: string; readonly snapshot: unknown },
  signal?: AbortSignal,
) => Promise<Jao1RunResult>;

/**
 * The INTERNAL composition seam. Trusted, source-level, and not public.
 *
 * It exists so the threat-model suite can substitute a hostile investigator and prove why pinning
 * is necessary -- a proof that requires being able to attempt the thing being prevented. It is
 * exported from this module and from no barrel; `public.ts` and `index.ts` do not re-export it, and
 * a spec asserts that by name, by barrel key and by source scan.
 *
 * A future production pluggable investigator is a different thing entirely and needs its own
 * authorization boundary and threat model. This is not that.
 */
export interface Jao5InternalAmbientDependencies {
  readonly store: Jao5AmbientStore;
  readonly clock: Jao5Clock;
  readonly telemetry?: Jao5TelemetryHook;
  readonly gateway?: ModelGateway;
  readonly registry?: Jao5MonitorRegistry;
  readonly investigate?: Jao5Investigator;
}

/** The bounds JAO-5 operates under, as a machine-readable lock a spec asserts. */
export const JAO5_AMBIENT_BOUNDS = Object.freeze({
  monitorCount: 2,
  scope: 'CONTROL_PLANE_SYSTEM_HEALTH',
  modelAuthority: 'QF_MODEL_GATEWAY_ONLY',
  realSchedulerActivated: false,
  eventConsumerActivated: false,
  backgroundExecution: false,
  publicInvestigatorInjection: false,
  killTerminal: true,
  unkillAvailable: false,
  catchUpStorm: false,
  transactionOverModelCall: false,
  managedMigrationAdopted: false,
  businessEffect: false,
  productionMutation: false,
  coreMutations: 0,
  executionIntentsCreated: 0,
  channelSends: 0,
  n8nExecutions: 0,
  specialistCalls: 0,
  memoryWrites: 0,
  toolCalls: 0,
  ...JAO5_LIMITS,
});

function refusedRun(
  instance: Jao5MonitorInstance | null,
  monitorInstanceId: string,
  definition: Jao5MonitorDefinition | null,
  reason: Jao5RefusalReason,
): Jao5AmbientRunResult {
  return jao5AmbientRunResultSchema.parse({
    ambientRunId: null,
    monitorInstanceId,
    monitorId: instance?.monitorId ?? definition?.monitorId ?? 'jao5.unknown',
    monitorVersion: '1',
    triggerKind: definition?.triggerType ?? 'SCHEDULED_INTERVAL',
    triggerRef: null,
    dedupeKey: null,
    jao1RunId: null,
    outcome: 'REFUSED',
    refusalReason: reason,
    attention: null,
    attentionPresent: false,
    // Nothing was claimed, so there is no durable record to have failed to write.
    persistenceStatus: 'NOT_CLAIMED',
    persistenceRefusalReason: null,
    capabilityCalls: 0,
    modelCalls: 0,
    businessEffect: false,
    productionMutation: false,
  });
}

/** The closed code for anything that escaped, without reading what it carried. */
function toRefusal(error: unknown): Jao5RefusalReason {
  return error instanceof Jao5AmbientError ? error.code : 'WORKFLOW_FAILED';
}

/**
 * The refusal reason for a failure in the DURABLE WRITE phase.
 *
 * A classified store error keeps its own code, so `CLAIM_ALREADY_FINALIZED` and `CLAIM_NOT_FOUND`
 * still say what they mean. Anything unclassified becomes `STORE_FAILED` rather than
 * `WORKFLOW_FAILED`, because the phase that failed was persistence: reporting it as a workflow
 * failure would blame the investigation for a write it had already finished.
 */
function toPersistenceRefusal(error: unknown): Jao5RefusalReason {
  return error instanceof Jao5AmbientError ? error.code : 'STORE_FAILED';
}

/** JAO-1's outcome, mapped into JAO-5's. `RECOMMENDATION_READY` is attention, never approval. */
function toAmbientOutcome(result: Jao1RunResult): Jao5AmbientOutcome {
  if (result.outcome === 'NO_ANOMALY') {
    return 'NO_ANOMALY';
  }
  return result.outcome === 'RECOMMENDATION_READY' ? 'ATTENTION_CREATED' : 'REFUSED';
}

/**
 * Run one explicit ambient cycle. THE PUBLIC ENTRY POINT.
 *
 * The canonical monitor registry and the canonical JAO-1 composition are constructed HERE, from
 * this module's own imports. There is no parameter through which a caller could replace either, so
 * the investigation that runs is the one the containment specs actually read.
 */
export async function runJao5AmbientCycle(
  request: unknown,
  dependencies: Jao5AmbientDependencies,
  signal?: AbortSignal,
): Promise<Jao5AmbientCycleResult> {
  // Pinned, not defaulted. `??` on a caller-supplied field is only a pin until somebody passes a
  // value, which is exactly how JAO-4 acquired its injection defect. The canonical Postgres store
  // is CONSTRUCTED here from the pool, so there is no store parameter to displace.
  return runJao5AmbientCycleInternal(
    {
      store: createJao5PostgresStore(dependencies.pool),
      gateway: dependencies.gateway,
      clock: dependencies.clock,
      ...(dependencies.telemetry === undefined ? {} : { telemetry: dependencies.telemetry }),
    },
    request,
    signal,
  );
}

/**
 * The internal cycle. NOT PUBLIC -- see `Jao5InternalAmbientDependencies`.
 *
 * Identical governance to the public path; the only difference is that a trusted source-level
 * caller may substitute the registry or the investigator in order to prove that the gates refuse
 * what they are supposed to refuse.
 */
export async function runJao5AmbientCycleInternal(
  dependencies: Jao5InternalAmbientDependencies,
  request: unknown,
  signal?: AbortSignal,
): Promise<Jao5AmbientCycleResult> {
  const startedAt = dependencies.clock.nowMs();
  const registry = dependencies.registry ?? createJao5MonitorRegistry();

  /**
   * The canonical JAO-1 composition, built here rather than accepted from a caller.
   *
   * `createSnapshotSystemHealthCapability` is JAO-1's own read capability and
   * `createJao1ModelGatewayBridge` its own governed model seam -- JAO-5 does not invent a second
   * investigation engine, a second model router or a second prompt. JAO-1's bounds (one capability
   * call, one model call, zero retries, SHADOW mode) remain superior and untouched.
   */
  const investigate: Jao5Investigator =
    dependencies.investigate ??
    (async (input, abort) => {
      const gateway = dependencies.gateway;
      if (gateway === undefined) {
        throw new Jao5AmbientError('WORKFLOW_FAILED');
      }
      return runJao1ShadowSupervisor(
        { runId: input.runId, snapshot: input.snapshot },
        {
          readSystemHealth: createSnapshotSystemHealthCapability(),
          modelBridge: createJao1ModelGatewayBridge(gateway),
          clock: { nowMs: () => dependencies.clock.nowMs() },
        },
        abort,
      );
    });

  const runs: Jao5AmbientRunResult[] = [];
  let claimsMade = 0;
  let investigationsStarted = 0;
  let attentionCreated = 0;
  let cycleId = 'jao5.cycle.unknown';
  let cycleRunId = 'jao5.run.unknown';

  const parsed = jao5AmbientCycleRequestSchema.safeParse(request);
  if (!parsed.success) {
    return finish(cycleId, cycleRunId, 0, [], 0, 0, 0, dependencies, startedAt);
  }
  const governed = parsed.data;
  cycleId = governed.cycleId;
  cycleRunId = governed.runId;

  for (const monitorInstanceId of governed.monitorInstanceIds) {
    let instance: Jao5MonitorInstance | null = null;
    let definition: Jao5MonitorDefinition | null = null;
    try {
      assertJao5NotCancelled(signal);

      instance = await dependencies.store.readMonitorInstance(monitorInstanceId);
      definition = registry.lookup(instance.monitorId, instance.monitorVersion);
      assertJao5DefinitionBinding(instance, definition, jao5DefinitionDigest);

      const nowMs = dependencies.clock.nowMs();
      // Kill, expiry, status and quiet -- all before anything is consumed.
      assertJao5Claimable(instance, nowMs);

      const trigger = resolveTrigger(instance, definition, governed.event, nowMs);

      // Pre-validated BEFORE a durable claim, using the CANONICAL parser JAO-1 itself uses rather
      // than a second copy of its diagnostic logic. Spending a budget unit on a snapshot that is
      // certain to be refused would let a malformed signal exhaust a monitor's window.
      const snapshot = trigger.snapshot ?? governed.snapshot;
      try {
        parseControlPlaneSnapshotV1(snapshot);
      } catch {
        throw new Jao5AmbientError(
          definition.triggerType === 'APPROVED_EVENT' ? 'EVENT_INVALID' : 'REQUEST_INVALID',
        );
      }

      if (claimsMade >= JAO5_LIMITS.maxClaimsPerCycle) {
        throw new Jao5AmbientError('BUDGET_EXHAUSTED');
      }

      const ambientRunId = `${governed.cycleId}.${monitorInstanceId}`.slice(0, 128);
      const jao1RunId = `${governed.runId}.${String(runs.length)}`.slice(0, 128);

      // ---- PHASE A: the durable claim. Commits before any investigation starts. --------------
      const claim = await dependencies.store.claimAmbientRun(
        {
          monitorInstanceId,
          ambientRunId,
          jao1RunId,
          cycleRunId: governed.runId,
          triggerKind: definition.triggerType,
          triggerRef: trigger.triggerRef,
          dedupeKey: trigger.dedupeKey,
          scheduledSlot: trigger.scheduledSlot,
          eventId: trigger.eventId,
          definitionDigest: instance.definitionDigest,
          budgetWindowSeconds: definition.budgetPolicy.budgetWindowSeconds,
          maxInvestigationsPerWindow: definition.budgetPolicy.maxInvestigationsPerWindow,
        },
        nowMs,
      );
      claimsMade += 1;

      // ---- PHASE B: the canonical investigation. NO transaction, NO row lock. -----------------
      let jao1: Jao1RunResult | null = null;
      let refusal: Jao5RefusalReason | null = null;
      try {
        assertJao5NotCancelled(signal);
        investigationsStarted += 1;
        jao1 = await investigate({ runId: jao1RunId, snapshot }, signal);
      } catch (error) {
        refusal = toRefusal(error);
      }

      const outcome: Jao5AmbientOutcome = jao1 === null ? 'REFUSED' : toAmbientOutcome(jao1);
      // Only an ATTENTION_CREATED outcome carries attention. JAO-1 can in principle return an
      // attention object alongside a refusal; JAO-5 does not surface one, because "attention was
      // created" and "the investigation refused" should not both be true of a single run.
      const attentionPresent = outcome === 'ATTENTION_CREATED' && jao1?.attention != null;
      if (outcome === 'ATTENTION_CREATED') {
        attentionCreated += 1;
      }

      // ---- PHASE C: the durable finalize. Bounded, exactly once, quieting applied. ------------
      //
      // Its failure is caught HERE rather than by the outer handler. Once Phase A commits a claim
      // exists and an investigation may have run; reporting that through the generic refusal path
      // would return a null ambient run id and a null JAO-1 run id while the cycle counters still
      // said one claim was made and one investigation started -- a record contradicting itself and
      // losing the identity of work that demonstrably happened.
      const finalizedAt = dependencies.clock.nowMs();
      let persistenceStatus: 'FINALIZED' | 'FINALIZE_FAILED' = 'FINALIZED';
      let persistenceRefusal: Jao5RefusalReason | null = null;
      try {
        await dependencies.store.finalizeAmbientRun(
          {
            ambientRunId: claim.ambientRunId,
            outcome,
            refusalCode: outcome === 'REFUSED' ? (refusal ?? 'INVESTIGATION_REFUSED') : null,
            attentionPresent,
            capabilityCalls: jao1?.capabilityCalls ?? 0,
            modelCalls: jao1?.modelCalls ?? 0,
            quietUntilMs: jao5QuietUntilMs(definition, outcome, finalizedAt),
          },
          finalizedAt,
        );
      } catch (error) {
        // The durable row stays CLAIMED, because the finalize did not commit. What the
        // investigation actually found is still reported, and the persistence failure is stated as
        // its own fact rather than folded into the investigation's outcome.
        persistenceStatus = 'FINALIZE_FAILED';
        persistenceRefusal = toPersistenceRefusal(error);
      }

      runs.push(
        jao5AmbientRunResultSchema.parse({
          ambientRunId: claim.ambientRunId,
          monitorInstanceId,
          monitorId: instance.monitorId,
          monitorVersion: '1',
          triggerKind: definition.triggerType,
          triggerRef: trigger.triggerRef,
          dedupeKey: trigger.dedupeKey,
          jao1RunId,
          outcome,
          refusalReason: outcome === 'REFUSED' ? (refusal ?? 'INVESTIGATION_REFUSED') : null,
          // JAO-1's own bounded inert attention, returned IN MEMORY. It is never handed to the
          // store and never copied into telemetry -- only the boolean is. Counting attention
          // without surfacing it told a caller something happened and refused to say what.
          attention: attentionPresent ? (jao1?.attention ?? null) : null,
          attentionPresent,
          persistenceStatus,
          persistenceRefusalReason: persistenceRefusal,
          capabilityCalls: jao1?.capabilityCalls ?? 0,
          modelCalls: jao1?.modelCalls ?? 0,
          businessEffect: false,
          productionMutation: false,
        }),
      );
    } catch (error) {
      // Normalised. The thrown object is never read, so nothing it carries -- a path, a stack, a
      // message quoting a snapshot -- can reach the record.
      runs.push(refusedRun(instance, monitorInstanceId, definition, toRefusal(error)));
    }
  }

  return finish(
    cycleId,
    cycleRunId,
    governed.monitorInstanceIds.length,
    runs,
    claimsMade,
    investigationsStarted,
    attentionCreated,
    dependencies,
    startedAt,
  );
}

interface ResolvedTrigger {
  readonly triggerRef: string;
  readonly dedupeKey: string;
  readonly scheduledSlot: number | null;
  readonly eventId: string | null;
  readonly snapshot: unknown;
}

/**
 * Decide what, if anything, this monitor is triggered by right now.
 *
 * Deterministic on both paths: a scheduled monitor gets the CURRENT cadence slot computed from its
 * enrollment anchor, and an event monitor gets the event's own id. Neither derives identity from a
 * process, a timestamp or an invocation counter.
 */
function resolveTrigger(
  instance: Jao5MonitorInstance,
  definition: Jao5MonitorDefinition,
  event: Jao5ApprovedEvent | undefined,
  nowMs: number,
): ResolvedTrigger {
  if (definition.triggerType === 'SCHEDULED_INTERVAL') {
    // At most ONE claim per cycle, and it is the current slot. Missed slots are collapsed rather
    // than queued -- replaying a downtime backlog would mean a burst of model calls at exactly the
    // moment a system is least healthy, and the present is what an operator wants investigated.
    const slot = jao5DueScheduledSlot(instance, definition, nowMs);
    return {
      triggerRef: `slot:${String(slot)}`,
      dedupeKey: jao5ScheduledDedupeKey(instance.monitorInstanceId, slot),
      scheduledSlot: slot,
      eventId: null,
      snapshot: undefined,
    };
  }

  if (event === undefined) {
    throw new Jao5AmbientError('TRIGGER_NOT_DUE');
  }
  assertJao5EventMatches(definition, event);
  return {
    triggerRef: event.eventId,
    dedupeKey: jao5EventDedupeKey(instance.monitorInstanceId, event.eventId),
    scheduledSlot: null,
    eventId: event.eventId,
    snapshot: event.snapshot,
  };
}

function finish(
  cycleId: string,
  runId: string,
  monitorsEvaluated: number,
  runs: readonly Jao5AmbientRunResult[],
  claimsMade: number,
  investigationsStarted: number,
  attentionCreated: number,
  dependencies: Jao5InternalAmbientDependencies,
  startedAt: number,
): Jao5AmbientCycleResult {
  const durationMs = Math.max(
    0,
    Math.min(600_000, Math.trunc(dependencies.clock.nowMs() - startedAt)),
  );

  const result = jao5AmbientCycleResultSchema.parse({
    cycleId,
    runId,
    monitorsEvaluated,
    claimsMade,
    investigationsStarted,
    attentionCreated,
    runs: [...runs],
    durationMs,

    // Restated as literals rather than described. A cycle that somehow did have effect could not
    // report itself as one that had not.
    businessEffect: false,
    productionMutation: false,
    coreMutations: 0,
    executionIntentsCreated: 0,
    channelSends: 0,
    n8nExecutions: 0,
    specialistCalls: 0,
    memoryWrites: 0,
    toolCalls: 0,
  });

  if (dependencies.telemetry !== undefined) {
    dependencies.telemetry.record({
      cycleId: result.cycleId,
      runId: result.runId,
      triggerType: 'EXPLICIT_AMBIENT_CYCLE',
      monitorsEvaluated: result.monitorsEvaluated,
      claimsMade: result.claimsMade,
      investigationsStarted: result.investigationsStarted,
      attentionCreated: result.attentionCreated,
      durationMs: result.durationMs,
      businessEffect: false,
      productionMutation: false,
      coreMutations: 0,
      executionIntentsCreated: 0,
      channelSends: 0,
    });
  }

  return Object.freeze(result);
}
