-- 0016_client_lifetime_projection.sql
--
-- Client Intelligence OS CI-03: disposable, non-authoritative client lifetime read models.
--
-- STORAGE ONLY. The client target events are not proven live Core emitters at this baseline, and
-- the projection is deliberately NOT registered in the production registry. Activation is a
-- separate certification change.
--
-- No phone, name, address, requirement free text, provider payload, prompt content or model output
-- is stored. Opaque Core references and bounded machine facts only.

CREATE TABLE qf_jarvis.rm_client_lifetime_state (
  client_id                TEXT        NOT NULL,
  last_position            BIGINT      NOT NULL,
  last_event_type          TEXT,
  last_accepted_at         TIMESTAMPTZ,
  last_lead_id             TEXT,
  last_category_id         TEXT,
  last_reason_code         TEXT,
  follow_up_due            BOOLEAN     NOT NULL DEFAULT false,
  satisfaction_state       TEXT        NOT NULL DEFAULT 'unknown',
  service_recovery_needed  BOOLEAN     NOT NULL DEFAULT false,
  reassignment_state       TEXT        NOT NULL DEFAULT 'none',
  lifecycle_state          TEXT        NOT NULL DEFAULT 'open',
  erased                   BOOLEAN     NOT NULL DEFAULT false,
  erased_at_position       BIGINT,
  erased_at                TIMESTAMPTZ,

  CONSTRAINT rm_client_lifetime_state_pk PRIMARY KEY (client_id),
  CONSTRAINT rm_client_lifetime_state_client_id_opaque
    CHECK (length(client_id) BETWEEN 1 AND 128 AND client_id ~ '^[A-Za-z0-9._:-]+$'),
  CONSTRAINT rm_client_lifetime_state_last_position_positive CHECK (last_position > 0),
  CONSTRAINT rm_client_lifetime_state_satisfaction
    CHECK (satisfaction_state IN ('unknown', 'satisfied', 'dissatisfied', 'complaint')),
  CONSTRAINT rm_client_lifetime_state_reassignment
    CHECK (reassignment_state IN ('none', 'requested', 'authorized', 'rejected')),
  CONSTRAINT rm_client_lifetime_state_lifecycle
    CHECK (lifecycle_state IN ('open', 'converted', 'lost', 'abandoned', 'withdrawn')),
  CONSTRAINT rm_client_lifetime_state_erasure_shape
    CHECK (
      (NOT erased AND erased_at_position IS NULL AND erased_at IS NULL)
      OR
      (erased AND erased_at_position IS NOT NULL AND erased_at IS NOT NULL
       AND last_event_type IS NULL AND last_accepted_at IS NULL
       AND last_lead_id IS NULL AND last_category_id IS NULL AND last_reason_code IS NULL
       AND follow_up_due = false AND satisfaction_state = 'unknown'
       AND service_recovery_needed = false AND reassignment_state = 'none'
       AND lifecycle_state = 'open')
    )
);

CREATE TABLE qf_jarvis.rm_client_service_opportunity (
  client_id         TEXT        NOT NULL,
  category_id       TEXT        NOT NULL,
  request_id        TEXT,
  status            TEXT        NOT NULL,
  last_position     BIGINT      NOT NULL,
  last_accepted_at  TIMESTAMPTZ NOT NULL,

  CONSTRAINT rm_client_service_opportunity_pk PRIMARY KEY (client_id, category_id),
  CONSTRAINT rm_client_service_opportunity_client_id_opaque
    CHECK (length(client_id) BETWEEN 1 AND 128 AND client_id ~ '^[A-Za-z0-9._:-]+$'),
  CONSTRAINT rm_client_service_opportunity_category_id_opaque
    CHECK (length(category_id) BETWEEN 1 AND 128 AND category_id ~ '^[A-Za-z0-9._:-]+$'),
  CONSTRAINT rm_client_service_opportunity_request_id_opaque
    CHECK (request_id IS NULL OR
           (length(request_id) BETWEEN 1 AND 128 AND request_id ~ '^[A-Za-z0-9._:-]+$')),
  CONSTRAINT rm_client_service_opportunity_status
    CHECK (status IN ('identified', 'confirmed', 'rejected')),
  CONSTRAINT rm_client_service_opportunity_position_positive CHECK (last_position > 0)
);

