\set ON_ERROR_STOP on
DO $$
BEGIN
  IF current_database() <> 'anisha_memory_cert' OR host(inet_server_addr()) <> '127.0.0.1'
     OR inet_server_port() <> 55439 THEN
    RAISE EXCEPTION 'CERT ONLY: requires disposable 127.0.0.1:55439/anisha_memory_cert';
  END IF;
END $$;
\echo CERT: isolated PostgreSQL 17 synthetic vendor memory
INSERT INTO public.vendors(id) VALUES
 ('44444444-4444-4444-8444-444444444444'),
 ('55555555-5555-4555-8555-555555555555');
DO $$
DECLARE v record;
BEGIN
 SELECT * INTO v FROM public.qf_set_vendor_anisha_memory_consent_v1(
 '44444444-4444-4444-8444-444444444444'::uuid, true);
 IF v.decision <> 'GRANTED' OR v.erase_required THEN
   RAISE EXCEPTION 'failed to grant synthetic purpose-consent';
 END IF;
 IF has_table_privilege('anon','public.vendor_anisha_memory_consents','SELECT') THEN
   RAISE EXCEPTION 'anon consent table read privilege leaked';
 END IF;
 IF has_function_privilege('anon','public.qf_set_vendor_anisha_memory_consent_v1(uuid,boolean)','EXECUTE') THEN
   RAISE EXCEPTION 'anon consent mutation RPC privilege leaked';
 END IF;
END $$;
\echo PASS synthetic consent grant and anon privilege separation
INSERT INTO qf_jarvis_memory.agent_memory_record
(memory_record_id, owner_agent, subject_keys, record_json, created_at, updated_at, expires_at)
VALUES ('synthetic-vendor-1', 'anisha', ARRAY['vendor|44444444-4444-4444-8444-444444444444'],
 '{"memoryRecordId":"synthetic-vendor-1","derivedSummary":"Hinglish preference"}'::jsonb,
 now(), now(), now()+interval '30 days'),
('synthetic-other-vendor', 'anisha', ARRAY['vendor|55555555-5555-4555-8555-555555555555'],
 '{"memoryRecordId":"synthetic-other-vendor","derivedSummary":"English preference"}'::jsonb,
 now(), now(), now()+interval '30 days'),
('synthetic-vendor-riya', 'riya', ARRAY['vendor|44444444-4444-4444-8444-444444444444'],
 '{"memoryRecordId":"synthetic-vendor-riya","derivedSummary":"Riya unrelated"}'::jsonb,
 now(), now(), now()+interval '30 days');
SELECT * FROM public.qf_set_vendor_anisha_memory_consent_v1(
'44444444-4444-4444-8444-444444444444'::uuid,false);
DO $$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM public.vendor_anisha_memory_consents WHERE vendor_id='44444444-4444-4444-8444-444444444444' AND decision='DENIED' AND erase_required) THEN
    RAISE EXCEPTION 'revocation did not fail closed';
 END IF;
 IF (SELECT count(*) FROM public.vendor_anisha_memory_purge_outbox WHERE vendor_id='44444444-4444-4444-8444-444444444444' AND completed_at is null) <> 1 THEN
    RAISE EXCEPTION 'expected exactly one durable purge';
 END IF;
 BEGIN
  PERFORM * FROM public.qf_set_vendor_anisha_memory_consent_v1('44444444-4444-4444-8444-444444444444'::uuid,true);
  RAISE EXCEPTION 'regrant incorrectly permitted before purge';
 EXCEPTION WHEN OTHERS THEN
  IF SQLERRM NOT LIKE '%vendor_memory_erasure_pending%' THEN RAISE; END IF;
 END;
