-- AN-A2c: transactional subject-erasure fence.
-- REVIEWED STAGING MIGRATION ONLY, applies AFTER 0001_governed_agent_memory.sql.
-- The Postgres adapter's concurrent writes and deletion share one advisory lock.
begin;
create table if not exists qf_jarvis_memory.anisha_erasure_fence (
  vendor_subject_key text primary key,
  purge_id uuid not null,
  created_at timestamptz not null default now()
);
revoke all on qf_jarvis_memory.anisha_erasure_fence from public;
create or replace function qf_jarvis_memory.reject_erased_anisha_write()
returns trigger language plpgsql
set search_path = pg_catalog, qf_jarvis_memory, pg_temp
as $$
declare key text;
begin
  if new.owner_agent <> 'anisha' then return new; end if;
  if cardinality(new.subject_keys) <> 1 then
    raise exception 'anisha-memory-subject-not-single-vendor';
  end if;
  key := new.subject_keys[1];
  if split_part(key, '|', 1) <> 'vendor' or split_part(key, '|', 2) !~ '^[0-9a-f-]{36}$' then
    raise exception 'anisha-memory-vendor-key-invalid';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(key, 0));
  if exists (select 1 from qf_jarvis_memory.anisha_erasure_fence f
             where f.vendor_subject_key = key) then
    raise exception 'anisha-memory-erasure-fence';
  end if;
  return new;
end; $$;
drop trigger if exists anisha_erasure_fence_guard on qf_jarvis_memory.agent_memory_record;
create trigger anisha_erasure_fence_guard
before insert or update on qf_jarvis_memory.agent_memory_record
for each row execute function qf_jarvis_memory.reject_erased_anisha_write();
commit;
