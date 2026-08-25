-- JAO-3 operational investigation memory (QFJ-P12, ADR-0117).
--
-- ============================================================================
-- THIS IS NOT A MANAGED MIGRATION.
-- ============================================================================
--
-- It is a LOCAL schema asset, applied explicitly by the JAO-3 integration harness to a
-- disposable test database so that "durable" can be proved rather than asserted. It is
-- deliberately NOT in packages/event-backbone/src/persistence/migrations/, which is the
-- managed history that `pnpm db:migrate` applies and that the deployed database carries.
--
-- Appending to that history would make JAO-3 arrive in a real database as a side effect of
-- a routine migration run -- adopted by nobody, reviewed as part of nothing, and rolled out
-- by accident. Managed adoption is a separate decision that requires its own production
-- activation review. Until then: schema exists, rollout does not.
--
-- ============================================================================
-- What is stored, and what is structurally impossible to store
-- ============================================================================
--
-- Stored: bounded identifiers, closed status tokens, short auditable statements, evidence
-- REFERENCES, counters, budgets and instants.
--
-- Not stored, and there is nowhere to put it: chain-of-thought, a scratchpad, a model or
-- user transcript, a provider request or response body, a credential, an arbitrary blob.
-- There is no json/jsonb column in this file and no unbounded text column: every text
-- column carries a CHECK that bounds its length, so an unbounded value fails at the
-- database rather than at a reviewer's discretion.
--
-- Nothing here can express permission. There is no is_authorized, can_execute, can_send,
-- approval_granted or execution_allowed column, and an evidence reference pointing at a
-- historical approval is a pointer to something that was true once -- never a current one.
--
-- ============================================================================
-- Shape
-- ============================================================================
--
-- Forward-only. No DROP, no ALTER of anything pre-existing, no CASCADE, no trigger, no
-- extension, no superuser feature, no environment-specific value. Its own schema, so it
-- cannot collide with a managed object and a managed DROP SCHEMA cannot take it with it.
--
-- History is append-only by construction: the adapter issues no UPDATE or DELETE against
-- any child table, and UNIQUE (investigation_id, revision) means two writers cannot both
-- claim one revision. No trigger enforces this, because a trigger would be a second,
-- invisible place where the rule lives.

CREATE SCHEMA IF NOT EXISTS qf_jarvis_jao3;

