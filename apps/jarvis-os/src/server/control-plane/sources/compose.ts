import type { ControlPlaneSections } from '@qf-jarvis/control-plane-read-contract';

import {
  SECTIONS_CLOSED_TO_ADAPTERS,
  type CollectedObservation,
  type ControlPlaneSectionName,
  type ReadSourceDescriptor,
  type UnavailableReasonCode,
} from './read-source';

/**
 * Deterministic composition of adopted read sources over the repository baseline (JOS-01E,
 * ADR-0089).
 *
 * ### Composition, not replacement
 *
 * The baseline stays the floor. A source can raise a section it owns to `AVAILABLE`, or mark that
 * section unreadable — it can do nothing else. Sections nobody owns are returned exactly as the
 * baseline declared them, so adopting one adapter can never quietly change the rest of the page.
 *
 * ### Both section families, correctly shaped
 *
 * The contract has two shapes: item sections carry `items`, and `conversationActivity` and
 * `modelLatency` carry `points` plus a required `id` and `label`. An earlier version wrote `items`
 * for every section, which made those two impossible for an adapter to own: the composed section
 * failed the strict parser and the whole route degraded to a generic 503. The family is now derived
 * from the baseline section itself, and the identity fields are carried through from it.
 *
 * ### Fail closed, and fail specifically
 *
 * Two failure classes are treated differently on purpose:
 *
 * - An OPERATIONAL failure — the source could not be read, or its observation is not usable —
 *   degrades only the sections that source owned, to `NOT_CONNECTED` with no rows. The rest of the
 *   snapshot is still true and still worth showing.
 * - A STRUCTURAL failure — two sources claiming one section, a contribution for a section the
 *   source does not own, an attempt on a closed section — throws and abandons the whole snapshot.
 *   That is a governance defect, not an outage: the composition it would produce is not trustworthy
 *   anywhere, so partial output would mislead more than an error does.
 *
 * ### Nothing an adapter emits at run time becomes operator-facing prose
 *
 * Failure reasons are a closed code set mapped to fixed text here. Provenance comes from the
 * reviewed descriptor. An adapter cannot author what an operator reads, so an exception message, a
 * connection string or a token has no route to the browser.
 */

export class ReadSourceCompositionError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'ReadSourceCompositionError';
  }
}

/**
 * The instants bounding one request's governed observation window.
 *
 * Recorded at the impure boundary and passed in; this module reads no clock.
 */
export interface ObservationWindow {
  /** Recorded BEFORE any source is acquired. */
  readonly requestStartedAt: string;
  /** Recorded AFTER acquisition completes. Also stamps the snapshot envelope. */
  readonly generatedAt: string;
}

/** What composition concluded about provenance, for the snapshot's `source` block. */
export interface CompositionOutcome {
  readonly sections: ControlPlaneSections;
  /**
   * True only if at least one source produced an observation that survived window validation.
   *
   * This is the ONLY thing that may raise the snapshot to `LIVE_ADAPTER` / `REQUEST_TIME`.
   */
  readonly observed: boolean;
}

/**
 * Fixed operator-facing prose, one line per closed reason code.
 *
 * Deliberately says nothing a diagnosis would need. An operator learns the section is unreadable,
 * which is the actionable fact; the cause belongs in host logs, not in a browser.
 */
const UNAVAILABLE_PROSE: Readonly<Record<UnavailableReasonCode, string>> = Object.freeze({
  SOURCE_UNREACHABLE: 'This source could not be reached while producing this snapshot.',
  SOURCE_TIMED_OUT: 'This source did not answer in time while producing this snapshot.',
  SOURCE_REJECTED_REQUEST: 'This source refused the read while producing this snapshot.',
  SOURCE_RETURNED_UNUSABLE_DATA: 'This source returned data this build could not use.',
  SOURCE_OBSERVATION_OUT_OF_WINDOW:
    'This source reported a reading from outside this request, so it was not used.',
});

/**
 * Fixed prose for a reason code, tolerating a code outside the union.
 *
 * The lookup is widened deliberately. A source is ordinary TypeScript compiled separately from this
 * module, so at run time `code` can be any string -- and an unknown one must NOT produce an
 * undefined reason that fails the strict parser and takes the whole snapshot down over one
 * adapter's mistake. Falling back also closes the leak: an unrecognised value maps to reviewed text
 * instead of being echoed to a browser.
 */
function proseFor(code: UnavailableReasonCode): string {
  const table: Partial<Record<string, string>> = UNAVAILABLE_PROSE;
  return table[code] ?? UNAVAILABLE_PROSE.SOURCE_RETURNED_UNUSABLE_DATA;
}

/**
 * A canonical UTC instant, matching the contract's own rule.
 *
 * Restated here because the contract deliberately does not export its sub-schemas — if callers
 * could compose them, the parser would stop being the single place a payload is judged. Duplicating
 * five lines is the cheaper of the two costs, and the shared parser still has the final say on
 * every field it owns.
 */
const CANONICAL_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;

function instantValue(candidate: string): number | null {
  if (!CANONICAL_INSTANT.test(candidate)) {
    return null;
  }
  const parsed = Date.parse(candidate);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== candidate) {
    return null;
  }
  return parsed;
}

/**
 * Is this observation admissible as request-time evidence?
 *
 * `REQUEST_TIME` means: read during THIS request, between the instant the boundary started
 * acquiring sources and the instant it finished. Anything else — a malformed timestamp, a reading
 * from before the request began, a reading stamped after the envelope — is not evidence of
 * freshness, so it is refused rather than downgraded.
 *
 * Refusing rather than downgrading is what keeps the claim honest with the V1 contract unchanged:
 * whatever survives into the snapshot genuinely was read during the request, so `REQUEST_TIME` is
 * true of everything present. A downgrade would instead leave stale rows on the page under a
 * freshness label that no longer described them.
 */
