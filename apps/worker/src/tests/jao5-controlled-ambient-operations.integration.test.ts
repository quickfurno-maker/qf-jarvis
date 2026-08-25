/**
 * JAO-5 durable ambient governance, against a real PostgreSQL (ADR-0119).
 *
 * This is the suite the slice exists for. Every gate JAO-5 enforces is only a gate if it survives a
 * restart: if restarting reset dedupe, budgets, quieting, the last scheduled slot, the kill switch
 * or expiry, then restarting would BE the bypass -- and an unstable system restarts most.
 *
 * ### What a "process" means here
 *
 * Each lettered process builds a brand new pool and a brand new store and closes the pool before
 * the next begins. No object, closure or cache survives the boundary, so anything that comes back
 * came out of the database.
 *
 * ### The investigator here is a counting stub, deliberately
 *
 * These tests prove GOVERNANCE -- when an investigation may start, and that it starts at most once.
 * Running real JAO-1 would drag a model gateway into a durability suite and prove nothing extra
 * about claims. The stub is injected through the INTERNAL seam, which is exactly what that seam is
 * for; the public runner's canonical pinning is proved in the unit suite.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { validateModelRequest } from '@qf-jarvis/model-gateway';
import type {
  ModelGateway,
  ModelGatewayInvokeOptions,
  ModelResponse,
} from '@qf-jarvis/model-gateway';

import { jao1RunResultSchema } from '../jao/mastra-supervisor/index.js';

import {
  JAO5_EVENT_HEALTH_MONITOR,
  JAO5_SCHEDULED_HEALTH_MONITOR,
  createJao5PostgresStore,
  runJao5AmbientCycle,
  enrollJao5Monitor,
  jao5BudgetWindowStart,
  jao5DefinitionDigest,
  killJao5Monitor,
  type Jao5AmbientStore,
  type Jao5Clock,
} from '../jao/controlled-ambient-operations/index.js';
// By DIRECT MODULE PATH. The internal seam is not reachable through the barrel above.
import {
  runJao5AmbientCycleInternal,
  type Jao5Investigator,
} from '../jao/controlled-ambient-operations/ambient-cycle.js';
import {
  JAO5_TEST_SCHEMA,
  applyJao5Schema,
  closeDatabasePool,
  countJao5RowsFor,
  createJao5TestPool,
  forceJao5RawUpdate,
  resetJao5Schema,
  type DatabasePool,
} from './jao5-database-harness.js';

class SteppableClock implements Jao5Clock {
  private value: number;
  constructor(startMs: number) {
    this.value = startMs;
  }
  nowMs(): number {
    return this.value;
  }
  set(ms: number): void {
    this.value = ms;
  }
  advance(ms: number): void {
    this.value += ms;
  }
}

const T0 = Date.parse('2026-08-25T09:00:00.000Z');
const CADENCE_MS = 900 * 1_000;
const HOUR = 60 * 60 * 1_000;

/**
 * A control-plane snapshot the CANONICAL parser accepts.
 *
 * The exact shape `parseControlPlaneSnapshotV1` requires, matching the JAO-1 fixture. JAO-5
 * pre-validates with that parser before spending a durable claim, so a snapshot that merely looks
 * plausible is refused here just as it would be in production -- which is the point.
 */
function section(
  availability: 'STATIC_BASELINE' | 'NOT_CONNECTED' | 'PLANNED',
  items: unknown[] = [],
): Record<string, unknown> {
  return {
    availability,
    reason: 'Synthetic JAO-5 ambient fixture.',
    expectedSource: 'Injected control-plane fixture only.',
    items,
  };
}

function series(id: string, label: string): Record<string, unknown> {
  return {
    availability: 'NOT_CONNECTED' as const,
    reason: 'Synthetic JAO-5 ambient fixture.',
    expectedSource: 'Injected control-plane fixture only.',
    id,
    label,
    points: [],
  };
}

const SNAPSHOT: Record<string, unknown> = {
  contractVersion: '1',
  generatedAt: '2026-08-25T05:00:00.000Z',
  mode: 'READ_ONLY',
  source: { kind: 'DEMO_FIXTURE', freshness: 'BUILD_DECLARATION', liveOperationalData: false },
  authority: {
    jarvis: 'RECOMMENDS_AND_OBSERVES',
    quickfurnoCore: 'AUTHORIZES_AND_OWNS_BUSINESS_TRUTH',
    n8n: 'EXECUTES_ONLY',
    provider: 'DELIVERS_ONLY',
  },
  rollout: { enabled: false, state: 'ROLLOUT_OFF' },
  system: [
    {
      id: 'jarvis-api',
      label: 'Jarvis API',
      state: 'HEALTHY',
      detail: 'Synthetic API health is healthy.',
    },
  ],
  capabilities: [],
  agents: [],
  roadmap: [],
  sections: {
    headlineMetrics: section('STATIC_BASELINE'),
    attention: section('STATIC_BASELINE'),
    activity: section('STATIC_BASELINE'),
    approvalQueue: section('NOT_CONNECTED'),
    approvalBreakdown: section('NOT_CONNECTED'),
    conversationControl: section('NOT_CONNECTED'),
    conversationActivity: series('conversation-activity', 'Conversation activity'),
    modelLatency: series('model-latency', 'Model latency'),
    agentWorkload: section('NOT_CONNECTED'),
    vendorGrowthFunnel: section('PLANNED'),
    workers: section('PLANNED'),
    models: section('NOT_CONNECTED'),
    knowledge: section('NOT_CONNECTED'),
    evaluations: section('NOT_CONNECTED'),
    coreSync: section('STATIC_BASELINE'),
    businessAnalytics: section('NOT_CONNECTED'),
    n8nExecution: section('NOT_CONNECTED'),
  },
};

