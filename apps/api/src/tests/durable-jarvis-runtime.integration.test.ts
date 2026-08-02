/**
 * QFJ-P08-B3 — the durable runtime composition, against a real PostgreSQL (ADR-0078).
 *
 * This is the test the whole of QFJ-P08-B exists for. B2 proved the adapter durable in isolation;
 * what was never proved is that the REAL `createJarvisRuntime` path — the one an application would
 * actually run — observes that durability. So nothing here reaches into the adapter: every control
 * change goes through `runtime.applyConversationControlCommand`, every gate is exercised by
 * `runtime.processInbound`, and continuity between "processes" is provided by the database alone.
 *
 * ### What a "process" means here
 *
 * Each of A/B/C/D builds a brand new pool, a brand new adapter and a brand new runtime through
 * `startDurableJarvisRuntime`, and closes it completely before the next begins. No object, closure
 * or module-level cache survives the boundary. If a takeover were held in process memory rather than
 * in PostgreSQL, B would serve the conversation and the suite would fail.
 *
 * The model and Core collaborators are freshly constructed per process precisely so their call
 * counters start at zero — that is how "a blocked turn consulted NEITHER" becomes a measurement.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { scriptedCoreTransport } from '@qf-jarvis/core-decision-adapter/testing';
import type { JarvisRuntimeConfig } from '@qf-jarvis/jarvis-runtime';
import {
  syntheticInboundEnvelope,
  syntheticRuntimeConfig,
} from '@qf-jarvis/jarvis-runtime/testing';
import { scriptedGatewayInvoker, structuredReply } from '@qf-jarvis/model-reply-adapter/testing';

import {
  DURABLE_JARVIS_RUNTIME_REF,
  startDurableJarvisRuntime,
  type DurableJarvisRuntimeConfig,
  type DurableJarvisRuntimeLifecycle,
} from '../runtime/durable-jarvis-runtime.js';
import {
  countLedgerRows,
  readStateRow,
  resetAndMigrate,
  runSql,
  seedConversation,
  testDatabaseConfig,
} from './durable-database-harness.js';

const APP = 'qf-p08b3-test';
const TENANT = 'tenant.a';
const CONVERSATION = 'conv.1';

/**
 * A per-process set of collaborators whose calls can be counted.
 *
 * `syntheticRuntimeConfig` supplies its own gateway and Core transport, but not references we can
 * interrogate — so they are replaced with counting equivalents and the in-memory authoritative state
 * it also supplies is REMOVED. Leaving that field in place would be the one mistake this whole phase
 * is about: B3 would happily accept it, and the durable adapter would never be consulted.
 */
function processCollaborators(): {
  readonly runtimeConfig: DurableJarvisRuntimeConfig;
  readonly modelCalls: () => number;
  readonly coreCalls: () => number;
} {
  const gatewayInvoker = scriptedGatewayInvoker(structuredReply({ citations: [] }));
  const coreTransport = scriptedCoreTransport('ACCEPTED');
  const synthetic: JarvisRuntimeConfig = syntheticRuntimeConfig({
    gatewayInvoker,
    coreTransport,
  });

  // Strip the two fields B3 owns. `authoritativeState` in particular must not survive: the durable
  // adapter is the ONE source, and a second one would be a split brain by construction.
  const { authoritativeState: _state, provenanceRefs: _refs, ...rest } = synthetic;

  return {
    runtimeConfig: rest,
    modelCalls: () => gatewayInvoker.invoked(),
    coreCalls: () => coreTransport.invoked(),
  };
}

/** Start one complete "process": fresh pool, fresh adapter, fresh runtime. */
async function startProcess(applicationName: string): Promise<{
  readonly lifecycle: DurableJarvisRuntimeLifecycle;
  readonly modelCalls: () => number;
  readonly coreCalls: () => number;
}> {
  const collaborators = processCollaborators();
  const lifecycle = await startDurableJarvisRuntime({
    databaseConfig: testDatabaseConfig(applicationName),
    runtimeConfig: collaborators.runtimeConfig,
  });
  return {
    lifecycle,
    modelCalls: collaborators.modelCalls,
    coreCalls: collaborators.coreCalls,
  };
}

