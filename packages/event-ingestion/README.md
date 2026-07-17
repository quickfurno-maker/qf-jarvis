# @qf-jarvis/event-ingestion

The trust boundary in front of the event log. It authenticates what arrives from
QuickFurno Core before anything else in the system is allowed to believe it.

## Stage 3.2 — pure signature verification, and only that

This package's **public** capability is exactly one: verifying an Ed25519 signature over
a raw event body — the whole of Phase 3, Stage 3.2. The Stage 3.3 slices below (semantic digest,
validated event preparation, and the persistence bridge) are **INTERNAL** and are not part of the
package root surface.

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

No end-to-end `ingest` function, no HTTP endpoint, no worker loop, no rejection recording, no
dead letters, and no replay. Those are **later Stage 3.3 work**. The **public** surface
**authenticates the body only** — `verifySignature` and the `PublicKeyRegistry` — and exposes **no**
raw body, key, or signature bytes. **Validated-event preparation (slices 1–2) and the persistence
bridge (slice 3) are INTERNAL**, not part of the package root; a later ingest composition will
compose them behind authentication.

`@qf-jarvis/api` and `@qf-jarvis/worker` remain empty boundaries — nothing imports this
package yet.

## Stage 3.3 slice 3 — the persistence bridge (INTERNAL)

Two INTERNAL additions turn a verified, prepared event into a durable row, without widening the
public surface:

- **`verifySignatureWithEvidence`** — the same verification as the public `verifySignature`, but on
  success it also yields the verified signature and the Ed25519 algorithm, **produced from the very
  envelope it just verified**. The evidence is a **deeply immutable** value: every field is a frozen
  primitive string — `signatureBase64`, `signedAtIso`, `bodyDigestHex`, `keyId`, and the `algorithm`
  literal — with **no mutable `Buffer` or `Date`**. That is deliberate: `Object.freeze` on an object
  holding a `Buffer` would not freeze the bytes, and a caller could otherwise overwrite the signature
  after verification and before persistence. The public `verifySignature` is literally this projected
  down to its safe subset, so there is one verification implementation and the public result cannot
  drift. The evidence type is **not exported** from the barrel.
- **`buildEventPersistenceRecord` / `persistPreparedEvent`** — build the persistence-ready record
  from a prepared event and its immutable signature evidence (decoding `signatureBase64` into a
  fresh `Buffer` at that moment), then hand it to `storeValidatedEvent` in
  `@qf-jarvis/event-backbone`. The two inputs are **bound by the body digest, key id, and signed-at
  instant — all immutable strings**: evidence for one body cannot be paired with a prepared event for
  another (`EvidencePreparationMismatchError`). No raw body and no unverified JSON can reach
  persistence — there is no path that takes one.

The atomic DATABASE behaviour (first-delivery store, same-digest benign duplicate, different-digest
typed conflict, real-concurrency, rollback) lives in `storeValidatedEvent` and is proven against a
real PostgreSQL in `@qf-jarvis/event-backbone`'s integration tests. This package holds **no pool**.
None of these symbols is exported from the package root (`public-api.test.ts` enforces it), and the
end-to-end `ingest` composition and worker are still outstanding.

## Stage 3.3 slice 1 — the semantic-digest foundation (ADR-0029), INTERNAL

A pure, deterministic canonical JSON + SHA-256 digest over an already-validated canonical
event lives in `src/ingest/` for semantic duplicate comparison — a comparison now **performed by
the slice-3 persistence path**, which carries this digest into `storeValidatedEvent`. It is
**database-free** and **not exported** from the package barrel — only the composition below calls
it. It is not the signing canonicalisation: signatures still verify the exact raw bytes.

## Stage 3.3 slice 2 — validated event preparation (ADR-0030), INTERNAL

A pure composition, `prepareValidatedEventFromVerifiedRawBody`, turns a raw body into a
validated canonical event bound to its semantic digest. In order: strict fatal UTF-8 decoding,
explicit BOM rejection, `JSON.parse` only, validation against the authoritative
`@qf-jarvis/contracts` registry, and — on success — the validated event is **canonicalised
once**, the digest is taken over that canonical JSON, and the returned snapshot is a re-parse of
the **same** canonical JSON, deeply frozen. Snapshot and digest are therefore one identical
canonical representation; `signedAt` is carried as an immutable ISO-8601 string.

**Authenticity is an internal caller precondition, not something this function proves.** It does
not perform Ed25519 verification. A future ingest composition must call `verifySignature` first
and pass this function the **actual** `SignatureVerificationSuccess` and the **exact same bytes**,
immediately. The function recomputes `sha256(verifiedRawBody)` only to catch an accidental
body/result **mispairing** — a wiring guard, not a signature check. TypeScript `readonly` and
structural types are not security capabilities, so the function stays **internal**.

A refused body returns a bounded, **safe** rejection carrying exactly one of three pinned
identifiers — `contract-validation-failed`, `unknown-event-type`, `unknown-event-version`
(ADR-0020 §11, ADR-0027) — plus `issuesTruncated`. Issues are **re-owned**, never forwarded from
the validator: a closed code vocabulary, fixed repository-owned messages, and a structural path
rebuilt from a canonical-envelope allowlist (every other segment becomes an opaque `[field]`). No
validator-native message, sender-controlled key, or submitted `eventType`/`eventVersion` ever
appears in a rejection. The type-versus-version distinction is decided independently and in a
fixed order against the registry — an unknown type is identified before the version is
interpreted, with no coercion or fallback.

**Known limitation:** `JSON.parse` is the only parser and resolves duplicate object keys
last-key-wins; this slice **does not detect duplicate keys**, and no custom or third-party parser
is introduced. Duplicate-key rejection is a pre-activation hardening decision. There is **no
`ingest` and no database in THIS slice**, and the composition is **not exported** from the
package barrel — it is reached only by the later ingest composition. Persistence itself arrives in
**slice 3** (above), via the INTERNAL bridge to `@qf-jarvis/event-backbone`. **Stage 3.3 is not
complete or production-ready:** the end-to-end `ingest` function and worker are outstanding.
Managed-database readiness is established and migration `0001_event_log.sql` is applied; the
slice-3 runtime-grants migration `0002_event_runtime_grants.sql` is verified against local
PostgreSQL and **not yet applied to the managed database, pending review** (ADR-0029, ADR-0030).

## Dependencies

**Two workspace runtime dependencies: `@qf-jarvis/contracts`** — the authoritative owner of the
canonical event contracts, used by slice-2 validated-event preparation — **and `@qf-jarvis/event-backbone`**,
whose `storeValidatedEvent` the slice-3 persistence bridge delegates to. Both are data/persistence
packages this one depends on; the dependency direction is one-way (`event-ingestion → event-backbone`
and `event-ingestion → contracts`), with **no cycle**. `@qf-jarvis/contracts` is **data-only** —
it opens no socket, reads no environment, and touches no filesystem; its transitive `zod` is used
for validation only. This package takes **no direct `zod` dependency and imports `zod` nowhere**.
The only other runtime it uses is `node:crypto`. Contract validation runs **behind** signature
verification, never in front of it.

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
