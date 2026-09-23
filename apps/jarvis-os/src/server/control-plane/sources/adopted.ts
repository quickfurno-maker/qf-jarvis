import { readWorkerObservationPathFromEnvironment } from '../../auth/config/loader';
import type { ReadSourceDescriptor } from './read-source';
import { createWorkerObservationReadSource } from './worker-observation-source';

export function createAdoptedReadSources(
  workerObservationFile: string | undefined,
): readonly ReadSourceDescriptor[] {
  return Object.freeze(
    workerObservationFile === undefined
      ? []
      : [createWorkerObservationReadSource(workerObservationFile)],
  );
}

export const ADOPTED_READ_SOURCES: readonly ReadSourceDescriptor[] = createAdoptedReadSources(
  readWorkerObservationPathFromEnvironment(),
);
