# Anisha A2d — Real PostgreSQL Isolation Certification

Date: 2026-10-12 IST
Certification environment: **disposable local PostgreSQL 17.10** started on the connected developer PC, listening only on 127.0.0.1:55439, database `anisha_memory_cert`. Synthetic vendor IDs only; separate PostgreSQL cluster from the PC's existing PostgreSQL service. No external Supabase schema or production records modified.

## Migration and SQL execution

All four checked-in source migrations executed with `psql -v ON_ERROR_STOP=1` successfully:

1. QuickFurno Core purpose-consent/outbox `20261012080000_anisha_vendor_memory_consent_source.sql`
2. QuickFurno Core leased purge/ACK `20261012100000_anisha_memory_purge_delivery.sql`
3. Jarvis governed derived-memory PostgreSQL `0001_governed_agent_memory.sql`
4. Jarvis subject-erasure write fence `0002_anisha_erasure_fence.sql`

An isolated fixture database contains a simple synthetic `public.vendors(id uuid)` table and test-only PostgreSQL roles. Tests do **not** depend on or reproduce live vendor/customer data or actual QuickFurno Core schemas.

## Passed data-level drills

- Explicit purpose-consent GRANT; simulated vendor memory record inserted; REVOKE creates one pending durable purge and immediately changes Core decision to DENIED.
- Regrant is blocked while physical deletion is pending; no anon table SELECT or consent-mutation RPC privilege.
- Core leased claim issues vendor/purge/token. Forged lease and wrong vendor ACKs return false.
- SQL transaction obtains same per-vendor advisory lock as the Anisha INSERT/UPDATE trigger, writes fence, physically deletes only that vendor's Anisha records and COMMITs.
- Core ACK is successful only after successful delete. Duplicate ACK rejected; consent remains DENIED; pending outbox becomes empty.
- Late INSERT for a fenced vendor fails with anisha-memory-erasure-fence; unrelated vendor/agent memory remains untouched.
- Deleting a synthetic Core vendor still queues a durable purge task; physical deletion and ACK work even after vendor account is gone.
- Expired Core lease rotates token and increments attempt count. Old token cannot ACK; new token can ACK after deletion.
- **Real Node PostgreSQL adapter test** calls `eraseAnishaVendorMemoryWithFence` against isolated PG: vendor scope, committed deletion, durable write fence, safe duplicate, injected error triggering rollback, successful retry, in-flight writer/advisory-lock race, and expiry-sweeper preservation of nonexpired records. **4/4 PASS**.
- PostgreSQL memory package TypeScript (tests included) PASS.

Test harness files are `scripts/certification/anisha-memory-synthetic-*.sql` plus opt-in `packages/postgres-governed-memory-store/src/tests/anisha-live-postgres-cert.test.ts`. The integration test refuses to run unless the database connection is exactly loopback port 55439 and database name `anisha_memory_cert`; otherwise it skips.

## Limitations and next gates

- **This is local disposable PostgreSQL certification, not a deployed QuickFurno/Jarvis service or Supabase staging promotion.**
- Exact Core production schema, Supabase RLS/advisors, migration ledger/backup, actual service_role runtime queries and real HTTPS signed request/response still need isolated staging verification.
- The Core vendor consent UI/wording needs owner/legal sign-off, and independently approved Core-certified re-enrolment must clear a past durable memory fence before a previously revoked vendor can write again.
- Jarvis governed-memory record reads/writes and real signed Core transport require a staged worker deployment and context/consent feature flag only after migration certification.
- This test does not activate production, use live vendor data, send WhatsApp messages or mutate existing application databases.

## Final exact evidence and cleanup

- Jarvis focused regression and actual PostgreSQL adapter: **195/195 tests passed across 12 suites**.
- Final isolated PostgreSQL invariants: **0 pending Core purge tasks; 0 Anisha memory records; 6 persistent synthetic write fences; 0 vendor erasure-pending flags**.
- Both Core synthetic SQL drill scripts passed, including stale/rotated lease token rejection.
- The disposable PostgreSQL server on 127.0.0.1:55439 was shut down and its test-only pgdata directory removed. The existing PostgreSQL service on port 5432 remained healthy.
- No QuickFurno staging or shared Jarvis Supabase database migration, credential, or data was changed.
