/**
 * SCALE-P09 — Jarvis data lifecycle and read-replica policy.
 *
 * Canonical event history is business/audit evidence. It is archive-before-
 * delete and Phase 09 exposes no delete authority for it.
 *
 * The QuickFurno turn spool is different: it contains opaque routing metadata
 * only and terminal rows can be pruned after the retention window by a bounded
 * maintenance-only function.
 */
export const JARVIS_DATA_LIFECYCLE = Object.freeze({
  eventLedger: Object.freeze({
    relation: 'qf_jarvis.event',
    lifecycleClass: 'canonical_event',
    hotDays: 30,
    retainedDays: 365,
    archiveRequiredBeforeDelete: true,
    autoDeleteEnabled: false,
    partitionReviewBytes: 10 * 1024 * 1024 * 1024,
  }),
  quickFurnoTurnSpool: Object.freeze({
    relation: 'qf_jarvis.quickfurno_turn_spool',
    lifecycleClass: 'operational',
    hotDays: 7,
    retainedDays: 30,
    archiveRequiredBeforeDelete: false,
    autoDeleteEnabled: true,
    maxPruneBatch: 1000,
    partitionReviewBytes: 1024 * 1024 * 1024,
  }),
} as const);

export type JarvisReadUseCase =
  | 'event_ingestion'
  | 'turn_claim'
  | 'projection_checkpoint'
  | 'human_takeover_state'
  | 'post_write_confirmation'
  | 'analytics'
  | 'telemetry'
  | 'historical_read_model';

export type JarvisReadConsistency = 'PRIMARY_STRONG' | 'REPLICA_EVENTUAL';

const STRONG = new Set<JarvisReadUseCase>([
  'event_ingestion',
  'turn_claim',
  'projection_checkpoint',
  'human_takeover_state',
  'post_write_confirmation',
]);

export function jarvisReadConsistencyFor(useCase: JarvisReadUseCase): JarvisReadConsistency {
  return STRONG.has(useCase) ? 'PRIMARY_STRONG' : 'REPLICA_EVENTUAL';
}
