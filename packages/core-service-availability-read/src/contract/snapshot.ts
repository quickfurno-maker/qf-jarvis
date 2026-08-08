/**
 * The Core-owned service-availability snapshot (RWC-P5, ADR-0100).
 *
 * ### Whose truth this is
 *
 * QuickFurno Core owns which cities it operates in, which services it sells, and which of those
 * services are actually available in which city. Jarvis does not, has never, and must not start:
 * a conversational agent that decides its own catalogue will eventually promise a client something
 * the business cannot deliver, and it will do so fluently.
 *
 * This module is the shape of that truth as it crosses into Jarvis. It is a READ contract — there is
 * no create, update or deactivate anywhere in this package, because those are Core's operations.
 *
 * ### Availability is a PAIR property
 *
 * The single most consequential rule here, and the one an implementation is most likely to get
 * backwards: **an active city plus an active service does not imply the pair.** A business can
 * operate in eight cities and sell twelve services without selling all twelve in all eight.
 * Inferring the cross product is exactly how Riya would offer modular kitchens in a city that has no
 * kitchen vendors. So `availability` is explicit, mandatory, and carries one row per service.
 *
 * ### What is deliberately NOT here
 *
 * **No aliases or synonyms.** The canonical taxonomy Core publishes exposes an id, a display name, a
 * state and a version — and no governed alias collection. Inventing an `aliases` field because it
 * would help natural-language matching would be Jarvis asserting a Core-owned fact that Core never
 * agreed to own. A future contract version may add one once Core supplies it.
 *
 * **No inactive rows.** The snapshot IS the current active view. Sending deactivated entries beside
 * active ones would put the decision "which of these may I use?" back into the reader.
 *
 * An EMPTY view is therefore a legitimate answer, not a broken one. A paused marketplace, a tenant
 * mid-onboarding or a region switched off all produce zero active cities or services, and that is
 * Core telling us something true. Only the READ failing is an outage.
 *
 * **No vendor, price, package, lead, client, contact, consent, coordinate, pincode or area.** None of
 * those is needed to answer "may this service be discussed for this city?", and every one of them
 * would be business data crossing a boundary for no reason.
 */
import { entityIdSchema, taxonomyLabelSchema, taxonomyVersionSchema } from '@qf-jarvis/contracts';
import { z } from 'zod';

import { CoreServiceAvailabilityReadError } from '../errors.js';

/** This contract's own version. Bumped when the SHAPE changes, not when Core's data changes. */
export const CORE_SERVICE_AVAILABILITY_READ_VERSION = 1 as const;

/**
 * The row bound. Sixty-four is generous for a regional marketplace and small enough that the
 * serialized snapshot cannot quietly become the largest thing in a model request.
 */
const MAX_ROWS = 64;

/** Core's own identifier for THIS snapshot. Opaque evidence, never parsed for meaning by Jarvis. */
const MAX_SNAPSHOT_REF_LENGTH = 128;

/**
 * The hard serialized bound, applied AFTER canonicalization.
 *
 * A snapshot is model context, and model context that can grow without limit is a request that
 * eventually fails a budget nobody was watching. Six thousand characters comfortably holds the row
 * bounds above and still leaves room for the conversation itself.
 *
 * Deliberately NOT root-exported: no production consumer chooses it, and a caller that could read it
 * would soon be a caller that tries to work around it.
 */
export const MAX_CORE_SERVICE_AVAILABILITY_SNAPSHOT_CHARS = 6000;

/** One active city Core operates in. */
export interface CoreAvailabilityCityV1 {
  readonly ref: string;
  readonly displayName: string;
}

/** One active customer-facing service Core sells. */
export interface CoreAvailabilityServiceV1 {
  readonly ref: string;
  readonly displayName: string;
}

/**
 * Where ONE service is available.
 *
 * `'ALL'` means every city in THIS snapshot — it is not a promise about cities Core has not
 * published, and over an empty city set it means no city at all. An explicit array is the complete
 * set, and an EMPTY array is legal and meaningful: the service exists in the catalogue but is
 * currently offered in none of the listed cities.
 */
export interface CoreAvailabilityRowV1 {
  readonly serviceRef: string;
  readonly cityRefs: 'ALL' | readonly string[];
}

/** The current Core-owned view. Deeply frozen, canonically ordered, duplicate-free. */
export interface CoreServiceAvailabilitySnapshotV1 {
  readonly version: 1;
  /** Core's identifier for this snapshot. Evidence of WHICH view this is; Jarvis never interprets it. */
  readonly snapshotRef: string;
  /** The taxonomy generation the refs belong to. An id without it is uninterpretable after a rename. */
  readonly taxonomyVersion: number;
  readonly cities: readonly CoreAvailabilityCityV1[];
  readonly services: readonly CoreAvailabilityServiceV1[];
  readonly availability: readonly CoreAvailabilityRowV1[];
}

const nodeSchema = z
  .object({
    // Core's OWN reference grammar, imported rather than restated: a second definition of "what a
    // Core id looks like" is a second thing to keep in step, and the two would disagree first at the
    // boundary where it matters least and hurts most.
    ref: entityIdSchema,
    // Also Core's own. It already refuses contact details, coordinates, URLs, map links and
    // credentials, which is precisely what a label crossing into a model request must not carry.
    displayName: taxonomyLabelSchema,
  })
  .strict();

const rowSchema = z
  .object({
    serviceRef: entityIdSchema,
    cityRefs: z.union([z.literal('ALL'), z.array(entityIdSchema).max(MAX_ROWS)]),
  })
  .strict();

