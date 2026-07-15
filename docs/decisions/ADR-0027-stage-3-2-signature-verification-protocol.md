# ADR-0027 — Stage 3.2 Signature Verification Protocol and the 3.2/3.3 Boundary

**Status:** Accepted
**Date:** 2026-07-15
**Deciders:** Keshav Sharma (Founder, QuickFurno — business owner)

---

## Context

[ADR-0020](./ADR-0020-event-ingestion-signature-verification-and-idempotency.md) decided
_what_ event ingestion must do: Ed25519 signatures over the exact raw bytes, replay
protection, idempotency, and a fail-closed conflict rule. It is a single accepted design
that spans **two build stages** — 3.2 (signature verification) and 3.3 (validated signed
ingestion). ADR-0020 deliberately left two things unpinned that an implementation must
nail down: the **exact wire details** of the protocol, and the **precise line** between
what Stage 3.2 delivers and what waits for Stage 3.3.

This ADR pins both. It refines ADR-0020; it does not overturn any part of it. Where ADR-0020
speaks of "ingestion", ADR-0027 separates the _authentication_ half (3.2) from the
_persistence and idempotency_ half (3.3), so that 3.2 can ship as a pure, database-free,
fixture-testable unit while Core is still being repaired ([phased-roadmap](../architecture/phased-roadmap.md),
Stage 3.1.3 note).

The hard gate before this stage — Stage 3.1.4, canonical-payload privacy hardening
([ADR-0026](./ADR-0026-canonical-payload-privacy-boundary.md)) — is **accepted and closed**.
_"Signing a payload that can smuggle coordinates only makes the smuggling authenticated"_;
that hole is shut, so authenticating the boundary is now the right next step.

## Decision

**Stage 3.2 is exactly one thing: a pure, synchronous Ed25519 signature verifier, plus the
public-key registry it looks keys up in. It touches no database, parses no contract, and
exposes no `ingest` function.** It lives in a new package, `@qf-jarvis/event-ingestion`,
which Stage 3.3 will grow into the full ingestion surface.

### 1. A new package, seeded with verification only

The verifier does not belong in `@qf-jarvis/event-backbone`: that package is persistence,
its "only dependency is `pg`", and it explicitly disclaims signature verification
([repository-structure](../engineering/repository-structure.md)). The verifier needs no
`pg` and no database; it is a different concern with a nameable boundary — _input
authentication_ — and a real future consumer set (the Stage 3.3 ingest function in
`worker`, and `apps/api` in Phase 11, exactly as ADR-0020 §10 anticipated when it said
"ingestion is a package"). So it is its own package, and Stage 3.2 seeds it with the
verifier alone.

### 2. The signing input — and the one rule that makes it safe

The signature is verified over these exact bytes:

```
utf8( "qf-jarvis-event-v1" ‖ "\n" ‖ keyId ‖ "\n" ‖ signedAt ‖ "\n" ‖ computedDigestHex )
```

where `computedDigestHex` is `hex(sha256(rawBody))` **as the verifier itself computes it
from the bytes it received.** The signing input is **never** constructed from the
envelope's claimed `bodyDigest`. If it were, a signer could commit to one digest in the
signing input while shipping a different body, and the signature would verify against a
number the attacker chose. The digest that enters the signing input is the one taken over
the real bytes; the envelope's claim is only ever _compared_ to it (§4), never _trusted_ to
build it.

This is enforced by the **type system**, not by discipline. The signing-input builder
accepts a nominal `ComputedBodyDigest` — a type whose only constructor,
`ComputedBodyDigest.fromRawBody`, hashes the raw bytes. The envelope's claimed `bodyDigest`
is a plain `string` and is not assignable to it; neither is the envelope object nor an
`unknown`. So it is a **compile-time impossibility** to build the signing input from the
untrusted claim, and because the quality gate type-checks the test files too (see §8), a
change that tried to weaken this boundary would fail the gate rather than pass unnoticed. A
dedicated regression test (`signing-input-invariant.test.ts`) additionally pins the
behaviour: a claimed-vs-computed mismatch is refused at step 10, before any Ed25519 check.

The `"qf-jarvis-event-v1"` prefix is domain separation (ADR-0020 §2). There is no JSON
canonicalisation, by design.

