// Prepared Core takeover receipt; does not itself pause Jarvis or authorize replies.
// Trusted signature, durable-state, current grant and one-use replay verification
// must come from separately reviewed authenticated transport/SQL adapters.
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const isId=s=>typeof s==="string"&&UUID.test(s);
const fields=(o,keys)=>o&&typeof o==="object"&&!Array.isArray(o)&&
 Object.keys(o).sort().join("|")===keys.slice().sort().join("|");
const denied=reason=>Object.freeze({ok:false,reason,pauseAckVerified:false,
 takeoverExecuted:false,replyAuthorized:false,providerMessagesSent:0});
export async function inspectSignedRiyaPauseAck({request,receipt,
 verifyJarvisSignature,checkDurableJarvisPause,consumeReplayNonce,
 confirmFreshCoreGrant,confirmFreshClientConsent,now=Date.now()}={}){
 const rq=["schema","conversationId","clientId","projectId","revision",
  "jti","expiresAtMs"];
 const rc=["schema","conversationId","clientId","projectId","revision",
  "pauseRevision","ackNonce","issuedAtMs","expiresAtMs","state","actor"];
 if(!fields(request,rq)||!fields(receipt,rc)||
  request.schema!=="qf.vox.riya.handover.read-request.v1"||
  receipt.schema!=="qfj.vox.riya.pause-ack.v1"||
  ![request.conversationId,request.clientId,request.projectId,
    request.jti,receipt.ackNonce].every(isId)||
  receipt.conversationId!==request.conversationId||
  receipt.clientId!==request.clientId||
  receipt.projectId!==request.projectId||
  !Number.isSafeInteger(request.revision)||request.revision<0||
  receipt.revision!==request.revision||
  receipt.pauseRevision!==request.revision+1||
  receipt.state!=="PAUSED_ACK"||receipt.actor!=="RIYA"||
  !Number.isSafeInteger(now)||now<=0||
  !Number.isSafeInteger(request.expiresAtMs)||
  request.expiresAtMs<=now||request.expiresAtMs>now+120000||
  !Number.isSafeInteger(receipt.issuedAtMs)||receipt.issuedAtMs>now+30000||
  receipt.issuedAtMs<now-30000||
  !Number.isSafeInteger(receipt.expiresAtMs)||
  receipt.expiresAtMs<=now||receipt.expiresAtMs>now+60000)
  return denied("PAUSE_ACK_SUBJECT_REVISION_OR_FRESHNESS_INVALID");
 if([verifyJarvisSignature,checkDurableJarvisPause,consumeReplayNonce,
  confirmFreshCoreGrant,confirmFreshClientConsent].some(f=>typeof f!=="function"))
  return denied("TRUSTED_DURABLE_ADAPTERS_MISSING");
 try{
  // Must be ordered: verify signed evidence, check durable state, check
  // grant and consent, finally atomically consume nonce in existing Core DB.
  if((await verifyJarvisSignature(receipt,request))!==true)
   return denied("UNTRUSTED_JARVIS_SIGNATURE");
  if((await checkDurableJarvisPause(receipt))!==true)
   return denied("DURABLE_JARVIS_PAUSE_UNVERIFIED");
  if((await confirmFreshCoreGrant(request))!==true)
   return denied("CORE_SCOPE_REVOKED");
  if((await confirmFreshClientConsent(request))!==true)
   return denied("CLIENT_CONSENT_REVOKED");
  if((await consumeReplayNonce({
    jti:request.jti,ackNonce:receipt.ackNonce,revision:receipt.pauseRevision,
    conversationId:request.conversationId
  }))!==true)return denied("REPLAY_NONCE_ALREADY_USED");
 }catch{return denied("TRUSTED_ADAPTER_UNAVAILABLE");}
 return Object.freeze({ok:true,schema:"qfj.vox.riya.pause-ack.review.v1",
  conversationId:receipt.conversationId,projectId:receipt.projectId,
  pauseRevision:receipt.pauseRevision,pauseAckVerified:true,
  // Verified precondition is NOT a Core command or provider authority.
  eligibleForSeparateCoreApproval:true,takeoverExecuted:false,
  replyAuthorized:false,providerMessagesSent:0,
  requiresCurrentOwnerOrTeamApproval:true,requiresOwnerControlledStageActivation:true});
}
