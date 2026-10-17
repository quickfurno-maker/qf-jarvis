import test from "node:test";
import assert from "node:assert/strict";
import {generateKeyPairSync,sign} from "node:crypto";
import {riyaPauseCanonicalBody} from "./riyaF1SignedDurablePause.mjs";
import {prepareAb3SignedHumanCase as prepare} from "./ab3SignedHandoverVerifier.mjs";
const id=n=>"00000000-0000-4000-8000-"+String(n).padStart(12,"0");
const now=Date.parse("2026-10-17T16:30:00Z");
const core=generateKeyPairSync("ed25519"),jarvis=generateKeyPairSync("ed25519");
const pem=(key,type)=>key.export({format:"pem",type}).toString();
const cp=pem(core.publicKey,"spki"),jp=pem(jarvis.publicKey,"spki");
const staff={userId:id(1),teamId:id(2),cityId:id(3),currentAal:"aal2",
 verifiedDepartments:["client_success"]};
const reviewer={userId:id(4),teamId:id(2),cityId:id(3),
 currentAal:"aal2",role:"team_leader"};
const command={schema:"qf.vox.riya.pause.command.v1",
 conversationId:id(5),clientId:id(6),projectId:id(7),staffId:id(1),
 revision:3,jti:id(8),issuedAtMs:now-1000,expiresAtMs:now+20000,
 consentRevision:2};
const coreSign=c=>sign(null,Buffer.from(riyaPauseCanonicalBody(c)),
 core.privateKey).toString("base64url");
const receipt={schema:"qfj.vox.riya.pause-ack.v1",
 conversationId:command.conversationId,clientId:command.clientId,
 projectId:command.projectId,revision:3,pauseRevision:4,
 ackNonce:id(9),issuedAtMs:now,expiresAtMs:now+30000,
 state:"PAUSED_ACK",actor:"RIYA"};
const ackSign=r=>sign(null,Buffer.from(JSON.stringify(r)),
 jarvis.privateKey).toString("base64url");
const ack={ok:true,paused:true,takeoverExecuted:false,
 replyAuthorized:false,providerMessagesSent:0,receipt,
 signature:ackSign(receipt)};
const consent={conversationId:id(5),revision:2,status:"ALLOWED",
 outboundApproved:false};
const base=()=>({environment:"staging",staff,reviewer,command,
 coreSignature:coreSign(command),ack,corePublicKeyPem:cp,
 jarvisPublicKeyPem:jp,consent,now,
 verifyCurrentCoreGrant:async()=>true,
 verifyCurrentConsent:async()=>true,
 verifyIndependentHumanReview:async()=>true,
 registerPendingHumanCase:async x=>({
  persisted:true,state:"PENDING_HUMAN_ACCEPTANCE",
  conversationId:x.conversationId,jti:x.jti,
  coreGrantRecheckedInTransaction:true,
  consentRecheckedInTransaction:true,
  independentReviewRecheckedInTransaction:true,
  nonceConsumedInTransaction:true,takeoverExecuted:false,
  providerMessagesSent:0
 })});
test("AB3 real dual Ed25519 signatures generate pending-only human case",async()=>{
 const x=await prepare(base());
 assert.equal(x.ok,true);
 assert.equal(x.state,"PENDING_HUMAN_ACCEPTANCE");
 assert.equal(x.takeoverAuthorized,false);
 assert.equal(x.providerMessagesSent,0);
});
test("AB3 forged Core permit or forged Jarvis ACK denies independently",async()=>{
 for(const patch of [
  {coreSignature:"corrupted"},
  {ack:{...ack,signature:"corrupted"}},
  {command:{...command,staffId:id(99)}},
  {ack:{...ack,receipt:{...receipt,pauseRevision:5}}},
  {ack:{...ack,receipt:{...receipt,conversationId:id(96)}}},
  {consent:{...consent,revision:3}},
  {now:now+60000},
  {environment:"production"}
 ]){
  const x=await prepare({...base(),...patch});
  assert.equal(x.ok,false,JSON.stringify(patch));
 }
});
test("AB3 any current reviewer, grant or consent revocation denies",async()=>{
 for(const field of ["verifyCurrentCoreGrant","verifyCurrentConsent",
  "verifyIndependentHumanReview"]){
  const x=await prepare({...base(),[field]:async()=>false});
  assert.equal(x.ok,false);
 }
 const self=await prepare({...base(),reviewer:{...reviewer,userId:staff.userId}});
 assert.equal(self.ok,false);
});
test("AB3 16 concurrent handovers, exactly one synthetic atomic pending case",async()=>{
 const used=new Set();let accepted=0;
 const receipt=async x=>{
  if(used.has(x.jti))throw Error("REPLAY");
  used.add(x.jti);accepted++;
  return base().registerPendingHumanCase(x);
 };
 const runs=await Promise.all(Array.from({length:16},()=>prepare({
  ...base(),registerPendingHumanCase:receipt
 })));
 assert.equal(runs.filter(x=>x.ok).length,1);
 assert.equal(accepted,1);
 assert.ok(runs.every(x=>x.takeoverAuthorized===false));
});
