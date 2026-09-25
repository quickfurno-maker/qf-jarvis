/**
 * Narrow correlation-id reader for the correlation-timeline projection.
 *
 * The generic ProjectionEvent deliberately remains metadata-only. This module grants exactly one
 * projection access to the canonical correlation UUID at a projection position, mirroring the
 * subject-activity projection's narrow subject reader without widening every projection.
 */
import type { DatabaseClient } from '../persistence/pool.js';
import { ProjectionInputError, ProjectionStoredDataError } from './projection-errors.js';

export interface CorrelationReference {
  readonly correlationId: string;
}

interface RawCorrelationRow {
  readonly correlation_id: unknown;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

const SELECT_CORRELATION_BY_POSITION_SQL = `
SELECT e.correlation_id::text AS correlation_id
FROM qf_jarvis.projection_event_position AS m
JOIN qf_jarvis.event AS e ON e.sequence = m.event_storage_sequence
WHERE m.position = $1
`;

export async function readCorrelationReferenceAtPosition(
  client: DatabaseClient,
  position: bigint,
): Promise<CorrelationReference> {
  if (typeof position !== 'bigint' || position <= 0n) {
    throw new ProjectionInputError('projection position must be a positive integer position.');
  }

  const result = await client.query<RawCorrelationRow>(SELECT_CORRELATION_BY_POSITION_SQL, [
    position.toString(),
  ]);
  const raw = result.rows[0];
  if (raw === undefined) {
    throw new ProjectionStoredDataError('No event maps to the requested projection position.');
  }
  if (
    typeof raw.correlation_id !== 'string' ||
    raw.correlation_id.length !== 36 ||
    !UUID_PATTERN.test(raw.correlation_id)
  ) {
    throw new ProjectionStoredDataError('A stored correlation id is not a valid UUID reference.');
  }

  return Object.freeze({ correlationId: raw.correlation_id });
}