-- ---------------------------------------------------------------------------
-- The investigation header. One row per investigation; the compare-and-set target.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS qf_jarvis_jao3.investigation (
  investigation_id                        text        NOT NULL,
  root_run_id                             text        NOT NULL,
  current_run_id                          text        NOT NULL,
  revision                                integer     NOT NULL,
  status                                  text        NOT NULL,
  objective                               text        NOT NULL,
  workflow_state                          text        NOT NULL,
  created_at                              timestamptz NOT NULL,
  updated_at                              timestamptz NOT NULL,
  expires_at                              timestamptz NOT NULL,
  superseded_by_investigation_id          text,
  latest_checkpoint_id                    text,
  checkpoint_count                        integer     NOT NULL,
  owner_correction_count                  integer     NOT NULL,
  resume_count                            integer     NOT NULL,
  budget_max_checkpoints                  integer     NOT NULL,
  budget_max_evidence_refs_per_checkpoint integer     NOT NULL,
  budget_max_hypotheses_per_checkpoint    integer     NOT NULL,
  budget_max_owner_corrections            integer     NOT NULL,
  budget_max_resume_count                 integer     NOT NULL,
  budget_max_lifetime_ms                  integer     NOT NULL,

  CONSTRAINT investigation_pk PRIMARY KEY (investigation_id),

  CONSTRAINT investigation_id_bounded
    CHECK (investigation_id ~ '^[A-Za-z0-9._:-]{1,128}$'),
  CONSTRAINT investigation_root_run_bounded
    CHECK (root_run_id ~ '^[A-Za-z0-9._:-]{1,128}$'),
  CONSTRAINT investigation_current_run_bounded
    CHECK (current_run_id ~ '^[A-Za-z0-9._:-]{1,128}$'),
  CONSTRAINT investigation_superseded_by_bounded
    CHECK (superseded_by_investigation_id IS NULL
           OR superseded_by_investigation_id ~ '^[A-Za-z0-9._:-]{1,128}$'),
  CONSTRAINT investigation_latest_checkpoint_bounded
    CHECK (latest_checkpoint_id IS NULL
           OR latest_checkpoint_id ~ '^[A-Za-z0-9._:-]{1,128}$'),

  CONSTRAINT investigation_revision_positive CHECK (revision >= 1),

  CONSTRAINT investigation_status_closed
    CHECK (status IN ('OPEN', 'PAUSED', 'COMPLETED', 'EXPIRED', 'SUPERSEDED')),
  CONSTRAINT investigation_workflow_state_closed
    CHECK (workflow_state IN ('DISCOVERY', 'ANALYSIS', 'AWAITING_OWNER_INPUT', 'SUMMARY')),

  CONSTRAINT investigation_objective_bounded
    CHECK (char_length(objective) BETWEEN 1 AND 240),

  -- Expiry must lie in the future of creation, or it is not an expiry.
  CONSTRAINT investigation_expires_after_created CHECK (expires_at > created_at),
  CONSTRAINT investigation_updated_not_before_created CHECK (updated_at >= created_at),

  -- A record cannot supersede itself: that is a loop, not a replacement.
  CONSTRAINT investigation_superseded_by_not_self
    CHECK (superseded_by_investigation_id IS NULL
           OR superseded_by_investigation_id <> investigation_id),

  -- The pointer and the status are one fact, so they cannot disagree.
  CONSTRAINT investigation_superseded_pointer_matches_status
    CHECK ((superseded_by_investigation_id IS NULL) = (status <> 'SUPERSEDED')),

  CONSTRAINT investigation_counts_non_negative
    CHECK (checkpoint_count >= 0 AND owner_correction_count >= 0 AND resume_count >= 0),

  -- The persisted budget may never exceed what JAO-3 grants. A row claiming more is not a
  -- generous configuration; it is a row that must not be honoured, and the database says so
  -- rather than trusting whichever process happens to read it.
  CONSTRAINT investigation_budget_within_ceiling
    CHECK (budget_max_checkpoints BETWEEN 1 AND 32
           AND budget_max_evidence_refs_per_checkpoint BETWEEN 1 AND 8
           AND budget_max_hypotheses_per_checkpoint BETWEEN 1 AND 4
           AND budget_max_owner_corrections BETWEEN 1 AND 16
           AND budget_max_resume_count BETWEEN 0 AND 16
           AND budget_max_lifetime_ms BETWEEN 1000 AND 604800000),

  -- Counters may never exceed the budget they are counted against.
  CONSTRAINT investigation_counts_within_budget
    CHECK (checkpoint_count <= budget_max_checkpoints
           AND owner_correction_count <= budget_max_owner_corrections
           AND resume_count <= budget_max_resume_count)
);

-- ---------------------------------------------------------------------------
-- Checkpoints. Immutable once written.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS qf_jarvis_jao3.checkpoint (
  checkpoint_id    text        NOT NULL,
  investigation_id text        NOT NULL,
  revision         integer     NOT NULL,
  run_id           text        NOT NULL,
  workflow_state   text        NOT NULL,
  summary          text        NOT NULL,
  next_objective   text,
  created_at       timestamptz NOT NULL,

  CONSTRAINT checkpoint_pk PRIMARY KEY (checkpoint_id),
  CONSTRAINT checkpoint_investigation_fk
    FOREIGN KEY (investigation_id) REFERENCES qf_jarvis_jao3.investigation (investigation_id),

  -- The arbitration constraint. Two writers cannot both create revision N, whatever the
  -- application believes about who won -- this is what makes "no lost update" a property of
  -- the database rather than of the code that happened to run.
  CONSTRAINT checkpoint_unique_revision UNIQUE (investigation_id, revision),

  CONSTRAINT checkpoint_id_bounded CHECK (checkpoint_id ~ '^[A-Za-z0-9._:-]{1,128}$'),
  CONSTRAINT checkpoint_run_bounded CHECK (run_id ~ '^[A-Za-z0-9._:-]{1,128}$'),
  CONSTRAINT checkpoint_revision_positive CHECK (revision >= 1),
  CONSTRAINT checkpoint_workflow_state_closed
    CHECK (workflow_state IN ('DISCOVERY', 'ANALYSIS', 'AWAITING_OWNER_INPUT', 'SUMMARY')),
  CONSTRAINT checkpoint_summary_bounded CHECK (char_length(summary) BETWEEN 1 AND 480),
  CONSTRAINT checkpoint_next_objective_bounded
    CHECK (next_objective IS NULL OR char_length(next_objective) BETWEEN 1 AND 240)
);