### 3. The envelope: a strict, adversarial plain-object parser

```
{ algorithm: 'ed25519', keyId, signedAt, bodyDigest: 'sha256:<hex>', signature: <88-char base64> }
```

Parsed by a **strict, hand-written, adversarial** parser — Stage 3.2 has no runtime
dependency, not even `@qf-jarvis/contracts`, so there is no schema library to lean on. The
envelope is treated as fully hostile:

- It must be a **plain object** — prototype `Object.prototype` **or `null`**. A null-prototype
  object is explicitly accepted (it is the safest carrier of all — nothing to inherit); arrays,
  class instances, and other exotic objects are rejected.
- Keys are enumerated with **`Reflect.ownKeys`**, so a **symbol** key or a **non-enumerable**
  extra is detected. Exactly the five approved string keys are allowed — no more, no fewer.
- Each field is read from its **own data-property descriptor value only**. The parser never
  invokes a getter, never triggers a setter, and never reads an inherited value. An accessor,
  a non-enumerable approved key, or a non-string value is `signature-malformed`.
- Every reflective operation is wrapped in `try/catch`: a hostile `Proxy` whose trap throws
  yields `signature-malformed`, never a propagated exception. **No untrusted envelope can make
  `verifySignature` throw.**

Field formats: `keyId` must satisfy the shared keyId rule (§keyId below); `bodyDigest` must be
`sha256:` + 64 lowercase hex; `signature` must be the exact format in §signature below.
`signedAt` is validated as a canonical instant at step 4.

**The keyId rule (shared by envelope and registry):** `^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$` —
length 1–128, starting alphanumeric, with no spaces, tabs, CR/LF, other control characters,
path separators, or the `\n` signing-input delimiter. A keyId can therefore never inject a
newline into the signing input.

**The signature format:** exactly **88 characters** — 86 Base64 data characters followed by
`==` — canonical, decoding to exactly 64 bytes and re-encoding byte-for-byte. Any deviation of
length, alphabet, padding, or canonical form is **`signature-malformed`**. Only a correctly
shaped 64-byte signature that fails cryptographic verification is **`signature-invalid`**.

`signedAt` is **`YYYY-MM-DDTHH:mm:ss.SSSZ` — exactly 24 ASCII characters, millisecond
precision, `Z` zone.** That is precisely what `Date.prototype.toISOString()` emits, so it is
validated by canonical round-trip, which also rejects impossible calendar dates. The same
canonical-timestamp rule validates the registry's `validFrom` and `validUntil`.

### 4. The registry: validated configuration in, immutable snapshots out

The registry is constructed from **bounded, serializable configuration records** — not from
live `KeyObject`s a caller built — and an **explicit environment**:

```
new PublicKeyRegistry(records, 'development' | 'test' | 'production')

record = {
  keyId,                       // the shared keyId rule
  publicKeySpkiDerBase64,      // canonical Base64 of the Ed25519 public key's SPKI DER
  status,                      // active | retiring | revoked
  purpose: 'core-to-jarvis-event',
  validFrom, validUntil,       // canonical YYYY-MM-DDTHH:mm:ss.SSSZ instants
}
```

At construction the registry: bounds the set to **at most 32 records** (33 is rejected);
rejects duplicate keyIds; validates each keyId; **refuses a `test-`-prefixed keyId when the
environment is `production`** (the environment is passed explicitly — the registry never reads
`process.env`); requires `purpose` to be exactly `core-to-jarvis-event`; parses
`publicKeySpkiDerBase64` as canonical Base64 and constructs an SPKI DER public key with
`node:crypto`, **rejecting a private key, malformed DER, or a non-Ed25519 key**; validates the
timestamps and requires `validFrom < validUntil`.

**The canonical-SPKI-DER control (precise).** `createPublicKey` accepting the decoded bytes is
**not** sufficient, because Node silently ignores bytes trailing a structurally valid SPKI DER.
The registry therefore enforces, in order, every one of the following on
`publicKeySpkiDerBase64`:

1. it must be a **primitive string** (a boxed `String`, number, or any non-string is rejected —
   the field is read from its own enumerable data descriptor, never coerced);
2. its length is bounded to **at most 128 ASCII characters** _before_ any Base64 decoding, so an
   over-long value is refused without allocating a large buffer (canonical Ed25519 SPKI is ~60
   characters);
