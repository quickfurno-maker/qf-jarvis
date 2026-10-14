import assert from 'node:assert/strict';
import {signAgentView,VOX_JARVIS_CONTRACT} from '../../contracts/vox/agentView.mjs';
import {createDatabaseBackedVoxAgentVerifier} from '../../contracts/vox/durableAgentVerifier.mjs';
const time=Math.floor(Date.now()/1000),uuid=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const secret='synthetic-jarvis-signing-key-for-local-unit-testing-only';
const event={schema:VOX_JARVIS_CONTRACT,iss:'qf-jarvis',aud:'vox-web',agent:'AAROHI',
 channel:'ACQUISITION',subjectType:'prospect',subjectId:uuid(1),jti:uuid(2),revision:2,
 iat:time,exp:time+120,memoryStatus:'DISABLED',humanTakeover:false,lastEvent:'PROSPECT_READY'};
const used=new Set();
const pool={query:async(sql,args)=>{assert.match(sql,/ON CONFLICT/);assert.equal(args.length,2);
 const key=args[0];if(used.has(key))return {rows:[]};used.add(key);return {rows:[{key_hash:key}]};}};
let n=0;const t=async(name,fn)=>{await fn();console.log('PASS '+name);n++};
await t('existing pool required',()=>assert.throws(()=>createDatabaseBackedVoxAgentVerifier({secret}),/POOL_REQUIRED/));
await t('missing key refused',()=>assert.throws(()=>createDatabaseBackedVoxAgentVerifier({pool,secret:'foo'}),/SIGNING_KEY_REQUIRED/));
const verifier=createDatabaseBackedVoxAgentVerifier({pool,secret,clock:()=>time});
await t('signed status consumes durable replay claim',async()=>{const value=await verifier.verifySignedView(signAgentView(event,secret));assert.equal(value.proofConsumed,true);assert.deepEqual(value.permissions,['READ_ONLY']);});
await t('replay denied for same signed nonce',async()=>await assert.rejects(()=>verifier.verifySignedView(signAgentView(event,secret)),/REPLAY_OR_STORE_UNAVAILABLE/));
await t('invalid signature denied',async()=>await assert.rejects(()=>verifier.verifySignedView(signAgentView({...event,jti:uuid(3)},'some-other-secret-is-long-enough-for-testing')),/INVALID_SIGNATURE/));
await t('expired event denied',async()=>{const v=createDatabaseBackedVoxAgentVerifier({pool,secret,clock:()=>time+500});await assert.rejects(()=>v.verifySignedView(signAgentView({...event,jti:uuid(3)},secret)),/INVALID_OR_EXPIRED_AGENT_VIEW/);});
await t('bad database closed',async()=>{const v=createDatabaseBackedVoxAgentVerifier({pool:{query:async()=>{throw Error('POSTGRES_UNAVAILABLE')}},secret,clock:()=>time});await assert.rejects(()=>v.verifySignedView(signAgentView({...event,jti:uuid(4)},secret)),/POSTGRES_UNAVAILABLE/);});
await t('no raw message or wallet in result',async()=>{const v=await verifier.verifySignedView(signAgentView({...event,jti:uuid(5)},secret));assert.equal('wallet' in v,false);assert.equal('rawMemory' in v,false);});
console.log('VOX10C_DURABLE_AGENT_VIEW_COMPOSITION_PASS '+n+'/8');
