import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createAosOwnerAttentionObservation } from '@qf-jarvis/aos-intelligence';
import { afterEach, describe, expect, it } from 'vitest';

import { readAosOwnerAttentionObservation } from './aos-owner-attention-source';

const roots: string[] = [];
const emittedAt = '2026-10-01T10:00:00.000Z';
const nowMs = Date.parse('2026-10-01T10:10:00.000Z');

async function fixture(raw: unknown): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'qfj-aos-attention-'));
  roots.push(root);
  const path = join(root, 'attention.json');
  await writeFile(path, JSON.stringify(raw), 'utf8');
  return path;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('AOS owner-attention observation source', () => {
  it('reads a fresh strictly validated SHADOW snapshot', async () => {
    const path = await fixture(
      createAosOwnerAttentionObservation({
        cycleId: 'aos.proactive.cycle.1',
        emittedAt,
        items: [
          {
            caseId: 'case.aos.1',
            priority: 'P1',
            lane: 'SOON',
            attentionScore: 60,
            reasonCodes: ['PRIORITY_P1'],
            requiresOwnerReview: false,
            executionAuthority: 'NONE',
            businessEffect: false,
          },
        ],
      }),
    );
    await expect(readAosOwnerAttentionObservation(path, nowMs)).resolves.toMatchObject({
      status: 'AVAILABLE',
      observation: {
        mode: 'SHADOW',
        outboundNotificationAuthorized: false,
        items: [{ caseId: 'case.aos.1' }],
      },
    });
  });

  it('distinguishes missing, stale and malformed observations without leaking file errors', async () => {
    await expect(readAosOwnerAttentionObservation(undefined, nowMs)).resolves.toEqual({
      status: 'NOT_CONNECTED',
    });

    const stalePath = await fixture(
      createAosOwnerAttentionObservation({
        cycleId: 'aos.proactive.cycle.stale',
        emittedAt: '2026-10-01T09:00:00.000Z',
        items: [],
      }),
    );
    await expect(readAosOwnerAttentionObservation(stalePath, nowMs)).resolves.toEqual({
      status: 'STALE',
    });

    const malformedPath = await fixture({ protocol: 'wrong' });
    await expect(readAosOwnerAttentionObservation(malformedPath, nowMs)).resolves.toEqual({
      status: 'UNUSABLE',
    });
  });
});
