import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';

import { AuthFailure } from '../errors';
import type { AuthConfigV1 } from '../config/schema';

/**
 * The encrypted operator session token (JOS-01C, ADR-0087).
 *
 * ### Encrypted, not merely signed
 *
 * A signed-but-readable token (a JWT, say) would put the operator id, role, session id and CSRF
 * token in plain view of anything that can read the cookie jar — a browser extension, a shared
 * machine, a support screenshot. AES-256-GCM gives confidentiality AND integrity in one pass, so
 * the claims are opaque and tampering is detected by the same operation that reads them.
 *
 * No JWT library. The format below is forty lines and has no algorithm-negotiation field, which is
 * the single most exploited weakness in the JWT ecosystem: there is no `alg: none` to confuse
 * because there is no `alg` at all.
 *
 * ### The AAD binds the token to its context
 *
 * Version, key id and cookie name are authenticated but not encrypted. Binding them means a token
 * minted for this cookie cannot be replayed as a different one, and a future v2 token cannot be
 * silently accepted by a v1 reader — the tag simply fails.
 */

/** `v1.<kid>.<iv>.<ciphertext>.<tag>`, all parts unpadded base64url except the literal version. */
export const TOKEN_VERSION = 'v1' as const;
const IV_BYTES = 12;
const TAG_BYTES = 16;

/** A token is bounded: an oversized cookie is a parse-cost attack, not a session. */
export const MAX_TOKEN_CHARS = 1024;

/** The purpose string mixed into the AAD. Rebinding a token to another cookie fails the tag. */
export const SESSION_COOKIE_PURPOSE = 'qfj-jos-operator-session' as const;

export const sessionClaimsSchema = z
  .object({
    version: z.literal('1'),
    /** ≥128 bits of randomness, fresh on every successful login. No session fixation. */
    sessionId: z
      .string()
      .min(22)
      .max(64)
      .regex(/^[A-Za-z0-9_-]+$/u),
    operatorId: z.string().min(1).max(64),
    role: z.literal('OWNER'),
    sessionRevision: z.number().int().min(1).max(1_000_000),
    issuedAt: z.number().int().min(0).max(4_102_444_800),
    expiresAt: z.number().int().min(0).max(4_102_444_800),
    /** 256 bits, used for the logout double-submit check. Never leaves the server except in a form. */
    csrfToken: z
      .string()
      .min(43)
      .max(64)
      .regex(/^[A-Za-z0-9_-]+$/u),
  })
  .strict();

export type SessionClaims = z.infer<typeof sessionClaimsSchema>;

/** Tolerance for a token that looks very slightly future-issued. Clocks drift; hours do not. */
export const CLOCK_SKEW_SECONDS = 30;

function additionalData(keyId: string): Buffer {
  return Buffer.from(`${TOKEN_VERSION}.${keyId}.${SESSION_COOKIE_PURPOSE}`, 'utf8');
}

function keyById(config: AuthConfigV1, keyId: string): Buffer | undefined {
  const entry = config.session.keys.find((candidate) => candidate.id === keyId);
  return entry === undefined ? undefined : Buffer.from(entry.key, 'base64url');
}

/** Mint a token with the PRIMARY key. Verify-only keys can read old tokens but never sign new ones. */
export function sealSession(config: AuthConfigV1, claims: SessionClaims): string {
  const keyId = config.session.primaryKeyId;
  const key = keyById(config, keyId);
  if (key === undefined) {
    throw new AuthFailure('config-invalid');
  }

  // A fresh random IV per token. GCM catastrophically fails on IV reuse under the same key, so
  // this is randomBytes rather than a counter that could restart with the process.
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(additionalData(keyId));

  const plaintext = Buffer.from(JSON.stringify(claims), 'utf8');
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [
    TOKEN_VERSION,
    keyId,
    iv.toString('base64url'),
    ciphertext.toString('base64url'),
    tag.toString('base64url'),
  ].join('.');
}

export interface OpenSessionInput {
  readonly token: string;
  readonly config: AuthConfigV1;
  /** Injected verification instant, epoch seconds. This module reads no clock. */
  readonly nowSeconds: number;
}

