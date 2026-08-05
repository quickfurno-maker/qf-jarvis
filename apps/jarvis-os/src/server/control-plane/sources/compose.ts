import type { ControlPlaneSections } from '@qf-jarvis/control-plane-read-contract';

import {
  SECTIONS_CLOSED_TO_ADAPTERS,
  type ControlPlaneReadSource,
  type ControlPlaneSectionName,
  type ReadSourceResult,
  type SectionContribution,
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
 * ### Fail closed, and fail specifically
 *
 * Two failure classes are treated differently on purpose:
 *
 * - An OPERATIONAL failure — the source could not be read — degrades only the sections that source
 *   owned, to `NOT_CONNECTED` with no rows. The rest of the snapshot is still true and still worth
 *   showing.
 * - A STRUCTURAL failure — two sources claiming one section, a contribution for a section the
 *   source does not own, an attempt on a closed section — throws and abandons the whole snapshot.
 *   That is a governance defect, not an outage: the composition it would produce is not trustworthy
 *   anywhere, so partial output would mislead more than an error does.
 *
 * A source that throws is treated as unavailable, never as success. Its exception never reaches an
 * operator: the reason shown is fixed prose, because an adapter's error text is the most likely
 * place for a host, a path, a query or a token to appear.
 */

export class ReadSourceCompositionError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'ReadSourceCompositionError';
  }
}

/** What composition concluded about provenance, for the snapshot's `source` block. */
export interface CompositionOutcome {
  readonly sections: ControlPlaneSections;
  /** True only if at least one adopted source genuinely observed something. */
  readonly observed: boolean;
}

/**
 * Fixed prose for a source that could not be read and did not say why safely.
 *
 * Deliberately says nothing about the cause. An operator learns the section is unreadable, which is
 * the actionable fact; the diagnosis belongs in host logs, not in a browser.
 */
const OPAQUE_FAILURE_REASON = 'This source could not be read while producing this snapshot.';

/** Bound the prose a source can push into an operator's browser. */
const MAX_REASON = 240;

const sentence = (candidate: string, fallback: string): string => {
  const trimmed = typeof candidate === 'string' ? candidate.trim() : '';
  if (trimmed === '' || trimmed.length > MAX_REASON) {
    return fallback;
  }
  return trimmed;
};

/** Read a source without letting it take the whole snapshot down. */
function readSafely(source: ControlPlaneReadSource): ReadSourceResult {
  try {
    return source.read();
  } catch {
    // The thrown value is deliberately not inspected, not logged here and not surfaced.
    return { status: 'UNAVAILABLE', reason: OPAQUE_FAILURE_REASON };
  }
}

/**
 * Verify the adopted set before reading anything.
 *
 * Ownership is checked ahead of `read()` so a governance mistake is reported even when every source
 * happens to be unavailable that day — otherwise a duplicate-ownership defect would lie dormant
 * until the first time both sources succeeded at once.
 */
function assertOwnershipIsWellFormed(sources: readonly ControlPlaneReadSource[]): void {
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
  sources: readonly ControlPlaneReadSource[],
): CompositionOutcome {
  assertOwnershipIsWellFormed(sources);

  // Mutated only through the guarded writes below; every key starts as the baseline declared it.
  const sections: Record<string, unknown> = { ...baseline };
  let observed = false;

  for (const source of sources) {
    const result = readSafely(source);

    if (result.status === 'UNAVAILABLE') {
      // Only what this source owned degrades. Rows are dropped, never kept alongside a failure —
      // stale rows under a failure banner read as current data to anyone skimming.
      for (const name of source.owns) {
        sections[name] = {
          availability: 'NOT_CONNECTED',
          reason: sentence(result.reason, OPAQUE_FAILURE_REASON),
          expectedSource: source.label,
          items: [],
        };
      }
      continue;
    }

    const owned = new Set<ControlPlaneSectionName>(source.owns);
    // Typed with the `undefined` a `Partial` record can genuinely hold at run time. A source is
    // ordinary TypeScript that the compiler has already had its say about; composition still has to
    // survive one handing back an explicitly-undefined key.
    const contributions = Object.entries(result.sections) as [
      string,
      SectionContribution | undefined,
    ][];
    for (const [name, contribution] of contributions) {
      if (contribution === undefined) {
        continue;
      }
      if (!owned.has(name as ControlPlaneSectionName)) {
        // Structural: the source returned something it never declared it could speak for.
        throw new ReadSourceCompositionError(
          `read source ${source.id} contributed ${name}, which it does not own`,
        );
      }
      sections[name] = {
        availability: 'AVAILABLE',
        reason: sentence(contribution.reason, 'Observed by an adopted read source.'),
        expectedSource: sentence(contribution.expectedSource, source.label),
        items: [...contribution.items],
      };
      observed = true;
    }
  }

  // The parser is still the authority on shape; this cast only bridges the guarded writes above.
  return { sections: sections as unknown as ControlPlaneSections, observed };
}