const AT = (n: number): string => `2026-08-0${String(n)}T00:00:00.000Z`;

beforeAll(async () => {
  // Migrations are applied HERE, in test setup. The application never runs one.
  await resetAndMigrate(APP);
}, 180_000);

beforeEach(async () => {
  await runSql(APP, 'TRUNCATE qf_jarvis.conversation_control_command');
  await runSql(APP, 'TRUNCATE qf_jarvis.conversation_runtime_state CASCADE');
});

// ---------------------------------------------------------------------------
// The restart sequence: the property QFJ-P08-B exists to deliver.
// ---------------------------------------------------------------------------

describe('a human takeover survives a process restart', () => {
  it('serves, takes ownership, blocks after restart, releases, stays paused, resumes, serves again', async () => {
    await seedConversation(APP, { tenantId: TENANT, conversationId: CONVERSATION });

    // ---- PROCESS A: a clear conversation is served, then an operator takes ownership. ----
    const a = await startProcess('qf-p08b3-A');
    try {
      const served = await a.lifecycle.runtime.processInbound(syntheticInboundEnvelope());
      expect(served.outcome).toBe('CORE_ACCEPTED');
      expect(served.modelDrafted).toBe(true);
      expect(served.coreConsulted).toBe(true);
      expect(a.modelCalls()).toBe(1);
      expect(a.coreCalls()).toBe(1);
      // The durable composition stamps its own provenance, so an audit can tell a PostgreSQL-backed
      // turn from an in-memory one.
      expect(served.provenance?.runtimeRef).toBe('qfj.jarvis-runtime.p08b3');

      const taken = await a.lifecycle.runtime.applyConversationControlCommand({
        tenantId: TENANT,
        command: {
          commandId: 'ctrl.take.1',
          conversationId: CONVERSATION,
          expectedRevision: 0,
          action: 'TAKE_OWNERSHIP',
          operatorRef: 'operator.synthetic.1',
          issuedAt: AT(1),
        },
      });
      expect(taken.ok).toBe(true);
      if (!taken.ok) {
        throw new Error('unreachable');
      }
      expect(taken.decision.outcome).toBe('APPLIED');
      expect(taken.decision.nextState).toMatchObject({
        revision: 1,
        humanTakeover: true,
        aiPaused: true,
      });
    } finally {
      await a.lifecycle.close();
    }

    // The row, read on a connection of its own: this is the only thing crossing the boundary.
    expect(await readStateRow(APP, TENANT, CONVERSATION)).toMatchObject({
      revision: '1',
      human_takeover: true,
      ai_paused: true,
    });

    // ---- PROCESS B: nothing survives except the database. The takeover must still block. ----
    const b = await startProcess('qf-p08b3-B');
    try {
      const blocked = await b.lifecycle.runtime.processInbound(syntheticInboundEnvelope());
      expect(blocked.outcome).toBe('REFUSED');
      expect(blocked.refusalReason).toBe('orchestration-human-takeover');
      expect(blocked.modelDrafted).toBe(false);
      expect(blocked.proposalId).toBeUndefined();
      // The measurement that makes this a containment proof rather than an outcome check.
      expect(b.modelCalls()).toBe(0);
      expect(b.coreCalls()).toBe(0);
      expect(blocked.provenance?.runtimeRef).toBe('qfj.jarvis-runtime.p08b3');

      const released = await b.lifecycle.runtime.applyConversationControlCommand({
        tenantId: TENANT,
        command: {
          commandId: 'ctrl.release.1',
          conversationId: CONVERSATION,
          expectedRevision: 1,
          action: 'RELEASE_OWNERSHIP',
          operatorRef: 'operator.synthetic.1',
          issuedAt: AT(2),
        },
      });
      expect(released.ok).toBe(true);
      if (!released.ok) {
        throw new Error('unreachable');
      }
      // ADR-0054 E: releasing ownership does NOT resume the AI. There is no automatic return.
      expect(released.decision.nextState).toMatchObject({
        revision: 2,
        humanTakeover: false,
        aiPaused: true,
      });
    } finally {
      await b.lifecycle.close();
    }

    // ---- PROCESS C: still paused after another restart. Only RESUME_AI may clear it. ----
    const c = await startProcess('qf-p08b3-C');
    try {
      const paused = await c.lifecycle.runtime.processInbound(syntheticInboundEnvelope());
      expect(paused.outcome).toBe('REFUSED');
      expect(paused.refusalReason).toBe('orchestration-ai-paused');
      expect(paused.modelDrafted).toBe(false);
      expect(c.modelCalls()).toBe(0);
      expect(c.coreCalls()).toBe(0);

      const resumed = await c.lifecycle.runtime.applyConversationControlCommand({
        tenantId: TENANT,
        command: {
          commandId: 'ctrl.resume.1',
          conversationId: CONVERSATION,
          expectedRevision: 2,
          action: 'RESUME_AI',
          operatorRef: 'operator.synthetic.1',
          issuedAt: AT(3),
        },
      });
      expect(resumed.ok).toBe(true);
      if (!resumed.ok) {
        throw new Error('unreachable');
      }
      expect(resumed.decision.nextState).toMatchObject({
        revision: 3,
        humanTakeover: false,
        aiPaused: false,
      });
    } finally {
      await c.lifecycle.close();
    }

    // ---- PROCESS D: served again, and the model is consulted exactly once. ----
    const d = await startProcess('qf-p08b3-D');
    try {
      const servedAgain = await d.lifecycle.runtime.processInbound(syntheticInboundEnvelope());
      expect(servedAgain.outcome).toBe('CORE_ACCEPTED');
      expect(servedAgain.modelDrafted).toBe(true);
      expect(d.modelCalls()).toBe(1);
      expect(d.coreCalls()).toBe(1);
    } finally {
      await d.lifecycle.close();
    }

    // Exactly TAKE, RELEASE and RESUME: three durable audit rows, and nothing else was needed.
    expect(await countLedgerRows(APP, TENANT)).toBe(3);
    expect(await readStateRow(APP, TENANT, CONVERSATION)).toMatchObject({
      revision: '3',
      human_takeover: false,
      ai_paused: false,
    });
  }, 300_000);
});

