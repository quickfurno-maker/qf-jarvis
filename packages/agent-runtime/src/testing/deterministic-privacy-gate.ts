/**
 * A deterministic conversation privacy gate for tests (QFJ-M1, ADR-0054 §I).
 *
 * The ONLY shipped {@link ConversationPrivacyGate} implementation. It resolves subject status from an
 * explicit map with a configurable default. It performs no I/O, reads no content, and implements no
 * Core erasure — the real gate is injected by a later, separately authorized slice.
 */
import type { ConversationPrivacyGate } from '../contracts/privacy-gate.js';
import type { RuntimeSubjectStatus } from '../contracts/vocabularies.js';

export interface DeterministicPrivacyGateConfig {
  readonly statuses?: Readonly<Record<string, RuntimeSubjectStatus>>;
  readonly defaultStatus?: RuntimeSubjectStatus;
}

/** Build a deterministic conversation privacy gate from an explicit status map. */
export function createDeterministicPrivacyGate(
  config: DeterministicPrivacyGateConfig = {},
): ConversationPrivacyGate {
  const statuses = config.statuses ?? {};
  const fallback = config.defaultStatus ?? 'clear';
  return Object.freeze({
    subjectStatus(subjectRef: string): RuntimeSubjectStatus {
      return Object.prototype.hasOwnProperty.call(statuses, subjectRef)
        ? (statuses[subjectRef] ?? fallback)
        : fallback;
    },
  });
}
