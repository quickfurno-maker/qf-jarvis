/**
 * Deterministic test support for the Core service-availability read (RWC-P5, ADR-0100).
 *
 * A SEPARATE subpath so a fake can never become a production default. That matters more here than
 * usual: a reader that silently answers "everything is available everywhere" would pass every test in
 * this repository and let Riya promise services in cities the business does not serve. The port is
 * REQUIRED and injected precisely so that cannot happen by omission.
 *
 * Everything here is synthetic. No real city, no real service, no network, no key.
 */
import { parseCoreServiceAvailabilitySnapshotV1 } from '../contract/snapshot.js';
import type { CoreServiceAvailabilitySnapshotV1 } from '../contract/snapshot.js';
import type {
  CoreServiceAvailabilityReader,
  CoreServiceAvailabilityReadInput,
} from '../contract/reader.js';

/**
 * A synthetic snapshot: two cities, two services, one `ALL` row and one explicit row.
 *
 * Deliberately NOT a real catalogue. The refs are obviously synthetic so that finding one in
 * production source is proof of a defect rather than a coincidence, and the explicit row exists so
 * every spec has a genuinely unavailable pair to work with.
 */
export function syntheticAvailabilitySnapshot(
  over: Partial<{
    readonly snapshotRef: string;
    readonly taxonomyVersion: number;
    readonly cities: readonly { readonly ref: string; readonly displayName: string }[];
    readonly services: readonly { readonly ref: string; readonly displayName: string }[];
    readonly availability: readonly {
      readonly serviceRef: string;
      readonly cityRefs: 'ALL' | readonly string[];
    }[];
  }> = {},
): CoreServiceAvailabilitySnapshotV1 {
  return parseCoreServiceAvailabilitySnapshotV1({
    version: 1,
    snapshotRef: over.snapshotRef ?? 'snap.synthetic.1',
    taxonomyVersion: over.taxonomyVersion ?? 7,
    cities: over.cities ?? [
      { ref: 'city.alpha', displayName: 'Alpha' },
      { ref: 'city.beta', displayName: 'Beta' },
    ],
    services: over.services ?? [
      { ref: 'svc.one', displayName: 'Service One' },
      { ref: 'svc.two', displayName: 'Service Two' },
    ],
    availability: over.availability ?? [
      // Available everywhere in this snapshot.
      { serviceRef: 'svc.one', cityRefs: 'ALL' },
      // Available in ONE city only -- so `svc.two` + `city.beta` is the canonical unavailable pair.
      { serviceRef: 'svc.two', cityRefs: ['city.alpha'] },
    ],
  });
}

/** What a spec may script. */
export interface ScriptedAvailabilityReaderOptions {
  /** Raw value to return. Use to drive the malformed/oversized paths. */
  readonly returns?: unknown;
  /** Reject instead of resolving, to drive the unavailable path. */
  readonly rejects?: boolean;
}

/** A reader that counts its calls and records what it was asked. */
export type ScriptedAvailabilityReader = CoreServiceAvailabilityReader & {
  calls(): number;
  lastInput(): CoreServiceAvailabilityReadInput | undefined;
};

export function scriptedAvailabilityReader(
  over: ScriptedAvailabilityReaderOptions = {},
): ScriptedAvailabilityReader {
  let calls = 0;
  let seen: CoreServiceAvailabilityReadInput | undefined;
  return {
    readCurrent(input: CoreServiceAvailabilityReadInput): Promise<unknown> {
      calls += 1;
      seen = input;
      if (over.rejects === true) {
        // A realistic failure carries exactly the kind of detail that must never escape.
        return Promise.reject(new Error('core catalogue at 10.0.0.7 — token=abc123'));
      }
      return Promise.resolve(
        over.returns === undefined ? syntheticAvailabilitySnapshot() : over.returns,
      );
    },
    calls: () => calls,
    lastInput: () => seen,
  };
}