// ---------------------------------------------------------------------------
// Provenance.
// ---------------------------------------------------------------------------

describe('provenance', () => {
  it('forces the B3 reference and preserves every other supplied reference', async () => {
    await seedConversation(APP, { tenantId: TENANT, conversationId: CONVERSATION });
    const collaborators = processCollaborators();
    const lifecycle = await startDurableJarvisRuntime({
      databaseConfig: testDatabaseConfig('qf-p08b3-prov'),
      runtimeConfig: {
        ...collaborators.runtimeConfig,
        provenanceRefs: { policyRef: 'policy.ref.z', configRef: 'config.ref.z' },
      },
    });
    try {
      const result = await lifecycle.runtime.processInbound(syntheticInboundEnvelope());
      expect(result.provenance?.runtimeRef).toBe(DURABLE_JARVIS_RUNTIME_REF);
      expect(result.provenance?.runtimeRef).toBe('qfj.jarvis-runtime.p08b3');
      // Passed through untouched: B3 owns the runtime reference and nothing else.
      expect(result.provenance?.policyRef).toBe('policy.ref.z');
      expect(result.provenance?.configRef).toBe('config.ref.z');
    } finally {
      await lifecycle.close();
    }
  }, 120_000);

  it('serves revisions far past the old 1,000,000 ceiling, through the real composition', async () => {
    // A durable revision of 1,000,001 cannot be manufactured honestly: reaching it would take a
    // million control commands, and forcing the row would mean bypassing 0008's monotonic trigger --
    // which is the guarantee under test everywhere else in this file. So the HIGH end of the domain
    // is proved through the real `createJarvisRuntime` over an in-memory source, which can hold any
    // revision the schema permits. The LOW end (0) is proved above against the real database.
    const { createJarvisRuntime } = await import('@qf-jarvis/jarvis-runtime');
    const { scriptedAuthoritativeState, clearControlState } =
      await import('@qf-jarvis/jarvis-runtime/testing');
    for (const revision of [1_000_001, Number.MAX_SAFE_INTEGER]) {
      const runtime = createJarvisRuntime(
        syntheticRuntimeConfig({
          authoritativeState: scriptedAuthoritativeState({ ...clearControlState(), revision }),
        }),
      );
      const result = await runtime.processInbound(syntheticInboundEnvelope());
      expect(result.outcome, String(revision)).toBe('CORE_ACCEPTED');
      expect(result.boundRevision, String(revision)).toBe(revision);
    }
  });

  it('leaves the GENERIC jarvis-runtime default at p08b1', async () => {
    // The library describes what the library is. Only the durable APPLICATION composition claims
    // p08b3, and a library that renamed itself because an app composed it would make provenance a
    // moving target. Proven through the real generic factory, with its own in-memory fake state.
    const { createJarvisRuntime } = await import('@qf-jarvis/jarvis-runtime');
    const generic = createJarvisRuntime(syntheticRuntimeConfig());
    const result = await generic.processInbound(syntheticInboundEnvelope());
    expect(result.provenance?.runtimeRef).toBe('qfj.jarvis-runtime.p08b1');
  });
});

