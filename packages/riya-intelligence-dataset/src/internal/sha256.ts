/**
 * Cryptographic SHA-256 content identity for dataset artifacts (RID-F1, ADR-0107).
 *
 * ### Why this is not P10's `contentDigest`
 *
 * `@qf-jarvis/model-evaluation` uses a non-cryptographic FNV-1a identity hash, and that is the right
 * choice there: it identifies an evaluation result inside a process that produced it moments earlier,
 * and the package deliberately imports no Node module.
 *
 * A dataset artifact has a different life. It is written once, copied between machines, stored for
 * months, and later cited as the exact thing a model was trained on. Two different corpora colliding
 * under one identity would be unrecoverable — nobody could tell afterwards which one produced the
 * weights. A 32-bit-derived hash is far too small to promise that; SHA-256 is the ordinary tool for
 * it, and `node:crypto` is the one intentional Node capability this package uses.
 *
 * ### What it proves, and what it does not
 *
 * It proves CONTENT IDENTITY and INTEGRITY: the same content always yields the same digest, and any
 * edit yields a different one. It is **not a signature**. It says nothing about who produced the
 * artifact or whether they were authorized to, and anyone who can edit a dataset can also recompute
 * its digest. Authorship would need signing keys and a registry, which this slice does not build and
 * does not pretend to.
 */
import { createHash } from 'node:crypto';

import { canonicalJson } from './canonical-json.js';

/** Exactly 64 lowercase hex characters. */
export const SHA256_HEX = /^[0-9a-f]{64}$/;

/** SHA-256 of a string, as 64 lowercase hex characters. */
export function sha256Hex(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/**
 * SHA-256 of raw bytes, as 64 lowercase hex characters.
 *
 * The byte-exact counterpart to `sha256Hex`, for artifacts whose identity IS their bytes: a delivered
 * file, or one record inside one. It decodes nothing, so it cannot lose an invalid UTF-8 sequence to a
 * replacement character, and it normalizes nothing, so two Unicode spellings of the same glyph stay
 * two different digests. That is the point — a substitution check that "helpfully" agreed about
 * differently-encoded bytes would be a substitution check with a hole in it.
 *
 * A `Buffer` is a `Uint8Array`, so a caller reading a file passes the result straight in.
 */
export function sha256Bytes(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/** SHA-256 over the canonical JSON of a value. Key order and absent optionals cannot change it. */
export function sha256OfCanonical(value: unknown): string {
  return sha256Hex(canonicalJson(value));
}
