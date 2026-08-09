/**
 * The MODEL-FACING projection of the Core availability snapshot (RWC-P5, ADR-0100).
 *
 * The three read predicates that used to live here now live beside the contract that defines the
 * snapshot, at `@qf-jarvis/core-service-availability-read/policy`, and are re-exported below so this
 * package's own call sites read unchanged.
 *
 * They moved because RWC-P6 (ADR-0101) needs exactly the same rule for a STRUCTURED summary edit or
 * confirmation, which reaches Core authority without a model. Two copies of "may this service be
 * offered in this city?" would not diverge on the day they were written; they would diverge on the
 * day one of them was corrected.
 *
 * What stays here is the one genuinely model-specific thing: how that snapshot is rendered into the
 * single user message.
 */
import type { CoreServiceAvailabilitySnapshotV1 } from '@qf-jarvis/core-service-availability-read';

/**
 * The shared Core read predicates, re-exported under this package's historical names.
 *
 * Aliased rather than renamed at every call site: the names are accurate here, and a rename would
 * turn a semantics-preserving extraction into a diff nobody could scan.
 */
export {
  isCoreCityActive as isActiveCity,
  isCoreServiceActive as isActiveService,
  isCoreServiceCityPairAvailable as pairAvailable,
} from '@qf-jarvis/core-service-availability-read/policy';

/**
 * The model-facing projection of the snapshot.
 *
 * `snapshotRef` and `taxonomyVersion` are deliberately DROPPED. They are contract evidence -- which
 * view this is, and which taxonomy generation the refs belong to -- and the model reasons about
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
