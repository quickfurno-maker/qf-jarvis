/**
 * Reading the Core availability snapshot (RWC-P5, ADR-0100 §17–§18).
 *
 * Four pure predicates and one projection. Nothing here decides anything about a conversation — it
 * answers only "does Core currently list this?" and "does Core currently allow this pair?".
 *
 * ### The pair rule, stated once
 *
 * An active city plus an active service does NOT imply the pair. Every service carries exactly one
 * availability row, and that row is the only thing that answers the question:
 *
 * - `'ALL'` — every city in THIS snapshot;
 * - an explicit array — exactly those cities;
 * - an empty array — none of them, which is legal and means the service is catalogued but currently
 *   offered nowhere listed.
 *
 * A service with no row cannot reach this file: the snapshot parser requires exactly one row per
 * service. If one ever did, `pairAvailable` answers `false` — the safe direction, because the
 * alternative is Riya offering something nobody sells.
 */
import type { CoreServiceAvailabilitySnapshotV1 } from '@qf-jarvis/core-service-availability-read';

/** Is this exactly an active service ref in the current snapshot? */
export function isActiveService(snapshot: CoreServiceAvailabilitySnapshotV1, ref: string): boolean {
  return snapshot.services.some((service) => service.ref === ref);
}

/** Is this exactly an active city ref in the current snapshot? */
export function isActiveCity(snapshot: CoreServiceAvailabilitySnapshotV1, ref: string): boolean {
  return snapshot.cities.some((city) => city.ref === ref);
}

/**
 * May this service be offered in this city, according to Core?
 *
 * Both refs must be active in their own right first — a pair built from a ref Core does not list is
 * not "unavailable", it is unanswerable, and both come out the same way here: `false`.
 */
export function pairAvailable(
  snapshot: CoreServiceAvailabilitySnapshotV1,
  serviceRef: string,
  cityRef: string,
): boolean {
  if (!isActiveService(snapshot, serviceRef) || !isActiveCity(snapshot, cityRef)) {
    return false;
  }
  const row = snapshot.availability.find((entry) => entry.serviceRef === serviceRef);
  if (row === undefined) {
    return false;
  }
  return row.cityRefs === 'ALL' ? true : row.cityRefs.includes(cityRef);
}

/**
 * The model-facing projection of the snapshot.
 *
 * `snapshotRef` and `taxonomyVersion` are deliberately DROPPED. They are contract evidence — which
 * view this is, and which taxonomy generation the refs belong to — and the model reasons about
 * neither. Sending them would put two more identifiers in a request for no benefit, and every
 * identifier sent is one that can come back in an answer.
 *
 * Everything that remains is what the model actually needs to (a) emit only refs Core lists, and (b)
 * say something true when a pair is not available.
 */
export interface RiyaCoreAvailabilityProjection {
  readonly cities: readonly { readonly ref: string; readonly displayName: string }[];
  readonly services: readonly { readonly ref: string; readonly displayName: string }[];
  readonly availability: readonly {
    readonly serviceRef: string;
    readonly cityRefs: 'ALL' | readonly string[];
  }[];
}

/** Project the canonical snapshot for the one user message. Order is the snapshot's, already canonical. */
export function projectCoreAvailability(
  snapshot: CoreServiceAvailabilitySnapshotV1,
): RiyaCoreAvailabilityProjection {
  return {
    cities: snapshot.cities.map((city) => ({ ref: city.ref, displayName: city.displayName })),
    services: snapshot.services.map((service) => ({
      ref: service.ref,
      displayName: service.displayName,
    })),
    availability: snapshot.availability.map((row) => ({
      serviceRef: row.serviceRef,
      cityRefs: row.cityRefs === 'ALL' ? ('ALL' as const) : [...row.cityRefs],
    })),
  };
}
