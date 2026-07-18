-- 0003_ingestion_rejection_and_event_conflict.sql
--
-- The append-only ingestion-rejection log and conflicting-duplicate log (Stage 3.3.3, ADR-0031).
--
-- Migration 0001 created the immutable event log; 0002 granted the runtime role least privilege on
-- it. This migration adds the two boundary audit tables ADR-0020 §8/§9 require — and nothing else:
--
--   * qf_jarvis.ingestion_rejection — a rejected event never enters the store, so what is recorded
--     is a bounded, PAYLOAD-FREE audit row: a reason code, and safe evidence that a rejection
--     happened. No raw body, no payload, no signature bytes, no event id, no correlation id, no
--     validator message, no field path, and no UNBOUNDED sender-controlled content. reason_code and
--     issue_codes are repository-owned closed vocabularies; body_digest is computed by Jarvis from
--     the raw body (not copied from the sender). The one field derived from the sender is the
--     optional key_id — the CLAIMED signing-key id from the (sender-controlled) envelope, which is
--     sender-controlled but accepted only in the strict 1..128-char machine-token format.
--   * qf_jarvis.event_conflict — a conflicting duplicate (same eventId, different semantic digest)
--     is recorded, counted and alertable, while the original acceptance stands unmodified. It stores
--     the refused delivery's two one-way digests, its validated correlation id, and bounded signature
--     EVIDENCE (algorithm, key id, signed-at) — never a payload, never signature bytes, never the
--     subject. The ORIGINAL semantic digest is NOT copied here; it lives in the immutable
--     qf_jarvis.event parent row and is obtained by joining event_conflict.event_id -> event.event_id.
--
-- ADR-0031 narrows ADR-0020 §8 ("Conflicting payloads are stored") to store no payload at all —
-- digests and bounded evidence suffice for forensics, and refusing to keep a copy of refused,
-- potentially personal-data-bearing content is the more conservative, privacy-preserving choice
-- (ADR-0019 §7, ADR-0023 §10, ADR-0026). The complete ingest() composition that decides WHEN to
-- record a rejection or a conflict is Stage 3.3.4, and is not built here.
--
-- EVERYTHING LIVES IN "qf_jarvis". Every object is FULLY QUALIFIED. Nothing depends on search_path.
-- Both tables are append-only: a BEFORE UPDATE OR DELETE trigger (fires for every role, including
-- the owner) plus REVOKEs, exactly as the event log and the migration history are protected.

-- ---------------------------------------------------------------------------
-- The ingestion-rejection log
-- ---------------------------------------------------------------------------

