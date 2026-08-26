/**
 * JAO-7 advanced governed autonomy, against a real PostgreSQL (ADR-0121).
 *
 * This is the suite the slice exists for. JAO-7's central claim is that a long-running autonomous
 * mission survives a restart with its budgets, its kill switch, its expiry, its plan, its authority
 * observation and its virtual sandbox intact — and an in-memory store passes every test that never
 * opens a connection.
 *
 * ### What a "process" means here
 *
 * Each lettered process builds a brand new pool, a brand new store and a brand new composition, and
 * closes the pool before the next begins. No object, closure or cache survives the boundary, so
 * anything that comes back came out of the database.
 *
 * ### The Core artifacts come from outside, because they must
 *
 * Every run that moves past the authority gate is handed an `ApprovalDecisionV1` and an
 * `ExecutionIntentV1` built by the fixtures. JAO-7 cannot build either, has no Core transport to
 * fetch one from and no n8n client to hand one to — which is exactly the property under test.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  advanceJao7AutonomyRunInternal,
  createJao7AutonomyRunInternal,
  killJao7AutonomyRunInternal,
  pauseJao7AutonomyRunInternal,
  readJao7AutonomyRunInternal,
  resumeJao7AutonomyRunInternal,
  type Jao7InternalComposition,
} from '../jao/advanced-governed-autonomy/coordinator.js';
import { createJao7PostgresStore } from '../jao/advanced-governed-autonomy/postgres-store.js';
import { createJao7MissionRegistry } from '../jao/advanced-governed-autonomy/mission-registry.js';
import type { Jao7Proposal } from '../jao/advanced-governed-autonomy/proposal.js';
import type { Jao7AutonomyResult } from '../jao/advanced-governed-autonomy/index.js';

import {
  SteppableClock,
  advanceRequest,
  approvalDecision,
  capacityRequest,
  executionIntent,
} from './jao7-fixtures.js';
import {
  JAO7_TEST_SCHEMA,
  applyJao7Schema,
  closeDatabasePool,
  countJao7RowsFor,
  createJao7TestPool,
  dumpJao7Run,
  jao7ColumnNames,
  readJao7SchemaSql,
  resetJao7Schema,
  type DatabasePool,
} from './jao7-database-harness.js';

const MISSION_A = 'jao7.client-sales-stall-remediation';
const MISSION_B = 'jao7.synthetic-capacity-remediation';

/** Steps from creation to the authority gate, per mission. The plans differ by two evidence steps. */
const STEPS_TO_GATE: Readonly<Record<string, number>> = Object.freeze({
  [MISSION_A]: 4,
  [MISSION_B]: 5,
});

interface Process {
  readonly pool: DatabasePool;
  readonly clock: SteppableClock;
  readonly composition: Jao7InternalComposition;
  close: () => Promise<void>;
}

/** A whole new "process": pool, store, clock, composition. Nothing survives the boundary. */
function startProcess(name: string): Process {
  const pool = createJao7TestPool(`qf-jarvis-jao7-${name}`);
  const clock = new SteppableClock();
  return {
    pool,
    clock,
    composition: {
      store: createJao7PostgresStore(pool),
      clock,
      registry: createJao7MissionRegistry(),
    },
    close: async (): Promise<void> => {
      await closeDatabasePool(pool);
    },
  };
}

type RequestBuilder = (
  operationId: string,
  over?: Record<string, unknown>,
) => Record<string, unknown>;

function builderFor(mission: string, runId: string): RequestBuilder {
  return mission === MISSION_A
    ? (operationId, over = {}): Record<string, unknown> => advanceRequest(runId, operationId, over)
    : (operationId, over = {}): Record<string, unknown> =>
        capacityRequest(runId, operationId, over);
}

async function createRun(
  process: Process,
  runId: string,
  mission: string,
): Promise<Jao7AutonomyResult> {
  return createJao7AutonomyRunInternal(
    {
      runId,
      operationId: `${runId}.create`,
      missionPolicyId: mission,
      missionPolicyVersion: 1,
      subject:
        mission === MISSION_A
          ? { entityType: 'client', entityId: 'client.42' }
          : { entityType: 'capacity-pool', entityId: 'synthetic-pool-alpha' },
      ...(mission === MISSION_B ? { initialConcurrency: 8 } : {}),
    },
    process.composition,
  );
}

/**
 * Drive a mission to its authority gate, CARRYING the proposal the run handed back.
 *
 * The artifacts are not rebuilt anywhere in this file. The proposal step returns them in memory, the
 * caller holds them exactly as Core would hold the submitted recommendation, and every later step
 * passes them back to be checked against the run's durable binding.
 */
