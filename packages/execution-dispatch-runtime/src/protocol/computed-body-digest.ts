/**
 * A SHA-256 digest the verifier computed ITSELF, from the raw bytes it received.
 *
 * Truly nominal. The only way to obtain one is `DispatchBodyDigest.fromRawBody`, which hashes the
 * actual bytes -- so a plain `string`, and in particular the envelope's untrusted CLAIMED
 * `bodyDigest`, is not assignable to it. Nominality comes from a private brand member declared with
 * `declare`, which emits no runtime property and exists only in the type system; a `private
 * constructor` alone would still admit a structurally-matching `{ hex, bytes }` object.
 *
 * That is what makes it a COMPILE-TIME impossibility for the signing input to be built from
 * anything but the digest of the real bytes. The claimed digest can only ever be COMPARED to this
 * value; it can never become the thing the signature is checked against.
 */
import { createHash } from 'node:crypto';

export class DispatchBodyDigest {
  /** Type-only brand. `declare` emits nothing at run time; `private` defeats structural typing. */
  declare private readonly __dispatchBodyDigestBrand: never;

  /** Lowercase hex, 64 characters. */
  public readonly hex: string;

  /** The 32 raw digest bytes, for constant-time comparison against a claimed digest. */
  public readonly bytes: Buffer;

  private constructor(bytes: Buffer) {
    this.bytes = bytes;
    this.hex = bytes.toString('hex');
  }

  /** The only constructor path: hash the raw body with SHA-256. */
  public static fromRawBody(rawBody: Uint8Array): DispatchBodyDigest {
    return new DispatchBodyDigest(createHash('sha256').update(rawBody).digest());
  }
}