const snapshotSchema = z
  .object({
    version: z.literal(1),
    snapshotRef: z
      .string()
      .min(1)
      .max(MAX_SNAPSHOT_REF_LENGTH)
      .regex(/^[A-Za-z0-9._:-]+$/u),
    taxonomyVersion: taxonomyVersionSchema,
    // ZERO is legal on all three. The snapshot is Core's CURRENT ACTIVE view, and "Core currently
    // offers nothing" is business truth -- a paused marketplace, a tenant mid-onboarding, a region
    // switched off. It is emphatically NOT the same fact as "Core could not be read", and a schema
    // that conflated them would turn a real answer into an outage. The reader's own failure path is
    // what reports an outage; an empty snapshot reports an empty catalogue.
    cities: z.array(nodeSchema).max(MAX_ROWS),
    services: z.array(nodeSchema).max(MAX_ROWS),
    availability: z.array(rowSchema).max(MAX_ROWS),
  })
  .strict();

/** Sort by a single string key. Locale-independent: `localeCompare` is not deterministic enough. */
function byRef<T>(items: readonly T[], key: (item: T) => string): T[] {
  return [...items].sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));
}

function hasDuplicate(values: readonly string[]): boolean {
  return new Set(values).size !== values.length;
}

/**
 * Parse, prove and freeze a Core service-availability snapshot.
 *
 * Throws `CoreServiceAvailabilityReadError('invalid-snapshot')` on anything it cannot vouch for.
 * Nothing about the rejected value is carried in the error: a snapshot arrives from outside this
 * repository, and an error that quoted it would be the one place its contents leaked.
 *
 * ### Duplicates are REFUSED, never deduplicated
 *
 * Two rows for one city is not a tidy-up job. It means the producer holds two beliefs about the same
 * entity, and silently keeping one of them picks a winner nobody chose — the same reasoning RWC-P4A
 * applies to a duplicated observation. The check runs BEFORE sorting, so a duplicate cannot be hidden
 * by ordering.
 *
 * Display names are deliberately NOT checked for uniqueness. Core's own contract does not require it,
 * and two cities may legitimately share a name in different states.
 */
export function parseCoreServiceAvailabilitySnapshotV1(
  value: unknown,
): CoreServiceAvailabilitySnapshotV1 {
  const parsed = snapshotSchema.safeParse(value);
  if (!parsed.success) {
    throw new CoreServiceAvailabilityReadError('invalid-snapshot');
  }
  const data = parsed.data;

  const cityRefs = data.cities.map((city) => city.ref);
  const serviceRefs = data.services.map((service) => service.ref);
  if (hasDuplicate(cityRefs) || hasDuplicate(serviceRefs)) {
    throw new CoreServiceAvailabilityReadError('invalid-snapshot');
  }

  const rowRefs = data.availability.map((row) => row.serviceRef);
  if (hasDuplicate(rowRefs)) {
    throw new CoreServiceAvailabilityReadError('invalid-snapshot');
  }
  // EXACTLY one row per service, both ways. A missing row would leave a service whose availability
  // nobody stated, and the only safe reading of that is "unknown" -- which is not a value this
  // contract can express, so it is a refusal instead.
  //
  // With no services this reduces to "availability must be empty", which is the right rule and needs
  // no special case: a row about a service the snapshot does not list is meaningless whether the
  // service list is short or empty.
  const serviceSet = new Set(serviceRefs);
  if (rowRefs.length !== serviceRefs.length) {
    throw new CoreServiceAvailabilityReadError('invalid-snapshot');
  }
  const citySet = new Set(cityRefs);
  for (const row of data.availability) {
    if (!serviceSet.has(row.serviceRef)) {
      throw new CoreServiceAvailabilityReadError('invalid-snapshot');
    }
    if (row.cityRefs !== 'ALL') {
      if (hasDuplicate(row.cityRefs)) {
        throw new CoreServiceAvailabilityReadError('invalid-snapshot');
      }
      for (const ref of row.cityRefs) {
        if (!citySet.has(ref)) {
          throw new CoreServiceAvailabilityReadError('invalid-snapshot');
        }
      }
    }
  }

  const canonical: CoreServiceAvailabilitySnapshotV1 = Object.freeze({
    version: 1 as const,
    snapshotRef: data.snapshotRef,
    taxonomyVersion: data.taxonomyVersion,
    cities: Object.freeze(
      byRef(data.cities, (city) => city.ref).map((city) =>
        Object.freeze({ ref: city.ref, displayName: city.displayName }),
      ),
    ),
    services: Object.freeze(
      byRef(data.services, (service) => service.ref).map((service) =>
        Object.freeze({ ref: service.ref, displayName: service.displayName }),
      ),
    ),
    availability: Object.freeze(
      byRef(data.availability, (row) => row.serviceRef).map((row) =>
        Object.freeze({
          serviceRef: row.serviceRef,
          cityRefs:
            row.cityRefs === 'ALL'
              ? ('ALL' as const)
              : Object.freeze(byRef(row.cityRefs, (r) => r)),
        }),
      ),
    ),
  });

  // The size bound is applied to the CANONICAL form, because that is the form every consumer sees.
  // Measuring the caller's object would let an unordered or oddly-spaced input pass a check the thing
  // actually used would fail.
  //
  // Note this is the ONLY bound that actually holds the snapshot down. The row limits cap how MANY
  // entries there are, but each ref may be up to Core's own `MAX_ENTITY_ID_LENGTH`, so row counts
  // alone do not imply a bounded serialization.
  if (JSON.stringify(canonical).length > MAX_CORE_SERVICE_AVAILABILITY_SNAPSHOT_CHARS) {
    throw new CoreServiceAvailabilityReadError('invalid-snapshot');
  }

  return canonical;
}
