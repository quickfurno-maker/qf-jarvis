import { describe, expect, it } from 'vitest';

import type { DatabaseClient } from '../persistence/pool.js';
import {
  ProjectionInputError,
  ProjectionStoredDataError,
} from '../projections/projection-errors.js';
import { readCorrelationReferenceAtPosition } from '../projections/projection-correlation-reader.js';

function fakeClient(row: { correlation_id?: unknown } | undefined): DatabaseClient {
  const query = (): Promise<{ rows: unknown[] }> =>
    Promise.resolve({ rows: row === undefined ? [] : [row] });
  return { query } as unknown as DatabaseClient;
}

describe('readCorrelationReferenceAtPosition', () => {
  it('returns a frozen canonical UUID reference', async () => {
    const value = '11111111-2222-4333-8444-555555555555';
    const result = await readCorrelationReferenceAtPosition(
      fakeClient({ correlation_id: value }),
      7n,
    );
    expect(result).toEqual({ correlationId: value });
    expect(Object.isFrozen(result)).toBe(true);
  });

  it('rejects non-positive positions before reading storage', async () => {
    await expect(
      readCorrelationReferenceAtPosition(fakeClient(undefined), 0n),
    ).rejects.toBeInstanceOf(ProjectionInputError);
  });

  it('fails closed on a missing mapped event', async () => {
    await expect(
      readCorrelationReferenceAtPosition(fakeClient(undefined), 2n),
    ).rejects.toBeInstanceOf(ProjectionStoredDataError);
  });

  it('rejects malformed stored UUIDs without echoing them', async () => {
    const malformed = 'not-a-correlation-secret';
    let raised: unknown;
    try {
      await readCorrelationReferenceAtPosition(fakeClient({ correlation_id: malformed }), 3n);
    } catch (error: unknown) {
      raised = error;
    }
    expect(raised).toBeInstanceOf(ProjectionStoredDataError);
    expect((raised as Error).message).not.toContain(malformed);
  });
});
