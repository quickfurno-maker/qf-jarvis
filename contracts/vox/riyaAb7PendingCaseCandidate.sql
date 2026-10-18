-- Jarvis AB-7C durable pending-only human case ledger.
-- ISOLATED QA CANDIDATE, not a Jarvis managed migration. Core must verify
-- two original Ed25519 signatures before giving this DB its proof reference.
-- SHA256 digests by themselves are NOT proof of successful signature checks.
begin;
create table public.vox_ab7c_pending_human_cases_candidate_v1(
 case_id uuid primary key,
 conversation_id uuid not null,
 staff_id uuid not null,
 reviewer_id uuid not null,
 jti uuid not null unique,
 pause_revision integer not null check(pause_revision>=1),
 consent_revision integer not null check(consent_revision>=1),
 signed_core_proof_sha256 text not null check(signed_core_proof_sha256 ~ '^[a-f0-9]{64}$'),
 signed_jarvis_proof_sha256 text not null check(signed_jarvis_proof_sha256 ~ '^[a-f0-9]{64}$'),
 state text not null default 'PENDING_HUMAN_ACCEPTANCE'
  check(state='PENDING_HUMAN_ACCEPTANCE'),
 recorded_at timestamptz not null default clock_timestamp(),
 expires_at timestamptz not null,
 constraint vox_ab7c_separate_staff_tl check(staff_id<>reviewer_id),
 constraint vox_ab7c_short_pending_lifetime check(expires_at>recorded_at and
  expires_at<=recorded_at + interval '30 minutes'),
 constraint vox_ab7c_one_pause_revision unique(conversation_id,pause_revision)
);
create table public.vox_ab7c_internal_case_acks_candidate_v1(
 case_id uuid primary key references
  public.vox_ab7c_pending_human_cases_candidate_v1(case_id) on delete restrict,
 reviewer_id uuid not null,
 decision_nonce uuid not null unique,
 state text not null check(state in ('INTERNAL_ACKNOWLEDGED','REJECTED')),
 created_at timestamptz not null default clock_timestamp()
);
create or replace function public.qf_vox_ab7c_ack_scope_guard_candidate_v1()
returns trigger language plpgsql security invoker set search_path='' as $$
declare v_case record;
begin
 select * into v_case from public.vox_ab7c_pending_human_cases_candidate_v1
  where case_id=new.case_id for update;
 if not found or v_case.reviewer_id<>new.reviewer_id
  or v_case.staff_id=new.reviewer_id
  or v_case.expires_at<=clock_timestamp()
 then raise exception 'AB7C_DISTINCT_CURRENT_REVIEW_REQUIRED';end if;
 return new;
end;
$$;
create trigger qf_vox_ab7c_ack_checked_v1 before insert on
 public.vox_ab7c_internal_case_acks_candidate_v1 for each row
 execute function public.qf_vox_ab7c_ack_scope_guard_candidate_v1();
create or replace function public.qf_vox_ab7c_immutable_candidate_v1()
returns trigger language plpgsql security invoker set search_path='' as $$
begin raise exception 'AB7C_APPEND_ONLY';end;
$$;
create trigger qf_vox_ab7c_pending_immutable_v1 before update or delete on
 public.vox_ab7c_pending_human_cases_candidate_v1
 for each row execute function public.qf_vox_ab7c_immutable_candidate_v1();
create trigger qf_vox_ab7c_ack_immutable_v1 before update or delete on
 public.vox_ab7c_internal_case_acks_candidate_v1
 for each row execute function public.qf_vox_ab7c_immutable_candidate_v1();
alter table public.vox_ab7c_pending_human_cases_candidate_v1 enable row level security;
alter table public.vox_ab7c_pending_human_cases_candidate_v1 force row level security;
alter table public.vox_ab7c_internal_case_acks_candidate_v1 enable row level security;
alter table public.vox_ab7c_internal_case_acks_candidate_v1 force row level security;
revoke all on public.vox_ab7c_pending_human_cases_candidate_v1,
 public.vox_ab7c_internal_case_acks_candidate_v1 from public,anon,authenticated;
grant select,insert on public.vox_ab7c_pending_human_cases_candidate_v1,
 public.vox_ab7c_internal_case_acks_candidate_v1 to service_role;
revoke all on function public.qf_vox_ab7c_ack_scope_guard_candidate_v1()
 from public,anon,authenticated;
revoke all on function public.qf_vox_ab7c_immutable_candidate_v1()
 from public,anon,authenticated;
commit;