CREATE TABLE qf_jarvis.ingestion_rejection (
  -- Ingestion order of rejections. Database-generated; never supplied by a caller.
  sequence          BIGINT      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

  -- The stable, countable reason the boundary refused the event.
  reason_code       TEXT        NOT NULL,

  -- The claimed signing key id, when the envelope parsed far enough to yield one; NULL otherwise
  -- (e.g. signature-missing / signature-malformed). Bounded machine token; sender-supplied but
  -- character-set-bounded, and it is the only envelope-derived value kept.
  key_id            TEXT,

  -- The verifier's OWN sha256(rawBody) (evidence), when computed; NULL when the rejection preceded
  -- hashing (e.g. body-too-large). A one-way hash, never the body.
  body_digest       BYTEA,

  -- The DISTINCT safe codes represented by the retained issues (closed vocabulary), deduplicated
  -- and sorted by the repository. Never a validator message, a field path, or a sender-controlled
  -- key. Several retained issues at different paths may legitimately share one code, so this set is
  -- USUALLY SMALLER than issue_count, and that is not truncation.
  issue_codes       TEXT[]      NOT NULL DEFAULT '{}',
  -- The number of bounded, safe issues the upstream layer RETAINED for this rejection (0..16). It
  -- may exceed cardinality(issue_codes) simply because several retained issues share a code.
  issue_count       SMALLINT    NOT NULL DEFAULT 0,
  -- An INDEPENDENT flag: the upstream, already-bounded source reported MORE issues than it retained
  -- (its own cap was exceeded). It is NOT derivable from issue_count vs cardinality(issue_codes) —
  -- the durable schema cannot infer truncation from code compression — so no CHECK ties them.
  issues_truncated  BOOLEAN     NOT NULL DEFAULT false,

  -- Database-generated. When we recorded the rejection is our fact, not the sender's.
  recorded_at       TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- --- Constraints ---------------------------------------------------------

  -- The exact current closed set of signature (ADR-0027) and validated-event-preparation (ADR-0030)
  -- rejection reasons. `duplicate-conflict` is deliberately absent — it is an event_conflict, not a
  -- rejection. Kept in step with the TypeScript INGESTION_REJECTION_REASON_CODES by a conformance
  -- test in @qf-jarvis/event-ingestion (which may depend on both packages; the reverse would cycle).
  CONSTRAINT ingestion_rejection_reason_code_is_known
    CHECK (reason_code IN (
      'body-too-large', 'signature-missing', 'signature-malformed', 'unsupported-algorithm',
      'signed-at-malformed', 'unknown-key-id', 'key-revoked', 'key-not-yet-valid', 'key-expired',
      'replay-window-expired', 'replay-window-future', 'body-digest-mismatch', 'signature-invalid',
      'contract-validation-failed', 'unknown-event-type', 'unknown-event-version'
    )),

  -- A signing key id is the bounded machine-token format the envelope parser enforces
  -- (^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$ — self-bounding to 1..128 chars), or NULL.
  CONSTRAINT ingestion_rejection_key_id_is_machine_token
    CHECK (key_id IS NULL OR key_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),

  -- SHA-256 is exactly 32 bytes, or the digest is absent.
  CONSTRAINT ingestion_rejection_body_digest_is_sha256
    CHECK (body_digest IS NULL OR octet_length(body_digest) = 32),

  -- issue_count is bounded to 0..MAX_INGESTION_REJECTION_ISSUES (16).
  CONSTRAINT ingestion_rejection_issue_count_bounds
    CHECK (issue_count BETWEEN 0 AND 16),

  -- At most 16 distinct issue codes.
  CONSTRAINT ingestion_rejection_issue_codes_bounded
    CHECK (cardinality(issue_codes) <= 16),

  -- Only the closed, repository-owned safe issue-code vocabulary (ADR-0030). `<@` = contained by.
  CONSTRAINT ingestion_rejection_issue_codes_are_safe
    CHECK (issue_codes <@ ARRAY[
      'required', 'invalid-type', 'invalid-format', 'invalid-value',
      'unknown-field', 'constraint-violation', 'malformed-body'
    ]::text[]),

  -- No duplicate issue codes. A table CHECK cannot use a subquery/aggregate to test set-distinctness
  -- directly; the vocabulary is closed, so we assert each code occurs at most once (array_positions
  -- returns the subscripts of every occurrence; NULL for an absent code passes). The repository also
  -- deduplicates before insertion, so this is a backstop rather than the primary guarantee.
  CONSTRAINT ingestion_rejection_issue_codes_distinct
    CHECK (
      cardinality(array_positions(issue_codes, 'required')) <= 1
      AND cardinality(array_positions(issue_codes, 'invalid-type')) <= 1
      AND cardinality(array_positions(issue_codes, 'invalid-format')) <= 1
      AND cardinality(array_positions(issue_codes, 'invalid-value')) <= 1
      AND cardinality(array_positions(issue_codes, 'unknown-field')) <= 1
      AND cardinality(array_positions(issue_codes, 'constraint-violation')) <= 1
      AND cardinality(array_positions(issue_codes, 'malformed-body')) <= 1
    ),

  -- The retained-issue count is at least the number of distinct codes those issues carry (you
  -- cannot represent N distinct codes with fewer than N retained issues). It may be strictly
  -- greater when retained issues share codes — that is normal compression, NOT truncation.
  CONSTRAINT ingestion_rejection_count_ge_cardinality
    CHECK (issue_count >= cardinality(issue_codes))

  -- NOTE: there is deliberately NO constraint tying issues_truncated to issue_count vs
  -- cardinality(issue_codes). Truncation is whether the bounded upstream source dropped issues
  -- beyond its retained list; it is an independent fact the schema cannot infer from code
  -- compression. `issue_count > cardinality(issue_codes)` with `issues_truncated = false` is valid.
);

