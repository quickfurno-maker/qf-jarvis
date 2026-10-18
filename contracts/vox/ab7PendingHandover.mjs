/**
 * AB7C durable one-use handover proof for already verified Core/Jarvis
 * signatures, consent, independent TL, and Core object grants.
 * Never creates actual client replies, ownership transfer or provider sends.
 */
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const deny=reason=>Object.freeze({ok:false,reason,caseCommitted:false,
 takeoverAuthorized:false,replyAuthorized:false,providerMessagesSent:0});
export async function persistAb7SignedPendingHandover({
 environment="off",caseId,staffId,reviewerId,conversationId,jti,
 pauseRevision,consentRevision,proof,verifyCurrentAal2Staff,
 verifyCurrentIndependentAal2Tl,verifyCurrentConsent,
 verifyCurrentCoreObjectGrant,appendDurablePendingCase
}={}){
 if(environment!=="staging"||
  ![caseId,staffId,reviewerId,conversationId,jti]
   .every(x=>typeof x==="string"&&UUID.test(x))||
  staffId===reviewerId||
  !Number.isSafeInteger(pauseRevision)||pauseRevision<1||
  !Number.isSafeInteger(consentRevision)||consentRevision<1||
  !proof||proof.coreEd25519SignatureVerified!==true||
  proof.jarvisEd25519SignatureVerified!==true||
  proof.boundConversationId!==conversationId||
  proof.boundJti!==jti||
  proof.signedPauseOnly===false||
  typeof verifyCurrentAal2Staff!=="function"||
  typeof verifyCurrentIndependentAal2Tl!=="function"||
  typeof verifyCurrentConsent!=="function"||
  typeof verifyCurrentCoreObjectGrant!=="function"||
  typeof appendDurablePendingCase!=="function")
  return deny("CURRENT_DUAL_SIGNED_HUMAN_PROOF_REQUIRED");
 try{
  if(await verifyCurrentAal2Staff({staffId,conversationId})!==true||
   await verifyCurrentIndependentAal2Tl({reviewerId,staffId})!==true||
   await verifyCurrentConsent({conversationId,consentRevision})!==true||
   await verifyCurrentCoreObjectGrant({staffId,conversationId})!==true)
   return deny("STAFF_TL_CONSENT_OR_OBJECT_GRANT_REVOKED");
  const row=await appendDurablePendingCase({
   caseId,staffId,reviewerId,conversationId,jti,
   pauseRevision,consentRevision,
   requireSourceSignatureDbRecheck:true,
   requireConsentDbRecheck:true,
   requireIndependentReviewerDbRecheck:true,
   requireOneUseJti:true,state:"PENDING_HUMAN_ACCEPTANCE"
  });
  if(!row||row.persisted!==true||row.caseId!==caseId||
   row.conversationId!==conversationId||row.jti!==jti||
   row.state!=="PENDING_HUMAN_ACCEPTANCE"||
   row.consentRecheckedInTransaction!==true||
   row.tlRecheckedInTransaction!==true||
   row.coreGrantRecheckedInTransaction!==true||
   row.signaturesRecheckedInTransaction!==true||
   row.nonceConsumedInTransaction!==true||
   row.takeoverExecuted!==false||row.providerMessagesSent!==0)
   return deny("DURABLE_PENDING_PROOF_NOT_ATTESTED");
  return Object.freeze({ok:true,caseId,caseCommitted:true,
   state:"PENDING_HUMAN_ACCEPTANCE",
   takeoverAuthorized:false,replyAuthorized:false,
   providerMessagesSent:0,needsHumanAcceptance:true});
 }catch{return deny("HANDOVER_TRANSACTION_UNAVAILABLE_OR_REPLAY");}
}
