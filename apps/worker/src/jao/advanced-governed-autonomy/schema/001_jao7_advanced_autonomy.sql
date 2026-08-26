-- JAO-7 advanced governed autonomy: durable orchestration CONTROL STATE (ADR-0121).
--
-- THIS IS A LOCAL ASSET. It is applied explicitly by the JAO-7 integration harness to a disposable
-- loopback test database. It is deliberately NOT in event-backbone's managed migration history, is
-- not wired to `pnpm db:migrate`, is not applied by any production startup path, and has been
-- applied to no managed database. Managed adoption requires a separate production-activation review.
--
-- ### What this schema is for, and what it deliberately cannot hold
--
-- JAO-7 claims that a long-running autonomous mission survives a restart with its budgets, its kill
-- switch, its expiry, its plan and its virtual sandbox intact. A schema is the only place that claim
-- can be true: an in-memory store passes every test that never opens a connection.
--
-- What it holds is CONTROL STATE and DIGESTS. There is no jsonb column, no unbounded text column, no
-- raw approval decision, no raw execution intent, no model transcript, no credential, no contact
-- detail and no business record anywhere below. That is not an omission to be filled in later: a row
-- that could carry a reusable permission is a row somebody eventually reads as one, long after the
-- artifact it came from expired.
--
-- It is also NOT JAO-3. JAO-3 holds non-authoritative investigation memory and is untouched here.

CREATE SCHEMA IF NOT EXISTS qf_jarvis_jao7;

