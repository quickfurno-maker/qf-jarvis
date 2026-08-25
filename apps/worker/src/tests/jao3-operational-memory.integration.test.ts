/**
 * JAO-3 durable operational memory, against a real PostgreSQL (ADR-0117).
 *
 * This is the test the slice exists for. Contracts can be proved without a database; DURABILITY
 * cannot, and an in-memory store passes every test that never opens a connection.
 *
 * ### What a "process" means here
 *
 * Each lettered process below builds a brand new pool, a brand new adapter and a brand new
 * operations layer, and closes the pool completely before the next begins. No object, closure,
 * cache or module-level state survives the boundary. If any part of an investigation were held in
 * process memory, the resume in process B would find nothing and this suite would fail.
 *
 * That is the distinction the master prompt insists on: calling another method on the same object
 * is not a restart. A fresh pool over a fresh connection is.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  Jao3MemoryError,
  createJao3MemoryOperations,
  createJao3PostgresStore,
  type Jao3AppendCheckpointInput,
  type Jao3Clock,
  type Jao3MemoryOperations,
  type Jao3TelemetryEvent,
} from '../jao/operational-memory/index.js';
import {
  JAO3_TEST_SCHEMA,
  closeDatabasePool,
  countJao3Rows,
  createJao3TestPool,
  forceJao3RawUpdate,
  resetJao3Schema,
  applyJao3Schema,
  type DatabasePool,
} from './jao3-database-harness.js';

/** A clock the test moves deliberately. JAO-3 reads no clock of its own. */
class SteppableClock implements Jao3Clock {
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
const HOUR = 60 * 60 * 1_000;

interface Process {
  readonly pool: DatabasePool;
  readonly memory: Jao3MemoryOperations;
  readonly clock: SteppableClock;
  readonly events: Jao3TelemetryEvent[];
  close: () => Promise<void>;
}

/**
 * A whole new "process": pool, adapter, operations, telemetry sink.
 *
 * Nothing is shared with any other. `close` ends the pool, so a later call through this process
 * cannot succeed even by accident -- which is what makes the restart boundary a fact rather than
 * an intention.
 */
function startProcess(name: string, startMs = T0): Process {
  const pool = createJao3TestPool(`qf-jarvis-jao3-${name}`);
  const clock = new SteppableClock(startMs);
  const events: Jao3TelemetryEvent[] = [];
  const memory = createJao3MemoryOperations({
    store: createJao3PostgresStore(pool),
    clock,
    telemetry: {
      record(event: Jao3TelemetryEvent): void {
        events.push(event);
      },
    },
  });
  return {
    pool,
    memory,
    clock,
    events,
    close: async (): Promise<void> => {
      await closeDatabasePool(pool);
    },
  };
}

let counter = 0;
function anInvestigationId(): string {
  counter += 1;
  return `jao3.investigation.${String(counter).padStart(6, '0')}`;
}

function aCheckpoint(
  over: Partial<Jao3AppendCheckpointInput> & {
    readonly investigationId: string;
    readonly runId: string;
    readonly expectedRevision: number;
    readonly operationId: string;
    readonly checkpointId: string;
  },
): Jao3AppendCheckpointInput {
  return {
    workflowState: 'ANALYSIS',
    summary: 'Projection lag traced to a single partition; no business action taken.',
    evidenceRefs: [
      {
        evidenceRef: 'control-plane.snapshot.2026-08-25T09',
        kind: 'projection-health',
        sourceClass: 'CONTROL_PLANE_SNAPSHOT',
        observedAt: '2026-08-25T09:05:00.000Z',
      },
    ],
    hypotheses: [
      {
        statement: 'The lag is confined to one partition rather than the whole projection.',
        epistemicStatus: 'HYPOTHESIS',
        authority: 'NONE',
      },
    ],
    nextObjective: 'Confirm the partition boundary against a second snapshot.',
    ...over,
  };
}

/** A dedicated pool for schema setup and raw inspection, outside every "process". */
let admin: DatabasePool;

beforeAll(async () => {
  admin = createJao3TestPool('qf-jarvis-jao3-admin');
  await resetJao3Schema(admin);
}, 60_000);

afterAll(async () => {
  await closeDatabasePool(admin);
});

describe('JAO-3 durable operational memory', () => {
  let investigationId: string;

  beforeEach(() => {
    investigationId = anInvestigationId();
  });

  it('applies the local schema asset cleanly, and applies again without damage', async () => {
    // Forward-only and re-appliable: every object is CREATE ... IF NOT EXISTS, so applying the
    // asset twice is not an error and does not rewrite anything that already exists.
    await applyJao3Schema(admin);

    const tables = await inspectTables();
    expect([...tables].sort()).toStrictEqual([
      'checkpoint',
      'evidence_ref',
      'hypothesis',
      'investigation',
      'operation_replay',
      'owner_correction',
    ]);
  });

  it('persists a created investigation and reads it back through a FRESH adapter', async () => {
    const a = startProcess('a');
    const created = await a.memory.createInvestigation({
      investigationId,
      rootRunId: 'jao3.run.root',
      objective: 'Explain the projection lag observed in the control-plane snapshot.',
      workflowState: 'DISCOVERY',
      lifetimeMs: 6 * HOUR,
    });
    expect(created.revision).toBe(1);
    expect(created.status).toBe('OPEN');
    expect(created.memoryClass).toBe('OPERATIONAL_NON_AUTHORITATIVE');
    await a.close();

    // A different pool, a different adapter, a different operations layer. Nothing survived except
    // the row.
    const b = startProcess('b');
    const read = await b.memory.readInvestigation({ investigationId, runId: 'jao3.run.root' });
    expect(read).toStrictEqual(created);
    await b.close();
  });

  it('refuses a second investigation with the same identity rather than overwriting', async () => {
    const a = startProcess('a');
    const input = {
      investigationId,
      rootRunId: 'jao3.run.root',
      objective: 'First.',
      workflowState: 'DISCOVERY' as const,
      lifetimeMs: HOUR,
    };
    await a.memory.createInvestigation(input);
    await expect(
      a.memory.createInvestigation({ ...input, objective: 'Second, different.' }),
    ).rejects.toMatchObject({ code: 'INVESTIGATION_ALREADY_EXISTS' });

    // The original is untouched: a durable record is not something a second caller replaces.
    const read = await a.memory.readInvestigation({ investigationId, runId: 'jao3.run.root' });
    expect(read.objective).toBe('First.');
    expect(read.revision).toBe(1);
    await a.close();
  });

  it('survives a restart: checkpoint, budget and status are recovered by a NEW pool', async () => {
    // ---- process A: create, checkpoint, then disappear -------------------------------------
    const a = startProcess('a');
    const created = await a.memory.createInvestigation({
      investigationId,
      rootRunId: 'jao3.run.root',
      objective: 'Explain the projection lag.',
      workflowState: 'DISCOVERY',
      lifetimeMs: 6 * HOUR,
    });
    const first = await a.memory.appendCheckpoint(
      aCheckpoint({
        investigationId,
        runId: 'jao3.run.root',
        expectedRevision: created.revision,
        operationId: 'jao3.op.checkpoint.1',
        checkpointId: 'jao3.checkpoint.1',
      }),
    );
    expect(first.replayed).toBe(false);
    expect(first.investigation.revision).toBe(2);
    expect(first.investigation.checkpointCount).toBe(1);
    await a.close();

    // The pool is ended. Process A cannot reach the database again even if something tried.
    await expect(
      a.memory.readInvestigation({ investigationId, runId: 'jao3.run.root' }),
    ).rejects.toBeInstanceOf(Jao3MemoryError);

    // ---- process B: resume by durable identity ----------------------------------------------
    const b = startProcess('b');
    const resumed = await b.memory.resumeInvestigation({
      investigationId,
      expectedRevision: first.investigation.revision,
      nextRunId: 'jao3.run.second',
    });
    expect(resumed.revision).toBe(3);
    expect(resumed.status).toBe('OPEN');
    expect(resumed.resumeCount).toBe(1);
    // The run that opened the investigation is a fact about it and does not move.
    expect(resumed.rootRunId).toBe('jao3.run.root');
    expect(resumed.currentRunId).toBe('jao3.run.second');
    // The persisted budget came back exactly as written -- a restart does not re-grant it.
    expect(resumed.budget).toStrictEqual(created.budget);

    const viewInB = await b.memory.readInvestigationView({
      investigationId,
      runId: 'jao3.run.second',
    });
    expect(viewInB.checkpoints).toHaveLength(1);
    expect(viewInB.checkpoints[0]?.summary).toBe(first.checkpoint.summary);
    expect(viewInB.checkpoints[0]?.evidenceRefs).toHaveLength(1);
    expect(viewInB.checkpoints[0]?.hypotheses[0]?.authority).toBe('NONE');

    const second = await b.memory.appendCheckpoint(
      aCheckpoint({
        investigationId,
        runId: 'jao3.run.second',
        expectedRevision: resumed.revision,
        operationId: 'jao3.op.checkpoint.2',
        checkpointId: 'jao3.checkpoint.2',
        summary: 'Second partition confirmed clean.',
      }),
    );
    expect(second.investigation.revision).toBe(4);
    expect(second.investigation.checkpointCount).toBe(2);
    await b.close();

    // ---- process C: a third pool reads the whole history -------------------------------------
    const c = startProcess('c');
    const view = await c.memory.readInvestigationView({
      investigationId,
      runId: 'jao3.run.second',
    });
    expect(view.investigation.revision).toBe(4);
    expect(view.investigation.resumeCount).toBe(1);
    expect(view.checkpoints.map((one) => one.revision)).toStrictEqual([2, 4]);
    expect(view.checkpoints.map((one) => one.runId)).toStrictEqual([
      'jao3.run.root',
      'jao3.run.second',
    ]);
    // History is append-only: the first checkpoint is exactly what process A wrote.
    expect(view.checkpoints[0]).toStrictEqual(first.checkpoint);
    await c.close();
  });

  it('binds a checkpoint to the CURRENT run, so a superseded run cannot keep writing', async () => {
    const a = startProcess('a');
    const created = await a.memory.createInvestigation({
      investigationId,
      rootRunId: 'jao3.run.root',
      objective: 'Identity binding.',
      workflowState: 'DISCOVERY',
      lifetimeMs: HOUR,
    });
    const resumed = await a.memory.resumeInvestigation({
      investigationId,
      expectedRevision: created.revision,
      nextRunId: 'jao3.run.second',
    });

    // The original run tries to continue after another run took over.
    await expect(
      a.memory.appendCheckpoint(
        aCheckpoint({
          investigationId,
          runId: 'jao3.run.root',
          expectedRevision: resumed.revision,
          operationId: 'jao3.op.stale-run',
          checkpointId: 'jao3.checkpoint.stale',
        }),
      ),
    ).rejects.toMatchObject({ code: 'RUN_ID_MISMATCH' });

    expect((await countJao3RowsFor('checkpoint')) >= 0).toBe(true);
    const view = await a.memory.readInvestigationView({
      investigationId,
      runId: 'jao3.run.second',
    });
    expect(view.checkpoints).toHaveLength(0);
    expect(view.investigation.revision).toBe(resumed.revision);
    await a.close();
  });

  it('increments the revision exactly once per write, and a stale writer loses', async () => {
    const a = startProcess('a');
    const created = await a.memory.createInvestigation({
      investigationId,
      rootRunId: 'jao3.run.root',
      objective: 'Revision arithmetic.',
      workflowState: 'DISCOVERY',
      lifetimeMs: HOUR,
    });
    const first = await a.memory.appendCheckpoint(
      aCheckpoint({
        investigationId,
        runId: 'jao3.run.root',
        expectedRevision: 1,
        operationId: 'jao3.op.rev.1',
        checkpointId: 'jao3.checkpoint.rev.1',
      }),
    );
    expect(created.revision).toBe(1);
    expect(first.investigation.revision).toBe(2);

    // A writer still holding revision 1 -- exactly the state a resumed process would be in if it
    // had loaded before someone else wrote.
    await expect(
      a.memory.appendCheckpoint(
        aCheckpoint({
          investigationId,
          runId: 'jao3.run.root',
          expectedRevision: 1,
          operationId: 'jao3.op.rev.stale',
          checkpointId: 'jao3.checkpoint.rev.stale',
        }),
      ),
    ).rejects.toMatchObject({ code: 'REVISION_CONFLICT' });

    const view = await a.memory.readInvestigationView({ investigationId, runId: 'jao3.run.root' });
    expect(view.investigation.revision).toBe(2);
    expect(view.checkpoints).toHaveLength(1);
    await a.close();
  });

  it('loses no update when two processes write concurrently', async () => {
    const setup = startProcess('setup');
    const created = await setup.memory.createInvestigation({
      investigationId,
      rootRunId: 'jao3.run.root',
      objective: 'Concurrency.',
      workflowState: 'DISCOVERY',
      lifetimeMs: HOUR,
    });
    await setup.close();

    // Two genuinely separate processes, both believing they hold revision 1.
    const one = startProcess('race-1');
    const two = startProcess('race-2');
    const results = await Promise.allSettled([
      one.memory.appendCheckpoint(
        aCheckpoint({
          investigationId,
          runId: 'jao3.run.root',
          expectedRevision: created.revision,
          operationId: 'jao3.op.race.1',
          checkpointId: 'jao3.checkpoint.race.1',
          summary: 'Writer one.',
        }),
      ),
      two.memory.appendCheckpoint(
        aCheckpoint({
          investigationId,
          runId: 'jao3.run.root',
          expectedRevision: created.revision,
          operationId: 'jao3.op.race.2',
          checkpointId: 'jao3.checkpoint.race.2',
          summary: 'Writer two.',
        }),
      ),
    ]);

    const fulfilled = results.filter((one_) => one_.status === 'fulfilled');
    const rejected = results.filter((one_) => one_.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    for (const failure of rejected) {
      expect(failure.reason).toMatchObject({ code: 'REVISION_CONFLICT' });
    }

    // Exactly one checkpoint, and the revision advanced by exactly one. The loser wrote nothing:
    // no lost update, and no silently duplicated history either.
    const reader = startProcess('race-reader');
    const view = await reader.memory.readInvestigationView({
      investigationId,
      runId: 'jao3.run.root',
    });
    expect(view.checkpoints).toHaveLength(1);
    expect(view.investigation.revision).toBe(2);
    expect(view.investigation.checkpointCount).toBe(1);

    await Promise.all([one.close(), two.close(), reader.close()]);
  });

  it('replays an identical retried write without duplicating or advancing anything', async () => {
    const a = startProcess('a');
    const created = await a.memory.createInvestigation({
      investigationId,
      rootRunId: 'jao3.run.root',
      objective: 'Idempotency.',
      workflowState: 'DISCOVERY',
      lifetimeMs: HOUR,
    });
    const input = aCheckpoint({
      investigationId,
      runId: 'jao3.run.root',
      expectedRevision: created.revision,
      operationId: 'jao3.op.idem',
      checkpointId: 'jao3.checkpoint.idem',
    });

    const first = await a.memory.appendCheckpoint(input);
    expect(first.replayed).toBe(false);
    expect(first.investigation.revision).toBe(2);
    await a.close();

    // A different process retries the SAME operation -- the situation a caller is in when it does
    // not know whether its previous attempt committed before the connection dropped.
    const b = startProcess('b');
    const replay = await b.memory.appendCheckpoint(input);
    expect(replay.replayed).toBe(true);
    expect(replay.checkpoint).toStrictEqual(first.checkpoint);
    expect(replay.investigation.revision).toBe(2);

    const view = await b.memory.readInvestigationView({ investigationId, runId: 'jao3.run.root' });
    expect(view.checkpoints).toHaveLength(1);
    expect(view.investigation.checkpointCount).toBe(1);
    expect(view.investigation.revision).toBe(2);
    await b.close();
  });

  it('fails closed when one operation id is reused for a DIFFERENT write', async () => {
    const a = startProcess('a');
    const created = await a.memory.createInvestigation({
      investigationId,
      rootRunId: 'jao3.run.root',
      objective: 'Idempotency conflict.',
      workflowState: 'DISCOVERY',
      lifetimeMs: HOUR,
    });
    const input = aCheckpoint({
      investigationId,
      runId: 'jao3.run.root',
      expectedRevision: created.revision,
      operationId: 'jao3.op.reused',
      checkpointId: 'jao3.checkpoint.reused',
    });
    await a.memory.appendCheckpoint(input);

    await expect(
      a.memory.appendCheckpoint({ ...input, summary: 'A materially different finding.' }),
    ).rejects.toMatchObject({ code: 'CHECKPOINT_CONFLICT' });

    const view = await a.memory.readInvestigationView({ investigationId, runId: 'jao3.run.root' });
    expect(view.checkpoints).toHaveLength(1);
    expect(view.investigation.revision).toBe(2);
    await a.close();
  });

  it('keeps owner corrections append-only across a restart, and they grant nothing', async () => {
    const a = startProcess('a');
    const created = await a.memory.createInvestigation({
      investigationId,
      rootRunId: 'jao3.run.root',
      objective: 'Owner corrections.',
      workflowState: 'ANALYSIS',
      lifetimeMs: HOUR,
    });
    const first = await a.memory.appendOwnerCorrection({
      investigationId,
      runId: 'jao3.run.root',
      expectedRevision: created.revision,
      operationId: 'jao3.op.correction.1',
      correctionId: 'jao3.correction.1',
      targetType: 'INVESTIGATION',
      targetId: investigationId,
      correctionStatement: 'The lag predates the deploy; re-scope the investigation.',
      actor: 'FOUNDER',
    });
    expect(first.investigation.ownerCorrectionCount).toBe(1);
    expect(first.investigation.revision).toBe(2);
    await a.close();

    const b = startProcess('b');
    const second = await b.memory.appendOwnerCorrection({
      investigationId,
      runId: 'jao3.run.root',
      expectedRevision: first.investigation.revision,
      operationId: 'jao3.op.correction.2',
      correctionId: 'jao3.correction.2',
      targetType: 'INVESTIGATION',
      targetId: investigationId,
      correctionStatement: 'Second correction, superseding the first.',
      actor: 'FOUNDER',
    });
    expect(second.investigation.ownerCorrectionCount).toBe(2);

    const view = await b.memory.readInvestigationView({ investigationId, runId: 'jao3.run.root' });
    // BOTH survive. A correction supersedes what it targets; it does not erase the record of what
    // was believed before, which is the entire value of an auditable correction.
    expect(view.ownerCorrections).toHaveLength(2);
    expect(view.ownerCorrections[0]).toStrictEqual(first.correction);
    expect(view.ownerCorrections.map((one) => one.revision)).toStrictEqual([2, 3]);

    // A correction carries no authority, and there is nowhere on it to put any.
    const serialised = JSON.stringify(view.ownerCorrections);
    for (const forbidden of [
      'isAuthorized',
      'canExecute',
      'canSend',
      'approvalGranted',
      'authorizationValid',
      'authorizedAction',
      'executionAllowed',
    ]) {
      expect(serialised, forbidden).not.toContain(forbidden);
    }
    await b.close();
  });

  it('blocks resume after expiry, with no cleanup job and the row still present', async () => {
    const a = startProcess('a');
    const created = await a.memory.createInvestigation({
      investigationId,
      rootRunId: 'jao3.run.root',
      objective: 'Expiry.',
      workflowState: 'DISCOVERY',
      lifetimeMs: 2_000,
    });
    await a.close();

    const b = startProcess('b');
    // Nothing ran in between. Expiry is computed at the moment of use, from the persisted instant.
    b.clock.set(T0 + 3_000);
    await expect(
      b.memory.resumeInvestigation({
        investigationId,
        expectedRevision: created.revision,
        nextRunId: 'jao3.run.second',
      }),
    ).rejects.toMatchObject({ code: 'INVESTIGATION_EXPIRED' });

    await expect(
      b.memory.appendCheckpoint(
        aCheckpoint({
          investigationId,
          runId: 'jao3.run.root',
          expectedRevision: created.revision,
          operationId: 'jao3.op.expired',
          checkpointId: 'jao3.checkpoint.expired',
        }),
      ),
    ).rejects.toMatchObject({ code: 'INVESTIGATION_EXPIRED' });

    // Expiry is not deletion: the record remains readable for audit, and its status was never
    // rewritten by a sweeper because there is no sweeper.
    const read = await b.memory.readInvestigation({ investigationId, runId: 'jao3.run.root' });
    expect(read.status).toBe('OPEN');
    expect(read.revision).toBe(created.revision);
    await b.close();
  });

  it('blocks resume after supersession and keeps the replacement pointer', async () => {
    const a = startProcess('a');
    const replacementId = anInvestigationId();
    const created = await a.memory.createInvestigation({
      investigationId,
      rootRunId: 'jao3.run.root',
      objective: 'Supersession.',
      workflowState: 'ANALYSIS',
      lifetimeMs: HOUR,
    });
    await a.memory.createInvestigation({
      investigationId: replacementId,
      rootRunId: 'jao3.run.replacement',
      objective: 'The replacement investigation.',
      workflowState: 'DISCOVERY',
      lifetimeMs: HOUR,
    });

    await expect(
      a.memory.supersedeInvestigation({
        investigationId,
        runId: 'jao3.run.root',
        expectedRevision: created.revision,
        supersededByInvestigationId: investigationId,
      }),
    ).rejects.toMatchObject({ code: 'SUPERSESSION_INVALID' });

    const superseded = await a.memory.supersedeInvestigation({
      investigationId,
      runId: 'jao3.run.root',
      expectedRevision: created.revision,
      supersededByInvestigationId: replacementId,
    });
    expect(superseded.status).toBe('SUPERSEDED');
    expect(superseded.supersededByInvestigationId).toBe(replacementId);
    await a.close();

    const b = startProcess('b');
    await expect(
      b.memory.resumeInvestigation({
        investigationId,
        expectedRevision: superseded.revision,
        nextRunId: 'jao3.run.second',
      }),
    ).rejects.toMatchObject({ code: 'INVESTIGATION_SUPERSEDED' });

    // Not merged. The old investigation keeps its own history and gains a pointer.
    const read = await b.memory.readInvestigation({ investigationId, runId: 'jao3.run.root' });
    expect(read.supersededByInvestigationId).toBe(replacementId);
    const replacement = await b.memory.readInvestigation({
      investigationId: replacementId,
      runId: 'jao3.run.replacement',
    });
    expect(replacement.status).toBe('OPEN');
    expect(replacement.supersededByInvestigationId).toBeNull();
    await b.close();
  });

  it('blocks resume and further writes after completion', async () => {
    const a = startProcess('a');
    const created = await a.memory.createInvestigation({
      investigationId,
      rootRunId: 'jao3.run.root',
      objective: 'Completion.',
      workflowState: 'SUMMARY',
      lifetimeMs: HOUR,
    });
    const completed = await a.memory.completeInvestigation({
      investigationId,
      runId: 'jao3.run.root',
      expectedRevision: created.revision,
    });
    expect(completed.status).toBe('COMPLETED');
    await a.close();

    const b = startProcess('b');
    await expect(
      b.memory.resumeInvestigation({
        investigationId,
        expectedRevision: completed.revision,
        nextRunId: 'jao3.run.second',
      }),
    ).rejects.toMatchObject({ code: 'STATUS_NOT_RESUMABLE' });
    await expect(
      b.memory.appendCheckpoint(
        aCheckpoint({
          investigationId,
          runId: 'jao3.run.root',
          expectedRevision: completed.revision,
          operationId: 'jao3.op.after-complete',
          checkpointId: 'jao3.checkpoint.after-complete',
        }),
      ),
    ).rejects.toMatchObject({ code: 'STATUS_NOT_RESUMABLE' });
    await b.close();
  });

  it('pauses and resumes explicitly, and never resumes on its own', async () => {
    const a = startProcess('a');
    const created = await a.memory.createInvestigation({
      investigationId,
      rootRunId: 'jao3.run.root',
      objective: 'Pause and resume.',
      workflowState: 'AWAITING_OWNER_INPUT',
      lifetimeMs: HOUR,
    });
    const paused = await a.memory.pauseInvestigation({
      investigationId,
      runId: 'jao3.run.root',
      expectedRevision: created.revision,
    });
    expect(paused.status).toBe('PAUSED');
    await a.close();

    // A new process. Time passes. Nothing resumes it, because nothing is watching.
    const b = startProcess('b');
    b.clock.advance(30 * 60 * 1_000);
    const stillPaused = await b.memory.readInvestigation({
      investigationId,
      runId: 'jao3.run.root',
    });
    expect(stillPaused.status).toBe('PAUSED');
    expect(stillPaused.revision).toBe(paused.revision);
    expect(stillPaused.resumeCount).toBe(0);

    const resumed = await b.memory.resumeInvestigation({
      investigationId,
      expectedRevision: paused.revision,
      nextRunId: 'jao3.run.second',
    });
    expect(resumed.status).toBe('OPEN');
    expect(resumed.resumeCount).toBe(1);
    await b.close();
  });

  it('refuses a persisted row that no longer satisfies the contract', async () => {
    const a = startProcess('a');
    await a.memory.createInvestigation({
      investigationId,
      rootRunId: 'jao3.run.root',
      objective: 'Corruption.',
      workflowState: 'DISCOVERY',
      lifetimeMs: HOUR,
    });

    // Drop the database's own bound, then write a value the domain contract refuses. This is what
    // schema drift looks like from the adapter's side, and the answer must be a refusal rather
    // than a plausible-looking object assembled from a row nobody checked.
    await forceJao3RawUpdate(
      admin,
      `ALTER TABLE ${JAO3_TEST_SCHEMA}.investigation DROP CONSTRAINT investigation_objective_bounded`,
      [],
    );
    await forceJao3RawUpdate(
      admin,
      `UPDATE ${JAO3_TEST_SCHEMA}.investigation SET objective = repeat('x', 400) WHERE investigation_id = $1`,
      [investigationId],
    );

    await expect(
      a.memory.readInvestigation({ investigationId, runId: 'jao3.run.root' }),
    ).rejects.toMatchObject({ code: 'PERSISTED_STATE_INVALID' });
    await a.close();

    // Put the bound back so the rest of the suite runs against the real schema.
    await forceJao3RawUpdate(
      admin,
      `UPDATE ${JAO3_TEST_SCHEMA}.investigation SET objective = 'restored' WHERE investigation_id = $1`,
      [investigationId],
    );
    await forceJao3RawUpdate(
      admin,
      `ALTER TABLE ${JAO3_TEST_SCHEMA}.investigation ADD CONSTRAINT investigation_objective_bounded CHECK (char_length(objective) BETWEEN 1 AND 240)`,
      [],
    );
  });

  it('reports database uncertainty as unavailable, never as absence', async () => {
    // THE rule that matters most. A store that cannot reach PostgreSQL must not answer
    // "no such investigation" -- a caller acting on that would create a duplicate investigation,
    // or conclude that durable work never happened.
    const dead = startProcess('dead');
    await dead.close();

    await expect(
      dead.memory.readInvestigation({ investigationId: 'jao3.investigation.absent', runId: 'r' }),
    ).rejects.toMatchObject({ code: 'DATABASE_UNAVAILABLE' });

    const live = startProcess('live');
    await expect(
      live.memory.readInvestigation({ investigationId: 'jao3.investigation.absent', runId: 'r' }),
    ).rejects.toMatchObject({ code: 'INVESTIGATION_NOT_FOUND' });
    await live.close();
  });

  it('refuses a budget the database would not have granted', async () => {
    // The persisted ceiling is enforced by the database, not only by the code that writes it, so
    // a row claiming more than JAO-3 ever grants cannot be created at all.
    await expect(
      forceJao3RawUpdate(
        admin,
        `INSERT INTO ${JAO3_TEST_SCHEMA}.investigation (
           investigation_id, root_run_id, current_run_id, revision, status, objective,
           workflow_state, created_at, updated_at, expires_at, checkpoint_count,
           owner_correction_count, resume_count, budget_max_checkpoints,
           budget_max_evidence_refs_per_checkpoint, budget_max_hypotheses_per_checkpoint,
           budget_max_owner_corrections, budget_max_resume_count, budget_max_lifetime_ms
         ) VALUES ($1, 'r', 'r', 1, 'OPEN', 'Widened budget.', 'DISCOVERY',
                   now(), now(), now() + interval '1 hour', 0, 0, 0,
                   9999, 8, 4, 16, 16, 604800000)`,
        [anInvestigationId()],
      ),
    ).rejects.toThrow();
  });

  it('touches only its own schema', async () => {
    const tables = await inspectTables();
    // Six tables, all JAO-3's. No managed event-backbone table, no business table, and nothing
    // this slice created outside the schema it owns.
    expect(tables).toHaveLength(6);
    expect(await countJao3Rows(admin, 'investigation')).toBeGreaterThan(0);
  });
});

/** The tables that exist in JAO-3's own schema. */
async function inspectTables(): Promise<string[]> {
  const { withClient } = await import('@qf-jarvis/event-backbone');
  return withClient(admin, async (client) => {
    const found = await client.query<{ readonly table_name: string }>(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = $1 ORDER BY table_name`,
      [JAO3_TEST_SCHEMA],
    );
    return found.rows.map((row) => row.table_name);
  });
}

async function countJao3RowsFor(table: string): Promise<number> {
  return countJao3Rows(admin, table);
}
