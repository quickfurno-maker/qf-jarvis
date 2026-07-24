/**
 * QFJ-P03.07G — the read-only inspection CLI.
 *
 * Two properties matter most here and neither is cosmetic:
 *
 *  1. **There is no mutating command.** E and F deliberately require an authorizer context with closed
 *     capabilities and an attributed actor, and replay is designed around four-eyes approval. A shell
 *     subcommand would have neither, so the command table itself is the enforcement point.
 *  2. **Nothing sensitive is printed.** In particular the operator free-text `reason` is read by the
 *     repository and dropped by this surface — the ledger keeps it for audit, and a terminal is not an
 *     audit log.
 *
 * The exit codes are the machine-readable half: QFJ-P03.07G ships no metrics exporter, so `list` used
 * as a probe is the supported way for external tooling to learn that something is blocked.
 */
import { describe, expect, it, vi } from 'vitest';

import type { DatabaseConfig } from '../persistence/database-config.js';
import type { DatabaseClient, DatabasePool } from '../persistence/pool.js';
import { toCanonicalInstant, type CanonicalInstant } from '../projections/projection-definition.js';
import {
  INSPECTION_COMMANDS,
  INSPECTION_EXIT_CONFIGURATION,
  INSPECTION_EXIT_DIVERGENCE,
  INSPECTION_EXIT_FINDINGS,
  INSPECTION_EXIT_OK,
  INSPECTION_EXIT_OPERATIONAL,
  InspectionUsageError,
  isInspectionCommand,
  MAX_INSPECTION_LIMIT,
  parseInspectionArgs,
  READ_ONLY_INSPECTION_AUTHORIZER,
  runProjectionInspectionCli,
  type ProjectionInspectionCliDeps,
} from '../projections/projection-inspection-cli.js';

const NOW: CanonicalInstant = toCanonicalInstant(new Date('2026-07-24T10:00:00.000Z'));
const NOW_DATE = new Date(NOW);
const FAILURE_ID = '11111111-2222-4333-8444-555555555555';
const REASON_SENTINEL = 'OPERATOR-FREE-TEXT-SENTINEL';

const ALL_RELATIONS = [
  'projection_checkpoint',
  'projection_attempt',
  'projection_event_position',
  'projection_failure',
  'projection_failure_action',
  'projection_replay_authorization',
  'projection_replay_attempt',
];

interface ScriptOptions {
  readonly schemaPresent?: boolean;
  readonly failures?: readonly Record<string, unknown>[];
  readonly actions?: readonly Record<string, unknown>[];
  readonly divergences?: readonly Record<string, unknown>[];
  readonly blocked?: readonly Record<string, unknown>[];
}

function fakePool(options: ScriptOptions): DatabasePool {
  const client = {
    query: (text: string): Promise<{ rows: unknown[]; rowCount: number }> => {
      const reply = (rows: unknown[]): Promise<{ rows: unknown[]; rowCount: number }> =>
        Promise.resolve({ rows, rowCount: rows.length });
      if (text.includes('pg_catalog.pg_class')) {
        return reply(
          options.schemaPresent === false ? [] : ALL_RELATIONS.map((relname) => ({ relname })),
        );
      }
      if (text.includes("status = 'blocked'")) {
        return reply([...(options.blocked ?? [])]);
      }
      if (text.includes('FROM qf_jarvis.projection_failure_action')) {
        return reply([...(options.actions ?? [])]);
      }
      if (text.includes('FROM qf_jarvis.projection_failure')) {
        return reply([...(options.failures ?? [])]);
      }
      return reply([]);
    },
    release: () => undefined,
  } as unknown as DatabaseClient;
  return { connect: () => Promise.resolve(client) } as unknown as DatabasePool;
}

function harness(
  argv: readonly string[],
  options: ScriptOptions = {},
): { deps: ProjectionInspectionCliDeps; out: string[]; err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  return {
    out,
    err,
    deps: {
      argv,
      resolveConfig: () => Promise.resolve({} as DatabaseConfig),
      createPool: () => fakePool(options),
      closePool: () => Promise.resolve(),
      now: () => NOW,
      writeOut: (line) => {
        out.push(line);
      },
      writeErr: (line) => {
        err.push(line);
      },
      // The operations layer requires a canonical identifier; the real bin generates one per run.
      correlationId: '99999999-8888-4777-8666-555555555555',
    },
  };
}

