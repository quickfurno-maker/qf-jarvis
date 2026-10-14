import assert from 'node:assert/strict';
import {createVoxCoreSubjectAuthorizer} from '../../contracts/vox/coreSubjectAuthorizer.mjs';
import {createScopedVoxAdvisoryReader} from '../../contracts/vox/scopedAdvisoryReader.mjs';
import {signAgentView,VOX_JARVIS_CONTRACT} from '../../contracts/vox/agentView.mjs';
const id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0'),time=Math.floor(Date.now()/1000);
const secret='test-core-boundary-and-durable-replay-signer-key';
const bearer='a'.repeat(120)+'.'+'b'.repeat(120)+'.'+'c'.repeat(120);
const expected={ok:true,schema:'qf.vox.agent.subject.access.v1',allowed:true,
 agent:'AAROHI',subjectType:'prospect',subjectId:id(1),revision:4,staffUserId:id(9),
 aal2Verified:true,objectScopeActive:true,cityScopeActive:true,
 humanTakeoverAllowed:true,permissions:['READ_ONLY']};
const originalFetch=async(url,opts)=>{
 assert.equal(url,'https://staging-core.quickfurno.in/api/vox/v1/agent-subject-access');
 assert.equal(opts.method,'POST');assert.equal(opts.redirect,'error');
 assert.equal(opts.cache,'no-store');assert.equal(opts.headers.authorization,'Bearer '+bearer);
 assert.deepEqual(JSON.parse(opts.body),{agent:'AAROHI',subjectType:'prospect',subjectId:id(1),revision:4});
 return {ok:true,status:200,headers:{get:()=> 'application/json'},json:async()=>expected};
};
const make=(f=originalFetch)=>createVoxCoreSubjectAuthorizer({coreOrigin:'https://staging-core.quickfurno.in',fetchImpl:f});
const request={requesterBearer:bearer,agent:'AAROHI',channel:'ACQUISITION',subjectType:'prospect',subjectId:id(1),revision:4};
let n=0;async function check(name,fn){await fn();console.log('PASS '+name);n++;}
await check('origin fixed to reviewed staging Core',()=>assert.throws(()=>createVoxCoreSubjectAuthorizer({coreOrigin:'https://evil.test'}),/NOT_ALLOWED/));
await check('credentials in origin forbidden',()=>assert.throws(()=>createVoxCoreSubjectAuthorizer({coreOrigin:'https://a:b@staging-core.quickfurno.in'}),/NOT_ALLOWED/));
await check('alternate port denied',()=>assert.throws(()=>createVoxCoreSubjectAuthorizer({coreOrigin:'https://staging-core.quickfurno.in:444'}),/NOT_ALLOWED/));
await check('bad bearer rejected before network',async()=>assert.rejects(()=>make()({...request,requesterBearer:'bogus'}),/REQUEST_INVALID/));
await check('wrong agent mapping rejected',async()=>assert.rejects(()=>make()({...request,channel:'VENDOR_SERVICE'}),/REQUEST_INVALID/));
await check('correct server-to-server Core auth request',async()=>{const r=await make()(request);assert.equal(r.allowed,true);assert.equal(r.staffUserId,id(9));assert.equal('permissions' in r,false);});
await check('wrong subject response fails closed',async()=>assert.rejects(()=>make(async()=>({ok:true,status:200,headers:{get:()=> 'application/json'},json:async()=>({...expected,subjectId:id(2)})}))(request),/RESPONSE_DENIED/));
await check('unexpected private field rejected',async()=>assert.rejects(()=>make(async()=>({ok:true,status:200,headers:{get:()=> 'application/json'},json:async()=>({...expected,phone:'secret'})}))(request),/RESPONSE_DENIED/));
await check('Core 403 denied',async()=>assert.rejects(()=>make(async()=>({ok:false,status:403,headers:{get:()=> 'application/json'}}))(request),/DENIED_OR_INVALID/));
await check('Core outage fails closed',async()=>assert.rejects(()=>make(async()=>{throw Error('network')})(request),/CORE_SUBJECT_UNAVAILABLE/));
let claims=0;
const pool={query:async()=>({rows:claims++===0?[{key_hash:'synthetic'}]:[]})};
const verifier=createScopedVoxAdvisoryReader({pool,secret,authorizeCoreSubject:make(),clock:()=>time});
const token=signAgentView({schema:VOX_JARVIS_CONTRACT,iss:'qf-jarvis',aud:'vox-web',
 agent:'AAROHI',channel:'ACQUISITION',subjectType:'prospect',subjectId:id(1),
 jti:id(4),revision:4,iat:time,exp:time+120,memoryStatus:'PAUSED',
 humanTakeover:true,lastEvent:'READY'},secret);
await check('end-to-end signed Core decision and one-time durable claim',async()=>{
 const v=await verifier.verifyForStaff({agentViewToken:token,requesterBearer:bearer});
 assert.equal(v.proofConsumed,true);assert.deepEqual(v.permissions,['READ_ONLY']);assert.equal(claims,1);
});
await check('end-to-end replay rejected',async()=>assert.rejects(
 ()=>verifier.verifyForStaff({agentViewToken:token,requesterBearer:bearer}),/REPLAY_OR_STORE_UNAVAILABLE/));
console.log('VOX14_CORE_CALLBACK_CONTRACT_PASS '+n+'/'+n);
