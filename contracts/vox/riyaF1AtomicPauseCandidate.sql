-- VOX-F1 Riya isolated PostgreSQL candidate. NEVER apply to managed Jarvis.
-- Only approved QFJ signed private Core gateway may insert short-lived permits;
-- Core must recheck genuine grant/consent before and during this transaction.
-- A cached permit CANNOT serve as live Core revocation proof.
begin;
create schema if not exists vox_f1;
create table vox_f1.riya_pause_state_candidate(
 conversation_id uuid primary key,client_id uuid not null,project_id uuid not null,
 state text not null check(state in ('AI','PAUSED','HUMAN','CLOSED')),
 revision bigint not null check(revision>=0),consent_revision bigint not null
 check(consent_revision>=1),updated_at timestamptz not null default clock_timestamp()
);
create table vox_f1.riya_signed_core_permits_candidate(
 nonce uuid primary key,conversation_id uuid not null,client_id uuid not null,
 project_id uuid not null,staff_id uuid not null,
 expected_revision bigint not null check(expected_revision>=0),
 consent_revision bigint not null check(consent_revision>=1),
 expires_at timestamptz not null,
 core_signature_verified boolean not null check(core_signature_verified),
 core_grant_verified boolean not null check(core_grant_verified),
 client_consent_verified boolean not null check(client_consent_verified),
 issued_at timestamptz not null default clock_timestamp(),
 consumed_at timestamptz,
 constraint permit_expiry_short check(expires_at<=issued_at+interval '60 seconds')
);
create table vox_f1.riya_pause_events_candidate(
 nonce uuid primary key references vox_f1.riya_signed_core_permits_candidate(nonce),
 conversation_id uuid not null,staff_id uuid not null,
 from_revision bigint not null,to_revision bigint not null,
 created_at timestamptz not null default clock_timestamp(),
 unique(conversation_id,to_revision)
);
alter table vox_f1.riya_pause_state_candidate enable row level security;
alter table vox_f1.riya_pause_state_candidate force row level security;
alter table vox_f1.riya_signed_core_permits_candidate enable row level security;
alter table vox_f1.riya_signed_core_permits_candidate force row level security;
alter table vox_f1.riya_pause_events_candidate enable row level security;
alter table vox_f1.riya_pause_events_candidate force row level security;
revoke all on schema vox_f1 from public;
revoke all on all tables in schema vox_f1 from public;
revoke all on all tables in schema vox_f1 from anon,authenticated;
-- Candidate only: approved Gateway uses narrowly scoped SQL function.
create function vox_f1.riya_pause_atomic_candidate(
 p_conversation uuid,p_client uuid,p_project uuid,p_staff uuid,
 p_revision bigint,p_consent_revision bigint,p_nonce uuid
) returns table(conversation_id uuid,client_id uuid,project_id uuid,
 pause_revision bigint,ack_nonce uuid,paused_at timestamptz)
language plpgsql security definer set search_path='' as $$
declare s vox_f1.riya_pause_state_candidate%rowtype;
 permit vox_f1.riya_signed_core_permits_candidate%rowtype; v_now timestamptz;
begin
 if p_conversation is null or p_client is null or p_project is null or
  p_staff is null or p_nonce is null or p_revision<0 or
  p_consent_revision<1 then raise exception 'RIYA_BAD_IDENTITY';end if;
 v_now:=clock_timestamp();
 select * into s from vox_f1.riya_pause_state_candidate st
  where st.conversation_id=p_conversation for update;
 if not found or s.client_id<>p_client or s.project_id<>p_project or
  s.revision<>p_revision or s.consent_revision<>p_consent_revision or
  s.state<>'AI' then raise exception 'RIYA_STALE_OR_FOREIGN_CONVERSATION';end if;
 select * into permit from vox_f1.riya_signed_core_permits_candidate
  where nonce=p_nonce for update;
 if not found or permit.conversation_id<>p_conversation or
  permit.client_id<>p_client or permit.project_id<>p_project or
  permit.staff_id<>p_staff or permit.expected_revision<>p_revision or
  permit.consent_revision<>p_consent_revision or permit.consumed_at is not null
  or permit.expires_at<=v_now or permit.issued_at>v_now+interval '30 seconds'
  or not permit.core_signature_verified or not permit.core_grant_verified or
  not permit.client_consent_verified
 then raise exception 'RIYA_EXPIRED_UNSIGNED_OR_REPLAYED_CORE_PERMIT';end if;
 update vox_f1.riya_signed_core_permits_candidate
  set consumed_at=v_now where nonce=p_nonce and consumed_at is null;
 if not found then raise exception 'RIYA_NONCE_REPLAY';end if;
 update vox_f1.riya_pause_state_candidate st set
  state='PAUSED',revision=st.revision+1,updated_at=v_now
  where st.conversation_id=p_conversation and st.revision=p_revision and st.state='AI';
 if not found then raise exception 'RIYA_PAUSE_RACE_LOST';end if;
 insert into vox_f1.riya_pause_events_candidate
  (nonce,conversation_id,staff_id,from_revision,to_revision)
  values(p_nonce,p_conversation,p_staff,p_revision,p_revision+1);
 return query select p_conversation,p_client,p_project,p_revision+1,p_nonce,v_now;
end; $$;
revoke all on function vox_f1.riya_pause_atomic_candidate(
 uuid,uuid,uuid,uuid,bigint,bigint,uuid) from public,anon,authenticated;
commit;
