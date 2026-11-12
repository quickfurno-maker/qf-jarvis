# QuickFurno — Anisha / JEV / Jarvis integration audit

Date: 2026-11-12. Scope: repository read-only architecture audit plus isolated, offline Anisha candidate. No vendor data, production API/model calls, credentials, deploys or managed changes were used.

## Verified reusable architecture

- **QuickFurno Core** is the business source of truth. The existing signed `qfj.context.read` vendor endpoint accesses `vendors`, `lead_assignments`, `bad_lead_reports`, `vendor_notifications`. Core rejects unavailable counts instead of confusing them with zero, and emits a bounded snapshot.
- **Anisha** already owns registered-vendor journey, onboarding/profile questions, lead-response guidance, complaints and routine support. She never becomes Riya (client), Aarohi (unregistered vendor acquisition), human support or Core.
- **Production model gateway** supports exact OpenAI release binding, Responses API, strict output, two pre-certified candidate tiers routed by adaptive complexity. Exact model and prompt evidence must pass the release seal; configured candidates alone do not prove live activation.
- **TypeSafe JEV** is an optional System One structured decision advisory. It operates in SHADOW only, after hosted-data admission; it cannot assign actor, authorize action, change Core truth, select or replace a model. Optional mounted credential and model discovery are required for startup with SHADOW enabled. No live TypeSafe invocation was performed in this audit.
- **AOS v2** includes a supervisor, case evidence, behaviour policies, market cells, vendor-success bridge and vendor-success shadow cycle. Trust/contact/retention precede revenue. Its advice has `executionAuthority: NONE`.
- **AGNI** has a signed case-ingest route for an Anisha escalation proposal. Actual operator receipt/handling on a live host was not tested.
- **Consent-governed memory** has vendor memory reader, explicit-preference recorder and purge workflow. Worker binding is STAGING_ONLY and owner-approval/retention dependent.
- **Governed knowledge** includes versioned retrieval and optional hybrid Postgres/embedding serving. Production knowledge selection is deployment-gated; no RAG availability claim follows from code presence.
- **Governed actions** (JAO and automation) are separate review/execution paths, not actions an AI reply can autonomously perform.

## Integration findings

1. The production-worker config declares Anisha signed Core vendor context `DISABLED | STAGING_ONLY`; memory and purge are similarly gated. The signed adapter and decoder exist and pass tests. A live production vendor account cannot be claimed to be connected merely because the adapter is implemented.
2. The worker's configured AOS SHADOW cycle currently feeds **marketplace-capacity slices** into `runAosSupervisorShadowCycle`. The reusable supervisor accepts `vendors` and `runAosVendorSuccessShadowCycle` already exists, but the worker does **not** populate vendor-success projections from live QuickFurno Core. This is the concrete missing data bridge for proactive Anisha.
3. JEV's live worker binding is optional `decisionIntelligence.mode=SHADOW`; the model-reply adapter waits for its bounded advisory attempt but ignores the advisory for the current reply. It is not yet an Anisha escalation or next-action decision path.
4. Adaptive SIMPLE/STANDARD/COMPLEX model selection already exists. No need to introduce a competing agent framework, router or provider choice.
5. Vendor-account data delivered to the model is bounded (status, office-verification, readiness/expiry bands, active-lead count, pending report count, notices) and must remain request/identity-bound. Exact credits/prices/phone numbers and unsupported client information are excluded.
6. Local Docker inspection found no running qf-jarvis/jev worker container on the JARVIS PC; this is **not** a production VPS status assertion. Remote host activation, keys, approvals and real messaging were not checked.

## Anisha v2 candidate in this branch

- New, separate `anisha.vendor-journey` prompt v2 candidate: official **AI** support specialist who represents QuickFurno professionally, discloses AI identity, speaks English/Roman Hinglish only, offers one factual next action, never impersonates a human or promises a completed Core action.
- An optional deterministic, context-relevant next-step advisory over the already-verified per-turn Core snapshot. Neither the selector nor prompt requests outbound sends, refunds, account mutations or tool access. The v1 prompt bytes and production prompt registry remain untouched.
- The Core-fetch intent gate now recognizes general `next`/`update`/`pending` support questions without fetching for greetings.
- Work remains isolated on `feat/anisha-tuning-v2-candidate-20261112`. New prompt has no production export, registry inclusion or release approval; the Core fact composer change is only reachable where the existing STAGING_ONLY Core reader is enabled.

## Next implementation order (reuse, not rebuild)

1. Audit the actual deployed worker config and exact release evidence _read-only_ for OpenAI, JEV, Anisha context, AGNI and AOS. Do not infer live status from example files.
2. Connect a strictly sanitized, signed, vendor-specific **Core success projection** to the existing AOS supervisor. First implement source-coverage checks and shadow-only recommendations, with consent, cooldown and suppression; no unsolicited WhatsApp sends.
3. Extend deterministic intent coverage and approved policy knowledge for vendor onboarding, assigned-lead initial contact, complaint intake and package readiness. Do not expand to project fulfillment or lead-quality decisions.
4. Benchmark the current production prompt versus candidate v2 using representative English/Hinglish tests, account context, missing data, safety, latency, JEV cost and escalation. Preserve historical tests; do not relabel evidence.
5. Obtain exact provider/prompt/knowledge approval, owner-reviewed Staging tests and WhatsApp canary before production activation. Enable JEV/AOS capabilities independently after passing their specific gates.

## Quality and operational boundary

- The full dependency build for `@qf-jarvis/api...` passed in the isolated worktree (73 workspace projects).
- Targeted integration checks covered JEV, model shadow, adaptive routing, Anisha Core reader, WhatsApp, AOS vendor-success and worker behavior.
- Do not regard these unit/integration tests as proof of paid OpenAI API quality, TypeSafe Jev connectivity, real vendor-data access, real WhatsApp delivery, or actual production deployment.
- Release HOLD remains in place. No merges, managed SQL, OTP, WhatsApp messages or cloud/production changes.