async function driveToGate(
  process: Process,
  runId: string,
  mission: string,
): Promise<{ readonly latest: Jao7AutonomyResult; readonly proposal: Jao7Proposal }> {
  const build = builderFor(mission, runId);
  let latest: Jao7AutonomyResult | undefined;
  let proposal: Jao7Proposal | undefined;
  for (let step = 0; step < (STEPS_TO_GATE[mission] ?? 0); step += 1) {
    latest = await advanceJao7AutonomyRunInternal(
      build(`${runId}.step${String(step)}`),
      process.composition,
    );
    if (latest.proposal !== null && latest.proposal !== undefined) {
      proposal = latest.proposal as Jao7Proposal;
    }
  }
  if (latest === undefined || proposal === undefined) {
    throw new Error('expected a proposal on the way to the authority gate');
  }
  return { latest, proposal };
}

/** Correlate externally issued Core artifacts, carrying the proposal back with them. */
async function correlateAuthority(
  process: Process,
  runId: string,
  mission: string,
  proposal: Jao7Proposal,
  over: Record<string, unknown> = {},
): Promise<Jao7AutonomyResult> {
  const decision = approvalDecision(proposal);
  return resumeJao7AutonomyRunInternal(
    builderFor(mission, runId)(`${runId}.authority`, {
      proposal,
      authority: {
        approvalDecision: decision,
        executionIntent: executionIntent(proposal, decision),
      },
      ...over,
    }),
    process.composition,
  );
}

let admin: DatabasePool;
let counter = 0;

function aRunId(): string {
  counter += 1;
  return `jao7.run.${String(counter).padStart(6, '0')}`;
}

beforeAll(async () => {
  admin = createJao7TestPool('qf-jarvis-jao7-admin');
  await resetJao7Schema(admin);
}, 60_000);

afterAll(async () => {
  await closeDatabasePool(admin);
});

