/**
 * A SHA-256 digest the verifier computed **itself**, from the raw body it received.
 *
 * This type is **truly nominal**: the only way to obtain a `ComputedBodyDigest` is
 * `ComputedBodyDigest.fromRawBody`, which hashes the actual bytes. A plain `string`
 * — in particular the envelope's untrusted, *claimed* `bodyDigest` — is not assignable
 * to it, and neither is the envelope object, an `unknown`, nor a plain object that
 * happens to have matching `hex`/`bytes` fields.
 *
 * Nominality is enforced by a **private brand instance member**
 * (`__computedBodyDigestBrand`). A TypeScript `private constructor` alone is *not*
 * enough — with only public `hex`/`bytes`, a structurally-matching `{ hex, bytes }`
 * object would still be assignable. A `private` member makes the class assignable only
 * from its own instances, and being declared with `declare` it emits **no runtime
 * property**: it exists solely in the type system.
 *
 * This is what makes it a **compile-time impossibility** for `buildSigningInput` to be
 * handed anything but the digest the verifier took over the real bytes (ADR-0027 §2).
 * The claimed digest can only ever be *compared* to this value (verification step 10);
 * it can never be the thing the signing input is built from (step 11).
 */
import { createHash } from 'node:crypto';

export class ComputedBodyDigest {
  /**
   * The nominal brand. `declare` means it is type-only and emits no runtime property;
   * a `private` member makes `ComputedBodyDigest` assignable only from its own instances,
   * so a structural `{ hex, bytes }` object is rejected at compile time.
   */
  declare private readonly __computedBodyDigestBrand: never;

  /** Lowercase hex, 64 characters. */
  public readonly hex: string;

  /** The 32 raw digest bytes, for constant-time comparison against a claimed digest. */
  public readonly bytes: Buffer;

  private constructor(bytes: Buffer) {
    this.bytes = bytes;
    this.hex = bytes.toString('hex');
  }

  /** The only constructor path: hash the raw body with SHA-256. */
  public static fromRawBody(rawBody: Uint8Array): ComputedBodyDigest {
    return new ComputedBodyDigest(createHash('sha256').update(rawBody).digest());
  }
}
