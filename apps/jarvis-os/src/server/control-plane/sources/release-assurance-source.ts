import { readFile } from 'node:fs/promises';
import { isAbsolute } from 'node:path';

import { parseReleaseAssuranceObservation } from '@qf-jarvis/release-assurance-observation-contract';

import type { ReadSourceDescriptor, SectionContributions } from './read-source';

const MAX_FILE_BYTES = 32 * 1024;

export function createReleaseAssuranceReadSource(
  filePath: string,
  expectedReleaseSha: string,
  now: () => Date = () => new Date(),
): ReadSourceDescriptor {
  if (!isAbsolute(filePath)) {
    throw new TypeError('release-assurance-path-invalid');
  }
  if (!/^[0-9a-f]{40}$/u.test(expectedReleaseSha)) {
    throw new TypeError('release-assurance-sha-invalid');
  }

  return Object.freeze({
    id: 'jarvis-os-release-assurance',
    label: 'Jarvis OS release assurance',
    observedReason:
      'Request-time read of the exact-release assurance receipt written only after final deployment verification.',
    owns: Object.freeze(['evaluations'] as const),
    timeoutMs: 1_000,
    async acquire(signal: AbortSignal) {
      let raw: string;
      try {
        raw = await readFile(filePath, { encoding: 'utf8', signal });
      } catch {
        return Object.freeze({
          status: 'UNAVAILABLE' as const,
          reason: 'SOURCE_UNREACHABLE' as const,
        });
      }

      if (raw.length < 2 || raw.length > MAX_FILE_BYTES) {
        return Object.freeze({
          status: 'UNAVAILABLE' as const,
          reason: 'SOURCE_RETURNED_UNUSABLE_DATA' as const,
        });
      }

      let observation;
      try {
        observation = parseReleaseAssuranceObservation(JSON.parse(raw));
      } catch {
        return Object.freeze({
          status: 'UNAVAILABLE' as const,
          reason: 'SOURCE_RETURNED_UNUSABLE_DATA' as const,
        });
      }

      if (observation.releaseSha !== expectedReleaseSha) {
        return Object.freeze({
          status: 'UNAVAILABLE' as const,
          reason: 'SOURCE_RETURNED_UNUSABLE_DATA' as const,
        });
      }

      const emitted = Date.parse(observation.emittedAt);
      const observedAt = now();
      if (!Number.isFinite(emitted) || emitted > observedAt.getTime() + 1_000) {
        return Object.freeze({
          status: 'UNAVAILABLE' as const,
          reason: 'SOURCE_RETURNED_UNUSABLE_DATA' as const,
        });
      }

      const sections: SectionContributions = Object.freeze({
        evaluations: {
          items: observation.dimensions.map((dimension) => ({
            id: dimension.id,
            label: dimension.label,
            state: dimension.state,
            detail: dimension.detail,
          })),
        },
      });

      return Object.freeze({
        status: 'OBSERVED' as const,
        observedAt: observation.emittedAt,
        sections,
      });
    },
  });
}
