-- 0020_scale_phase14_trace_context.sql
--
-- SCALE-P14: persist only W3C trace context across the durable QuickFurno turn spool.
-- These fields carry observability correlation only. They never grant authority and
-- contain no customer/business payload.

ALTER TABLE qf_jarvis.quickfurno_turn_spool
  ADD COLUMN traceparent text,
  ADD COLUMN tracestate text;

ALTER TABLE qf_jarvis.quickfurno_turn_spool
  ADD CONSTRAINT quickfurno_turn_spool_traceparent_shape
    CHECK (
      traceparent IS NULL OR (
        traceparent ~ '^[0-9a-f]{2}-[0-9a-f]{32}-[0-9a-f]{16}-[0-9a-f]{2}$'
        AND substring(traceparent FROM 4 FOR 32) <> repeat('0', 32)
        AND substring(traceparent FROM 37 FOR 16) <> repeat('0', 16)
      )
    ),
  ADD CONSTRAINT quickfurno_turn_spool_tracestate_shape
    CHECK (
      tracestate IS NULL OR (
        octet_length(tracestate) BETWEEN 1 AND 512
        AND position(chr(10) IN tracestate) = 0
        AND position(chr(13) IN tracestate) = 0
      )
    ),
  ADD CONSTRAINT quickfurno_turn_spool_tracestate_requires_parent
    CHECK (tracestate IS NULL OR traceparent IS NOT NULL);

COMMENT ON COLUMN qf_jarvis.quickfurno_turn_spool.traceparent IS
  'SCALE-P14 W3C Trace Context only; no business/customer content or authority.';
COMMENT ON COLUMN qf_jarvis.quickfurno_turn_spool.tracestate IS
  'SCALE-P14 optional bounded W3C tracestate paired with traceparent.';
