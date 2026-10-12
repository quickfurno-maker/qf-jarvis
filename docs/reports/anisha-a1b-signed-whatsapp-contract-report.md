# AN-A1b — Anisha signed WhatsApp integration report

**Date:** 2026-10-12 IST
**Status:** INTERNAL CONTRACT HARNESS PASS; REAL STAGING PROVIDER ROUND-TRIP NOT CERTIFIED
**Source base:** Jarvis main `0ca4af72978a0bc49dd55ff1d187b7358e0b40b6`
**Associated A1a PR:** [Jarvis #319](https://github.com/quickfurno-maker/qf-jarvis/pull/319)

## Purpose and boundaries

Anisha V1 Phase A1b follows the existing QuickFurno Core -> Jarvis worker and Core callback signed protocols. This report deliberately separates a cryptographically verified **mock-Core transport harness** from an actual deployed Core staging handler and Meta delivery provider. No production or staging tables were changed. No live WhatsApp message was sent.

## What was implemented

New `apps/api/src/tests/quickfurno-whatsapp-anisha-e2e.test.ts`, adapted from the existing Riya signed E2E harness to vendor role and Anisha experience.

1. The worker sends Ed25519-signed `qfj.whatsapp.turn-material` V2 with exact audience, caller, path, timestamp and bound conversation/inbound message IDs.
2. The mock Core endpoint verifies the actual signed request using the public test key, not just string matching.
3. Core returns a vendor-subject turn, scoped `ANISHA` + `vendor` + `VENDOR` with current revision, subjectRef, consent/gate fields and an inbound message.
4. The existing material reader enforces the canonical subject/actor relationship, the new A1a preflight refuses unsafe conditions, and the existing specialist asks the mocked Jarvis model exactly once.
5. A reply proposal is signed for the existing `qfj.whatsapp.reply` V2 Core callback. Test checks conversation revision, actor `ANISHA`, partner-concierge experience and the presence of an idempotency digest. The mock Core returns a queued or refusal status.
6. The queue is finalized once on success/stale Core response and refuses to replay the model when Core transport becomes indeterminate.

**Matrix:** 9 scenarios including authorized vendor, pause, human takeover, erasure, non-hosted content, cross-role party mismatch, missing subject reference, stale Core callback (HTTP 409), unknown Core callback (HTTP 503). Invalid material may be failed-indeterminate before the model rather than completed-no-reply; both are fail-closed, not delivered.

## Verified local gates

- `vitest` focused: **70/70 PASS**, across Anisha preflight, specialist, processor and signed-vendor E2E (9 new scenario cases).
- `tsc --noEmit --project apps/api/tsconfig.json`: **PASS**.
- `git diff --check`: **PASS**.
- No production deployment, live provider send, Core wallet action, new memory writes or agent activation.

## Observed staging truth

Read-only 2026-10-12 Supabase project `uckafzuochmbvtiodmcl`: **27 vendors, 0 WhatsApp conversations, 0 assigned to Anisha**. Production QuickFurno `yqpgcsduqbxulrlzwzap`: **28 vendors, 11 conversations, 0 assigned to Anisha**. These are row counts at observation time; they do not establish provider account provisioning, active worker lanes or historical delivery outside these tables.

## Not yet certified

- **True handler E2E:** actually execute deployed QuickFurno staging handler with a test Core-signed message, staging DB conversation, signed Jarvis worker, real Core reply enqueue and after-send evidence.
- **Meta/WABA:** inbound verified webhook, number role, consent, 24-hour service window and provider accepted/sent/delivered/read evidence.
- **Runtime deployment:** confirm staging worker build digest, rollout flags, `ANISHA` lane on, Core `QF_JARVIS_WHATSAPP_ENABLED` and matching keys without leaking values. Staging provider account must be isolated from production.
- **Support/memory:** per-vendor durable memory remains disabled pending A2 policy/retention/erasure; no new long-term memory provisioned. Short-term non-authoritative context already exists.

**Decision:** A1a model preflight plus A1b signed integration harness are ready for PR review/CI. Mark A1b as `INTERNAL_CERTIFIED_PROVIDER_PENDING`, not `LIVE_CERTIFIED`. Do not fabricate staging conversation rows or turn on a production WhatsApp number to force a green result.