CREATE INDEX IF NOT EXISTS checkpoint_by_investigation_revision
  ON qf_jarvis_jao3.checkpoint (investigation_id, revision);

-- ---------------------------------------------------------------------------
-- Evidence REFERENCES. Pointers, never payloads.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS qf_jarvis_jao3.evidence_ref (
  checkpoint_id text        NOT NULL,
  ordinal       integer     NOT NULL,
  evidence_ref  text        NOT NULL,
  kind          text        NOT NULL,
  source_class  text        NOT NULL,
  observed_at   timestamptz NOT NULL,

  CONSTRAINT evidence_ref_pk PRIMARY KEY (checkpoint_id, ordinal),
  CONSTRAINT evidence_ref_checkpoint_fk
    FOREIGN KEY (checkpoint_id) REFERENCES qf_jarvis_jao3.checkpoint (checkpoint_id),

  CONSTRAINT evidence_ref_ordinal_bounded CHECK (ordinal BETWEEN 0 AND 7),
  CONSTRAINT evidence_ref_bounded CHECK (evidence_ref ~ '^[A-Za-z0-9._:-]{1,128}$'),
  CONSTRAINT evidence_ref_kind_bounded CHECK (char_length(kind) BETWEEN 1 AND 48),

  -- Closed, and deliberately authority-free. There is no APPROVAL_GRANT here.
  CONSTRAINT evidence_ref_source_class_closed
    CHECK (source_class IN ('CONTROL_PLANE_SNAPSHOT', 'SPECIALIST_ADVISORY',
                            'REPOSITORY_PROOF', 'OPERATOR_NOTE', 'TEST_FIXTURE'))
);

-- ---------------------------------------------------------------------------
-- Hypotheses. Bounded, and never business truth.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS qf_jarvis_jao3.hypothesis (
  checkpoint_id    text    NOT NULL,
  ordinal          integer NOT NULL,
  statement        text    NOT NULL,
  epistemic_status text    NOT NULL,
  authority        text    NOT NULL,

  CONSTRAINT hypothesis_pk PRIMARY KEY (checkpoint_id, ordinal),
  CONSTRAINT hypothesis_checkpoint_fk
    FOREIGN KEY (checkpoint_id) REFERENCES qf_jarvis_jao3.checkpoint (checkpoint_id),

  CONSTRAINT hypothesis_ordinal_bounded CHECK (ordinal BETWEEN 0 AND 3),
  CONSTRAINT hypothesis_statement_bounded CHECK (char_length(statement) BETWEEN 1 AND 240),
  CONSTRAINT hypothesis_epistemic_status_closed
    CHECK (epistemic_status IN ('HYPOTHESIS', 'OBSERVED', 'DISPROVED')),

  -- The strongest claim a stored hypothesis may carry, enforced by the database. There is
  -- no CONFIRMED_BUSINESS_TRUTH, no AUTHORIZED and no APPROVED_TO_EXECUTE to be written.
  CONSTRAINT hypothesis_authority_none CHECK (authority = 'NONE')
);