const DEGRADED_SNAPSHOT: Record<string, unknown> = {
  ...SNAPSHOT,
  system: [
    {
      id: 'jarvis-api',
      label: 'Jarvis API',
      state: 'DEGRADED',
      detail: 'Synthetic API health is degraded for the ambient proof.',
    },
  ],
};

/**
 * A counting QF Model Gateway.
 *
 * The only model path JAO-5 has. It reaches no provider: it validates the governed request the way
 * a real gateway does and answers from a fixture, so "QF_MODEL_GATEWAY_ONLY" is measured rather
 * than asserted.
 */
class CountingGateway implements ModelGateway {
  calls = 0;

  async invoke(request: unknown, _options?: ModelGatewayInvokeOptions): Promise<ModelResponse> {
    await Promise.resolve();
    this.calls += 1;
    const validated = validateModelRequest(request);
    if (!validated.ok) {
      throw new Error('ambient proof gateway received an invalid governed request');
    }
    const governed = validated.request;
    return {
      runId: governed.runId,
      resultMode: 'STRUCTURED',
      structuredResult: {
        diagnosis: 'The API component is degraded and needs operator investigation.',
        confidence: 0.82,
        recommendedNextStep: 'Inspect the API health evidence.',
        evidenceRefs: ['control-plane.system:jarvis-api:DEGRADED'],
      },
      provenance: {
        runId: governed.runId,
        purpose: governed.purpose,
        providerId: 'fake-shadow-provider',
        modelId: 'fake-shadow-model',
        modelVersion: 'v1',
        promptId: governed.promptId,
        promptVersion: governed.promptVersion,
        promptDigest: governed.promptDigest,
        mode: 'SHADOW',
        usedFallback: false,
        attempts: 1,
      },
      usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30, cost: 0 },
      latencyMs: 1,
      finishStatus: 'completed',
    };
  }
}

interface Process {
  readonly pool: DatabasePool;
  readonly store: Jao5AmbientStore;
  readonly clock: SteppableClock;
  investigations: () => number;
  readonly investigate: Jao5Investigator;
  close: () => Promise<void>;
}

/** A whole new "process": pool, store, clock, counting investigator. */
function startProcess(
  name: string,
  startMs = T0,
  outcome: 'NO_ANOMALY' | 'ATTENTION' = 'NO_ANOMALY',
): Process {
  const pool = createJao5TestPool(`qf-jarvis-jao5-${name}`);
  const clock = new SteppableClock(startMs);
  let investigations = 0;
  const investigate: Jao5Investigator = async (input) => {
    investigations += 1;
    return Promise.resolve(
      jao1RunResultSchema.parse(
        outcome === 'NO_ANOMALY'
          ? {
              runId: input.runId,
              outcome: 'NO_ANOMALY' as const,
              refusalReason: null,
              snapshotRef: 'control-plane:2026-08-25T05:00:00.000Z',
              evidenceRefs: [],
              anomaly: null,
              attention: null,
              modelProvenance: null,
              capabilityCalls: 1,
              modelCalls: 0,
              taskType: 'jarvis.operations.shadow-health-investigation' as const,
              autonomyLevel: 'L1_READ' as const,
              capabilitiesInvoked: ['read.system-health-from-snapshot' as const],
              durationMs: 5,
            }
          : {
              runId: input.runId,
              outcome: 'RECOMMENDATION_READY' as const,
              refusalReason: null,
              snapshotRef: 'control-plane:2026-08-25T05:00:00.000Z',
              evidenceRefs: ['component_id=jarvis-api'],
              anomaly: {
                componentId: 'jarvis-api',
                componentLabel: 'Jarvis API',
                state: 'DEGRADED' as const,
                detail: 'Synthetic API health is degraded.',
              },
              attention: {
                kind: 'SHADOW_OPERATIONAL_ATTENTION' as const,
                title: 'Jarvis API degraded',
                context: 'One component reports degraded.',
                severity: 'warning' as const,
                recommendedNextStep: 'Inspect the Jarvis API health evidence.',
                confidence: 0.7,
                evidenceRefs: ['component_id=jarvis-api'],
              },
              modelProvenance: null,
              capabilityCalls: 1,
              modelCalls: 1,
              taskType: 'jarvis.operations.shadow-health-investigation' as const,
              autonomyLevel: 'L1_READ' as const,
              capabilitiesInvoked: ['read.system-health-from-snapshot' as const],
              durationMs: 5,
            },
      ),
    );
  };
  return {
    pool,
    store: createJao5PostgresStore(pool),
    clock,
    investigations: () => investigations,
    investigate,
    close: async (): Promise<void> => {
      await closeDatabasePool(pool);
    },
  };
}

let counter = 0;
function anInstanceId(): string {
  counter += 1;
  return `jao5.instance.${String(counter).padStart(6, '0')}`;
}

function cycle(
  process: Process,
  instanceIds: readonly string[],
  over: Record<string, unknown> = {},
): ReturnType<typeof runJao5AmbientCycleInternal> {
  counter += 1;
  return runJao5AmbientCycleInternal(
    { store: process.store, clock: process.clock, investigate: process.investigate },
    {
      cycleId: `jao5.cycle.${String(counter).padStart(6, '0')}`,
      runId: `jao5.run.${String(counter).padStart(6, '0')}`,
      mode: 'SHADOW',
      monitorInstanceIds: [...instanceIds],
      snapshot: SNAPSHOT,
      ...over,
    },
  );
}