-- ---------------------------------------------------------------------------
-- The run header.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS qf_jarvis_jao7.autonomy_run (
  run_id                  text        NOT NULL,
  mission_policy_id       text        NOT NULL,
  mission_policy_version  integer     NOT NULL,

  -- The reviewed policy and the reviewed plan, as they stood at enrolment. Re-checked on every
  -- claim, so a policy edited mid-flight stops the run instead of silently re-scoping it.
  mission_policy_digest   text        NOT NULL,
  plan_digest             text        NOT NULL,

  subject_type            text        NOT NULL,
  subject_id              text        NOT NULL,

  state                   text        NOT NULL,
  current_step_index      integer     NOT NULL,

  -- The compare-and-set token. Every mutation states the revision it believed it was acting on.
  revision                integer     NOT NULL,

  enrolled_at             timestamptz NOT NULL,
  expires_at              timestamptz NOT NULL,
  killed_at               timestamptz,
  paused_at               timestamptz,

  -- Budgets. Durable because a budget a restart forgets is a budget an unstable system removes.
  resume_count            integer     NOT NULL DEFAULT 0,
  steps_completed         integer     NOT NULL DEFAULT 0,
  specialist_calls        integer     NOT NULL DEFAULT 0,
  tool_calls              integer     NOT NULL DEFAULT 0,
  model_calls             integer     NOT NULL DEFAULT 0,
  rehearsal_applies       integer     NOT NULL DEFAULT 0,

  -- THE PROPOSAL BINDING, written once when the proposal step commits.
  --
  -- The canonical artifacts themselves are NOT persisted -- a stored RecommendationV1 would be a
  -- second copy free to drift from the one a human saw. What is stored is the identity a later
  -- authority correlation must match: a caller that comes back with a DIFFERENT proposal is refused
  -- by this row rather than trusted because it happened to be holding one.
  proposal_recommendation_id   text,
  proposal_action_id           text,
  proposal_action_fingerprint  text,

  -- THE DERIVED SPECIALIST OBSERVATION, written when the Riya step commits.
  --
  -- Closed codes and one digest. No conversation, no prose, no reasoning trace: what is durable is
  -- WHAT WAS CONCLUDED and WHICH bounded advisory concluded it. The proposal is derived from these
  -- columns rather than from anything a caller supplies, so a derivation that vanished on restart
  -- would be no derivation at all.
  specialist_task_reason_code  text,
  specialist_task_class        text,
  specialist_due_window_code   text,
  specialist_priority_band     text,
  specialist_advisory_digest   text,

  created_at              timestamptz NOT NULL,
  updated_at              timestamptz NOT NULL,

  CONSTRAINT autonomy_run_pk PRIMARY KEY (run_id),

  -- All five, or none. A half-written specialist observation is one nobody could derive from.
  CONSTRAINT autonomy_run_specialist_observation_consistent
    CHECK (
      (specialist_task_reason_code IS NULL AND specialist_task_class IS NULL
        AND specialist_due_window_code IS NULL AND specialist_priority_band IS NULL
        AND specialist_advisory_digest IS NULL)
      OR
      (specialist_task_reason_code ~ '^[a-z0-9-]{1,64}$'
        AND specialist_task_class ~ '^[a-z0-9-]{1,64}$'
        AND specialist_due_window_code ~ '^[a-z0-9-]{1,64}$'
        AND specialist_priority_band ~ '^[a-z0-9-]{1,64}$'
        AND specialist_advisory_digest ~ '^[0-9a-f]{64}$')
    ),

  -- All three, or none. A half-written binding would be a binding nobody could check.
  CONSTRAINT autonomy_run_proposal_binding_consistent
    CHECK (
      (proposal_recommendation_id IS NULL AND proposal_action_id IS NULL
        AND proposal_action_fingerprint IS NULL)
      OR
      (proposal_recommendation_id ~ '^[A-Za-z0-9._:-]{1,128}$'
        AND proposal_action_id ~ '^[A-Za-z0-9._:-]{1,128}$'
        AND proposal_action_fingerprint ~ '^[0-9a-f]{64}$')
    ),

  CONSTRAINT autonomy_run_id_bounded
    CHECK (run_id ~ '^[A-Za-z0-9._:-]{1,128}$'),
  CONSTRAINT autonomy_run_mission_bounded
    CHECK (mission_policy_id ~ '^[A-Za-z0-9._:-]{1,128}$'),
  CONSTRAINT autonomy_run_subject_bounded
    CHECK (subject_type ~ '^[a-z0-9-]{1,64}$' AND subject_id ~ '^[A-Za-z0-9._:-]{1,128}$'),
  CONSTRAINT autonomy_run_digests_bounded
    CHECK (mission_policy_digest ~ '^[0-9a-f]{64}$' AND plan_digest ~ '^[0-9a-f]{64}$'),

  -- THE CLOSED STATE MACHINE. Note what is absent: no AUTHORIZED, no CAN_EXECUTE, no SEND_ALLOWED.
  -- A state a system can express is a state it eventually reaches.
  CONSTRAINT autonomy_run_state_closed
    CHECK (state IN (
      'PLANNED',
      'IN_PROGRESS',
      'AWAITING_AUTHORITY',
      'AUTHORITY_EVIDENCE_VALIDATED_FOR_REHEARSAL',
      'REHEARSAL_APPLIED',
      'VERIFYING',
      'ROLLING_BACK',
      'COMPLETED',
      'PAUSED',
      'KILLED',
      'EXPIRED',
      'FAILED_SAFE'
    )),

  CONSTRAINT autonomy_run_indices_bounded
    CHECK (current_step_index BETWEEN 0 AND 64 AND steps_completed BETWEEN 0 AND 64),
  CONSTRAINT autonomy_run_revision_positive
    CHECK (revision >= 1),

  -- Budget ceilings the DATABASE enforces, not merely the application. If every guard in the
  -- adapter were deleted, a run still could not spend a second specialist call or a second apply.
  CONSTRAINT autonomy_run_budgets_bounded
    CHECK (
      resume_count      BETWEEN 0 AND 64
      AND specialist_calls  BETWEEN 0 AND 4
      AND tool_calls        BETWEEN 0 AND 8
      AND rehearsal_applies BETWEEN 0 AND 1
    ),

  -- Zero model calls, as a constraint rather than as a claim.
  CONSTRAINT autonomy_run_no_model_calls
    CHECK (model_calls = 0),

  CONSTRAINT autonomy_run_expiry_after_enrolment
    CHECK (expires_at > enrolled_at),

  -- A killed run has a kill instant, and only a killed run has one.
  CONSTRAINT autonomy_run_kill_consistent
    CHECK ((state = 'KILLED') = (killed_at IS NOT NULL)),

  -- A paused run has a pause instant, and only a paused run has one.
  CONSTRAINT autonomy_run_pause_consistent
    CHECK ((state = 'PAUSED') = (paused_at IS NOT NULL))
);

