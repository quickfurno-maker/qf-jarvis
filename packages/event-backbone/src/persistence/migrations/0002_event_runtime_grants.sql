-- 0002_event_runtime_grants.sql
--
-- Least-privilege runtime access to the event log (Stage 3.3 slice 3).
--
-- Migration 0001 created the event log and revoked it from PUBLIC and from the managed
-- provider's roles, but granted the RUNTIME role nothing. Serving traffic therefore had no way
-- in — which is correct until there is an ingestion path, and now there is. This migration grants
-- the runtime role the *minimum* it needs to append and read, and nothing more.
--
-- WHAT THE RUNTIME ROLE GETS
--
--   * USAGE on the qf_jarvis schema — so its objects are reachable by name at all.
--   * SELECT, INSERT on qf_jarvis.event — append a verified event, and read the log back.
--
-- WHAT IT DELIBERATELY DOES NOT GET
--
--   * No UPDATE, DELETE or TRUNCATE. The log is append-only. A correction is a new record, and a
--     store that could rewrite history is not an audit log. (The append-only trigger from 0001
--     also refuses UPDATE/DELETE for every role, including the owner — this is the second control.)
--   * No CREATE on the schema. The runtime does not define objects.
--   * No REFERENCES, no TRIGGER, no ownership. A table owner can `ALTER TABLE ... DISABLE
--     TRIGGER` and defeat immutability from inside; the runtime must never be that owner.
--   * Nothing to PUBLIC, anon, authenticated or service_role — those are revoked by the runner's
--     bootstrap on every migration and are not re-opened here.
--
-- THE IDENTITY SEQUENCE
--
-- `sequence` is `GENERATED ALWAYS AS IDENTITY`. PostgreSQL advances an identity column's sequence
-- as part of the INSERT itself and does NOT require the inserting role to hold USAGE on that
-- sequence — unlike a `DEFAULT nextval(...)` column. So no sequence grant is issued here, and the
-- integration test `packages/event-backbone/src/tests/event-store.integration.test.ts` proves an
-- INSERT succeeds without one. If a future PostgreSQL ever required it, the minimum would be
-- `GRANT USAGE ON SEQUENCE qf_jarvis.event_sequence_seq` and nothing wider.
--
-- CONDITIONAL, LIKE THE MANAGED-ROLE REVOKE
--
-- `qf_jarvis_runtime` is a DEPLOYMENT role. It does not exist on a developer's laptop or in CI,
-- exactly as `anon`/`authenticated`/`service_role` do not — so an unconditional `GRANT ... TO
-- qf_jarvis_runtime` would be a hard error everywhere except the managed database, and a migration
-- that only runs on the provider is a migration CI never proved (ADR-0023 §5). So the role is
-- looked up first and granted to only if it exists. On the managed database the role must be
-- created BEFORE this migration is applied (see docs/engineering/managed-database-runbook.md);
-- the integration test `packages/event-backbone/src/tests/event-store.integration.test.ts` creates
-- it first and proves the grant took effect.
--
-- FULLY QUALIFIED. Nothing here depends on search_path.

DO $grant$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'qf_jarvis_runtime') THEN
    -- Reassert least privilege from a CLEAN SLATE. The two REVOKEs this replaced only stripped the
    -- schema and the `event` table — they left untouched any stale DIRECT grant the role may have
    -- picked up on `schema_migration`, on the identity sequence, or on the schema's functions
    -- (from a hand operation, an earlier migration, or a provider action). Those are exactly the
    -- surfaces least privilege must not leave open, so revoke ALL direct privileges across every
    -- object class in the schema, then grant back only the two this slice needs. Comprehensive and
    -- idempotent: the end state is independent of whatever the role held before.
    --
    -- These strip only DIRECT grants; they add no DEFAULT PRIVILEGES and change no ownership.
    REVOKE ALL ON SCHEMA qf_jarvis FROM qf_jarvis_runtime;
    REVOKE ALL ON ALL TABLES IN SCHEMA qf_jarvis FROM qf_jarvis_runtime;
    REVOKE ALL ON ALL SEQUENCES IN SCHEMA qf_jarvis FROM qf_jarvis_runtime;
    REVOKE ALL ON ALL FUNCTIONS IN SCHEMA qf_jarvis FROM qf_jarvis_runtime;

    GRANT USAGE ON SCHEMA qf_jarvis TO qf_jarvis_runtime;
    GRANT SELECT, INSERT ON qf_jarvis.event TO qf_jarvis_runtime;
  END IF;
END
$grant$;

-- Belt-and-braces on the table itself: PUBLIC never reaches the event log.
REVOKE ALL ON qf_jarvis.event FROM PUBLIC;
