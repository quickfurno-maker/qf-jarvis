-- 0010_execution_replay_claim.sql
--
-- Durable execution replay / idempotency claim (QFJ-P09.03, ADR-0091).
--
-- QFJ-P09.02 (ADR-0090) built the B4 execution-dispatch verifier and deliberately shipped NO
-- production replay store. Its `ExecutionReplayGuard` is REQUIRED and injected, with no default,
-- because neither available default is safe: an in-memory guard passes every test and loses its
-- state on every restart, and a permissive guard turns "unknown" into "first seen". This migration
-- supplies the durability that makes the guard a fact rather than a process-lifetime promise.
--
-- WHAT THIS TABLE IS. One row per execution claim that has crossed the B4 boundary. It answers
-- exactly one question:
--
--     has this exact (executionIntentId, idempotencyKey, verifier-computed digest) been claimed?
--
-- WHAT THIS TABLE IS NOT. It is COORDINATION, never AUTHORITY -- the same distinction 0009 draws
-- for the approval slot. There is no `status`, `authorized`, `approved`, `can_execute`, `sent`,
-- `delivered`, `executed` or `outcome` column anywhere below, and no trigger derives one. A row
-- here does not mean anything may happen and does not mean anything did. Jarvis recommends,
-- QuickFurno Core authorizes, n8n executes, providers deliver, results return to Core; this table
-- adds durability to a duplicate-prevention fact and creates no execution authority.
--
-- NO EXECUTABLE PAYLOAD IS STORED, and that is load-bearing rather than merely tidy. ADR-0090 §8
-- removed the `ExecutionIntentV1` from the exact-replay result so that a caller holding a replay
-- observation has no executable instruction to act on a second time. A replay store that persisted
-- the intent and handed it back would reintroduce exactly what that change removed. So there is no
-- payload column, no parameters, no recipient, no phone number, no email, no message body, no
-- consent, no approval evidence, no credential, no webhook, no URL, no workflow id and no provider
-- result. Three bound values, two bookkeeping columns, nothing else.
--
-- NO TENANT COLUMN. `ExecutionIntentV1` carries no tenant, organization, workspace or account
-- identity, and no canonical contract in this repository establishes one at B4. Adding a scoping
-- column here would invent an authority model rather than record one, so uniqueness is global,
-- exactly as the identifiers themselves are.
--
-- NO RETENTION. There is no TTL, no cleanup job, no sweeper, no archive and no partition expiry.
-- Deleting a replay claim converts an old duplicate back into a first-seen, which is the precise
-- failure this table exists to prevent. The safe retention horizon depends on real transport
-- retry/replay behaviour, and no Core -> n8n transport has been adopted. `claimed_at` is recorded so
-- that a future, separately reviewed retention decision has something to reason about; this
-- migration defines no policy.
--
-- THE WIRE PROTOCOL IS STILL PROPOSED. Persisting the replay fact does NOT mean the Core -> n8n
-- envelope has been adopted. Nothing stored here is a transport artifact: not an endpoint, not a
-- header, not a credential, not a workflow id.
--
-- Managed status is unchanged: 0010 is LOCAL/CI only, exactly as 0002-0009; the managed database
-- still carries only 0001. This migration was not applied to it.
--
-- EVERYTHING LIVES IN "qf_jarvis". Every object is FULLY QUALIFIED. Nothing depends on search_path.

-- ---------------------------------------------------------------------------
-- 1. The claim -- three bound values, and nothing that could become a permission
-- ---------------------------------------------------------------------------
--
-- WHY ALL THREE VALUES ARE BOUND. ADR-0090 §7 names each gap that binding fewer would leave open:
-- binding only the intent id lets the same intent be re-sent under a fresh key; binding only the
-- key lets one key be reused for a different intent; binding neither to the digest lets the SAME id
-- and key carry different bytes. Each is a distinct way to smuggle a second effect past a boundary
-- that checked the obvious field.
--
-- WHY UNIQUENESS IS INDEPENDENT ON TWO COLUMNS. A single composite key over
-- (execution_intent_id, idempotency_key) would accept BOTH of the first two smuggling routes: the
-- pair (A, k2) does not collide with (A, k1), and (B, k1) does not collide with (A, k1). So the
-- intent id is the PRIMARY KEY and the idempotency key carries its OWN unique constraint. Those two
-- constraints are what arbitrate a concurrent race -- the database decides who won, and the losing
-- caller reconciles read-only afterwards. There is no application lock, no advisory lock and no
-- retry.

