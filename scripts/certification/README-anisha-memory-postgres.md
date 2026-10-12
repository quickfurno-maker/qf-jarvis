# Isolated Anisha memory certification (synthetic PostgreSQL)

Never run these scripts against shared Supabase or QuickFurno/Jarvis production/staging projects.

1. Start a disposable local PostgreSQL 17 cluster bound **only** to 127.0.0.1:55439 and create its separate database named `anisha_memory_cert`. Never reuse your regular PostgreSQL service, and do not expose the test cluster publicly.
2. Execute `anisha-memory-synthetic-setup.sql` within that database. It creates only mock roles and a minimal vendor table.
3. Apply source migrations, in order:
   - QuickFurno Core: `supabase/migrations/20261012080000_anisha_vendor_memory_consent_source.sql`
   - QuickFurno Core: `supabase/migrations/20261012100000_anisha_memory_purge_delivery.sql`
   - Jarvis: `packages/postgres-governed-memory-store/src/migrations/0001_governed_agent_memory.sql`
   - Jarvis: `packages/postgres-governed-memory-store/src/migrations/0002_anisha_erasure_fence.sql`
4. Execute `anisha-memory-synthetic-core.sql` then `anisha-memory-synthetic-lease.sql`. Both **fail closed** unless the database/host/port match the disposable instance.
5. Run the opt-in real Node/Pg adapter test with the environment variable:
   `ANISHA_MEMORY_CERT_DATABASE_URL=postgresql://postgres@127.0.0.1:55439/anisha_memory_cert`
   and the test file `packages/postgres-governed-memory-store/src/tests/anisha-live-postgres-cert.test.ts`.
6. Stop and remove the disposable cluster after preserving the certification report. Never copy synthetic trust-auth settings to staging/production.

The SQL scripts are for a **fresh** disposable database (no arbitrary cleanup of existing app records). The Node integration tests reset only their fixed synthetic IDs, and refuse to run against any other connection target. Database-level certification is not real Core/Jarvis HTTPS/Meta or Supabase staging certification. Cross-database signed staging service tests still require isolated stage deployment, credentials, and explicit vendor notice approval.

Date: 2026-10-12 IST.
