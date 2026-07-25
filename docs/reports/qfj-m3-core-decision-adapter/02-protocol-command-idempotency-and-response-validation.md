# Report 02 — Protocol, Command, Idempotency, and Response Validation

**Slice:** QFJ-M3. **ADR sections:** [ADR-0056](../../decisions/ADR-0056-qfj-m3-quickfurno-core-decision-adapter-foundation.md) §C, §D, §E, §G, §H.

## The proposed protocol identity (§C)

`CoreDecisionProtocol = { name, version, contractDigest }`, validated by a **strict** zod schema: `name` is a bounded identifier, `version` a positive int, `contractDigest` an 8–64 hex string. The default is `DEFAULT_CORE_DECISION_PROTOCOL = { name: 'qfj.core.decision', version: 1, contractDigest: 'c0de0001' }`. There is **no wildcard and no `latest`** — a `name` of `*` fails the schema, so a command built with it throws `CoreAdapterError('invalid-command')`. Every command and every response **binds** the exact protocol name/version/contract-digest, so a protocol drift fails closed.

## The versioned, immutable command (§D)

`buildCoreCommand({ request, protocol, correlationId, createdAt })` returns a **frozen** `CoreCommand` (its nested protocol, structured intent, and citations are frozen too). It binds `commandId = ${conversationId}-${proposalId}-r${expectedRevision}`, the idempotency key, the correlation id, and the exact proposal/conversation/revision/actor/party/kind/policy identity. It is **rejected** (throws `invalid-command`) when the protocol is invalid, when `createdAt` is not a canonical UTC ISO-8601 instant, or when `correlationId` is not a bounded identifier. A **reply body is present only for a `REPLY`** proposal; for any other kind it is `undefined`. The command carries **no** chain-of-thought, raw provider body/header, SDK object, secret, callback, n8n command, delivery mutation, or DB handle — proven by scanning the serialized wire form for `reasoning`, `chainOfThought`, `sk-`, `apiKey`, `__proto__`, `rawResponse`.

## Deterministic idempotency (§G)

The idempotency key is `contentDigest(...)` — a pure, dependency-free **FNV-1a** hash over canonically key-ordered JSON of `{ protocolName, protocolVersion, contractDigest, proposalId, proposalVersion, conversationId, expectedRevision }`. It uses **no `node:crypto`** and reads **no wall clock**. Properties proven:

- **Deterministic** — the same identity yields the same key across calls.
- **Revision-sensitive** — a changed `expectedRevision` changes the key (a resubmission at a new revision is a new command).
- **Version-sensitive** — a changed `proposalVersion` changes the key.
- **Protocol-sensitive** — a changed protocol version changes the key.
- **Embedded** — the key `buildCoreCommand` embeds equals `idempotencyKeyFor` of the same identity.

Canonical instants are validated by `isCanonicalInstant` against a fixed `YYYY-MM-DDThh:mm:ss(.sss)?Z` shape that must also parse to a real calendar time — again with **no wall-clock read** (the clock is injected).

## Strict response validation (§E, §H)

`validateResponse(serialized, command)`:

1. **Parses** the serialized response in a `try/catch`; any parse failure → `adapter-response-invalid`.
2. Validates it against a **strict** `coreCommandResponseSchema` (closed `outcome` enum, hex idempotency key, bounded identifiers, canonical `decidedAt`); any schema failure or **unknown outcome** → `adapter-response-invalid`.
3. Checks the **exact identity** — protocol name/version/contract-digest, command id, idempotency key, proposal id/version, conversation id, and `boundRevision === expectedRevision`; **any** mismatch → `adapter-identity-mismatch`.

Only a fully matching response returns `ok: true` with a **frozen** response object. Consequently an `ACCEPTED` is honoured **only** with the exact command identity; a response echoing the right shape but a wrong proposal/idempotency/revision/protocol is refused and never accepted. The validator **returns no raw error** on any failure path.
