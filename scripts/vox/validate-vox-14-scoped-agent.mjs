import assert from 'node:assert/strict';
import {signAgentView,VOX_JARVIS_CONTRACT} from '../../contracts/vox/agentView.mjs';
import {createScopedVoxAdvisoryReader} from '../../contracts/vox/scopedAdvisoryReader.mjs';
const t=Math.floor(Date.now()/1000),id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const secret='synthetic-jarvis-vox14-signing-key-unit-test-only';
const e={schema:VOX_JARVIS_CONTRACT,iss:'qf-jarvis',aud:'vox-web',agent:'AAROHI',
 channel:'ACQUISITION',subjectType:'prospect',subjectId:id(1),jti:id(2),
 revision:2,iat:t,exp:t+120,memoryStatus:'CONSENTED',humanTakeover:true,lastEvent:'FOLLOW_UP_OPEN'};
const bearer='a'.repeat(120)+'.'+'b'.repeat(100)+'.'+'c'.repeat(100);
let claims=0,reads=0;
const pool={query:async()=>{claims++;return {rows:claims===1?[{key_hash:'dummy'}]:[]};}};
const grant=Object.freeze({allowed:true,agent:'AAROHI',subjectType:'prospect',subjectId:id(1),
 staffUserId:id(9),aal2Verified:true,objectScopeActive:true,cityScopeActive:true,humanTakeoverAllowed:true});
const make=fn=>createScopedVoxAdvisoryReader({pool,secret,clock:()=>t,authorizeCoreSubject:fn});
const reader=make(async()=>{reads++;return grant;});
const token=signAgentView(e,secret);
let n=0;async function check(name,fn){await fn();console.log('PASS '+name);n++;}
await check('requires real Core callback',()=>assert.throws(()=>createScopedVoxAdvisoryReader({pool,secret}),/CORE_AUTHORIZATION_VERIFIER_REQUIRED/));
await check('rejects absent verified bearer without lookup',async()=>assert.rejects(()=>reader.verifyForStaff({agentViewToken:token,requesterBearer:''}),/STAFF_AUTH_REQUIRED/));
await check('rejects tampered view without Core lookup',async()=>assert.rejects(()=>reader.verifyForStaff({agentViewToken:token+'bad',requesterBearer:bearer}),/INVALID_SIGNATURE/));
await check('denies revoked Core scope before replay claim',async()=>{
 const denied=make(async()=>({...grant,objectScopeActive:false}));
 await assert.rejects(()=>denied.verifyForStaff({agentViewToken:token,requesterBearer:bearer}),/CORE_SUBJECT_SCOPE_DENIED/);
 assert.equal(claims,0);
});
await check('denies cross-subject Core verdict before claim',async()=>{
 const denied=make(async()=>({...grant,subjectId:id(6)}));
 await assert.rejects(()=>denied.verifyForStaff({agentViewToken:token,requesterBearer:bearer}),/CORE_SUBJECT_SCOPE_DENIED/);
 assert.equal(claims,0);
});
await check('rejects spoofed AAL2 via callback',async()=>{
 const denied=make(async()=>({...grant,aal2Verified:false}));
 await assert.rejects(()=>denied.verifyForStaff({agentViewToken:token,requesterBearer:bearer}),/CORE_SUBJECT_SCOPE_DENIED/);
 assert.equal(claims,0);
});
await check('fails closed when Core unavailable',async()=>{
 const denied=make(async()=>{throw Error('DB_DOWN')});
 await assert.rejects(()=>denied.verifyForStaff({agentViewToken:token,requesterBearer:bearer}),/CORE_AUTHORIZATION_UNAVAILABLE/);
 assert.equal(claims,0);
});
await check('authorized signed + durable claim gives sanitized one-time view',async()=>{
 const result=await reader.verifyForStaff({agentViewToken:token,requesterBearer:bearer});
 assert.equal(result.proofConsumed,true);assert.deepEqual(result.permissions,['READ_ONLY']);
 assert.equal(result.agent,'AAROHI');assert.equal(result.subjectId,id(1));
 for(const k of ['jti','expiresAt','rawMemory','wallet','phone','requesterBearer'])assert.ok(!(k in result));
 assert.equal(claims,1);assert.equal(reads,1);
});
await check('second consumption rejected',async()=>await assert.rejects(
 ()=>reader.verifyForStaff({agentViewToken:token,requesterBearer:bearer}),/REPLAY_OR_STORE_UNAVAILABLE/));
console.log('VOX14_SCOPED_JARVIS_ADVISORY_PASS '+n+'/9');
