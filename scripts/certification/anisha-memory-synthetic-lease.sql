\set ON_ERROR_STOP on
DO $$
BEGIN
  IF current_database() <> 'anisha_memory_cert' OR inet_server_addr()::text <> '127.0.0.1'
     OR inet_server_port() <> 55439 THEN
    RAISE EXCEPTION 'CERT ONLY: requires disposable 127.0.0.1:55439/anisha_memory_cert';
  END IF;
END $$;
\echo CERT: Core claim expiry and stale ACK with synthetic vendor
INSERT INTO public.vendors(id) VALUES('66666666-6666-4666-8666-666666666666');
SELECT * FROM public.qf_set_vendor_anisha_memory_consent_v1(
 '66666666-6666-4666-8666-666666666666'::uuid,true);
SELECT * FROM public.qf_set_vendor_anisha_memory_consent_v1(
 '66666666-6666-4666-8666-666666666666'::uuid,false);
CREATE TEMP TABLE lease_old AS SELECT * FROM public.qf_claim_vendor_anisha_memory_purges_v1(1);
DO $$
DECLARE t record;
BEGIN
 SELECT * INTO t FROM lease_old;
 IF t.vendor_id <> '66666666-6666-4666-8666-666666666666' THEN
   RAISE EXCEPTION 'wrong test vendor in old lease';
 END IF;
 UPDATE public.vendor_anisha_memory_purge_outbox
 SET leased_until = now() - interval '2 seconds'
 WHERE purge_id=t.purge_id;
END $$;
CREATE TEMP TABLE lease_new AS SELECT * FROM public.qf_claim_vendor_anisha_memory_purges_v1(1);
DO $$
DECLARE old_task record;
DECLARE new_task record;
BEGIN
 SELECT * INTO old_task FROM lease_old;
 SELECT * INTO new_task FROM lease_new;
 IF old_task.purge_id <> new_task.purge_id OR old_task.lease_token = new_task.lease_token THEN
    RAISE EXCEPTION 'lease token did not rotate';
 END IF;
 IF public.qf_ack_vendor_anisha_memory_purge_v1(old_task.purge_id,old_task.vendor_id,old_task.lease_token) THEN
    RAISE EXCEPTION 'old token incorrectly ACKed';
 END IF;
 IF NOT EXISTS (SELECT 1 FROM public.vendor_anisha_memory_purge_outbox
    WHERE purge_id=new_task.purge_id AND completed_at IS NULL AND attempts=2) THEN
    RAISE EXCEPTION 'retry attempt not recorded';
 END IF;
END $$;
\echo PASS token rotation and stale lease rejection
BEGIN;
SELECT pg_advisory_xact_lock(hashtextextended('vendor|66666666-6666-4666-8666-666666666666',0));
INSERT INTO qf_jarvis_memory.anisha_erasure_fence(vendor_subject_key,purge_id)
 SELECT 'vendor|66666666-6666-4666-8666-666666666666',purge_id FROM lease_new
 ON CONFLICT DO NOTHING;
DELETE FROM qf_jarvis_memory.agent_memory_record
 WHERE owner_agent='anisha' AND 'vendor|66666666-6666-4666-8666-666666666666'=ANY(subject_keys);
COMMIT;
DO $$
DECLARE t record;
BEGIN
 SELECT * INTO t FROM lease_new;
 IF NOT public.qf_ack_vendor_anisha_memory_purge_v1(t.purge_id,t.vendor_id,t.lease_token) THEN
    RAISE EXCEPTION 'new lease ACK failed';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM public.vendor_anisha_memory_consents
  WHERE vendor_id=t.vendor_id AND decision='DENIED' AND NOT erase_required) THEN
    RAISE EXCEPTION 'Core erased flag not cleared after verified ACK';
 END IF;
END $$;
\echo PASS rotated lease can ACK only after physical deletion
