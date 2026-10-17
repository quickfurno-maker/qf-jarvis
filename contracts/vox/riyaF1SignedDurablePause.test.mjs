import test from "node:test";import assert from "node:assert/strict";
import {generateKeyPairSync,sign,verify} from "node:crypto";
import {riyaPauseCanonicalBody,processSignedRiyaPause as pause}
 from "./riyaF1SignedDurablePause.mjs";
const id=n=>"00000000-0000-4000-8000-"+String(n).padStart(12,"0");
const core=generateKeyPairSync("ed25519"),jarvis=generateKeyPairSync("ed25519");
const pub=k=>k.publicKey.export({format:"pem",type:"spki"}).toString();
const priv=k=>k.privateKey.export({format:"pem",type:"pkcs8"}).toString();
const now=Date.parse("2026-10-17T05:50:00Z");
const request=()=>({schema:"qf.vox.riya.pause.command.v1",
 conversationId:id(1),clientId:id(2),projectId:id(3),staffId:id(4),
 revision:7,jti:id(5),issuedAtMs:now,expiresAtMs:now+45000,consentRevision:3});
const signed=r=>sign(null,Buffer.from(riyaPauseCanonicalBody(r)),core.privateKey)
 .toString("base64url");
const base=()=>{const r=request();let commits=0;
 const input={request:r,coreSignature:signed(r),
  corePublicKeyPem:pub(core),jarvisPrivateKeyPem:priv(jarvis),now,
  verifyCurrentCoreGrant:async()=>true,verifyCurrentClientConsent:async()=>true,
  pauseTransaction:async()=>{commits++;return {
   conversationId:r.conversationId,clientId:r.clientId,projectId:r.projectId,
   pauseRevision:8,ackNonce:id(9),pausedAtMs:now,durablyCommitted:true,
   replayConsumed:true,grantsCheckedInTransaction:true,
   consentCheckedInTransaction:true};}};
 return {input,get commits(){return commits;}};
};
test("genuine Ed25519 Core signature -> Jarvis signed ACK, no provider message",async()=>{
 const x=base();const result=await pause(x.input);
 assert.equal(result.ok,true);assert.equal(result.paused,true);
 assert.equal(result.replyAuthorized,false);assert.equal(result.providerMessagesSent,0);
 assert.equal(x.commits,1);
 assert.equal(verify(null,Buffer.from(JSON.stringify(result.receipt)),
  jarvis.publicKey,Buffer.from(result.signature,"base64url")),true);
});
test("tampered Core request or signer denied before transaction",async()=>{
 const x=base();
 assert.equal((await pause({...x.input,request:{...x.input.request,revision:8}})).ok,false);
 assert.equal((await pause({...x.input,corePublicKeyPem:pub(jarvis)})).ok,false);
 assert.equal(x.commits,0);
});
test("revoked Core grant and current consent prevent any durable write",async()=>{
 const x=base();
 assert.equal((await pause({...x.input,verifyCurrentCoreGrant:async()=>false})).ok,false);
 assert.equal((await pause({...x.input,verifyCurrentClientConsent:async()=>false})).ok,false);
 assert.equal(x.commits,0);
});
test("missing durable nonce or transaction grant proofs cannot issue ACK",async()=>{
 const x=base();const candidate=x.input.pauseTransaction;
 for(const patch of [{replayConsumed:false},{grantsCheckedInTransaction:false},
  {consentCheckedInTransaction:false},{durablyCommitted:false},
  {pauseRevision:9},{clientId:id(33)}]){
  const r=await pause({...x.input,pauseTransaction:async a=>({
   ...await candidate(a),...patch})});
  assert.equal(r.ok,false);
 }
});
test("expired/foreign or consent-revision-mismatched request denied",async()=>{
 const x=base();const r=x.input.request;
 for(const request of [{...r,expiresAtMs:now-1},
  {...r,consentRevision:0},{...r,projectId:id(66)},
  {...r,jti:"untrusted"}]){
  assert.equal((await pause({...x.input,request})).ok,false);
 }
});
test("durable database outage fails closed; no false signed receipt",async()=>{
 const x=base();const r=await pause({...x.input,pauseTransaction:async()=>{
  throw Error("PRIVATE_CONNECTION");
 }});
 assert.equal(r.ok,false);assert.equal(r.providerMessagesSent,0);
 assert.equal(JSON.stringify(r).includes("PRIVATE_CONNECTION"),false);
});
