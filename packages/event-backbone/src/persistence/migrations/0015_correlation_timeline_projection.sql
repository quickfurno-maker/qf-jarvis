-- 0015_correlation_timeline_projection.sql
--
-- Disposable, non-authoritative correlation timeline for operator explainability.
--
-- The canonical event envelope has carried correlation_id from the beginning. This migration
-- projects ONLY that UUID plus immutable event metadata into an ordered read model. It does not
-- copy payload, subject, event id, causation id, provider details, prompt/model content or free text.

CREATE TABLE qf_jarvis.rm_correlation_timeline (
  correlation_id UUID        NOT NULL,
  event_position BIGINT      NOT NULL,
  event_type     TEXT        NOT NULL,
  event_version  INTEGER     NOT NULL,
  accepted_at    TIMESTAMPTZ NOT NULL,

  CONSTRAINT rm_correlation_timeline_pk
    PRIMARY KEY (correlation_id, event_position),
  CONSTRAINT rm_correlation_timeline_position_unique
    UNIQUE (event_position),
  CONSTRAINT rm_correlation_timeline_position_positive
    CHECK (event_position > 0),
  CONSTRAINT rm_correlation_timeline_event_type_is_machine_token
    CHECK (
      length(event_type) BETWEEN 1 AND 64
      AND event_type ~ '^[a-z0-9]+([-.][a-z0-9]+)*$'
    ),
  CONSTRAINT rm_correlation_timeline_version_positive
    CHECK (event_version >= 1 AND event_version <= 1000)
);

CREATE INDEX rm_correlation_timeline_correlation_order_idx
  ON qf_jarvis.rm_correlation_timeline (correlation_id, event_position);

COMMENT ON TABLE qf_jarvis.rm_correlation_timeline IS
  'Disposable, non-authoritative operator lineage read model. One row per accepted event carrying '
  'only correlation UUID, gap-free projection position, event type/version and acceptance instant. '
  'No payload, subject, event id, causation id, provider data, prompt/model content or free text.';

REVOKE ALL ON qf_jarvis.rm_correlation_timeline FROM PUBLIC;

DO $deny$
DECLARE managed_role text;
BEGIN
  FOREACH managed_role IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = managed_role) THEN
      EXECUTE format('REVOKE ALL ON qf_jarvis.rm_correlation_timeline FROM %I', managed_role);
    END IF;
  END LOOP;
END
$deny$;

DO $grant$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'qf_jarvis_projection_runtime') THEN
    GRANT SELECT (correlation_id) ON qf_jarvis.event TO qf_jarvis_projection_runtime;
    GRANT SELECT, INSERT ON qf_jarvis.rm_correlation_timeline TO qf_jarvis_projection_runtime;
  END IF;
END
$grant$;
