# ADR-0020 — Event Ingestion, Signature Verification, and Idempotency

**Status:** Accepted
**Date:** 2026-07-12
**Deciders:** Keshav Sharma (Founder, QuickFurno — business owner)

---

## Context

[Trust boundary B1](../architecture/trust-boundaries.md) — QuickFurno Core → QF Jarvis — requires three things at once, and they defend against three different attacks:

| Mechanism             | Answers                                                      | Prevents                       |
| --------------------- | ------------------------------------------------------------ | ------------------------------ |
| **Signature**         | Did this really come from Core? Was it altered?              | Forgery, tampering             |
| **Replay protection** | Have I seen this before, or is it too old to still be valid? | Replay attacks, stale messages |
| **Idempotency**       | If I process it twice, does it happen twice?                 | Duplicate effects              |

_"A system with signatures but no idempotency will double-charge a vendor on a network retry. A system with idempotency but no signatures will faithfully execute a forgery exactly once."_

Phase 2 already refuses an unknown event type or version, and its registry has no `register()` and no v1 fallback. What Phase 3 adds is everything _in front of_ that parser — and one rule _behind_ it that Phase 2 could not enforce: **what happens when the same event arrives twice with different contents.**

## Decision

**Ed25519 asymmetric signatures over the exact raw bytes. `eventId` is the idempotency identity. A conflicting duplicate fails closed. Ingestion is a function, not an endpoint.**

### 1. Ed25519, and the asymmetry is the entire point

An HMAC shared secret would be simpler. It is also wrong here, and the reason is the architecture's own containment argument.

With a shared secret, **Jarvis would hold a key capable of forging Core's events.** A compromised Jarvis could manufacture its own input stream. With Ed25519, **Jarvis holds only Core's public key and cannot forge an event even if fully compromised.**

That is not a marginal improvement. It is the same property the whole boundary rests on — _"the worst a compromised Jarvis can do is ask"_ ([trust-boundaries.md](../architecture/trust-boundaries.md) B3) — extended to the input side. It costs nothing, `node:crypto` implements it natively, and it removes a forgery capability we would otherwise have had to trust ourselves not to misuse.

Signing keys between Core→Jarvis, Jarvis→Core, and Core→n8n remain **distinct** ([security-principles.md](../governance/security-principles.md) §7).

### 2. Sign the exact bytes. Do not canonicalise.

```
signingInput = "qf-jarvis-event-v1" ‖ "\n" ‖ keyId ‖ "\n" ‖ signedAt ‖ "\n" ‖ hex(sha256(rawBody))
```

The signature is verified against **the bytes as received, before anything parses them.**

JSON canonicalisation (JCS, RFC 8785) was considered and rejected. It has real edge cases around number formatting and Unicode normalisation, and every one of them is a place where the signer and the verifier can disagree about what was signed. **Signing raw bytes makes canonicalisation unnecessary**, which makes the whole class of bug unreachable.

The `"qf-jarvis-event-v1"` prefix is **domain separation**: it prevents a signature produced for one boundary from being replayed as valid on another.

**Envelope:**

```
{ algorithm: 'ed25519', keyId, signedAt, bodyDigest: 'sha256:<hex>', signature }
```

### 3. Freshness reads a clock. Contract validation must not.

Phase 2 _tests_ that contract validation reads no clock — the same intent parses at simulated 2030 and simulated 2000, because **"an event that was valid when it was emitted must not become invalid because it was replayed tomorrow"** ([ADR-0003](./ADR-0003-event-driven-integration.md)).

Signature freshness is the opposite: it exists precisely to reject something _because of when it arrived_.

These are different layers and must stay that way:

- **`verifySignature(rawBody, envelope, now)` takes `now` as an injected parameter.** It is a pure function. It reads no clock itself.
- The ingestion caller supplies `now` from a clock port.
- **Contract validation never sees a clock at all.**

Without this discipline, the tested Phase 2 property dies quietly the first time someone reaches for `Date.now()` inside a validator.

**Replay window:** `signedAt` must fall within ±5 minutes of the injected `now` (configurable).

### 4. Replay of a stored event does **not** re-verify freshness

This is the rule most likely to be got wrong, and getting it wrong makes replay impossible.

