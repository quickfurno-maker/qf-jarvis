import { argon2, timingSafeEqual } from 'node:crypto';

import { AuthFailure } from '../errors';
import type { AuthConfigV1 } from '../config/schema';

/**
 * Argon2id password verification (JOS-01C, ADR-0087).
 *
 * ### Node's built-in, and no fallback whatsoever
 *
 * Node 24.18 exposes `crypto.argon2`. It is currently flagged experimental, and using it is still
 * the right call: the alternative is a native compiled dependency, which this repository forbids
 * (`onlyBuiltDependencies: []` — no package may run a lifecycle build script), and the further
 * alternative is a weaker KDF, which is not an alternative at all.
 *
 * There is no fallback path. If Argon2id is unavailable at runtime the answer is
 * `config-algorithm-unavailable` and a closed door — never PBKDF2, never SHA-256, never bcrypt,
 * never a plaintext comparison. A silent downgrade is worse than an outage because nobody notices
 * it, and the whole value of a memory-hard KDF is destroyed by one working weaker branch.
 *
 * ### The async variant, on purpose
 *
 * 19 MiB and two passes is deliberately expensive. `argon2Sync` would block the event loop for the
 * whole derivation, so one login attempt would stall every other request — an availability problem
 * an attacker can trigger for free. The callback form runs on the threadpool.
 */

/** A password is bounded before it is ever hashed: unbounded input into a memory-hard KDF is a DoS. */
export const MAX_PASSWORD_BYTES = 256;

/**
 * Unicode normalization is NFC, and the decision is deliberate rather than incidental.
 *
 * The same passphrase typed on macOS and on Windows can arrive as different byte sequences for
 * identical-looking characters (decomposed vs precomposed accents). Without normalization an
 * operator would be locked out by their own keyboard. NFC is the form the web platform already
 * uses for form submission, so it is the least surprising choice.
 */
export function normalizePassword(raw: string): string {
  return raw.normalize('NFC');
}

export interface PasswordVerificationInput {
  readonly password: string;
  readonly verifier: AuthConfigV1['passwordVerifier'];
}

/**
 * Derive the candidate digest and compare it in constant time.
 *
 * Returns a boolean rather than throwing on mismatch: the CALLER decides what a mismatch means,
 * and every credential failure has to collapse into one outcome upstream anyway.
 */
export async function verifyPassword(input: PasswordVerificationInput): Promise<boolean> {
  const message = Buffer.from(normalizePassword(input.password), 'utf8');
  if (message.byteLength > MAX_PASSWORD_BYTES) {
    // Refuse before spending 19 MiB on it. Bounded input is the point of the limit.
    return false;
  }

  const expected = Buffer.from(input.verifier.digest, 'base64url');
  const candidate = await derive(message, input.verifier);

  // `timingSafeEqual` throws on a length mismatch, which would itself be a timing signal. The
  // schema pins the digest at 32 bytes and `tagLength` derives 32, so this is belt and braces.
  if (candidate.byteLength !== expected.byteLength) {
    return false;
  }
  return timingSafeEqual(candidate, expected);
}

/**
 * Derive with the CONFIGURED parameters, not with hardcoded ones.
 *
 * Reading them from the verifier is what makes future strengthening a config change: raise
 * `memoryKiB`, re-derive with the bootstrap tool, and old files stop verifying because their
 * parameters travel with them. Hardcoding here would silently verify an old weak digest with new
 * strong parameters and fail every login.
 */
async function derive(
  message: Buffer,
  verifier: AuthConfigV1['passwordVerifier'],
): Promise<Buffer> {
  const nonce = Buffer.from(verifier.salt, 'base64url');
  return new Promise<Buffer>((resolve, reject) => {
    try {
      argon2(
        'argon2id',
        {
          message,
          nonce,
          parallelism: verifier.parallelism,
          tagLength: 32,
          memory: verifier.memoryKiB,
          passes: verifier.passes,
        },
        (error, tag) => {
          if (error !== null) {
            reject(new AuthFailure('config-algorithm-unavailable'));
            return;
          }
          resolve(Buffer.from(tag.buffer, tag.byteOffset, tag.byteLength));
        },
      );
    } catch {
      // A missing or renamed built-in lands here. Fail closed; do not reach for a weaker digest.
      reject(new AuthFailure('config-algorithm-unavailable'));
    }
  });
}
