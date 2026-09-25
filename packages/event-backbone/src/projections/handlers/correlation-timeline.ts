/**
 * Correlation timeline projection.
 *
 * One immutable metadata row per canonical event, keyed by correlation UUID and projection
 * position. This is the minimum read model needed for exact operator lineage later:
 * correlation -> ordered event type/version/acceptance time. It stores no payload, subject,
 * event id, causation id, provider data, prompt, model output, free text or business value.
 */
import type { DatabaseClient } from '../../persistence/pool.js';
import {
  defineProjection,
  type ProjectionDefinition,
  type ProjectionEvent,
} from '../projection-definition.js';
import { readCorrelationReferenceAtPosition } from '../projection-correlation-reader.js';

export const CORRELATION_TIMELINE_PROJECTION_NAME = 'correlation-timeline';
export const CORRELATION_TIMELINE_PROJECTION_VERSION = 1;

const INSERT_SQL = `
INSERT INTO qf_jarvis.rm_correlation_timeline
  (correlation_id, event_position, event_type, event_version, accepted_at)
VALUES ($1::uuid, $2::bigint, $3, $4::integer, $5::timestamptz)
ON CONFLICT (correlation_id, event_position) DO NOTHING
`;

export async function applyCorrelationTimeline(
  client: DatabaseClient,
  event: ProjectionEvent,
): Promise<void> {
  const correlation = await readCorrelationReferenceAtPosition(client, event.position);
  await client.query(INSERT_SQL, [
    correlation.correlationId,
    event.position.toString(),
    event.eventType,
    event.eventVersion,
    event.acceptedAt,
  ]);
}

export const correlationTimelineProjection: ProjectionDefinition = defineProjection({
  name: CORRELATION_TIMELINE_PROJECTION_NAME,
  version: CORRELATION_TIMELINE_PROJECTION_VERSION,
  apply: applyCorrelationTimeline,
});
