# Report 03 — Structured Output, Citations, State, and Privacy

**Slice:** QFJ-M4. **ADR sections:** [ADR-0057](../../decisions/ADR-0057-qfj-m4-model-gateway-reply-adapter-foundation.md) §E, §G, §H, §J, §M.

## Strict structured output (§G)

The adapter accepts **only** a strict provider-neutral structured reply, validated by a `.strict()` schema with closed draft kinds `REPLY`, `ESCALATE_TO_HUMAN`, `REQUEST_CLARIFICATION`, `NO_ACTION`. A `REPLY` **requires** a bounded reply body; every other kind **must omit** it. The result may carry a bounded reply text, a bounded safe reason code, exact citation references, and (from the gateway) safe provenance and usage counters. Because the schema is strict, **any** extra key fails closed — proven for a chain-of-thought field, a raw provider body (`rawResponse`), a send/execute/Core-acceptance field (`coreOutcome`), an unknown kind, a malformed value, an oversized reply, and a body-less `REPLY`. All map to `model-structured-output-invalid`. The same valid result yields a **deterministic** draft.

## Exact citation authorization (§H)

Every citation the model returns must **exactly** match a plan citation (same `knowledgeId` and `version`). The adapter performs **no** fresh retrieval. A fabricated citation, a superseded/wrong-version citation, or a versionless citation (rejected earlier by the schema) fails closed to `model-citation-mismatch`, and a **mix** of valid and fabricated citations is rejected as a whole — **no** citation is silently dropped to make output pass.

## The pre/post-gateway state gate (§J)

The adapter re-reads a **content-free** `ReplyState` (revision, party, assigned actor, data class, human-takeover / AI-pause / cancellation flags, subject privacy status) through an injected reader:

- **Immediately before** the gateway — a cancellation (`model-cancelled`), a human takeover, an AI pause, a non-`clear` subject status, or a party/assignment/data-class mismatch against the plan (`model-state-blocked`) stops **before any gateway call** (the invoker records zero invocations). `HUMAN_ONLY` reaches no gateway; `LOCAL_ONLY` with a hosted release fails closed (`model-plan-invalid`).
- **Immediately after** the gateway result — a revision drift or a new blocking condition (a late cancellation, a privacy/tombstone change) prevents the draft from returning; the reader is read **twice**.

## Content minimization (§E)

The minimized request carries **only** the versioned prompt system message and the bounded normalized user input — proven to contain exactly two messages and no `subjectRef` / `internalNote` / `phone` / `apiKey` / `token` metadata. Approved exact knowledge references come solely from the M2 plan; the adapter includes no subject reference, credential, internal note, or unrelated conversation history.

## Authority / no-send (§M)

Model output is a **draft/proposal input only**. The detailed result carries the closed kind, a safe reason, the validated M2 `ModelReplyDraft` (present **only** for a `REPLY` that passed every gate), the full structured reply, and safe provenance/usage — and has **no** `coreOutcome`, `accepted`, `sent`, `delivered`, or `executed` field. Neither the adapter nor the draft exposes an `authorize`/`execute`/`send`/`deliver`/`callN8n` method, and both are frozen. The adapter **cannot** create a Core `ACCEPTED`; QuickFurno Core remains the only business authority.
