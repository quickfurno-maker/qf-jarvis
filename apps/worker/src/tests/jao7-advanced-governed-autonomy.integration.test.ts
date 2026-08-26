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
  performJao7StepInternal,
  resumeJao7AutonomyRunInternal,
  rollbackJao7AutonomyRehearsalInternal,
  type Jao7InternalComposition,
} from '../jao/advanced-governed-autonomy/coordinator.js';
import { createJao7PostgresStore } from '../jao/advanced-governed-autonomy/postgres-store.js';
import { createJao7MissionRegistry } from '../jao/advanced-governed-autonomy/mission-registry.js';
import { runJao2GovernedDelegation } from '../jao/governed-specialist-delegation/index.js';
import type { Jao7AutonomyStore } from '../jao/advanced-governed-autonomy/store-port.js';
import type { Jao7MissionPolicy } from '../jao/advanced-governed-autonomy/mission-policy.js';
import type { Jao7AutonomyResult } from '../jao/advanced-governed-autonomy/index.js';
import type { Jao7ResultProposal } from '../jao/advanced-governed-autonomy/public-contracts.js';

import {
  DERIVED_HUMAN_HANDOVER_TASK,
  DERIVED_READINESS_TASK,
  DERIVED_STALLED_TASK,
  OUT_OF_SCOPE_SALES_SIGNALS,
  READINESS_SALES_SIGNALS,
  STALLED_SALES_SIGNALS,
  SteppableClock,
  advanceRequest,
  approvalDecision,
  capacityRequest,
  carriedProposal,
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
  jao7RawStatement,
  jao7ReplayKindsFor,
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

/**
 * A whole new "process": pool, store, clock, composition. Nothing survives the boundary.
 *
 * `faultInjection` is part of the INTERNAL composition, beside the store and the clock. It used to
 * be two optional booleans on the PUBLIC request schema -- a shipped surface carrying switches whose
 * only purpose was to make a verification fail and a rollback not restore.
 */
function startProcess(
  name: string,
  faultInjection?: Jao7InternalComposition['faultInjection'],
): Process {
  const pool = createJao7TestPool(`qf-jarvis-jao7-${name}`);
  const clock = new SteppableClock();
  return {
    pool,
    clock,
    composition: {
      store: createJao7PostgresStore(pool),
      clock,
      registry: createJao7MissionRegistry(),
      ...(faultInjection === undefined ? {} : { faultInjection }),
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
  over: Record<string, unknown> = {},
): Promise<{ readonly latest: Jao7AutonomyResult; readonly proposal: Jao7ResultProposal }> {
  const build = builderFor(mission, runId);
  let latest: Jao7AutonomyResult | undefined;
  let proposal: Jao7ResultProposal | undefined;
  for (let step = 0; step < (STEPS_TO_GATE[mission] ?? 0); step += 1) {
    latest = await advanceJao7AutonomyRunInternal(
      build(`${runId}.step${String(step)}`, over),
      process.composition,
    );
    // No cast. The result declares its proposal now, so what comes back is already checked.
    if (latest.proposal !== null) {
      proposal = latest.proposal;
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
  proposal: Jao7ResultProposal,
  over: Record<string, unknown> = {},
  operationId = `${runId}.authority`,
): Promise<Jao7AutonomyResult> {
  const decision = approvalDecision(proposal);
  return resumeJao7AutonomyRunInternal(
    builderFor(mission, runId)(operationId, {
      proposal: carriedProposal(proposal),
      authority: {
        approvalDecision: decision,
        executionIntent: executionIntent(proposal, decision),
      },
      ...over,
    }),
    process.composition,
  );
}

/**
 * A delegate that COUNTS INVOCATIONS.
 *
 * Counting rows would not have caught the defect this exists for: a replayed claim re-ran Phase B,
 * so Riya was invoked a second time on a single charged specialist call, and the step table still
 * held exactly one row. What has to be counted is the call.
 */
function countingDelegate(counter: {
  calls: number;
}): NonNullable<Jao7InternalComposition['delegate']> {
  return async (input, dependencies, signal) => {
    counter.calls += 1;
    return runJao2GovernedDelegation(input, dependencies, signal);
  };
}

/**
 * The canonical store, with a finalize that CRASHES at one named plan position.
 *
 * A crash, not a refusal: the point is a process that vanishes between a committed claim and its
 * finalize, leaving a charged budget and a CLAIMED row behind.
 */
function storeCrashingOnFinalize(
  store: Jao7AutonomyStore,
  remaining: { stepIndex: number; crashes: number },
): Jao7AutonomyStore {
  return Object.freeze({
    ...store,
    async finalizeStep(request: Parameters<Jao7AutonomyStore['finalizeStep']>[0], nowMs: number) {
      if (remaining.crashes > 0 && request.stepIndex === remaining.stepIndex) {
        remaining.crashes -= 1;
        throw new Error('simulated process loss between claim and finalize');
      }
      return store.finalizeStep(request, nowMs);
    },
  });
}

/** The reviewed capacity mission, for the direct-path proofs that need a policy. */
function capacityPolicy(): Jao7MissionPolicy {
  const lookup = createJao7MissionRegistry().lookup(MISSION_B, 1);
  if (lookup.found !== 'MISSION') {
    throw new Error('expected the capacity mission');
  }
  return lookup.policy;
}

/**
 * The canonical store, with a claim that ABORTS the caller's signal the moment it commits.
 *
 * This is how a FAILED_SAFE run with a dirty sandbox is produced without fabricating database rows:
 * the claim commits, the coordinator's work phase sees the cancellation, and the step finalises
 * `CANCELLED` / `FAIL_SAFE` while the rehearsal applied by an earlier step is still sitting there.
 * That is a real sequence, not a contrived one -- it is exactly what a cancelled or crashed
 * verification looks like from the database's point of view.
 */
function storeAbortingAfterClaim(
  store: Jao7AutonomyStore,
  controller: AbortController,
): Jao7AutonomyStore {
  return Object.freeze({
    ...store,
    async claimStep(request: Parameters<Jao7AutonomyStore['claimStep']>[0], nowMs: number) {
      const claimed = await store.claimStep(request, nowMs);
      controller.abort();
      return claimed;
    },
  });
}

/**
 * Drive a capacity mission to a FAILED_SAFE run whose virtual sandbox is still APPLIED.
 *
 * Returns the run id. The caller owns the process.
 */
async function driveToDirtyFailSafe(process: Process, runId: string): Promise<void> {
  await createRun(process, runId, MISSION_B);
  const { proposal } = await driveToGate(process, runId, MISSION_B);
  await correlateAuthority(process, runId, MISSION_B, proposal);
  const applied = await advanceJao7AutonomyRunInternal(
    capacityRequest(runId, `${runId}.rehearse`, { proposal: carriedProposal(proposal) }),
    process.composition,
  );
  expect(applied.rehearsal?.state).toBe('APPLIED');

  const controller = new AbortController();
  const cancelling: Jao7InternalComposition = {
    ...process.composition,
    store: storeAbortingAfterClaim(process.composition.store, controller),
  };
  const cancelled = await advanceJao7AutonomyRunInternal(
    capacityRequest(runId, `${runId}.verify`, { proposal: carriedProposal(proposal) }),
    cancelling,
    controller.signal,
  );
  expect(cancelled.refusalReason).toBe('CANCELLED');
  expect(cancelled.state).toBe('FAILED_SAFE');
  // THE DIRTY SANDBOX. Applied, unverified, and belonging to a run that is over.
  expect(cancelled.rehearsal?.state).toBe('APPLIED');
}

/** The action parameters a run actually proposed. */
function proposedParameters(proposal: Jao7ResultProposal): Record<string, unknown> {
  return { ...(proposal.recommendation.proposedActions[0]?.parameters ?? {}) };
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
      capacityRequest(runId, `${runId}.rehearse`, { proposal: carriedProposal(proposal) }),
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
      capacityRequest(runId, `${runId}.verify`, { proposal: carriedProposal(proposal) }),
      c.composition,
    );
    expect(verified.rehearsal?.state).toBe('VERIFIED');
    const completed = await advanceJao7AutonomyRunInternal(
      capacityRequest(runId, `${runId}.complete`, { proposal: carriedProposal(proposal) }),
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
      advanceRequest(runId, `${runId}.rehearse`, { proposal: carriedProposal(proposal) }),
      a.composition,
    );
    // The virtual task ledger: present, and BOUND to the exact approved action.
    expect(applied.rehearsal?.afterIntegerA).toBe(1);
    expect(applied.rehearsal?.afterIntegerB).toBe(
      Number.parseInt(proposal.actionBindings[0].actionFingerprint.slice(0, 8), 16) % 1_000_000,
    );

    const verified = await advanceJao7AutonomyRunInternal(
      advanceRequest(runId, `${runId}.verify`, { proposal: carriedProposal(proposal) }),
      a.composition,
    );
    expect(verified.rehearsal?.state).toBe('VERIFIED');
    const completed = await advanceJao7AutonomyRunInternal(
      advanceRequest(runId, `${runId}.complete`, { proposal: carriedProposal(proposal) }),
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
      capacityRequest(runId, `${runId}.rehearse`, { proposal: carriedProposal(proposal) }),
      a.composition,
    );
    expect(applied.rehearsal?.afterIntegerA).toBe(9);

    // THE FAILURE FIXTURE, injected into a process's COMPOSITION rather than into a request. The
    // observation is corrupted exactly as a partial failure would corrupt it, and the verification
    // cannot be talked into passing.
    const faulty = startProcess('faulty', { corruptRehearsalObservation: true });
    const failed = await advanceJao7AutonomyRunInternal(
      capacityRequest(runId, `${runId}.verify`, { proposal: carriedProposal(proposal) }),
      faulty.composition,
    );
    await faulty.close();
    expect(failed.rehearsal?.state).toBe('ROLLBACK_REQUIRED');
    expect(failed.state).toBe('ROLLING_BACK');

    const rolledBack = await advanceJao7AutonomyRunInternal(
      capacityRequest(runId, `${runId}.rollback`, { proposal: carriedProposal(proposal) }),
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
      capacityRequest(runId, `${runId}.rehearse`, { proposal: carriedProposal(proposal) }),
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
          maxRollbackAttempts: 1,
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
      capacityRequest(runId, `${runId}.rehearse`, { proposal: carriedProposal(proposal) }),
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
      capacityRequest(runId, `${runId}.verify`, { proposal: carriedProposal(proposal) }),
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
      capacityRequest(runId, `${runId}.rehearse`, { proposal: carriedProposal(proposal) }),
      a.composition,
    );
    await killJao7AutonomyRunInternal(capacityRequest(runId, `${runId}.kill`), a.composition);

    // Forward work is refused...
    await expect(
      advanceJao7AutonomyRunInternal(
        capacityRequest(runId, `${runId}.forward`, { proposal: carriedProposal(proposal) }),
        a.composition,
      ),
    ).rejects.toMatchObject({ code: 'RUN_KILLED' });

    // ...and the safety rollback is still available THROUGH THE COORDINATOR.
    //
    // This used to reach through the raw store, which no public caller has -- so the guarantee was
    // proved only for callers who could not exercise it. `rollbackJao7AutonomyRehearsal` is the
    // public entry point, and this internal variant is the same function with the composition
    // supplied.
    const cleaned = await rollbackJao7AutonomyRehearsalInternal(
      { runId, operationId: `${runId}.safety-rollback` },
      a.composition,
    );
    expect(cleaned.rehearsal?.state).toBe('ROLLED_BACK');
    expect(cleaned.rehearsal?.rollbackIntegerA).toBe(8);
    // The run stays terminal. Cleaning the sandbox does not resurrect it.
    expect(cleaned.state).toBe('KILLED');
    expect(cleaned.outcome).toBe('KILLED');

    // ONE attempt, durably. A second is refused by the row rather than by a variable.
    expect(cleaned.rehearsal?.rollbackAttempts).toBe(1);
    await expect(
      rollbackJao7AutonomyRehearsalInternal(
        { runId, operationId: `${runId}.safety-rollback-again` },
        a.composition,
      ),
    ).rejects.toMatchObject({ code: 'ROLLBACK_NOT_ELIGIBLE' });
    await a.close();
  });

  it('K5 refuses a pause that would strand applied synthetic state', async () => {
    // A pause is a public entry point of its own, and it used to consult the run and not the
    // sandbox -- so a caller could pause a run whose virtual state was applied and unverified, and
    // leave it that way indefinitely. A control that strands the state it created is not a control.
    const a = startProcess('a');
    await createRun(a, runId, MISSION_B);
    const { proposal } = await driveToGate(a, runId, MISSION_B);
    await correlateAuthority(a, runId, MISSION_B, proposal);
    const applied = await advanceJao7AutonomyRunInternal(
      capacityRequest(runId, `${runId}.rehearse`, { proposal: carriedProposal(proposal) }),
      a.composition,
    );
    expect(applied.rehearsal?.state).toBe('APPLIED');

    await expect(
      pauseJao7AutonomyRunInternal(capacityRequest(runId, `${runId}.pause`), a.composition),
    ).rejects.toMatchObject({ code: 'STATE_CONFLICT' });
    expect((await readJao7AutonomyRunInternal(runId, a.composition)).state).toBe(
      'REHEARSAL_APPLIED',
    );

    // The two ways out are both explicit, and both available. Verifying is one of them.
    const verified = await advanceJao7AutonomyRunInternal(
      capacityRequest(runId, `${runId}.verify`, { proposal: carriedProposal(proposal) }),
      a.composition,
    );
    expect(verified.rehearsal?.state).toBe('VERIFIED');
    await a.close();
  });

  it('K6 durably records a rollback that did NOT restore the captured state', async () => {
    // `ROLLBACK_FAILED` used to be unwritable. `rolled_back_at` served as both "attempted" and
    // "succeeded", and the consistency CHECK then read `state = ROLLED_BACK` if and only if that
    // instant existed -- so a failed rollback carrying its attempted values violated its own
    // constraint. A failure state that cannot be persisted is a failure state that does not exist.
    const a = startProcess('a');
    await createRun(a, runId, MISSION_B);
    const { proposal } = await driveToGate(a, runId, MISSION_B);
    await correlateAuthority(a, runId, MISSION_B, proposal);
    await advanceJao7AutonomyRunInternal(
      capacityRequest(runId, `${runId}.rehearse`, { proposal: carriedProposal(proposal) }),
      a.composition,
    );

    // The public safety verb is an EMERGENCY capability, so the run has to be over before it is
    // entitled to call it. Killing first is what a real operator would have done.
    await killJao7AutonomyRunInternal(capacityRequest(runId, `${runId}.kill`), a.composition);

    const broken = startProcess('broken', { corruptRollback: true });
    const failed = await rollbackJao7AutonomyRehearsalInternal(
      { runId, operationId: `${runId}.broken-rollback` },
      broken.composition,
    );
    await broken.close();

    expect(failed.rehearsal?.state).toBe('ROLLBACK_FAILED');
    // ATTEMPTED, and not succeeded. The two facts are separate columns, and only one of them is set.
    expect(failed.rehearsal?.rollbackAttemptedAt).not.toBeNull();
    expect(failed.rehearsal?.rolledBackAt).toBeNull();
    expect(failed.rehearsal?.rollbackIntegerA).toBeNull();
    expect(failed.rehearsal?.rollbackAttempts).toBe(1);
    // The run stays KILLED. A failed cleanup does not downgrade a terminal state to another one.
    expect(failed.state).toBe('KILLED');

    // And a NEW process reads exactly that back. The failure survives the restart.
    const b = startProcess('b');
    const persisted = await readJao7AutonomyRunInternal(runId, b.composition);
    expect(persisted.rehearsal?.state).toBe('ROLLBACK_FAILED');
    expect(persisted.rehearsal?.rollbackAttempts).toBe(1);
    // There is no second attempt to schedule. The bound is durable, not a retry policy.
    await expect(
      rollbackJao7AutonomyRehearsalInternal(
        { runId, operationId: `${runId}.retry-rollback` },
        b.composition,
      ),
    ).rejects.toMatchObject({ code: 'ROLLBACK_NOT_ELIGIBLE' });
    await b.close();
    await a.close();
  });

  it('K7 refuses a safety rollback when nothing was ever applied', async () => {
    // The run is over, so the caller IS entitled to the verb -- and there is still nothing to clean.
    // The two refusals are deliberately distinguishable: an operator needs to tell "you may not ask
    // that of a live run" from "there is nothing here to undo".
    const a = startProcess('a');
    await createRun(a, runId, MISSION_B);
    await killJao7AutonomyRunInternal(capacityRequest(runId, `${runId}.kill`), a.composition);
    await expect(
      rollbackJao7AutonomyRehearsalInternal(
        { runId, operationId: `${runId}.nothing-to-undo` },
        a.composition,
      ),
    ).rejects.toMatchObject({ code: 'ROLLBACK_NOT_ELIGIBLE' });
    expect((await readJao7AutonomyRunInternal(runId, a.composition)).rehearsal?.state).toBe(
      'CAPTURED',
    );
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
      capacityRequest(runId, `${runId}.empty`, { proposal: carriedProposal(proposal) }),
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
        proposal: carriedProposal(proposal),
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
        proposal: carriedProposal(proposal),
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

  // =========================================================================
  // C. The claim binds an operation id, and a replay is SERVED, never re-performed.
  // =========================================================================

  it('C1 serves a replayed claim without performing the step again', async () => {
    // THE CRASH THAT MATTERS. The claim commits -- charging the specialist budget -- and the process
    // is lost before the finalize. A retry under the SAME operation id used to be handed
    // `replayed: true` and then have its work done all over again, because the coordinator ignored
    // the flag: one charged call, two invocations of Riya.
    const calls = { calls: 0 };
    // Plan position 1 of Mission A is the Riya delegation.
    const crashing = { stepIndex: 1, crashes: 1 };
    const a = startProcess('a');
    const composition: Jao7InternalComposition = {
      ...a.composition,
      store: storeCrashingOnFinalize(a.composition.store, crashing),
      delegate: countingDelegate(calls),
    };

    await createRun(a, runId, MISSION_A);
    await advanceJao7AutonomyRunInternal(advanceRequest(runId, `${runId}.step0`), composition);

    // The specialist step: claimed and charged, then the process is lost.
    await expect(
      advanceJao7AutonomyRunInternal(advanceRequest(runId, `${runId}.riya`), composition),
    ).rejects.toThrow();
    expect(calls.calls).toBe(1);
    const stranded = await readJao7AutonomyRunInternal(runId, a.composition);
    expect(stranded.specialistCalls).toBe(1);
    expect(stranded.steps.filter((step) => step.stepStatus === 'CLAIMED')).toHaveLength(1);

    // THE RETRY, under the same operation id. It is served, not re-performed.
    const replayed = await advanceJao7AutonomyRunInternal(
      advanceRequest(runId, `${runId}.riya`),
      composition,
    );
    expect(calls.calls).toBe(1);
    expect(replayed.specialistCalls).toBe(1);
    expect(await countJao7RowsFor(a.pool, 'autonomy_step', runId)).toBe(2);
    await a.close();
  });

  it('C2 refuses a claim by a DIFFERENT operation id, and a reused id meaning something else', async () => {
    const a = startProcess('a');
    await createRun(a, runId, MISSION_B);
    const view = await a.composition.store.readRun(runId);
    const claim = {
      runId,
      operationId: `${runId}.claim`,
      expectedRevision: view.run.revision,
      planDigest: view.run.planDigest,
      stepIndex: 0,
      stepType: 'VALIDATE_INPUT' as const,
      charge: 'NONE' as const,
      toolCallCount: 0,
      maxSpecialistCalls: 0,
      maxToolCalls: 2,
      maxSteps: 12,
    };
    const claimed = await a.composition.store.claimStep(claim, a.clock.nowMs());
    expect(claimed.replayed).toBe(false);
    expect(claimed.step.attemptIndex).toBe(0);
    expect(claimed.priorState).toBe('PLANNED');

    // The SAME id, the SAME meaning: a replay.
    const again = await a.composition.store.claimStep(claim, a.clock.nowMs());
    expect(again.replayed).toBe(true);
    expect(await countJao7RowsFor(a.pool, 'autonomy_step', runId)).toBe(1);

    // A DIFFERENT id for a step already in flight: refused. It used to be handed `replayed: true`.
    const current = await a.composition.store.readRun(runId);
    await expect(
      a.composition.store.claimStep(
        { ...claim, operationId: `${runId}.other`, expectedRevision: current.run.revision },
        a.clock.nowMs(),
      ),
    ).rejects.toMatchObject({ code: 'STEP_ALREADY_CLAIMED' });

    // The SAME id meaning something else -- a different budget, here -- is a conflict, not a replay.
    await expect(
      a.composition.store.claimStep({ ...claim, maxSteps: 64 }, a.clock.nowMs()),
    ).rejects.toMatchObject({ code: 'OPERATION_CONFLICT' });
    expect(await countJao7RowsFor(a.pool, 'autonomy_step', runId)).toBe(1);
    await a.close();
  });

  it('C3 refuses a replayed claim on a run that was killed after the claim committed', async () => {
    // The ordering that was wrong. An existing CLAIMED row returned before the kill, expiry, plan
    // and budget checks ran, so a killed run handed a claim back -- and the work went ahead.
    // Governance runs first now, and the replay is served only because this exact id already
    // committed it. What it must NOT do is let new work start.
    const calls = { calls: 0 };
    // Plan position 1 of Mission A is the Riya delegation.
    const crashing = { stepIndex: 1, crashes: 1 };
    const a = startProcess('a');
    const composition: Jao7InternalComposition = {
      ...a.composition,
      store: storeCrashingOnFinalize(a.composition.store, crashing),
      delegate: countingDelegate(calls),
    };
    await createRun(a, runId, MISSION_A);
    await advanceJao7AutonomyRunInternal(advanceRequest(runId, `${runId}.step0`), composition);
    await expect(
      advanceJao7AutonomyRunInternal(advanceRequest(runId, `${runId}.riya`), composition),
    ).rejects.toThrow();

    await killJao7AutonomyRunInternal(advanceRequest(runId, `${runId}.kill`), a.composition);

    // A NEW operation id gets nowhere at all.
    await expect(
      advanceJao7AutonomyRunInternal(advanceRequest(runId, `${runId}.fresh`), a.composition),
    ).rejects.toMatchObject({ code: 'RUN_KILLED' });
    expect(calls.calls).toBe(1);
    await a.close();
  });

  // =========================================================================
  // GA. The authority gate, and the plan position it is made of.
  // =========================================================================

  it('GA1 does not advance the plan past an authority validation that proved nothing', async () => {
    const a = startProcess('a');
    await createRun(a, runId, MISSION_B);
    const { latest, proposal } = await driveToGate(a, runId, MISSION_B);
    const atGate = latest.currentStepIndex;

    // An approved action WITHOUT a Core-issued intent. A real state, and it stops here.
    const decision = approvalDecision(proposal);
    const incomplete = await resumeJao7AutonomyRunInternal(
      capacityRequest(runId, `${runId}.partial`, {
        proposal: carriedProposal(proposal),
        authority: { approvalDecision: decision },
      }),
      a.composition,
    );
    expect(incomplete.authorityObservation?.observationCode).toBe(
      'CORRELATED_APPROVED_ACTION_WITHOUT_INTENT',
    );
    expect(incomplete.state).toBe('AWAITING_AUTHORITY');
    // THE FIX. The plan position is RETAINED: the run is not pointing at the rehearsal it is
    // supposed to be waiting in front of.
    expect(incomplete.currentStepIndex).toBe(atGate);

    // A second incomplete attempt records a SECOND row rather than being swallowed by the first.
    const stillIncomplete = await resumeJao7AutonomyRunInternal(
      capacityRequest(runId, `${runId}.partial-again`, {
        proposal: carriedProposal(proposal),
        authority: { approvalDecision: approvalDecision(proposal) },
      }),
      a.composition,
    );
    expect(stillIncomplete.currentStepIndex).toBe(atGate);
    expect(await countJao7RowsFor(a.pool, 'authority_observation', runId)).toBe(2);

    // And the exact chain, when it finally arrives, is recorded and DOES move the plan on. The
    // first failed attempt used to consume the only slot and lock the run out of ever recording it.
    const correlated = await correlateAuthority(
      a,
      runId,
      MISSION_B,
      proposal,
      {},
      `${runId}.complete-chain`,
    );
    expect(correlated.authorityObservation?.observationCode).toBe(
      'CORRELATED_APPROVED_ACTION_AND_INTENT',
    );
    expect(correlated.state).toBe('AUTHORITY_EVIDENCE_VALIDATED_FOR_REHEARSAL');
    expect(correlated.currentStepIndex).toBe(atGate + 1);
    expect(await countJao7RowsFor(a.pool, 'authority_observation', runId)).toBe(3);

    // Every attempt is in the audit trail, under its own attempt index at the same plan position.
    const attempts = correlated.steps.filter((step) => step.stepIndex === atGate);
    expect(attempts.map((step) => step.attemptIndex)).toStrictEqual([0, 1, 2]);
    for (const step of attempts) {
      expect(step.stepType).toBe('VALIDATE_AUTHORITY_EVIDENCE');
    }

    // And the trail NAMES the mutation correctly. Recording an authority correlation used to replay
    // under `FINALIZE_STEP`, so the audit trail said a step had been finalised when what had
    // happened was that Core evidence had been correlated.
    const kinds = await jao7ReplayKindsFor(a.pool, runId);
    expect(kinds).toContain('RECORD_AUTHORITY');
    expect(kinds).toContain('CLAIM_STEP');
    expect(kinds.filter((kind) => kind === 'RECORD_AUTHORITY')).toHaveLength(3);
    await a.close();
  });

  it('GA2 refuses a rehearsal that is not off a just-proven exact chain', async () => {
    // Defence in depth, checked directly. Even handed the plan position and a run to work with, the
    // rehearsal step refuses unless the claim moved the run OUT of the state a successful validation
    // produces -- which is what makes the proof "just" rather than "at some point".
    const a = startProcess('a');
    await createRun(a, runId, MISSION_B);
    const { proposal } = await driveToGate(a, runId, MISSION_B);
    await correlateAuthority(a, runId, MISSION_B, proposal);
    const view = await a.composition.store.readRun(runId);

    await expect(
      performJao7StepInternal(
        'REHEARSE_REVERSIBLE_EFFECT',
        capacityRequest(runId, `${runId}.sneak`, {
          proposal: carriedProposal(proposal),
        }) as never,
        capacityPolicy(),
        a.composition,
        view.run,
        'IN_PROGRESS',
        undefined,
        undefined,
      ),
    ).rejects.toMatchObject({ code: 'REHEARSAL_NOT_ELIGIBLE' });
    expect((await readJao7AutonomyRunInternal(runId, a.composition)).rehearsal?.state).toBe(
      'CAPTURED',
    );
    await a.close();
  });

  it('GA3 refuses a rehearsal off an authority observation that is not the exact chain', async () => {
    // The correlation happened, and concluded that Core approved the action WITHOUT issuing an
    // execution intent. That is a real state and it is not an execution chain: rehearsing it would
    // rehearse a step Core has not taken.
    const a = startProcess('a');
    await createRun(a, runId, MISSION_B);
    const { proposal } = await driveToGate(a, runId, MISSION_B);
    await resumeJao7AutonomyRunInternal(
      capacityRequest(runId, `${runId}.partial`, {
        proposal: carriedProposal(proposal),
        authority: { approvalDecision: approvalDecision(proposal) },
      }),
      a.composition,
    );
    const view = await a.composition.store.readRun(runId);
    expect(view.authority?.observationCode).toBe('CORRELATED_APPROVED_ACTION_WITHOUT_INTENT');

    await expect(
      performJao7StepInternal(
        'REHEARSE_REVERSIBLE_EFFECT',
        capacityRequest(runId, `${runId}.sneak`, {
          proposal: carriedProposal(proposal),
        }) as never,
        capacityPolicy(),
        a.composition,
        view.run,
        // Even handed the state a SUCCESSFUL validation produces, the recorded observation decides.
        'AUTHORITY_EVIDENCE_VALIDATED_FOR_REHEARSAL',
        undefined,
        undefined,
      ),
    ).rejects.toMatchObject({ code: 'REHEARSAL_NOT_ELIGIBLE' });
    expect((await readJao7AutonomyRunInternal(runId, a.composition)).rehearsal?.state).toBe(
      'CAPTURED',
    );
    await a.close();
  });

  it('GA4 refuses a rehearsal whose proven chain describes another run’s proposal', async () => {
    // The chain was proven -- for something else. Two runs proposing the same adjustment share an
    // action fingerprint, because the canonical fingerprint measures CONTENT, so the recommendation
    // and action ids are what separate them.
    const a = startProcess('a');
    await createRun(a, runId, MISSION_B);
    const mine = await driveToGate(a, runId, MISSION_B);
    await correlateAuthority(a, runId, MISSION_B, mine.proposal);
    const proven = await a.composition.store.readRun(runId);

    const otherRunId = aRunId();
    await createRun(a, otherRunId, MISSION_B);
    const theirs = await driveToGate(a, otherRunId, MISSION_B);
    const other = await a.composition.store.readRun(otherRunId);
    expect(other.run.proposalRecommendationId).not.toBe(proven.run.proposalRecommendationId);

    await expect(
      performJao7StepInternal(
        'REHEARSE_REVERSIBLE_EFFECT',
        capacityRequest(runId, `${runId}.crossed`, {
          proposal: carriedProposal(theirs.proposal),
        }) as never,
        capacityPolicy(),
        a.composition,
        // THIS run's proven observation, asked to authorise ANOTHER run's proposal identity.
        other.run,
        'AUTHORITY_EVIDENCE_VALIDATED_FOR_REHEARSAL',
        undefined,
        undefined,
      ),
    ).rejects.toMatchObject({ code: 'AUTHORITY_BINDING_MISMATCH' });
    await a.close();
  });

  it('GA5 bounds a rollback attempt in the adapter AND in the database', async () => {
    const a = startProcess('a');
    await createRun(a, runId, MISSION_B);
    const { proposal } = await driveToGate(a, runId, MISSION_B);
    await correlateAuthority(a, runId, MISSION_B, proposal);
    await advanceJao7AutonomyRunInternal(
      capacityRequest(runId, `${runId}.rehearse`, { proposal: carriedProposal(proposal) }),
      a.composition,
    );

    // A policy that permits NO attempt refuses one, against the durable counter rather than a
    // variable. `maxRollbackAttempts` used to appear on the policy and nowhere else.
    const view = await a.composition.store.readRun(runId);
    await expect(
      a.composition.store.mutateRehearsal(
        {
          runId,
          operationId: `${runId}.unbudgeted-rollback`,
          expectedRevision: view.run.revision,
          operationKind: 'ROLLBACK_REHEARSAL',
          nextRehearsalState: 'ROLLED_BACK',
          afterIntegerA: null,
          afterIntegerB: null,
          rollbackIntegerA: view.rehearsal?.beforeIntegerA ?? 0,
          rollbackIntegerB: null,
          maxRehearsalApplies: 1,
          maxRollbackAttempts: 0,
        },
        a.clock.nowMs(),
      ),
    ).rejects.toMatchObject({ code: 'BUDGET_EXHAUSTED' });
    expect((await a.composition.store.readRun(runId)).rehearsal?.state).toBe('APPLIED');

    // And the DATABASE refuses a counter outside the reviewed bound, whatever wrote it.
    await expect(
      jao7RawStatement(
        a.pool,
        'UPDATE $SCHEMA.virtual_rehearsal_state SET rollback_attempts = 2 WHERE run_id = $1',
        [runId],
      ),
    ).rejects.toThrow();
    await a.close();
  });

  it('GA6 refuses a rollback of a sandbox that was never applied, in the adapter', async () => {
    const a = startProcess('a');
    await createRun(a, runId, MISSION_B);
    const view = await a.composition.store.readRun(runId);
    expect(view.rehearsal?.state).toBe('CAPTURED');
    await expect(
      a.composition.store.mutateRehearsal(
        {
          runId,
          operationId: `${runId}.phantom-rollback`,
          expectedRevision: view.run.revision,
          operationKind: 'ROLLBACK_REHEARSAL',
          nextRehearsalState: 'ROLLED_BACK',
          afterIntegerA: null,
          afterIntegerB: null,
          rollbackIntegerA: 8,
          rollbackIntegerB: null,
          maxRehearsalApplies: 1,
          maxRollbackAttempts: 1,
        },
        a.clock.nowMs(),
      ),
    ).rejects.toMatchObject({ code: 'ROLLBACK_NOT_ELIGIBLE' });
    expect((await a.composition.store.readRun(runId)).rehearsal?.state).toBe('CAPTURED');
    await a.close();
  });

  // =========================================================================
  // SP. The specialist CONTRIBUTES.
  // =========================================================================

  it('SP1 derives a different remediation from a different Riya conclusion', async () => {
    // The proof that the delegation is not ceremonial. Nothing in the request names a task any
    // more; the only input that differs between these three runs is the closed client-sales
    // signals, and each drives Riya to a different disposition and therefore a different reviewed
    // remediation -- a different action, and a different fingerprint a human would approve.
    const a = startProcess('a');

    const handoverId = aRunId();
    await createRun(a, handoverId, MISSION_A);
    const handover = await driveToGate(a, handoverId, MISSION_A);
    expect(proposedParameters(handover.proposal)).toStrictEqual({
      ...DERIVED_HUMAN_HANDOVER_TASK,
    });

    const stalledId = aRunId();
    await createRun(a, stalledId, MISSION_A);
    const stalled = await driveToGate(a, stalledId, MISSION_A, {
      clientSalesSignals: { ...STALLED_SALES_SIGNALS },
    });
    expect(proposedParameters(stalled.proposal)).toStrictEqual({ ...DERIVED_STALLED_TASK });

    const readinessId = aRunId();
    await createRun(a, readinessId, MISSION_A);
    const readiness = await driveToGate(a, readinessId, MISSION_A, {
      clientSalesSignals: { ...READINESS_SALES_SIGNALS },
    });
    expect(proposedParameters(readiness.proposal)).toStrictEqual({ ...DERIVED_READINESS_TASK });

    // Three different actions, three different fingerprints.
    const fingerprints = new Set([
      handover.proposal.actionBindings[0].actionFingerprint,
      stalled.proposal.actionBindings[0].actionFingerprint,
      readiness.proposal.actionBindings[0].actionFingerprint,
    ]);
    expect(fingerprints.size).toBe(3);

    // The conclusion is DURABLE, and the advisory it came from is recorded as a digest.
    const dumped = await dumpJao7Run(a.pool, handoverId);
    expect(dumped).toContain('client-requested-human-assistance');
    expect(dumped).toContain('human-handover-review');
    await a.close();
  });

  it('SP2 fails closed when the advisory warrants no reviewed remediation', async () => {
    // Riya refuses an out-of-scope turn. Proposing an internal sales task anyway would be JAO-7
    // inventing a conclusion the specialist explicitly declined to reach.
    const a = startProcess('a');
    await createRun(a, runId, MISSION_A);
    await advanceJao7AutonomyRunInternal(
      advanceRequest(runId, `${runId}.validate`, {
        clientSalesSignals: { ...OUT_OF_SCOPE_SALES_SIGNALS },
      }),
      a.composition,
    );
    const refused = await advanceJao7AutonomyRunInternal(
      advanceRequest(runId, `${runId}.riya`, {
        clientSalesSignals: { ...OUT_OF_SCOPE_SALES_SIGNALS },
      }),
      a.composition,
    );
    expect(refused.refusalReason).toBe('SPECIALIST_ADVISORY_WITHOUT_REMEDIATION');
    expect(refused.outcome).toBe('REFUSED');
    expect(refused.state).toBe('FAILED_SAFE');
    // The specialist call was still charged -- it happened -- and no proposal exists.
    expect(refused.specialistCalls).toBe(1);
    const view = await a.composition.store.readRun(runId);
    expect(view.run.specialistAdvisoryDigest).toBeNull();
    expect(view.run.proposalActionFingerprint).toBeNull();
    await a.close();
  });

  // =========================================================================
  // SU. Action substitution.
  // =========================================================================

  it('SU1 refuses a carried proposal whose ACTION was rewritten under the same identity', async () => {
    // The identity strings used to be the whole check, and the fingerprint was read out of the
    // carried object rather than recomputed from it -- so a caller could rewrite the action
    // entirely, keep the three ids, and have that action rehearsed.
    const a = startProcess('a');
    await createRun(a, runId, MISSION_B);
    const { proposal } = await driveToGate(a, runId, MISSION_B);

    const original = carriedProposal(proposal);
    const action = proposal.recommendation.proposedActions[0];
    const substituted = {
      ...original,
      recommendation: {
        ...proposal.recommendation,
        proposedActions: [
          {
            ...action,
            // A DIFFERENT ADJUSTMENT, at the same identity, wearing the same fingerprint string.
            parameters: { ...(action?.parameters ?? {}), targetConcurrency: 32 },
          },
        ],
      },
    };

    const decision = approvalDecision(proposal);
    const result = await resumeJao7AutonomyRunInternal(
      capacityRequest(runId, `${runId}.substituted`, {
        proposal: substituted,
        authority: {
          approvalDecision: decision,
          executionIntent: executionIntent(proposal, decision),
        },
      }),
      a.composition,
    );
    expect(result.refusalReason).toBe('AUTHORITY_BINDING_MISMATCH');
    expect(result.authorityObservation).toBeNull();
    expect(result.rehearsal?.state).toBe('CAPTURED');
    await a.close();
  });

  it('SU2 refuses a carried proposal that is not a canonical artifact at all', async () => {
    const a = startProcess('a');
    await createRun(a, runId, MISSION_B);
    const { proposal } = await driveToGate(a, runId, MISSION_B);
    const binding = proposal.actionBindings[0];

    // The shape the old check would have accepted: the three identity strings, and nothing else.
    const decision = approvalDecision(proposal);
    const result = await resumeJao7AutonomyRunInternal(
      capacityRequest(runId, `${runId}.hollow`, {
        proposal: {
          recommendation: { recommendationId: binding.recommendationId },
          actionBindings: [{ ...binding }],
          approvalRequest: { recommendationId: binding.recommendationId },
        },
        authority: {
          approvalDecision: decision,
          executionIntent: executionIntent(proposal, decision),
        },
      }),
      a.composition,
    );
    expect(result.refusalReason).toBe('REQUEST_INVALID');
    expect(result.authorityObservation).toBeNull();
    await a.close();
  });

  // =========================================================================
  // TC. Terminal safety cleanup. It cleans; it resurrects nothing.
  // =========================================================================

  it('TC1 cleans a FAILED_SAFE run’s sandbox and leaves it FAILED_SAFE', async () => {
    // THE RESURRECTION. `mutateRehearsal` decided whether to preserve a terminal run state by
    // comparing against KILLED, EXPIRED and COMPLETED -- three of the four members of the closed
    // terminal vocabulary. FAILED_SAFE was missing, so a successful safety rollback moved a
    // failed-safe run to ROLLING_BACK and made it forward-eligible again.
    const a = startProcess('a');
    await driveToDirtyFailSafe(a, runId);

    const cleaned = await rollbackJao7AutonomyRehearsalInternal(
      { runId, operationId: `${runId}.safety-cleanup` },
      a.composition,
    );
    expect(cleaned.rehearsal?.state).toBe('ROLLED_BACK');
    expect(cleaned.rehearsal?.rollbackIntegerA).toBe(8);
    expect(cleaned.rehearsal?.rollbackAttempts).toBe(1);
    // STILL FAILED_SAFE. Not ROLLING_BACK, not IN_PROGRESS, not anything a plan could continue from.
    expect(cleaned.state).toBe('FAILED_SAFE');
    expect(cleaned.outcome).toBe('FAILED_SAFE');

    // And the plan is not reopened: forward work is refused exactly as it was before the cleanup.
    await expect(
      advanceJao7AutonomyRunInternal(capacityRequest(runId, `${runId}.after`), a.composition),
    ).rejects.toMatchObject({ code: 'STATE_CONFLICT' });
    await expect(
      resumeJao7AutonomyRunInternal(capacityRequest(runId, `${runId}.revive`), a.composition),
    ).rejects.toMatchObject({ code: 'STATE_CONFLICT' });

    // A second attempt remains impossible, and no caller may aim the first one.
    await expect(
      rollbackJao7AutonomyRehearsalInternal(
        { runId, operationId: `${runId}.again` },
        a.composition,
      ),
    ).rejects.toMatchObject({ code: 'ROLLBACK_NOT_ELIGIBLE' });
    await a.close();

    // A NEW process reads back exactly that. The terminal state survives the restart.
    const b = startProcess('b');
    const persisted = await readJao7AutonomyRunInternal(runId, b.composition);
    expect(persisted.state).toBe('FAILED_SAFE');
    expect(persisted.outcome).toBe('FAILED_SAFE');
    expect(persisted.rehearsal?.state).toBe('ROLLED_BACK');
    await b.close();
  });

  it('TC2 keeps a FAILED_SAFE run FAILED_SAFE when the cleanup itself fails', async () => {
    const a = startProcess('a');
    await driveToDirtyFailSafe(a, runId);

    const broken = startProcess('broken', { corruptRollback: true });
    const failed = await rollbackJao7AutonomyRehearsalInternal(
      { runId, operationId: `${runId}.broken-cleanup` },
      broken.composition,
    );
    await broken.close();

    expect(failed.rehearsal?.state).toBe('ROLLBACK_FAILED');
    expect(failed.rehearsal?.rollbackAttemptedAt).not.toBeNull();
    expect(failed.rehearsal?.rolledBackAt).toBeNull();
    expect(failed.rehearsal?.rollbackAttempts).toBe(1);
    // A failed cleanup does not move a terminal run to a DIFFERENT terminal state either.
    expect(failed.state).toBe('FAILED_SAFE');
    await a.close();
  });

  it('TC3 refuses the PUBLIC safety verb on a healthy active run', async () => {
    // The public safety verb used to require only that the sandbox was APPLIED, so a caller could
    // invoke it against a run that was simply between its rehearsal and its verification -- and the
    // successful cleanup left that run ROLLING_BACK and still forward-eligible. That is a second way
    // to steer the happy path, which is what "cleanup must not reopen plan execution" rules out.
    const a = startProcess('a');
    await createRun(a, runId, MISSION_B);
    const { proposal } = await driveToGate(a, runId, MISSION_B);
    await correlateAuthority(a, runId, MISSION_B, proposal);
    const applied = await advanceJao7AutonomyRunInternal(
      capacityRequest(runId, `${runId}.rehearse`, { proposal: carriedProposal(proposal) }),
      a.composition,
    );
    expect(applied.state).toBe('REHEARSAL_APPLIED');

    await expect(
      rollbackJao7AutonomyRehearsalInternal(
        { runId, operationId: `${runId}.premature` },
        a.composition,
      ),
    ).rejects.toMatchObject({ code: 'STATE_CONFLICT' });

    // Nothing moved. The sandbox is exactly as the rehearsal left it.
    const untouched = await readJao7AutonomyRunInternal(runId, a.composition);
    expect(untouched.state).toBe('REHEARSAL_APPLIED');
    expect(untouched.rehearsal?.state).toBe('APPLIED');
    expect(untouched.rehearsal?.rollbackAttempts).toBe(0);

    // And the NORMAL path still works: verification completes the run as it always did.
    const verified = await advanceJao7AutonomyRunInternal(
      capacityRequest(runId, `${runId}.verify`, { proposal: carriedProposal(proposal) }),
      a.composition,
    );
    expect(verified.rehearsal?.state).toBe('VERIFIED');
    await a.close();
  });

  it('TC4 cleans up after wall-clock expiry and reports the run as EXPIRED', async () => {
    // Expiry that nobody has written down yet is still expiry. Refusing cleanup until some other
    // call materialises EXPIRED would strand the sandbox on a technicality -- and returning
    // afterwards without materialising it would describe an expired run as live.
    const a = startProcess('a');
    await createRun(a, runId, MISSION_B);
    const { proposal } = await driveToGate(a, runId, MISSION_B);
    await correlateAuthority(a, runId, MISSION_B, proposal);
    await advanceJao7AutonomyRunInternal(
      capacityRequest(runId, `${runId}.rehearse`, { proposal: carriedProposal(proposal) }),
      a.composition,
    );

    // The capacity mission lives 24 hours. One hour past that, nothing has materialised EXPIRED.
    a.clock.advance(25 * 60 * 60 * 1_000);
    expect((await readJao7AutonomyRunInternal(runId, a.composition)).state).toBe(
      'REHEARSAL_APPLIED',
    );

    const cleaned = await rollbackJao7AutonomyRehearsalInternal(
      { runId, operationId: `${runId}.expired-cleanup` },
      a.composition,
    );
    expect(cleaned.rehearsal?.state).toBe('ROLLED_BACK');
    expect(cleaned.rehearsal?.rollbackIntegerA).toBe(8);
    // MATERIALISED, in the transaction that observed it. Not IN_PROGRESS, not ROLLING_BACK.
    expect(cleaned.state).toBe('EXPIRED');
    expect(cleaned.outcome).toBe('EXPIRED');

    const b = startProcess('b');
    b.clock.advance(25 * 60 * 60 * 1_000);
    const persisted = await readJao7AutonomyRunInternal(runId, b.composition);
    expect(persisted.state).toBe('EXPIRED');
    expect(persisted.rehearsal?.state).toBe('ROLLED_BACK');
    await b.close();
    await a.close();
  });

  it('TC5 leaves the evaluator-driven rollback branch working exactly as before', async () => {
    // The INTERNAL recovery path is untouched. A failed verification still takes the run to
    // ROLLING_BACK, the next advance still claims the rollback step, and the run still completes.
    const a = startProcess('a');
    await createRun(a, runId, MISSION_B);
    const { proposal } = await driveToGate(a, runId, MISSION_B);
    await correlateAuthority(a, runId, MISSION_B, proposal);
    await advanceJao7AutonomyRunInternal(
      capacityRequest(runId, `${runId}.rehearse`, { proposal: carriedProposal(proposal) }),
      a.composition,
    );

    const faulty = startProcess('faulty', { corruptRehearsalObservation: true });
    const failed = await advanceJao7AutonomyRunInternal(
      capacityRequest(runId, `${runId}.verify`, { proposal: carriedProposal(proposal) }),
      faulty.composition,
    );
    await faulty.close();
    expect(failed.state).toBe('ROLLING_BACK');

    const rolledBack = await advanceJao7AutonomyRunInternal(
      capacityRequest(runId, `${runId}.rollback`, { proposal: carriedProposal(proposal) }),
      a.composition,
    );
    expect(rolledBack.state).toBe('COMPLETED');
    expect(rolledBack.rehearsal?.state).toBe('ROLLED_BACK');
    expect(rolledBack.outcome).toBe('ROLLED_BACK_REHEARSAL');
    await a.close();
  });

  // =========================================================================
  // RI. The result must not describe a run it cannot explain.
  // =========================================================================

  it('RI1 refuses to report a COMPLETED run whose sandbox contradicts it', async () => {
    // The completed branch used to read "rolled back, or else completed", so a COMPLETED run beside
    // an APPLIED sandbox was reported as COMPLETED_REHEARSAL. That is a contradiction between two
    // tables, and a result that reads correctly and is wrong is worse than one that refuses.
    const a = startProcess('a');
    await createRun(a, runId, MISSION_B);
    const { proposal } = await driveToGate(a, runId, MISSION_B);
    await correlateAuthority(a, runId, MISSION_B, proposal);
    for (const step of ['rehearse', 'verify', 'complete']) {
      await advanceJao7AutonomyRunInternal(
        capacityRequest(runId, `${runId}.${step}`, { proposal: carriedProposal(proposal) }),
        a.composition,
      );
    }
    const completed = await readJao7AutonomyRunInternal(runId, a.composition);
    expect(completed.state).toBe('COMPLETED');
    expect(completed.rehearsal?.state).toBe('VERIFIED');
    expect(completed.outcome).toBe('COMPLETED_REHEARSAL');

    // Corrupt ONE durable fact, leaving every per-row constraint satisfied. The contradiction is
    // between the run and its sandbox, which is precisely what no single row can catch.
    await jao7RawStatement(
      a.pool,
      "UPDATE $SCHEMA.virtual_rehearsal_state SET state = 'APPLIED' WHERE run_id = $1",
      [runId],
    );
    await expect(readJao7AutonomyRunInternal(runId, a.composition)).rejects.toMatchObject({
      code: 'RESULT_INVALID',
    });
    await a.close();
  });

  // =========================================================================
  // RP. Replay identifies the exact attempt it created.
  // =========================================================================

  it('RP1 replays the attempt THIS operation id created, not the latest one', async () => {
    // A retained plan position is attempted again, so "the latest attempt at this step index" and
    // "the attempt this operation id created" stop being the same row. Replaying an old claim would
    // then have described somebody else's attempt under the old attempt's own operation id.
    const a = startProcess('a');
    await createRun(a, runId, MISSION_B);
    const { latest, proposal } = await driveToGate(a, runId, MISSION_B);
    const gateIndex = latest.currentStepIndex;

    // Attempt 0: an approved action with no Core-issued intent. The plan position is RETAINED.
    await resumeJao7AutonomyRunInternal(
      capacityRequest(runId, `${runId}.first`, {
        proposal: carriedProposal(proposal),
        authority: { approvalDecision: approvalDecision(proposal) },
      }),
      a.composition,
    );
    // Attempt 1: the same, again.
    await resumeJao7AutonomyRunInternal(
      capacityRequest(runId, `${runId}.second`, {
        proposal: carriedProposal(proposal),
        authority: { approvalDecision: approvalDecision(proposal) },
      }),
      a.composition,
    );
    const view = await a.composition.store.readRun(runId);
    expect(view.steps.filter((step) => step.stepIndex === gateIndex)).toHaveLength(2);

    // THE OLD CLAIM, replayed. Its operation id is the one the FIRST attempt was claimed under.
    const claim = {
      runId,
      operationId: `${runId}.first.claim`,
      // The revision has moved on twice since. It is deliberately not part of the claim digest.
      expectedRevision: view.run.revision,
      planDigest: view.run.planDigest,
      stepIndex: gateIndex,
      stepType: 'VALIDATE_AUTHORITY_EVIDENCE' as const,
      charge: 'NONE' as const,
      toolCallCount: 0,
      maxSpecialistCalls: 0,
      maxToolCalls: 2,
      maxSteps: 12,
    };
    const replayed = await a.composition.store.claimStep(claim, a.clock.nowMs());
    expect(replayed.replayed).toBe(true);
    expect(replayed.step.attemptIndex).toBe(0);
    expect(replayed.step.stepStatus).toBe('COMPLETED');

    // The second attempt's own id still identifies the second attempt.
    const second = await a.composition.store.claimStep(
      { ...claim, operationId: `${runId}.second.claim` },
      a.clock.nowMs(),
    );
    expect(second.replayed).toBe(true);
    expect(second.step.attemptIndex).toBe(1);

    // And nothing was written by either replay.
    expect(await countJao7RowsFor(a.pool, 'autonomy_step', runId)).toBe(
      (await a.composition.store.readRun(runId)).steps.length,
    );
    await a.close();
  });

  it('RP2 refuses a replay whose claimed attempt no longer exists', async () => {
    const a = startProcess('a');
    await createRun(a, runId, MISSION_B);
    const view = await a.composition.store.readRun(runId);
    const claim = {
      runId,
      operationId: `${runId}.claim`,
      expectedRevision: view.run.revision,
      planDigest: view.run.planDigest,
      stepIndex: 0,
      stepType: 'VALIDATE_INPUT' as const,
      charge: 'NONE' as const,
      toolCallCount: 0,
      maxSpecialistCalls: 0,
      maxToolCalls: 2,
      maxSteps: 12,
    };
    await a.composition.store.claimStep(claim, a.clock.nowMs());

    // The replay record survives; the attempt it names does not. The claim wrote both in ONE
    // transaction, so this state is impossible to reach honestly -- and describing a neighbouring
    // attempt as though it were this one would be worse than refusing.
    await jao7RawStatement(
      a.pool,
      'DELETE FROM $SCHEMA.autonomy_step WHERE run_id = $1 AND step_index = 0',
      [runId],
    );
    await expect(a.composition.store.claimStep(claim, a.clock.nowMs())).rejects.toMatchObject({
      code: 'PERSISTED_STATE_INVALID',
    });
    await a.close();
  });
});
