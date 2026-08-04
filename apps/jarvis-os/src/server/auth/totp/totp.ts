import { createHmac, timingSafeEqual } from 'node:crypto';

import type { AuthConfigV1 } from '../config/schema';

/**
 * RFC 6238 TOTP (JOS-01C, ADR-0087).
 *
 * Node built-ins only — `createHmac` and `timingSafeEqual`. TOTP is about forty lines of arithmetic
 * over an HMAC, and a dependency for it would be forty lines of arithmetic plus a supply-chain
 * surface that can reach the secret it is given.
 *
 * ### SHA-1 is correct here
 *
 * Every mainstream authenticator implements RFC 6238 with SHA-1, six digits, thirty seconds. The
 * SHA-1 collision results do not apply to a keyed 30-second MAC over an 8-byte counter; choosing
 * SHA-256 would buy nothing measurable and would lock the owner out of Google Authenticator, 1Password
 * and every hardware TOTP token. A factor nobody can enrol is not a stronger factor.
 */

/** Exactly six ASCII digits. Anything else is rejected before any HMAC work. */
const CODE_PATTERN = /^[0-9]{6}$/u;

/** Strict uppercase RFC 4648 base32, unpadded. */
export function decodeBase32(secret: string): Buffer | undefined {
  if (!/^[A-Z2-7]+$/u.test(secret)) {
    return undefined;
  }
  const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const character of secret) {
    const index = ALPHABET.indexOf(character);
    if (index < 0) {
      return undefined;
    }
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      out.push((value >>> bits) & 0xff);
    }
  }
  return Buffer.from(out);
}

/** One RFC 6238 code for a given counter step. */
export function totpCodeForStep(secret: Buffer, step: number, digits: number): string {
  // The counter is a big-endian 64-bit integer. `writeBigUInt64BE` avoids the 2^53 and sign
  // problems a 32-bit split invites, and steps are small enough that the cast is exact.
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.max(0, Math.trunc(step))));

  const digest = createHmac('sha1', secret).update(counter).digest();

  // Dynamic truncation, RFC 4226 §5.3.
  const lastByte = digest[digest.length - 1];
  const offset = (lastByte ?? 0) & 0x0f;
  const binary =
    (((digest[offset] ?? 0) & 0x7f) << 24) |
    (((digest[offset + 1] ?? 0) & 0xff) << 16) |
    (((digest[offset + 2] ?? 0) & 0xff) << 8) |
    ((digest[offset + 3] ?? 0) & 0xff);

  return (binary % 10 ** digits).toString().padStart(digits, '0');
}

export interface TotpVerificationInput {
  readonly code: string;
  readonly totp: AuthConfigV1['totp'];
  /** Injected: the verification instant in epoch SECONDS. No clock is read here. */
  readonly nowSeconds: number;
}

/**
 * Verify a submitted code across the allowed drift window.
 *
 * Every candidate step is compared in constant time, and the loop does NOT break early on a match.
 * Returning as soon as step −1 matches would make "matched on the first candidate" measurably
 * faster than "matched on the last", which leaks which step the client's clock is on — small, but
 * free to avoid.
 */
export function verifyTotp(input: TotpVerificationInput): boolean {
  if (!CODE_PATTERN.test(input.code)) {
    return false;
  }

  const secret = decodeBase32(input.totp.secret);
  if (secret === undefined || secret.byteLength < 20) {
    return false;
  }

  const step = Math.floor(input.nowSeconds / input.totp.periodSeconds);
  const drift = input.totp.allowedDriftSteps;
  const submitted = Buffer.from(input.code, 'ascii');

  let matched = false;
  for (let offset = -drift; offset <= drift; offset += 1) {
    const candidate = Buffer.from(
      totpCodeForStep(secret, step + offset, input.totp.digits),
      'ascii',
    );
    if (candidate.byteLength === submitted.byteLength && timingSafeEqual(candidate, submitted)) {
      matched = true;
    }
  }
  return matched;
}

/**
 * An `otpauth://` URI for manual enrolment.
 *
 * Used ONLY by the bootstrap CLI, printed once to a terminal, and never logged, stored or returned
 * over HTTP. It is here rather than in the CLI so the encoding is covered by the same tests as the
 * verifier that must accept it.
 */
export function otpauthUri(options: {
  readonly issuer: string;
  readonly accountName: string;
  readonly secret: string;
  readonly digits: number;
  readonly periodSeconds: number;
}): string {
  const label = `${encodeURIComponent(options.issuer)}:${encodeURIComponent(options.accountName)}`;
  const params = new URLSearchParams({
    secret: options.secret,
    issuer: options.issuer,
    algorithm: 'SHA1',
    digits: String(options.digits),
    period: String(options.periodSeconds),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}
