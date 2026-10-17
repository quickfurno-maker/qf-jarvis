/**
 * AB-2: approval handoff boundary between Jarvis signed AI pause ACK and
 * a separate governed human takeover. A pause ACK is NOT approval.
 * This contract has no provider transport and cannot send any messages.
 */
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const id=x=>typeof x==="string"&&UUID.test(x);
const fail=reason=>Object.freeze({ok:false,reason,
 takeoverAuthorized:false,replyAuthorized:false,
 providerMessagesSent:0});
export async function prepareVerifiedHumanHandover({
 environment="off",staff,reviewer,pause,consent,verifyCurrentCoreGrant,
 verifyCurrentConsent,verifySignedJarvisAck,
 verifyIndependentHumanReview,registerPendingHumanCase,now=Date.now()
}={}){
 if(environment!=="staging"||!staff||!reviewer||!pause||!consent||
  !id(staff.userId)||!id(staff.teamId)||!id(staff.cityId)||
  staff.currentAal!=="aal2"||
  !Array.isArray(staff.verifiedDepartments)||
  !staff.verifiedDepartments.includes("client_success")||
  !id(reviewer.userId)||reviewer.userId===staff.userId||
  reviewer.currentAal!=="aal2"||reviewer.role!=="team_leader"||
  reviewer.teamId!==staff.teamId||reviewer.cityId!==staff.cityId||
  !id(pause.conversationId)||!id(pause.projectId)||
  !id(pause.jti)||!id(pause.staffId)||
  pause.staffId!==staff.userId||
  pause.paused!==true||pause.replyAuthorized!==false||
  pause.takeoverExecuted!==false||
  !Number.isSafeInteger(pause.pauseRevision)||pause.pauseRevision<1||
  !Number.isSafeInteger(consent.revision)||consent.revision<0||
  consent.conversationId!==pause.conversationId||
  consent.status!=="ALLOWED"||consent.outboundApproved!==false||
  !Number.isSafeInteger(now)||now<=0||
  typeof verifyCurrentCoreGrant!=="function"||
  typeof verifyCurrentConsent!=="function"||
  typeof verifySignedJarvisAck!=="function"||
  typeof verifyIndependentHumanReview!=="function"||
  typeof registerPendingHumanCase!=="function")
  return fail("SIGNED_PAUSE_AND_INDEPENDENT_REVIEW_REQUIRED");
 try{
  if(await verifySignedJarvisAck({pause,staff})!==true||
   await verifyCurrentCoreGrant({staff,pause})!==true||
   await verifyCurrentConsent({consent,staff,pause})!==true||
   await verifyIndependentHumanReview({reviewer,staff,pause})!==true)
   return fail("REVOKED_CONSENT_OR_UNVERIFIED_INDEPENDENT_REVIEW");
  const result=await registerPendingHumanCase({
   staffId:staff.userId,reviewerId:reviewer.userId,
   conversationId:pause.conversationId,projectId:pause.projectId,
   jti:pause.jti,expectedPauseRevision:pause.pauseRevision,
   expectedConsentRevision:consent.revision,
   requiresAtomicRecheck:true,requiresOneUseJti:true
  });
  if(!result||result.persisted!==true||
   result.state!=="PENDING_HUMAN_ACCEPTANCE"||
   result.conversationId!==pause.conversationId||
   result.jti!==pause.jti||
   result.coreGrantRecheckedInTransaction!==true||
   result.consentRecheckedInTransaction!==true||
   result.independentReviewRecheckedInTransaction!==true||
   result.nonceConsumedInTransaction!==true||
   result.takeoverExecuted!==false||
   result.providerMessagesSent!==0)
   return fail("PENDING_HUMAN_RECEIPT_UNVERIFIED");
  return Object.freeze({ok:true,
   state:"PENDING_HUMAN_ACCEPTANCE",
   takeoverAuthorized:false,replyAuthorized:false,
   providerMessagesSent:0,releaseCertified:false});
 }catch{return fail("HUMAN_HANDOVER_STORE_UNAVAILABLE");}
}
