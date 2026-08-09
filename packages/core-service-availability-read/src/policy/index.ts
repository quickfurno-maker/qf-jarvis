/**
 * `@qf-jarvis/core-service-availability-read/policy` — reading a Core snapshot (RWC-P5; shared by
 * RWC-P6, ADR-0101).
 *
 * ### Why this is its own subpath
 *
 * RWC-P5 put these three predicates inside `riya-model-interaction`, because the only consumer was
 * the one model call. RWC-P6 adds a second: a STRUCTURED summary edit or confirmation must satisfy
 * exactly the same Core authority, and it reaches it without a model.
 *
 * Two copies of "may this service be offered in this city?" is the failure mode worth naming. They
 * would not diverge on the day they were written; they would diverge on the day one of them was
 * corrected. So the rule moves here — beside the contract that defines the snapshot — and both
 * consumers import it.
 *
 * These are also the reason the subpath is separate from the root rather than added to it. The root
 * is the READ contract: a version, an error vocabulary, an error class and the parser. A predicate is
 * not a contract, and the root's four runtime values are locked.
 *
 * ### They read; they never decide
 *
 * No agent, no conversation, no phase, no continuity, no model. Given a snapshot Core published and a
 * reference, they answer what Core said and nothing else. Whether a conversation may then proceed is
 * a question for whoever asked.
 *
 * ### Validity is the parser's job, not theirs
 *
 * A snapshot reaching these functions has already been through
 * `parseCoreServiceAvailabilitySnapshotV1`: reference integrity, one row per service, duplicates,
 * ordering and bounds are all settled. Re-checking here would be a second, weaker copy of the same
 * rules — so instead, anything unexpected answers `false`, which is the safe direction. The
 * alternative is Riya offering something nobody sells.
 */
import type { CoreServiceAvailabilitySnapshotV1 } from '../contract/snapshot.js';

/** Is this exactly an active service reference in the current snapshot? */
export function isCoreServiceActive(
  snapshot: CoreServiceAvailabilitySnapshotV1,
  ref: string,
): boolean {
  return snapshot.services.some((service) => service.ref === ref);
}

/** Is this exactly an active city reference in the current snapshot? */
export function isCoreCityActive(
  snapshot: CoreServiceAvailabilitySnapshotV1,
  ref: string,
): boolean {
  return snapshot.cities.some((city) => city.ref === ref);
}

/**
 * May this service be offered in this city, according to Core?
 *
 * The single most consequential rule in the slice, and the one an implementation is most likely to
 * get backwards: **an active city plus an active service does not imply the pair.** A business can
 * operate in eight cities and sell twelve services without selling all twelve in all eight.
 *
 * Both references must be active in their own right first — a pair built from a reference Core does
 * not list is not "unavailable", it is unanswerable, and both come out the same way here.
 *
 * `'ALL'` means every city in THIS snapshot, so over an empty city set it means none. An explicit
 * list is exact membership. An empty list means the service is catalogued and currently offered
 * nowhere listed.
 *
 * A service with no availability row cannot occur — the parser requires exactly one per service — but
 * if one ever did, the answer is `false`.
 */
export function isCoreServiceCityPairAvailable(
  snapshot: CoreServiceAvailabilitySnapshotV1,
  serviceRef: string,
  cityRef: string,
): boolean {
  if (!isCoreServiceActive(snapshot, serviceRef) || !isCoreCityActive(snapshot, cityRef)) {
    return false;
  }
  const row = snapshot.availability.find((entry) => entry.serviceRef === serviceRef);
  if (row === undefined) {
    return false;
  }
  return row.cityRefs === 'ALL' ? true : row.cityRefs.includes(cityRef);
}
