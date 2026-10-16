import test from "node:test";import assert from "node:assert/strict";
import {readRiyaHandoverObservation as read}
 from "./riyaReadOnlyHandoverObservation.mjs";
const id=n=>"00000000-0000-4000-8000-"+String(n).padStart(12,"0");
const now=Date.parse("2026-10-16T12:00:00Z");
const proof=()=>({schema:"qf.vox.riya.handover.read-request.v1",
 conversationId:id(1),clientId:id(2),projectId:id(3),
 revision:4,expiresAtMs:now+60000,jti:id(4)});
const state=p=>({conversationId:p.conversationId,clientId:p.clientId,
 projectId:p.projectId,revision:p.revision,state:"AI",
 source:"JARVIS_DURABLE_RIYA_STATE"});
const run=(changes={})=>read({proof:proof(),now,
 verifyCoreRequest:async()=>true,readCurrentState:async x=>state(x),...changes});
test("read only Jarvis observation contains no pause/send acknowledgment",async()=>{
 const r=await run();assert.equal(r.schema,"qfj.vox.riya.handover.observation.v1");
 assert.equal(r.state,"AI");assert.equal(r.origin,"JARVIS_READ_ONLY");
 assert.equal(r.providerMessagesSent,0);
 assert.equal(Object.hasOwn(r,"pausedRiya"),false);
 assert.equal(Object.hasOwn(r,"executionAuthorized"),false);
});
test("missing authenticated verifier or reader denied",async()=>{
 assert.equal((await run({verifyCoreRequest:undefined})).ok,false);
 assert.equal((await run({readCurrentState:null})).ok,false);
});
test("replayed or untrusted request refused by independent signer verifier",async()=>{
 assert.equal((await run({verifyCoreRequest:async()=>false})).ok,false);
 assert.equal((await run({verifyCoreRequest:async()=>{throw Error("REPLAY")}})).ok,false);
});
test("foreign client, project or revised Jarvis state denied",async()=>{
 for(const change of [{clientId:id(88)},{projectId:id(99)},
  {revision:6},{source:"BROWSER"}]){
  const r=await run({readCurrentState:async x=>({...state(x),...change})});
  assert.equal(r.ok,false);
 }
});
test("bad signed request shape and expiry denied",async()=>{
 for(const change of [{expiresAtMs:now-1},{jti:"BAD"},
  {clientId:id(3),role:"ADMIN"},{expiresAtMs:now+999999}]){
  const r=await run({proof:{...proof(),...change}});
  assert.equal(r.ok,false);
 }
});
test("throws and invalid state cannot authorize provider delivery",async()=>{
 assert.equal((await run({readCurrentState:async()=>{throw Error("OFF")}})).ok,false);
 assert.equal((await run({readCurrentState:async x=>({...state(x),state:"WHATSAPP_SENT"})})).ok,false);
});
