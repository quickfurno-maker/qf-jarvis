/**
 * JAO-5 controlled ambient operations, asserted as a GOVERNANCE proof (ADR-0119).
 *
 * Durability is proved against a real PostgreSQL in the integration suite; it cannot be proved here
 * and this file does not pretend to. What it proves is the half that does not need a database and
 * must never be allowed to drift: that every monitor carries the whole canonical sentence, that the
 * gates refuse in the right order and for the right reason, that nothing in this slice starts
 * itself, and that observation cannot become authority.
 *
 * The guards exercised below are the REAL production guards -- `policy.ts` is what the adapter
 * calls inside its claim transaction -- so these are not assertions about a re-implementation.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import * as jao5 from '../jao/controlled-ambient-operations/index.js';
import * as jao5Public from '../jao/controlled-ambient-operations/public.js';
// By DIRECT MODULE PATH, which is the only way the raw persistence seam can be reached at all.
// That these imports resolve while the barrel keys below do not IS the boundary being asserted.
import { createJao5PostgresStore } from '../jao/controlled-ambient-operations/postgres-store.js';
import {
  enrollJao5MonitorInternal,
  killJao5MonitorInternal,
} from '../jao/controlled-ambient-operations/operations.js';
import type { Jao5AmbientStore } from '../jao/controlled-ambient-operations/store-port.js';
import {
  JAO5_AMBIENT_BOUNDS,
  JAO5_EVENT_HEALTH_MONITOR,
  JAO5_LIMITS,
  JAO5_MONITOR_DEFINITIONS,
  JAO5_MONITOR_IDS,
  JAO5_SCHEDULED_HEALTH_MONITOR,
  JAO5_STATUS_MAY_CLAIM,
  JAO5_TRIGGER_TYPES,
  assertJao5Budget,
  assertJao5Claimable,
  assertJao5DefinitionBinding,
  assertJao5EventMatches,
  assertJao5ExpectedRevision,
  assertJao5NotCancelled,
  createJao5MonitorRegistry,
  jao5AmbientCycleRequestSchema,
  jao5ApprovedEventSchema,
  jao5BudgetWindowStart,
  jao5CadenceSlot,
  jao5DefinitionDigest,
  jao5DueScheduledSlot,
  jao5EventDedupeKey,
  jao5HasExpired,
  jao5IsQuieted,
  jao5MonitorDefinitionSchema,
  jao5MonitorInstanceSchema,
  jao5QuietUntilMs,
  jao5ScheduledDedupeKey,
  type Jao5MonitorInstance,
} from '../jao/controlled-ambient-operations/index.js';

const T0 = Date.parse('2026-08-25T09:00:00.000Z');
const HOUR = 60 * 60 * 1_000;
const CADENCE_MS = 900 * 1_000;

function instance(over: Partial<Jao5MonitorInstance> = {}): Jao5MonitorInstance {
  return jao5MonitorInstanceSchema.parse({
    monitorInstanceId: 'jao5.instance.001',
    monitorId: 'jao5.system-health.interval.v1',
    monitorVersion: '1',
    definitionDigest: jao5DefinitionDigest(JAO5_SCHEDULED_HEALTH_MONITOR),
    ownerId: 'jarvis.operations',
    mode: 'SHADOW',
    status: 'ACTIVE',
    enrolledAt: '2026-08-25T09:00:00.000Z',
    expiresAt: '2026-08-26T09:00:00.000Z',
    quietUntil: null,
    killedAt: null,
    lastClaimedSlot: null,
    revision: 1,
    createdAt: '2026-08-25T09:00:00.000Z',
    updatedAt: '2026-08-25T09:00:00.000Z',
    ...over,
  });
}

function approvedEvent(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    eventId: 'jao5.event.001',
    eventType: 'control-plane.system-health.changed.v1',
    occurredAt: '2026-08-25T09:05:00.000Z',
    sourcePosture: 'INJECTED_APPROVED_SHADOW_SIGNAL',
    scope: 'CONTROL_PLANE_SYSTEM_HEALTH',
    snapshot: { any: 'value' },
    ...over,
  };
}

/** Source with comments stripped, so the prose naming forbidden paths does not flag itself. */
function codeOnly(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//gu, '')
    .split('\n')
    .filter((line) => !/^\s*(\/\/|--)/u.test(line))
    .join('\n');
}

function jao5Dir(): string {
  return path.resolve(
    fileURLToPath(new URL('.', import.meta.url)),
    '..',
    'jao',
    'controlled-ambient-operations',
  );
}

function jao5Sources(): { readonly name: string; readonly code: string }[] {
  const root = jao5Dir();
  return fs
    .readdirSync(root)
    .filter((entry) => entry.endsWith('.ts'))
    .map((entry) => ({
      name: entry,
      code: codeOnly(fs.readFileSync(path.join(root, entry), 'utf8')),
    }));
}

