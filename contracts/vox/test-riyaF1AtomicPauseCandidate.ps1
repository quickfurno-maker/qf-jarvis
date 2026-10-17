$ErrorActionPreference='Stop'
$container='qfj-vox-f1-'+([guid]::NewGuid().ToString('N').Substring(0,10))
$sql=Join-Path $PSScriptRoot 'riyaF1AtomicPauseCandidate.sql'
try{
 docker run --rm -d --network none --name $container -e POSTGRES_PASSWORD=isolated_only postgres:17-alpine | Out-Null
 if($LASTEXITCODE -ne 0){throw 'PG17_BOOT_FAILED'}
 $up=$false
 for($i=0;$i -lt 30;$i++){
  docker exec $container pg_isready -U postgres 2>$null | Out-Null
  if($LASTEXITCODE -eq 0){Start-Sleep -Seconds 1;$up=$true;break}
  Start-Sleep -Seconds 1
 }
 if(-not $up){throw 'PG17_UNAVAILABLE'}
 "create role anon nologin; create role authenticated nologin;" |
  docker exec -i $container psql -v ON_ERROR_STOP=1 -U postgres | Out-Null
 if($LASTEXITCODE -ne 0){throw 'BOOTSTRAP_FAIL'}
 Get-Content -Raw $sql | docker exec -i $container psql -v ON_ERROR_STOP=1 -U postgres | Out-Null
 if($LASTEXITCODE -ne 0){throw 'RIYA_SCHEMA_FAIL'}
 $proof=@'
insert into vox_f1.riya_pause_state_candidate
 (conversation_id,client_id,project_id,state,revision,consent_revision)
 values('00000000-0000-4000-8000-000000000001',
 '00000000-0000-4000-8000-000000000002',
 '00000000-0000-4000-8000-000000000003','AI',7,3);
insert into vox_f1.riya_signed_core_permits_candidate
 (nonce,conversation_id,client_id,project_id,staff_id,expected_revision,
 consent_revision,expires_at,core_signature_verified,core_grant_verified,
 client_consent_verified)
 values('00000000-0000-4000-8000-000000000005',
 '00000000-0000-4000-8000-000000000001',
 '00000000-0000-4000-8000-000000000002',
 '00000000-0000-4000-8000-000000000003',
 '00000000-0000-4000-8000-000000000004',7,3,clock_timestamp()+interval '40 seconds',
 true,true,true);
do $$
declare r record;
begin
 select * into r from vox_f1.riya_pause_atomic_candidate(
 '00000000-0000-4000-8000-000000000001',
 '00000000-0000-4000-8000-000000000002',
 '00000000-0000-4000-8000-000000000003',
 '00000000-0000-4000-8000-000000000004',7,3,
 '00000000-0000-4000-8000-000000000005');
 if not found or r.pause_revision<>8 then raise exception 'PAUSE_NOT_DURABLE';end if;
 begin
  perform 1 from vox_f1.riya_pause_atomic_candidate(
   '00000000-0000-4000-8000-000000000001',
   '00000000-0000-4000-8000-000000000002',
   '00000000-0000-4000-8000-000000000003',
   '00000000-0000-4000-8000-000000000004',7,3,
   '00000000-0000-4000-8000-000000000005');
  raise exception 'REPLAY_WAS_ACCEPTED';
 exception when raise_exception then
  if SQLERRM<>'RIYA_STALE_OR_FOREIGN_CONVERSATION' then raise;end if;
 end;
 if (select count(*) from vox_f1.riya_pause_events_candidate)<>1 then
  raise exception 'DUPLICATE_PAUSE_EVENT';end if;
 if exists(select 1 from vox_f1.riya_signed_core_permits_candidate
  where consumed_at is null) then raise exception 'NONCE_NOT_CONSUMED';end if;
 if has_schema_privilege('authenticated','vox_f1','USAGE') then
  raise exception 'AUTHENTICATED_LEAK';end if;
end $$;
select 'QFJ_F1_RIYA_PG17_PAUSE_RACE_REPLAY_PASS' as proof;
'@
 $result=$proof | docker exec -i $container psql -v ON_ERROR_STOP=1 -U postgres -t -A 2>&1
 if($LASTEXITCODE -ne 0 -or (($result -join [Environment]::NewLine) -notmatch 'QFJ_F1_RIYA_PG17_PAUSE_RACE_REPLAY_PASS')){
  $result|Select-Object -Last 23
  throw 'ISOLATED_RIYA_PG17_PROOF_FAILED'
 }
 Write-Output ('QFJ_F1_RIYA_PG17_PASS sha256='+(Get-FileHash $sql -Algorithm SHA256).Hash)
}finally{
 docker rm -f $container 2>$null|Out-Null
}