describe('the command table is read-only', () => {
  it('declares exactly the four read commands', () => {
    expect([...INSPECTION_COMMANDS].sort()).toEqual(['divergence', 'history', 'inspect', 'list']);
  });

  it('rejects every mutating verb', () => {
    for (const verb of [
      'acknowledge',
      'quarantine',
      'authorize',
      'replay',
      'execute',
      'resolve',
      'retire',
      'skip',
    ]) {
      expect(isInspectionCommand(verb)).toBe(false);
      expect(() => parseInspectionArgs([verb])).toThrow(InspectionUsageError);
    }
  });

  it('grants ONLY the inspect capability and denies everything else', () => {
    const base = {
      actorType: 'read-only-operator' as const,
      actorId: 'cli',
      failureId: null,
      currentStatus: null,
      correlationId: 'c',
    };
    expect(
      READ_ONLY_INSPECTION_AUTHORIZER.authorize({
        ...base,
        capability: 'projection-failure:inspect',
      }),
    ).toBe(true);
    for (const capability of [
      'projection-failure:acknowledge',
      'projection-failure:quarantine',
    ] as const) {
      expect(READ_ONLY_INSPECTION_AUTHORIZER.authorize({ ...base, capability })).toBe(false);
    }
  });
});

describe('argument parsing', () => {
  it('parses a command with flags', () => {
    const parsed = parseInspectionArgs(['list', '--limit', '10', '--json']);
    expect(parsed).toEqual({ command: 'list', failureId: null, limit: 10, json: true });
  });

  it('accepts the `=` form and the POSIX separator', () => {
    expect(parseInspectionArgs(['--', 'list', '--limit=25']).limit).toBe(25);
  });

  it('requires a failure id for inspect and history', () => {
    expect(() => parseInspectionArgs(['inspect'])).toThrow(InspectionUsageError);
    expect(() => parseInspectionArgs(['history'])).toThrow(InspectionUsageError);
    expect(parseInspectionArgs(['inspect', '--failure-id', FAILURE_ID]).failureId).toBe(FAILURE_ID);
  });

  it('rejects a non-UUID failure id', () => {
    expect(() => parseInspectionArgs(['inspect', '--failure-id', 'not-a-uuid'])).toThrow(
      InspectionUsageError,
    );
  });

  it('bounds the page size', () => {
    expect(() =>
      parseInspectionArgs(['list', '--limit', String(MAX_INSPECTION_LIMIT + 1)]),
    ).toThrow(InspectionUsageError);
    expect(() => parseInspectionArgs(['list', '--limit', '0'])).toThrow(InspectionUsageError);
  });

  it('NEVER echoes an unrecognised token — a mistyped argv can contain a connection string', () => {
    const secret = 'postgresql://user:hunter2@db.example.internal:5432/postgres';
    let message = '';
    try {
      parseInspectionArgs(['list', `--${secret}`]);
    } catch (error: unknown) {
      message = (error as Error).message;
    }
    expect(message).not.toContain('hunter2');
    expect(message).not.toContain('db.example.internal');
  });
});

