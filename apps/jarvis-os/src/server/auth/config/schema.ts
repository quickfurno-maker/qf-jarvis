import { z } from 'zod';

/**
 * The authentication configuration contract (JOS-01C, ADR-0087).
 *
 * ### One file, strictly parsed, never committed
 *
 * Everything an operator needs to authenticate lives in a single JSON document that this
 * repository never contains: a password verifier, a TOTP secret and a session key. The schema is
 * here, in tracked source, so the SHAPE is reviewable; the values are not, and cannot be.
 *
 * Every object is `.strict()`. An unknown field is a rejected file rather than an ignored one,
 * because the failure mode of a lenient auth config is a typo that silently disables a control —
 * `"required": true` misspelled as `"requird"` must not read as "TOTP is off".
 *
 * ### Why the bounds are so specific
 *
 * The minimums below are not taste. A 32-byte session key is the AES-256 key length; a shorter one
 * is a different, weaker cipher. A 16-byte salt is the Argon2 RFC 9106 floor. 19 MiB / 2 passes is
 * the OWASP Argon2id minimum. Writing them as parse-time constraints means a weakened config is
 * unloadable rather than merely discouraged — there is no code path that accepts it and warns.
 */

/** Base64url without padding, decoded to an exact byte length. */
const base64UrlBytes = (
  exactBytes: number | { readonly min: number; readonly max: number },
): z.ZodType<string> =>
  z
    .string()
    .min(1)
    .max(512)
    .regex(/^[A-Za-z0-9_-]+$/u, 'must be unpadded base64url')
    .refine(
      (value) => {
        const length = decodedByteLength(value);
        if (length === undefined) {
          return false;
        }
        return typeof exactBytes === 'number'
          ? length === exactBytes
          : length >= exactBytes.min && length <= exactBytes.max;
      },
      `must decode to ${typeof exactBytes === 'number' ? `${String(exactBytes)} bytes` : `${String(exactBytes.min)}-${String(exactBytes.max)} bytes`}`,
    );

function decodedByteLength(base64Url: string): number | undefined {
  try {
    return Buffer.from(base64Url, 'base64url').length;
  } catch {
    return undefined;
  }
}

export const OPERATOR_ROLE = 'OWNER' as const;

export const operatorSchema = z
  .object({
    /** A short opaque handle. Not an email, and deliberately not a directory identity. */
    id: z
      .string()
      .min(1)
      .max(64)
      .regex(/^[a-z0-9][a-z0-9._-]*$/u, 'must be a lowercase operator handle'),
    displayName: z.string().min(1).max(64),
    /**
     * The only role this bootstrap model has.
     *
     * A role enum with one value looks redundant and is not: it makes "add a second role" a schema
     * change that fails review, rather than a string somebody types into a config file.
     */
    role: z.literal(OPERATOR_ROLE),
  })
  .strict();

/**
 * Argon2id parameters, at or above the OWASP minimum.
 *
 * The algorithm is a literal. There is no "or PBKDF2, or bcrypt if unavailable" branch anywhere in
 * this app: a fallback is how a downgrade attack becomes a supported feature.
 */
export const passwordVerifierSchema = z
  .object({
    algorithm: z.literal('ARGON2ID_V19'),
    /** OWASP minimum 19456 KiB (19 MiB). Higher is allowed; lower is not loadable. */
    memoryKiB: z.number().int().min(19_456).max(1_048_576),
    passes: z.number().int().min(2).max(16),
    parallelism: z.number().int().min(1).max(8),
    /** RFC 9106 salt floor is 16 bytes. */
    salt: base64UrlBytes({ min: 16, max: 64 }),
    digest: base64UrlBytes(32),
  })
  .strict();

/**
 * TOTP parameters.
 *
 * SHA-1 is the standard here and that is deliberate, not an oversight. Every mainstream
 * authenticator app implements RFC 6238 with SHA-1/6 digits/30s, and HMAC-SHA1 is not broken for
 * this construction — the collision attacks on SHA-1 do not apply to a keyed 30-second MAC. A
 * stronger digest that no authenticator can enrol is worse security, not better.
 */