function isWithinWindow(observedAt: string, window: ObservationWindow): boolean {
  const observed = instantValue(observedAt);
  const started = instantValue(window.requestStartedAt);
  const generated = instantValue(window.generatedAt);
  if (observed === null || started === null || generated === null) {
    return false;
  }
  return started <= observed && observed <= generated;
}

/** A series section is the one that carries `points`; every other section carries `items`. */
function isSeriesSection(
  baselineSection: object,
): baselineSection is { id: string; label: string } {
  return 'points' in baselineSection;
}

/**
 * Verify the adopted set before reading anything.
 *
 * Ownership is checked ahead of acquisition so a governance mistake is reported even when every
 * source happens to be unavailable that day — otherwise a duplicate-ownership defect would lie
 * dormant until the first time both sources succeeded at once.
 */
export function assertOwnershipIsWellFormed(sources: readonly ReadSourceDescriptor[]): void {
  const claimedBy = new Map<ControlPlaneSectionName, string>();
  const ids = new Set<string>();

  for (const source of sources) {
    if (ids.has(source.id)) {
      throw new ReadSourceCompositionError(`duplicate read-source id: ${source.id}`);
    }
    ids.add(source.id);

    for (const section of source.owns) {
      if (SECTIONS_CLOSED_TO_ADAPTERS.includes(section)) {
        throw new ReadSourceCompositionError(
          `read source ${source.id} may not own ${section}: it states authority Jarvis does not hold`,
        );
      }
      const existing = claimedBy.get(section);
      if (existing !== undefined) {
        throw new ReadSourceCompositionError(
          `sections may have one owner: ${existing} and ${source.id} both claim ${section}`,
        );
      }
      claimedBy.set(section, source.id);
    }
  }
}

export function composeSections(
  baseline: ControlPlaneSections,
  collected: readonly CollectedObservation[],
  window: ObservationWindow,
): CompositionOutcome {
  assertOwnershipIsWellFormed(collected.map((entry) => entry.descriptor));

  // Every key starts as the baseline declared it, and is only replaced through the guarded writes
  // below. Sections nobody owns are never touched.
  const sections: Record<string, unknown> = { ...baseline };
  let observed = false;

  /** Degrade one section, preserving whatever identity fields its family requires. */
  const degrade = (
    name: ControlPlaneSectionName,
    descriptor: ReadSourceDescriptor,
    code: UnavailableReasonCode,
  ): void => {
    const original = baseline[name] as object;
    const shared = {
      availability: 'NOT_CONNECTED',
      // An UNRECOGNISED code falls back rather than producing an undefined reason. A source is
      // ordinary TypeScript that could hand back anything at run time, and letting a bogus code
      // fail the strict parser would take the WHOLE snapshot down over one adapter's mistake --
      // the opposite of "an operational failure degrades only its own sections". The lookup is
      // also what keeps an adapter from authoring prose: an unknown value maps to fixed text
      // instead of being echoed.
      reason: proseFor(code),
      expectedSource: descriptor.label,
    };
    // Rows are dropped, never kept alongside a failure -- stale rows under a failure banner read as
    // current data to anyone skimming. A series keeps `id` and `label`, which the contract requires
    // and which are the chart's identity, not its data.
    sections[name] = isSeriesSection(original)
      ? { ...shared, id: original.id, label: original.label, points: [] }
      : { ...shared, items: [] };
  };

  for (const { descriptor, result } of collected) {
    if (result.status === 'UNAVAILABLE') {
      for (const name of descriptor.owns) {
        degrade(name, descriptor, result.reason);
      }
      continue;
    }

    // An observation that cannot be placed inside this request's window is not evidence of
    // anything. The whole source degrades: partially trusting one is how a stale reading ends up
    // beside a fresh one under a single REQUEST_TIME label.
    if (!isWithinWindow(result.observedAt, window)) {
      for (const name of descriptor.owns) {
        degrade(name, descriptor, 'SOURCE_OBSERVATION_OUT_OF_WINDOW');
      }
      continue;
    }

    const owned = new Set<ControlPlaneSectionName>(descriptor.owns);
    // Typed with the `undefined` a `Partial` record can genuinely hold at run time. A source is
    // ordinary TypeScript the compiler has already had its say about; composition still has to
    // survive one handing back an explicitly-undefined key.
    const contributions: [string, { items?: unknown[]; points?: unknown[] } | undefined][] =
      Object.entries(result.sections);
    for (const [name, contribution] of contributions) {
      if (contribution === undefined) {
        continue;
      }
      if (!owned.has(name as ControlPlaneSectionName)) {
        // Structural: the source returned something it never declared it could speak for.
        throw new ReadSourceCompositionError(
          `read source ${descriptor.id} contributed ${name}, which it does not own`,
        );
      }

      const original = baseline[name as ControlPlaneSectionName] as object;
      const shared = {
        availability: 'AVAILABLE',
        // Both come from the reviewed descriptor. A runtime result carries no prose at all, so an
        // adapter cannot author operator-facing text.
        reason: descriptor.observedReason,
        expectedSource: descriptor.label,
      };

      if (isSeriesSection(original)) {
        const points = 'points' in contribution ? contribution.points : [];
        sections[name] = { ...shared, id: original.id, label: original.label, points: [...points] };
      } else {
        const items = 'items' in contribution ? contribution.items : [];
        sections[name] = { ...shared, items: [...items] };
      }
      observed = true;
    }
  }

  // The shared parser is still the authority on shape and still deep-freezes the result; this cast
  // only bridges the guarded writes above.
  return { sections: sections as unknown as ControlPlaneSections, observed };
}
