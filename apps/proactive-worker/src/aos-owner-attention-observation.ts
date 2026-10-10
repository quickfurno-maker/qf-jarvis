import { mkdir, rename, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute } from 'node:path';

import {
  createAosOwnerAttentionObservation,
  type AosOwnerAttentionObservation,
} from '@qf-jarvis/aos-intelligence';

import type { AosSupervisorCycleResult } from './aos-supervisor-cycle.js';

export interface AosOwnerAttentionObservationWriter {
  write(cycle: AosSupervisorCycleResult, emittedAt: string): Promise<void>;
}

export function buildAosOwnerAttentionObservation(
  cycle: AosSupervisorCycleResult,
  emittedAt: string,
): AosOwnerAttentionObservation {
  const recommendationByCase = new Map(
    cycle.cases
      .filter((one) => one.recommendation !== undefined)
      .map((one) => [one.case.caseId, one.recommendation] as const),
  );
  return createAosOwnerAttentionObservation({
    cycleId: cycle.cycleId,
    emittedAt,
    items: cycle.ownerAttention.map((attention) => {
      const recommendation = recommendationByCase.get(attention.caseId);
      return {
        ...attention,
        ...(recommendation === undefined ? {} : { recommendationAction: recommendation.action }),
      };
    }),
  });
}

export function createFileAosOwnerAttentionObservationWriter(
  filePath: string,
): AosOwnerAttentionObservationWriter {
  if (!isAbsolute(filePath)) {
    throw new TypeError('aos-owner-attention-observation-path-invalid');
  }
  return Object.freeze({
    async write(cycle: AosSupervisorCycleResult, emittedAt: string): Promise<void> {
      const snapshot = buildAosOwnerAttentionObservation(cycle, emittedAt);
      const directory = dirname(filePath);
      await mkdir(directory, { recursive: true, mode: 0o750 });
      const temporary = filePath + '.tmp';
      await writeFile(temporary, JSON.stringify(snapshot), { encoding: 'utf8', mode: 0o640 });
      await rename(temporary, filePath);
    },
  });
}