-- ---------------------------------------------------------------------------
-- The steps.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS qf_jarvis_jao7.autonomy_step (
  run_id        text        NOT NULL,
  step_index    integer     NOT NULL,

  -- WHICH ATTEMPT AT THAT PLAN POSITION THIS IS.
  --
  -- The plan index used to advance after every completed step, including a completed
  -- VALIDATE_AUTHORITY_EVIDENCE that had proved NOTHING -- so a run left AWAITING_AUTHORITY was
  -- already pointing at REHEARSE_REVERSIBLE_EFFECT, and the gate it was waiting behind had already
  -- been walked past. The fix is that an incomplete or rejected validation RETAINS the plan
  -- position, which means that position has to be claimable again. One row per attempt keeps the
  -- audit trail honest about how many times it was tried, and `max_steps` bounds the total.
  attempt_index integer     NOT NULL,
  step_type     text        NOT NULL,
  step_status   text        NOT NULL,
  operation_id  text        NOT NULL,
  started_at    timestamptz NOT NULL,
  completed_at  timestamptz,
  outcome_code  text,

  CONSTRAINT autonomy_step_run_fk
    FOREIGN KEY (run_id) REFERENCES qf_jarvis_jao7.autonomy_run (run_id),

  -- THE ARBITRATION CONSTRAINT for step claiming. At most one row per (run, step, attempt),
  -- whatever two concurrent processes each believe they won. This is what makes "an attempt runs at
  -- most once" a property of the database rather than of whichever guard happened to execute first.
  CONSTRAINT autonomy_step_pk PRIMARY KEY (run_id, step_index, attempt_index),

  CONSTRAINT autonomy_step_index_bounded
    CHECK (step_index BETWEEN 0 AND 64),
  CONSTRAINT autonomy_step_attempt_bounded
    CHECK (attempt_index BETWEEN 0 AND 63),
  CONSTRAINT autonomy_step_operation_bounded
    CHECK (operation_id ~ '^[A-Za-z0-9._:-]{1,128}$'),
  CONSTRAINT autonomy_step_type_closed
    CHECK (step_type IN (
      'VALIDATE_INPUT',
      'GATHER_VIRTUAL_EVIDENCE',
      'DELEGATE_RIYA_ANALYSIS',
      'ANALYZE_CAPACITY',
      'BUILD_REMEDIATION_PROPOSAL',
      'AWAIT_AUTHORITY',
      'VALIDATE_AUTHORITY_EVIDENCE',
      'REHEARSE_REVERSIBLE_EFFECT',
      'VERIFY_REHEARSAL',
      'ROLLBACK_REHEARSAL',
      'COMPLETE'
    )),
  CONSTRAINT autonomy_step_status_closed
    CHECK (step_status IN ('CLAIMED', 'COMPLETED', 'REFUSED', 'CANCELLED')),

  -- A finished step has a finish instant and an outcome; a claimed one has neither. A crash between
  -- claim and finalize is therefore VISIBLE rather than indistinguishable from success.
  CONSTRAINT autonomy_step_finalize_consistent
    CHECK (
      (step_status = 'CLAIMED' AND completed_at IS NULL AND outcome_code IS NULL)
      OR
      (step_status <> 'CLAIMED' AND completed_at IS NOT NULL AND outcome_code IS NOT NULL)
    ),
  CONSTRAINT autonomy_step_outcome_bounded
    CHECK (outcome_code IS NULL OR outcome_code ~ '^[A-Z0-9_]{1,64}$')
);