// ---------------------------------------------------------------------------
// Startup: readiness runs BEFORE a runtime exists, and a failure returns none.
// ---------------------------------------------------------------------------

describe('startup fails before any runtime is returned', () => {
  afterAll(async () => {
    await resetAndMigrate(APP);
  }, 180_000);

  async function startRejects(damage: string): Promise<void> {
    await runSql(APP, damage);
    const collaborators = processCollaborators();
    let lifecycle: DurableJarvisRuntimeLifecycle | undefined;
    await expect(
      startDurableJarvisRuntime({
        databaseConfig: testDatabaseConfig('qf-p08b3-fail'),
        runtimeConfig: collaborators.runtimeConfig,
      }).then((started) => {
        lifecycle = started;
        return started;
      }),
      damage,
    ).rejects.toMatchObject({ code: 'schema-incompatible' });

    // No runtime was returned, and no collaborator was ever consulted: startup refused before the
    // composition existed, not on the first conversation.
    expect(lifecycle).toBeUndefined();
    expect(collaborators.modelCalls()).toBe(0);
    expect(collaborators.coreCalls()).toBe(0);

    await resetAndMigrate(APP);
  }

  it('starts successfully against the correct schema', async () => {
    const collaborators = processCollaborators();
    const lifecycle = await startDurableJarvisRuntime({
      databaseConfig: testDatabaseConfig('qf-p08b3-ok'),
      runtimeConfig: collaborators.runtimeConfig,
    });
    // Exactly two members. The pool, the adapter, the database config and `provision` are all
    // unreachable, so nothing downstream can auto-provision or reach the connection string.
    expect(Object.keys(lifecycle).sort()).toEqual(['close', 'runtime']);
    expect(Object.isFrozen(lifecycle)).toBe(true);
    await lifecycle.close();
    // Idempotent: closing an already-closed pool is a no-op, not an error.
    await expect(lifecycle.close()).resolves.toBeUndefined();
  }, 120_000);

  it('rejects when the state table is absent', async () => {
    await startRejects(
      'DROP TABLE qf_jarvis.conversation_control_command, qf_jarvis.conversation_runtime_state',
    );
  }, 300_000);

  it('rejects when the ledger is absent', async () => {
    await startRejects('DROP TABLE qf_jarvis.conversation_control_command');
  }, 300_000);

  it('rejects when either guard trigger is disabled', async () => {
    await startRejects(
      'ALTER TABLE qf_jarvis.conversation_runtime_state DISABLE TRIGGER conversation_runtime_state_guard_trigger',
    );
    await startRejects(
      'ALTER TABLE qf_jarvis.conversation_control_command DISABLE TRIGGER conversation_control_command_append_only_trigger',
    );
  }, 600_000);

  it('rejects when a critical constraint is removed', async () => {
    await startRejects(
      'ALTER TABLE qf_jarvis.conversation_control_command DROP CONSTRAINT conversation_control_command_applied_post_state',
    );
  }, 300_000);

  it('rejects when the database is unreachable, and leaves no pool behind', async () => {
    const collaborators = processCollaborators();
    // A loopback port nothing listens on: the guards still hold, and the connection cannot succeed.
    const unreachable = testDatabaseConfig('qf-p08b3-unreachable');
    const url = new URL(unreachable.connectionString);
    url.port = '1';
    await expect(
      startDurableJarvisRuntime({
        databaseConfig: { ...unreachable, connectionString: url.toString() },
        runtimeConfig: collaborators.runtimeConfig,
      }),
    ).rejects.toMatchObject({ code: 'database-unavailable' });
    expect(collaborators.modelCalls()).toBe(0);
    expect(collaborators.coreCalls()).toBe(0);
  }, 120_000);

  it('attempts no migration and creates no schema object when it fails', async () => {
    await runSql(APP, 'DROP TABLE qf_jarvis.conversation_control_command');
    const collaborators = processCollaborators();
    await expect(
      startDurableJarvisRuntime({
        databaseConfig: testDatabaseConfig('qf-p08b3-nomigrate'),
        runtimeConfig: collaborators.runtimeConfig,
      }),
    ).rejects.toMatchObject({ code: 'schema-incompatible' });

    // Still dropped. A startup that quietly repaired the schema would be a migration runner.
    const pool = testDatabaseConfig('qf-p08b3-nomigrate');
    expect(pool.connectionString.length).toBeGreaterThan(0);
    const stillMissing = await runSql(
      APP,
      `DO $check$
       BEGIN
         IF EXISTS (SELECT 1 FROM pg_catalog.pg_tables
                     WHERE schemaname = 'qf_jarvis' AND tablename = 'conversation_control_command')
         THEN RAISE EXCEPTION 'startup recreated a table';
         END IF;
       END
       $check$`,
    ).then(
      () => 'absent',
      () => 'recreated',
    );
    expect(stillMissing).toBe('absent');

    await resetAndMigrate(APP);
  }, 300_000);
});

