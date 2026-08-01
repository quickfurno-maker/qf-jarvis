# ADR-0069 — Bounded Runtime and Proposal Identifiers

**Status:** Accepted — bounded post-S3-C repair
**Deciders:** Owner
**Relates to:** [ADR-0054](./ADR-0054-qfj-m1-agent-and-conversation-runtime-foundation.md) · [ADR-0055](./ADR-0055-qfj-m2-core-decision-and-reply-orchestration-foundation.md) · [ADR-0056](./ADR-0056-qfj-m3-quickfurno-core-decision-adapter-foundation.md) · [ADR-0057](./ADR-0057-qfj-m4-model-gateway-reply-adapter-foundation.md) · [ADR-0059](./ADR-0059-qfj-m5-orchestrated-reply-composition-foundation.md) · [ADR-0066](./ADR-0066-shared-agent-runtime-execution-boundary.md) · [ADR-0068](./ADR-0068-riya-authoritative-runtime-composition.md)

## Context

Review of PR #71 surfaced a maximum-length failure and labelled it "the M4 draft's `usageTraceId`".
That label was too small. The real defect is one unbounded value feeding an entire family of bounded
ones.

`InboundEnvelope.conversationId` and `messageId` are each independently allowed to reach **128**
characters. Three layers concatenated a run identifier, and a fourth site appended `-reply` to that
value to derive the proposal identifier:

```
agent-runtime/src/orchestration/orchestrate-inbound.ts   `${envelope.conversationId}-${envelope.messageId}`
agent-runtime/src/orchestration/create-reply-plan.ts     `${context.conversationId}-${envelope.messageId}`
jarvis-runtime/src/composition/process-inbound.ts        `${envelope.conversationId}-${envelope.messageId}`
agent-runtime/src/orchestration/orchestrate-inbound.ts   `${runId}-reply`   (the proposal id)
```

That value can be **257** characters, and every field it reaches is capped at 128 by the same
identifier grammar `^[A-Za-z0-9._:-]{1,128}$`:

| Field                              | Bound | Fed by                                         |
| ---------------------------------- | ----- | ---------------------------------------------- |
| `ModelRequest.runId`               | 128   | `ReplyPlan.runId`                              |
| `ModelReplyDraft.usageTraceId`     | 128   | gateway `response.runId`                       |
| `OrchestrationProposal.proposalId` | 128   | `${runId}-reply`                               |
| `CoreCommandResponse.commandId`    | 256   | `${conversationId}-${proposalId}-r${revision}` |

So a perfectly valid envelope produced an invalid request, and the failure surfaced late — after the
gates and **after the sole model call** — as `orchestration-draft-invalid`. The bug was not that one
field was too small; it was that a derived identifier had no bound of its own while everything
downstream of it did.

Two further facts made the fix obvious. `${runId}-reply` overflows the proposal bound **even after**
the run id is bounded: a 128-character run id plus `-reply` is 134. And `InboundEnvelope.runtimeId`
already existed — caller-supplied, validated, bounded, immutable — and was used nowhere on the
composed path, despite being exactly the identity these fields wanted.

## Decision

### 1. Separate identities stay separate

Seven identities, seven contracts. Collapsing any pair would mean one contract's change silently
rewriting another's meaning. (`runId` is an eighth named field, but not an eighth identity — it is the
downstream carrier of the `runtimeId` value, which is exactly the point of this repair.)

| Identity                   | Source                                      | Bound     | Purpose                          |
| -------------------------- | ------------------------------------------- | --------- | -------------------------------- |
| `runtimeId`                | caller, on the envelope                     | ≤128      | **the canonical run identifier** |
| `conversationId`           | caller                                      | ≤128      | which conversation               |
| `messageId`                | caller                                      | ≤128      | which inbound message            |
| provenance `correlationId` | `messageId` by default (ADR-0068)           | ≤128      | audit correlation                |
| `proposalId`               | derived here                                | 41, fixed | proposal identity                |
| Core `correlationId`       | `JarvisRuntimeConfig.correlationId`         | —         | M3 adapter correlation           |
| `commandId`                | M3, from conversation + proposal + revision | ≤256      | Core command identity            |

### 2. Canonical run identifier

