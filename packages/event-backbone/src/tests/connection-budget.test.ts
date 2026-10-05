import { describe, expect, it } from 'vitest';

import {
  assertConnectionBudgetInvariant,
  assertProductionDatabaseRoleBudget,
  assertWorkerTurnConcurrencyBudget,
  DatabaseConnectionBudgetError,
  JARVIS_DB_CONNECTION_BUDGET,
  rolePoolLimit,
  targetApplicationConnectionCeiling,
} from '../persistence/connection-budget.js';

describe('SCALE-P09 database connection budget', () => {
  it('exactly fits the observed 60-connection envelope', () => {
    expect(() => {
      assertConnectionBudgetInvariant();
    }).not.toThrow();
    expect(
      JARVIS_DB_CONNECTION_BUDGET.platformReserve +
        JARVIS_DB_CONNECTION_BUDGET.applicationBudget +
        JARVIS_DB_CONNECTION_BUDGET.emergencyHeadroom,
    ).toBe(60);
    expect(targetApplicationConnectionCeiling()).toBe(16);
  });

  it('locks gateway and worker production pool ceilings', () => {
    expect(rolePoolLimit('gateway')).toBe(3);
    expect(rolePoolLimit('worker')).toBe(5);
    expect(() => {
      assertProductionDatabaseRoleBudget('gateway', 3);
    }).not.toThrow();
    expect(() => {
      assertProductionDatabaseRoleBudget('worker', 5);
    }).not.toThrow();
    expect(() => {
      assertProductionDatabaseRoleBudget('gateway', 4);
    }).toThrow(DatabaseConnectionBudgetError);
    expect(() => {
      assertProductionDatabaseRoleBudget('worker', 6);
    }).toThrow(DatabaseConnectionBudgetError);
  });

  it('ties worker admission to its database pool instead of an ambient 200-turn constant', () => {
    expect(() => {
      assertWorkerTurnConcurrencyBudget(5, 200);
    }).not.toThrow();
    expect(() => {
      assertWorkerTurnConcurrencyBudget(4, 160);
    }).not.toThrow();
    expect(() => {
      assertWorkerTurnConcurrencyBudget(4, 161);
    }).toThrow(DatabaseConnectionBudgetError);
  });
});