export const totpSchema = z
  .object({
    required: z.boolean(),
    algorithm: z.literal('SHA1'),
    digits: z.literal(6),
    periodSeconds: z.literal(30),
    /** At most one step either side: ~90 seconds of acceptance, not a wide-open window. */
    allowedDriftSteps: z.number().int().min(0).max(1),
    /** Strict uppercase base32, at least 160 random bits (RFC 4226 §4 R6). */
    secret: z
      .string()
      .min(32)
      .max(128)
      .regex(/^[A-Z2-7]+$/u, 'must be unpadded uppercase base32'),
  })
  .strict();

export const sessionKeySchema = z
  .object({
    id: z
      .string()
      .min(1)
      .max(32)
      .regex(/^[a-z0-9][a-z0-9-]*$/u, 'must be a lowercase key id'),
    status: z.enum(['PRIMARY', 'VERIFY_ONLY']),
    /** Exactly 32 bytes: this is an AES-256 key, and a shorter one is a different cipher. */
    key: base64UrlBytes(32),
  })
  .strict();

export const sessionSchema = z
  .object({
    /**
     * The global revocation counter.
     *
     * Every issued session carries it. Incrementing it in the file invalidates every outstanding
     * session at once, without a database — which is the only revocation this stateless model has,
     * and is why it is a required, verified claim rather than a convenience.
     */
    revision: z.number().int().min(1).max(1_000_000),
    /**
     * Absolute session lifetime. 15 minutes to 4 hours, 1 hour recommended.
     *
     * The ceiling exists because this model has no per-session revocation: a stolen token is valid
     * until it expires or the file is rotated. A long TTL turns a small theft into a long one.
     */
    absoluteTtlSeconds: z.number().int().min(900).max(14_400),
    primaryKeyId: sessionKeySchema.shape.id,
    keys: z.array(sessionKeySchema).min(1).max(3),
  })
  .strict();

export const authConfigV1Schema = z
  .object({
    version: z.literal(1),
    mode: z.enum(['PRODUCTION', 'LOCAL_DEVELOPMENT']),
    operator: operatorSchema,
    passwordVerifier: passwordVerifierSchema,
    totp: totpSchema,
    session: sessionSchema,
  })
  .strict()
  .superRefine((config, ctx) => {
    // Exactly one PRIMARY. Two would make "which key signs a new session" ambiguous, and zero
    // would make it impossible; both are configuration mistakes worth failing on.
    const primaries = config.session.keys.filter((key) => key.status === 'PRIMARY');
    if (primaries.length !== 1) {
      ctx.addIssue({
        code: 'custom',
        path: ['session', 'keys'],
        message: 'exactly one session key must be PRIMARY',
      });
    }

    const ids = config.session.keys.map((key) => key.id);
    if (new Set(ids).size !== ids.length) {
      ctx.addIssue({
        code: 'custom',
        path: ['session', 'keys'],
        message: 'session key ids must be unique',
      });
    }

    if (!ids.includes(config.session.primaryKeyId)) {
      ctx.addIssue({
        code: 'custom',
        path: ['session', 'primaryKeyId'],
        message: 'primaryKeyId must name a configured key',
      });
    }

    const primary = primaries[0];
    if (primary !== undefined && primary.id !== config.session.primaryKeyId) {
      ctx.addIssue({
        code: 'custom',
        path: ['session', 'primaryKeyId'],
        message: 'primaryKeyId must name the key marked PRIMARY',
      });
    }

    // THE production lock. There is no production password-only mode, and a config that asks for
    // one is unloadable rather than accepted-with-a-warning.
    if (config.mode === 'PRODUCTION' && !config.totp.required) {
      ctx.addIssue({
        code: 'custom',
        path: ['totp', 'required'],
        message: 'PRODUCTION requires TOTP: there is no password-only production mode',
      });
    }
  });

export type AuthConfigV1 = z.infer<typeof authConfigV1Schema>;
export type OperatorIdentity = z.infer<typeof operatorSchema>;
export type SessionKey = z.infer<typeof sessionKeySchema>;

/** The maximum size of the configuration file, enforced BEFORE any parsing. */
export const MAX_AUTH_CONFIG_BYTES = 16 * 1024;