-- THE SECOND ARBITRATION CONSTRAINT for step claiming. At most ONE unfinished attempt per plan
-- position, ever. Without it, allowing a retained position to be re-claimed would also allow a
-- second caller to open a parallel attempt beside one already in flight -- which is the concurrency
-- hole the single-row primary key used to close by accident.
CREATE UNIQUE INDEX IF NOT EXISTS autonomy_step_single_claim_idx
  ON qf_jarvis_jao7.autonomy_step (run_id, step_index)
  WHERE step_status = 'CLAIMED';

-- ---------------------------------------------------------------------------
-- The evaluations. One per significant step, and never overwritten.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS qf_jarvis_jao7.autonomy_evaluation (
  run_id            text        NOT NULL,
  evaluation_index  integer     NOT NULL,
  step_index        integer     NOT NULL,
  evaluator_code    text        NOT NULL,
  verdict           text        NOT NULL,
  observed_at       timestamptz NOT NULL,

  CONSTRAINT autonomy_evaluation_run_fk
    FOREIGN KEY (run_id) REFERENCES qf_jarvis_jao7.autonomy_run (run_id),
  CONSTRAINT autonomy_evaluation_pk PRIMARY KEY (run_id, evaluation_index),

  CONSTRAINT autonomy_evaluation_indices_bounded
    CHECK (evaluation_index BETWEEN 0 AND 512 AND step_index BETWEEN 0 AND 64),
  CONSTRAINT autonomy_evaluation_code_bounded
    CHECK (evaluator_code ~ '^[A-Z0-9_]{1,64}$'),
  CONSTRAINT autonomy_evaluation_verdict_closed
    CHECK (verdict IN (
      'CONTINUE', 'PAUSE', 'REQUIRE_AUTHORITY', 'VERIFY', 'ROLLBACK', 'COMPLETE', 'FAIL_SAFE'
    ))
);

-- ---------------------------------------------------------------------------
-- Operation replay. What makes every mutation idempotent by operation id.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS qf_jarvis_jao7.autonomy_operation_replay (
  operation_id            text        NOT NULL,
  operation_kind          text        NOT NULL,
  run_id                  text        NOT NULL,

  -- The semantic digest of what the operation MEANT. A retry carrying different content is a
  -- different operation wearing the same id, and it is refused rather than applied.
  semantic_digest         text        NOT NULL,
  committed_run_revision  integer     NOT NULL,
  result_code             text        NOT NULL,
  created_at              timestamptz NOT NULL,

  CONSTRAINT autonomy_operation_replay_pk PRIMARY KEY (operation_id),
  CONSTRAINT autonomy_operation_replay_run_fk
    FOREIGN KEY (run_id) REFERENCES qf_jarvis_jao7.autonomy_run (run_id),

  CONSTRAINT autonomy_operation_replay_id_bounded
    CHECK (operation_id ~ '^[A-Za-z0-9._:-]{1,128}$'),
  CONSTRAINT autonomy_operation_replay_digest_bounded
    CHECK (semantic_digest ~ '^[0-9a-f]{64}$'),
  -- RECORD_AUTHORITY is its OWN kind. It used to replay under `FINALIZE_STEP`, which meant the
  -- audit trail named the wrong mutation -- and a trail that misnames what happened is worse than
  -- one that says nothing, because a reader trusts it.
  CONSTRAINT autonomy_operation_replay_kind_closed
    CHECK (operation_kind IN (
      'CREATE_RUN', 'CLAIM_STEP', 'FINALIZE_STEP', 'RECORD_AUTHORITY', 'PAUSE_RUN', 'RESUME_RUN',
      'KILL_RUN', 'APPLY_REHEARSAL', 'VERIFY_REHEARSAL', 'ROLLBACK_REHEARSAL'
    )),
  CONSTRAINT autonomy_operation_replay_result_bounded
    CHECK (result_code ~ '^[A-Z0-9_]{1,64}$'),
  CONSTRAINT autonomy_operation_replay_revision_positive
    CHECK (committed_run_revision >= 1)
);