describe('JAO-5 controlled ambient operations', () => {
  it('ships exactly two monitors, and every one carries the whole canonical sentence', () => {
    expect(JAO5_MONITOR_DEFINITIONS).toHaveLength(2);
    expect(JAO5_MONITOR_IDS).toStrictEqual([
      'jao5.system-health.changed.v1',
      'jao5.system-health.interval.v1',
    ]);
    expect(JAO5_AMBIENT_BOUNDS.monitorCount).toBe(2);

    // "Every monitor has a named owner, cadence/trigger, scope, budget, deduplication rule,
    // expiry, quieting rule, and kill switch." Each clause, on each monitor.
    for (const definition of JAO5_MONITOR_DEFINITIONS) {
      expect(definition.ownerId, definition.monitorId).toBe('jarvis.operations');
      expect(JAO5_TRIGGER_TYPES, definition.monitorId).toContain(definition.triggerType);
      expect(definition.scope, definition.monitorId).toBe('CONTROL_PLANE_SYSTEM_HEALTH');
      expect(definition.budgetPolicy.maxInvestigationsPerWindow).toBeGreaterThan(0);
      expect(definition.budgetPolicy.budgetWindowSeconds).toBeGreaterThan(0);
      expect(definition.dedupePolicy.durable).toBe(true);
      expect(definition.expiryPolicy.maxEnrollmentSeconds).toBeGreaterThan(0);
      expect(definition.expiryPolicy.enforcedWithoutSweeper).toBe(true);
      expect(definition.quietingPolicy.quietAfterAttentionSeconds).toBe(1800);
      expect(definition.quietingPolicy.quietAfterFailureSeconds).toBe(300);
      expect(definition.quietingPolicy.quietAfterNoAnomalySeconds).toBe(0);
      expect(definition.killSwitchPolicy.terminal).toBe(true);
      expect(definition.killSwitchPolicy.reversible).toBe(false);

      // "Observation may create attention; it does not create business authority."
      expect(definition.readOnly, definition.monitorId).toBe(true);
      expect(definition.businessEffect, definition.monitorId).toBe(false);
      expect(definition.productionMutation, definition.monitorId).toBe(false);
      expect(definition.maxAutonomyLevel, definition.monitorId).toBe('L1_READ');
      expect(definition.attentionClass).toBe('SHADOW_OPERATIONAL_ATTENTION');
      expect(definition.modelAuthority).toBe('QF_MODEL_GATEWAY_ONLY');
      expect(definition.availability).toBe('ACTIVE_FOR_OFFLINE_SHADOW_PROOF_ONLY');
    }

    // One scheduled, one event -- both trigger classes proved.
    expect(JAO5_SCHEDULED_HEALTH_MONITOR.triggerType).toBe('SCHEDULED_INTERVAL');
    expect(JAO5_SCHEDULED_HEALTH_MONITOR.cadenceSeconds).toBe(900);
    expect(JAO5_SCHEDULED_HEALTH_MONITOR.eventType).toBeNull();
    expect(JAO5_EVENT_HEALTH_MONITOR.triggerType).toBe('APPROVED_EVENT');
    expect(JAO5_EVENT_HEALTH_MONITOR.eventType).toBe('control-plane.system-health.changed.v1');
    expect(JAO5_EVENT_HEALTH_MONITOR.cadenceSeconds).toBeNull();
  });

  it('refuses a definition missing any clause, or claiming authority it cannot have', () => {
    for (const forbidden of [
      { businessEffect: true },
      { productionMutation: true },
      { readOnly: false },
      { maxAutonomyLevel: 'L2_WRITE' },
      { attentionClass: 'APPROVED_ACTION' },
      { modelAuthority: 'DIRECT_PROVIDER' },
      { availability: 'ACTIVE' },
      { scope: 'VENDOR_REGISTRY' },
      { investigationType: 'jarvis.operations.remediation' },
      // A trigger with no parameter can never be evaluated deterministically.
      { cadenceSeconds: null },
      { triggerType: 'APPROVED_EVENT' },
      // No executable field exists, so none can be introduced.
      { handler: 'run()' },
      { callback: 'x' },
      { url: 'http://example.invalid' },
      { query: 'SELECT 1' },
      { command: 'ls' },
      { webhook: 'https://example.invalid' },
    ]) {
      expect(
        jao5MonitorDefinitionSchema.safeParse({ ...JAO5_SCHEDULED_HEALTH_MONITOR, ...forbidden })
          .success,
        JSON.stringify(forbidden),
      ).toBe(false);
    }

    // Every clause is REQUIRED: removing one makes the definition unparseable.
    for (const clause of [
      'ownerId',
      'scope',
      'budgetPolicy',
      'dedupePolicy',
      'expiryPolicy',
      'quietingPolicy',
      'killSwitchPolicy',
      'triggerType',
    ] as const) {
      // Rebuilt without the clause rather than deleted from a copy: the same absence, expressed
      // in a way that does not need a dynamic delete.
      const stripped = Object.fromEntries(
        Object.entries(JAO5_SCHEDULED_HEALTH_MONITOR).filter(([key]) => key !== clause),
      );
      expect(jao5MonitorDefinitionSchema.safeParse(stripped).success, clause).toBe(false);
    }
  });

  it('refuses an unknown monitor and a wrong version, with no nearest match', () => {
    const registry = createJao5MonitorRegistry();
    expect(registry.lookup('jao5.system-health.interval.v1', '1').cadenceSeconds).toBe(900);
    expect(() => registry.lookup('jao5.does-not-exist', '1')).toThrow(
      expect.objectContaining({ code: 'MONITOR_UNKNOWN' }),
    );
    expect(() => registry.lookup('jao5.system-health.interval.v1', '2')).toThrow(
      expect.objectContaining({ code: 'MONITOR_VERSION_MISMATCH' }),
    );
    expect(() =>
      createJao5MonitorRegistry([]).lookup('jao5.system-health.interval.v1', '1'),
    ).toThrow(expect.objectContaining({ code: 'MONITOR_UNKNOWN' }));
  });

  it('binds an enrollment to the exact definition it was enrolled against', () => {
    const record = instance();
    expect(() => {
      assertJao5DefinitionBinding(record, JAO5_SCHEDULED_HEALTH_MONITOR, jao5DefinitionDigest);
    }).not.toThrow();

    // A definition edited after enrollment -- a widened budget, a shortened quiet, a different
    // owner -- no longer matches, and the enrollment fails closed rather than silently governing
    // something nobody reviewed.
    for (const drift of [
      { budgetPolicy: { maxInvestigationsPerWindow: 16, budgetWindowSeconds: 3600 } },
      {
        quietingPolicy: {
          ...JAO5_SCHEDULED_HEALTH_MONITOR.quietingPolicy,
          quietAfterAttentionSeconds: 0,
        },
      },
      { ownerId: 'someone.else' },
      { cadenceSeconds: 60 },
    ]) {
      const edited = jao5MonitorDefinitionSchema.parse({
        ...JAO5_SCHEDULED_HEALTH_MONITOR,
        ...drift,
      });
      expect(() => {
        assertJao5DefinitionBinding(record, edited, jao5DefinitionDigest);
      }, JSON.stringify(drift)).toThrow(
        expect.objectContaining({ code: 'MONITOR_VERSION_MISMATCH' }),
      );
    }
  });

  it('decides the cadence slot deterministically from the enrollment anchor', () => {
    const record = instance();

    // Before due: the very first slot is 0, and it has not been claimed, so it IS eligible at
    // enrollment. After claiming slot 0, slot 0 is no longer due.
    expect(jao5CadenceSlot(record, 900, T0)).toBe(0);
    expect(jao5CadenceSlot(record, 900, T0 + CADENCE_MS - 1)).toBe(0);
    // Exactly due: the next slot opens at the boundary, not a millisecond later.
    expect(jao5CadenceSlot(record, 900, T0 + CADENCE_MS)).toBe(1);
    expect(jao5CadenceSlot(record, 900, T0 + 2 * CADENCE_MS)).toBe(2);

    const claimedZero = instance({ lastClaimedSlot: 0 });
    expect(() => jao5DueScheduledSlot(claimedZero, JAO5_SCHEDULED_HEALTH_MONITOR, T0)).toThrow(
      expect.objectContaining({ code: 'TRIGGER_NOT_DUE' }),
    );
    expect(() =>
      jao5DueScheduledSlot(claimedZero, JAO5_SCHEDULED_HEALTH_MONITOR, T0 + CADENCE_MS - 1),
    ).toThrow(expect.objectContaining({ code: 'TRIGGER_NOT_DUE' }));
    expect(jao5DueScheduledSlot(claimedZero, JAO5_SCHEDULED_HEALTH_MONITOR, T0 + CADENCE_MS)).toBe(
      1,
    );
  });

  it('collapses missed slots instead of replaying them: no catch-up storm', () => {
    // Twenty cadence intervals of downtime. Replaying them would mean twenty model calls the
    // moment the process comes back -- a self-inflicted burst at exactly the point a system is
    // least healthy.
    const record = instance({ lastClaimedSlot: 0 });
    const after20 = T0 + 20 * CADENCE_MS;
    const due = jao5DueScheduledSlot(record, JAO5_SCHEDULED_HEALTH_MONITOR, after20);

    // ONE slot, and it is the CURRENT one -- not slot 1, and not twenty of them.
    expect(due).toBe(20);
    expect(JAO5_AMBIENT_BOUNDS.catchUpStorm).toBe(false);

    // Claiming it advances past every missed slot in one step.
    const advanced = instance({ lastClaimedSlot: due });
    expect(() => jao5DueScheduledSlot(advanced, JAO5_SCHEDULED_HEALTH_MONITOR, after20)).toThrow(
      expect.objectContaining({ code: 'TRIGGER_NOT_DUE' }),
    );
  });

  it('binds an approved event to the monitor allowed to observe it', () => {
    expect(jao5ApprovedEventSchema.safeParse(approvedEvent()).success).toBe(true);
    expect(() => {
      assertJao5EventMatches(JAO5_EVENT_HEALTH_MONITOR, {
        eventType: 'control-plane.system-health.changed.v1',
        scope: 'CONTROL_PLANE_SYSTEM_HEALTH',
      });
    }).not.toThrow();

    expect(() => {
      assertJao5EventMatches(JAO5_EVENT_HEALTH_MONITOR, {
        eventType: 'vendor.activated.v1',
        scope: 'CONTROL_PLANE_SYSTEM_HEALTH',
      });
    }).toThrow(expect.objectContaining({ code: 'EVENT_TYPE_MISMATCH' }));
    expect(() => {
      assertJao5EventMatches(JAO5_EVENT_HEALTH_MONITOR, {
        eventType: 'control-plane.system-health.changed.v1',
        scope: 'VENDOR_REGISTRY',
      });
    }).toThrow(expect.objectContaining({ code: 'EVENT_SCOPE_MISMATCH' }));

    for (const bad of [
      { eventType: 'vendor.activated.v1' },
      { scope: 'VENDOR_REGISTRY' },
      // The posture literal is a closed FIRST-PROOF posture, not authentication -- and it cannot be
      // replaced by a caller claiming something stronger.
      { sourcePosture: 'AUTHENTICATED_PRODUCTION_SIGNAL' },
      { sourcePosture: 'TRUSTED' },
      { eventId: 'has space' },
      { occurredAt: '2026-02-31T09:05:00.000Z' },
      { extra: true },
    ]) {
      expect(
        jao5ApprovedEventSchema.safeParse(approvedEvent(bad)).success,
        JSON.stringify(bad),
      ).toBe(false);
    }
  });

  it('derives durable dedupe identity from the trigger, never from the process', () => {
    expect(jao5ScheduledDedupeKey('jao5.instance.001', 7)).toBe('slot:jao5.instance.001:7');
    expect(jao5EventDedupeKey('jao5.instance.001', 'jao5.event.001')).toBe(
      'event:jao5.instance.001:jao5.event.001',
    );
    // Stable across calls -- which is what makes it survive a restart. A key built from a process
    // id, an invocation counter or a timestamp would be different on the far side of one.
    expect(jao5ScheduledDedupeKey('jao5.instance.001', 7)).toBe(
      jao5ScheduledDedupeKey('jao5.instance.001', 7),
    );
    expect(jao5ScheduledDedupeKey('jao5.instance.001', 7)).not.toBe(
      jao5ScheduledDedupeKey('jao5.instance.002', 7),
    );
    expect(jao5EventDedupeKey('a', 'e1')).not.toBe(jao5EventDedupeKey('a', 'e2'));
  });

  it('aligns budget windows to the epoch, so a restart lands in the same window', () => {
    const window = jao5BudgetWindowStart(T0, 3600);
    expect(window % 3600).toBe(0);
    expect(jao5BudgetWindowStart(T0 + 59 * 60 * 1_000, 3600)).toBe(window);
    expect(jao5BudgetWindowStart(T0 + HOUR, 3600)).toBe(window + 3600);

    expect(() => {
      assertJao5Budget(3, 4);
    }).not.toThrow();
    for (const used of [4, 5, 99]) {
      expect(() => {
        assertJao5Budget(used, 4);
      }, String(used)).toThrow(expect.objectContaining({ code: 'BUDGET_EXHAUSTED' }));
    }
  });

  it('refuses a killed, expired, inactive or quieted monitor, in that order', () => {
    expect(() => {
      assertJao5Claimable(instance(), T0);
    }).not.toThrow();

    // Kill is TERMINAL and reported first: a monitor somebody deliberately killed should say so,
    // even when it has also aged out since.
    const killed = instance({
      status: 'KILLED',
      killedAt: '2026-08-25T09:10:00.000Z',
      expiresAt: '2026-08-25T09:20:00.000Z',
    });
    expect(() => {
      assertJao5Claimable(killed, Date.parse('2026-08-26T00:00:00.000Z'));
    }).toThrow(expect.objectContaining({ code: 'MONITOR_KILLED' }));

    // Expiry: the boundary is CLOSED. At exactly expiresAt there is no claim.
    const expiring = instance({ expiresAt: '2026-08-25T10:00:00.000Z' });
    expect(jao5HasExpired(expiring, Date.parse('2026-08-25T09:59:59.999Z'))).toBe(false);
    expect(jao5HasExpired(expiring, Date.parse('2026-08-25T10:00:00.000Z'))).toBe(true);
    expect(() => {
      assertJao5Claimable(expiring, Date.parse('2026-08-25T09:59:59.999Z'));
    }).not.toThrow();
    expect(() => {
      assertJao5Claimable(expiring, Date.parse('2026-08-25T10:00:00.000Z'));
    }).toThrow(expect.objectContaining({ code: 'MONITOR_EXPIRED' }));
    // The stored status still says ACTIVE, and it is still refused: no sweeper rewrote the row.
    expect(expiring.status).toBe('ACTIVE');

    // Quiet: the boundary is closed the other way. At exactly quietUntil it is eligible again.
    const quiet = instance({ status: 'QUIETED', quietUntil: '2026-08-25T09:30:00.000Z' });
    expect(jao5IsQuieted(quiet, Date.parse('2026-08-25T09:29:59.999Z'))).toBe(true);
    expect(jao5IsQuieted(quiet, Date.parse('2026-08-25T09:30:00.000Z'))).toBe(false);
    expect(() => {
      assertJao5Claimable(quiet, Date.parse('2026-08-25T09:29:59.999Z'));
    }).toThrow(expect.objectContaining({ code: 'MONITOR_QUIETED' }));
    expect(() => {
      assertJao5Claimable(quiet, Date.parse('2026-08-25T09:30:00.000Z'));
    }).not.toThrow();
  });

  it('decides which statuses may claim as a TOTAL map, and kill has no counterpart', () => {
    expect(Object.keys(JAO5_STATUS_MAY_CLAIM).sort()).toStrictEqual([
      'ACTIVE',
      'EXPIRED',
      'KILLED',
      'QUIETED',
    ]);
    expect(JAO5_STATUS_MAY_CLAIM.KILLED).toBe(false);
    expect(JAO5_STATUS_MAY_CLAIM.EXPIRED).toBe(false);
    expect(JAO5_AMBIENT_BOUNDS.killTerminal).toBe(true);
    expect(JAO5_AMBIENT_BOUNDS.unkillAvailable).toBe(false);

    // There is no unkill anywhere: not on the barrel, not on the port, not in the source.
    const exported = Object.keys(jao5);
    for (const forbidden of ['unkill', 'unkillMonitor', 'reviveMonitor', 'resetMonitor']) {
      expect(exported, forbidden).not.toContain(forbidden);
    }
    // Matched as API SHAPES, not bare substrings: `JAO5_AMBIENT_BOUNDS` declares
    // `unkillAvailable: false`, and a substring scan would read that declaration that the thing is
    // absent as evidence that it is present.
    for (const { name, code } of jao5Sources()) {
      for (const pattern of [
        /unkill\s*\(/iu,
        /function\s+unkill/iu,
        /unkillMonitor/u,
        /revive\s*\(/iu,
        /reviveMonitor/u,
      ]) {
        expect(code, `${name} -> ${String(pattern)}`).not.toMatch(pattern);
      }
    }

    // The one statement that returns a monitor to ACTIVE is the quieting update, and it is guarded
    // so it can never resurrect a killed one.
    const store = codeOnly(fs.readFileSync(path.join(jao5Dir(), 'postgres-store.ts'), 'utf8'));
    expect(store).toContain("status <> 'KILLED'");
  });

  it('quiets by outcome, and never for NO_ANOMALY', () => {
    // Attention quiets longest: an operator handed something to look at should not be handed the
    // same thing again fifteen minutes later.
    expect(jao5QuietUntilMs(JAO5_SCHEDULED_HEALTH_MONITOR, 'ATTENTION_CREATED', T0)).toBe(
      T0 + 1800 * 1_000,
    );
    // A refusal quiets briefly, because an investigation that fails and retries at once is a loop.
    expect(jao5QuietUntilMs(JAO5_SCHEDULED_HEALTH_MONITOR, 'REFUSED', T0)).toBe(T0 + 300 * 1_000);
    // A healthy system is not quieted -- cadence and dedupe already bound the rate, and quieting
    // here would delay the first real signal.
    expect(jao5QuietUntilMs(JAO5_SCHEDULED_HEALTH_MONITOR, 'NO_ANOMALY', T0)).toBeNull();
  });

  it('fails a stale monitor mutation closed', () => {
    const record = instance({ revision: 4 });
    expect(() => {
      assertJao5ExpectedRevision(record, 4);
    }).not.toThrow();
    for (const stale of [1, 3, 5]) {
      expect(() => {
        assertJao5ExpectedRevision(record, stale);
      }, String(stale)).toThrow(expect.objectContaining({ code: 'REVISION_CONFLICT' }));
    }
  });

  it('refuses a cycle request that tries to carry authority or behaviour', () => {
    const valid = {
      cycleId: 'jao5.cycle.001',
      runId: 'jao5.run.001',
      mode: 'SHADOW',
      monitorInstanceIds: ['jao5.instance.001'],
      snapshot: { any: 'value' },
    };
    expect(jao5AmbientCycleRequestSchema.safeParse(valid).success).toBe(true);

    for (const forbidden of [
      // A caller cannot supply the thing every gate exists to govern.
      { investigator: 'fn' },
      { investigate: 'fn' },
      { handler: 'fn' },
      { policy: 'fn' },
      { registry: {} },
      // Nor widen its own authority.
      { mode: 'PRODUCTION' },
      { businessEffectAllowed: true },
      { autonomyLevel: 'L2_WRITE' },
      { budgetOverride: 99 },
      { ignoreQuiet: true },
      { ignoreKill: true },
      { force: true },
      // Nor schedule anything.
      { cron: '* * * * *' },
      { intervalMs: 1000 },
      { monitorInstanceIds: [] },
    ]) {
      expect(
        jao5AmbientCycleRequestSchema.safeParse({ ...valid, ...forbidden }).success,
        JSON.stringify(forbidden),
      ).toBe(false);
    }
  });

  it('cancels before anything is claimed', () => {
    const controller = new AbortController();
    controller.abort();
    expect(() => {
      assertJao5NotCancelled(controller.signal);
    }).toThrow(expect.objectContaining({ code: 'CANCELLED' }));
    expect(() => {
      assertJao5NotCancelled(undefined);
    }).not.toThrow();
  });

  it('states its posture as a machine-readable lock', () => {
    expect(JAO5_AMBIENT_BOUNDS.scope).toBe('CONTROL_PLANE_SYSTEM_HEALTH');
    expect(JAO5_AMBIENT_BOUNDS.modelAuthority).toBe('QF_MODEL_GATEWAY_ONLY');
    for (const denied of [
      'realSchedulerActivated',
      'eventConsumerActivated',
      'backgroundExecution',
      'publicInvestigatorInjection',
      'catchUpStorm',
      'transactionOverModelCall',
      'managedMigrationAdopted',
      'businessEffect',
      'productionMutation',
      'unkillAvailable',
    ] as const) {
      expect(JAO5_AMBIENT_BOUNDS[denied], denied).toBe(false);
    }
    for (const zero of [
      'coreMutations',
      'executionIntentsCreated',
      'channelSends',
      'n8nExecutions',
      'specialistCalls',
      'memoryWrites',
      'toolCalls',
    ] as const) {
      expect(JAO5_AMBIENT_BOUNDS[zero], zero).toBe(0);
    }
    expect(JAO5_LIMITS.maxClaimsPerCycle).toBe(4);
  });

  it('offers no surface that could authorize, execute or send', () => {
    const exported = Object.keys(jao5);
    for (const forbidden of [
      'authorize',
      'approve',
      'execute',
      'send',
      'dispatch',
      'remediate',
      'createExecutionIntent',
      'createProposal',
      'assignLead',
      'activateVendor',
      'start',
      'schedule',
      'subscribe',
      'startScheduler',
      // The internal seam is not public.
      'runJao5AmbientCycleInternal',
      'Jao5InternalAmbientDependencies',
      'Jao5Investigator',
    ]) {
      expect(exported, forbidden).not.toContain(forbidden);
    }

    // Nor does either barrel re-export the seam by any spelling.
    const root = jao5Dir();
    for (const barrel of ['public.ts', 'index.ts']) {
      const code = codeOnly(fs.readFileSync(path.join(root, barrel), 'utf8'));
      for (const forbidden of [
        'runJao5AmbientCycleInternal',
        'Jao5InternalAmbientDependencies',
        'Jao5Investigator',
      ]) {
        expect(code, `${barrel} -> ${forbidden}`).not.toContain(forbidden);
      }
    }
  });

  /**
   * ------------------------------------------------------------------------------------------
   * FINDING 1: the public surface pins its own persistence composition.
   * ------------------------------------------------------------------------------------------
   *
   * The reviewed public surface took a `Jao5AmbientStore`. That is an injection point, and JAO-4
   * taught what an injection point on a public surface becomes.
   *
   * The store is not a passive substrate. `claimAmbientRun` receives the trigger kind, trigger
   * reference, dedupe key, scheduled slot, event id, definition digest, budget window and
   * per-window limit AS CALLER-SUPPLIED VALUES. The adapter re-checks each against the locked row,
   * but it cannot reconstruct canonical monitor policy -- so it cannot know whether the slot was
   * genuinely due, whether the event matched the monitor's own type and scope, or whether those
   * budget numbers are the reviewed ones. A public caller holding a store could therefore skip
   * `runJao5AmbientCycle` entirely and claim under bounds of its own choosing, or hand in a store
   * implementation that recorded whatever it liked.
   *
   * The fix is composition pinning, not a brand: the public surface takes a `DatabasePool` -- the
   * trusted persistence INFRASTRUCTURE boundary, as `ModelGateway` is the trusted inference
   * boundary -- and constructs the canonical store itself. There is no parameter left to displace.
   */
  it('F1.1 gives the public cycle no store implementation to override', () => {
    const source = codeOnly(fs.readFileSync(path.join(jao5Dir(), 'ambient-cycle.ts'), 'utf8'));
    // The PUBLIC dependency interface names a pool and never a store.
    const publicDeps = /export interface Jao5AmbientDependencies \{[\s\S]*?\n\}/u.exec(source);
    expect(publicDeps).not.toBeNull();
    const declared = publicDeps?.[0] ?? '';
    expect(declared).toContain('readonly pool: DatabasePool;');
    expect(declared).not.toContain('Jao5AmbientStore');
    expect(declared).not.toContain('investigate');
    expect(declared).not.toContain('registry');
  });

  it('F1.2 gives the public monitor operations no store implementation to override', () => {
    const source = codeOnly(fs.readFileSync(path.join(jao5Dir(), 'operations.ts'), 'utf8'));
    const publicDeps = /export interface Jao5MonitorOperationDependencies \{[\s\S]*?\n\}/u.exec(
      source,
    );
    expect(publicDeps).not.toBeNull();
    const declared = publicDeps?.[0] ?? '';
    expect(declared).toContain('readonly pool: DatabasePool;');
    expect(declared).not.toContain('Jao5AmbientStore');
  });

  it('F1.3 keeps every raw persistence type off both barrels', () => {
    const exported = Object.keys(jao5);
    const publicExported = Object.keys(jao5Public);
    const root = jao5Dir();
    for (const forbidden of [
      'Jao5AmbientStore',
      'Jao5Claim',
      'Jao5ClaimRequest',
      'Jao5FinalizeRequest',
      'Jao5InternalMonitorOperationDependencies',
      'enrollJao5MonitorInternal',
      'killJao5MonitorInternal',
    ]) {
      // Types erase at runtime, so the barrel KEYS cannot see them -- the source scan is what
      // actually proves a type-only re-export is absent.
      expect(exported, forbidden).not.toContain(forbidden);
      expect(publicExported, forbidden).not.toContain(forbidden);
      // As a WHOLE IDENTIFIER. A bare substring scan flags `assertJao5Claimable` for containing
      // `Jao5Claim`, and a scan that cries wolf is one somebody eventually weakens.
      const identifier = new RegExp(`\\b${forbidden}\\b`, 'u');
      for (const barrel of ['public.ts', 'index.ts']) {
        const code = codeOnly(fs.readFileSync(path.join(root, barrel), 'utf8'));
        expect(identifier.test(code), `${barrel} -> ${forbidden}`).toBe(false);
      }
    }
  });

  it('F1.4 keeps the store CONSTRUCTOR off both barrels', () => {
    const root = jao5Dir();
    for (const forbidden of ['createJao5PostgresStore', 'classifyJao5DatabaseError']) {
      expect(Object.keys(jao5), forbidden).not.toContain(forbidden);
      expect(Object.keys(jao5Public), forbidden).not.toContain(forbidden);
      for (const barrel of ['public.ts', 'index.ts']) {
        const code = codeOnly(fs.readFileSync(path.join(root, barrel), 'utf8'));
        expect(code, `${barrel} -> ${forbidden}`).not.toContain(forbidden);
      }
    }
    // The read-only audit record IS public: it is strictly decoded and cannot write anything.
    const publicSource = codeOnly(fs.readFileSync(path.join(root, 'public.ts'), 'utf8'));
    expect(publicSource).toContain('Jao5AmbientRunRecord');
  });

  it('F1.5 has the public cycle construct the canonical store from the pool', () => {
    const source = codeOnly(fs.readFileSync(path.join(jao5Dir(), 'ambient-cycle.ts'), 'utf8'));
    // Constructed from this module's own import, not read off the dependency object.
    expect(source).toContain('store: createJao5PostgresStore(dependencies.pool)');
    // And never defaulted, which is only a pin until somebody passes a value.
    expect(source).not.toContain('dependencies.store ??');
    expect(source).not.toContain('store: dependencies.store');
  });

  it('F1.6 has every public monitor operation go through the canonical pool-backed store', () => {
    const source = codeOnly(fs.readFileSync(path.join(jao5Dir(), 'operations.ts'), 'utf8'));
    expect(source).toContain('return { store: createJao5PostgresStore(dependencies.pool)');
    // Each public entry point delegates through `canonicalStore`, so none of them can be handed one.
    for (const call of [
      'return enrollJao5MonitorInternal(input, canonicalStore(dependencies));',
      'return killJao5MonitorInternal(input, canonicalStore(dependencies));',
      'return canonicalStore(dependencies).store.readMonitorInstance(monitorInstanceId);',
    ]) {
      expect(source, call).toContain(call);
    }
  });

  it('F1.7 still lets a DIRECT-PATH caller compose the raw store, which is what the seam is for', () => {
    // These are the internal seams, imported by module path at the top of this file. Their being
    // reachable HERE and unreachable through the barrel is precisely the boundary.
    expect(typeof createJao5PostgresStore).toBe('function');
    expect(typeof enrollJao5MonitorInternal).toBe('function');
    expect(typeof killJao5MonitorInternal).toBe('function');
    expect(typeof jao5.runJao5AmbientCycle).toBe('function');
  });

  it('F1.8 cannot have its canonical persistence replaced by a hostile store forced through a cast', async () => {
    // THE BEHAVIOURAL PROOF, and the one that matters: a type-level guarantee is stripped by the
    // test compiler, so structure alone would not catch a regression here.
    let hostileCalls = 0;
    const hostile: Jao5AmbientStore = {
      enrollMonitor: async () => {
        hostileCalls += 1;
        await Promise.resolve();
        throw new Error('unreachable');
      },
      readMonitorInstance: async () => {
        hostileCalls += 1;
        await Promise.resolve();
        throw new Error('unreachable');
      },
      killMonitor: async () => {
        hostileCalls += 1;
        await Promise.resolve();
        throw new Error('unreachable');
      },
      claimAmbientRun: async () => {
        hostileCalls += 1;
        await Promise.resolve();
        throw new Error('unreachable');
      },
      finalizeAmbientRun: async () => {
        hostileCalls += 1;
        await Promise.resolve();
      },
      countClaimedInWindow: async () => {
        hostileCalls += 1;
        await Promise.resolve();
        return 0;
      },
      listAmbientRuns: async () => {
        hostileCalls += 1;
        await Promise.resolve();
        return [];
      },
    };

    // A pool that cannot connect. If the hostile store were reachable, the cycle would succeed
    // through it; because the canonical store is built from THIS pool, the cycle can only refuse.
    let poolUses = 0;
    const deadPool = {
      connect: async (): Promise<never> => {
        poolUses += 1;
        await Promise.resolve();
        throw new Error('pool is not connected');
      },
      end: async (): Promise<void> => Promise.resolve(),
      query: async (): Promise<never> => {
        poolUses += 1;
        await Promise.resolve();
        throw new Error('pool is not connected');
      },
    };

    const smuggled = {
      pool: deadPool,
      store: hostile,
      gateway: { invoke: async (): Promise<never> => Promise.reject(new Error('unreachable')) },
      clock: { nowMs: (): number => T0 },
      investigate: async (): Promise<never> => Promise.reject(new Error('unreachable')),
    } as unknown as Parameters<typeof jao5.runJao5AmbientCycle>[1];

    const result = await jao5.runJao5AmbientCycle(
      {
        cycleId: 'jao5.cycle.pinning',
        runId: 'jao5.run.pinning',
        mode: 'SHADOW',
        monitorInstanceIds: ['jao5.instance.pinning'],
        snapshot: { any: 'value' },
      },
      smuggled,
    );

    // THE MEASUREMENT. The hostile store was never consulted; the canonical one was built and used.
    expect(hostileCalls).toBe(0);
    expect(poolUses).toBeGreaterThan(0);
    expect(result.claimsMade).toBe(0);
    expect(result.runs[0]?.refusalReason).toBe('STORE_FAILED');
    expect(result.runs[0]?.ambientRunId).toBeNull();
  });

  it('F1.9 shows why the seam must stay internal: a raw claim carries its own policy numbers', () => {
    // `claimAmbientRun`'s request is where the bypass lived. Every one of these fields is supplied
    // BY THE CALLER, and the adapter cannot reconstruct canonical policy to second-guess them.
    const port = codeOnly(fs.readFileSync(path.join(jao5Dir(), 'store-port.ts'), 'utf8'));
    const request = /export interface Jao5ClaimRequest \{[\s\S]*?\n\}/u.exec(port);
    expect(request).not.toBeNull();
    const declared = request?.[0] ?? '';
    for (const callerSupplied of [
      'triggerKind',
      'triggerRef',
      'dedupeKey',
      'scheduledSlot',
      'eventId',
      'definitionDigest',
      'budgetWindowSeconds',
      'maxInvestigationsPerWindow',
    ]) {
      expect(declared, callerSupplied).toContain(callerSupplied);
    }
    // Which is exactly why that interface is not on a barrel.
    for (const barrel of ['public.ts', 'index.ts']) {
      const code = codeOnly(fs.readFileSync(path.join(jao5Dir(), barrel), 'utf8'));
      expect(/\bJao5ClaimRequest\b/u.test(code), barrel).toBe(false);
    }
  });

  it('F4.6 keeps surfaced attention out of telemetry, which stays content-free', () => {
    // Finding 4 surfaced the attention object IN MEMORY. Telemetry must still carry only the flag,
    // or "surfacing" would have quietly become "persisting and emitting".
    const source = codeOnly(fs.readFileSync(path.join(jao5Dir(), 'ambient-cycle.ts'), 'utf8'));
    const emitted = /dependencies\.telemetry\.record\(\{[\s\S]*?\n {4}\}\);/u.exec(source);
    expect(emitted).not.toBeNull();
    const record = emitted?.[0] ?? '';
    // A COUNT of attention created, and nothing that could carry its body.
    expect(record).toContain('attentionCreated: result.attentionCreated,');
    for (const forbidden of ['attention:', 'title', 'context', 'recommendedNextStep', 'snapshot']) {
      expect(record, forbidden).not.toContain(forbidden);
    }

    // And the telemetry contract itself has no field an attention body could travel in.
    const contract = codeOnly(fs.readFileSync(path.join(jao5Dir(), 'contracts.ts'), 'utf8'));
    const event = /jao5TelemetryEventSchema = z[\s\S]*?\n\}\);/u.exec(contract);
    expect(event).not.toBeNull();
    for (const forbidden of ['title', 'context', 'recommendedNextStep', 'attention:']) {
      expect(event?.[0] ?? '', forbidden).not.toContain(forbidden);
    }

    // The store is never handed the attention either -- only the boolean.
    const port = codeOnly(fs.readFileSync(path.join(jao5Dir(), 'store-port.ts'), 'utf8'));
    const finalize = /export interface Jao5FinalizeRequest \{[\s\S]*?\n\}/u.exec(port);
    expect(finalize?.[0] ?? '').toContain('attentionPresent');
    expect(finalize?.[0] ?? '').not.toContain('attention:');
  });
});