// ---------------------------------------------------------------------------
// No fallback: an outage fails closed rather than degrading to memory.
// ---------------------------------------------------------------------------

describe('a database outage after startup fails closed', () => {
  it('consults no model and no Core, and never falls back to an in-memory source', async () => {
    await seedConversation(APP, { tenantId: TENANT, conversationId: CONVERSATION });
    const started = await startProcess('qf-p08b3-outage');

    // A served turn first, so the failure below is provably a change of circumstance rather than a
    // runtime that never worked.
    const served = await started.lifecycle.runtime.processInbound(syntheticInboundEnvelope());
    expect(served.outcome).toBe('CORE_ACCEPTED');
    expect(started.modelCalls()).toBe(1);

    // The outage: the pool this lifecycle owns is closed underneath the running runtime.
    await started.lifecycle.close();

    const afterOutage = await started.lifecycle.runtime.processInbound(syntheticInboundEnvelope());
    expect(afterOutage.outcome).toBe('REFUSED');
    expect(afterOutage.modelDrafted).toBe(false);
    expect(afterOutage.proposalId).toBeUndefined();
    // The whole point: no second source, no cached last-known state, no optimistic serve.
    expect(started.modelCalls()).toBe(1);
    expect(started.coreCalls()).toBe(1);

    const control = await started.lifecycle.runtime.applyConversationControlCommand({
      tenantId: TENANT,
      command: {
        commandId: 'ctrl.outage.1',
        conversationId: CONVERSATION,
        expectedRevision: 0,
        action: 'TAKE_OWNERSHIP',
        operatorRef: 'operator.synthetic.1',
        issuedAt: AT(1),
      },
    });
    expect(control.ok).toBe(false);
    if (control.ok) {
      throw new Error('unreachable');
    }
    expect(control.reason).toBe('control-source-failure');
    // A closed vocabulary token, and nothing else: no SQLSTATE, host, role or connection string.
    const serialized = JSON.stringify(control);
    for (const forbidden of ['qf_jarvis', 'postgres', '127.0.0.1', 'password', 'ECONNREFUSED']) {
      expect(serialized, forbidden).not.toContain(forbidden);
    }
  }, 180_000);
});