-- ---------------------------------------------------------------------------
-- The authority observation. HISTORY, and never permission.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS qf_jarvis_jao7.authority_observation (
  run_id                    text        NOT NULL,

  -- ONE ROW PER ATTEMPT, and at most one successful chain per run.
  --
  -- This used to be `PRIMARY KEY (run_id)` with every observation inserted, so the FIRST incomplete
  -- or rejected attempt consumed the only slot -- and a run that was still legitimately awaiting
  -- authority could never record the exact chain when it finally arrived. A failed attempt must not
  -- poison later valid evidence, and every attempt is worth keeping.
  attempt_index             integer     NOT NULL,

  -- DIGESTS AND IDENTITIES ONLY. There is deliberately no column in which a raw ApprovalDecisionV1
  -- or a raw ExecutionIntentV1 could be stored, and no boolean named approved, can_execute,
  -- is_authorized or send_allowed. What a later reader can learn from this row is WHICH artifacts
  -- correlated to which action, at what moment -- never that anything is permitted now.
  approval_decision_digest  text        NOT NULL,
  execution_intent_digest   text,
  recommendation_id         text        NOT NULL,
  proposed_action_id        text        NOT NULL,
  action_fingerprint        text        NOT NULL,

  observation_code          text        NOT NULL,
  observed_at               timestamptz NOT NULL,

  CONSTRAINT authority_observation_pk PRIMARY KEY (run_id, attempt_index),
  CONSTRAINT authority_observation_run_fk
    FOREIGN KEY (run_id) REFERENCES qf_jarvis_jao7.autonomy_run (run_id),

  CONSTRAINT authority_observation_attempt_bounded
    CHECK (attempt_index BETWEEN 0 AND 64),

  CONSTRAINT authority_observation_digests_bounded
    CHECK (
      approval_decision_digest ~ '^[0-9a-f]{64}$'
      AND action_fingerprint ~ '^[0-9a-f]{64}$'
      AND (execution_intent_digest IS NULL OR execution_intent_digest ~ '^[0-9a-f]{64}$')
    ),
  CONSTRAINT authority_observation_ids_bounded
    CHECK (
      recommendation_id ~ '^[A-Za-z0-9._:-]{1,128}$'
      AND proposed_action_id ~ '^[A-Za-z0-9._:-]{1,128}$'
    ),
  CONSTRAINT authority_observation_code_closed
    CHECK (observation_code IN (
      'CORRELATED_APPROVED_ACTION_AND_INTENT',
      'CORRELATED_APPROVED_ACTION_WITHOUT_INTENT',
      'DECISION_NOT_APPROVING_THIS_ACTION'
    )),

  -- An intent digest exists exactly when the observation says an intent correlated.
  CONSTRAINT authority_observation_intent_consistent
    CHECK (
      (execution_intent_digest IS NOT NULL)
      = (observation_code = 'CORRELATED_APPROVED_ACTION_AND_INTENT')
    )
);

-- ---------------------------------------------------------------------------
-- The virtual sandbox. Local synthetic integers, and nothing else.
-- ---------------------------------------------------------------------------
-- THE ARBITRATION CONSTRAINT for the authority gate. At most ONE successful chain per run,
-- whatever any number of failed attempts believed. This is what makes "the rehearsal ran because an
-- exact chain correlated" a property of the database rather than of whichever guard executed first.
CREATE UNIQUE INDEX IF NOT EXISTS authority_observation_single_success_idx
  ON qf_jarvis_jao7.authority_observation (run_id)
  WHERE observation_code = 'CORRELATED_APPROVED_ACTION_AND_INTENT';

