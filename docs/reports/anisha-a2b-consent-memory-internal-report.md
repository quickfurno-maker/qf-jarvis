# AN-A2b — Purpose-Specific Vendor Memory, Internal Delivery

**Date:** 2026-10-12 IST
**State:** INTERNAL IMPLEMENTATION AND MOCKED/SANDBOX TESTS; NOT DEPLOYED
**Base:** AN-A3 Jarvis `a2819dde3fd3558fdb81f258fc24aa30b8c0980a` (stacked on A2 PR #320 and A1 PR #319).
**Companion:** QuickFurno Core vendor consent branch stacked on Core A3 PR #182.

## Why the existing system is reused

- Existing Jarvis Governed Memory Foundation, `@qf-jarvis/postgres-governed-memory-store`, physical subject invalidation and expiry purge are reused. No second agent-memory database/engine is introduced.
- Existing QuickFurno authoritative vendor identity and WhatsApp conversation/revision gate are reused. The existing signed Ed25519 HTTP transport is reused.
- Existing A2 read boundary enforces vendor+agent isolation, max three returned records, staleness, redaction and Core-priority.
- **The PostgreSQL memory migration remains a reviewed source artifact, not a confirmed applied staging migration.**

## This change

### Core purpose consent

1. `qfj.anisha.memory-consent` v1 signed route is bound to QuickFurno Core identity and a precise conversation revision. It never infers permission from WhatsApp or marketing consent.
2. Authenticated vendor-dashboard self-service GET/POST route uses the existing Supabase-session and active membership resolver. No vendor ID is accepted from the caller body. POST accepts one literal `GRANT` or `REVOKE`, with same-origin protection.
3. Review-only migration records vendor-specific purpose decision, version and revision; missing rows mean unknown/no grant. Revocation atomically denies future reads, marks physical erasure pending and enqueues a durable outbox task, idempotently.
4. While a deletion is pending, the Core DB function **refuses regrant**, so a stale Jarvis store cannot silently become eligible again. All direct anon/authenticated DB grants are revoked; service-role operations only. All staging gates default OFF.

### Jarvis memory

1. The existing signed POST transport implements the exact Core-purpose consent reader, binding vendor, conversation, expected revision and request ID. No error/unknown/mismatch may be interpreted as a grant.
2. The existing WhatsApp worker may bind the existing governed Postgres memory reader only with **staging-only** configuration, a declared owner approval ref and a PostgreSQL turn store. Production/local staging flag is refused; default remains DISABLED.
3. `anisha-memory-lifecycle.ts` provides an **internal, non-HTTP-bound** write/erase port for explicitly supplied structured preferences. Only approved language or reply-style enums become small derived text; no model transcript, arbitrary AI inference, wallet balance, package, lead assignment or PII can become long-term memory.
4. Derived memory has one canonical vendor subject and source message ID, deterministic memory ID for safe retries, 30-day maximum expiry, non-authoritative/rebuildable flags and governed write admission. The existing invalidate port can remove a vendor's memory after a correctly authenticated Core revocation task.

## Tests

- Core pure-contract harness exercises exact request shape, negative grants, scope, staging policy and migration safeguards. TypeScript compile required.
- Jarvis focused suites cover signed Ed25519 transport, subject and conversation binding, wrong vendor/revision, grant/deny/error, production stage activation rejection, original A1/A2 role guards, existing governed-memory and Postgres query/invalidate tests, 30-day bounded structured writes, idempotence, and mocked end-to-end revocation purge. TypeScript compile required.
- **Mocked in-memory deletion and Postgres-port SQL tests are not the same as a live PostgreSQL purge drill.** No Supabase migrations or operator/user data modifications have been performed.

## Outstanding mandatory certification (no shortcut)

- **Core purge outbox consumer and authenticated acknowledgement are not connected yet.** A pending purge task is *not* a deletion receipt. Staging activation must remain OFF until each durable task can be delivered, physically erased in Jarvis PostgreSQL and acknowledged in Core with retry/dead-letter behavior.
- Apply Core consent migration and existing Jarvis Postgres governed memory schema in **isolated staging only** after migration review and backups. Test actual signed Core vendor grant/revoke, reader, idempotent DB write, erasure and expiry sweeper, concurrency race, and strict no-cross-vendor disclosures.
- Obtain approved vendor-facing privacy notices, policy revision, owner sign-off and explicit vendor grants. Consent POST route exists; vendor-facing UI/disclosure is **not yet built/certified**.
- No production memory, WhatsApp sending, provider registration, wallet actions or payments were changed.

**Decision:** A2b data/consent interfaces and internal lifecycle are implemented; keep live staging memory disabled until purge delivery/ack and real database/consent certification. No production activation authorization implied.