/**
 * Decrypt, validate and freeze a token, or throw a generic session failure.
 *
 * Every rejection below is a distinct `code` for server reasoning and the SAME public outcome, so
 * a client cannot tell "tampered tag" from "expired" from "revision rotated".
 */
export function openSession(input: OpenSessionInput): Readonly<SessionClaims> {
  if (input.token.length > MAX_TOKEN_CHARS) {
    throw new AuthFailure('session-malformed');
  }

  const parts = input.token.split('.');
  if (parts.length !== 5) {
    throw new AuthFailure('session-malformed');
  }
  const [version, keyId, ivPart, ciphertextPart, tagPart] = parts as [
    string,
    string,
    string,
    string,
    string,
  ];
  if (version !== TOKEN_VERSION) {
    throw new AuthFailure('session-malformed');
  }

  const key = keyById(input.config, keyId);
  if (key === undefined) {
    // An unknown key id is how key REMOVAL revokes: drop the key from the file and every token
    // sealed with it stops opening, immediately and without a database.
    throw new AuthFailure('session-undecryptable');
  }

  const iv = Buffer.from(ivPart, 'base64url');
  const ciphertext = Buffer.from(ciphertextPart, 'base64url');
  const tag = Buffer.from(tagPart, 'base64url');
  if (iv.byteLength !== IV_BYTES || tag.byteLength !== TAG_BYTES || ciphertext.byteLength === 0) {
    throw new AuthFailure('session-malformed');
  }

  let plaintext: Buffer;
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAAD(additionalData(keyId));
    decipher.setAuthTag(tag);
    plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  } catch {
    // Tag mismatch: tampered, truncated, wrong key, or rebound to another cookie purpose.
    throw new AuthFailure('session-undecryptable');
  }

  let candidate: unknown;
  try {
    candidate = JSON.parse(plaintext.toString('utf8'));
  } catch {
    throw new AuthFailure('session-claims-invalid');
  }

  const parsed = sessionClaimsSchema.safeParse(candidate);
  if (!parsed.success) {
    throw new AuthFailure('session-claims-invalid');
  }
  const claims = parsed.data;

  // --- temporal validity -------------------------------------------------------------------
  if (claims.expiresAt <= claims.issuedAt) {
    throw new AuthFailure('session-claims-invalid');
  }
  if (claims.expiresAt - claims.issuedAt > input.config.session.absoluteTtlSeconds) {
    // A token claiming a longer life than the configuration permits. Shortening the configured TTL
    // must shorten EXISTING sessions too, or the setting would only apply to future logins.
    throw new AuthFailure('session-claims-invalid');
  }
  if (claims.issuedAt > input.nowSeconds + CLOCK_SKEW_SECONDS) {
    throw new AuthFailure('session-claims-invalid');
  }
  if (claims.expiresAt <= input.nowSeconds) {
    throw new AuthFailure('session-expired');
  }

  // --- identity and revocation --------------------------------------------------------------
  if (claims.sessionRevision !== input.config.session.revision) {
    throw new AuthFailure('session-revision-stale');
  }
  // Only the operator id can actually differ: `role` is the literal 'OWNER' on both sides, pinned
  // by the schema. If a second role is ever introduced this must gain the role comparison back --
  // the reason is recorded here rather than the check silently disappearing.
  if (claims.operatorId !== input.config.operator.id) {
    throw new AuthFailure('session-operator-changed');
  }

  return Object.freeze(claims);
}

/** Mint fresh claims for a login that has already passed every factor. */
export function newSessionClaims(options: {
  readonly config: AuthConfigV1;
  readonly nowSeconds: number;
}): SessionClaims {
  return {
    version: '1',
    sessionId: randomBytes(16).toString('base64url'),
    operatorId: options.config.operator.id,
    role: 'OWNER',
    sessionRevision: options.config.session.revision,
    issuedAt: options.nowSeconds,
    expiresAt: options.nowSeconds + options.config.session.absoluteTtlSeconds,
    csrfToken: randomBytes(32).toString('base64url'),
  };
}

/** Constant-time CSRF comparison. Length is compared first so `timingSafeEqual` cannot throw. */
export function csrfMatches(expected: string, submitted: string): boolean {
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(submitted, 'utf8');
  return a.byteLength === b.byteLength && timingSafeEqual(a, b);
}
