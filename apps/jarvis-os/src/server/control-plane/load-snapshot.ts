import type { ControlPlaneSnapshotV1 } from '@qf-jarvis/control-plane-read-contract';

import { buildControlPlaneSnapshot } from './build-snapshot';
import { assertOwnershipIsWellFormed } from './sources/compose';
import {
  ADOPTED_READ_SOURCES,
  type CollectedObservation,
  type ReadSourceDescriptor,
  type ReadSourceResult,
} from './sources/read-source';

/**
 * The request-scoped snapshot boundary (JOS-01E, ADR-0089).
 *
 * ### This is the impure half, and it is the ONLY impure half
 *
 * The split is the whole design. This module reads the clock and awaits source acquisition;
 * `buildControlPlaneSnapshot` stays pure and deterministic and never awaits anything. That is what
 * lets the page and the API be provably the same surface: they are two callers of one function,
 * over one collected observation set, rather than two code paths that happen to agree today.
 *
 * ### Why the module-level snapshot had to go
 *
 * `lib/control-plane` previously built one read model at module load and returned it forever. With
 * no live source that was harmless — a compiled-in baseline does not get staler. The moment a source
 * can be adopted it becomes a real defect: the API would recompose per request while every page kept
 * reciting whatever was true when the process started, and the two would drift silently. Removing it
 * now, while nothing is adopted, is the cheap moment to do it.
 *
 * ### Acquisition is bounded and cannot take the page down
 *
 * Each source is acquired independently. One that rejects, throws, or returns something unusable
 * becomes an `UNAVAILABLE` result for ITS sections only; the rest of the snapshot is still true and
 * still worth showing. A thrown value is never inspected and never surfaced — the reason is a closed
 * code, and composition maps it to fixed reviewed prose.
 *
 * With the adopted registry empty this resolves immediately, performs no I/O, and produces exactly
 * the JOS-01B repository baseline.
 */

/** A canonical UTC instant for the contract, read from the system clock at the boundary. */
const nowInstant = (): string => new Date().toISOString();

export interface LoadSnapshotOptions {
  /**
   * Sources to acquire. Defaults to the adopted registry, which is empty in this release.
   *
   * Injectable so the request-scoped path can be proved with a deterministic async source without
   * an adapter having to be adopted first.
   */
  readonly sources?: readonly ReadSourceDescriptor[];
}

/**
 * Acquire one source without letting it take the whole snapshot down.
 *
 * Both a rejected promise and a synchronous throw are caught. The thrown value is deliberately not
 * inspected, not logged here, and never converted into operator-facing text: an adapter's error
 * message is the most likely place for a host, a path, a query or a token to appear.
 */
async function acquireSafely(descriptor: ReadSourceDescriptor): Promise<ReadSourceResult> {
  try {
    return await descriptor.acquire();
  } catch {
    return { status: 'UNAVAILABLE', reason: 'SOURCE_UNREACHABLE' };
  }
}

/**
 * Produce ONE validated snapshot for ONE request.
 *
 * The ordering is the governed observation window and is not incidental:
 *
 * 1. `requestStartedAt` is recorded BEFORE any acquisition begins;
 * 2. every adopted source is acquired;
 * 3. `generatedAt` is recorded AFTER acquisition completes.
 *
 * Composition then admits an observation as request-time evidence only if it falls between the two.
 * A reading from before the request started, or stamped after the envelope, is refused rather than
 * quietly relabelled — so `REQUEST_TIME` remains true of everything the snapshot actually contains.
 */
export async function loadControlPlaneSnapshot(
  options: LoadSnapshotOptions = {},
): Promise<ControlPlaneSnapshotV1> {
  const sources = options.sources ?? ADOPTED_READ_SOURCES;

  // Checked before any acquisition, so a governance mistake is reported even on a day when every
  // source happens to be unavailable.
  assertOwnershipIsWellFormed(sources);

  const requestStartedAt = nowInstant();

  const collected: readonly CollectedObservation[] =
    sources.length === 0
      ? []
      : await Promise.all(
          sources.map(async (descriptor) => ({
            descriptor,
            result: await acquireSafely(descriptor),
          })),
        );

  const generatedAt = nowInstant();

  return buildControlPlaneSnapshot({ generatedAt, requestStartedAt, collected });
}
