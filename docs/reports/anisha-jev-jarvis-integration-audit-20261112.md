# QuickFurno — Anisha / JEV / Jarvis integration audit

Date: 2026-11-12. Scope: repository audit, read-only Staging/production host and mounted worker-configuration checks, plus an isolated offline Anisha candidate. No vendor records, paid provider calls, outbound messages, credentials copied, deploys or managed changes were used.

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
2. The deployed worker's AOS input remains marketplace-only. This candidate now adds a **separate, optional AOS SHADOW** path from a successful signed Anisha Core vendor read: a bounded account signal (opaque vendor, one request correlation, readiness band, pending bad-lead count) enters a short-lived deduplicating buffer and then the existing AOS supervisor. This is not a complete scheduled vendor-success feed: inactivity/matching-demand/retention sources are still missing, and no outbound sends are possible.
3. JEV's live worker binding is optional `decisionIntelligence.mode=SHADOW`; the model-reply adapter waits for its bounded advisory attempt but ignores the advisory for the current reply. It is not yet an Anisha escalation or next-action decision path.
4. Adaptive SIMPLE/STANDARD/COMPLEX model selection already exists. No need to introduce a competing agent framework, router or provider choice.
5. Vendor-account data delivered to the model is bounded (status, office-verification, readiness/expiry bands, active-lead count, pending report count, notices) and must remain request/identity-bound. Exact credits/prices/phone numbers and unsupported client information are excluded.
6. Read-only SSH reached both host aliases. The **Staging** host has `qf-jarvis-whatsapp-worker` running on an image started 2026-10-17 with config revision `0b391530ffce9b28123163562de463989bb7eebf`. The mounted config provides direct OpenAI credentials via file reference (only configuration presence checked), JEV `DISABLED`, knowledge `DISABLED`, and omits AOS/Anisha Core/memory flags and AGNI escalation. Its environment field says `production` despite being on the Staging host. The separate QuickFurno production host has web and automation containers. The mounted OpenAI seal's `sourceHeadSha` matches the worker revision and declares `OPENAI_ONLY`, two runtime tiers and six evidence entries; this read-only metadata consistency check is **not** a fresh signature verification or live model certification. Live AI message quality and provider credential validity remain unverified.

## Anisha v2 candidate in this branch

- New, separate `anisha.vendor-journey` prompt v2 candidate: official **AI** support specialist who represents QuickFurno professionally, discloses AI identity, speaks English/Roman Hinglish only, offers one factual next action, never impersonates a human or promises a completed Core action.
- An optional deterministic, context-relevant next-step advisory over the already-verified per-turn Core snapshot. Neither the selector nor prompt requests outbound sends, refunds, account mutations or tool access. The v1 prompt bytes and production prompt registry remain untouched.
- The Core-fetch intent gate now recognizes general `next`/`update`/`pending` support questions without fetching for greetings.
- Work remains isolated on `feat/anisha-tuning-v2-candidate-20261112`. New prompt has no production export, registry inclusion or release approval; the Core fact composer change is only reachable where the existing STAGING_ONLY Core reader is enabled.

## Next implementation order (reuse, not rebuild)

1. Verify the Staging worker environment mismatch, source SHA, OpenAI exact-release seal and live canary **read-only** before any changes. The read-only config inspection is complete; live provider certification is not.
2. Complete full vendor-success data coverage for inactivity/matching demand/retention with a separately certified Core source. The candidate **partial account-signal SHADOW path** is implemented and tested; no unsolicited WhatsApp sends, active AOS mode or new approvals are granted.
3. Extend deterministic intent coverage and approved policy knowledge for vendor onboarding, assigned-lead initial contact, complaint intake and package readiness. Do not expand to project fulfillment or lead-quality decisions.
4. Benchmark the current production prompt versus candidate v2 using representative English/Hinglish tests, account context, missing data, safety, latency, JEV cost and escalation. Preserve historical tests; do not relabel evidence.
5. Obtain exact provider/prompt/knowledge approval, owner-reviewed Staging tests and WhatsApp canary before production activation. Enable JEV/AOS capabilities independently after passing their specific gates.

## Quality and operational boundary

- The full dependency build for `@qf-jarvis/api...` passed in the isolated worktree (73 workspace projects).
- Offline 15-suite integrated test run passed **128/128**: JEV, model shadow, adaptive routing, Anisha Core reader, ephemeral account-signal buffering, WhatsApp, AOS vendor-success and worker behavior. This candidate has no prompt-v2 production export.
- Do not regard these unit/integration tests as proof of paid OpenAI API quality, TypeSafe Jev connectivity, real vendor-data access, real WhatsApp delivery, or actual production deployment.
- Release HOLD remains in place. No merges, managed SQL, OTP, WhatsApp messages or cloud/production changes.

## PR #347 independent CI remediation (same candidate, 2026-11-12)

- The original PR head `0e73b4e5` had three GitHub workflow failures. **Quality gate**: Prettier formatting in `docs/training/anisha-local-language-readiness-20261112.md`. **Red-team**: a new API test referenced the WhatsApp vocabulary outside an existing reviewed code boundary. **Container supply chain**: Trivy found HIGH/CRITICAL advisories against Jarvis OS `next@16.3.8`.
- Fixes preserve controls: format the training note, relocate two new tests beside their source in `src/quickfurno-whatsapp/tests/` so imports are relative and no extra WhatsApp vocabulary escapes the reviewed seam. Do **not** edit historical containment tests or their allowlists.
- Upgrade the exact Jarvis OS dependency to `next@16.4.6` and regenerate the frozen pnpm lockfile. The GitHub scanner identified three advisories requiring at least 16.4.1; the version bump must still pass a fresh image scan, without suppression. No unrelated feature dependencies or live deploy are changed.
- After fixes, the full workspace TypeScript build, `pnpm run typecheck`, `pnpm run lint`, Jarvis OS Next.js production build, repository Prettier check, frozen-lockfile installation and 61/61 targeted security/Anisha tests passed locally.
- The Staging worker is running its earlier image with `environment: production` and `deploymentMode: SINGLE_OWNER`. Its signed OpenAI release/source revision matches, but the optional Anisha Core context mode is forbidden unless the worker environment is `staging`; changing a live worker without resolving its actual traffic ownership would be unsafe. JEV and AOS are disabled/unconfigured in that deployed worker.
- GitHub PR #347 CI on the follow-up Next.js patch cleared Continuous Evaluation and Assurance Drills, while its container supply-chain scan found a **new** HIGH advisory `CVE-2026-112942` in transitive Vite `8.1.4`. The existing pnpm workspace security overrides now pin `vite: 8.1.7` (also covers the related later critical Vite advisory). The frozen offline lockfile check passed; Vite resolves as a single version; 124/124 targeted Anisha/AOS/JEV/containment tests passed. The original scanner and historical policy tests were not weakened.
- GitHub CI rerun for the Vite patch, independent Trivy scan, exact OpenAI V1/V2 live provider evaluation and a safe Staging canary remain **not certified** until verified on the newest commit.
