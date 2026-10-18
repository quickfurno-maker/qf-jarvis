$ErrorActionPreference='Stop'
$name='qfj-vox-ab7c-pg17'
$root=(Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$file=Join-Path $root 'contracts\vox\riyaAb7PendingCaseCandidate.sql'
if(docker ps -aq --filter "name=^/$name$"){throw 'AB7C_CONTAINER_COLLISION'}
$container=$null
function Sql([string]$sql){
 $prior=$ErrorActionPreference;$ErrorActionPreference='Continue'
 try{$x=($sql|docker exec -i $name psql -X -q -t -A -U postgres -d postgres -v ON_ERROR_STOP=1 2>&1|Out-String);$code=$LASTEXITCODE}
 finally{$ErrorActionPreference=$prior}
 return @{code=$code;text=$x.Trim()}
}
function Pass([string]$label,[string]$sql,[string]$want){
 $r=Sql $sql
 if($r.code -ne 0 -or $r.text -ne $want){throw "AB7C_EXPECTED_PASS_FAILED $label $($r.text)"}
 Write-Output "PASS $label"
}
function Denied([string]$label,[string]$sql,[string]$regex){
 $r=Sql $sql
 if($r.code -eq 0 -or $r.text -notmatch $regex){throw "AB7C_DENY_FAILED $label $($r.text)"}
 Write-Output "PASS DENIED $label"
}
try{
 $container=docker run --rm --network none -d --name $name -e POSTGRES_PASSWORD=synthetic_only postgres:17-alpine
 if($LASTEXITCODE -ne 0){throw 'PG_START_FAILED'}
 $ready=$false
 for($i=0;$i -lt 80;$i++){
  $prior=$ErrorActionPreference;$ErrorActionPreference='Continue'
  try{$log=(docker logs $name 2>&1|Out-String)}finally{$ErrorActionPreference=$prior}
  if($log -match 'PostgreSQL init process complete'){
   docker exec $name pg_isready -U postgres -d postgres *> $null
   if($LASTEXITCODE -eq 0){$ready=$true;break}
  }
  Start-Sleep -Milliseconds 350
 }
 if(!$ready){throw 'AB7C_FINAL_PG_NOT_READY'}
 $setup="CREATE ROLE anon NOLOGIN;CREATE ROLE authenticated NOLOGIN;CREATE ROLE service_role NOLOGIN BYPASSRLS;"
 if((Sql $setup).code -ne 0){throw 'AB7C_ROLES_FAILED'}
 $r=Sql (Get-Content $file -Raw);if($r.code -ne 0){throw "AB7C_SCHEMA_FAILED $($r.text)"}
 $insert=@'
INSERT INTO public.vox_ab7c_pending_human_cases_candidate_v1(
case_id,conversation_id,staff_id,reviewer_id,jti,pause_revision,consent_revision,
signed_core_proof_sha256,signed_jarvis_proof_sha256,expires_at)
VALUES('00000000-0000-4000-8000-000000000001',
'00000000-0000-4000-8000-000000000002',
'00000000-0000-4000-8000-000000000003',
'00000000-0000-4000-8000-000000000004',
'00000000-0000-4000-8000-000000000005',1,2,
repeat('a',64),repeat('b',64),clock_timestamp()+interval '15 minutes');
'@
 $r=Sql $insert;if($r.code -ne 0){throw "AB7C_VALID_PENDING_FAILED $($r.text)"}
 Pass 'one real pending record' 'SELECT state FROM public.vox_ab7c_pending_human_cases_candidate_v1;' 'PENDING_HUMAN_ACCEPTANCE'
 Denied 'jti replay of same original' $insert 'duplicate key'
 Denied 'same conversation revision with different JTI' ($insert.Replace('000000000001','000000000006').Replace('000000000005','000000000007')) 'duplicate key'
 Denied 'self-review' ($insert.Replace('000000000001','000000000008').Replace('000000000005','000000000009').Replace('000000000004','000000000003')) 'check constraint'
 $ack=@'
INSERT INTO public.vox_ab7c_internal_case_acks_candidate_v1
(case_id,reviewer_id,decision_nonce,state)
VALUES('00000000-0000-4000-8000-000000000001',
'00000000-0000-4000-8000-000000000004',
'00000000-0000-4000-8000-000000000010','INTERNAL_ACKNOWLEDGED');
'@
 $r=Sql $ack;if($r.code -ne 0){throw "AB7C_REVIEW_FAILED $($r.text)"}
 Denied 'second internal ACK' $ack 'duplicate key'
 Denied 'wrong independent reviewer' ($ack.Replace('000000000010','000000000011').Replace('000000000004','000000000006')) 'AB7C_DISTINCT_CURRENT_REVIEW_REQUIRED'
 Denied 'anon SELECT forbidden' 'SET ROLE anon;SELECT * FROM public.vox_ab7c_pending_human_cases_candidate_v1;' 'permission denied'
 Denied 'Auth INSERT forbidden' 'SET ROLE authenticated; INSERT INTO public.vox_ab7c_pending_human_cases_candidate_v1 DEFAULT VALUES;' 'permission denied'
 Denied 'immutable pending case' "DELETE FROM public.vox_ab7c_pending_human_cases_candidate_v1 WHERE case_id='00000000-0000-4000-8000-000000000001';" 'AB7C_APPEND_ONLY'
 Denied 'immutable ACK' "UPDATE public.vox_ab7c_internal_case_acks_candidate_v1 SET state='REJECTED';" 'AB7C_APPEND_ONLY'
 Pass 'both forced RLS' @'
SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='public' AND c.relname LIKE 'vox_ab7c_%_candidate_v1'
AND c.relrowsecurity AND c.relforcerowsecurity;
'@ '2'
 $sha=(Get-FileHash $file -Algorithm SHA256).Hash.ToLowerInvariant()
 Write-Output "QFJ_AB7C_PG17_PENDING_ACK_PASS synthetic_auth=true sha256=$sha"
}finally{if($container){docker rm -f $name *> $null}}
