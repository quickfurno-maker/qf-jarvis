import test from "node:test";import assert from "node:assert/strict";
import {createServer} from "node:http";
import {generateKeyPairSync,sign,verify} from "node:crypto";
import {createF1RiyaPauseHttpHandler,F1_RIYA_PAUSE_PATH} from
 "./riyaF1PauseHttpHandler.mjs";
import {riyaPauseCanonicalBody} from "./riyaF1SignedDurablePause.mjs";
const id=n=>"00000000-0000-4000-8000-"+String(n).padStart(12,"0");
const core=generateKeyPairSync("ed25519"),jarvis=generateKeyPairSync("ed25519");
const pem=(key,type)=>key.export({format:"pem",type}).toString();
const now=Date.parse("2026-10-17T06:00:00Z");
const request=()=>({schema:"qf.vox.riya.pause.command.v1",
 conversationId:id(1),clientId:id(2),projectId:id(3),staffId:id(4),
 revision:3,jti:id(5),issuedAtMs:now,expiresAtMs:now+60000,
 consentRevision:1});
const signature=req=>sign(null,Buffer.from(riyaPauseCanonicalBody(req)),
 core.privateKey).toString("base64url");
async function serve({transport=async()=>({ok:true,actor:"quickfurno-core"}),
 consent=async()=>true,grant=async()=>true,env="staging"}={}){
 let commits=0;
 const handler=createF1RiyaPauseHttpHandler({environment:env,
  verifyQfjSignedRequest:transport,
  corePublicKeyPem:pem(core.publicKey,"spki"),
  jarvisPrivateKeyPem:pem(jarvis.privateKey,"pkcs8"),now:()=>now,
  verifyCurrentCoreGrant:grant,verifyCurrentClientConsent:consent,
  pauseTransaction:async r=>{commits++;return {
   conversationId:r.conversationId,clientId:r.clientId,projectId:r.projectId,
   pauseRevision:r.expectedRevision+1,ackNonce:id(9),pausedAtMs:now,
   durablyCommitted:true,replayConsumed:true,
   grantsCheckedInTransaction:true,consentCheckedInTransaction:true};}});
 const server=createServer((req,res)=>{void handler(req,res);});
 await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
 const address=server.address();
 const base="http://127.0.0.1:"+address.port;
 return {base,get commits(){return commits;},
  close:()=>new Promise(resolve=>server.close(resolve))};
}
test("genuine local HTTP Core Ed25519 -> signed Jarvis pause ACK only",async()=>{
 const s=await serve();
 try{
  const r=request();const response=await fetch(s.base+F1_RIYA_PAUSE_PATH,{
   method:"POST",headers:{"content-type":"application/json"},
   body:JSON.stringify({request:r,signature:signature(r)})});
  assert.equal(response.status,202);
  const result=await response.json();
  assert.equal(result.paused,true);assert.equal(result.replyAuthorized,false);
  assert.equal(result.providerMessagesSent,0);
  assert.equal(verify(null,Buffer.from(JSON.stringify(result.receipt)),
   jarvis.publicKey,Buffer.from(result.signature,"base64url")),true);
  assert.equal(s.commits,1);
 }finally{await s.close();}
});
test("bad QFJ actor, missing consent, forged Core signature and off gate deny",async()=>{
 for(const opts of [
  {transport:async()=>({ok:true,actor:"unknown"})},
  {consent:async()=>false},{env:"production"}]){
  const s=await serve(opts);
  try{
   const r=request(),resp=await fetch(s.base+F1_RIYA_PAUSE_PATH,{
    method:"POST",headers:{"content-type":"application/json"},
    body:JSON.stringify({request:r,signature:signature(r)})});
   assert.notEqual(resp.status,202);assert.equal(s.commits,0);
  }finally{await s.close();}
 }
 const s=await serve();try{
  const r=request(),resp=await fetch(s.base+F1_RIYA_PAUSE_PATH,{
   method:"POST",headers:{"content-type":"application/json"},
   body:JSON.stringify({request:{...r,projectId:id(66)},signature:signature(r)})});
  assert.equal(resp.status,409);assert.equal(s.commits,0);
 }finally{await s.close();}
});
test("non-POST and browser filtering deny without transport invocation",async()=>{
 const s=await serve();try{
  assert.equal((await fetch(s.base+F1_RIYA_PAUSE_PATH)).status,405);
  assert.equal((await fetch(s.base+F1_RIYA_PAUSE_PATH+"?staff=1",{
   method:"POST"})).status,400);
  assert.equal(s.commits,0);
 }finally{await s.close();}
});
