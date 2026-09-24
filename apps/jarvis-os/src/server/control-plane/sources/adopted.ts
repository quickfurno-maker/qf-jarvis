import {
  readCoreReadConfigPathFromEnvironment,
  readWorkerObservationPathFromEnvironment,
} from '../../auth/config/loader';
import type { ReadSourceDescriptor } from './read-source';
import { createQuickFurnoOperatorReadSource } from './quickfurno-operator-source';
import { createWorkerObservationReadSource } from './worker-observation-source';

export function createAdoptedReadSources(
  workerObservationFile: string | undefined,
  coreReadConfigFile?: string  ,
): readonly ReadSourceDescriptor[] {
  const sources: ReadSourceDescriptor[] = [];
  if (workerObservationFile !== undefined) {
    sources.push(createWorkerObservationReadSource(workerObservationFile));
  }
  if (coreReadConfigFile !== undefined) {
    sources.push(createQuickFurnoOperatorReadSource(coreReadConfigFile));
  }
  return Object.freeze(sources);
}

export const ADOPTED_READ_SOURCES: readonly ReadSourceDescriptor[] = createAdoptedReadSources(
  readWorkerObservationPathFromEnvironment(),
  readCoreReadConfigPathFromEnvironment(),
);