3. the Base64 must be **canonical and correctly padded** — decode-then-re-encode must reproduce
   the input exactly; non-canonical alphabet, whitespace, or padding is rejected;
4. the decoded bytes must **parse as an Ed25519 public SPKI DER key** via `createPublicKey({
format: 'der', type: 'spki' })`, and the resulting `KeyObject` must be `type === 'public'`
   and `asymmetricKeyType === 'ed25519'`;
5. the parsed key is then **re-exported** with `publicKey.export({ format: 'der', type: 'spki' })`
   and the re-exported DER must equal the originally supplied decoded bytes **byte-for-byte**
   (`Buffer.equals`);
6. consequently, **valid DER followed by any trailing bytes is rejected** by the round-trip in
   step 5, even though step 4 alone would have accepted it. **Canonical Base64 alone is not
   sufficient; canonical SPKI DER is required.**

What it stores and returns is an **immutable snapshot** — a frozen entry holding the constructed
key and **primitive epoch-millisecond** validity bounds. It retains no caller-owned `Date` or
record object, so **mutating the caller's records after construction cannot change what the
registry does**. Errors reference a record by index and never include key bytes or a full
untrusted keyId. The registry is synchronous and reads no environment, filesystem, or network.

**Bounds, validity, and freshness:**

- **Raw body:** at most **262,144 bytes**, checked first — before the envelope is touched or
  the body hashed.
- **Key validity:** `validFrom <= signedAt < validUntil`. Keys are looked up **by `keyId`**,
  never by trying each until one works.
- **Freshness:** `now - window <= signedAt <= now + window`, with `now` **injected**.
  The window defaults to **five minutes** and is configurable within **[1 second, 1 hour]**.
  An out-of-range window is a caller error and throws; it is not an event rejection.

### 5. The verification order is the contract

The verifier runs these steps in this order and returns on the **first** failure:

1. raw-body size → `body-too-large`
2. envelope shape → `signature-missing` · `signature-malformed`
3. algorithm → `unsupported-algorithm`
4. `signedAt` format → `signed-at-malformed`
5. key lookup → `unknown-key-id`
6. key status → `key-revoked`
7. key validity → `key-not-yet-valid` · `key-expired`
8. freshness → `replay-window-expired` · `replay-window-future`
9. compute `sha256(rawBody)`
10. compare to the claimed `bodyDigest`, constant-time → `body-digest-mismatch`
11. build the signing input **from the computed digest**
12. decode the signature — its 88-char canonical 64-byte shape was already proven at step 2, so this cannot fail
13. verify Ed25519 → `signature-invalid`
14. return a bounded, safe result

Cheap and safe first: an oversized or malformed input is refused without a hash or an
Ed25519 verification, and a forged-but-stale event is reported as stale. The result carries
only safe metadata (`keyId`, `signedAt`, computed digest) — never the body, the signature
bytes, or key material, because a verifier that refuses a payload must not then log it
([ADR-0026](./ADR-0026-canonical-payload-privacy-boundary.md), security-principles §5).

### 6. The thirteen reason codes

`body-too-large` · `signature-missing` · `signature-malformed` · `unsupported-algorithm` ·
`signed-at-malformed` · `unknown-key-id` · `key-revoked` · `key-not-yet-valid` ·
`key-expired` · `replay-window-expired` · `replay-window-future` · `body-digest-mismatch` ·
`signature-invalid`.

Stable, countable tokens. ADR-0020 §11's remaining codes — `contract-validation-failed`,
`unknown-event-type`, `unknown-event-version`, `duplicate-conflict` — are **Stage 3.3**,
because they describe failures of parsing and idempotency, which Stage 3.2 does not perform.

### 7. Purity is enforced, not merely asserted

The verifier reads no clock, no environment, no filesystem, and no network; its only runtime
is `node:crypto`. This is enforced by an ESLint boundary on the package's non-test source
(`no-console`, no `process`/`fetch`, no `Date.now`, no I/O node builtins), so the claim is a
rule rather than a comment.

The **production private key does not exist** in this repository — Jarvis verifies with
public keys and never signs (ADR-0020 §1). The deterministic keys the tests use to stand in
for Core are **test-only**: they live under `src/tests/`, which the package's **emitting**
build (`tsconfig.build.json`) excludes, so no key material is emitted to `dist/` or exported
from the barrel.