COMMENT ON TABLE qf_jarvis.ingestion_rejection IS
  'Append-only, PAYLOAD-FREE record of boundary rejections (ADR-0020 §9, ADR-0031). UPDATE and '
  'DELETE are refused by trigger. Carries a bounded reason code and safe evidence only — never a '
  'raw body, payload, signature bytes, event id, correlation id, validator message, field path, or '
  'any unbounded sender-controlled content. reason_code and issue_codes are repository-owned closed '
  'vocabularies; body_digest is computed by Jarvis, not copied from the sender. The optional key_id '
  'is the claimed signing-key id from the sender-controlled envelope, kept only in the strict '
  '1..128-char machine-token format.';

-- ---------------------------------------------------------------------------
-- The conflicting-duplicate log
-- ---------------------------------------------------------------------------

CREATE TABLE qf_jarvis.event_conflict (
  -- Order of recorded conflicts. Database-generated.
  sequence                          BIGINT      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

  -- The idempotency identity that conflicted. The FK guarantees the original accepted event exists
  -- and is referenced, unchanged; the parent is append-only, so it is never deleted.
  event_id                          UUID        NOT NULL,

  -- The refused delivery's semantic digest (differs from the accepted event's, by construction) and
  -- its raw-body digest. One-way hashes; evidence. The ORIGINAL semantic digest is NOT stored here —
  -- it is joined from qf_jarvis.event, so there is exactly one copy that cannot drift.
  conflicting_semantic_event_digest BYTEA       NOT NULL,
  conflicting_body_digest           BYTEA       NOT NULL,

  -- The refused delivery's correlation id — preserved because the conflicting event passed contract
  -- validation, so it is bounded and safe.
  conflicting_correlation_id        UUID        NOT NULL,

  -- Signature EVIDENCE for the refused delivery: which algorithm and key signed it, and when.
  -- NEVER the signature bytes.
  conflicting_signature_algorithm   TEXT        NOT NULL,
  conflicting_signature_key_id      TEXT        NOT NULL,
  conflicting_signature_signed_at   TIMESTAMPTZ NOT NULL,

  -- Database-generated.
  recorded_at                       TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- --- Constraints ---------------------------------------------------------

  -- The original accepted event must exist. Deliberately NOT unique on event_id: every verified
  -- conflicting delivery is its own audit fact and gets its own row (ADR-0031).
  CONSTRAINT event_conflict_event_fk
    FOREIGN KEY (event_id) REFERENCES qf_jarvis.event (event_id),

  CONSTRAINT event_conflict_semantic_digest_is_sha256
    CHECK (octet_length(conflicting_semantic_event_digest) = 32),
  CONSTRAINT event_conflict_body_digest_is_sha256
    CHECK (octet_length(conflicting_body_digest) = 32),

  -- ADR-0020 approves exactly one algorithm.
  CONSTRAINT event_conflict_signature_algorithm_is_ed25519
    CHECK (conflicting_signature_algorithm = 'ed25519'),

  -- The bounded machine-token format for a signing key id.
  CONSTRAINT event_conflict_signature_key_id_is_machine_token
    CHECK (conflicting_signature_key_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$')
);

COMMENT ON TABLE qf_jarvis.event_conflict IS
  'Append-only record of conflicting duplicates (ADR-0020 §8, ADR-0031). UPDATE and DELETE are '
  'refused by trigger. Stores the refused delivery''s digests, validated correlation id, and bounded '
  'signature evidence — never a payload, signature bytes, or subject. The original accepted event '
  'stands unmodified in qf_jarvis.event; its semantic digest is joined, not copied.';

-- ---------------------------------------------------------------------------
-- Immutability — append-only, exactly as the event log and migration history
-- ---------------------------------------------------------------------------

CREATE FUNCTION qf_jarvis.ingestion_rejection_reject_mutation() RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION
    'The ingestion-rejection log is append-only: % is not permitted on table '
    '"qf_jarvis.ingestion_rejection". Rejection records are immutable audit facts.',
    TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$;

