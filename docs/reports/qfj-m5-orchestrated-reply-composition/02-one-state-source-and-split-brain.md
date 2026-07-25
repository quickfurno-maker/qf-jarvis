# Report 02 — One Authoritative State Source and Split-Brain Prevention

**Slice:** QFJ-M5. **ADR:** [ADR-0059](../../decisions/ADR-0059-qfj-m5-orchestrated-reply-composition-foundation.md) §C, §D.

## The single source

The composition root defines **one** injected async content-free source:

```ts
interface AuthoritativeConversationStatePort {
  read(conversationId: string): Promise<ConversationControlState>;
}
```

`ConversationControlState` carries only safe fields: conversation id, tenant id, revision, party type, data class, the human-takeover / AI-pause / cancellation flags, the subject privacy/tombstone status, an optional **opaque** subject reference, and a canonical observed-at instant. No message/reply/prompt/knowledge content, no PII, no secret.

## Every lower reader delegates to the SAME instance

`composeAndProcess` builds four thin projection adapters, **all closing over the same `source` instance and the same `conversationId`**:

| Lower reader (package)                     | Projection               | Notes                                                                               |
| ------------------------------------------ | ------------------------ | ----------------------------------------------------------------------------------- |
| M2 `ConversationContextPort.read`          | → `OrchestrationContext` | via `createOrchestrationContext` (M2's own validator)                               |
| M4 `ReplyStateReader.read`                 | → `ReplyState`           | `assignedActor` derived with **M1's `assignAgent`** — not a second routing decision |
| M3 `CoreDecisionStateReader.read`          | → `CoreDecisionState`    |                                                                                     |
| M1 `ConversationPrivacyGate.subjectStatus` | → `RuntimeSubjectStatus` | same tombstone truth                                                                |

There is **no module-local competing state authority**: the projections hold no state of their own; they read the one source on every call. A test asserts that after one happy-path run the single `RecordingAuthoritativeState.reads()` counter incremented across the pre-model, post-model, double-gate, pre-Core, and post-Core reads (≥ 4), proving all readers consult one instance.

## No cached state across an awaited boundary

None of the projections cache a `ConversationControlState` across an `await`. Each M3/M4 pre/post gate and the M2 double gate re-reads the source, so a change that lands **while an external Promise is pending** is observed at the next gate and fails closed:

- A **revision bump or human takeover landing during the awaited gateway invocation** is seen by the M4 post-gateway re-read → the draft is blocked → the run is `REFUSED` and **Core is never invoked** (proven with a mutating gateway invoker + a mutable source cell).
- A **cancellation landing during the awaited Core transport send** is seen by the M3 post-response re-read → `STALE_REVISION`, acceptance blocked (proven with a mutating transport + a mutable source cell).

## No business-state reconciliation

The composition root **reconciles nothing**. Incompatible revision/assignment/privacy views simply fail closed through the lower gates; the root never invents a merged state, never upgrades an outcome, and never fabricates a Core `ACCEPTED`. QuickFurno Core remains the sole business authority — the single state source supplies only content-free control truth, not a business decision.