describe('JAO-7 durable advanced autonomy', () => {
  let runId: string;

  beforeEach(() => {
    runId = aRunId();
  });

  // =========================================================================
  // S. The schema itself.
  // =========================================================================

  it('S1 applies the local schema cleanly, and applies again without damage', async () => {
    await applyJao7Schema(admin);
    const { withClient } = await import('@qf-jarvis/event-backbone');
    const tables = await withClient(admin, async (client) => {
      const found = await client.query<{ readonly table_name: string }>(
        `SELECT table_name FROM information_schema.tables WHERE table_schema = $1 ORDER BY table_name`,
        [JAO7_TEST_SCHEMA],
      );
      return found.rows.map((row) => row.table_name);
    });
    expect(tables).toStrictEqual([
      'authority_observation',
      'autonomy_evaluation',
      'autonomy_operation_replay',
      'autonomy_run',
      'autonomy_step',
      'virtual_rehearsal_state',
    ]);
    await applyJao7Schema(admin);
    expect(readJao7SchemaSql()).toContain('qf_jarvis_jao7');
  });

  it('S2 declares no column that could hold a reusable permission or a business record', async () => {
    const columns = await jao7ColumnNames(admin);
    for (const forbidden of [
      'approved',
      'can_execute',
      'is_authorized',
      'send_allowed',
      'authorization',
      'approval_decision',
      'execution_intent',
      'payload',
      'body',
      'transcript',
      'prompt',
      'credential',
      'token',
      'phone',
      'email',
      'recipient',
    ]) {
      expect(columns, forbidden).not.toContain(forbidden);
    }
    // What it DOES hold about authority is digests and identities.
    expect(columns).toContain('approval_decision_digest');
    expect(columns).toContain('execution_intent_digest');
    expect(columns).toContain('action_fingerprint');
  });

  // =========================================================================
  // D. Durable creation, replay and compare-and-set.
  // =========================================================================

  it('D1 creates a durable run and captures the sandbox before anything can apply', async () => {
    const a = startProcess('a');
    const created = await createRun(a, runId, MISSION_B);
    expect(created.state).toBe('PLANNED');
    expect(created.revision).toBe(1);
    expect(created.planDigest).toMatch(/^[0-9a-f]{64}$/u);
    expect(created.rehearsal?.state).toBe('CAPTURED');
    expect(created.rehearsal?.beforeIntegerA).toBe(8);
    expect(created.rehearsal?.afterIntegerA).toBeNull();
    await a.close();

    // A NEW process. Nothing but the database survives.
    const b = startProcess('b');
    const read = await readJao7AutonomyRunInternal(runId, b.composition);
    expect(read.planDigest).toBe(created.planDigest);
    expect(read.missionPolicyDigest).toBe(created.missionPolicyDigest);
    expect(read.rehearsal?.beforeIntegerA).toBe(8);
    await b.close();
  });

  it('D2 replays an identical create and refuses the same id meaning something else', async () => {
    const a = startProcess('a');
    const first = await createRun(a, runId, MISSION_B);
    const replay = await createRun(a, runId, MISSION_B);
    expect(replay.revision).toBe(first.revision);
    expect(await countJao7RowsFor(a.pool, 'autonomy_operation_replay', runId)).toBe(1);

    // The SAME operation id meaning something else is refused, with zero writes.
    await expect(
      createJao7AutonomyRunInternal(
        {
          runId,
          operationId: `${runId}.create`,
          missionPolicyId: MISSION_B,
          missionPolicyVersion: 1,
          subject: { entityType: 'capacity-pool', entityId: 'synthetic-pool-beta' },
          initialConcurrency: 8,
        },
        a.composition,
      ),
    ).rejects.toMatchObject({ code: 'OPERATION_CONFLICT' });
    expect(await countJao7RowsFor(a.pool, 'autonomy_operation_replay', runId)).toBe(1);
    await a.close();
  });

  it('D3 refuses a second run under the same identity', async () => {
    const a = startProcess('a');
    await createRun(a, runId, MISSION_B);
    await expect(
      createJao7AutonomyRunInternal(
        {
          runId,
          operationId: `${runId}.other`,
          missionPolicyId: MISSION_B,
          missionPolicyVersion: 1,
          subject: { entityType: 'capacity-pool', entityId: 'synthetic-pool-alpha' },
          initialConcurrency: 8,
        },
        a.composition,
      ),
    ).rejects.toMatchObject({ code: 'RUN_ALREADY_EXISTS' });
    await a.close();
  });

  it('D4 refuses an unknown mission, a wrong version and a disallowed subject', async () => {
    const a = startProcess('a');
    const base = {
      runId,
      operationId: `${runId}.create`,
      subject: { entityType: 'capacity-pool', entityId: 'synthetic-pool-alpha' },
      initialConcurrency: 8,
    };
    await expect(
      createJao7AutonomyRunInternal(
        { ...base, missionPolicyId: 'jao7.not-a-mission', missionPolicyVersion: 1 },
        a.composition,
      ),
    ).rejects.toMatchObject({ code: 'MISSION_UNKNOWN' });
    await expect(
      createJao7AutonomyRunInternal(
        { ...base, missionPolicyId: MISSION_B, missionPolicyVersion: 9 },
        a.composition,
      ),
    ).rejects.toMatchObject({ code: 'MISSION_VERSION_MISMATCH' });
    await expect(
      createJao7AutonomyRunInternal(
        {
          ...base,
          missionPolicyId: MISSION_B,
          missionPolicyVersion: 1,
          subject: { entityType: 'client', entityId: 'client.1' },
        },
        a.composition,
      ),
    ).rejects.toMatchObject({ code: 'SUBJECT_NOT_ALLOWED' });
    // Nothing was written by any of them.
    await expect(readJao7AutonomyRunInternal(runId, a.composition)).rejects.toMatchObject({
      code: 'RUN_NOT_FOUND',
    });
    await a.close();
  });

  // =========================================================================
  // W. The whole control loop, across separate processes.
  // =========================================================================

  it('W1 runs the capacity mission end to end across four separate processes', async () => {
    // ---- PROCESS A: create, validate, gather evidence, analyse, propose, await authority. -------
    const a = startProcess('a');
    const created = await createRun(a, runId, MISSION_B);
    const { latest, proposal } = await driveToGate(a, runId, MISSION_B);

    expect(latest.state).toBe('AWAITING_AUTHORITY');
    expect(latest.outcome).toBe('AWAITING_AUTHORITY');
    expect(latest.toolCalls).toBe(1);
    expect(latest.specialistCalls).toBe(0);
    expect(latest.modelCalls).toBe(0);
    expect(latest.authorityObservation).toBeNull();
    // The capacity target was COMPUTED, not supplied: 8 saturated with a low error rate becomes 9.
    expect(proposal.recommendation.proposedActions[0]?.parameters).toMatchObject({
      currentConcurrency: 8,
      targetConcurrency: 9,
    });
    await a.close();

    // ---- PROCESS B: resume WITH externally issued Core artifacts, then rehearse. ----------------
    const b = startProcess('b');
    const correlated = await correlateAuthority(b, runId, MISSION_B, proposal);
    expect(correlated.state).toBe('AUTHORITY_EVIDENCE_VALIDATED_FOR_REHEARSAL');
    expect(correlated.authorityObservation?.observationCode).toBe(
      'CORRELATED_APPROVED_ACTION_AND_INTENT',
    );
    expect(correlated.authorityObservation?.actionFingerprint).toBe(
      proposal.actionBindings[0].actionFingerprint,
    );

    const applied = await advanceJao7AutonomyRunInternal(
      capacityRequest(runId, `${runId}.rehearse`, { proposal }),
      b.composition,
    );
    expect(applied.state).toBe('REHEARSAL_APPLIED');
    expect(applied.rehearsal?.state).toBe('APPLIED');
    // THE VIRTUAL EFFECT: one integer moved from 8 to 9. Nothing else changed, anywhere.
    expect(applied.rehearsal?.beforeIntegerA).toBe(8);
    expect(applied.rehearsal?.afterIntegerA).toBe(9);
    expect(applied.rehearsalApplies).toBe(1);
    expect(applied.posture.executionIntentExecuted).toBe(false);
    expect(applied.posture.n8nExecutions).toBe(0);
    await b.close();

    // ---- PROCESS C: a NEW process verifies and completes. ---------------------------------------
    const c = startProcess('c');
    const verified = await advanceJao7AutonomyRunInternal(
      capacityRequest(runId, `${runId}.verify`, { proposal }),
      c.composition,
    );
    expect(verified.rehearsal?.state).toBe('VERIFIED');
    const completed = await advanceJao7AutonomyRunInternal(
      capacityRequest(runId, `${runId}.complete`, { proposal }),
      c.composition,
    );
    expect(completed.state).toBe('COMPLETED');
    expect(completed.outcome).toBe('COMPLETED_REHEARSAL');
    await c.close();

    // ---- PROCESS D: a NEW process reads the audit trail. ----------------------------------------
    const d = startProcess('d');
    const final = await readJao7AutonomyRunInternal(runId, d.composition);
    expect(final.planDigest).toBe(created.planDigest);
    expect(final.missionPolicyDigest).toBe(created.missionPolicyDigest);
    expect(final.rehearsalApplies).toBe(1);
    expect(final.toolCalls).toBe(1);
    expect(final.modelCalls).toBe(0);
    // Every step appears exactly once, and every one is finalised.
    const indices = final.steps.map((step) => step.stepIndex);
    expect(new Set(indices).size).toBe(indices.length);
    expect(final.evaluations.length).toBeGreaterThanOrEqual(final.steps.length);
    for (const step of final.steps) {
      expect(step.stepStatus).not.toBe('CLAIMED');
    }
    expect(final.outcome).toBe('COMPLETED_REHEARSAL');
    expect(final.posture.rehearsalOnly).toBe(true);
    await d.close();
  });

  it('W2 runs the client-sales mission with exactly one Riya delegation', async () => {
    const a = startProcess('a');
    await createRun(a, runId, MISSION_A);
    const { latest, proposal } = await driveToGate(a, runId, MISSION_A);

    expect(latest.state).toBe('AWAITING_AUTHORITY');
    // EXACTLY ONE specialist call, charged durably inside the claim transaction.
    expect(latest.specialistCalls).toBe(1);
    expect(latest.toolCalls).toBe(0);
    expect(latest.modelCalls).toBe(0);
    // Riya advised; JARVIS concluded. Stamping a specialist here would claim otherwise.
    expect(proposal.recommendation.producingAgent).toBe('jarvis');
    expect(proposal.recommendation.producingAgentVersion).toBe('jarvis.jao7.v1');

    const correlated = await correlateAuthority(a, runId, MISSION_A, proposal);
    expect(correlated.authorityObservation?.observationCode).toBe(
      'CORRELATED_APPROVED_ACTION_AND_INTENT',
    );

    const applied = await advanceJao7AutonomyRunInternal(
      advanceRequest(runId, `${runId}.rehearse`, { proposal }),
      a.composition,
    );
    // The virtual task ledger: present, and BOUND to the exact approved action.
    expect(applied.rehearsal?.afterIntegerA).toBe(1);
    expect(applied.rehearsal?.afterIntegerB).toBe(
      Number.parseInt(proposal.actionBindings[0].actionFingerprint.slice(0, 8), 16) % 1_000_000,
    );

    const verified = await advanceJao7AutonomyRunInternal(
      advanceRequest(runId, `${runId}.verify`, { proposal }),
      a.composition,
    );
    expect(verified.rehearsal?.state).toBe('VERIFIED');
    const completed = await advanceJao7AutonomyRunInternal(
      advanceRequest(runId, `${runId}.complete`, { proposal }),
      a.composition,
    );
    expect(completed.outcome).toBe('COMPLETED_REHEARSAL');
    expect(completed.specialistCalls).toBe(1);
    await a.close();
  });

  // =========================================================================
  // R. Failed verification takes rollback.
  // =========================================================================

  it('R1 rolls the sandbox back to the captured state when verification fails', async () => {
    const a = startProcess('a');
    await createRun(a, runId, MISSION_B);
    const { proposal } = await driveToGate(a, runId, MISSION_B);
    await correlateAuthority(a, runId, MISSION_B, proposal);

    const applied = await advanceJao7AutonomyRunInternal(
      capacityRequest(runId, `${runId}.rehearse`, { proposal }),
      a.composition,
    );
    expect(applied.rehearsal?.afterIntegerA).toBe(9);

    // THE FAILURE FIXTURE. The observation is corrupted exactly as a partial failure would corrupt
    // it, and the verification cannot be talked into passing.
    const failed = await advanceJao7AutonomyRunInternal(
      capacityRequest(runId, `${runId}.verify`, { proposal, corruptRehearsalObservation: true }),
      a.composition,
    );
    expect(failed.rehearsal?.state).toBe('ROLLBACK_REQUIRED');
    expect(failed.state).toBe('ROLLING_BACK');

    const rolledBack = await advanceJao7AutonomyRunInternal(
      capacityRequest(runId, `${runId}.rollback`, { proposal }),
      a.composition,
    );
    expect(rolledBack.rehearsal?.state).toBe('ROLLED_BACK');
    // Restored to the CAPTURED before state, exactly. Not to something a caller chose.
    expect(rolledBack.rehearsal?.rollbackIntegerA).toBe(8);
    expect(rolledBack.outcome).toBe('ROLLED_BACK_REHEARSAL');
    expect(rolledBack.rehearsalApplies).toBe(1);
    // The recovery branch is in the audit trail under its own step type.
    expect(rolledBack.steps.some((step) => step.stepType === 'ROLLBACK_REHEARSAL')).toBe(true);
    await a.close();
  });

  it('R2 refuses a second rehearsal apply', async () => {
    const a = startProcess('a');
    await createRun(a, runId, MISSION_B);
    const { proposal } = await driveToGate(a, runId, MISSION_B);
    await correlateAuthority(a, runId, MISSION_B, proposal);
    await advanceJao7AutonomyRunInternal(
      capacityRequest(runId, `${runId}.rehearse`, { proposal }),
      a.composition,
    );

    // A second apply, through the RAW store, under a fresh operation id. A second apply over an
    // applied sandbox would make the captured BEFORE value a lie, and the rollback target with it.
    const view = await a.composition.store.readRun(runId);
    await expect(
      a.composition.store.mutateRehearsal(
        {
          runId,
          operationId: `${runId}.second-apply`,
          expectedRevision: view.run.revision,
          operationKind: 'APPLY_REHEARSAL',
          nextRehearsalState: 'APPLIED',
          afterIntegerA: 32,
          afterIntegerB: null,
          rollbackIntegerA: null,
          rollbackIntegerB: null,
          maxRehearsalApplies: 1,
        },
        a.clock.nowMs(),
      ),
    ).rejects.toMatchObject({ code: 'STATE_CONFLICT' });
    expect((await a.composition.store.readRun(runId)).rehearsal?.afterIntegerA).toBe(9);
    await a.close();
  });

  it('R3 survives a restart between rehearsal apply and verification', async () => {
    // The crash that matters most: synthetic state applied, nothing verified, process gone.
    const a = startProcess('a');
    await createRun(a, runId, MISSION_B);
    const { proposal } = await driveToGate(a, runId, MISSION_B);
    await correlateAuthority(a, runId, MISSION_B, proposal);
    await advanceJao7AutonomyRunInternal(
      capacityRequest(runId, `${runId}.rehearse`, { proposal }),
      a.composition,
    );
    await a.close();

    // A NEW process finds the applied sandbox exactly as it was left, and finishes the job.
    const b = startProcess('b');
    const resumedView = await readJao7AutonomyRunInternal(runId, b.composition);
    expect(resumedView.state).toBe('REHEARSAL_APPLIED');
    expect(resumedView.rehearsal?.state).toBe('APPLIED');
    expect(resumedView.rehearsal?.afterIntegerA).toBe(9);
    expect(resumedView.rehearsalApplies).toBe(1);

    const verified = await advanceJao7AutonomyRunInternal(
      capacityRequest(runId, `${runId}.verify`, { proposal }),
      b.composition,
    );
    expect(verified.rehearsal?.state).toBe('VERIFIED');
    await b.close();
  });

  // =========================================================================
  // K. Pause, kill and expiry.
  // =========================================================================

  it('K1 pauses durably and resumes only explicitly', async () => {
    const a = startProcess('a');
    await createRun(a, runId, MISSION_B);
    const paused = await pauseJao7AutonomyRunInternal(
      capacityRequest(runId, `${runId}.pause`),
      a.composition,
    );
    expect(paused.state).toBe('PAUSED');
    await a.close();

    // A NEW process still finds it paused, and advancing is refused.
    const b = startProcess('b');
    await expect(
      advanceJao7AutonomyRunInternal(capacityRequest(runId, `${runId}.try`), b.composition),
    ).rejects.toMatchObject({ code: 'RUN_PAUSED' });
    const resumed = await resumeJao7AutonomyRunInternal(
      capacityRequest(runId, `${runId}.resume`),
      b.composition,
    );
    expect(resumed.state).toBe('IN_PROGRESS');
    await b.close();
  });

  it('K2 kills terminally, and there is no unkill', async () => {
    const a = startProcess('a');
    await createRun(a, runId, MISSION_B);
    const killed = await killJao7AutonomyRunInternal(
      capacityRequest(runId, `${runId}.kill`),
      a.composition,
    );
    expect(killed.state).toBe('KILLED');
    expect(killed.outcome).toBe('KILLED');
    await a.close();

    // A NEW process: no forward work of any kind, and no resume.
    const b = startProcess('b');
    await expect(
      advanceJao7AutonomyRunInternal(capacityRequest(runId, `${runId}.after`), b.composition),
    ).rejects.toMatchObject({ code: 'RUN_KILLED' });
    await expect(
      resumeJao7AutonomyRunInternal(capacityRequest(runId, `${runId}.revive`), b.composition),
    ).rejects.toMatchObject({ code: 'RUN_KILLED' });
    expect((await readJao7AutonomyRunInternal(runId, b.composition)).state).toBe('KILLED');
    await b.close();
  });

  it('K2b refuses a stale revision even against an already-KILLED run', async () => {
    // The terminal path is where a compare-and-set is easiest to lose, because the early return for
    // an already-killed run is tempting to place ABOVE it. JAO-5's owner review found exactly that,
    // and this proves JAO-7 did not repeat it: the CAS runs first and always, so a NEW operation id
    // carrying a stale revision cannot report success and cannot write a replay record.
    const a = startProcess('a');
    await createRun(a, runId, MISSION_B);
    const created = await a.composition.store.readRun(runId);

    await a.composition.store.killRun(
      { runId, operationId: `${runId}.kill`, expectedRevision: created.run.revision },
      a.clock.nowMs(),
    );
    const replays = await countJao7RowsFor(a.pool, 'autonomy_operation_replay', runId);

    await expect(
      a.composition.store.killRun(
        { runId, operationId: `${runId}.kill-stale`, expectedRevision: created.run.revision },
        a.clock.nowMs(),
      ),
    ).rejects.toMatchObject({ code: 'REVISION_CONFLICT' });
    expect(await countJao7RowsFor(a.pool, 'autonomy_operation_replay', runId)).toBe(replays);

    // A NEW operation id at the CURRENT revision is a durable terminal no-op, and killedAt stands.
    const killed = await a.composition.store.readRun(runId);
    const noop = await a.composition.store.killRun(
      { runId, operationId: `${runId}.kill-again`, expectedRevision: killed.run.revision },
      a.clock.nowMs(),
    );
    expect(noop.committedState).toBe('KILLED');
    expect((await a.composition.store.readRun(runId)).run.killedAt).toBe(killed.run.killedAt);
    await a.close();
  });

  it('K3 blocks forward work after expiry', async () => {
    const a = startProcess('a');
    await createRun(a, runId, MISSION_B);
    // The capacity mission lives 24 hours. One hour past that is expired.
    a.clock.advance(25 * 60 * 60 * 1_000);
    await expect(
      advanceJao7AutonomyRunInternal(capacityRequest(runId, `${runId}.late`), a.composition),
    ).rejects.toMatchObject({ code: 'RUN_EXPIRED' });
    await a.close();
  });

  it('K4 keeps SAFETY ROLLBACK available after a kill', async () => {
    // The one place where a control is deliberately NOT superior. Refusing to roll back synthetic
    // state that was already applied would leave the sandbox dirty with no path back, and a control
    // that strands the state it created is not a control. Rollback can only ever restore the
    // captured BEFORE value, so being superior to kill costs nothing.
    const a = startProcess('a');
    await createRun(a, runId, MISSION_B);
    const { proposal } = await driveToGate(a, runId, MISSION_B);
    await correlateAuthority(a, runId, MISSION_B, proposal);
    await advanceJao7AutonomyRunInternal(
      capacityRequest(runId, `${runId}.rehearse`, { proposal }),
      a.composition,
    );
    await killJao7AutonomyRunInternal(capacityRequest(runId, `${runId}.kill`), a.composition);

    // Forward work is refused...
    await expect(
      advanceJao7AutonomyRunInternal(
        capacityRequest(runId, `${runId}.forward`, { proposal }),
        a.composition,
      ),
    ).rejects.toMatchObject({ code: 'RUN_KILLED' });

    // ...and the safety rollback is still available.
    const view = await a.composition.store.readRun(runId);
    const rollback = await a.composition.store.mutateRehearsal(
      {
        runId,
        operationId: `${runId}.safety-rollback`,
        expectedRevision: view.run.revision,
        operationKind: 'ROLLBACK_REHEARSAL',
        nextRehearsalState: 'ROLLED_BACK',
        afterIntegerA: null,
        afterIntegerB: null,
        rollbackIntegerA: view.rehearsal?.beforeIntegerA ?? 0,
        rollbackIntegerB: null,
        maxRehearsalApplies: 1,
      },
      a.clock.nowMs(),
    );
    expect(rollback.replayed).toBe(false);
    const after = await a.composition.store.readRun(runId);
    expect(after.rehearsal?.state).toBe('ROLLED_BACK');
    expect(after.rehearsal?.rollbackIntegerA).toBe(8);
    await a.close();
  });

  // =========================================================================
  // N. Concurrency and compare-and-set.
  // =========================================================================

  it('N1 claims a step exactly once under concurrency', async () => {
    const a = startProcess('a');
    const b = startProcess('b');
    await createRun(a, runId, MISSION_B);

    // Two independent pools, one step, released together.
    const results = await Promise.allSettled([
      advanceJao7AutonomyRunInternal(capacityRequest(runId, `${runId}.left`), a.composition),
      advanceJao7AutonomyRunInternal(capacityRequest(runId, `${runId}.right`), b.composition),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled').length).toBeGreaterThanOrEqual(
      1,
    );

    // Whatever each caller believed, the database holds exactly one row for step 0.
    expect(await countJao7RowsFor(a.pool, 'autonomy_step', runId)).toBe(1);
    await a.close();
    await b.close();
  });

  it('N1b refuses a claim whose plan digest is not the one the run enrolled against', async () => {
    // The check that makes an in-flight run stop when its reviewed policy changes underneath it.
    // Exercised through the raw store, because the coordinator computes the digest from the
    // canonical policy and therefore cannot produce a wrong one -- which is the point.
    const a = startProcess('a');
    await createRun(a, runId, MISSION_B);
    const view = await a.composition.store.readRun(runId);

    await expect(
      a.composition.store.claimStep(
        {
          runId,
          operationId: `${runId}.drifted`,
          expectedRevision: view.run.revision,
          planDigest: 'd'.repeat(64),
          stepIndex: 0,
          stepType: 'VALIDATE_INPUT',
          charge: 'NONE',
          toolCallCount: 0,
          maxSpecialistCalls: 0,
          maxToolCalls: 2,
          maxSteps: 12,
        },
        a.clock.nowMs(),
      ),
    ).rejects.toMatchObject({ code: 'PLAN_MISMATCH' });

    // And nothing was claimed.
    expect(await countJao7RowsFor(a.pool, 'autonomy_step', runId)).toBe(0);
    await a.close();
  });

  it('N2 refuses a stale expected revision with zero hidden writes', async () => {
    const a = startProcess('a');
    await createRun(a, runId, MISSION_B);
    const view = await a.composition.store.readRun(runId);
    await a.composition.store.pauseRun(
      { runId, operationId: `${runId}.pause`, expectedRevision: view.run.revision },
      a.clock.nowMs(),
    );
    const replays = await countJao7RowsFor(a.pool, 'autonomy_operation_replay', runId);

    await expect(
      a.composition.store.killRun(
        { runId, operationId: `${runId}.stale-kill`, expectedRevision: view.run.revision },
        a.clock.nowMs(),
      ),
    ).rejects.toMatchObject({ code: 'REVISION_CONFLICT' });
    expect(await countJao7RowsFor(a.pool, 'autonomy_operation_replay', runId)).toBe(replays);
    expect((await a.composition.store.readRun(runId)).run.state).toBe('PAUSED');
    await a.close();
  });

  it('N3 keeps budgets and the plan digest across a restart', async () => {
    const a = startProcess('a');
    const created = await createRun(a, runId, MISSION_A);
    await driveToGate(a, runId, MISSION_A);
    const beforeRestart = await readJao7AutonomyRunInternal(runId, a.composition);
    expect(beforeRestart.specialistCalls).toBe(1);
    await a.close();

    // A NEW process cannot spend the specialist budget again: it is a row, not a variable.
    const b = startProcess('b');
    const afterRestart = await readJao7AutonomyRunInternal(runId, b.composition);
    expect(afterRestart.specialistCalls).toBe(1);
    expect(afterRestart.stepsCompleted).toBe(beforeRestart.stepsCompleted);
    expect(afterRestart.planDigest).toBe(created.planDigest);
    expect(afterRestart.missionPolicyDigest).toBe(created.missionPolicyDigest);
    await b.close();
  });

  // =========================================================================
  // A. Authority, and what is NOT persisted.
  // =========================================================================

  it('A1 refuses to move past the gate when no decision is supplied', async () => {
    const a = startProcess('a');
    await createRun(a, runId, MISSION_B);
    const { proposal } = await driveToGate(a, runId, MISSION_B);

    // Resuming with NO artifacts leaves the run exactly where it was. Silence is never consent.
    const still = await resumeJao7AutonomyRunInternal(
      capacityRequest(runId, `${runId}.empty`, { proposal }),
      a.composition,
    );
    expect(still.state).toBe('AWAITING_AUTHORITY');
    expect(still.authorityObservation).toBeNull();
    expect(still.rehearsal?.state).toBe('CAPTURED');
    await a.close();
  });

  it('A2 refuses to rehearse on a rejected decision', async () => {
    const a = startProcess('a');
    await createRun(a, runId, MISSION_B);
    const { proposal } = await driveToGate(a, runId, MISSION_B);
    const action = proposal.recommendation.proposedActions[0];

    const result = await resumeJao7AutonomyRunInternal(
      capacityRequest(runId, `${runId}.rejected`, {
        proposal,
        authority: {
          approvalDecision: approvalDecision(proposal, {
            outcome: 'rejected',
            actionDecisions: [{ actionId: action?.actionId ?? '', decision: 'rejected' }],
          }),
        },
      }),
      a.composition,
    );
    expect(result.authorityObservation?.observationCode).toBe('DECISION_NOT_APPROVING_THIS_ACTION');
    expect(result.state).toBe('AWAITING_AUTHORITY');
    // The sandbox was never touched.
    expect(result.rehearsal?.state).toBe('CAPTURED');
    expect(result.rehearsalApplies).toBe(0);
    await a.close();
  });

  it('A3 refuses a proposal that is not this run’s', async () => {
    // The durable binding doing its job. A caller holding a perfectly valid proposal for a DIFFERENT
    // run is refused by a row, not trusted because the artifact happened to be well-formed.
    const a = startProcess('a');
    await createRun(a, runId, MISSION_B);
    const mine = await driveToGate(a, runId, MISSION_B);

    const otherRunId = aRunId();
    await createRun(a, otherRunId, MISSION_B);
    const theirs = await driveToGate(a, otherRunId, MISSION_B);

    // The canonical fingerprint measures action CONTENT, not identity, so two runs proposing the
    // same adjustment share a digest -- which is exactly why the binding checks the recommendation
    // and action IDS too. A fingerprint alone would have let this through.
    expect(theirs.proposal.actionBindings[0].actionFingerprint).toBe(
      mine.proposal.actionBindings[0].actionFingerprint,
    );
    expect(theirs.proposal.recommendation.recommendationId).not.toBe(
      mine.proposal.recommendation.recommendationId,
    );

    await expect(correlateAuthority(a, runId, MISSION_B, theirs.proposal)).resolves.toMatchObject({
      refusalReason: 'AUTHORITY_BINDING_MISMATCH',
    });
    expect(
      (await readJao7AutonomyRunInternal(runId, a.composition)).authorityObservation,
    ).toBeNull();
    await a.close();
  });

  it('A4 persists digests and identities, and nothing reusable', async () => {
    const a = startProcess('a');
    await createRun(a, runId, MISSION_B);
    const { proposal } = await driveToGate(a, runId, MISSION_B);
    const decision = approvalDecision(proposal);
    const intent = executionIntent(proposal, decision);
    await resumeJao7AutonomyRunInternal(
      capacityRequest(runId, `${runId}.authority`, {
        proposal,
        authority: { approvalDecision: decision, executionIntent: intent },
      }),
      a.composition,
    );

    const dump = await dumpJao7Run(a.pool, runId);
    // The artifacts themselves are absent: their ids, their idempotency key, their actor and their
    // reason code appear nowhere. What is stored is a digest, and a digest cannot be inverted back.
    for (const absent of [
      decision.decisionId,
      intent.executionIntentId,
      intent.idempotencyKey,
      'quickfurno-core',
      'at-most-once',
      'operator-approved',
      'staff.approver.1',
    ]) {
      expect(dump, absent).not.toContain(absent);
    }
    for (const forbidden of ['approved', 'canExecute', 'isAuthorized', 'sendAllowed']) {
      expect(dump, forbidden).not.toContain(forbidden);
    }
    // And the digests that ARE stored are there.
    const observation = await readJao7AutonomyRunInternal(runId, a.composition);
    expect(observation.authorityObservation?.approvalDecisionDigest).toMatch(/^[0-9a-f]{64}$/u);
    expect(observation.authorityObservation?.executionIntentDigest).toMatch(/^[0-9a-f]{64}$/u);
    await a.close();
  });
});
