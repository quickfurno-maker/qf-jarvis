/**
 * A deterministic privacy gate for tests (QFJ-P04.03, ADR-0051 §J).
 *
 * The ONLY shipped {@link KnowledgePrivacyGate} implementation. It resolves subject status from an
 * explicit map with a configurable default, so a test can prove that erased/anonymised/tombstoned/
 * in-progress subjects are blocked and a `clear` subject passes. It performs no I/O, reads no content,
 * and implements no Core erasure — the real gate is injected by a later, separately authorized slice.
 */
import type { KnowledgePrivacyGate } from '../contracts/privacy-gate.js';
import type { KnowledgeSubjectStatus } from '../contracts/vocabularies.js';

export interface DeterministicPrivacyGateConfig {
  /** Explicit per-subject statuses. */
  readonly statuses?: Readonly<Record<string, KnowledgeSubjectStatus>>;
  /** The status for a subject not present in `statuses`. Defaults to `clear`. */
  readonly defaultStatus?: KnowledgeSubjectStatus;
}

/** Build a deterministic privacy gate from an explicit status map. */
export function createDeterministicPrivacyGate(
  config: DeterministicPrivacyGateConfig = {},
): KnowledgePrivacyGate {
  const statuses = config.statuses ?? {};
  const fallback = config.defaultStatus ?? 'clear';
  return Object.freeze({
    subjectStatus(subjectRef: string): KnowledgeSubjectStatus {
      return Object.prototype.hasOwnProperty.call(statuses, subjectRef)
        ? (statuses[subjectRef] ?? fallback)
        : fallback;
    },
  });
}
