/**
 * What the intake reader OBSERVED in the delivered external files (AS1-B).
 *
 * ### Why this exists at all
 *
 * `RiyaAiSyntheticExternalIntakeProvenanceV1` CLAIMS a `sourceCandidateSha256` and a
 * `sourceBundleSha256`. Sealing those claims into `provenanceSha256` proves only that they did not
 * change after acceptance evidence was built. It does not prove they were ever true — a caller could
 * supply any two well-formed 64-hex strings and the gate would have nothing to compare them against.
 *
 * That gap is what this record closes. It carries the digests an intake reader computed from the
 * actual delivered bytes, and the validator requires the claimed values to equal the observed ones.
 *
 * ### It must not be built from the provenance it is checked against
 *
 * A binding copied out of the record it is supposed to corroborate proves exactly nothing; it turns
 * the comparison into `x === x`. This contract cannot enforce where a caller got its numbers — no
 * contract can — but it makes the boundary explicit, so the future intake implementation has one
 * deterministic place to hand over digests computed from FILES:
 *
 * - `observedSourceCandidateSha256` — computed from the raw delivered candidate record bytes;
 * - `observedSourceBundleSha256` — computed from the delivered bundle file's bytes.
 *
 * ### The hashing conventions, stated exactly
 *
 * "Byte identity" is meaningless unless the bytes are pinned, so they are pinned here and nowhere
 * else. Both are **raw byte** digests. Neither is a canonical-JSON digest, and that distinction is
 * deliberate: canonicalizing would make two differently-formatted deliveries hash the same, which is
 * the opposite of what a substitution check needs.
 *
 * - **Candidate:** SHA-256 over the exact UTF-8 bytes of the individual delivered JSONL record,
 *   EXCLUDING its line terminator (no `\n`, no `\r\n`), and excluding nothing else — no trimming, no
 *   re-serialization, no key reordering.
 * - **Bundle:** SHA-256 over the exact bytes of the delivered bundle file, as received.
 *
 * ### What is deliberately absent
 *
 * No path — a path is a location, not an identity. No dialogue, no candidate text, no member list.
 * And no `observedSourceTrajectoryArtifactSha256`: that one is already RECOMPUTED from the trajectory
 * in hand by the validator, which is strictly stronger than an observation a caller reports.
 *
 * There is no member digest either. A bundle digest already fixes every byte of the delivery, so the
 * member's bytes are determined by it rather than independently attested; a member digest would be
 * derivable from the thing it claims to corroborate. If a future delivery layout makes the
 * bundle→member→candidate relationship genuinely non-reproducible, that is a contract change with its
 * own justification, not a field added on suspicion.
 */
import { z } from 'zod';

import { RiyaDatasetError } from '../../contracts/errors.js';
import { SHA256_HEX, sha256OfCanonical } from '../../internal/sha256.js';

export interface RiyaAiSyntheticExternalSourceBindingV1 {
  readonly version: 1;
  /** The intake bundle this observation belongs to. Pairs with a provenance record's own ref. */
  readonly generationRef: string;
  /** SHA-256 of the delivered JSONL record's exact UTF-8 bytes, excluding the line terminator. */
  readonly observedSourceCandidateSha256: string;
  /** SHA-256 of the delivered bundle file's exact bytes. */
  readonly observedSourceBundleSha256: string;
}

export type RiyaAiSyntheticExternalSourceBindingInput = Omit<
  RiyaAiSyntheticExternalSourceBindingV1,
  'version'
> & { readonly version?: 1 };

const REF = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9._:-]+$/);

const bindingSchema = z
  .object({
    // Optional, so an already-constructed record can be re-proved without being rejected for
    // carrying the field its own constructor added.
    version: z.literal(1).optional(),
    generationRef: REF,
    observedSourceCandidateSha256: z.string().regex(SHA256_HEX),
    observedSourceBundleSha256: z.string().regex(SHA256_HEX),
  })
  // Strict, so a well-meaning caller cannot attach the candidate text "for context". This record is
  // read at acceptance time; anything on it is one refactor away from being digested into evidence.
  .strict();

/** Validate and freeze an observed external source binding. Throws `invalid-ai-synthetic-source-binding`. */
export function createRiyaAiSyntheticExternalSourceBinding(
  input: RiyaAiSyntheticExternalSourceBindingInput,
): RiyaAiSyntheticExternalSourceBindingV1 {
  const parsed = bindingSchema.safeParse(input);
  if (!parsed.success) {
    throw new RiyaDatasetError('invalid-ai-synthetic-source-binding');
  }
  const data = parsed.data;

  return Object.freeze({
    version: 1 as const,
    generationRef: data.generationRef,
    observedSourceCandidateSha256: data.observedSourceCandidateSha256,
    observedSourceBundleSha256: data.observedSourceBundleSha256,
  });
}

/** The content digest of an observed source binding. */
export function riyaAiSyntheticExternalSourceBindingSha256(
  binding: RiyaAiSyntheticExternalSourceBindingV1,
): string {
  return sha256OfCanonical(binding);
}
