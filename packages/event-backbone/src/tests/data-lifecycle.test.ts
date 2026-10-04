import { describe, expect, it } from 'vitest';

import { JARVIS_DATA_LIFECYCLE, jarvisReadConsistencyFor } from '../persistence/data-lifecycle.js';

describe('SCALE-P09 Jarvis data lifecycle', () => {
  it('never auto-deletes the canonical event ledger', () => {
    expect(JARVIS_DATA_LIFECYCLE.eventLedger.autoDeleteEnabled).toBe(false);
    expect(JARVIS_DATA_LIFECYCLE.eventLedger.archiveRequiredBeforeDelete).toBe(true);
    expect(JARVIS_DATA_LIFECYCLE.eventLedger.relation).toBe('qf_jarvis.event');
  });

  it('allows only terminal opaque turn-spool metadata to be operationally retained', () => {
    expect(JARVIS_DATA_LIFECYCLE.quickFurnoTurnSpool.autoDeleteEnabled).toBe(true);
    expect(JARVIS_DATA_LIFECYCLE.quickFurnoTurnSpool.retainedDays).toBe(30);
    expect(JARVIS_DATA_LIFECYCLE.quickFurnoTurnSpool.maxPruneBatch).toBe(1000);
  });

  it('keeps correctness and read-after-write paths on primary', () => {
    for (const useCase of [
      'event_ingestion',
      'turn_claim',
      'projection_checkpoint',
      'human_takeover_state',
      'post_write_confirmation',
    ] as const) {
      expect(jarvisReadConsistencyFor(useCase)).toBe('PRIMARY_STRONG');
    }
  });

  it('permits future replicas only for eventually consistent reads', () => {
    for (const useCase of ['analytics', 'telemetry', 'historical_read_model'] as const) {
      expect(jarvisReadConsistencyFor(useCase)).toBe('REPLICA_EVENTUAL');
    }
  });
});
