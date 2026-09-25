import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { createReleaseAssuranceReadSource } from './release-assurance-source';

const SHA = 'a'.repeat(40);
const NOW = new Date('2026-09-25T02:00:00.000Z');
const roots: string[] = [];

async function fixture(overrides: Record<string, unknown> = {}) {
  const root = await mkdtemp(join(tmpdir(), 'qfj-assurance-'));
  roots.push(root);
  const file = join(root, 'current.json');
  await writeFile(
    file,
    JSON.stringify({
      protocol: 'qfj.release-assurance-observation.v1',
      emittedAt: '2026-09-25T01:59:30.000Z',
      releaseSha: SHA,
      dimensions: [
        {
          id: 'release-identity',
          label: 'Exact release identity',
          state: 'HEALTHY',
          detail: 'The externally verified release matches the reviewed Git revision.',
        },
      ],
      ...overrides,
    }),
    'utf8',
  );
  return file;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('release assurance read source', () => {
  it('publishes only exact-release assurance as observed evaluation evidence', async () => {
    const source = createReleaseAssuranceReadSource(await fixture(), SHA, () => NOW);
    const result = await source.acquire(new AbortController().signal);

    expect(result.status).toBe('OBSERVED');
    if (result.status === 'OBSERVED') {
      expect(result.observedAt).toBe('2026-09-25T01:59:30.000Z');
      expect(result.sections.evaluations?.items).toEqual([
        {
          id: 'release-identity',
          label: 'Exact release identity',
          state: 'HEALTHY',
          detail: 'The externally verified release matches the reviewed Git revision.',
        },
      ]);
    }
  });

  it('fails closed when a valid receipt belongs to a different release', async () => {
    const source = createReleaseAssuranceReadSource(
      await fixture({ releaseSha: 'b'.repeat(40) }),
      SHA,
      () => NOW,
    );
    await expect(source.acquire(new AbortController().signal)).resolves.toEqual({
      status: 'UNAVAILABLE',
      reason: 'SOURCE_RETURNED_UNUSABLE_DATA',
    });
  });

  it('fails closed for future or malformed assurance', async () => {
    const future = createReleaseAssuranceReadSource(
      await fixture({ emittedAt: '2026-09-25T02:00:02.000Z' }),
      SHA,
      () => NOW,
    );
    await expect(future.acquire(new AbortController().signal)).resolves.toEqual({
      status: 'UNAVAILABLE',
      reason: 'SOURCE_RETURNED_UNUSABLE_DATA',
    });

    const malformed = createReleaseAssuranceReadSource(
      await fixture({ rawLog: 'must not be accepted' }),
      SHA,
      () => NOW,
    );
    await expect(malformed.acquire(new AbortController().signal)).resolves.toEqual({
      status: 'UNAVAILABLE',
      reason: 'SOURCE_RETURNED_UNUSABLE_DATA',
    });
  });

  it('rejects relative paths and non-SHA release identities before acquisition', () => {
    expect(() => createReleaseAssuranceReadSource('current.json', SHA)).toThrow(
      'release-assurance-path-invalid',
    );
    expect(() => createReleaseAssuranceReadSource('C:\\tmp\\current.json', 'main')).toThrow();
  });
});
