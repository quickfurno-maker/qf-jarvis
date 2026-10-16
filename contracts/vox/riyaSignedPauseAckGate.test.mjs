import test from "node:test";
import assert from "node:assert/strict";
import {inspectSignedRiyaPauseAck as inspect} from "./riyaSignedPauseAckGate.mjs";
const id=n=>"00000000-0000-4000-8000-"+String(n).padStart(12,"0");
const now=Date.now();
const request={schema:"qf.vox.riya.handover.read-request.v1",
 conversationId:id(1),clientId:id(2),projectId:id(3),revision:4,
 jti:id(4),expiresAtMs:now+30000};
const receipt={schema:"qfj.vox.riya.pause-ack.v1",
 conversationId:id(1),clientId:id(2),projectId:id(3),revision:4,
 pauseRevision:5,ackNonce:id(5),issuedAtMs:now,
 expiresAtMs:now+30000,state:"PAUSED_ACK",actor:"RIYA"};
const callbacks={verifyJarvisSignature:async()=>true,
 checkDurableJarvisPause:async()=>true,confirmFreshCoreGrant:async()=>true,
 confirmFreshClientConsent:async()=>true,consumeReplayNonce:async()=>true};
const run=p=>inspect({request,receipt,now,...callbacks,...p});
test("verified synthetic receipt only allows proposal, not takeover or provider send",async()=>{
 const r=await run();assert.equal(r.ok,true);assert.equal(r.pauseAckVerified,true);
 assert.equal(r.eligibleForSeparateCoreApproval,true);
 assert.equal(r.takeoverExecuted,false);assert.equal(r.replyAuthorized,false);
 assert.equal(r.providerMessagesSent,0);
});
test("stale replay, foreign project, wrong revisions and untrusted actor denied",async()=>{
 for(const r of [{...receipt,projectId:id(8)},
 {...receipt,revision:5},{...receipt,pauseRevision:6},
 {...receipt,actor:"HUMAN"},{...receipt,state:"HUMAN"},
 {...receipt,issuedAtMs:now-90000},{...receipt,expiresAtMs:now-1}]){
  assert.equal((await run({receipt:r})).ok,false);
 }
});
test("signature, durable pause, grant, consent and one-use replay each fail closed",async()=>{
 for(const name of Object.keys(callbacks)){
  assert.equal((await run({[name]:async()=>false})).ok,false,name);
 }
});
test("nonce consumer runs after verifying original subject, signed pause and consent",async()=>{
 const seen=[];
 const handlers={};
 for(const name of Object.keys(callbacks)){
  handlers[name]=async()=>{seen.push(name);return true;};
 }
 assert.equal((await run(handlers)).ok,true);
 assert.deepEqual(seen,["verifyJarvisSignature","checkDurableJarvisPause",
  "confirmFreshCoreGrant","confirmFreshClientConsent","consumeReplayNonce"]);
});
test("a thrown durable transport or missing Core scope fail closed",async()=>{
 assert.equal((await run({checkDurableJarvisPause:async()=>{throw Error("outage")}})).ok,false);
 assert.equal((await run({confirmFreshCoreGrant:null})).ok,false);
 assert.equal((await run({receipt:{...receipt,secret:"unexpected"}})).ok,false);
});