**Both guards of ADR-0020 §6 are Stage 3.2 controls, and both live here now.** The
package-manager-enforced structural guard is the test material never reaching `dist/`. The
environment guard is the registry's **explicit-environment, `test-`-prefix rejection**: a
`test-` keyId cannot load when the registry is constructed for `production`. This is **not**
deferred to Stage 3.3 — it is a property of the Stage 3.2 registry, which takes its environment
as an explicit argument and reads no `process.env`. A build-time containment check
(`scripts/check-dist-containment.mjs`, run after `build` inside `pnpm check`) additionally
proves, against the emitted `dist/`, that no test file or test-key material is present and that
the barrel exposes only the approved surface.

### 8. Tests are excluded from `dist`, but still type-checked by the gate

Keeping test-only key material out of `dist` must not mean tests escape type checking. The
package therefore carries two configs:

- **`tsconfig.build.json`** — the emitting build the root solution references. It excludes
  `src/tests`, so `dist/` is production-only.
- **`tsconfig.json`** — a **no-emit** config that type-checks _everything_, production and
  tests, under the full strict flag set. It is what the ESLint type-aware service resolves,
  and what the package's `typecheck:tests` script (`tsc --noEmit -p tsconfig.json`) runs.

The root `pnpm typecheck` ends with `pnpm --recursive --if-present run typecheck:tests`, so
the standard gate — `pnpm typecheck`, and therefore `pnpm check` and CI — type-checks the
test files **automatically**, with no manual step, no weakened strictness, no suppression,
and nothing emitted merely to type-check it. Tests are held to the same rules as the code
they cover; the only thing they are denied is a place in the shipped artifact.

## The 3.2 / 3.3 boundary, explicitly

| Concern                                              | Stage    | Here in 3.2? |
| ---------------------------------------------------- | -------- | ------------ |
| Ed25519 signature verification                       | 3.2      | ✅           |
| Public-key registry, rotation, statuses              | 3.2      | ✅           |
| Freshness / replay window                            | 3.2      | ✅           |
| Raw-body digest binding                              | 3.2      | ✅           |
| Contract parsing / validation                        | 3.3      | ❌           |
| `ingest()` function                                  | 3.3      | ❌           |
| Event persistence / the event log write              | 3.3      | ❌           |
| eventId idempotency, benign vs conflicting duplicate | 3.3      | ❌           |
| `ingestion_rejection` / `event_conflict` storage     | 3.3      | ❌           |
| Dead letters, replay, projections                    | 3.4–3.5  | ❌           |
| HTTP endpoint, worker loop                           | 3.x / 11 | ❌           |

The `0001_event_log.sql` comment that the signature columns are "populated by Stage 3.2"
refers to the signature _evidence_ an accepted event carries; the **write itself is the
Stage 3.3 ingest**, which calls this verifier and then persists. Stage 3.2 produces the
verification result; it does not persist it.

## Consequences

**Positive.** Signature verification ships and is provable against fixtures now, without a
database and without waiting on Core. It is a pure unit, so its security properties are
tested directly. `apps/api` and `apps/worker` stay empty; nothing imports the package yet.

**Negative — accepted.** A second ingestion-related package now exists holding one function;
it will earn its size across Stages 3.3–3.7. Splitting ADR-0020's design across 3.2 and 3.3
means two review surfaces for one decision — accepted, because a smaller, pure first slice is
easier to get right than the whole ingest path at once.

## Alternatives rejected

**Put the verifier in `event-backbone`.** Rejected: it would force that package to depend on
more than `pg` and blur a boundary the repository draws deliberately.

**Build `ingest()` now (fold 3.2 and 3.3 together).** Rejected: it would couple pure
verification to persistence and idempotency, none of which 3.2's exit criteria need, and it
would put a database on the path of a unit that does not require one.

**Construct the signing input from the envelope's `bodyDigest`.** Rejected, firmly: it lets
the signature commit to an attacker-chosen digest rather than the real body. The verifier
computes its own digest and only compares the claim to it.

**Trust keys by trying each until one verifies.** Rejected: it turns the verifier into an
oracle for probing candidate keys. Lookup is by `keyId`.