END $$;
\echo PASS revocation, pending deletion and regrant fence
CREATE TEMP TABLE task1 AS SELECT * FROM public.qf_claim_vendor_anisha_memory_purges_v1(5);
DO $$
DECLARE t record;
BEGIN
 SELECT * INTO t FROM task1 LIMIT 1;
 IF t.vendor_id <> '44444444-4444-4444-8444-444444444444' OR t.lease_token IS NULL THEN
   RAISE EXCEPTION 'wrong synthetic lease';
 END IF;
 IF public.qf_ack_vendor_anisha_memory_purge_v1(t.purge_id,t.vendor_id,'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid) THEN
   RAISE EXCEPTION 'forged lease ACK accepted';
 END IF;
 IF public.qf_ack_vendor_anisha_memory_purge_v1(t.purge_id,'55555555-5555-4555-8555-555555555555'::uuid,t.lease_token) THEN
   RAISE EXCEPTION 'cross-vendor ACK accepted';
 END IF;
END $$;
\echo PASS wrong lease/vendor ack rejected
BEGIN;
SELECT pg_advisory_xact_lock(hashtextextended('vendor|44444444-4444-4444-8444-444444444444',0));
INSERT INTO qf_jarvis_memory.anisha_erasure_fence(vendor_subject_key,purge_id)
SELECT 'vendor|44444444-4444-4444-8444-444444444444',purge_id FROM task1
ON CONFLICT (vendor_subject_key) DO NOTHING;
DELETE FROM qf_jarvis_memory.agent_memory_record
WHERE owner_agent='anisha' AND 'vendor|44444444-4444-4444-8444-444444444444'=ANY(subject_keys);
COMMIT;
DO $$
DECLARE t record;
BEGIN
 SELECT * INTO t FROM task1 LIMIT 1;
 IF (SELECT count(*) FROM qf_jarvis_memory.agent_memory_record WHERE memory_record_id='synthetic-vendor-1')<>0 THEN
   RAISE EXCEPTION 'synthetic vendor memory not erased';
 END IF;
 IF (SELECT count(*) FROM qf_jarvis_memory.agent_memory_record WHERE memory_record_id IN ('synthetic-other-vendor','synthetic-vendor-riya'))<>2 THEN
   RAISE EXCEPTION 'unrelated vendor/agent memory was changed';
 END IF;
 IF NOT public.qf_ack_vendor_anisha_memory_purge_v1(t.purge_id,t.vendor_id,t.lease_token) THEN
   RAISE EXCEPTION 'valid completed purge ACK rejected';
 END IF;
 IF public.qf_ack_vendor_anisha_memory_purge_v1(t.purge_id,t.vendor_id,t.lease_token) THEN
   RAISE EXCEPTION 'duplicate ACK accepted';
 END IF;
 IF (SELECT count(*) FROM public.vendor_anisha_memory_purge_outbox WHERE vendor_id=t.vendor_id AND completed_at IS NULL)<>0 THEN
   RAISE EXCEPTION 'outbox still pending after complete ACK';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM public.vendor_anisha_memory_consents WHERE vendor_id=t.vendor_id AND decision='DENIED' AND NOT erase_required) THEN
   RAISE EXCEPTION 'Core consent not retained as DENIED';
 END IF;
END $$;
\echo PASS fenced committed erase, unrelated records retained and exact ACK
DO $$
BEGIN
 BEGIN
  INSERT INTO qf_jarvis_memory.agent_memory_record
  (memory_record_id,owner_agent,subject_keys,record_json,created_at,updated_at,expires_at)
  VALUES('resurrected-late-write','anisha',
  ARRAY['vendor|44444444-4444-4444-8444-444444444444'],'{}'::jsonb,
  now(),now(),now()+interval '30 days');
  RAISE EXCEPTION 'late memory write resurrected erased vendor';
 EXCEPTION WHEN OTHERS THEN
  IF SQLERRM NOT LIKE '%anisha-memory-erasure-fence%' THEN RAISE; END IF;
 END;
END $$;
\echo PASS late-write fence rejects resurrected memory
DELETE FROM public.vendors WHERE id='55555555-5555-4555-8555-555555555555';
DO $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.vendor_anisha_memory_purge_outbox WHERE vendor_id='55555555-5555-4555-8555-555555555555' AND reason='vendor_erasure' AND completed_at IS NULL) THEN
   RAISE EXCEPTION 'vendor delete lost purge task';
 END IF;
 IF EXISTS(SELECT 1 FROM public.vendors WHERE id='55555555-5555-4555-8555-555555555555') THEN
   RAISE EXCEPTION 'synthetic vendor still present';
 END IF;
END $$;
\echo PASS vendor deletion queues durable orphan-safe task
CREATE TEMP TABLE task2 AS SELECT * FROM public.qf_claim_vendor_anisha_memory_purges_v1(5);
DO $$
DECLARE t record;
BEGIN
 SELECT * INTO t FROM task2 LIMIT 1;
 IF t.vendor_id <> '55555555-5555-4555-8555-555555555555' THEN
    RAISE EXCEPTION 'orphaned vendor purge not claimable';
 END IF;
END $$;
BEGIN;
SELECT pg_advisory_xact_lock(hashtextextended('vendor|55555555-5555-4555-8555-555555555555',0));
INSERT INTO qf_jarvis_memory.anisha_erasure_fence(vendor_subject_key,purge_id)
SELECT 'vendor|55555555-5555-4555-8555-555555555555',purge_id FROM task2
ON CONFLICT (vendor_subject_key) DO NOTHING;
DELETE FROM qf_jarvis_memory.agent_memory_record
WHERE owner_agent='anisha' AND 'vendor|55555555-5555-4555-8555-555555555555'=ANY(subject_keys);
COMMIT;
DO $$
DECLARE t record;
BEGIN
 SELECT * INTO t FROM task2 LIMIT 1;
 IF NOT public.qf_ack_vendor_anisha_memory_purge_v1(t.purge_id,t.vendor_id,t.lease_token) THEN
   RAISE EXCEPTION 'orphaned vendor purge not ACKable after physical delete';
 END IF;
 IF EXISTS(SELECT 1 FROM qf_jarvis_memory.agent_memory_record WHERE owner_agent='anisha') THEN
   RAISE EXCEPTION 'Anisha record survived deletion drill';
 END IF;
END $$;
\echo PASS deleted vendor purge claimed, erased and acknowledged
