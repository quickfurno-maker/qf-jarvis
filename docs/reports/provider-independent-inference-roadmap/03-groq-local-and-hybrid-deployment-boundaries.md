# Report 03 — Groq, Local and Hybrid Deployment Boundaries

**Date:** 2026-07-21. **Documentation only — no provider implemented, no API called, no key used, no WhatsApp activated, no migration created. QFJ-P03 remains the active priority.** Source: [model-provider-independence.md](../../architecture/model-provider-independence.md).

## Deployment ownership

| Owner          | Responsibilities                                                                                                                                                |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Jarvis VPS** | inbound webhook · queues · task routing · provider selection · memory coordination · response validation · delivery scheduling · monitoring · execution intents |
| **Local PC**   | model serving · GPU resource control · local-model health · model lifecycle — **and nothing else**                                                              |

```
WhatsApp ⇄ Jarvis VPS (webhook, queues, routing, provider selection, validation, delivery, monitoring)
                     │  bounded, sanitized ModelProvider request over mTLS + firewall allowlist
                     ▼
             Local PC (model serving + GPU only) — no business credentials, no WhatsApp/n8n/Core reach-back
```

## Credentials the local PC must NOT receive

WhatsApp access tokens · Supabase service-role credentials · unrestricted database credentials · n8n administrative credentials · GitHub credentials · payment credentials.

## Local inference transport requirements

- Private authenticated connection.
- TLS/mTLS or equivalent signed service authentication.
- Firewall allowlisting.
- **No anonymous public inference endpoint.**
- Bounded, sanitized requests only.

## Per-mode deployment posture

- **GROQ_CLOUD:** VPS → Groq over the hosted API; requests minimized/sanitized; key injected at deploy time only; local PC unused.
- **LOCAL_PC:** VPS → local node over the private mTLS channel; no hosted egress of message content; local PC holds only the model.
- **HYBRID_LOCAL_PRIMARY:** VPS routes to local first; explicit Groq fallback for non-restricted content only; restricted content stays local or goes to a human.
- **HYBRID_GROQ_PRIMARY:** VPS routes to Groq first; explicit local fallback for continuity; single fallback per turn.
- **HUMAN_ONLY:** no model sees content; VPS routes conversations to human operators.

## Independence verdicts

- **WhatsApp/queue independence:** the WhatsApp webhook and queue workers depend only on the `ModelProvider` contract and never import provider-specific types; a provider swap does not touch them.
- **QuickFurno Core boundary:** no provider (Groq or local) directly calls WhatsApp, n8n, or QuickFurno Core; Core remains the final business authority; providers deliver only.
- **Credential boundary:** the local PC receives no business-system credentials; hosted-provider requests are minimized and sanitized.
