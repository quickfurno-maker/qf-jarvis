# `@qf-jarvis/conversation-control`

The conversation control command foundation — **QFJ-P08-A**, [ADR-0074](../../docs/decisions/ADR-0074-qfj-p08-a-conversation-control-command-foundation.md).

A strict, content-free, revision-bound operator command contract and a **pure** deterministic reducer
for four actions. It answers one question:

> Given this validated control fragment and this validated operator command, what is the deterministic
> next fragment and what evidence describes the transition?

It does not store the answer, expose a port, compose into any runtime, or make anything authoritative.

## Why it exists

Merged `main` already **obeys** human control: `humanTakeover` and `aiPaused` gate every path in
M1–M5. But the authoritative state port is `read(conversationId)` only — no production code can
**set** either flag. The runtime obeys a takeover it has no way to declare.

## The four actions

| Action              | Effect                                                                             |
| ------------------- | ---------------------------------------------------------------------------------- |
| `TAKE_OWNERSHIP`    | enters takeover **and forces the AI pause**                                        |
| `RELEASE_OWNERSHIP` | exits takeover and **leaves AI paused** — it never resumes                         |
| `PAUSE_AI`          | pauses; ownership untouched                                                        |
| `RESUME_AI`         | the **only** action that may clear the pause; **refused** under an active takeover |

The asymmetry is ADR-0054 §E: _"Return-to-AI requires an explicit authorized runtime transition —
there is no automatic release from human takeover."_

## Boundaries

Nine root runtime symbols. Depends on `zod` alone. No persistence, no durable idempotency claim, no
port, no HTTP, no UI, no consent, no approval, no transport, no provider, no Core, no clock, no
randomness, no environment read. **QFJ-P08 is not complete**, and production rollout remains OFF.