CREATE TABLE qf_jarvis.rm_client_lifetime_timeline (
  client_id       TEXT        NOT NULL,
  event_position  BIGINT      NOT NULL,
  event_type      TEXT        NOT NULL,
  accepted_at     TIMESTAMPTZ NOT NULL,
  lead_id         TEXT,
  category_id     TEXT,
  reason_code     TEXT,

  CONSTRAINT rm_client_lifetime_timeline_pk PRIMARY KEY (client_id, event_position),
  CONSTRAINT rm_client_lifetime_timeline_position_unique UNIQUE (event_position),
  CONSTRAINT rm_client_lifetime_timeline_client_id_opaque
    CHECK (length(client_id) BETWEEN 1 AND 128 AND client_id ~ '^[A-Za-z0-9._:-]+$'),
  CONSTRAINT rm_client_lifetime_timeline_position_positive CHECK (event_position > 0),
  CONSTRAINT rm_client_lifetime_timeline_event_type_machine_token
    CHECK (length(event_type) BETWEEN 1 AND 64
           AND event_type ~ '^[a-z0-9]+([-.][a-z0-9]+)*$'),
  CONSTRAINT rm_client_lifetime_timeline_lead_id_opaque
    CHECK (lead_id IS NULL OR
           (length(lead_id) BETWEEN 1 AND 128 AND lead_id ~ '^[A-Za-z0-9._:-]+$')),
  CONSTRAINT rm_client_lifetime_timeline_category_id_opaque
    CHECK (category_id IS NULL OR
           (length(category_id) BETWEEN 1 AND 128 AND category_id ~ '^[A-Za-z0-9._:-]+$')),
  CONSTRAINT rm_client_lifetime_timeline_reason_code_machine_token
    CHECK (reason_code IS NULL OR
           (length(reason_code) BETWEEN 1 AND 64
            AND reason_code ~ '^[a-z0-9]+([-.][a-z0-9]+)*$'))
);

CREATE INDEX rm_client_lifetime_timeline_client_order_idx
  ON qf_jarvis.rm_client_lifetime_timeline (client_id, event_position);

COMMENT ON TABLE qf_jarvis.rm_client_lifetime_state IS
  'Disposable Client Intelligence OS current-state projection keyed by opaque Core client id. No '
  'contact data or free text. Erasure leaves a minimal permanent tombstone.';
COMMENT ON TABLE qf_jarvis.rm_client_service_opportunity IS
  'Disposable client-category opportunity projection from explicit Core client journey events. '
  'Identified is advisory; confirmed/rejected reflect explicit client evidence.';
COMMENT ON TABLE qf_jarvis.rm_client_lifetime_timeline IS
  'Disposable client event timeline containing only opaque references and bounded machine facts. '
  'No payload, phone, name, address, prompt/model output or free text.';

REVOKE ALL ON qf_jarvis.rm_client_lifetime_state FROM PUBLIC;
REVOKE ALL ON qf_jarvis.rm_client_service_opportunity FROM PUBLIC;
REVOKE ALL ON qf_jarvis.rm_client_lifetime_timeline FROM PUBLIC;

DO $deny$
DECLARE managed_role text;
BEGIN
  FOREACH managed_role IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = managed_role) THEN
      EXECUTE format('REVOKE ALL ON qf_jarvis.rm_client_lifetime_state FROM %I', managed_role);
      EXECUTE format('REVOKE ALL ON qf_jarvis.rm_client_service_opportunity FROM %I', managed_role);
      EXECUTE format('REVOKE ALL ON qf_jarvis.rm_client_lifetime_timeline FROM %I', managed_role);
    END IF;
  END LOOP;
END
$deny$;

DO $grant$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'qf_jarvis_projection_runtime') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE
      ON qf_jarvis.rm_client_lifetime_state,
         qf_jarvis.rm_client_service_opportunity,
         qf_jarvis.rm_client_lifetime_timeline
      TO qf_jarvis_projection_runtime;
  END IF;
END
$grant$;

-- Deliberately NO new SELECT grant on qf_jarvis.event payload/source/event_id here.
-- The projection remains offline. Activation must add the narrow runtime grant in the same reviewed
-- change that registers the projection and certifies real Core emission.
