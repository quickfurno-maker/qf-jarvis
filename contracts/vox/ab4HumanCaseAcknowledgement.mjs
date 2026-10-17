/**
 * AB-4 internal, independently reviewed human case acknowledgement.
 * Explicitly NOT Jarvis conversation takeover and NOT provider consent.
 * The genuine Core/Jarvis signed pause evidence must already have been
 * independently proven and persisted in the Core pending handover case.
 */
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const id=x=>typeof x==="string"&&UUID.test(x);
const denied=reason=>Object.freeze({ok:false,reason,
 caseAcknowledged:false,takeoverAuthorized:false,
 replyAuthorized:false,providerMessagesSent:0});
export async function acknowledgeAb4InternalHumanCase({
 environment="off",staff,reviewer,caseSnapshot,consent,
 verifyCurrentStaffGrant,verifyCurrentIndependentReviewer,
 verifyCurrentConsent,verifyPersistedSignedPauseEvidence,
 commitInternalCaseAck,now=Date.now()
}={}){
 if(environment!=="staging"||!staff||!reviewer||
  !caseSnapshot||!consent||
  !id(staff.userId)||!id(staff.teamId)||!id(staff.cityId)||
  staff.currentAal!=="aal2"||
  !Array.isArray(staff.verifiedDepartments)||
  !staff.verifiedDepartments.includes("client_success")||
  !id(reviewer.userId)||reviewer.userId===staff.userId||
  reviewer.currentAal!=="aal2"||reviewer.role!=="team_leader"||
  reviewer.teamId!==staff.teamId||reviewer.cityId!==staff.cityId||
  !id(caseSnapshot.caseId)||!id(caseSnapshot.conversationId)||
  !id(caseSnapshot.projectId)||!id(caseSnapshot.jti)||
  caseSnapshot.staffId!==staff.userId||
  caseSnapshot.reviewerId!==reviewer.userId||
  caseSnapshot.state!=="PENDING_HUMAN_ACCEPTANCE"||
  caseSnapshot.signedPauseAckVerified!==true||
  !Number.isSafeInteger(caseSnapshot.pauseRevision)||
  caseSnapshot.pauseRevision<1||
  !Number.isSafeInteger(caseSnapshot.consentRevision)||
  caseSnapshot.consentRevision<0||
  !Number.isSafeInteger(caseSnapshot.expectedCaseRevision)||
  caseSnapshot.expectedCaseRevision<0||
  consent.conversationId!==caseSnapshot.conversationId||
  consent.revision!==caseSnapshot.consentRevision||
  consent.status!=="ALLOWED"||consent.outboundApproved!==false||
  !Number.isSafeInteger(now)||now<=0||
  typeof verifyCurrentStaffGrant!=="function"||
  typeof verifyCurrentIndependentReviewer!=="function"||
  typeof verifyCurrentConsent!=="function"||
  typeof verifyPersistedSignedPauseEvidence!=="function"||
  typeof commitInternalCaseAck!=="function")
  return denied("CURRENT_PENDING_SIGNED_CASE_AND_INDEPENDENT_TL_REQUIRED");
 try{
  if(await verifyPersistedSignedPauseEvidence({staff,caseSnapshot})!==true||
   await verifyCurrentStaffGrant({staff,caseSnapshot})!==true||
   await verifyCurrentIndependentReviewer({reviewer,staff,caseSnapshot})!==true||
   await verifyCurrentConsent({consent,caseSnapshot})!==true)
   return denied("CURRENT_PENDING_CASE_OR_REVIEWER_REVOKED");
  const receipt=await commitInternalCaseAck({
   caseId:caseSnapshot.caseId,conversationId:caseSnapshot.conversationId,
   projectId:caseSnapshot.projectId,
   staffId:staff.userId,reviewerId:reviewer.userId,
   jti:caseSnapshot.jti,
   expectedCaseRevision:caseSnapshot.expectedCaseRevision,
   expectedPauseRevision:caseSnapshot.pauseRevision,
   expectedConsentRevision:consent.revision,
   requireIndependentReviewerDbRecheck:true,
   requireCoreObjectGrantDbRecheck:true,
   requireConsentDbRecheck:true,
   requireOneUseJti:true
  });
  if(!receipt||receipt.caseId!==caseSnapshot.caseId||
   receipt.conversationId!==caseSnapshot.conversationId||
   receipt.staffId!==staff.userId||
   receipt.reviewerId!==reviewer.userId||
   receipt.state!=="INTERNAL_HANDOVER_ACKNOWLEDGED"||
   receipt.caseRevision!==caseSnapshot.expectedCaseRevision+1||
   receipt.coreGrantRecheckedInTransaction!==true||
   receipt.consentRecheckedInTransaction!==true||
   receipt.independentReviewerRecheckedInTransaction!==true||
   receipt.signedPauseEvidenceRecheckedInTransaction!==true||
   receipt.jtiConsumedInTransaction!==true||
   receipt.providerMessagesSent!==0||
   receipt.takeoverExecuted!==false||
   receipt.replyAuthorized!==false)
   return denied("ATOMIC_INTERNAL_ACK_UNVERIFIED");
  return Object.freeze({ok:true,
   schema:"qfj.vox.ab4.internal-human-ack.v1",
   caseId:receipt.caseId,state:"INTERNAL_HANDOVER_ACKNOWLEDGED",
   caseAcknowledged:true,takeoverAuthorized:false,
   replyAuthorized:false,providerMessagesSent:0,
   releaseCertified:false});
 }catch{return denied("CORE_INTERNAL_ACK_TRANSACTION_UNAVAILABLE");}
}
