# ADR-0092 — JRW-0B Governed WEB Runtime Channel (contract-only)

**Status:** Accepted — JRW-0B. Contract-only; no transport, no endpoint, no memory, no live Riya.
**Deciders:** Owner
**Relates to:** [ADR-0054](./ADR-0054-qfj-m1-agent-and-conversation-runtime-foundation.md) · [ADR-0055](./ADR-0055-qfj-m2-core-decision-and-reply-orchestration.md) · [ADR-0067](./ADR-0067-riya-client-sales-behaviour-boundary.md) · [ADR-0073](./ADR-0073-authoritative-prompt-binding.md) · [ADR-0014](./ADR-0014-governed-lifecycle-contracts.md)

## Context

The JRW-0A audit established what "Riya" actually is in merged `main`: a **pure behaviour package**
(`@qf-jarvis/riya-agent` — no runtime, no memory, no transport, no persistence) composed by one
runtime kernel (`@qf-jarvis/agent-runtime`) behind one composition root
(`@qf-jarvis/jarvis-runtime`).

It also established the fact this slice rests on. `channel` was carried on the inbound envelope and
**never branched on** — a repository-wide scan of non-test production source found the only
occurrence of `'WHATSAPP'` or `'INTERNAL'` to be the enum declaration itself. Riya's behaviour
kernel, the router, the privacy gate, the reply plan, the reply validator and the Core adapter are
already channel-blind.

So adding a web surface does not require a second Riya. It requires a vocabulary member and a
promise that nothing starts branching on it.

## Decision

### 1. WEB exists only in `RUNTIME_CHANNELS`

```
RUNTIME_CHANNELS = ['WHATSAPP', 'INTERNAL', 'WEB']
```

One spelling, uppercase, deterministic order. No `web`, `WEBSITE`, `BROWSER`, `WEB_CHAT`, `HTTP` or
`QUICKFURNO_WEB` alias — two spellings of one surface would let two envelopes describe the same
thing and compare unequal, and every downstream lock would then have to know both.

### 2. `COMMUNICATION_CHANNELS` remains closed, and this is the load-bearing separation

`@qf-jarvis/contracts` owns a **different** vocabulary — `['whatsapp','sms','email','voice']` — for
the channels a governed **outbound communication request** may be delivered on, by n8n → QF
Communications Runtime → provider → recipient.

Every member of that set is somewhere a provider can **deliver to**. A browser is not: nobody can
push an outbound message to a closed tab. A `web` member there would let a `CommunicationRequestV1`
request delivery through a chain that does not exist, and would pull a web turn into the
eighteen-state lifecycle's `provider-accepted` and `delivered` — states that could then only be
asserted by inventing them, which is exactly the false statement about the world this architecture
exists to prevent.

A spec in `@qf-jarvis/contracts` asserts the refusal in every casing, and asserts that a
communication record naming `web` fails to parse. The prose is not trusted to hold the line.

### 3. WEB does not imply a provider

`INTERNAL` already proved a runtime channel need not have one. `providerMessageRef` stays an opaque
bounded string, so a web turn carries a web-turn reference without naming a provider, a URL, a
cookie or a session.

### 4. Same Riya, stated technically

WEB Riya and WhatsApp Riya are the **same governed capability**:

|                    |                                                                         |
| ------------------ | ----------------------------------------------------------------------- |
| Behaviour kernel   | **same** — one `decideRiyaTurn`                                         |
| Agent identity     | **same** — actor `RIYA`, party `CLIENT`                                 |
| Model policy       | **same** gateway, privacy routing and budgets                           |
| Prompt identity    | **same** rules — resolved per agent SCOPE, never per channel (ADR-0073) |
| Governed knowledge | **same** exact-retrieval path                                           |
| Proposal authority | **same** — always `PENDING_CORE_VALIDATION`                             |

It does **not** mean the same transport envelope, automatically the same `conversationId`, or
automatically the same customer identity. Web and WhatsApp remain separate threads until an explicit
Core-authorized link exists.

Specs prove equivalence at the **governed decision layer** — assigned actor, proposal kind, authority
status, party type, citations, Core outcome, and the observability sequence — while deliberately
allowing ids and instants to differ. Requiring byte-identical output would be testing the fixtures.

### 5. The runtime stays channel-blind, and that is now enforced

A containment spec scans production source of `agent-runtime`, `riya-agent` and `jarvis-runtime` for
`channel ===`, `channel !==`, `switch (channel)`, `case 'WEB'` and channel-literal mentions, with the
vocabulary declaration line excluded so the closed set is not reported as its own violation. A
positive control proves the scan fires, and a second assertion proves the exclusion is not silently
swallowing everything.

If WEB ever needs its own branch, that test fails first and the decision becomes a reviewed one
instead of a quiet one.

There is no WEB-only prompt family, model policy, knowledge path or runtime, and specs name each
absence.

### 6. A channel is a context, not an authority

