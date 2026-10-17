// L9: current cross-system read-only evidence reconciliation.
// This is NOT Jarvis pause ACK, executable takeover, WhatsApp consent to send,
// or provider delivery permission. Existing signed transports supply verifiers.
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const validId=v=>typeof v==="string"&&UUID.test(v);
const keys=(v,n)=>v&&typeof v==="object"&&!Array.isArray(v)&&
 Object.keys(v).sort().join("|")===n.sort().join("|");
const deny=reason=>Object.freeze({ok:false,reason,mode:"READ_ONLY",
  sourceStateReconciled:false,pauseAckVerified:false,
  takeoverAuthorized:false,replyAuthorized:false,providerMessagesSent:0});
export async function reconcileRiyaHandoverEvidence({
  coreRequest,jarvisObservation,consent,verifyCoreRequest,
  verifyJarvisObservation,verifyCurrentConsent,verifyCurrentObjectGrant,
  now=Date.now()
}={}){
 if(!keys(coreRequest,["schema","conversationId","clientId","projectId",
   "revision","expiresAtMs","jti"])||
   coreRequest.schema!=="qf.vox.riya.handover.read-request.v1"||
   ![coreRequest.conversationId,coreRequest.clientId,coreRequest.projectId,
     coreRequest.jti].every(validId)||
   !Number.isSafeInteger(coreRequest.revision)||coreRequest.revision<0||
   !Number.isSafeInteger(now)||now<=0||
   !Number.isSafeInteger(coreRequest.expiresAtMs)||
   coreRequest.expiresAtMs<=now||coreRequest.expiresAtMs>now+120000)
   return deny("INVALID_CURRENT_CORE_SUBJECT_PROOF");
 if(!keys(jarvisObservation,["schema","conversationId","clientId","projectId",
   "revision","state","providerMessagesSent","origin","observedAt"])||
   jarvisObservation.schema!=="qfj.vox.riya.handover.observation.v1"||
   jarvisObservation.origin!=="JARVIS_READ_ONLY"||
   jarvisObservation.providerMessagesSent!==0||
   !["AI","TAKEOVER_PENDING","HUMAN","CLOSED"].includes(jarvisObservation.state)||
   !Number.isFinite(Date.parse(jarvisObservation.observedAt))||
   Math.abs(now-Date.parse(jarvisObservation.observedAt))>30000||
   !keys(consent,["schema","conversationId","clientId","projectId",
     "channel","state","revision","expiresAtMs"])||
   consent.schema!=="qfj.vox.current-consent.v1"||
   consent.channel!=="WHATSAPP"||consent.state!=="OPTED_IN"||
   !Number.isSafeInteger(consent.expiresAtMs)||consent.expiresAtMs<=now||
   consent.expiresAtMs>now+120000)
   return deny("CURRENT_JARVIS_STATE_OR_CONSENT_UNVERIFIED");
 for(const row of [jarvisObservation,consent]){
  if(row.conversationId!==coreRequest.conversationId||
     row.clientId!==coreRequest.clientId||
     row.projectId!==coreRequest.projectId||
     row.revision!==coreRequest.revision)
     return deny("CROSS_SYSTEM_SUBJECT_OR_REVISION_MISMATCH");
 }
 if([verifyCoreRequest,verifyJarvisObservation,verifyCurrentConsent,
     verifyCurrentObjectGrant].some(f=>typeof f!=="function"))
   return deny("CURRENT_TRUSTED_VERIFIERS_REQUIRED");
 try{
  // Each verifier must validate its existing trusted issuer, signature,
  // replay and *current* Core object/actor grant outside this function.
  const signedCore=(await verifyCoreRequest(coreRequest))===true;
  if(!signedCore)return deny("CORE_SIGNED_REQUEST_REJECTED");
  const signedJarvis=(await verifyJarvisObservation(jarvisObservation))===true;
  if(!signedJarvis)return deny("JARVIS_SIGNED_OBSERVATION_REJECTED");
  const liveGrant=(await verifyCurrentObjectGrant(coreRequest))===true;
  if(!liveGrant)return deny("CORE_OBJECT_GRANT_REVOKED");
  const freshConsent=(await verifyCurrentConsent(consent))===true;
  if(!freshConsent)return deny("CONSENT_NOT_CURRENT");
 }catch{return deny("SOURCE_UNAVAILABLE_FAIL_CLOSED");}
 return Object.freeze({ok:true,schema:"qfj.vox.riya.handover.evidence-reconciliation.v1",
  mode:"READ_ONLY",conversationId:coreRequest.conversationId,
  projectId:coreRequest.projectId,revision:coreRequest.revision,
  observedState:jarvisObservation.state,sourceStateReconciled:true,
  // A durable pause acknowledgement and Core execution approval are
  // separate missing steps; even HUMAN observation isn't an ACK.
  pauseAckVerified:false,takeoverAuthorized:false,replyAuthorized:false,
  providerMessagesSent:0,requiresSignedPauseAck:true,
  requiresCoreGovernedExecution:true});
}