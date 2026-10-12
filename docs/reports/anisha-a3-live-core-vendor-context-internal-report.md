# Anisha A3 — Live QuickFurno Vendor Context, Safe Knowledge & Core Truth

**Date:** 2026-10-12 IST
**Status:** INTERNAL CONTRACT INTEGRATION + LOCAL TESTS COMPLETE; PRODUCTION BINDING / REAL STAGING NOT CERTIFIED
**Jarvis branch:** `feat/anisha-v1-a3-core-context` stacked on A2 PR #320 (A1 PR #319 first).
**Core dependency:** QuickFurno `feat/anisha-a3-context-truth` from main.

## Reuse, not duplication

QuickFurno Core already provides `POST /api/internal/jarvis/context` with `qfj.context.read` v1. It is Ed25519-request-signed and the Core handler independently checks runtime policy, actor=ANISHA and entityType=vendor. The existing Core service projects approved vendor data, eligibility-related status, nonfinancial package **bands**, location verification and bounded counts; it does not hand Jarvis raw wallet balances, contacts or customer details.

Jarvis uses existing `quickfurno-http.ts` signed Post transport, the existing WhatsApp specialist runtime and the A1 fail-closed identity gate. We added a small read-only adapter `anisha-core-context.ts` and `createQuickFurnoAnishaCoreVendorContextReader`. No new database, vector store, payment capability, per-lead accept/reject action, or provider channel was created.

## Processing

1. A1 signed QuickFurno turn material must say ANISHA + vendor + VENDOR, a canonical vendor UUID, OPEN, hosted text, Core jarvisAllowed=true, no erasure/takeover/AI pause. Unauthorized turns do not reach a model or Core vendor-context read.
2. Deterministic account-relevant language detection requests a Core snapshot only for vendor questions about leads, onboarding, verification, credits, packages, recharges, accounts or support. Simple greetings do not trigger the extra Core read.
3. Existing `qfj.context.read` v1 POST has actor=ANISHA, entityType=vendor and **subjectRef from Core-signed turn material**, not a model-generated identity. The request is Ed25519-signed using the existing Jarvis transport. The response is transported over authenticated HTTPS and checked for expected requestId/entityId/vendorId, exact schema, allowed band vocabulary and bounded counts; **the response itself is not separately cryptographically signed**.
4. The model sees only Core-approved bands (LOW_CREDITS, READY, etc.), location-verification status and bounded counts. Raw city, categories, paidStatus, customer content, phone, bank, amount and exact wallet credits are stripped before model composition. Free-text status is allowlisted. It must not invent credits, prices, payments, eligibility or refund authorization.
5. If Core denies/fails/times out or data is invalid, Anisha gets an explicit 'Core facts UNAVAILABLE' instruction and may suggest dashboard or human verification; it must not fill the gap from short/long-term memory.
6. Model input is bounded (up to 4096 characters) to avoid an overly long context causing a broken valid turn. Core facts are appended as trusted data context; a prompt cannot grant permission to change any financial record. Existing Core validation remains final authority for any eventual WhatsApp reply.

## Core truth fix

`services/jarvisContextService.ts` previously substituted zero for missing/failed counts (lead assignments, bad-lead reports and unread vendor notifications). The narrow fix `requireVerifiedVendorCounts` fails closed if any supporting query errors or lacks an exact valid nonnegative count, so the already-existing context route returns 'unavailable' rather than a fabricated zero. No schema migration.

## Verification

- Jarvis tests: Ed25519 signature verification, exact Core response identity, wrong-vendor/extra-field/invalid counts and readiness bands, 403/503 fallback, A1 safety gates, intent cost savings, no financial/PII content leak, model-context bounding and end-to-end mocked specialist integration.
- Core existing `scripts/mvp/jarvis/validate-qf-mvp-60-context-recommendations.mjs`: 44/44 PASS, including new zero-vs-unavailable regression checks.
- TypeScript both repositories PASS. Prettier and Git whitespace checks PASS.
- Full test counts, exact commit IDs and CI references should be attached to the PR once pushed.

## What is NOT verified or enabled

- **No production/staging runtime binding** was added. `anishaCoreContextReader` is an optional specialist dependency and real production worker composition still does not pass it. This preserves existing behavior until a signed staging integration is certified and owner authorizes activation.
- Actual Core staging endpoint response with a provisioned vendor, separate Jarvis worker deployment, rollout/feature flags, latency, real model grounding and real Meta delivery/receipt **remain unverified**.
- The existing hybrid knowledge infrastructure may help general policy answers, but a versioned, vendor-approved price/package knowledge source and stale-content invalidation require further A3 rollout work. Do not infer current prices from this snapshot.
- Governed long-term Anisha memory remains OFF pending Core vendor consent, owner retention/erasure policies and staging drills (A2). This A3 connection does not require durable memory.
- No vendor status/payment/credit/assignment mutation, package purchase, WhatsApp send or DB migration was performed.

## Next gate

Review stacked Jarvis PR after A1/A2, review separate Core truth fix, verify signed Core staging vendor context with mocked provider, feature flag and benchmark p95/timeout, then pilot with explicit owner approval before any live Anisha activation. Continue vendor knowledge versioning and A4 human escalation independently of external Meta/WABA activation.
