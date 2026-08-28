import type {
  ControlPlaneSnapshotV1,
  ControlPlaneSnapshotV2,
} from '@qf-jarvis/control-plane-read-contract';

import { buildControlPlaneSnapshot, buildControlPlaneSnapshotV2 } from './build-snapshot';
import { baselineSections } from './repository-baseline';
import { assertOwnershipIsWellFormed } from './sources/compose';
import { normalizeResult } from './sources/normalize';
import {
  ADOPTED_READ_SOURCES,
  type CollectedObservation,
  type ReadSourceDescriptor,
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
 * ### Acquisition is bounded, and the bound is enforced here
 *
 * Each source is acquired independently under its own reviewed `timeoutMs`. One that rejects,
 * throws, never settles, or returns something unusable becomes an `UNAVAILABLE` result for ITS
 * sections only; the rest of the snapshot is still true and still worth showing. A thrown value is
 * never inspected and never surfaced — the reason is a closed code, and composition maps it to fixed
 * reviewed prose.
 *
 * Every acquired value is NORMALISED before it can reach composition, because a separately compiled
 * adapter can violate its own TypeScript declaration and only a shape-valid result may become an
 * observation.
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
 * Acquire one source under a finite, reviewed bound.
 *
 * ### Why a timeout, and why it lives here
 *
 * A rejecting source was already isolated. A source that never SETTLES was not: `Promise.all` would
 * wait forever, blocking the page render, the API and every other source's result. The vocabulary
 * already had `SOURCE_TIMED_OUT` and the comments already claimed acquisition was bounded — with
 * nothing enforcing it.
 *
 * The bound belongs to the loader rather than to each adapter. A future adapter is exactly the code
 * that has not been reviewed yet, and "bounded because every adapter remembers to be" is not a
 * property the shared boundary can claim.
 *
 * ### What is deliberately not inspected
 *
 * A rejection is caught and discarded. A late rejection AFTER the timeout is caught too, so it
 * cannot surface as an unhandled rejection — but nothing about it is read, logged or rendered: an
 * adapter's error is the most likely place for a host, a path, a query or a token to appear.
 */
async function acquireBounded(descriptor: ReadSourceDescriptor): Promise<unknown> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;

  const timedOut = new Promise<{ readonly outcome: 'TIMEOUT' }>((resolve) => {
    timer = setTimeout(() => {
      // Tell a cooperative adapter to stop working. One that ignores the signal still cannot hold
      // the page: the race below has already stopped waiting for it.
      controller.abort();
      resolve({ outcome: 'TIMEOUT' });
    }, descriptor.timeoutMs);
  });

  try {
    const settled = await Promise.race([
      (async () => descriptor.acquire(controller.signal))().then(
        (value) => ({ outcome: 'SETTLED', value }) as const,
        () => ({ outcome: 'REJECTED' }) as const,
      ),
      timedOut,
    ]);

    if (settled.outcome === 'TIMEOUT') {
      return { status: 'UNAVAILABLE', reason: 'SOURCE_TIMED_OUT' };
    }
    if (settled.outcome === 'REJECTED') {
      return { status: 'UNAVAILABLE', reason: 'SOURCE_UNREACHABLE' };
    }
    return settled.value;
  } finally {
    // Always, on every path. A leaked timer keeps the process awake and, in a test run, keeps the
    // fake clock reporting work that has already finished.
    if (timer !== undefined) {
      clearTimeout(timer);
    }
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
/**
 * Acquire every adopted source for ONE request, inside the governed observation window.
 *
 * The ordering is the window and is not incidental:
 *
 * 1. `requestStartedAt` is recorded BEFORE any acquisition begins;
 * 2. every adopted source is acquired;
 * 3. `generatedAt` is recorded AFTER acquisition completes.
 *
 * Composition then admits an observation as request-time evidence only if it falls between the two.
 * A reading from before the request started, or stamped after the envelope, is refused rather than
 * quietly relabelled — so `REQUEST_TIME` remains true of everything the snapshot actually contains.
 *
 * Shared by both wire versions (ADR-0129). A version decides the final shape of a payload; it does
 * not get its own idea of when a source was read.
 */
async function collectForRequest(options: LoadSnapshotOptions): Promise<{
  readonly requestStartedAt: string;
  readonly generatedAt: string;
  readonly collected: readonly CollectedObservation[];
}> {
  const sources = options.sources ?? ADOPTED_READ_SOURCES;

  // Checked before any acquisition, so a governance mistake is reported even on a day when every
  // source happens to be unavailable.
  assertOwnershipIsWellFormed(sources);

  const requestStartedAt = nowInstant();

  // The empty registry creates no timer and performs no I/O -- every request in this release.
  const collected: readonly CollectedObservation[] =
    sources.length === 0
      ? []
      : await Promise.all(
          sources.map(async (descriptor) => ({
            descriptor,
            // Normalised before it can reach composition: a separately compiled adapter can return
            // anything at run time, and only a shape-valid result may become an observation.
            result: normalizeResult(
              descriptor,
              baselineSections(),
              await acquireBounded(descriptor),
            ),
          })),
        );

  return { requestStartedAt, generatedAt: nowInstant(), collected };
}

/**
 * Produce ONE validated V1 snapshot for ONE request (JOS-01B, ADR-0086).
 *
 * Unchanged by AVG-11. This is what `GET /api/control-plane/v1/snapshot` serves, and what a client
 * built against V1 keeps receiving.
 */
export async function loadControlPlaneSnapshot(
  options: LoadSnapshotOptions = {},
): Promise<ControlPlaneSnapshotV1> {
  const { requestStartedAt, generatedAt, collected } = await collectForRequest(options);
  return buildControlPlaneSnapshot({ generatedAt, requestStartedAt, collected });
}

/**
 * Produce ONE validated V2 snapshot for ONE request (AVG-11, ADR-0129).
 *
 * The SAME acquisition, the same window, the same composed core — a different final wire shape. This
 * is what `GET /api/control-plane/v2/snapshot` serves and what the server-rendered pages read.
 *
 * ### It still does not self-fetch
 *
 * A page reads this function directly. It does not call its own HTTP route: that would add a network
 * hop, a failure mode and a second source of truth for no benefit, and the property JOS-01E
 * established — the page and the route cannot drift, because they are two callers of one path —
 * survives the version split intact.
 */
export async function loadControlPlaneSnapshotV2(
  options: LoadSnapshotOptions = {},
): Promise<ControlPlaneSnapshotV2> {
  const { requestStartedAt, generatedAt, collected } = await collectForRequest(options);
  return buildControlPlaneSnapshotV2({ generatedAt, requestStartedAt, collected });
}