-- ---------------------------------------------------------------------------
-- Owner corrections. Append-only, auditable, and powerless.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS qf_jarvis_jao3.owner_correction (
  correction_id        text        NOT NULL,
  investigation_id     text        NOT NULL,
  revision             integer     NOT NULL,
  target_type          text        NOT NULL,
  target_id            text        NOT NULL,
  correction_statement text        NOT NULL,
  actor                text        NOT NULL,
  supersedes_target    boolean     NOT NULL,
  created_at           timestamptz NOT NULL,

  CONSTRAINT owner_correction_pk PRIMARY KEY (correction_id),
  CONSTRAINT owner_correction_investigation_fk
    FOREIGN KEY (investigation_id) REFERENCES qf_jarvis_jao3.investigation (investigation_id),

  -- A correction is a write like any other, so it takes a revision and cannot share one.
  CONSTRAINT owner_correction_unique_revision UNIQUE (investigation_id, revision),

  CONSTRAINT owner_correction_id_bounded CHECK (correction_id ~ '^[A-Za-z0-9._:-]{1,128}$'),
  CONSTRAINT owner_correction_target_bounded CHECK (target_id ~ '^[A-Za-z0-9._:-]{1,128}$'),
  CONSTRAINT owner_correction_revision_positive CHECK (revision >= 1),
  CONSTRAINT owner_correction_target_type_closed
    CHECK (target_type IN ('INVESTIGATION', 'CHECKPOINT', 'HYPOTHESIS')),
  CONSTRAINT owner_correction_statement_bounded
    CHECK (char_length(correction_statement) BETWEEN 1 AND 240),

  -- An injected label in an offline proof. This is NOT authentication, and the column grants
  -- nothing: a correction changes what the investigation remembers and nothing else.
  CONSTRAINT owner_correction_actor_founder CHECK (actor = 'FOUNDER'),
  CONSTRAINT owner_correction_supersedes CHECK (supersedes_target)
);

CREATE INDEX IF NOT EXISTS owner_correction_by_investigation_revision
  ON qf_jarvis_jao3.owner_correction (investigation_id, revision);

-- ---------------------------------------------------------------------------
-- Operation replay. What makes a retried write safe.
-- ---------------------------------------------------------------------------
--
-- A resuming caller genuinely does not know whether its previous attempt committed before
-- the connection dropped. The unique operation id answers that: the same operation id with
-- the same semantic payload returns the committed result and writes nothing, and the same
-- operation id with a DIFFERENT payload fails closed rather than quietly becoming a second
-- entry in the history.
--
-- Only a digest is stored. Keeping the payload would put a second, unbounded, unreviewed
-- copy of every summary and correction statement beside the governed one -- and it would be
-- the copy nobody remembered to check for transcripts.
CREATE TABLE IF NOT EXISTS qf_jarvis_jao3.operation_replay (
  operation_id       text        NOT NULL,
  investigation_id   text        NOT NULL,
  operation_kind     text        NOT NULL,
  payload_digest_hex text        NOT NULL,
  result_revision    integer     NOT NULL,
  result_child_id    text        NOT NULL,
  created_at         timestamptz NOT NULL,

  CONSTRAINT operation_replay_pk PRIMARY KEY (operation_id),
  CONSTRAINT operation_replay_investigation_fk
    FOREIGN KEY (investigation_id) REFERENCES qf_jarvis_jao3.investigation (investigation_id),

  CONSTRAINT operation_replay_id_bounded CHECK (operation_id ~ '^[A-Za-z0-9._:-]{1,128}$'),
  CONSTRAINT operation_replay_child_bounded CHECK (result_child_id ~ '^[A-Za-z0-9._:-]{1,128}$'),
  CONSTRAINT operation_replay_kind_closed
    CHECK (operation_kind IN ('APPEND_CHECKPOINT', 'APPEND_OWNER_CORRECTION')),
  CONSTRAINT operation_replay_digest_hex CHECK (payload_digest_hex ~ '^[0-9a-f]{64}$'),
  CONSTRAINT operation_replay_revision_positive CHECK (result_revision >= 1)
);
