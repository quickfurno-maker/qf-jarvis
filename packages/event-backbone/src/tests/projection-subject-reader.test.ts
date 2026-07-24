/**
 * QFJ-P03.09 — unit proofs for the narrow subject reader (ADR-0044), against a scripted fake client.
 *
 * Pins: opaque-grammar validation (mirrors migration 0001), fail-closed on a non-positive position, a
 * missing position, and a malformed stored value, a frozen result, and that no raw subject value ever
 * reaches an error message.
 */
import { describe, expect, it } from 'vitest';

import type { DatabaseClient } from '../persistence/pool.js';
import {
  ProjectionInputError,
  ProjectionStoredDataError,
} from '../projections/projection-errors.js';
import { readSubjectReferenceAtPosition } from '../projections/projection-subject-reader.js';

function fakeClient(
  row: { subject_type?: unknown; subject_id?: unknown } | undefined,
): DatabaseClient {
  const query = (): Promise<{ rows: unknown[] }> =>
    Promise.resolve({ rows: row === undefined ? [] : [row] });
  return { query } as unknown as DatabaseClient;
}

describe('readSubjectReferenceAtPosition — valid resolution', () => {
  it('returns a frozen opaque EntityReference for valid stored values', async () => {
    const client = fakeClient({ subject_type: 'client', subject_id: 'CORE-CLIENT-1' });
    const subject = await readSubjectReferenceAtPosition(client, 1n);
    expect(subject).toEqual({ subjectType: 'client', subjectId: 'CORE-CLIENT-1' });
    expect(Object.isFrozen(subject)).toBe(true);
  });

  it('accepts the full opaque id charset and dotted machine-token types', async () => {
    const client = fakeClient({ subject_type: 'vendor.profile', subject_id: 'a.b_c-9:Z' });
    const subject = await readSubjectReferenceAtPosition(client, 2n);
    expect(subject.subjectType).toBe('vendor.profile');
    expect(subject.subjectId).toBe('a.b_c-9:Z');
  });
});

describe('readSubjectReferenceAtPosition — fail closed', () => {
  it('rejects a non-positive position before any query', async () => {
    await expect(readSubjectReferenceAtPosition(fakeClient(undefined), 0n)).rejects.toBeInstanceOf(
      ProjectionInputError,
    );
    await expect(readSubjectReferenceAtPosition(fakeClient(undefined), -1n)).rejects.toBeInstanceOf(
      ProjectionInputError,
    );
  });

  it('fails closed when the position maps to no event (corruption at handler time)', async () => {
    await expect(readSubjectReferenceAtPosition(fakeClient(undefined), 5n)).rejects.toBeInstanceOf(
      ProjectionStoredDataError,
    );
  });

  it('rejects a malformed subject type (uppercase / free text) without echoing the value', async () => {
    const malformed = 'Not A Valid Type!';
    let raised: unknown;
    try {
      await readSubjectReferenceAtPosition(
        fakeClient({ subject_type: malformed, subject_id: 'CORE-1' }),
        1n,
      );
    } catch (error: unknown) {
      raised = error;
    }
    expect(raised).toBeInstanceOf(ProjectionStoredDataError);
    expect((raised as Error).message).not.toContain(malformed);
  });

  it('rejects a malformed subject id (spaces / disallowed chars) without echoing the value', async () => {
    const malformed = 'has spaces and #';
    let raised: unknown;
    try {
      await readSubjectReferenceAtPosition(
        fakeClient({ subject_type: 'client', subject_id: malformed }),
        1n,
      );
    } catch (error: unknown) {
      raised = error;
    }
    expect(raised).toBeInstanceOf(ProjectionStoredDataError);
    expect((raised as Error).message).not.toContain(malformed);
  });

  it('rejects an over-length subject id', async () => {
    const tooLong = 'A'.repeat(129);
    await expect(
      readSubjectReferenceAtPosition(
        fakeClient({ subject_type: 'client', subject_id: tooLong }),
        1n,
      ),
    ).rejects.toBeInstanceOf(ProjectionStoredDataError);
  });

  it('rejects a non-string stored value', async () => {
    await expect(
      readSubjectReferenceAtPosition(fakeClient({ subject_type: 123, subject_id: 'CORE-1' }), 1n),
    ).rejects.toBeInstanceOf(ProjectionStoredDataError);
  });
});
