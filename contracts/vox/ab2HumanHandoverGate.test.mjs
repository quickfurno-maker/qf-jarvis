import test from "node:test";
import assert from "node:assert/strict";
import {prepareVerifiedHumanHandover as prepare}
 from "./ab2HumanHandoverGate.mjs";
const id=n=>"00000000-0000-4000-8000-"+String(n).padStart(12,"0");
const staff={userId:id(1),teamId:id(2),cityId:id(3),currentAal:"aal2",
 verifiedDepartments:["client_success"]};
const reviewer={userId:id(4),teamId:id(2),cityId:id(3),
 currentAal:"aal2",role:"team_leader"};
const pause={conversationId:id(5),projectId:id(6),jti:id(7),
 staffId:staff.userId,paused:true,replyAuthorized:false,
 takeoverExecuted:false,pauseRevision:8};
const consent={conversationId:pause.conversationId,
 revision:2,status:"ALLOWED",outboundApproved:false};
function setup(){
 let writes=0;
 const args={environment:"staging",staff,reviewer,pause,consent,
  verifyCurrentCoreGrant:async()=>true,
  verifyCurrentConsent:async()=>true,
  verifySignedJarvisAck:async()=>true,
  verifyIndependentHumanReview:async()=>true,
  registerPendingHumanCase:async x=>{writes++;return {
   persisted:true,state:"PENDING_HUMAN_ACCEPTANCE",
   conversationId:x.conversationId,jti:x.jti,
   coreGrantRecheckedInTransaction:true,
   consentRecheckedInTransaction:true,
   independentReviewRecheckedInTransaction:true,
   nonceConsumedInTransaction:true,takeoverExecuted:false,
   providerMessagesSent:0};}};
 return {args,get writes(){return writes}};
}
test("AB2 signed Riya pause becomes pending human acceptance, never takeover",async()=>{
 const x=setup(),r=await prepare(x.args);
 assert.equal(r.ok,true);assert.equal(r.takeoverAuthorized,false);
 assert.equal(r.replyAuthorized,false);assert.equal(x.writes,1);
 assert.equal(r.providerMessagesSent,0);
});
test("AB2 no independent reviewer, revoked consent, incorrect permissions denied",async()=>{
 for(const patch of [
  {reviewer:{...reviewer,userId:staff.userId}},
  {reviewer:{...reviewer,currentAal:"aal1"}},
  {staff:{...staff,verifiedDepartments:["vendor_success"]}},
  {staff:{...staff,currentAal:"aal1"}},
  {pause:{...pause,takeoverExecuted:true}},
  {pause:{...pause,replyAuthorized:true}},
  {consent:{...consent,status:"WITHDRAWN"}},
  {consent:{...consent,outboundApproved:true}},
  {environment:"production"}
 ]){
  const x=setup(),r=await prepare({...x.args,...patch});
  assert.equal(r.ok,false);assert.equal(x.writes,0);
 }
});
test("AB2 signed ack and current Core consent rechecked before creating case",async()=>{
 for(const key of ["verifyCurrentCoreGrant","verifyCurrentConsent",
  "verifySignedJarvisAck","verifyIndependentHumanReview"]){
  const x=setup(),r=await prepare({...x.args,[key]:async()=>false});
  assert.equal(r.ok,false);assert.equal(x.writes,0);
 }
});
test("AB2 forged atomic receipt cannot authorize provider replies",async()=>{
 for(const property of ["coreGrantRecheckedInTransaction",
  "consentRecheckedInTransaction","nonceConsumedInTransaction",
  "takeoverExecuted","providerMessagesSent"]){
  const x=setup(),orig=x.args.registerPendingHumanCase;
  const r=await prepare({...x.args,registerPendingHumanCase:async y=>({
   ...await orig(y),
   [property]:["takeoverExecuted","providerMessagesSent"].includes(property) ?
    (property==="providerMessagesSent"?1:true):false})});
  assert.equal(r.ok,false);
 }
});
