/**
 * Narrow read-only correlation timeline query.
 *
 * Internal application boundary. It reads only the disposable correlation projection and returns
 * only the canonical correlation UUID plus immutable event metadata.
 */
import type { DatabasePool } from '../persistence/pool.js';
import { toCanonicalInstant } from './projection-definition.js';
import { ProjectionInputError, ProjectionStoredDataError } from './projection-errors.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const EVENT_TYPE_PATTERN = /^[a-z0-9]+([-.][a-z0-9]+)*$/u;

export const CORRELATION_TIMELINE_MAX_ITEMS = 200;

export interface CorrelationTimelineReadInput {
  readonly correlationId: string;
  readonly limit?: number;
}

export interface CorrelationTimelineItem {
  readonly position: string;
  readonly eventType: string;
  readonly eventVersion: number;
  readonly acceptedAt: string;
}

export interface CorrelationTimelineReadResult {
  readonly correlationId: string;
  readonly items: readonly CorrelationTimelineItem[];
  readonly truncated: boolean;
  readonly readOnly: true;
}

interface RawTimelineRow {
  readonly event_position: unknown;
  readonly event_type: unknown;
  readonly event_version: unknown;
  readonly accepted_at: unknown;
}

const SELECT_SQL = [
  'SELECT event_position::text, event_type, event_version, accepted_at',
  'FROM qf_jarvis.rm_correlation_timeline',
  'WHERE correlation_id = $1::uuid',
  'ORDER BY event_position ASC',
  'LIMIT $2::integer',
].join('\n');

function parsePosition(value: unknown): string {
  if (typeof value !== 'string' || !/^[1-9][0-9]*$/u.test(value)) {
    throw new ProjectionStoredDataError('A correlation timeline position is invalid.');
  }
  try {
    if (BigInt(value) <= 0n) {
      throw new ProjectionStoredDataError('A correlation timeline position is invalid.');
    }
  } catch {
    throw new ProjectionStoredDataError('A correlation timeline position is invalid.');
  }
  return value;
}

function parseRow(raw: RawTimelineRow): CorrelationTimelineItem {
  const position = parsePosition(raw.event_position);
  if (
    typeof raw.event_type !== 'string' ||
    raw.event_type.length < 1 ||
    raw.event_type.length > 64 ||
    !EVENT_TYPE_PATTERN.test(raw.event_type)
  ) {
    throw new ProjectionStoredDataError('A correlation timeline event type is invalid.');
  }
  if (
    typeof raw.event_version !== 'number' ||
    !Number.isSafeInteger(raw.event_version) ||
    raw.event_version < 1 ||
    raw.event_version > 1000
  ) {
    throw new ProjectionStoredDataError('A correlation timeline event version is invalid.');
  }

  let acceptedAt: string;
  try {
    acceptedAt = toCanonicalInstant(raw.accepted_at);
  } catch {
    throw new ProjectionStoredDataError('A correlation timeline acceptance instant is invalid.');
  }

  return Object.freeze({
    position,
    eventType: raw.event_type,
    eventVersion: raw.event_version,
    acceptedAt,
  });
}

export async function readCorrelationTimeline(
  pool: DatabasePool,
  input: CorrelationTimelineReadInput,
): Promise<CorrelationTimelineReadResult> {
  if (
    typeof input.correlationId !== 'string' ||
    !UUID_PATTERN.test(input.correlationId) ||
    (input.limit !== undefined &&
      (!Number.isInteger(input.limit) ||
        input.limit < 1 ||
        input.limit > CORRELATION_TIMELINE_MAX_ITEMS))
  ) {
    throw new ProjectionInputError('correlation timeline request is invalid.');
  }

  const limit = input.limit ?? 100;
  const client = await pool.connect();
  try {
    const result = await client.query<RawTimelineRow>(SELECT_SQL, [input.correlationId, limit + 1]);
    const truncated = result.rows.length > limit;
    const items = Object.freeze(result.rows.slice(0, limit).map(parseRow));
    return Object.freeze({
      correlationId: input.correlationId,
      items,
      truncated,
      readOnly: true as const,
    });
  } finally {
    client.release();
  }
}
