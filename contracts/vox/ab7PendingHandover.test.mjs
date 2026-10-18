import test from "node:test";import assert from "node:assert/strict";
import {persistAb7SignedPendingHandover as persist} from "./ab7PendingHandover.mjs";
const id=n=>"00000000-0000-4000-8000-"+String(n).padStart(12,"0");
const base=()=>({environment:"staging",caseId:id(1),staffId:id(2),
 reviewerId:id(3),conversationId:id(4),jti:id(5),
 pauseRevision:1,consentRevision:2,
 proof:{coreEd25519SignatureVerified:true,jarvisEd25519SignatureVerified:true,
  boundConversationId:id(4),boundJti:id(5),signedPauseOnly:true},
 verifyCurrentAal2Staff:async()=>true,
 verifyCurrentIndependentAal2Tl:async()=>true,
 verifyCurrentConsent:async()=>true,verifyCurrentCoreObjectGrant:async()=>true,
 appendDurablePendingCase:async x=>({persisted:true,caseId:x.caseId,
  conversationId:x.conversationId,jti:x.jti,state:x.state,
  consentRecheckedInTransaction:true,tlRecheckedInTransaction:true,
  coreGrantRecheckedInTransaction:true,signaturesRecheckedInTransaction:true,
  nonceConsumedInTransaction:true,takeoverExecuted:false,providerMessagesSent:0})});
test("AB7C verified two-signer pending-only persistent handover",async()=>{
 const r=await persist(base());assert.equal(r.ok,true);
 assert.equal(r.takeoverAuthorized,false);assert.equal(r.caseCommitted,true);
});
test("AB7C missing/tampered signatures and self reviewer deny",async()=>{
 for(const patch of [
  {proof:{...base().proof,jarvisEd25519SignatureVerified:false}},
  {proof:{...base().proof,boundJti:id(99)}},
  {reviewerId:id(2)}, {environment:"production"},
  {pauseRevision:-1},{consentRevision:0}
 ]){const r=await persist({...base(),...patch});assert.equal(r.ok,false);}
});
test("AB7C missing current consent, grants, TL and AAL2 all deny",async()=>{
 for(const key of ["verifyCurrentAal2Staff","verifyCurrentIndependentAal2Tl",
  "verifyCurrentConsent","verifyCurrentCoreObjectGrant"]){
  assert.equal((await persist({...base(),[key]:async()=>false})).ok,false);
 }
});
test("AB7C forged persistent receipt cannot authorize a reply",async()=>{
 for(const patch of [
  {nonceConsumedInTransaction:false},{tlRecheckedInTransaction:false},
  {signaturesRecheckedInTransaction:false},
  {providerMessagesSent:1},{takeoverExecuted:true}
 ]){
  const x=base(),old=x.appendDurablePendingCase;
  assert.equal((await persist({...x,
   appendDurablePendingCase:async a=>({...await old(a),...patch})})).ok,false);
 }
});
test("AB7C 32-way synthetic durable JTI collision accepts exactly once",async()=>{
 const used=new Set(),x=base();
 const rows=await Promise.all(Array.from({length:32},()=>persist({
  ...x,appendDurablePendingCase:async a=>{
   if(used.has(a.jti))throw Error("DUPLICATE_JTI");
   used.add(a.jti);return x.appendDurablePendingCase(a);
  }
 })));
 assert.equal(rows.filter(v=>v.ok).length,1);
 assert.ok(rows.every(v=>v.providerMessagesSent===0));
});