`channel` says where a turn arrived from. What may be done with it is decided elsewhere, on the
conversation: `humanTakeover`, `aiPaused`, `cancelled`, `dataClass`, `partyType` and subject status.
Specs prove a WEB turn is refused under each gate **with the same reason as WhatsApp** and reaches
neither the model nor Core. There is no separate web safety store and no bypass around
`ConversationContextPort`.

### 7. No transport, no endpoint, no direct browser → Jarvis

This slice adds no HTTP server, route, client, webhook, WebSocket, SSE, credential or deployment.
`apps/api` still exports `{}` and runs no server; the only HTTP routes in the repository remain the
three operator-plane routes in `apps/jarvis-os`, and a spec pins that list exactly.

The locked topology is:

```
browser → QuickFurno web/server boundary → private Jarvis web conversation service → same Riya runtime
```

**Direct browser → Jarvis is forbidden.** Jarvis OS is the operator control plane, not a public
visitor API, and QuickFurno Core must not become a generic chat proxy. The Jarvis web conversation
service does not exist yet and is not created here.

### 8. The first web integration is NON-STREAMING

`ModelReplyPort.draftReply` returns one whole candidate, which `validateReplyDraft` then parses
strictly **and checks citation by citation** against the plan's permitted set. A fabricated or
versionless citation is refused there.

Streaming would bypass that gate — a partial token stream cannot be citation-validated — so the
first integration streams nothing. The UI may show a typing or thinking state; that is a UI
affordance, not a transport claim.

### 9. Ownership, and the supersession of RWC-P0B §39

| Owner                     | Owns                                                                                                                                                                                                                                                                                                      |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Jarvis**                | conversation phase · structured requirement draft · need-discovery progress · conversational field provenance · bounded conversation summary/context · same-Riya short-term conversational memory                                                                                                         |
| **QuickFurno web/server** | opaque browser conversation/session token · same-origin · CSRF · abuse and rate limiting · message-size limit · per-turn idempotency · one in-flight turn per web conversation · token → Jarvis routing mapping · keeping Jarvis private from the browser                                                 |
| **QuickFurno Core**       | consent, opt-out, suppression · customer and contact identity · city/service catalogue validity · vendor availability · package and pricing truth · lead creation · lead assignment and vendor matching · preferred-vendor state · business `canSubmit` · canonical submission result and its idempotency |

**RWC-P0B §39 is superseded on ownership.** It assigned the structured requirement draft, conversation
phase and field provenance to the QuickFurno server session; they belong to Jarvis. The QuickFurno
gateway owns the opaque token and its mapping — and nothing else. Consent, business `canSubmit` and
canonical submission idempotency belong to Core and the governed submission boundary.

Jarvis may collect, summarize, recommend and ask a user to confirm. **Jarvis must never convert
conversational state into business truth.**

### 10. The conversational memory layer does not exist, and is not built here

JRW-0A proved it: there is no message history, transcript, summary or context compaction anywhere.
`qf_jarvis.conversation_runtime_state` holds seven gating columns and a revision — no text — and the
governed contracts refuse transcripts by key and by value shape.

This ADR records **ownership only**. JRW-0B adds no transcript table, message history, summary,
memory package, vector store, embedding, enabled RAG, browser `localStorage`, QuickFurno memory
database, session persistence or migration. A spec asserts those absences. The continuity layer is a
separate, separately authorized slice.

### 11. Standing state

- **RWC-P1D, RWC-P1E, RWC-P1F remain PARKED.** Nothing here revives a duplicate QuickFurno backend.
- **RUI-3A has not started.** `lib/riya-ui/jarvisClient.ts` does not exist and is not created; a spec
  scans the repository for it and for any QuickFurno adapter.
- **Live Riya remains OFF.** The production model gateway composition is born OFF and structurally
  non-activatable; RAG is `PROVISIONED_NO_OP`.
- **QFJ-P09 is a separate governance track.** This slice defines no QFJ-P09.04 and does not
  repurpose itself as an execution-gateway phase.

## Consequences

- Migrations remain `0001`–`0010`; **no `0011`**, no migration, managed database untouched.
- `agent-runtime`'s public surface is unchanged at 46 runtime exports; `RUNTIME_CHANNELS` gained a
  member, not a symbol.
- Nothing in the repository consumes the WEB channel. It is a legal value with no producer — which is
  the intended end state of a contract-only slice.
- The next slice needs the two things this one deliberately did not build: a private Jarvis web
  conversation service, and the Jarvis conversational continuity layer.

## What this does NOT implement

HTTP transport · public endpoint · QuickFurno adapter or browser client · web session token ·
conversation service · conversational memory · persistence · streaming · City Context · lead
creation · consent mutation · n8n or provider delivery · live Riya.

## Change-control rule

Adding `web` to `COMMUNICATION_CHANNELS`, introducing any channel branch in the behaviour layer,
adding a WEB-only prompt family, model policy or knowledge path, exposing a public Jarvis endpoint,
permitting direct browser → Jarvis, or streaming raw model output each require a superseding ADR. So
does moving conversation phase, the requirement draft or conversational provenance out of Jarvis, or
moving consent, lead, city or vendor authority into it.
