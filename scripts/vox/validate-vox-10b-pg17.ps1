$ErrorActionPreference='Stop'
$name='qfj-vox10b-replay-pg17'
$root=(Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
if(docker ps -aq --filter "name=^/$name$"){throw 'EXISTING_TEST_CONTAINER'}
$cid=$null
try{
 $cid=docker run --rm --network none -d --name $name -e POSTGRES_PASSWORD=qfj_test_only postgres:17-alpine
 if($LASTEXITCODE -ne 0){throw 'CONTAINER_FAIL'}
 $up=$false
 for($i=0;$i -lt 30;$i++){docker exec $name pg_isready -U postgres *> $null;if($LASTEXITCODE -eq 0){$up=$true;break};Start-Sleep -Seconds 1}
 if(-not $up){throw 'DB_NOT_READY'}
 (Get-Content (Join-Path $root 'contracts\vox\sql\0001_vox_agent_replay_receipts.sql') -Raw) |
   docker exec -i $name psql -X -q -v ON_ERROR_STOP=1 -U postgres -d postgres
 if($LASTEXITCODE -ne 0){throw 'MIGRATION_FAILED'}
 $insert="INSERT INTO public.qfj_vox_agent_replay_receipts_v1(key_hash,expires_at) VALUES(decode('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','hex'),now()+interval '120 seconds') ON CONFLICT (key_hash) DO NOTHING RETURNING encode(key_hash,'hex');"
 $one=docker exec $name psql -X -A -t -v ON_ERROR_STOP=1 -U postgres -d postgres -c $insert
 if($LASTEXITCODE -ne 0 -or -not ([string]$one).Contains('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')){throw 'FIRST_CLAIM_FAILED'}
 $two=docker exec $name psql -X -A -t -v ON_ERROR_STOP=1 -U postgres -d postgres -c $insert
 if($LASTEXITCODE -ne 0 -or ([string]$two).Contains('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')){throw 'DUPLICATE_CLAIM_ACCEPTED'}
 $count=docker exec $name psql -X -A -t -U postgres -d postgres -c 'SELECT count(*) FROM public.qfj_vox_agent_replay_receipts_v1;'
 if($LASTEXITCODE -ne 0 -or ([string]$count).Trim() -ne '1'){throw 'DURABLE_ROW_COUNT_MISMATCH'}
 Write-Output 'VOX10B_JARVIS_REAL_PG17_REPLAY_PASS first=1 duplicate=0 durable_rows=1'
}finally{if($cid){docker rm -f $name *> $null}}