`runId = envelope.runtimeId`, at every composed layer: `orchestrateInbound`, `ReplyPlan.runId`,
`ModelRequest.runId`, the gateway response `runId`, `ModelReplyDraft.usageTraceId` (which is
`response.runId` and therefore becomes bounded without touching the adapter), `JarvisRuntimeResult`,
and M2/M4/M5 observability. There is exactly one run-id source.

Nothing is concatenated, truncated, sliced, hashed, rewritten or randomized; no wall clock, provider
value, `providerMessageRef` or `normalizedText` is read; and no caller override was added, because
`runtimeId` is already the caller's field.

### 3. Bounded proposal identity

A new internal helper, `orchestration/derive-proposal-id.ts`, derives

```
proposal.<32 lowercase hex characters>        // 41 characters, fixed width
```

from the exact tuple that distinguishes one proposal from another: `runtimeId`, `conversationId`,
`messageId`, `expectedRevision`, `proposalVersion`, `proposalKind`. Fixed width is the point — no
combination of caller identifiers can push it past the proposal bound, and it leaves ample room under
the `commandId` limit that prefixes it with a 128-character conversation id: 128 + `-` + 41 + `-r` +
seven revision digits = **179 of 256**.

It is derived only after the second gate, once the proposal kind is settled, because the kind is part
of the identity.

### 4. The digest is identity evidence, not authentication

Canonical JSON with sorted keys, four domain-separated FNV-1a 32-bit words, 32 lowercase hex — the
same dependency-free, `node:crypto`-free pattern the M3 idempotency key already uses, for the same
reason: it must be reproducible from the same tuple in any process. **It is not a security primitive
and must never be relied on as one.** M3's helper lives in `core-decision-adapter`; importing it into
`agent-runtime` would invert the dependency direction, so the few lines are restated rather than
shared.

Only bounded identifiers, two integers and a closed vocabulary value enter the digest. No raw caller
text, provider value, prompt reference, model output or subject data.

### 5. What did not change

The call graph is untouched: `createJarvisRuntime → composeAndProcess → createOrchestrator →
runAgentTurn → orchestrateInbound` exactly once. No change to gates, model-call count, Core
authority, `PENDING_CORE_VALIDATION`, proposal kinds, `FOLLOW_UP`, Riya disposition mapping, the
behaviour seam, provenance semantics, reply-body rules, or the persistence/execution boundary. The
model-reply adapter and Core adapter needed **no production change** — their fields became valid the
moment the run id did.

No new public API: `deriveProposalId` is internal and is exported from neither
`orchestration/index.ts` nor the package root. `agent-runtime` stays at 45 root runtime symbols, and
every other package lock is unchanged.

### 6. One deliberate visible contract change

`JarvisRuntimeResult.runId` changes from `conversationId-messageId` to `runtimeId`. This is a
corrective alignment, not a feature. No alias field and no legacy fallback remain, and the exact
assertions that encoded the old shape were updated rather than weakened.

## Rejected alternatives

- **Fix `usageTraceId` alone.** It is one symptom of four; the proposal id and `commandId` would still
  overflow.
- **Truncate or hash the concatenation.** Truncation loses identity and invites collisions; silently
  rewriting a caller's identifier is the failure mode the opaque-reference grammar exists to prevent.
- **Raise the downstream bounds.** That would widen contracts across three packages to accommodate a
  composition mistake.
- **Generate a UUID.** Non-deterministic, so idempotency and replay would break; and it needs a
  randomness source the runtime deliberately does not have.
- **Reuse the M3 digest helper by importing it.** Inverts the dependency direction.

## Consequences

A maximum-length envelope now completes a served turn end to end — model-backed and no-model alike —
with a bounded run id, a bounded proposal id, a bounded `commandId`, and provenance intact. Migrations,
dependencies, the lockfile, deployment and activation are all unaffected.

## Phase status

**S3-C remains complete.** This is a post-merge boundary repair, not a new phase and not part of it.
**S3-D (Anisha) remains deferred** until this repair is merged. Production rollout stays OFF; nothing
here activates a provider, a mode or a deployment.

## Change-control rule

A derived identifier must carry its own bound. Deriving one by concatenating caller-supplied values
requires an ADR amendment, and any new derived identity must be fixed-width or provably shorter than
the smallest field it reaches. The seven identities above stay distinct.
