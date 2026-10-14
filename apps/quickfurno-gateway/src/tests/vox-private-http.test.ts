import {generateKeyPairSync} from 'node:crypto';
import type {AddressInfo} from 'node:net';
import {afterEach,describe,expect,it} from 'vitest';
import type {GatewayConfig} from '../config.js';
import {parseSigningKey,parseVerificationKey} from '../protocol.js';
import {createGatewayServer} from '../server.js';
const quickfurno=generateKeyPairSync('ed25519'),jarvis=generateKeyPairSync('ed25519');
const verify=parseVerificationKey('quickfurno-test',quickfurno.publicKey.export({format:'pem',type:'spki'}).toString());
const signing=parseSigningKey('jarvis-test',jarvis.privateKey.export({format:'pem',type:'pkcs8'}).toString());
if(!verify||!signing)throw Error('TEST_KEYS_INVALID');
const config:GatewayConfig={schemaVersion:1,environment:'staging',serviceId:'qf-jarvis.quickfurno-gateway',
 verificationKeys:[verify],signingKey:signing,maxClockSkewMs:60000,replayTtlMs:120000,replayMaxEntries:100};
const bearer='aaa'.repeat(40)+'.'+'bbb'.repeat(40)+'.'+'ccc'.repeat(40);
const payload={agentViewToken:'signed.agent.view.'+'x'.repeat(120)};
const proof={schema:'qf.vox.agent.view.v1',agent:'AAROHI',channel:'ACQUISITION',
 subjectType:'prospect',subjectId:'00000000-0000-4000-8000-000000000011',
 revision:5,memoryStatus:'DISABLED',humanTakeover:true,lastEvent:'HANDOVER',
 proofConsumed:true,permissions:['READ_ONLY'],phone:'PRIVATE',wallet:4500};
const servers:Array<ReturnType<typeof createGatewayServer>>=[];
const old=process.env['QFJ_VOX_ADVISORY_ENABLED'];
afterEach(async()=>{
 process.env['QFJ_VOX_ADVISORY_ENABLED']=old;
 await Promise.all(servers.splice(0).map(s=>new Promise<void>(resolve=>s.close(()=>resolve()))));
});
async function endpoint(reader?:{verifyForStaff(args:{agentViewToken:string;requesterBearer:string}):Promise<unknown>}){
 const s=createGatewayServer({...{config},...(reader?{voxAdvisoryReader:reader}:{})});
 servers.push(s);await new Promise<void>(resolve=>s.listen(0,'127.0.0.1',resolve));
 const info=s.address() as AddressInfo;return 'http://127.0.0.1:'+info.port+'/internal/vox/v1/agent-view';
}
function send(url:string,options:RequestInit={}){
 return fetch(url,{method:'POST',headers:{authorization:'Bearer '+bearer,'content-type':'application/json'},
 body:JSON.stringify(payload),...options});
}
describe('VOX-16E private Jarvis HTTP gateway (actual loopback socket)',()=>{
 it('default disabled even with reader',async()=>{
  delete process.env['QFJ_VOX_ADVISORY_ENABLED'];
  const url=await endpoint({verifyForStaff:async()=>proof});const r=await send(url);
  expect(r.status).toBe(503);expect(await r.json()).toMatchObject({error:'service_unavailable'});
 });
 it('requires injected Core-authorized replay reader',async()=>{
  process.env['QFJ_VOX_ADVISORY_ENABLED']='staging';
  const url=await endpoint();expect((await send(url)).status).toBe(503);
 });
 it('serializes exactly one sanitized read-only response',async()=>{
  process.env['QFJ_VOX_ADVISORY_ENABLED']='staging';let n=0;
  const url=await endpoint({verifyForStaff:async({agentViewToken,requesterBearer})=>{
   n++;expect(agentViewToken).toBe(payload.agentViewToken);expect(requesterBearer).toBe(bearer);return proof;}});
  const r=await send(url);const body=await r.json();
  expect(r.status).toBe(200);expect(n).toBe(1);
  expect(body).toMatchObject({schema:'qf.vox.agent.view.v1',permissions:['READ_ONLY'],proofConsumed:true});
  expect(JSON.stringify(body)).not.toContain('PRIVATE');
  expect(JSON.stringify(body)).not.toContain('wallet');expect(JSON.stringify(body)).not.toContain('4500');
  expect(JSON.stringify(body)).not.toContain(bearer);
 });
 it('does not trust bearer without cryptographic reader',async()=>{
  process.env['QFJ_VOX_ADVISORY_ENABLED']='staging';
  const url=await endpoint({verifyForStaff:async()=>{throw Error('CURRENT_CORE_DENIED')}});
  const r=await send(url);expect(r.status).toBe(403);
  expect(await r.json()).toEqual({error:'scope_or_replay_denied'});
 });
 it('denies provider action permissions even from injected reader',async()=>{
  process.env['QFJ_VOX_ADVISORY_ENABLED']='staging';
  const url=await endpoint({verifyForStaff:async()=>({...proof,permissions:['SEND_MESSAGE']})});
  expect((await send(url)).status).toBe(403);
 });
 it('denies invalid body fields',async()=>{
  process.env['QFJ_VOX_ADVISORY_ENABLED']='staging';
  const url=await endpoint({verifyForStaff:async()=>proof});
  const r=await send(url,{body:JSON.stringify({...payload,cityId:'spoofed'})});
  expect(r.status).toBe(400);
 });
 it('denies untrusted staff bearer',async()=>{
  process.env['QFJ_VOX_ADVISORY_ENABLED']='staging';
  const url=await endpoint({verifyForStaff:async()=>proof});
  expect((await send(url,{headers:{'content-type':'application/json','authorization':'Bearer fake'}})).status).toBe(401);
 });
 it('denies GET and query strings without invoking reader',async()=>{
  process.env['QFJ_VOX_ADVISORY_ENABLED']='staging';let n=0;
  const url=await endpoint({verifyForStaff:async()=>{n++;return proof;}});
  expect((await fetch(url,{method:'GET'})).status).toBe(405);
  expect((await send(url+'?role=owner')).status).toBe(400);expect(n).toBe(0);
 });
});
