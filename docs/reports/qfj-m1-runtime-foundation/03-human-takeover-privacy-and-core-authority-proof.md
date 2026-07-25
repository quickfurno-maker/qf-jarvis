# Report 03 — Human Takeover, Privacy, and Core-Authority Proof

**Slice:** QFJ-M1 — Agent and Conversation Runtime Foundation. **ADR:** [ADR-0054](../../decisions/ADR-0054-qfj-m1-agent-and-conversation-runtime-foundation.md).

## Human takeover / AI pause — before any model call

`processInbound` decides reply eligibility **before** it would ever hand off to a model, and it **never calls the injected model interface** in this slice (the test interface's `draftReply` throws if invoked — the passing tests prove it is not). Proven:

- **HUMAN_TAKEOVER** → `aiEligible: false`, reason `runtime-human-takeover`, **no REPLY proposal** (an escalation proposal instead).
- **AI pause** → `aiEligible: false`, reason `runtime-ai-paused` (fail closed), no REPLY proposal.
- Return-to-AI requires an explicit authorized transition (Report 02); there is no automatic release.

## Data class

Proven: `HUMAN_ONLY` yields **no** model reply (`runtime-human-only`, no REPLY proposal); `LOCAL_ONLY` cannot use a hosted (or absent) model interface (`runtime-data-class-unserviceable`, no REPLY), but **can** use a `LOCAL` interface (a REPLY proposal is produced). `HOSTED_ALLOWED`/`LOCAL_ONLY`/`HUMAN_ONLY` are preserved throughout.

## Privacy / erasure gate — before content, model, or knowledge

A subject-linked conversation is gated by an injected `ConversationPrivacyGate`, consulted **before** any model/knowledge interface and before any reply proposal. Proven:

- a subject-linked conversation with **no** gate fails closed (`runtime-privacy-gate-missing`);
- an `erased`/`anonymised`/`tombstoned`/`in-progress` subject is blocked (`runtime-subject-blocked`), and the model interface is not called;
- a `clear` subject proceeds.

## Core authority — proposals only

Every runtime output is a **proposal** carrying `authorityStatus: PENDING_CORE_VALIDATION` and **no** `execute`/`send`/`authorize`/`callN8n`/`commit` method (proven). The `RuntimeDecision` itself exposes no such method. QuickFurno Core is the only authority that may validate and act; n8n is transport-only; models/knowledge/evaluation grant no business authority and RAG remains disabled. Riya=CLIENT, Anisha=VENDOR, Jarvis=COORDINATION, kept distinct.