An accepted event was verified **once, at acceptance**. Replaying it from the store — whether a dead-letter replay or a full projection rebuild — **does not re-check the signature and does not re-check the freshness window.** A six-month-old event replayed during a rebuild is _supposed_ to be six months old.

`trust-boundaries.md` B1 draws exactly this line: _"A legitimate operational replay is a distinct, authorized operation — not an accident of redelivery."_

### 5. Key registry: public keys only, rotation without a deploy

[security-principles.md](../governance/security-principles.md) §7 requires rotation **without downtime and without a code change** — _"a rotation procedure that requires a deploy is a rotation procedure that will be skipped under pressure."_

So the registry holds **public keys only**, loaded from a configuration path, never compiled in and never committed. Keys carry a status and a validity window:

```
active  →  retiring (still verifies, no longer signs)  →  revoked
```

Rotation is an overlap: add the new key, let both verify, retire the old one. **No deploy. No downtime.**

Keys are looked up **by `keyId`**. The verifier never guesses which key might work — trying keys until one succeeds is how an attacker gets to test candidate keys.

### 6. Test keys are structurally rejected in production

Test private keys exist only as **explicitly test-only fixtures**. Two independent guards:

- The registry **refuses to load any key whose `keyId` is `test-`-prefixed when `QF_JARVIS_ENV=production`.**
- The test emitter ([ADR-0021](./ADR-0021-processing-retries-dead-letters-and-replay.md)) throws at module load in production, and lives in a package **no application declares as a dependency** — so under pnpm's isolated `node_modules`, an application literally cannot resolve it.

The second guard is the stronger one: it is enforced by the package manager, not by discipline.

### 7. Idempotency: `eventId`, and nothing else

Phase 2 already declares `eventId` _"the event's idempotency key."_ Phase 3 makes the database enforce it:

```sql
INSERT INTO event (...) ON CONFLICT (event_id) DO NOTHING RETURNING sequence;
```

An empty result means we have seen this `eventId` before.

**Identity is `eventId` alone — not `(eventId, eventVersion)`.** The same `eventId` arriving with a different type or version is _one event contradicting itself_, not two events.

### 8. A conflicting duplicate fails closed

> **Note (2026-07-18, [ADR-0031](./ADR-0031-stage-3-3-3-rejection-and-conflict-storage.md)) — §8 narrowed on payload storage.** The sentence below, _"Conflicting payloads are stored,"_ is **narrowed by ADR-0031**: Stage 3.3.3 stores **no** conflicting payload and no rejected payload. `qf_jarvis.event_conflict` stores the refused delivery's `semantic_event_digest` and `body_digest` (one-way hashes), its validated `correlation_id`, and bounded signature evidence (algorithm, key id, signed-at) — never the payload or the signature bytes. The original accepted event is unchanged in `qf_jarvis.event` and its digest is obtained by join, not copied. The reason is the still-closed retention gate ([ADR-0019](./ADR-0019-durable-event-store-and-persistence.md) §7): a canonical payload carries pseudonymous identifiers that are personal data, and keeping a copy of a **refused** one is exactly the question the gate exists to answer. The rest of §8 — first acceptance wins permanently, semantic comparison, recorded/counted/alertable — stands unchanged. The original wording is preserved below for history.

| Case                                           | Outcome                                                                                                                          |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Same `eventId`, **same** semantic content      | **Benign duplicate.** Counted. The existing sequence is returned. **Nothing reprocesses.** Redelivery is normal, not exceptional |
| Same `eventId`, **different** semantic content | **CONFLICT. Refused.** Recorded in `event_conflict`, counted, alertable. **The originally accepted event stands, unmodified**    |

**No duplicate conflict may silently overwrite an accepted event.** The first acceptance wins, permanently.

The reason is that a conflicting duplicate is never routine. It means one of: Core has a bug and reused an identifier; something in transit mutated a payload; or somebody is attacking us. **None of those three is a thing to resolve by picking a winner**, and "last write wins" would pick the attacker's.

**Semantic comparison, not byte comparison.** The digest is taken over the **canonical JSON of the parsed, validated event** — deterministic key order — so a byte-level difference that means the same thing is _not_ a false conflict. The raw-body digest is retained separately, as evidence.

**Conflicting payloads are stored.** They passed contract validation, so they are bounded and governed by construction — they cannot contain a credential, a contact detail, or a transcript — and forensics needs to see what arrived.

### 9. Rejection and dead-lettering are different things

