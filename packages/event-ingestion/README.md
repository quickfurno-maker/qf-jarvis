# @qf-jarvis/event-ingestion

The trust boundary in front of the event log. It authenticates what arrives from
QuickFurno Core before anything else in the system is allowed to believe it.

## Stage 3.2 — pure signature verification, and only that

This package currently provides **one capability**: verifying an Ed25519 signature over
a raw event body. That is the whole of Phase 3, Stage 3.2.

```ts
import { PublicKeyRegistry, verifySignature } from '@qf-jarvis/event-ingestion';

// The registry is built from bounded, serializable config records and an explicit
// environment. It parses/validates the SPKI DER key once and stores immutable snapshots.
const registry = new PublicKeyRegistry(
  [
    {
      keyId: 'core-2026-a',
      publicKeySpkiDerBase64, // canonical Base64 of the Ed25519 public key's SPKI DER
      status: 'active', // active | retiring | revoked
      purpose: 'core-to-jarvis-event',
      validFrom: '2026-01-01T00:00:00.000Z',
      validUntil: '2027-01-01T00:00:00.000Z',
    },
  ],
  'production', // development | test | production — a test- keyId is refused in production
);

const result = verifySignature(rawBody, envelope, now, registry);
if (result.ok) {
  // authentic, unaltered, fresh, under a valid key — result.keyId / result.signedAt
} else {
  // refused — result.reason is a stable, countable code
}
```

The registry never reads `process.env`; the environment is passed in. At most 32 keys; a
private key, malformed DER, non-Ed25519 key, wrong purpose, invalid keyId, or non-canonical
timestamp is rejected at construction. Mutating your config records afterwards cannot change
the registry.

**`publicKeySpkiDerBase64` must be canonical SPKI DER — canonical Base64 alone is not
enough.** The field must be a primitive string of **at most 128 characters** (checked before
any decoding), and its Base64 must be **canonical and padded**. The decoded bytes must parse as
an Ed25519 public SPKI DER key; the registry then **re-exports** the parsed key with
`publicKey.export({ format: 'der', type: 'spki' })` and requires the re-exported DER to equal
your supplied bytes **byte-for-byte**. This is deliberate: `createPublicKey` silently ignores
bytes appended after a valid DER structure, so **valid DER followed by trailing bytes is
rejected** by the byte-for-byte round-trip even though it would otherwise parse. In the example
above, `publicKeySpkiDerBase64` is the canonical Base64 of exactly the key's canonical SPKI DER
encoding and nothing more.

`verifySignature` is **pure and synchronous**. It reads no clock (the time is the
injected `now`), no environment, no file, and no socket. The keys are the injected
`registry`. Given the same inputs it returns the same result — which is what lets
freshness be tested at a simulated 2030 without mocking a clock.

### The protocol, precisely

The signature commits to these exact bytes (`ADR-0027`, refining `ADR-0020` §2):

```
"qf-jarvis-event-v1" ‖ "\n" ‖ keyId ‖ "\n" ‖ signedAt ‖ "\n" ‖ hex(sha256(rawBody))
```

The digest in the signing input is always the verifier's **own** `sha256(rawBody)`,
never the `bodyDigest` the untrusted envelope claimed. `signedAt` is a 24-character
`YYYY-MM-DDTHH:mm:ss.SSSZ` instant; the freshness window defaults to ±5 minutes and is
bounded; the raw body is capped at 262,144 bytes; keys are looked up by `keyId` and are
valid for `validFrom <= signedAt < validUntil`.

The envelope parser is strict and adversarial: it accepts only a plain object (prototype
`Object.prototype` or `null`), enumerates keys with `Reflect.ownKeys` (so symbol and
non-enumerable extras are caught), reads only own enumerable data-property values (never a
getter, setter, or inherited value), and turns a throwing `Proxy` trap into
`signature-malformed` rather than an exception. A `keyId` must match
`^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$`; a `signature` must be exactly 88 canonical Base64
characters decoding to 64 bytes. A wrong **shape** is `signature-malformed`; only a
correctly shaped signature that fails cryptographically is `signature-invalid`.

### What is deliberately **not** here

No `ingest` function, no database, no contract parsing or validation, no idempotency or
duplicate handling, no dead letters, no replay, no HTTP endpoint, and no worker loop.
Those are **Stage 3.3 (validated signed ingestion) and later**, which compose this
verifier with the rest of the pipeline. This package refuses a bad body; it does not yet
decide what a good one becomes.

`@qf-jarvis/api` and `@qf-jarvis/worker` remain empty boundaries — nothing imports this
package yet.

## Dependencies

**Zero third-party runtime dependencies.** The only runtime it uses is `node:crypto`.
It does not depend on `@qf-jarvis/contracts`, because it sits in front of contract
validation and must stay a pure leaf.

## Tests

Tests live in `src/tests/`, which the emitting build (`tsconfig.build.json`) excludes —
so the deterministic, **test-only** signing keys they use never reach `dist/` and are
never exported.

Two TypeScript configs make that split honest without weakening any check:

- `tsconfig.build.json` — the **emitting** build referenced by the root solution. It
  excludes `src/tests`, so `dist/` is production-only (no key material).
- `tsconfig.json` — a **no-emit** config that type-checks _everything_, production and
  tests, under the same strict flags. It is what the ESLint type-aware service uses and
  what `typecheck:tests` runs.

The test type-check is **not** a manual step. The package exposes `typecheck:tests`
(`tsc --noEmit -p tsconfig.json`), and the root `pnpm typecheck` ends with
`pnpm --recursive --if-present run typecheck:tests` — so `pnpm typecheck`, and therefore
`pnpm check` and CI, type-check the tests automatically. Nothing is emitted to do it.

Run the unit suite from the repository root with `pnpm test:unit` (these are
database-free).