COMMENT ON FUNCTION qf_jarvis.ingestion_rejection_reject_mutation() IS
  'Refuses UPDATE and DELETE on the ingestion-rejection log. Fires for every role, including the owner.';

CREATE TRIGGER ingestion_rejection_is_immutable
  BEFORE UPDATE OR DELETE ON qf_jarvis.ingestion_rejection
  FOR EACH ROW
  EXECUTE FUNCTION qf_jarvis.ingestion_rejection_reject_mutation();

CREATE FUNCTION qf_jarvis.event_conflict_reject_mutation() RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION
    'The event-conflict log is append-only: % is not permitted on table '
    '"qf_jarvis.event_conflict". Conflict records are immutable audit facts.',
    TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$;

COMMENT ON FUNCTION qf_jarvis.event_conflict_reject_mutation() IS
  'Refuses UPDATE and DELETE on the event-conflict log. Fires for every role, including the owner.';

CREATE TRIGGER event_conflict_is_immutable
  BEFORE UPDATE OR DELETE ON qf_jarvis.event_conflict
  FOR EACH ROW
  EXECUTE FUNCTION qf_jarvis.event_conflict_reject_mutation();

-- ---------------------------------------------------------------------------
-- Access — belt-and-braces PUBLIC revoke, and runtime column-level least privilege
-- ---------------------------------------------------------------------------
--
-- The schema-level revoke from the runner bootstrap already makes every object here unreachable by
-- name without USAGE; these table-level revokes cost nothing and state the intent locally. The
-- managed provider's roles (anon/authenticated/service_role) are revoked from ALL TABLES by the
-- bootstrap's conditional DO block on every migration run, so the new tables are covered there.

REVOKE ALL ON qf_jarvis.ingestion_rejection FROM PUBLIC;
REVOKE ALL ON qf_jarvis.event_conflict FROM PUBLIC;

DO $grant$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'qf_jarvis_runtime') THEN
    -- Comprehensive clean-slate reassertion, as migration 0002 does: strip every DIRECT privilege
    -- across all object classes, then grant back only what this slice needs. This supersedes 0002's
    -- grant set and extends it to the two new audit tables — column-level, and nothing wider. It
    -- adds no DEFAULT PRIVILEGES and changes no ownership.
    REVOKE ALL ON SCHEMA qf_jarvis FROM qf_jarvis_runtime;
    REVOKE ALL ON ALL TABLES IN SCHEMA qf_jarvis FROM qf_jarvis_runtime;
    REVOKE ALL ON ALL SEQUENCES IN SCHEMA qf_jarvis FROM qf_jarvis_runtime;
    REVOKE ALL ON ALL FUNCTIONS IN SCHEMA qf_jarvis FROM qf_jarvis_runtime;

    GRANT USAGE ON SCHEMA qf_jarvis TO qf_jarvis_runtime;

    -- The event log: restore the existing SELECT + INSERT (as 0002 granted).
    GRANT SELECT, INSERT ON qf_jarvis.event TO qf_jarvis_runtime;

    -- The audit tables: column-level INSERT on ONLY the caller-supplied columns — never the
    -- database-generated sequence or recorded_at — and SELECT on ONLY sequence + recorded_at, so
    -- INSERT ... RETURNING works. There is deliberately NO general table SELECT: the runtime appends
    -- and reads back its own generated keys, but cannot read what was rejected or what conflicted.
    GRANT INSERT (reason_code, key_id, body_digest, issue_codes, issue_count, issues_truncated)
      ON qf_jarvis.ingestion_rejection TO qf_jarvis_runtime;
    GRANT SELECT (sequence, recorded_at)
      ON qf_jarvis.ingestion_rejection TO qf_jarvis_runtime;

    GRANT INSERT (
      event_id,
      conflicting_semantic_event_digest, conflicting_body_digest,
      conflicting_correlation_id,
      conflicting_signature_algorithm, conflicting_signature_key_id, conflicting_signature_signed_at
    ) ON qf_jarvis.event_conflict TO qf_jarvis_runtime;
    GRANT SELECT (sequence, recorded_at)
      ON qf_jarvis.event_conflict TO qf_jarvis_runtime;
  END IF;
END
$grant$;
