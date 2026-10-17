import test from "node:test";
import assert from "node:assert/strict";
import {acknowledgeAb4InternalHumanCase as acknowledge}
 from "./ab4HumanCaseAcknowledgement.mjs";
const id=n=>"00000000-0000-4000-8000-"+String(n).padStart(12,"0");
const staff={userId:id(1),teamId:id(2),cityId:id(3),
 currentAal:"aal2",verifiedDepartments:["client_success"]};
const reviewer={userId:id(4),teamId:id(2),cityId:id(3),
 currentAal:"aal2",role:"team_leader"};
const caseSnapshot={caseId:id(5),conversationId:id(6),projectId:id(7),
 jti:id(8),staffId:id(1),reviewerId:id(4),
 state:"PENDING_HUMAN_ACCEPTANCE",signedPauseAckVerified:true,
 pauseRevision:3,consentRevision:2,expectedCaseRevision:0};
const consent={conversationId:id(6),revision:2,status:"ALLOWED",
 outboundApproved:false};
function make(){
 let commits=0;
 const args={environment:"staging",staff,reviewer,caseSnapshot,consent,
  verifyCurrentStaffGrant:async()=>true,
  verifyCurrentIndependentReviewer:async()=>true,
  verifyCurrentConsent:async()=>true,
  verifyPersistedSignedPauseEvidence:async()=>true,
  commitInternalCaseAck:async()=>{commits++;return {
   caseId:id(5),conversationId:id(6),staffId:id(1),reviewerId:id(4),
   state:"INTERNAL_HANDOVER_ACKNOWLEDGED",caseRevision:1,
   coreGrantRecheckedInTransaction:true,
   consentRecheckedInTransaction:true,
   independentReviewerRecheckedInTransaction:true,
   signedPauseEvidenceRecheckedInTransaction:true,
   jtiConsumedInTransaction:true,
   providerMessagesSent:0,takeoverExecuted:false,replyAuthorized:false
  };}};
 return {args,get commits(){return commits}};
}
test("AB4 genuine reviewed case can only acknowledge INTERNAL state",async()=>{
 const f=make(),r=await acknowledge(f.args);
 assert.equal(r.ok,true);assert.equal(f.commits,1);
 assert.equal(r.caseAcknowledged,true);assert.equal(r.takeoverAuthorized,false);
 assert.equal(r.replyAuthorized,false);assert.equal(r.providerMessagesSent,0);
});
test("AB4 self-review and revoked independent reviewer/staff AAL2 denied",async()=>{
 for(const patch of [
  {reviewer:{...reviewer,userId:staff.userId}},
  {reviewer:{...reviewer,currentAal:"aal1"}},
  {staff:{...staff,currentAal:"aal1"}},
  {staff:{...staff,verifiedDepartments:["vendor_success"]}},
  {caseSnapshot:{...caseSnapshot,state:"HUMAN"}},
  {caseSnapshot:{...caseSnapshot,signedPauseAckVerified:false}},
  {consent:{...consent,status:"REVOKED"}},
  {environment:"production"}
 ]){
  const f=make(),r=await acknowledge({...f.args,...patch});
  assert.equal(r.ok,false);assert.equal(f.commits,0);
 }
});
test("AB4 lost actual Core reviewer, object grant or current consent blocks ACK",async()=>{
 for(const key of ["verifyCurrentStaffGrant","verifyCurrentIndependentReviewer",
  "verifyCurrentConsent","verifyPersistedSignedPauseEvidence"]){
  const f=make(),r=await acknowledge({...f.args,[key]:async()=>false});
  assert.equal(r.ok,false);assert.equal(f.commits,0);
 }
});
test("AB4 forged DB transaction receipt cannot create external reply authority",async()=>{
 for(const field of ["coreGrantRecheckedInTransaction",
  "consentRecheckedInTransaction",
  "independentReviewerRecheckedInTransaction",
  "signedPauseEvidenceRecheckedInTransaction",
  "jtiConsumedInTransaction","takeoverExecuted","replyAuthorized",
  "providerMessagesSent"]){
  const f=make(),old=f.args.commitInternalCaseAck;
  const broken=["takeoverExecuted","replyAuthorized"].includes(field)?true:
   field==="providerMessagesSent"?1:false;
  const r=await acknowledge({...f.args,
   commitInternalCaseAck:async x=>({...await old(x),[field]:broken})});
  assert.equal(r.ok,false,field);
 }
});
test("AB4 20 concurrent requests and synthetic one-use nonce allow one ACK",async()=>{
 const seen=new Set();
 const f=make(),original=f.args.commitInternalCaseAck;
 const results=await Promise.all(Array.from({length:20},()=>acknowledge({
  ...f.args,commitInternalCaseAck:async arg=>{
   if(seen.has(arg.jti))throw Error("REPLAY_DENIED");
   seen.add(arg.jti);return original(arg);
  }
 })));
 assert.equal(results.filter(x=>x.ok).length,1);
 assert.ok(results.every(x=>x.replyAuthorized===false));
});