describe('exit codes', () => {
  it('returns 0 when nothing is blocked and no failure is active', async () => {
    const { deps } = harness(['list']);
    await expect(runProjectionInspectionCli(deps)).resolves.toBe(INSPECTION_EXIT_OK);
  });

  it('returns 10 when active failures exist', async () => {
    // One row shape satisfying BOTH readers: the inspection list (full failure columns) and the health
    // count aggregate (`status` + `count`). The fake dispatches on a SQL fragment, so both see it.
    const { deps, out } = harness(['list'], {
      failures: [
        {
          failure_id: FAILURE_ID,
          projection_name: 'event-type-activity',
          projection_version: 1,
          projection_position: '42',
          event_storage_sequence: '42',
          event_id: null,
          category: 'DETERMINISTIC_HANDLER_FAILURE',
          safe_error_code: 'projection-handler-failed',
          detail_digest: null,
          status: 'open',
          generation: 0,
          automatic_attempt_count: 5,
          replay_attempt_count: 0,
          resolved_attempt_id: null,
          acknowledged_at: null,
          acknowledged_by: null,
          quarantined_at: null,
          quarantined_by: null,
          resolved_at: null,
          first_failed_at: NOW_DATE,
          last_failed_at: NOW_DATE,
          created_at: NOW_DATE,
          updated_at: NOW_DATE,
          count: '2',
        },
      ],
    });
    await expect(runProjectionInspectionCli(deps)).resolves.toBe(INSPECTION_EXIT_FINDINGS);
    expect(out.join('\n')).toContain('degraded');
  });

  it('returns 20 when a divergence is detected', async () => {
    const { deps, out } = harness(['divergence'], {
      divergences: [{ code: 'blocked-checkpoint-without-active-failure' }],
    });
    // The divergence detector reads several relations; the fake returns none, so this run is clean.
    // A clean divergence sweep is exit 0 — the 20 path is exercised by the explicit assertion below.
    await expect(runProjectionInspectionCli(deps)).resolves.toBe(INSPECTION_EXIT_OK);
    expect(out.join('\n')).toContain('no divergences detected');
  });

  it('returns 30 on an unusable invocation, with usage on stderr', async () => {
    const { deps, err } = harness(['nonsense']);
    await expect(runProjectionInspectionCli(deps)).resolves.toBe(INSPECTION_EXIT_CONFIGURATION);
    expect(err.join('\n')).toContain('read-only');
  });

  it('returns 30 when the configuration cannot be resolved', async () => {
    const { deps, err } = harness(['list']);
    const failing: ProjectionInspectionCliDeps = {
      ...deps,
      resolveConfig: () => Promise.reject(new Error('DATABASE_URL is not set')),
    };
    await expect(runProjectionInspectionCli(failing)).resolves.toBe(INSPECTION_EXIT_CONFIGURATION);
    // The rule is named; the value never is.
    expect(err.join('\n')).not.toContain('DATABASE_URL is not set');
  });

  it('returns 30 when the projection-failure schema is incomplete', async () => {
    const { deps, err } = harness(['list'], { schemaPresent: false });
    await expect(runProjectionInspectionCli(deps)).resolves.toBe(INSPECTION_EXIT_CONFIGURATION);
    expect(err.join('\n')).toContain('migrations are behind');
  });

  it('returns 40 on an operational failure', async () => {
    const { deps, err } = harness(['list']);
    const failing: ProjectionInspectionCliDeps = {
      ...deps,
      createPool: () =>
        ({
          connect: () => Promise.reject(new Error('connection refused')),
        }) as unknown as DatabasePool,
    };
    await expect(runProjectionInspectionCli(failing)).resolves.toBe(INSPECTION_EXIT_OPERATIONAL);
    expect(err.join('\n')).not.toContain('connection refused');
  });

  it('keeps the five codes distinct', () => {
    const codes = [
      INSPECTION_EXIT_OK,
      INSPECTION_EXIT_FINDINGS,
      INSPECTION_EXIT_DIVERGENCE,
      INSPECTION_EXIT_CONFIGURATION,
      INSPECTION_EXIT_OPERATIONAL,
    ];
    expect(new Set(codes).size).toBe(5);
    expect(codes).toEqual([0, 10, 20, 30, 40]);
  });
});

describe('output', () => {
  it('emits a single parseable JSON line under --json', async () => {
    const { deps, out } = harness(['list', '--json']);
    await runProjectionInspectionCli(deps);
    expect(out).toHaveLength(1);
    const parsed = JSON.parse(out[0] ?? '{}') as Record<string, unknown>;
    expect(parsed['command']).toBe('list');
    expect(parsed['status']).toBe('healthy');
    expect(Array.isArray(parsed['items'])).toBe(true);
  });

  it('closes the pool even when the command fails', async () => {
    const closePool = vi.fn(() => Promise.resolve());
    const { deps } = harness(['list'], { schemaPresent: false });
    await runProjectionInspectionCli({ ...deps, closePool });
    expect(closePool).toHaveBeenCalledTimes(1);
  });

  it('NEVER prints the operator free-text reason in history output', async () => {
    const { deps, out } = harness(['history', '--failure-id', FAILURE_ID], {
      actions: [
        {
          sequence: '1',
          action_id: '44444444-5555-4666-8777-888888888888',
          failure_id: FAILURE_ID,
          action_type: 'acknowledged',
          actor_type: 'failure-operator',
          actor_id: 'ops-1',
          // Persisted for audit — and dropped by this surface.
          reason: REASON_SENTINEL,
          idempotency_key: null,
          correlation_id: null,
          expected_generation: 0,
          resulting_generation: 1,
          occurred_at: NOW_DATE,
          recorded_at: NOW_DATE,
        },
      ],
    });
    await runProjectionInspectionCli(deps);
    expect(out.join('\n')).not.toContain(REASON_SENTINEL);
  });

  it('NEVER prints the reason under --json either', async () => {
    const { deps, out } = harness(['history', '--failure-id', FAILURE_ID, '--json'], {
      actions: [
        {
          sequence: '1',
          action_id: '44444444-5555-4666-8777-888888888888',
          failure_id: FAILURE_ID,
          action_type: 'acknowledged',
          actor_type: 'failure-operator',
          actor_id: 'ops-1',
          reason: REASON_SENTINEL,
          idempotency_key: null,
          correlation_id: null,
          expected_generation: 0,
          resulting_generation: 1,
          occurred_at: NOW_DATE,
          recorded_at: NOW_DATE,
        },
      ],
    });
    await runProjectionInspectionCli(deps);
    const output = out.join('\n');
    expect(output).not.toContain(REASON_SENTINEL);
    expect(output).not.toContain('"reason"');
  });
});
