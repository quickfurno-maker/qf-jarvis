import { describe, expect, it, vi } from 'vitest';

import type { DatabaseClient } from '../persistence/pool.js';
import {
  applyClientLifetime,
  CLIENT_LIFETIME_PROJECTION_NAME,
  CLIENT_LIFETIME_PROJECTION_VERSION,
  clientLifetimeProjection,
} from '../projections/handlers/client-lifetime.js';
import * as reader from '../projections/client-lifetime-evidence-reader.js';
import { createProductionProjectionRegistry } from '../projections/production-registry.js';
import { toCanonicalInstant, type ProjectionEvent } from '../projections/projection-definition.js';

const ACCEPTED_AT = toCanonicalInstant(new Date('2026-09-30T09:30:00.000Z'));

function projectionEvent(position = 7n): ProjectionEvent {
  return {
    position,
    eventType: 'qf.client.requirement-completed',
    eventVersion: 2,
    acceptedAt: ACCEPTED_AT,
  };
}

async function apply(evidence: unknown): Promise<ReturnType<typeof vi.fn>> {
  const spy = vi
    .spyOn(reader, 'readClientLifetimeEvidenceAtPosition')
    .mockResolvedValue(evidence as never);
  const query = vi.fn().mockResolvedValue({ rows: [] });
  const client = { query } as unknown as DatabaseClient;

  try {
    await applyClientLifetime(client, projectionEvent());
  } finally {
    spy.mockRestore();
  }
  return query;
}

describe('CI-03 client lifetime projection identity', () => {
  it('is implemented offline and deliberately absent from the production registry', () => {
    expect(CLIENT_LIFETIME_PROJECTION_NAME).toBe('client-lifetime');
    expect(CLIENT_LIFETIME_PROJECTION_VERSION).toBe(1);
    expect(clientLifetimeProjection.name).toBe('client-lifetime');
    expect(createProductionProjectionRegistry().has('client-lifetime')).toBe(false);
  });
});

describe('CI-03 current client state', () => {
  it('maps dissatisfaction to service recovery without any execution authority', async () => {
    const query = await apply({
      clientId: 'CORE-CLIENT-1',
      eventType: 'qf.client.dissatisfaction-recorded',
      leadId: 'CORE-LEAD-1',
      categoryId: 'CORE-CAT-1',
      reasonCode: 'vendors-unresponsive',
    });

    expect(query).toHaveBeenCalledTimes(2);
    const state = query.mock.calls[0] as [string, readonly unknown[]];
    expect(state[1][0]).toBe('CORE-CLIENT-1');
    expect(state[1][8]).toBe('dissatisfied');
    expect(state[1][9]).toBe(true);
    expect(state[1][10]).toBeNull();
    expect(state[0]).toContain('WHERE NOT rm.erased');
  });

  it('clears follow-up due state when a follow-up completes', async () => {
    const query = await apply({
      clientId: 'CORE-CLIENT-1',
      eventType: 'qf.client.follow-up-completed',
      leadId: 'CORE-LEAD-1',
      categoryId: 'CORE-CAT-1',
      reasonCode: 'follow-up-done',
    });
    const state = query.mock.calls[0] as [string, readonly unknown[]];
    expect(state[1][7]).toBe(false);
  });
  it('projects a confirmed additional service as a separate opportunity state', async () => {
    const query = await apply({
      clientId: 'CORE-CLIENT-1',
      eventType: 'qf.client.additional-service-confirmed',
      categoryId: 'CORE-CAT-KITCHEN',
      additionalServiceRequestId: 'ASR-1',
      additionalServiceStatus: 'confirmed',
      reasonCode: 'client-confirmed',
    });

    expect(query).toHaveBeenCalledTimes(3);
    const opportunity = query.mock.calls[2] as [string, readonly unknown[]];
    expect(opportunity[1]).toStrictEqual([
      'CORE-CLIENT-1',
      'CORE-CAT-KITCHEN',
      'ASR-1',
      'confirmed',
      '7',
      ACCEPTED_AT,
    ]);
    expect(opportunity[0]).toContain('rm_client_service_opportunity');
  });

  it('writes no projection rows for irrelevant events', async () => {
    const query = await apply(null);
    expect(query).not.toHaveBeenCalled();
  });
});

describe('CI-03 privacy erasure', () => {
  it('deletes derived detail and writes only a permanent state tombstone', async () => {
    const query = await apply({
      clientId: 'CORE-CLIENT-1',
      eventType: 'qf.privacy.erasure-recorded',
    });

    expect(query).toHaveBeenCalledTimes(3);
    expect(String(query.mock.calls[0]?.[0])).toContain('rm_client_lifetime_timeline');
    expect(String(query.mock.calls[1]?.[0])).toContain('rm_client_service_opportunity');
    expect(String(query.mock.calls[2]?.[0])).toContain('erased');
    expect(String(query.mock.calls[2]?.[0])).toContain('WHERE NOT rm.erased');
  });
});
