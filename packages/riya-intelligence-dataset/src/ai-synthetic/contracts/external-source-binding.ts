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
 * ### The hashing conventions are CODE, not prose
 *
 * "Byte identity" is meaningless unless the bytes are pinned, and a convention that lives only in a
 * doc comment is one that two implementations will eventually disagree about. So both live in this
 * module as exported functions — `riyaAiSyntheticExternalJsonlRecordSha256` and
 * `riyaAiSyntheticExternalBundleSha256` — and the future intake reader is expected to CALL them
 * rather than reimplement a byte rule from a paragraph. The specs pin both against hard-coded
 * SHA-256 vectors computed outside this package, so a test cannot agree with a bug in the helper.
 *
 * Both are **raw byte** digests. Neither is a canonical-JSON digest, and that distinction is
 * deliberate: canonicalizing would make two differently-formatted deliveries hash the same, which is
 * the opposite of what a substitution check needs.
 *
 * The rules themselves are documented on the two functions below, where somebody changing them has
 * to read them.
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
import { SHA256_HEX, sha256Bytes, sha256OfCanonical } from '../../internal/sha256.js';

// ---------------------------------------------------------------------------
// The conventions, as code.
// ---------------------------------------------------------------------------

const LF = 0x0a;
const CR = 0x0d;

/**
 * The candidate digest convention, executable.
 *
 * SHA-256 over the exact UTF-8 bytes of ONE delivered JSONL record, excluding only its terminal line
 * ending. Prose in a doc comment is not a convention anybody can comply with; this function is, and
 * the future intake reader is expected to CALL it rather than reimplement it. Two implementations of
 * a byte convention is one implementation and one future mismatch nothing could explain.
 *
 * What it removes: a final CRLF (exactly two bytes), or failing that a final LF (exactly one byte).
 * Nothing else, ever.
 *
 * What it deliberately does NOT do:
 *
 * - **No trimming.** A trailing space is part of the delivered record. Trimming would make two
 *   different deliveries hash the same, which is the one thing a substitution check must not do.
 * - **No JSON parse, no re-serialization, no key reordering.** This is byte identity, not canonical
 *   identity. `{"a":1,"b":2}` and `{"b":2,"a":1}` are different deliveries here, on purpose --
 *   `sha256OfCanonical` is the function that says otherwise, and it is the wrong tool for this job.
 * - **No Unicode normalization.** An NFD and an NFC spelling of the same glyph are different bytes.
 * - **No bare-CR stripping.** A lone trailing CR is kept, because no convention in this repository
 *   defines bare CR as a JSONL line terminator, and silently dropping a byte on a guess is how a
 *   digest starts disagreeing with the file it claims to describe.
 *
 * Throws `invalid-ai-synthetic-source-binding` if nothing is left after the terminator is removed:
 * an empty record is not a candidate, and hashing it would yield the digest of emptiness -- a fixed,
 * plausible-looking 64-hex value that would then be comparable against a claim.
 */
export function riyaAiSyntheticExternalJsonlRecordSha256(recordBytes: Uint8Array): string {
  if (!(recordBytes instanceof Uint8Array)) {
    throw new RiyaDatasetError('invalid-ai-synthetic-source-binding');
  }

  const length = recordBytes.length;
  const endsWithLf = length >= 1 && recordBytes[length - 1] === LF;
  const endsWithCrLf = endsWithLf && length >= 2 && recordBytes[length - 2] === CR;
  const end = endsWithCrLf ? length - 2 : endsWithLf ? length - 1 : length;

  if (end === 0) {
    throw new RiyaDatasetError('invalid-ai-synthetic-source-binding');
  }
  // `subarray`, not `slice`: a view, so a large delivery is not copied to be hashed.
  return sha256Bytes(recordBytes.subarray(0, end));
}

/**
 * The bundle digest convention, executable.
 *
 * SHA-256 over ALL the delivered bytes, exactly as supplied. No line-ending handling, no decoding,
 * no normalization, no exceptions -- a bundle is an opaque file, and the moment this function starts
 * interpreting its contents it stops being able to prove the file was not swapped.
 */
export function riyaAiSyntheticExternalBundleSha256(bundleBytes: Uint8Array): string {
  if (!(bundleBytes instanceof Uint8Array)) {
    throw new RiyaDatasetError('invalid-ai-synthetic-source-binding');
  }
  return sha256Bytes(bundleBytes);
}

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
