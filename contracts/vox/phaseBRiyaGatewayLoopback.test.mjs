/**
 * Phase B synthetic private loopback integration, never live. Real Ed25519
 * Core permit signature + Jarvis ACK; a synthetic QFJ transport verifier
 * stands in for the separate real M2M service and MUST NOT be deployed.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {generateKeyPairSync,sign,verify} from "node:crypto";
import {createGatewayServer} from "../../apps/quickfurno-gateway/dist/server.js";
import {parseSigningKey,parseVerificationKey} from "../../apps/quickfurno-gateway/dist/protocol.js";
import {createF1RiyaPauseHttpHandler}
 from "./riyaF1PauseHttpHandler.mjs";
import {riyaPauseCanonicalBody} from "./riyaF1SignedDurablePause.mjs";
const id=n=>"00000000-0000-4000-8000-"+String(n).padStart(12,"0");
const clock=Date.parse("2026-10-17T14:30:00Z");
const core=generateKeyPairSync("ed25519"),jarvis=generateKeyPairSync("ed25519");
const pem=(key,type)=>key.export({type,format:"pem"}).toString();
const verification=parseVerificationKey("synthetic-core",
 pem(core.publicKey,"spki"));
const signingKey=parseSigningKey("synthetic-jarvis",
 pem(jarvis.privateKey,"pkcs8"));
if(!verification||!signingKey)throw Error("SYNTHETIC_KEY_INVALID");
const config={schemaVersion:1,environment:"staging",
 serviceId:"qf-jarvis.quickfurno-gateway",
 verificationKeys:[verification],signingKey,maxClockSkewMs:60000,
 replayTtlMs:120000,replayMaxEntries:100};
const flags=process.env.QFJ_VOX_RIYA_PAUSE_PRIVATE_ENABLED;
const PATH="/internal/vox/v1/riya/pause";
const request=()=>({schema:"qf.vox.riya.pause.command.v1",
 conversationId:id(1),clientId:id(2),projectId:id(3),staffId:id(4),
 revision:6,jti:id(5),issuedAtMs:clock,expiresAtMs:clock+45000,
 consentRevision:2});
const signature=req=>sign(null,Buffer.from(riyaPauseCanonicalBody(req)),
 core.privateKey).toString("base64url");
const servers=[];
async function serve({gate=true,privateIngress=true,consent=true,
 grant=true,environment="staging",allowHandler=true}={}){
 process.env.QFJ_VOX_RIYA_PAUSE_PRIVATE_ENABLED=gate?"staging":"off";
 let writes=0;
 const used=new Set();
 const trusted=createF1RiyaPauseHttpHandler({
  environment:"staging",now:()=>clock,
  corePublicKeyPem:pem(core.publicKey,"spki"),
  jarvisPrivateKeyPem:pem(jarvis.privateKey,"pkcs8"),
  // Test-only synthetic M2M verification. Signed Core command still
  // requires independent genuine Ed25519 verification in F1 handler.
  verifyQfjSignedRequest:async()=>({ok:true,actor:"quickfurno-core"}),
  verifyCurrentCoreGrant:async()=>grant,
  verifyCurrentClientConsent:async()=>consent,
  pauseTransaction:async r=>{
   if(used.has(r.jti))throw Error("REPLAY");
   used.add(r.jti);writes++;
   return {conversationId:r.conversationId,clientId:r.clientId,
    projectId:r.projectId,pauseRevision:r.expectedRevision+1,
    ackNonce:id(9),pausedAtMs:clock,durablyCommitted:true,
    replayConsumed:true,grantsCheckedInTransaction:true,
    consentCheckedInTransaction:true};
  }
 });
 const server=createGatewayServer({
  config:{...config,environment},
  ...(allowHandler?{voxRiyaPausePrivateHandler:{
   verifyPrivateIngress:async()=>privateIngress,
   handle:trusted
  }}:{})
 });
 await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
 servers.push(server);
 const address=server.address();
 return {url:"http://127.0.0.1:"+address.port+PATH,
  get writes(){return writes;}};
}
async function post(url,req=request(),sig=signature(req)){
 return fetch(url,{method:"POST",headers:{"content-type":"application/json"},
  body:JSON.stringify({request:req,signature:sig})});
}
test.after(async()=>{
 if(flags===undefined)delete process.env.QFJ_VOX_RIYA_PAUSE_PRIVATE_ENABLED;
 else process.env.QFJ_VOX_RIYA_PAUSE_PRIVATE_ENABLED=flags;
 await Promise.all(servers.map(s=>new Promise(resolve=>s.close(resolve))));
});
test("Phase B real gateway local route: Ed25519 pause ACK and nonce replay",async()=>{
 const s=await serve();
 const response=await post(s.url);
 assert.equal(response.status,202);
 const r=await response.json();
 assert.equal(r.paused,true);
 assert.equal(r.replyAuthorized,false);assert.equal(r.takeoverExecuted,false);
 assert.equal(r.providerMessagesSent,0);
 assert.equal(verify(null,Buffer.from(JSON.stringify(r.receipt)),
  jarvis.publicKey,Buffer.from(r.signature,"base64url")),true);
 assert.equal((await post(s.url)).status,409);
 assert.equal(s.writes,1);
});
test("Phase B forged command signature or revoked consent rejects",async()=>{
 const s=await serve();
 const cmd=request();
 assert.equal((await post(s.url,{...cmd,revision:7},signature(cmd))).status,409);
 assert.equal(s.writes,0);
 const disallowed=await serve({consent:false});
 assert.equal((await post(disallowed.url)).status,409);
 assert.equal(disallowed.writes,0);
});
test("Phase B denied private origin and missing handler cannot open",async()=>{
 const x=await serve({privateIngress:false});
 assert.equal((await post(x.url)).status,403);assert.equal(x.writes,0);
 const y=await serve({allowHandler:false});
 assert.equal((await post(y.url)).status,503);
});
test("Phase B default disabled staging route requires explicit release flag",async()=>{
 const s=await serve({gate:false});
 assert.equal((await post(s.url)).status,503);assert.equal(s.writes,0);
 const x=await serve({environment:"production"});
 assert.equal((await post(x.url)).status,503);assert.equal(x.writes,0);
});
