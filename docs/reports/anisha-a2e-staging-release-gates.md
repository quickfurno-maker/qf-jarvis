# AN-A2e — Controlled staging-release certification and blockers

Date: 12 October 2026 IST. **Source/certification complete; NOT deployed to shared Supabase, production or WhatsApp.**

## Evidence just completed

- Existing Jarvis governed-memory foundation/PostgreSQL adapter reused; no duplicate database, memory model or vendor Core truth.
- QuickFurno purpose-consent signed response extended with versioned consentRevision, consentUpdatedAt and erasurePending. Jarvis strictly binds the full signed-request/HTTPS-response context; stale, wrong-vendor, malformed, pending-erasure and missing-grant epochs block memory access.
- Added **operator-only staged re-enrolment** port. It requires A1 signed ANISHA/vendor Core conversation material, fresh exact-vendor Core GRANTED decision, consent revision at least 4, no erase pending, owner approval reference and a new grant timestamp later than the durable deletion fence. The Postgres function uses the existing vendor advisory lock, deletes any remaining old memory before clearing the fence. Never callable from WhatsApp or the model.
- Staging-only, default-OFF purge worker additionally calls existing bounded physical TTL sweeper (100 rows per cycle), even when Core is offline. Retention remains 30 days for structured preference memories.
- **Real localhost signed HTTP** tests drove the actual Jarvis Ed25519 consent/claim/ACK client over Node loopback HTTP and verified signatures with an independent public key; tampered messages were denied. **Actual Core signature verifier** separately passed 10/10 positive/negative checks, including stale requests. **This is not yet a deployed Next.js Core route test.**
- Existing disposable PostgreSQL 17 tests passed with actual physical deletion, rollback/retry, concurrent write/deletion, expiry, stale grant refusal and newer post-erase grant re-enrolment. All four migrations executed successfully against isolated synthetic data; not connected Supabase.
- **Final Jarvis focused tests: 208/208 PASS in 14 suites** (5 actual PostgreSQL adapter tests and 2 localhost signed HTTP tests); PostgreSQL store TypeScript PASS. Jarvis API TypeScript PASS with temporary source-path override because old active workspace package build metadata is linked; CI must rebuild exact package. Core consent+UI tests 27/27 PASS, Core purge 27/27 PASS, actual Core Ed25519 verifier 10/10 PASS, Core TypeScript PASS.
- As of the latest **read-only** Supabase probe: QuickFurno Staging has neither vendor consent nor outbox tables, connected **shared** QF-Jarvis DB has neither governed memory nor fence tables. No Supabase branch exists for either target; do not confuse QF-Jarvis shared with a safe Jarvis staging database.
- GitHub draft PRs #322 and #183 have **no reported CI checks**, because the Jarvis main CI workflow only triggers against main, and these are stacked PRs against feature branch. Do not claim remote CI green.

## Deployment prerequisites / actual release gate

1. Create or identify an isolated **QuickFurno Core staging branch/project** and a corresponding **Jarvis memory staging database**. Branch/project creation may carry a cost; require separate billing confirmation. The present shared QF-Jarvis project is **NOT** an acceptable test destination. Capture backup, expected base SHA, deployment flag and rollback before doing any DDL.
2. Resolve stacked PR chain: Core #182 -> #183 and Jarvis A1 #319 -> A2 #320 -> A3 #321 -> memory #322. Rebuild/relink updated governed-memory package; run full CI and security/code review.
3. Apply Core 20261012080000 + 20261012100000 and Jarvis governed memory 0001 + fence 0002 in isolated stage. Verify migration ledger, precise grants/RLS, functions/trigger existence and recovery restore.
4. Deploy exact staged Core/Jarvis builds and verify **actual** Ed25519 signed Core consent, purge claim, physically committed Jarvis delete, Core ack, stale-lease and cross-vendor refusals over authenticated HTTPS. Use synthetic test vendor only. No actual Meta send required at this gate.
5. Present clear opt-in notice and owner-approved privacy wording; verify vendor dashboard GET, unchecked opt-in, successful grant, 30-day language/style write/read, revoke, immediate deny, physical deletion, acknowledgement, expiry cleanup and zero cross-vendor disclosures.
6. After a new explicit grant **after** completed erasure, an authorized owner/operator runs the separate re-enrolment gate. **Re-grant alone never clears the fenced vendor.** No production/Meta activation before full stage sign-off.
7. Existing long-term preference **write lifecycle is an internal structured API, not wired as an automatic conversational write**. Do not promise spontaneous learning across chats until a Core-confirmed write-trigger integration has been certified; reads and purge are staged but default OFF.

## Controls

- Always run bounded signed Core reads with exact vendor from Core authority. No direct Jarvis access to business balances, payments or lead entitlements.
- All memory, purge and staging modes **default DISABLED** in deployed configuration. Nothing in this work modified production or shared staging data, launched Meta messages, or approved external privacy text.
- Do not merge or promote until above stage gates are green.
