import test from "node:test";
import assert from "node:assert/strict";
import {reconcileRiyaHandoverEvidence as reconcile} from "./riyaHandoverEvidenceReconciliation.mjs";
const id=n=>"00000000-0000-4000-8000-"+String(n).padStart(12,"0");
const now=Date.now();
const core={schema:"qf.vox.riya.handover.read-request.v1",
 conversationId:id(1),clientId:id(2),projectId:id(3),revision:8,
 expiresAtMs:now+60000,jti:id(4)};
const jarvis={schema:"qfj.vox.riya.handover.observation.v1",
 conversationId:id(1),clientId:id(2),projectId:id(3),revision:8,
 state:"TAKEOVER_PENDING",origin:"JARVIS_READ_ONLY",
 providerMessagesSent:0,observedAt:new Date(now).toISOString()};
const consent={schema:"qfj.vox.current-consent.v1",
 conversationId:id(1),clientId:id(2),projectId:id(3),revision:8,
 channel:"WHATSAPP",state:"OPTED_IN",expiresAtMs:now+60000};
const verifiers={verifyCoreRequest:async()=>true,
 verifyJarvisObservation:async()=>true,
 verifyCurrentConsent:async()=>true,verifyCurrentObjectGrant:async()=>true};
const go=p=>reconcile({coreRequest:core,jarvisObservation:jarvis,
 consent,now,...verifiers,...p});
test("matched signed snapshots are READ_ONLY; no pause ack, replies or provider send",async()=>{
 const r=await go();assert.equal(r.ok,true);
 assert.equal(r.sourceStateReconciled,true);assert.equal(r.pauseAckVerified,false);
 assert.equal(r.takeoverAuthorized,false);assert.equal(r.replyAuthorized,false);
 assert.equal(r.providerMessagesSent,0);
});
test("current HUMAN state does not fabricate a real Jarvis pause ACK",async()=>{
 const r=await go({jarvisObservation:{...jarvis,state:"HUMAN"}});
 assert.equal(r.ok,true);assert.equal(r.pauseAckVerified,false);
});
test("wrong conversation, project, revision or stale observation denied",async()=>{
 for(const row of [{...jarvis,conversationId:id(5)},
  {...jarvis,projectId:id(7)},{...jarvis,revision:7},
  {...jarvis,observedAt:new Date(now-120000).toISOString()}]){
  assert.equal((await go({jarvisObservation:row})).ok,false);
 }
});
test("revoked grant, missing issuer signature or revoked consent denies",async()=>{
 for(const key of Object.keys(verifiers)){
  assert.equal((await go({[key]:async()=>false})).ok,false,key);
 }
 assert.equal((await go({consent:{...consent,state:"REVOKED"}})).ok,false);
});
test("tampered payload, replay freshness or missing trusted verifier denies",async()=>{
 assert.equal((await go({coreRequest:{...core,jti:"bad"}})).ok,false);
 assert.equal((await go({coreRequest:{...core,expiresAtMs:now-1}})).ok,false);
 assert.equal((await go({jarvisObservation:{...jarvis,message:"private"}})).ok,false);
 assert.equal((await go({verifyCoreRequest:null})).ok,false);
});
test("source verifier exception must fail closed",async()=>{
 const r=await go({verifyCurrentConsent:async()=>{throw Error("unavailable")}});
 assert.equal(r.ok,false);assert.equal(r.replyAuthorized,false);
});