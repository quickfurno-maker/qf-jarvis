import type { ControlPlaneSections } from '@qf-jarvis/control-plane-read-contract';

import {
  UNAVAILABLE_REASONS,
  type ReadSourceDescriptor,
  type ReadSourceResult,
  type UnavailableReasonCode,
} from './read-source';

/**
 * Runtime normalisation of an acquired source result (JOS-01E, ADR-0089).
 *
 * ### Why a TypeScript declaration is not enough
 *
 * A source is compiled separately from this module and can return anything at run time. The rest of
 * the design already accepts that — an unknown `UNAVAILABLE` reason code falls back to fixed prose
 * rather than being trusted — and the same reasoning has to reach OBSERVED results, which is where
 * it actually matters.
 *
 * Without it a malformed adapter could produce the one lie this whole contract exists to prevent.
 * A series source returning `{ items: [] }`, or an item source returning nothing at all, fell
 * through to an empty array, was marked `AVAILABLE`, and set the snapshot to `LIVE_ADAPTER` —
 * "we looked and there is nothing waiting for you", from a source that never supplied a reading.
 *
 * ### What this validates, and what it deliberately does not
 *
 * The ENVELOPE and the section FAMILY only: status, `observedAt`'s type, which sections were
 * contributed, and whether each carries an array under the right key. Row CONTENTS are not checked
 * here — `parseControlPlaneSnapshotV1` remains the single authority on values, bounds, strictness
 * and every section invariant. Restating the row schemas would put a second, drifting copy of the
 * contract in the application.
 *
 * ### One consistent classification
 *
 * - A DESCRIPTOR defect is a governance error and throws: duplicate ids, duplicate ownership, a
 *   closed section, an out-of-range timeout. Those live in reviewed code, so a wrong one means the
 *   adopted set itself is wrong and no snapshot from it is trustworthy.
 * - A RESULT defect degrades: the source becomes `UNAVAILABLE` /
 *   `SOURCE_RETURNED_UNUSABLE_DATA` and only ITS sections go `NOT_CONNECTED`. Results are runtime
 *   data from a separately compiled unit, and one misbehaving adapter must not take down a page
 *   whose other sections are still true.
 *
 * A contribution for a section the source does not own is a RESULT defect and degrades. It is the
 * adapter overreaching at run time, not the adopted set being wired wrongly — and refusing the
 * whole snapshot for it would punish every other section for one adapter's bug.
 */

const UNUSABLE: ReadSourceResult = Object.freeze({
  status: 'UNAVAILABLE',
  reason: 'SOURCE_RETURNED_UNUSABLE_DATA',
});

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isKnownReason = (value: unknown): value is UnavailableReasonCode =>
  typeof value === 'string' && (UNAVAILABLE_REASONS as readonly string[]).includes(value);

/**
 * Normalise one acquired result against the descriptor that produced it.
 *
 * Returns either a well-formed `OBSERVED` result whose every owned section carries the correct
 * family array, or an `UNAVAILABLE` result. There is no third outcome, and nothing partially valid
 * survives: a source that got one of its sections wrong has all of them degraded, because the half
 * that looked right came from the same run of the same broken adapter.
 */
export function normalizeResult(
  descriptor: ReadSourceDescriptor,
  baseline: ControlPlaneSections,
  raw: unknown,
): ReadSourceResult {
  if (!isPlainObject(raw)) {
    return UNUSABLE;
  }

  if (raw['status'] === 'UNAVAILABLE') {
    // An unknown or malformed reason maps to a fixed code; runtime text is never echoed.
    return {
      status: 'UNAVAILABLE',
      reason: isKnownReason(raw['reason']) ? raw['reason'] : 'SOURCE_RETURNED_UNUSABLE_DATA',
    };
  }

  // Anything that is not exactly one of the two statuses -- including a missing one, a typo, or an
  // invented third state -- is unusable. It is never treated as an observation.
  if (raw['status'] !== 'OBSERVED') {
    return UNUSABLE;
  }

  if (typeof raw['observedAt'] !== 'string') {
    return UNUSABLE;
  }

  const sections = raw['sections'];
  if (!isPlainObject(sections)) {
    return UNUSABLE;
  }

  const owned = new Set<string>(descriptor.owns);

  // Every contributed key must be a real section AND owned by this source. A stray key is the
  // adapter reaching past what it was adopted for.
  for (const name of Object.keys(sections)) {
    if (!(name in baseline) || !owned.has(name)) {
      return UNUSABLE;
    }
  }

  // Every OWNED section must be answered explicitly. Silence is not an observation: leaving an
  // omitted section at repository baseline would show compiled-in figures under a snapshot that
  // now claims to be live, with nothing saying which sections were actually read.
  for (const name of descriptor.owns) {
    const contribution = sections[name];
    if (!isPlainObject(contribution)) {
      return UNUSABLE;
    }

    // The family comes from the baseline section, and the wrong family is never silently coerced
    // into an empty array of the right one.
    const isSeries = 'points' in baseline[name];
    const rows = isSeries ? contribution['points'] : contribution['items'];
    if (!Array.isArray(rows)) {
      return UNUSABLE;
    }
  }

  // Shape-valid. An explicitly supplied empty array stays a legitimate observation -- the source
  // did look, and found none -- which is exactly the case that must remain distinguishable from
  // "nobody asked".
  return raw as unknown as ReadSourceResult;
}
