/**
 * SCALE-P09 — production database connection budget.
 *
 * The live QF-Jarvis Supabase project reports max_connections=60. We do not
 * treat those 60 slots as ours: Supabase Auth/Storage/Realtime/health/admin and
 * incident response need deterministic headroom.
 *
 * Budget:
 *   28 platform/admin reserve
 *   16 Jarvis application pools
 *   16 emergency/incident headroom
 *   = 60
 *
 * Target deployment certified by Phase 09:
 *   2 gateway replicas * 3 = 6
 *   2 worker replicas  * 5 = 10
 *   total application maximum = 16
 */
export const JARVIS_DB_CONNECTION_BUDGET = Object.freeze({
  observedMaxConnections: 60,
  platformReserve: 28,
  applicationBudget: 16,
  emergencyHeadroom: 16,
  gateway: Object.freeze({ targetReplicas: 2, maxConnectionsPerReplica: 3 }),
  worker: Object.freeze({ targetReplicas: 2, maxConnectionsPerReplica: 5 }),
  // The worker's pg.Pool is the hard DB concurrency limiter. Turn concurrency
  // may be higher because database sections are short-lived, but admission must
  // remain bounded relative to pool capacity so an accidental config cannot
  // create an unbounded waiter queue.
  maxAdmittedTurnsPerWorkerDbConnection: 40,
} as const);

export type ProductionDatabaseRole = 'gateway' | 'worker';

export class DatabaseConnectionBudgetError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'DatabaseConnectionBudgetError';
  }
}

export function rolePoolLimit(role: ProductionDatabaseRole): number {
  return role === 'gateway'
    ? JARVIS_DB_CONNECTION_BUDGET.gateway.maxConnectionsPerReplica
    : JARVIS_DB_CONNECTION_BUDGET.worker.maxConnectionsPerReplica;
}

export function assertProductionDatabaseRoleBudget(
  role: ProductionDatabaseRole,
  maxConnections: number,
): void {
  const limit = rolePoolLimit(role);
  if (!Number.isInteger(maxConnections) || maxConnections < 1 || maxConnections > limit) {
    throw new DatabaseConnectionBudgetError(
      `${role} database maxConnections must be an integer between 1 and ${String(limit)}`,
    );
  }
}

export function assertWorkerTurnConcurrencyBudget(
  maxConnections: number,
  globalMaxConcurrentTurns: number,
): void {
  assertProductionDatabaseRoleBudget('worker', maxConnections);
  const maxTurns =
    maxConnections * JARVIS_DB_CONNECTION_BUDGET.maxAdmittedTurnsPerWorkerDbConnection;
  if (
    !Number.isInteger(globalMaxConcurrentTurns) ||
    globalMaxConcurrentTurns < 1 ||
    globalMaxConcurrentTurns > maxTurns
  ) {
    throw new DatabaseConnectionBudgetError(
      `worker globalMaxConcurrentTurns must be between 1 and ${String(maxTurns)} for the configured database pool`,
    );
  }
}

export function targetApplicationConnectionCeiling(): number {
  return (
    JARVIS_DB_CONNECTION_BUDGET.gateway.targetReplicas *
      JARVIS_DB_CONNECTION_BUDGET.gateway.maxConnectionsPerReplica +
    JARVIS_DB_CONNECTION_BUDGET.worker.targetReplicas *
      JARVIS_DB_CONNECTION_BUDGET.worker.maxConnectionsPerReplica
  );
}

export function assertConnectionBudgetInvariant(): void {
  const total =
    JARVIS_DB_CONNECTION_BUDGET.platformReserve +
    JARVIS_DB_CONNECTION_BUDGET.applicationBudget +
    JARVIS_DB_CONNECTION_BUDGET.emergencyHeadroom;
  if (total !== JARVIS_DB_CONNECTION_BUDGET.observedMaxConnections) {
    throw new DatabaseConnectionBudgetError(
      'database connection budget does not sum to observed max',
    );
  }
  if (targetApplicationConnectionCeiling() > JARVIS_DB_CONNECTION_BUDGET.applicationBudget) {
    throw new DatabaseConnectionBudgetError('target replica topology exceeds application budget');
  }
}
