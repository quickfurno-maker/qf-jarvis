# Anisha A2 — Governed Vendor Memory and Conversation Continuity

**Date:** 2026-10-12 IST
**Status:** INTERNAL CODE + FOCUSED TESTS COMPLETE; durable memory DISABLED and provider certification PENDING
**Base:** Jarvis A1a+A1b branch `feat/anisha-v1-a1-whatsapp-identity` at `8a2058f5c0c3db574bf3ffbd67ea970734022eed`
**A2 branch:** `feat/anisha-v1-a2-governed-continuity` (stacked PR; must land after A1).

## Existing mechanisms deliberately reused

- QuickFurno Core retains canonical vendor identity, consent, WhatsApp turn material, pause/takeover, authorized outbound reply and current vendor business truth.
- The existing signed conversation-context reader delivers at most 12 recent turns / 4000 context characters and is explicitly `NON_AUTHORITATIVE_CONVERSATION_CONTEXT`; no new transcript database or cross-role inbox was created.
- Jarvis already has `@qf-jarvis/governed-memory-foundation`, PostgreSQL adapter, required owner approval / max retention / erasure policy gates, physical invalidation and a closed agent-to-subject ownership map (Anisha -> vendor only).
- A1 vendor model preflight and the Jarvis runtime's fresh Core authority check remain mandatory.

## A2 implementation

`apps/api/src/quickfurno-whatsapp/anisha-vendor-memory.ts` adds an _optional read-only adapter_ for already-governed memory records; it never creates or writes memory. No production app composition binds this reader.

Rules before an optional memory read:

1. Explicit operator/owner policy must enable reads with a bounded approval reference, otherwise all reads are OFF.
2. An existing governed-memory runtime must be supplied (which itself requires enabled owner retention, erasure and store policies).
3. A future _signed Core per-vendor consent reader_ must be supplied. Consent must be affirmative, fresh (5 minutes), refer to the exact canonical vendor and be attributed to QuickFurno Core; unknown, stale, refused, unavailable or mismatched consent means **no read**. No Core consent adapter was created or activated in this PR.
4. A1 preflight requires ANISHA + vendor + VENDOR, valid subjectRef, OPEN, hosted text, Jarvis allowed, not paused, human-controlled, cancelled or erased. Core turn material must be fresh within 5 minutes.
5. Store query is _exactly_ `ownerAgent=anisha` AND `subjectReference={vendor:<Core subjectRef>}`, never an agent-wide or cross-vendor fallback. Read limit 3.
6. Only one-vendor, unexpired, fresh (max 30 days, configurable 1–90) non-authoritative/rebuildable memory record with allowlisted preference/support reason may contribute. Obvious contact, financial, secret and instruction-override patterns are excluded. This is defense in depth and NOT a complete PII detection guarantee.
7. Derived memory is clearly labeled unverified preference only. Core is authoritative for credits, payments, eligibility, assignment, status, and package truth. Memory cannot cause business actions.
8. Store and consent failures return an unavailable/blocked result and the authorized model turn can continue with Core's existing short-term context only. No model retry, no additional Core or provider side effects.

`specialist-runtime.ts` accepts a **new optional** `anishaMemoryReader` dependency. This dependency remains absent in the real production stack. When supplied in tests, only a vendor actor may read and compose the bounded memory hint after the A1 preflight, before model processing. Riya and Aarohi behavior are unchanged.

## Verification

- Unit and integration-like tests for disabled-by-default behavior, missing owner approval or consent, grant/denial/unknown/stale/wrong-subject consent, vendor isolation, wrong actor/role, pause, takeover, erasure, stale Core material, cross-vendor/agent/multi-subject memory, expired/future/aged memory, clear-text contacts and finance, store outage fallback and end-to-end model input.
- Focused suite **93/93 PASS**, five test files (A2, A1 preflight, WhatsApp specialist, signed Anisha E2E and turn processor).
- API `tsc --noEmit --project apps/api/tsconfig.json`: PASS.
- Prettier and Git whitespace checks: PASS.
- No database migration, no production configuration change, no real WhatsApp send, no persistent memory read/write in deployed production.

## Gated dependencies / next required work

- Define and implement an **authoritative, consented, revocable vendor memory-purpose decision in QuickFurno Core** and a signed, tenant/vendor/conversation-bound read contract. **Do not infer this permission from WhatsApp service consent or owner approval.** If there is no lawful/clear purpose, keep A2 durable memory OFF.
- Document retention limits, purge schedule, erasure propagation, subject corrections, consent revocation tests and per-vendor provenance.
- Add a production adapter only after Core consent, owner sign-off and a deployed, contract-certified staging read/wipe drill.
- Full production WhatsApp and external Meta certification remains an A1b/A6 blocker. A2 internal evidence does not substitute for real provider receipts.
- A3 should use live Core vendor facts and agent knowledge, not this derived memory as a source of truth.
