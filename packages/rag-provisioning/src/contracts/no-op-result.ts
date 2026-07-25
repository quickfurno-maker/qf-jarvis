/**
 * The immutable no-op result (QFJ-P04.05, ADR-0053 §G).
 *
 * Every invocation returns this: a content-free record with the profile id/version, the mode, a safe
 * reason, and EXACT zero counters. It carries no content, citation, prompt, or provider output — the
 * boundary did nothing.
 */
import type { RagProvisioningMode, RagReason } from './vocabularies.js';

/** The immutable, content-free no-op result. All counters are exactly zero. */
export interface RagNoOpResult {
  readonly profileId: string;
  readonly profileVersion: number;
  readonly mode: RagProvisioningMode;
  readonly reason: RagReason;
  readonly retrievalCount: 0;
  readonly embeddingCount: 0;
  readonly vectorQueryCount: 0;
  readonly augmentedCharacterCount: 0;
}

/** Build a frozen no-op result with exact zero counters. */
export function noOpResult(
  profileId: string,
  profileVersion: number,
  mode: RagProvisioningMode,
  reason: RagReason,
): RagNoOpResult {
  return Object.freeze({
    profileId,
    profileVersion,
    mode,
    reason,
    retrievalCount: 0,
    embeddingCount: 0,
    vectorQueryCount: 0,
    augmentedCharacterCount: 0,
  });
}