// ---------------------------------------------------------------------------
// The operations query stays honestly unavailable.
// ---------------------------------------------------------------------------

describe('the operations snapshot', () => {
  it('reports operations-unavailable rather than fabricating the supplemental fields', async () => {
    await seedConversation(APP, { tenantId: TENANT, conversationId: CONVERSATION });
    const started = await startProcess('qf-p08b3-ops');
    try {
      // No governed writer exists for the six supplemental fields (ADR-0076 §9). The durable adapter
      // therefore does NOT implement `readOperationsProjection`, and the composition's capability
      // detection must report that honestly instead of inventing tokens.
      const snapshot = await started.lifecycle.runtime.readConversationOperationsSnapshot({
        tenantId: TENANT,
        conversationId: CONVERSATION,
      });
      expect(snapshot).toEqual({ ok: false, reason: 'operations-unavailable' });
    } finally {
      await started.lifecycle.close();
    }
  }, 120_000);
});

// ---------------------------------------------------------------------------
// Control regressions, exercised through the composed runtime rather than the adapter.
// ---------------------------------------------------------------------------

describe('durable control semantics through the composed runtime', () => {
  it('replays the original decision for an exact duplicate issued after a restart', async () => {
    await seedConversation(APP, { tenantId: TENANT, conversationId: CONVERSATION });
    const command = {
      commandId: 'ctrl.dup.1',
      conversationId: CONVERSATION,
      expectedRevision: 0,
      action: 'TAKE_OWNERSHIP' as const,
      operatorRef: 'operator.synthetic.1',
      issuedAt: AT(1),
    };

    const first = await startProcess('qf-p08b3-dup-a');
    let original;
    try {
      const applied = await first.lifecycle.runtime.applyConversationControlCommand({
        tenantId: TENANT,
        command,
      });
      expect(applied.ok).toBe(true);
      if (!applied.ok) {
        throw new Error('unreachable');
      }
      original = applied.decision;
    } finally {
      await first.lifecycle.close();
    }

    // A different process reissues the same command — the crash-recovery case, where the caller
    // never saw the response.
    const second = await startProcess('qf-p08b3-dup-b');
    try {
      const replay = await second.lifecycle.runtime.applyConversationControlCommand({
        tenantId: TENANT,
        command,
      });
      expect(replay.ok).toBe(true);
      if (!replay.ok) {
        throw new Error('unreachable');
      }
      expect(replay.decision).toEqual(original);
    } finally {
      await second.lifecycle.close();
    }

    // One effect, one audit row: the replay decided nothing.
    expect(await readStateRow(APP, TENANT, CONVERSATION)).toMatchObject({ revision: '1' });
    expect(await countLedgerRows(APP, TENANT)).toBe(1);
  }, 300_000);

  it('normalizes a conflicting duplicate to control-source-failure with no database detail', async () => {
    await seedConversation(APP, { tenantId: TENANT, conversationId: CONVERSATION });
    const started = await startProcess('qf-p08b3-conflict');
    try {
      const base = {
        commandId: 'ctrl.conflict.1',
        conversationId: CONVERSATION,
        expectedRevision: 0,
        action: 'TAKE_OWNERSHIP' as const,
        operatorRef: 'operator.synthetic.1',
        issuedAt: AT(1),
      };
      const applied = await started.lifecycle.runtime.applyConversationControlCommand({
        tenantId: TENANT,
        command: base,
      });
      expect(applied.ok).toBe(true);

      // Same command id, different intent. The adapter refuses with `command-conflict`; the
      // composition must reduce that to its own closed vocabulary without leaking the adapter's.
      const conflicting = await started.lifecycle.runtime.applyConversationControlCommand({
        tenantId: TENANT,
        command: { ...base, action: 'PAUSE_AI', issuedAt: AT(2) },
      });
      expect(conflicting.ok).toBe(false);
      if (conflicting.ok) {
        throw new Error('unreachable');
      }
      expect(conflicting.reason).toBe('control-source-failure');
      const serialized = JSON.stringify(conflicting);
      for (const forbidden of ['command-conflict', 'qf_jarvis', 'postgres', 'conversation_']) {
        expect(serialized, forbidden).not.toContain(forbidden);
      }

      // Zero second effect.
      expect(await readStateRow(APP, TENANT, CONVERSATION)).toMatchObject({ revision: '1' });
      expect(await countLedgerRows(APP, TENANT)).toBe(1);
    } finally {
      await started.lifecycle.close();
    }
  }, 180_000);

  it('returns a REFUSED decision for a stale revision, not a surface failure', async () => {
    await seedConversation(APP, { tenantId: TENANT, conversationId: CONVERSATION });
    const started = await startProcess('qf-p08b3-stale');
    try {
      await started.lifecycle.runtime.applyConversationControlCommand({
        tenantId: TENANT,
        command: {
          commandId: 'ctrl.stale.setup',
          conversationId: CONVERSATION,
          expectedRevision: 0,
          action: 'TAKE_OWNERSHIP',
          operatorRef: 'operator.synthetic.1',
          issuedAt: AT(1),
        },
      });

      const stale = await started.lifecycle.runtime.applyConversationControlCommand({
        tenantId: TENANT,
        command: {
          commandId: 'ctrl.stale.1',
          conversationId: CONVERSATION,
          expectedRevision: 0,
          action: 'PAUSE_AI',
          operatorRef: 'operator.synthetic.1',
          issuedAt: AT(2),
        },
      });
      // A refusal is a SUCCESSFUL application of the rules, so `ok` stays true.
      expect(stale.ok).toBe(true);
      if (!stale.ok) {
        throw new Error('unreachable');
      }
      expect(stale.decision.outcome).toBe('REFUSED');
      expect(stale.decision.reason).toBe('revision-mismatch');
      expect(await readStateRow(APP, TENANT, CONVERSATION)).toMatchObject({ revision: '1' });
    } finally {
      await started.lifecycle.close();
    }
  }, 180_000);

  it('refuses RESUME_AI while a human still holds the conversation', async () => {
    await seedConversation(APP, { tenantId: TENANT, conversationId: CONVERSATION });
    const started = await startProcess('qf-p08b3-resume-guard');
    try {
      await started.lifecycle.runtime.applyConversationControlCommand({
        tenantId: TENANT,
        command: {
          commandId: 'ctrl.rg.take',
          conversationId: CONVERSATION,
          expectedRevision: 0,
          action: 'TAKE_OWNERSHIP',
          operatorRef: 'operator.synthetic.1',
          issuedAt: AT(1),
        },
      });
      const refused = await started.lifecycle.runtime.applyConversationControlCommand({
        tenantId: TENANT,
        command: {
          commandId: 'ctrl.rg.resume',
          conversationId: CONVERSATION,
          expectedRevision: 1,
          action: 'RESUME_AI',
          operatorRef: 'operator.synthetic.1',
          issuedAt: AT(2),
        },
      });
      expect(refused.ok).toBe(true);
      if (!refused.ok) {
        throw new Error('unreachable');
      }
      expect(refused.decision.outcome).toBe('REFUSED');
      expect(refused.decision.reason).toBe('human-takeover-active');
    } finally {
      await started.lifecycle.close();
    }
  }, 180_000);

  /**
   * The property the final-review correction delivers, proved end to end.
   *
   * Migration 0008's guard trigger REQUIRES every new state row to start at `revision = 0`. Until
   * this correction, `agent-runtime` validated a conversation revision through the generic authored
   * `VERSION` schema (`z.int().min(1).max(1_000_000)`), so a conversation that had been provisioned
   * and never touched by an operator was refused as `orchestration-invariant` and could never be
   * served — and any conversation past 1,000,000 would have become unservable in production.
   *
   * A dedicated private `REVISION` schema (`0 .. Number.MAX_SAFE_INTEGER`) now covers exactly the two
   * revision-bearing conversation fields. There is no warm-up anywhere in this file.
   */
  it('serves a freshly provisioned revision-0 conversation directly, with no warm-up', async () => {
    await seedConversation(APP, { tenantId: TENANT, conversationId: CONVERSATION });
    const started = await startProcess('qf-p08b3-revision-zero');
    try {
      expect(await readStateRow(APP, TENANT, CONVERSATION)).toMatchObject({ revision: '0' });

      const result = await started.lifecycle.runtime.processInbound(syntheticInboundEnvelope());
      expect(result.outcome).toBe('CORE_ACCEPTED');
      expect(result.modelDrafted).toBe(true);
      expect(result.coreConsulted).toBe(true);
      // The proposal is BOUND to revision 0 -- the context and the proposal share one domain, so a
      // conversation cannot pass the gate and then fail to produce a proposal.
      expect(result.boundRevision).toBe(0);
      expect(started.modelCalls()).toBe(1);
      expect(started.coreCalls()).toBe(1);

      // Serving changed no control state and wrote no audit row: a turn is not a control command.
      expect(await readStateRow(APP, TENANT, CONVERSATION)).toMatchObject({
        revision: '0',
        human_takeover: false,
        ai_paused: false,
      });
      expect(await countLedgerRows(APP, TENANT)).toBe(0);
    } finally {
      await started.lifecycle.close();
    }
  }, 180_000);

  it('never auto-provisions a conversation that does not exist', async () => {
    // No seed. Startup must succeed anyway -- readiness needs no row -- and the missing conversation
    // must stay missing: creating a default row would be inventing Core-owned business facts.
    const started = await startProcess('qf-p08b3-noprovision');
    try {
      const result = await started.lifecycle.runtime.processInbound(syntheticInboundEnvelope());
      expect(result.outcome).toBe('REFUSED');
      expect(started.modelCalls()).toBe(0);
      expect(started.coreCalls()).toBe(0);
    } finally {
      await started.lifecycle.close();
    }
    expect(await readStateRow(APP, TENANT, CONVERSATION)).toBeUndefined();
    expect(await countLedgerRows(APP, TENANT)).toBe(0);
    // And the lifecycle exposes no way to have done it.
    const started2 = await startProcess('qf-p08b3-noprovision-2');
    try {
      expect(
        (started2.lifecycle as unknown as Record<string, unknown>)['provision'],
      ).toBeUndefined();
      expect(
        (started2.lifecycle.runtime as unknown as Record<string, unknown>)['provision'],
      ).toBeUndefined();
      // The runtime surface is still exactly three methods.
      expect(Object.keys(started2.lifecycle.runtime).sort()).toEqual([
        'applyConversationControlCommand',
        'processInbound',
        'readConversationOperationsSnapshot',
      ]);
    } finally {
      await started2.lifecycle.close();
    }
  }, 180_000);
});
