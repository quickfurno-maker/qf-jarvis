-- 0014_conversation_prospect_party_type.sql
--
-- Make PROSPECT a DURABLE party type (JF-4B/C/D owner correction, ADR-0150 §2a).
--
-- ### Why this migration exists
--
-- ADR-0150 added `PROSPECT` to `RUNTIME_PARTY_TYPES` so the runtime could represent the net-new,
-- unregistered acquisition prospect that Aarohi's already-certified AVG domain owns. Migration 0008
-- wrote `conversation_runtime_state_party_type_known` with the three party types that existed then, so
-- an Aarohi conversation could be routed and decided in memory and then refused by a CHECK constraint
-- the moment the authoritative durable store tried to persist it.
--
-- That is not a production-ready runtime. The alternative — storing a prospect as `VENDOR` or
-- `UNKNOWN` — was rejected explicitly: Aarohi's contracts state that a prospect is NOT a Core vendor,
-- and writing one into the vendor slot would make the durable record assert the single thing the
-- acquisition domain exists to deny. A durable store that lies is worse than one that refuses.
--
-- ### What this migration does, and the list is exhaustive
--
-- It drops and recreates ONE named CHECK constraint on ONE existing column, widening its permitted set
-- from three values to four. That is all.
--
--   before: CHECK (party_type IN ('CLIENT', 'VENDOR', 'UNKNOWN'))
--   after:  CHECK (party_type IN ('CLIENT', 'VENDOR', 'PROSPECT', 'UNKNOWN'))
--
-- ### What it deliberately does NOT do
--
--   * no new table, column, index, sequence, type or view;
--   * no DEFAULT change, so nothing decides a party type on a caller's behalf;
--   * no row transformation, backfill or UPDATE — every pre-existing row is already valid under the
--     wider constraint, because widening a set cannot invalidate a member of the narrower one;
--   * no GRANT, REVOKE or role change of any kind. In particular the projection role still holds no
--     SELECT on the event-log payload column, which three existing least-privilege tests assert;
--   * no D5 activation and no projection registration;
--   * no change to any other CHECK, including `data_class` and `subject_status`.
--
-- ### Ordering and safety
--
-- `DROP CONSTRAINT ... IF EXISTS` then `ADD CONSTRAINT` inside the runner's transaction, so the table
-- is never left without the constraint from another session's point of view. PostgreSQL validates the
-- new CHECK against existing rows as it adds it, which is the behaviour we want: if a row somehow held
-- a value outside the wider set, this migration fails loudly rather than accepting it.
--
-- No table rewrite is required. Adding a CHECK constraint takes an ACCESS EXCLUSIVE lock for the
-- duration of the validation scan and rewrites nothing.
--
-- ### Scope of application
--
-- Repository and LOCAL/CI only. Nothing here is applied to a managed database by this slice; JF-6 owns
-- managed-database parity and application, with real deployment authority.

ALTER TABLE qf_jarvis.conversation_runtime_state
  DROP CONSTRAINT IF EXISTS conversation_runtime_state_party_type_known;

ALTER TABLE qf_jarvis.conversation_runtime_state
  ADD CONSTRAINT conversation_runtime_state_party_type_known
    CHECK (party_type IN ('CLIENT', 'VENDOR', 'PROSPECT', 'UNKNOWN'));
