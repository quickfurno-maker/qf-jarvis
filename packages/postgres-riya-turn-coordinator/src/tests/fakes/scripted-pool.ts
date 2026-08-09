/**
 * A scripted `pg` Pool and PoolClient. TEST-ONLY.
 *
 * `src/tests/**` is excluded from `tsconfig.build.json`, so nothing here can reach `dist/`.
 *
 * ### Why a fake, when there is already a real-database suite
 *
 * The integration suite proves what the coordinator does when PostgreSQL behaves. This fake proves
 * what it does when PostgreSQL answers in a way a healthy server never would — a guarded `UPDATE`
 * reporting zero rows, an `INSERT` creating nothing, an advisory unlock returning `false`. Those are
 * precisely the answers that would let a false success escape, and they are not reachable against a
 * correct server without corrupting it.
 *
 * It also records `release()` versus `release(true)`, which is the only way to observe whether a
 * session whose unlock was not provably clean was DESTROYED rather than handed back to the pool. A
 * leaked session lock on a reused connection would block an unrelated conversation forever.
 *
 * Nothing here opens a socket, reads an environment variable or is exported from production.
 */
import type { Pool, PoolClient, QueryResult } from 'pg';

/** What one scripted statement answers with. */
export type ScriptedAnswer =
  | { readonly rows?: readonly Record<string, unknown>[]; readonly rowCount?: number | null }
  | { readonly throws: Error };

/** The statements a spec may script, keyed by the distinctive fragment of each. */
export interface ScriptedPoolOptions {
  /** `pg_try_advisory_lock`. Default: acquired. */
  readonly lock?: ScriptedAnswer;
  /** The candidate-claim read. Default: no rows. */
  readonly select?: ScriptedAnswer;
  /** `INSERT ... riya_logical_turn_claims`. Default: one row. */
  readonly insert?: ScriptedAnswer;
  /** `UPDATE ... SET claim_state`. Default: one row. */
  readonly finalize?: ScriptedAnswer;
  /** `pg_advisory_unlock`. Default: released. */
  readonly unlock?: ScriptedAnswer;
  /** Reject `pool.connect()` itself. */
  readonly connectRejects?: boolean;
}

export interface ScriptedPool {
  readonly pool: Pool;
  /** Every statement text this coordinator ran, in order. */
  statements(): readonly string[];
  /** How many times a client was handed back HEALTHY. */
  healthyReleases(): number;
  /** How many times a client was DESTROYED — `release(true)`. */
  destroyedReleases(): number;
}

const answer = (scripted: ScriptedAnswer | undefined, fallback: ScriptedAnswer): QueryResult => {
  const chosen = scripted ?? fallback;
  if ('throws' in chosen) {
    throw chosen.throws;
  }
  const result: Pick<QueryResult, 'rows' | 'rowCount' | 'command' | 'oid' | 'fields'> = {
    rows: [...(chosen.rows ?? [])],
    rowCount: chosen.rowCount ?? chosen.rows?.length ?? 0,
    command: '',
    oid: 0,
    fields: [],
  };
  return result as QueryResult;
};

export function scriptedPool(over: ScriptedPoolOptions = {}): ScriptedPool {
  const statements: string[] = [];
  let healthy = 0;
  let destroyed = 0;

  const client = {
    query(text: string): Promise<QueryResult> {
      statements.push(text);
      try {
        if (text.includes('pg_try_advisory_lock')) {
          return Promise.resolve(answer(over.lock, { rows: [{ acquired: true }] }));
        }
        if (text.includes('pg_advisory_unlock')) {
          return Promise.resolve(answer(over.unlock, { rows: [{ released: true }] }));
        }
        if (text.includes('INSERT INTO')) {
          return Promise.resolve(answer(over.insert, { rowCount: 1, rows: [] }));
        }
        if (text.includes('UPDATE')) {
          return Promise.resolve(answer(over.finalize, { rowCount: 1, rows: [] }));
        }
        if (text.includes('SELECT')) {
          return Promise.resolve(answer(over.select, { rows: [] }));
        }
      } catch (error: unknown) {
        return Promise.reject(error instanceof Error ? error : new Error('scripted failure'));
      }
      return Promise.reject(new Error(`unscripted statement: ${text.slice(0, 40)}`));
    },
    release(destroy?: boolean): void {
      if (destroy === true) {
        destroyed += 1;
      } else {
        healthy += 1;
      }
    },
  } as unknown as PoolClient;

  const pool = {
    connect(): Promise<PoolClient> {
      if (over.connectRejects === true) {
        // A realistic failure carries exactly the kind of detail that must never escape.
        return Promise.reject(
          Object.assign(new Error('connect ECONNREFUSED 10.0.0.7:5432 — password=hunter2'), {
            code: '08006',
          }),
        );
      }
      return Promise.resolve(client);
    },
  } as unknown as Pool;

  return {
    pool,
    statements: () => statements,
    healthyReleases: () => healthy,
    destroyedReleases: () => destroyed,
  };
}

/** A `pg`-shaped error carrying a SQLSTATE, so the classifier's real branches are exercised. */
export function sqlError(code: string, message = 'relation "x" at 10.0.0.7 — token=abc123'): Error {
  return Object.assign(new Error(message), { code, table: 'riya_logical_turn_claims' });
}
