/**
 * The two digests a trajectory carries (RID-F1, ADR-0107 §26).
 *
 * ### Two, because they answer different questions
 *
 * **The artifact SHA-256** covers the whole record, review metadata included. It answers "is this
 * byte-for-byte the record the manifest committed to?" — so adding a reviewer changes it, which is
 * correct: the artifact genuinely changed.
 *
 * **The conversation fingerprint** covers only the language mode and the USER/ASSISTANT text
 * sequence. It answers "is this the same conversation as that one?", and it deliberately EXCLUDES
 * reviews, split, persona, difficulty, source and every id.
 *
 * That exclusion is the point. Duplicate detection has to see through relabelling: the same
 * conversation filed under a new id, a new persona and a new split is exactly what a cross-split leak
 * looks like, and a fingerprint that included those fields would report two different records and
 * miss it entirely.
 *
 * Authoritative context is excluded too. Two trajectories with identical dialogue and different
 * supplied facts are the same conversation being reused, which is worth catching, not hiding.
 */
import { normalizeForComparison } from './normalization.js';
import { sha256Hex, sha256OfCanonical } from './sha256.js';
import type { RiyaIntelligenceTrajectoryV1 } from '../contracts/trajectory.js';

/** SHA-256 over the canonical JSON of the whole trajectory, reviews included. */
export function trajectoryArtifactSha256(trajectory: RiyaIntelligenceTrajectoryV1): string {
  return sha256OfCanonical(trajectory);
}

/**
 * SHA-256 over the normalized spoken conversation only.
 *
 * The language mode is included because the same words in a different declared mode are a different
 * training example — and because two fixtures that differ only in mode should not collide.
 */
export function trajectoryConversationFingerprint(
  trajectory: RiyaIntelligenceTrajectoryV1,
): string {
  const spoken = trajectory.turns
    .filter((turn) => turn.type === 'USER' || turn.type === 'ASSISTANT')
    .map((turn) =>
      turn.type === 'USER'
        ? `U:${normalizeForComparison(turn.text)}`
        : `A:${normalizeForComparison(turn.text)}`,
    );
  return sha256Hex([`L:${trajectory.languageMode}`, ...spoken].join('\n'));
}
