/**
 * F1 Core->Jarvis signed, durable Riya pause transition boundary.
 * No HTTP route or live DB is installed by this contract. The production
 * adapter MUST make expected revision, consent, object grant and one-use
 * request nonce atomic with the durable AI pause update.
 */
import {sign,verify,createPublicKey,createPrivateKey} from "node:crypto";
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const fields=(x,keys)=>x&&typeof x==="object"&&!Array.isArray(x)&&
 Object.keys(x).sort().join("|")===keys.slice().sort().join("|");
const denial=reason=>Object.freeze({ok:false,reason,paused:false,
 takeoverExecuted:false,replyAuthorized:false,providerMessagesSent:0});
const REQUEST=["schema","conversationId","clientId","projectId","staffId",
 "revision","jti","issuedAtMs","expiresAtMs","consentRevision"];
export function riyaPauseCanonicalBody(request){
 if(!fields(request,REQUEST))throw Error("INVALID_CORE_PAUSE_REQUEST");
 return JSON.stringify(REQUEST.map(k=>[k,request[k]]));
}
export async function processSignedRiyaPause({
 request,coreSignature,corePublicKeyPem,jarvisPrivateKeyPem,
 verifyCurrentCoreGrant,verifyCurrentClientConsent,pauseTransaction,
 now=Date.now()
}={}){
 if(!fields(request,REQUEST)||request.schema!=="qf.vox.riya.pause.command.v1"||
  ![request.conversationId,request.clientId,request.projectId,
    request.staffId,request.jti].every(x=>typeof x==="string"&&UUID.test(x))||
  !Number.isSafeInteger(request.revision)||request.revision<0||
  !Number.isSafeInteger(request.consentRevision)||request.consentRevision<1||
  !Number.isSafeInteger(request.issuedAtMs)||
  !Number.isSafeInteger(request.expiresAtMs)||!Number.isSafeInteger(now)||
  request.issuedAtMs>now+30000||request.issuedAtMs<now-30000||
  request.expiresAtMs<=now||request.expiresAtMs>now+60000||
  typeof coreSignature!=="string"||!/^[A-Za-z0-9_-]{80,140}$/.test(coreSignature)||
  typeof corePublicKeyPem!=="string"||
  typeof jarvisPrivateKeyPem!=="string"||
  typeof verifyCurrentCoreGrant!=="function"||
  typeof verifyCurrentClientConsent!=="function"||
  typeof pauseTransaction!=="function")
  return denial("STRICT_SIGNED_CORE_PAUSE_REQUIRED");
 try{
  const bytes=Buffer.from(coreSignature,"base64url");
  if(bytes.length!==64||!verify(null,
    Buffer.from(riyaPauseCanonicalBody(request)),createPublicKey(corePublicKeyPem),bytes))
    return denial("CORE_SIGNATURE_INVALID");
 }catch{return denial("CORE_SIGNATURE_INVALID");}
 try{
  const grant=await verifyCurrentCoreGrant(request);
  if(grant!==true)return denial("CURRENT_CORE_GRANT_REVOKED");
  const consent=await verifyCurrentClientConsent(request);
  if(consent!==true)return denial("CURRENT_CLIENT_CONSENT_REVOKED");
  // The caller's atomically committed database adapter is authoritative.
  // It must recheck the same grant + consent within its transaction.
  const record=await pauseTransaction({
   conversationId:request.conversationId,clientId:request.clientId,
   projectId:request.projectId,staffId:request.staffId,
   expectedRevision:request.revision,consentRevision:request.consentRevision,
   jti:request.jti
  });
  if(!fields(record,["conversationId","clientId","projectId","pauseRevision",
    "ackNonce","pausedAtMs","durablyCommitted","replayConsumed",
    "grantsCheckedInTransaction","consentCheckedInTransaction"])||
   record.conversationId!==request.conversationId||
   record.clientId!==request.clientId||record.projectId!==request.projectId||
   record.pauseRevision!==request.revision+1||
   typeof record.ackNonce!=="string"||!UUID.test(record.ackNonce)||
   !Number.isSafeInteger(record.pausedAtMs)||
   record.pausedAtMs<now-30000||record.pausedAtMs>now+30000||
   record.durablyCommitted!==true||record.replayConsumed!==true||
   record.grantsCheckedInTransaction!==true||
   record.consentCheckedInTransaction!==true)
   return denial("DURABLE_PAUSE_NOT_VERIFIED");
  const receipt=Object.freeze({
   schema:"qfj.vox.riya.pause-ack.v1",
   conversationId:request.conversationId,clientId:request.clientId,
   projectId:request.projectId,revision:request.revision,
   pauseRevision:record.pauseRevision,ackNonce:record.ackNonce,
   issuedAtMs:now,expiresAtMs:now+30000,state:"PAUSED_ACK",actor:"RIYA"
  });
  const signature=sign(null,Buffer.from(JSON.stringify(receipt)),
   createPrivateKey(jarvisPrivateKeyPem)).toString("base64url");
  return Object.freeze({ok:true,source:"SIGNED_ATOMIC_JARVIS_PAUSE",
   receipt,signature,paused:true,requiresSeparateCoreApproval:true,
   takeoverExecuted:false,replyAuthorized:false,providerMessagesSent:0});
 }catch{return denial("JARVIS_TRANSACTION_OR_SIGNER_UNAVAILABLE");}
}