CREATE TABLE IF NOT EXISTS qf_jarvis_jao7.virtual_rehearsal_state (
  run_id                text        NOT NULL,
  rehearsal_class       text        NOT NULL,

  -- Two integer slots is all either rehearsal needs: a capacity value, or a task-present flag and
  -- the fingerprint-derived binding. INTEGERS on purpose -- there is no column here into which a
  -- real record, a hostname, a path or a payload could be written even by mistake.
  before_integer_a      integer     NOT NULL,
  before_integer_b      integer,
  after_integer_a       integer,
  after_integer_b       integer,
  rollback_integer_a    integer,
  rollback_integer_b    integer,

  state                 text        NOT NULL,
  applied_at            timestamptz,
  verified_at           timestamptz,

  -- ATTEMPTED and SUCCEEDED are separate facts.
  --
  -- They used to be one column, and the check below then read `state = ROLLED_BACK` if and only if a
  -- rollback instant existed -- so a ROLLBACK_FAILED row carrying its attempted values violated its
  -- own constraint and could not be written. A failure state that cannot be persisted is a failure
  -- state that does not exist, which is the opposite of failing safe.
  rollback_attempted_at timestamptz,
  rolled_back_at        timestamptz,
  rollback_attempts     integer     NOT NULL DEFAULT 0,

  revision              integer     NOT NULL,

  CONSTRAINT virtual_rehearsal_state_pk PRIMARY KEY (run_id),
  CONSTRAINT virtual_rehearsal_state_run_fk
    FOREIGN KEY (run_id) REFERENCES qf_jarvis_jao7.autonomy_run (run_id),

  CONSTRAINT virtual_rehearsal_class_closed
    CHECK (rehearsal_class IN ('VIRTUAL_OPERATOR_TASK_LEDGER', 'VIRTUAL_CAPACITY_POOL')),
  CONSTRAINT virtual_rehearsal_state_closed
    CHECK (state IN (
      'CAPTURED', 'APPLIED', 'VERIFIED', 'ROLLBACK_REQUIRED', 'ROLLED_BACK', 'ROLLBACK_FAILED'
    )),
  CONSTRAINT virtual_rehearsal_revision_positive
    CHECK (revision >= 1),
  CONSTRAINT virtual_rehearsal_integers_bounded
    CHECK (
      before_integer_a BETWEEN 0 AND 1000000
      AND (before_integer_b   IS NULL OR before_integer_b   BETWEEN 0 AND 1000000)
      AND (after_integer_a    IS NULL OR after_integer_a    BETWEEN 0 AND 1000000)
      AND (after_integer_b    IS NULL OR after_integer_b    BETWEEN 0 AND 1000000)
      AND (rollback_integer_a IS NULL OR rollback_integer_a BETWEEN 0 AND 1000000)
      AND (rollback_integer_b IS NULL OR rollback_integer_b BETWEEN 0 AND 1000000)
    ),

  -- An applied instant exists exactly when the rehearsal has moved past capture.
  CONSTRAINT virtual_rehearsal_applied_consistent
    CHECK ((state = 'CAPTURED') = (applied_at IS NULL)),
  -- A SUCCESSFUL rollback has a success instant and a restored value; a FAILED one has NEITHER,
  -- and both have an attempt instant. The two states are separately representable, and a restored
  -- value exists if and only if a rollback actually restored something: a row saying the captured
  -- state came back when it did not is the one thing a recovery audit must never be able to say.
  CONSTRAINT virtual_rehearsal_rollback_consistent
    CHECK (
      (state = 'ROLLED_BACK')
      = (rolled_back_at IS NOT NULL AND rollback_integer_a IS NOT NULL)
    ),
  CONSTRAINT virtual_rehearsal_rollback_value_only_on_success
    CHECK (
      state = 'ROLLED_BACK'
      OR (rolled_back_at IS NULL AND rollback_integer_a IS NULL AND rollback_integer_b IS NULL)
    ),
  CONSTRAINT virtual_rehearsal_rollback_attempt_consistent
    CHECK (
      (state IN ('ROLLED_BACK', 'ROLLBACK_FAILED')) = (rollback_attempted_at IS NOT NULL)
    ),
  -- ONE attempt, enforced by the database. There is no retry storm to configure away.
  CONSTRAINT virtual_rehearsal_rollback_attempts_bounded
    CHECK (rollback_attempts BETWEEN 0 AND 1)
);

CREATE INDEX IF NOT EXISTS autonomy_step_run_idx
  ON qf_jarvis_jao7.autonomy_step (run_id, step_index);

CREATE INDEX IF NOT EXISTS autonomy_evaluation_run_idx
  ON qf_jarvis_jao7.autonomy_evaluation (run_id, evaluation_index);
