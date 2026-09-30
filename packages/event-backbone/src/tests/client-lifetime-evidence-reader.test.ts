import { describe, expect, it, vi } from 'vitest';

import type { DatabaseClient } from '../persistence/pool.js';
import { readClientLifetimeEvidenceAtPosition } from '../projections/client-lifetime-evidence-reader.js';
import { ProjectionStoredDataError } from '../projections/projection-errors.js';

const CLIENT_ID = 'CORE-CLIENT-00311';
const LEAD_ID = 'CORE-LEAD-00042';
const CATEGORY_ID = 'CORE-CAT-WARDROBE';

function clientFor(row: Record<string, unknown>): DatabaseClient {
  return {
    query: vi.fn().mockResolvedValue({ rows: [row] }),
  } as unknown as DatabaseClient;
}

function row(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    position: '7',
    event_type: 'qf.client.requirement-completed',
    event_version: 2,
    source: 'quickfurno-core',
    subject_type: 'client',
    subject_id: CLIENT_ID,
    payload: {
      reasonCode: 'requirement-complete',
      lead: { entityType: 'lead', entityId: LEAD_ID },
      category: { entityType: 'category', entityId: CATEGORY_ID },
    },
    ...overrides,
  };
}

describe('CI-03 client lifetime evidence reader', () => {
  it('re-parses a registered client event and returns only bounded projection evidence', async () => {
    const evidence = await readClientLifetimeEvidenceAtPosition(clientFor(row()), 7n);

    expect(evidence).toStrictEqual({
      clientId: CLIENT_ID,
      eventType: 'qf.client.requirement-completed',
      leadId: LEAD_ID,
      categoryId: CATEGORY_ID,
      reasonCode: 'requirement-complete',
    });
  });

  it('returns null for an unrelated canonical event without treating it as corruption', async () => {
    const evidence = await readClientLifetimeEvidenceAtPosition(
      clientFor(
        row({
          event_type: 'qf.vendor.activated',
          event_version: 2,
          subject_type: 'vendor',
          subject_id: 'CORE-VENDOR-1',
          payload: null,
        }),
      ),
      7n,
    );

    expect(evidence).toBeNull();
  });
  it('fails closed when an admitted family appears at an unreviewed version', async () => {
    await expect(
      readClientLifetimeEvidenceAtPosition(clientFor(row({ event_version: 3, payload: null })), 7n),
    ).rejects.toThrow('unsupported contract version');
  });

  it('fails closed when a client event is not actually client-subject evidence', async () => {
    await expect(
      readClientLifetimeEvidenceAtPosition(
        clientFor(row({ subject_type: 'lead', subject_id: LEAD_ID })),
        7n,
      ),
    ).rejects.toThrow('does not carry a client subject');
  });

  it('fails closed when the stored payload no longer satisfies the canonical contract', async () => {
    await expect(
      readClientLifetimeEvidenceAtPosition(
        clientFor(row({ payload: { reasonCode: 'requirement-complete' } })),
        7n,
      ),
    ).rejects.toBeInstanceOf(ProjectionStoredDataError);
  });

  it('fails closed on a position mismatch', async () => {
    await expect(
      readClientLifetimeEvidenceAtPosition(clientFor(row({ position: '8' })), 7n),
    ).rejects.toThrow('does not match the requested position');
  });
});