async function enroll(
  process: Process,
  monitorInstanceId: string,
  monitorId = JAO5_SCHEDULED_HEALTH_MONITOR.monitorId,
  enrollmentSeconds = 24 * 60 * 60,
): Promise<void> {
  await enrollJao5Monitor(
    {
      operationId: `${monitorInstanceId}.enroll`,
      monitorInstanceId,
      monitorId,
      monitorVersion: '1',
      enrollmentSeconds,
    },
    { store: process.store, clock: process.clock },
  );
}

let admin: DatabasePool;

beforeAll(async () => {
  admin = createJao5TestPool('qf-jarvis-jao5-admin');
  await resetJao5Schema(admin);
}, 60_000);

afterAll(async () => {
  await closeDatabasePool(admin);
});

describe('JAO-5 durable ambient governance', () => {
  let instanceId: string;

  beforeEach(() => {
    instanceId = anInstanceId();
  });

  it('applies the local schema cleanly, and applies again without damage', async () => {
    await applyJao5Schema(admin);
    const { withClient } = await import('@qf-jarvis/event-backbone');
    const tables = await withClient(admin, async (client) => {
      const found = await client.query<{ readonly table_name: string }>(
        `SELECT table_name FROM information_schema.tables WHERE table_schema = $1 ORDER BY table_name`,
        [JAO5_TEST_SCHEMA],
      );
      return found.rows.map((row) => row.table_name);
    });
    expect(tables).toStrictEqual([
      'ambient_budget_window',
      'ambient_investigation_run',
      'ambient_monitor_instance',
      'ambient_operation_replay',
    ]);
  });

  it('enrolls durably, and a FRESH pool reads the same instance back', async () => {
    const a = startProcess('a');
    await enroll(a, instanceId);
    const enrolled = await a.store.readMonitorInstance(instanceId);
    expect(enrolled.status).toBe('ACTIVE');
    expect(enrolled.mode).toBe('SHADOW');
    expect(enrolled.ownerId).toBe('jarvis.operations');
    expect(enrolled.definitionDigest).toBe(jao5DefinitionDigest(JAO5_SCHEDULED_HEALTH_MONITOR));
    await a.close();

    const b = startProcess('b');
    expect(await b.store.readMonitorInstance(instanceId)).toStrictEqual(enrolled);
    await b.close();
  });

  it('replays an identical enrollment and refuses a changed one under the same operation id', async () => {
    const a = startProcess('a');
    const input = {
      operationId: `${instanceId}.enroll`,
      monitorInstanceId: instanceId,
      monitorId: JAO5_SCHEDULED_HEALTH_MONITOR.monitorId,
      monitorVersion: '1' as const,
      enrollmentSeconds: 3600,
    };
    const first = await enrollJao5Monitor(input, { store: a.store, clock: a.clock });
    expect(first.replayed).toBe(false);
    await a.close();

    // A different process retries. The durable result is IDENTICAL apart from call metadata --
    // `committedRevision` is the revision the operation actually committed at, never a header that
    // has moved on since.
    const b = startProcess('b');
    b.clock.advance(HOUR);
    const replay = await enrollJao5Monitor(input, { store: b.store, clock: b.clock });
    expect(replay.replayed).toBe(true);
    expect({ ...replay, replayed: false }).toStrictEqual({ ...first, replayed: false });

    await expect(
      enrollJao5Monitor({ ...input, enrollmentSeconds: 7200 }, { store: b.store, clock: b.clock }),
    ).rejects.toMatchObject({ code: 'OPERATION_CONFLICT' });
    await b.close();
  });

  it('claims a scheduled slot once, and never the same slot again across a restart', async () => {
    const a = startProcess('a');
    await enroll(a, instanceId);
    const first = await cycle(a, [instanceId]);
    expect(first.claimsMade).toBe(1);
    expect(first.investigationsStarted).toBe(1);
    expect(a.investigations()).toBe(1);
    expect(first.runs[0]?.outcome).toBe('NO_ANOMALY');
    expect(first.runs[0]?.triggerRef).toBe('slot:0');
    await a.close();

    // A NEW process, same slot. Dedupe is durable, so nothing new is claimed and nothing runs.
    const b = startProcess('b');
    const again = await cycle(b, [instanceId]);
    expect(again.claimsMade).toBe(0);
    expect(b.investigations()).toBe(0);
    expect(again.runs[0]?.refusalReason).toBe('TRIGGER_NOT_DUE');
    expect(await countJao5RowsFor(admin, 'ambient_investigation_run', instanceId)).toBe(1);

    // The NEXT slot is claimable, and only one claim happens for it.
    b.clock.set(T0 + CADENCE_MS);
    const next = await cycle(b, [instanceId]);
    expect(next.claimsMade).toBe(1);
    expect(next.runs[0]?.triggerRef).toBe('slot:1');
    expect(await countJao5RowsFor(admin, 'ambient_investigation_run', instanceId)).toBe(2);
    await b.close();
  });

  it('collapses downtime into one claim rather than replaying every missed slot', async () => {
    const a = startProcess('a');
    await enroll(a, instanceId);
    await cycle(a, [instanceId]);
    await a.close();

    // Twenty intervals of downtime. A catch-up storm would mean twenty investigations here.
    const b = startProcess('b', T0 + 20 * CADENCE_MS);
    const resumed = await cycle(b, [instanceId]);
    expect(resumed.claimsMade).toBe(1);
    expect(b.investigations()).toBe(1);
    expect(resumed.runs[0]?.triggerRef).toBe('slot:20');
    // Two runs in total: the original and one collapsed catch-up, not twenty-one.
    expect(await countJao5RowsFor(admin, 'ambient_investigation_run', instanceId)).toBe(2);
    await b.close();
  });

  it('claims an approved event once, and refuses the replayed event after a restart', async () => {
    const a = startProcess('a');
    await enroll(a, instanceId, JAO5_EVENT_HEALTH_MONITOR.monitorId);
    const event = {
      eventId: 'jao5.event.durable.001',
      eventType: 'control-plane.system-health.changed.v1',
      occurredAt: '2026-08-25T09:05:00.000Z',
      sourcePosture: 'INJECTED_APPROVED_SHADOW_SIGNAL',
      scope: 'CONTROL_PLANE_SYSTEM_HEALTH',
      snapshot: SNAPSHOT,
    };
    const first = await cycle(a, [instanceId], { event });
    expect(first.claimsMade).toBe(1);
    expect(first.runs[0]?.triggerRef).toBe('jao5.event.durable.001');
    await a.close();

    const b = startProcess('b');
    const replay = await cycle(b, [instanceId], { event });
    expect(replay.claimsMade).toBe(0);
    expect(b.investigations()).toBe(0);
    expect(replay.runs[0]?.refusalReason).toBe('DUPLICATE_TRIGGER');
    expect(await countJao5RowsFor(admin, 'ambient_investigation_run', instanceId)).toBe(1);

    // A DIFFERENT event is a different identity and is claimable.
    const second = await cycle(b, [instanceId], {
      event: { ...event, eventId: 'jao5.event.durable.002' },
    });
    expect(second.claimsMade).toBe(1);
    await b.close();
  });

  it('refuses a wrong event type, a wrong scope and a malformed snapshot WITHOUT consuming a claim', async () => {
    const a = startProcess('a');
    await enroll(a, instanceId, JAO5_EVENT_HEALTH_MONITOR.monitorId);
    const base = {
      eventId: 'jao5.event.reject.001',
      eventType: 'control-plane.system-health.changed.v1',
      occurredAt: '2026-08-25T09:05:00.000Z',
      sourcePosture: 'INJECTED_APPROVED_SHADOW_SIGNAL',
      scope: 'CONTROL_PLANE_SYSTEM_HEALTH',
      snapshot: SNAPSHOT,
    };

    // A wrong event type or scope is refused by the closed literal in the request schema, BEFORE
    // the cycle evaluates a single monitor -- earlier and stronger than a per-run refusal, so the
    // cycle reports no runs at all.
    for (const [label, event] of [
      ['wrong type', { ...base, eventType: 'vendor.activated.v1' }],
      ['wrong scope', { ...base, scope: 'VENDOR_REGISTRY' }],
    ] as const) {
      const result = await cycle(a, [instanceId], { event });
      expect(result.runs, label).toHaveLength(0);
      expect(result.claimsMade, label).toBe(0);
      expect(a.investigations(), label).toBe(0);
    }

    // A well-formed envelope carrying a snapshot the canonical parser refuses IS evaluated, and is
    // refused per-run -- without consuming a claim or a budget unit.
    const malformed = await cycle(a, [instanceId], {
      event: { ...base, snapshot: { nope: true } },
    });
    expect(malformed.runs[0]?.refusalReason).toBe('EVENT_INVALID');
    expect(malformed.claimsMade).toBe(0);
    expect(a.investigations()).toBe(0);

    // Nothing was claimed and no budget was spent: a malformed signal cannot exhaust a window.
    expect(await countJao5RowsFor(admin, 'ambient_investigation_run', instanceId)).toBe(0);
    expect(await countJao5RowsFor(admin, 'ambient_budget_window', instanceId)).toBe(0);
    await a.close();
  });

  it('keeps the budget across a restart and never exceeds it under concurrency', async () => {
    const a = startProcess('a');
    await enroll(a, instanceId, JAO5_EVENT_HEALTH_MONITOR.monitorId);
    const windowStart = jao5BudgetWindowStart(T0, 3600);

    // The event monitor allows 6 per hour. Spend 4 in this process.
    for (let index = 0; index < 4; index += 1) {
      const result = await cycle(a, [instanceId], {
        event: {
          eventId: `jao5.event.budget.${String(index)}`,
          eventType: 'control-plane.system-health.changed.v1',
          occurredAt: '2026-08-25T09:05:00.000Z',
          sourcePosture: 'INJECTED_APPROVED_SHADOW_SIGNAL',
          scope: 'CONTROL_PLANE_SYSTEM_HEALTH',
          snapshot: SNAPSHOT,
        },
      });
      expect(result.claimsMade, String(index)).toBe(1);
    }
    expect(await a.store.countClaimedInWindow(instanceId, windowStart)).toBe(4);
    await a.close();

    // A NEW process does NOT get a fresh budget: restart is not a reset.
    const b = startProcess('b');
    expect(await b.store.countClaimedInWindow(instanceId, windowStart)).toBe(4);

    // Four concurrent claims against the two remaining units. Exactly two may win.
    const contenders = Array.from({ length: 4 }, (_unused, index) =>
      cycle(b, [instanceId], {
        event: {
          eventId: `jao5.event.race.${String(index)}`,
          eventType: 'control-plane.system-health.changed.v1',
          occurredAt: '2026-08-25T09:05:00.000Z',
          sourcePosture: 'INJECTED_APPROVED_SHADOW_SIGNAL',
          scope: 'CONTROL_PLANE_SYSTEM_HEALTH',
          snapshot: SNAPSHOT,
        },
      }),
    );
    const settled = await Promise.all(contenders);
    const claimed = settled.filter((one) => one.claimsMade === 1);
    expect(claimed).toHaveLength(2);
    expect(await b.store.countClaimedInWindow(instanceId, windowStart)).toBe(6);
    expect(await countJao5RowsFor(admin, 'ambient_investigation_run', instanceId)).toBe(6);
    for (const refused of settled.filter((one) => one.claimsMade === 0)) {
      expect(refused.runs[0]?.refusalReason).toBe('BUDGET_EXHAUSTED');
    }
    await b.close();
  });

  it('lets exactly one of two concurrent processes claim the same event', async () => {
    const setup = startProcess('setup');
    await enroll(setup, instanceId, JAO5_EVENT_HEALTH_MONITOR.monitorId);
    await setup.close();

    const one = startProcess('race-1');
    const two = startProcess('race-2');
    const event = {
      eventId: 'jao5.event.contended',
      eventType: 'control-plane.system-health.changed.v1',
      occurredAt: '2026-08-25T09:05:00.000Z',
      sourcePosture: 'INJECTED_APPROVED_SHADOW_SIGNAL',
      scope: 'CONTROL_PLANE_SYSTEM_HEALTH',
      snapshot: SNAPSHOT,
    };
    const [first, second] = await Promise.all([
      cycle(one, [instanceId], { event }),
      cycle(two, [instanceId], { event }),
    ]);

    const winners = [first, second].filter((one_) => one_.claimsMade === 1);
    expect(winners).toHaveLength(1);
    expect(one.investigations() + two.investigations()).toBe(1);
    expect(await countJao5RowsFor(admin, 'ambient_investigation_run', instanceId)).toBe(1);
    await Promise.all([one.close(), two.close()]);
  });

  it('lets exactly one of two concurrent processes claim the same scheduled slot', async () => {
    const setup = startProcess('setup');
    await enroll(setup, instanceId);
    await setup.close();

    const one = startProcess('slot-1');
    const two = startProcess('slot-2');
    const [first, second] = await Promise.all([cycle(one, [instanceId]), cycle(two, [instanceId])]);

    expect([first, second].filter((one_) => one_.claimsMade === 1)).toHaveLength(1);
    expect(one.investigations() + two.investigations()).toBe(1);
    expect(await countJao5RowsFor(admin, 'ambient_investigation_run', instanceId)).toBe(1);
    await Promise.all([one.close(), two.close()]);
  });

  it('kills terminally: killed before claim means zero investigations, forever', async () => {
    const a = startProcess('a');
    await enroll(a, instanceId);
    const enrolled = await a.store.readMonitorInstance(instanceId);

    const killed = await killJao5Monitor(
      {
        operationId: `${instanceId}.kill`,
        monitorInstanceId: instanceId,
        expectedRevision: enrolled.revision,
      },
      { store: a.store, clock: a.clock },
    );
    expect(killed.committedStatus).toBe('KILLED');

    const afterKill = await cycle(a, [instanceId]);
    expect(afterKill.claimsMade).toBe(0);
    expect(a.investigations()).toBe(0);
    expect(afterKill.runs[0]?.refusalReason).toBe('MONITOR_KILLED');
    await a.close();

    // A NEW process, a later slot, and it is still killed. There is no unkill to call.
    const b = startProcess('b', T0 + 5 * CADENCE_MS);
    const later = await cycle(b, [instanceId]);
    expect(later.runs[0]?.refusalReason).toBe('MONITOR_KILLED');
    expect(b.investigations()).toBe(0);
    expect((await b.store.readMonitorInstance(instanceId)).status).toBe('KILLED');
    expect(await countJao5RowsFor(admin, 'ambient_investigation_run', instanceId)).toBe(0);
    await b.close();
  });

  it('lets an already-claimed investigation finish, and blocks every claim after the kill', async () => {
    const a = startProcess('a');
    await enroll(a, instanceId);

    // A claim commits first; the kill lands after it. The claimed read-only shadow investigation
    // already finished -- a kill cannot undo work that has started.
    const claimed = await cycle(a, [instanceId]);
    expect(claimed.claimsMade).toBe(1);
    expect(claimed.runs[0]?.outcome).toBe('NO_ANOMALY');

    const current = await a.store.readMonitorInstance(instanceId);
    await killJao5Monitor(
      {
        operationId: `${instanceId}.kill.after`,
        monitorInstanceId: instanceId,
        expectedRevision: current.revision,
      },
      { store: a.store, clock: a.clock },
    );

    a.clock.advance(CADENCE_MS);
    const blocked = await cycle(a, [instanceId]);
    expect(blocked.runs[0]?.refusalReason).toBe('MONITOR_KILLED');
    expect(a.investigations()).toBe(1);
    // The finalized run stays exactly as it was: killing does not rewrite history.
    expect(await countJao5RowsFor(admin, 'ambient_investigation_run', instanceId)).toBe(1);
    await a.close();
  });

  it('replays an identical kill and refuses a stale revision', async () => {
    const a = startProcess('a');
    await enroll(a, instanceId);
    const enrolled = await a.store.readMonitorInstance(instanceId);
    const input = {
      operationId: `${instanceId}.kill`,
      monitorInstanceId: instanceId,
      expectedRevision: enrolled.revision,
    };
    const first = await killJao5Monitor(input, { store: a.store, clock: a.clock });
    await a.close();

    const b = startProcess('b');
    b.clock.advance(HOUR);
    const replay = await killJao5Monitor(input, { store: b.store, clock: b.clock });
    expect(replay.replayed).toBe(true);
    expect({ ...replay, replayed: false }).toStrictEqual({ ...first, replayed: false });

    await expect(
      killJao5Monitor(
        {
          operationId: `${instanceId}.kill.other`,
          monitorInstanceId: instanceId,
          expectedRevision: 1,
        },
        { store: b.store, clock: b.clock },
      ),
    ).resolves.toMatchObject({ committedStatus: 'KILLED' });
    await b.close();
  });

  it('keeps quieting across a restart, and releases at exactly quietUntil', async () => {
    // An attention outcome quiets for 1800s.
    const a = startProcess('a', T0, 'ATTENTION');
    await enroll(a, instanceId);
    const first = await cycle(a, [instanceId]);
    expect(first.runs[0]?.outcome).toBe('ATTENTION_CREATED');
    expect(first.attentionCreated).toBe(1);
    const quieted = await a.store.readMonitorInstance(instanceId);
    expect(quieted.status).toBe('QUIETED');
    expect(quieted.quietUntil).toBe('2026-08-25T09:30:00.000Z');
    await a.close();

    // A NEW process cannot claim while quieted, even at the next cadence slot.
    const b = startProcess('b', T0 + CADENCE_MS);
    const duringQuiet = await cycle(b, [instanceId]);
    expect(duringQuiet.runs[0]?.refusalReason).toBe('MONITOR_QUIETED');
    expect(b.investigations()).toBe(0);

    // At exactly quietUntil it is eligible again.
    b.clock.set(Date.parse('2026-08-25T09:30:00.000Z'));
    const afterQuiet = await cycle(b, [instanceId]);
    expect(afterQuiet.claimsMade).toBe(1);
    await b.close();
  });

  it('keeps expiry across a restart, and refuses at exactly expiresAt', async () => {
    const a = startProcess('a');
    await enroll(a, instanceId, JAO5_SCHEDULED_HEALTH_MONITOR.monitorId, 3600);
    await a.close();

    const b = startProcess('b', T0 + 3600 * 1_000 - 1);
    const before = await cycle(b, [instanceId]);
    expect(before.claimsMade).toBe(1);

    // At exactly expiry, no claim. The row is untouched -- no sweeper rewrote it.
    b.clock.set(T0 + 3600 * 1_000);
    const atExpiry = await cycle(b, [instanceId]);
    expect(atExpiry.runs[0]?.refusalReason).toBe('MONITOR_EXPIRED');
    expect((await b.store.readMonitorInstance(instanceId)).status).not.toBe('EXPIRED');
    await b.close();
  });

  it('survives a crash between claim and finalize without ever repeating the trigger', async () => {
    const a = startProcess('a');
    await enroll(a, instanceId, JAO5_EVENT_HEALTH_MONITOR.monitorId);

    // Simulate the crash: take the claim directly and never finalize it.
    const claim = await a.store.claimAmbientRun(
      {
        monitorInstanceId: instanceId,
        ambientRunId: `${instanceId}.crashed`,
        jao1RunId: `${instanceId}.crashed.jao1`,
        cycleRunId: `${instanceId}.crashed.cycle`,
        triggerKind: 'APPROVED_EVENT',
        triggerRef: 'jao5.event.crash',
        dedupeKey: `event:${instanceId}:jao5.event.crash`,
        scheduledSlot: null,
        eventId: 'jao5.event.crash',
        definitionDigest: jao5DefinitionDigest(JAO5_EVENT_HEALTH_MONITOR),
        budgetWindowSeconds: 3600,
        maxInvestigationsPerWindow: 6,
      },
      a.clock.nowMs(),
    );
    expect(claim.ambientRunId).toBe(`${instanceId}.crashed`);
    await a.close();

    const b = startProcess('b');
    const runs = await b.store.listAmbientRuns(instanceId);
    // The claim is durable and still CLAIMED. No sweeper resurrected or retried it.
    expect(runs).toHaveLength(1);
    expect(runs[0]?.status).toBe('CLAIMED');
    // The budget stays consumed, because external work may already have begun and nothing here can
    // know whether it did.
    expect(await b.store.countClaimedInWindow(instanceId, jao5BudgetWindowStart(T0, 3600))).toBe(1);

    // And the same trigger identity does NOT run again.
    const retry = await cycle(b, [instanceId], {
      event: {
        eventId: 'jao5.event.crash',
        eventType: 'control-plane.system-health.changed.v1',
        occurredAt: '2026-08-25T09:05:00.000Z',
        sourcePosture: 'INJECTED_APPROVED_SHADOW_SIGNAL',
        scope: 'CONTROL_PLANE_SYSTEM_HEALTH',
        snapshot: SNAPSHOT,
      },
    });
    expect(retry.claimsMade).toBe(0);
    expect(retry.runs[0]?.refusalReason).toBe('DUPLICATE_TRIGGER');
    expect(b.investigations()).toBe(0);
    await b.close();
  });

  it('finalizes exactly once and refuses to rewrite a committed result', async () => {
    const a = startProcess('a');
    await enroll(a, instanceId);
    await cycle(a, [instanceId]);
    const runs = await a.store.listAmbientRuns(instanceId);
    expect(runs[0]?.status).toBe('FINALIZED');

    await expect(
      a.store.finalizeAmbientRun(
        {
          ambientRunId: runs[0]?.ambientRunId ?? '',
          outcome: 'ATTENTION_CREATED',
          refusalCode: null,
          attentionPresent: true,
          capabilityCalls: 1,
          modelCalls: 1,
          quietUntilMs: null,
        },
        a.clock.nowMs(),
      ),
    ).rejects.toMatchObject({ code: 'CLAIM_ALREADY_FINALIZED' });

    const unchanged = await a.store.listAmbientRuns(instanceId);
    expect(unchanged[0]?.outcome).toBe('NO_ANOMALY');
    expect(unchanged[0]?.attentionPresent).toBe(false);

    await expect(
      a.store.finalizeAmbientRun(
        {
          ambientRunId: 'jao5.run.never-claimed',
          outcome: 'NO_ANOMALY',
          refusalCode: null,
          attentionPresent: false,
          capabilityCalls: 0,
          modelCalls: 0,
          quietUntilMs: null,
        },
        a.clock.nowMs(),
      ),
    ).rejects.toMatchObject({ code: 'CLAIM_NOT_FOUND' });
    await a.close();
  });

  it('persists governance metadata only -- no snapshot, attention or model content', async () => {
    const a = startProcess('a', T0, 'ATTENTION');
    await enroll(a, instanceId);
    const result = await cycle(a, [instanceId]);
    expect(result.runs[0]?.outcome).toBe('ATTENTION_CREATED');
    await a.close();

    const { withClient } = await import('@qf-jarvis/event-backbone');
    const dump = await withClient(admin, async (client) => {
      const rows = await client.query<Record<string, unknown>>(
        `SELECT * FROM ${JAO5_TEST_SCHEMA}.ambient_investigation_run WHERE monitor_instance_id = $1`,
        [instanceId],
      );
      return JSON.stringify(rows.rows);
    });

    // The attention body, its recommended next step, the snapshot and every component detail stay
    // out of the database. Only the fact that attention existed is recorded.
    for (const content of [
      'Jarvis API degraded',
      'One component reports degraded',
      'Inspect the Jarvis API health evidence',
      'jarvis-api',
      'contractVersion',
      'SHADOW_OPERATIONAL_ATTENTION',
    ]) {
      expect(dump, content).not.toContain(content);
    }
    expect(dump).toContain('attention_present');
    expect(dump).toContain('true');
  });

  it('touches only its own schema, and needs no managed migration', async () => {
    const { withClient } = await import('@qf-jarvis/event-backbone');
    const schemas = await withClient(admin, async (client) => {
      const found = await client.query<{ readonly schema_name: string }>(
        `SELECT schema_name FROM information_schema.schemata WHERE schema_name LIKE 'qf_jarvis%' ORDER BY schema_name`,
      );
      return found.rows.map((row) => row.schema_name);
    });
    // JAO-5 created its own schema. It did not create, need or touch the managed one.
    expect(schemas).toContain(JAO5_TEST_SCHEMA);
    expect(schemas).not.toContain('qf_jarvis');
    expect(schemas).not.toContain('qf_jarvis_jao3');
  });

  it('refuses a persisted row that no longer satisfies the contract', async () => {
    const a = startProcess('a');
    await enroll(a, instanceId);

    await forceJao5RawUpdate(
      admin,
      `ALTER TABLE ${JAO5_TEST_SCHEMA}.ambient_monitor_instance DROP CONSTRAINT ambient_monitor_instance_mode_shadow`,
      [],
    );
    await forceJao5RawUpdate(
      admin,
      `UPDATE ${JAO5_TEST_SCHEMA}.ambient_monitor_instance SET mode = 'PRODUCTION' WHERE monitor_instance_id = $1`,
      [instanceId],
    );

    // Schema drift from the adapter's side. The answer is a refusal, never a plausible-looking
    // object assembled from a row nobody checked.
    await expect(a.store.readMonitorInstance(instanceId)).rejects.toMatchObject({
      code: 'STORE_FAILED',
    });
    await a.close();

    await forceJao5RawUpdate(
      admin,
      `UPDATE ${JAO5_TEST_SCHEMA}.ambient_monitor_instance SET mode = 'SHADOW' WHERE monitor_instance_id = $1`,
      [instanceId],
    );
    await forceJao5RawUpdate(
      admin,
      `ALTER TABLE ${JAO5_TEST_SCHEMA}.ambient_monitor_instance ADD CONSTRAINT ambient_monitor_instance_mode_shadow CHECK (mode = 'SHADOW')`,
      [],
    );
  });

  it('gives a PUBLIC caller no way to substitute the investigator', async () => {
    // The JAO-4 owner-review lesson, measured rather than declared. A public investigator callback
    // would let a caller replace the thing every gate exists to govern, and the containment specs
    // -- which read this source tree -- cannot read a function supplied from outside it.
    //
    // Proved BEHAVIOURALLY: a hostile investigator is forced into the public runner through a
    // deliberate cast, because a type-level proof alone would survive a mutation (Vitest strips
    // types) and would therefore prove nothing about what actually runs.
    const a = startProcess('pin');
    await enroll(a, instanceId);

    let hostileInvocations = 0;
    const hostile: Jao5Investigator = async (input) => {
      hostileInvocations += 1;
      return Promise.resolve(
        jao1RunResultSchema.parse({
          runId: input.runId,
          outcome: 'NO_ANOMALY' as const,
          refusalReason: null,
          snapshotRef: 'control-plane:hostile',
          evidenceRefs: [],
          anomaly: null,
          attention: null,
          modelProvenance: null,
          capabilityCalls: 0,
          modelCalls: 0,
          taskType: 'jarvis.operations.shadow-health-investigation' as const,
          autonomyLevel: 'L1_READ' as const,
          capabilitiesInvoked: [],
          durationMs: 1,
        }),
      );
    };

    const gateway = new CountingGateway();
    const smuggled = {
      store: a.store,
      clock: a.clock,
      gateway,
      investigate: hostile,
    } as unknown as Parameters<typeof runJao5AmbientCycle>[1];

    const result = await runJao5AmbientCycle(
      {
        cycleId: 'jao5.cycle.pinning',
        runId: 'jao5.run.pinning',
        mode: 'SHADOW',
        monitorInstanceIds: [instanceId],
        snapshot: DEGRADED_SNAPSHOT,
      },
      smuggled,
    );

    // THE MEASUREMENT. The hostile investigator was handed to the public runner and did not run.
    expect(hostileInvocations).toBe(0);
    // The CANONICAL JAO-1 path ran instead: one capability call, one governed model call, and the
    // model call went through the QF Model Gateway -- the only model path JAO-5 has.
    expect(result.claimsMade).toBe(1);
    expect(result.runs[0]?.outcome).toBe('ATTENTION_CREATED');
    expect(result.runs[0]?.capabilityCalls).toBe(1);
    expect(result.runs[0]?.modelCalls).toBe(1);
    expect(gateway.calls).toBe(1);
    // The hostile investigator reported zero capability calls, so a non-zero count could only have
    // come from the canonical composition.
    expect(result.businessEffect).toBe(false);
    expect(result.coreMutations).toBe(0);
    expect(result.executionIntentsCreated).toBe(0);
    expect(result.channelSends).toBe(0);
    await a.close();
  });

  it('re-checks the kill under the row lock, closing the window between check and claim', async () => {
    // The TOCTOU window: a cycle reads the monitor, the kill commits, and the claim transaction
    // then runs. The cycle's own pre-check has already passed, so the ONLY thing that can refuse
    // is the re-check under the lock -- which is why this test calls the store directly rather
    // than going through the cycle.
    const a = startProcess('toctou');
    await enroll(a, instanceId);
    const beforeKill = await a.store.readMonitorInstance(instanceId);
    expect(beforeKill.status).toBe('ACTIVE');

    await killJao5Monitor(
      {
        operationId: `${instanceId}.kill.toctou`,
        monitorInstanceId: instanceId,
        expectedRevision: beforeKill.revision,
      },
      { store: a.store, clock: a.clock },
    );

    // The claim now arrives holding a pre-check that was true when it was taken.
    await expect(
      a.store.claimAmbientRun(
        {
          monitorInstanceId: instanceId,
          ambientRunId: `${instanceId}.toctou`,
          jao1RunId: `${instanceId}.toctou.jao1`,
          cycleRunId: `${instanceId}.toctou.cycle`,
          triggerKind: 'SCHEDULED_INTERVAL',
          triggerRef: 'slot:0',
          dedupeKey: `slot:${instanceId}:0`,
          scheduledSlot: 0,
          eventId: null,
          definitionDigest: jao5DefinitionDigest(JAO5_SCHEDULED_HEALTH_MONITOR),
          budgetWindowSeconds: 3600,
          maxInvestigationsPerWindow: 4,
        },
        a.clock.nowMs(),
      ),
    ).rejects.toMatchObject({ code: 'MONITOR_KILLED' });

    // Nothing was claimed and no budget was spent.
    expect(await countJao5RowsFor(admin, 'ambient_investigation_run', instanceId)).toBe(0);
    expect(await countJao5RowsFor(admin, 'ambient_budget_window', instanceId)).toBe(0);

    // The same is true of expiry and quieting: the claim transaction re-checks all of them.
    const other = anInstanceId();
    await enroll(a, other, JAO5_SCHEDULED_HEALTH_MONITOR.monitorId, 3600);
    a.clock.set(T0 + 3600 * 1_000);
    await expect(
      a.store.claimAmbientRun(
        {
          monitorInstanceId: other,
          ambientRunId: `${other}.expired`,
          jao1RunId: `${other}.expired.jao1`,
          cycleRunId: `${other}.expired.cycle`,
          triggerKind: 'SCHEDULED_INTERVAL',
          triggerRef: 'slot:4',
          dedupeKey: `slot:${other}:4`,
          scheduledSlot: 4,
          eventId: null,
          definitionDigest: jao5DefinitionDigest(JAO5_SCHEDULED_HEALTH_MONITOR),
          budgetWindowSeconds: 3600,
          maxInvestigationsPerWindow: 4,
        },
        a.clock.nowMs(),
      ),
    ).rejects.toMatchObject({ code: 'MONITOR_EXPIRED' });
    await a.close();
  });

  it('reports store uncertainty as a store failure, never as a governance refusal', async () => {
    // THE rule that matters most. A cycle that cannot reach PostgreSQL must not record
    // `TRIGGER_NOT_DUE` -- a reader would believe governance had spoken when nothing had.
    const dead = startProcess('dead');
    await dead.close();
    const result = await cycle(dead, ['jao5.instance.absent']);
    expect(result.runs[0]?.refusalReason).toBe('STORE_FAILED');
    expect(result.claimsMade).toBe(0);

    const live = startProcess('live');
    const missing = await cycle(live, ['jao5.instance.absent']);
    expect(missing.runs[0]?.refusalReason).toBe('MONITOR_NOT_ENROLLED');
    await live.close();
  });
});
