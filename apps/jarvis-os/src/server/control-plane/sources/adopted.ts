import {
  readCoreReadConfigPathFromEnvironment,
  readReleaseAssuranceObservationPathFromEnvironment,
  readReleaseShaFromEnvironment,
  readWorkerObservationPathFromEnvironment,
} from '../../auth/config/loader';
import type { ReadSourceDescriptor } from './read-source';
import { createQuickFurnoOperatorReadSource } from './quickfurno-operator-source';
import { createReleaseAssuranceReadSource } from './release-assurance-source';
import { createWorkerObservationReadSource } from './worker-observation-source';

export function createAdoptedReadSources(
  workerObservationFile: string | undefined,
  coreReadConfigFile?: string,
  releaseAssuranceFile?: string,
  releaseSha?: string,
): readonly ReadSourceDescriptor[] {
  const sources: ReadSourceDescriptor[] = [];
  if (workerObservationFile !== undefined) {
    sources.push(createWorkerObservationReadSource(workerObservationFile));
  }
  if (coreReadConfigFile !== undefined) {
    sources.push(createQuickFurnoOperatorReadSource(coreReadConfigFile));
  }
  // Assurance is meaningful only as a pair: a receipt path plus the exact running release SHA.
  // Partial configuration stays unadopted rather than accepting evidence whose release cannot be
  // correlated to the image currently serving the operator.
  if (releaseAssuranceFile !== undefined && releaseSha !== undefined) {
    sources.push(createReleaseAssuranceReadSource(releaseAssuranceFile, releaseSha));
  }
  return Object.freeze(sources);
}

export const ADOPTED_READ_SOURCES: readonly ReadSourceDescriptor[] = createAdoptedReadSources(
  readWorkerObservationPathFromEnvironment(),
  readCoreReadConfigPathFromEnvironment(),
  readReleaseAssuranceObservationPathFromEnvironment(),
  readReleaseShaFromEnvironment(),
);