CREATE TABLE qf_jarvis.execution_replay_claim (
  -- Identity 1. From the parsed, contract-valid ExecutionIntentV1. The canonical grammar is a UUID
  -- (`executionIntentIdSchema`), so the column type IS the check -- a redundant regex here would be
  -- a second definition free to drift from the contract.
  execution_intent_id UUID        NOT NULL,

  -- Identity 2. Independently unique: one key may bind to exactly one intent, forever.
  --
  -- The CHECK restates the canonical `idempotencyKeySchema` grammar EXACTLY -- 16 to 128 characters
  -- of [A-Za-z0-9._:-] -- neither broadened nor narrowed. It is here as a CONTAINMENT invariant, not
  -- as a business rule: the excluded characters are the ones that would let a phone number, an
  -- email address or a sentence be stored in a column that must only ever hold an opaque token.
  -- Changing the canonical grammar requires a superseding migration, deliberately.
  idempotency_key     TEXT        NOT NULL,

  -- The VERIFIER-COMPUTED hex(sha256(rawBody)). Never the envelope's claimed digest -- ADR-0090 §5
  -- makes that a compile-time impossibility upstream, and this column stores the result.
  --
  -- Lowercase hex only, as 0009 does for action_fingerprint: an uppercase digest is a different
  -- string meaning the same thing, and a comparison that depended on case would be a comparison
  -- that sometimes lies.
  body_digest_hex     CHAR(64)    NOT NULL,

  -- Fixed at the current record shape, exactly as 0009's audit does. A future shape change is a
  -- migration, not a silently mixed table.
  record_version      SMALLINT    NOT NULL DEFAULT 1,

  -- Durable audit timing ONLY. It is not freshness, not authority, and nothing reads it to decide
  -- an outcome: a claim is not "stale" and cannot expire. Signature freshness and intent expiry are
  -- the verifier's questions, answered against an INJECTED now before this table is ever reached.
  claimed_at          TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),

  CONSTRAINT execution_replay_claim_pk
    PRIMARY KEY (execution_intent_id),
  CONSTRAINT execution_replay_claim_idempotency_key_unique
    UNIQUE (idempotency_key),
  CONSTRAINT execution_replay_claim_idempotency_key_is_opaque_token
    CHECK (idempotency_key ~ '^[A-Za-z0-9._:-]{16,128}$'),
  CONSTRAINT execution_replay_claim_digest_is_lowercase_sha256
    CHECK (body_digest_hex ~ '^[a-f0-9]{64}$'),
  CONSTRAINT execution_replay_claim_record_version_is_one
    CHECK (record_version = 1)
);

COMMENT ON TABLE qf_jarvis.execution_replay_claim IS
  'Append-only. One row per execution claim that has crossed the QFJ-P09.02 B4 dispatch boundary. '
  'Coordination only, never authority: there is no status, approved, authorized, can_execute, sent, '
  'delivered or executed column, and a row does not mean anything may happen or did. Stores exactly '
  'three bound values - executionIntentId, idempotencyKey and the VERIFIER-computed body digest - '
  'and NO ExecutionIntentV1 payload, parameters, recipient, contact detail, consent, credential, '
  'transport artifact or provider result. Uniqueness is independent on execution_intent_id and '
  'idempotency_key so the database arbitrates concurrent claims. No tenant scope, no retention.';

COMMENT ON COLUMN qf_jarvis.execution_replay_claim.claimed_at IS
  'Durable audit timing only. Not freshness and not authority: a claim never expires, and no '
  'retention policy is defined by this migration.';

-- ---------------------------------------------------------------------------
-- 2. Append-only -- a claim is a permanent duplicate-prevention fact
-- ---------------------------------------------------------------------------
--
-- UPDATE and DELETE are both refused, and the reasons differ.
--
-- A DELETE turns an old duplicate back into a first-seen, which is the exact duplicate provider
-- effect this table exists to prevent -- and it is the operation a well-meaning cleanup job would
-- reach for first.
--
-- An UPDATE is worse, because it is quieter: rebinding an existing intent id to a different key or
-- a different digest would let a contradiction be laundered into an exact replay, so the
-- classification a caller receives would be a statement about a row somebody edited rather than
-- about what actually crossed the boundary.
--
-- This lives in the database rather than only in the adapter because the adapter is one caller. A
-- console session, a future second writer or a later migration could otherwise edit a claim, and a
-- duplicate-prevention record that can be edited after the fact does not prevent duplicates.
--
-- A NEW function rather than reusing 0009's `qf_jarvis.approval_append_only()`: that one is named
-- for the approval domain, and sharing it would put one edit between two unrelated tables'
-- guarantees. This one is scoped to the object it protects.

CREATE OR REPLACE FUNCTION qf_jarvis.execution_replay_claim_append_only()
  RETURNS trigger
  LANGUAGE plpgsql
AS $append_only$
BEGIN
  RAISE EXCEPTION
    'qf_jarvis.% is append-only', TG_TABLE_NAME
    USING ERRCODE = 'restrict_violation';
END
$append_only$;

COMMENT ON FUNCTION qf_jarvis.execution_replay_claim_append_only() IS
  'Refuses UPDATE and DELETE on the execution replay claim. A DELETE would turn an old duplicate '
  'back into a first-seen; an UPDATE would let a contradiction be laundered into an exact replay. '
  'Neither is a correction, and both defeat the reason the table exists.';

CREATE TRIGGER execution_replay_claim_append_only_trigger
  BEFORE UPDATE OR DELETE ON qf_jarvis.execution_replay_claim
  FOR EACH ROW EXECUTE FUNCTION qf_jarvis.execution_replay_claim_append_only();

-- ---------------------------------------------------------------------------
-- 3. Access -- belt-and-braces revokes, then least privilege
-- ---------------------------------------------------------------------------

REVOKE ALL ON qf_jarvis.execution_replay_claim FROM PUBLIC;

DO $deny$
DECLARE
  managed_role text;
BEGIN
  FOREACH managed_role IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = managed_role) THEN
      EXECUTE format('REVOKE ALL ON qf_jarvis.execution_replay_claim FROM %I', managed_role);
    END IF;
  END LOOP;
END
$deny$;

-- `qf_jarvis_runtime` is a DEPLOYMENT role: it does not exist on a laptop or in CI, so the grants
-- are conditional exactly as 0002, 0007, 0008 and 0009 do it.
--
-- SELECT and INSERT only. No UPDATE, no DELETE, no TRUNCATE anywhere -- the trigger refuses the
-- first two, and a privilege that is never legitimate should not be granted either. There is
-- deliberately no column-level UPDATE grant of any kind: unlike 0009's slot pointer, NOTHING in
-- this table is ever meant to move.
DO $grant$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'qf_jarvis_runtime') THEN
    GRANT USAGE ON SCHEMA qf_jarvis TO qf_jarvis_runtime;
    GRANT SELECT, INSERT ON qf_jarvis.execution_replay_claim TO qf_jarvis_runtime;
  END IF;
END
$grant$;