|                 | **Rejection** (boundary)                                                         | **Dead letter** (processing)                   |
| --------------- | -------------------------------------------------------------------------------- | ---------------------------------------------- |
| What failed     | Signature, freshness, contract validation, unknown type or version               | A projection handler, on an **accepted** event |
| Stored as       | `ingestion_rejection` — reason code and structured issues, **never the payload** | `dead_letter`, referencing the stored event    |
| **Replayable?** | **No.** There is nothing valid to replay                                         | **Yes.** The event is in the log               |

A rejected event **never enters the store**. Replaying an invalid event would be replaying garbage.

Rejection records carry a reason code, the key id, the body digest, and Phase 2's structured `ContractIssue[]` — which by design carry **path, code, and message, and never the offending value**. _"The validator that refuses a secret must not then record it."_

### 10. Ingestion is a function, not an endpoint

```ts
ingest(rawBody: Uint8Array, envelope: SignatureEnvelope, now: Date): Promise<IngestResult>
```

**Phase 3 adds no HTTP server.** No exit criterion requires one; the only event source is a local, in-process, fixture-driven test emitter. Standing up a listener, a framework, TLS, and authentication for a consumer that does not exist would be attack surface with no user.

`apps/api` therefore **remains a compileable boundary**. Phase 11 wraps this function in an HTTP webhook when Core actually emits — and because ingestion is a package, `apps/api` can call it then without a refactor ([ADR-0010](./ADR-0010-workspace-and-module-structure.md) §4: _apps may never depend on apps_).

### 11. Failure reason codes

`signature-missing` · `signature-malformed` · `unknown-key-id` · `key-revoked` · `key-not-yet-valid` · `signature-invalid` · `body-digest-mismatch` · `signed-at-malformed` · `replay-window-expired` · `replay-window-future` · `contract-validation-failed` · `unknown-event-type` · `unknown-event-version` · `duplicate-conflict`

Stable, countable machine tokens. A reason that cannot be counted cannot be governed.

## Consequences

**Positive.**

- **A compromised Jarvis cannot forge its own input.** It holds no signing key for the Core→Jarvis boundary.
- **Duplicate delivery is harmless**, and it is proven by deliberately redelivering — an exit criterion, not a hope.
- **A conflicting duplicate is loud, contained, and non-destructive.**
- **Replay works**, because freshness is checked once and never again.
- **Key rotation needs no deploy.**
- **No HTTP attack surface**, because there is no HTTP.

**Negative — accepted.**

- **Ed25519 requires Core to sign.** Core must eventually hold a private key and sign its events — real work, concentrated in Phase 11 exactly as ADR-0003 intended.
- **A ±5-minute window needs roughly-synchronised clocks** between Core and Jarvis. Standard NTP; the failure mode is a rejected event with a clear reason code, not a silent one.
- **Storing conflicting payloads keeps a copy of something we refused.** Bounded and governed, and worth it: a conflict you cannot inspect is a conflict you cannot diagnose.

## Alternatives rejected

**HMAC-SHA256 with a shared secret.** Simpler, and it hands Jarvis the ability to forge Core's events. Rejected on §1.

**Canonical JSON (JCS) signing.** Rejected: number and Unicode edge cases are exactly where signer and verifier silently disagree. Signing raw bytes makes the whole class unreachable.

**Verifying by trying every key until one works.** Rejected. It turns the verifier into an oracle an attacker can use to test candidate keys. Keys are looked up by `keyId`.

**Re-verifying freshness on replay.** Rejected — it makes replay impossible, which is the capability the phase exists to deliver.

**Identity as `(eventId, eventVersion)`.** Rejected. It would let the same `eventId` exist twice under different versions, which is a contradiction, not two facts.

**Last-write-wins on a conflicting duplicate.** Rejected, firmly. A conflict means a bug, corruption, or an attack — and "last write wins" resolves all three in the attacker's favour.

**Rejecting a benign duplicate as an error.** Rejected. Redelivery is _normal_; at-least-once is the only delivery that exists ([engineering-principles.md](../governance/engineering-principles.md) §8). Treating it as an error would make the system alarm constantly and train everyone to ignore it.

**An HTTP ingestion endpoint in Phase 3.** Rejected. No exit criterion needs it, and it is attack surface with no consumer. It belongs to Phase 11, with a real emitter on the other end.
