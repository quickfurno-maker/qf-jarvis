/**
 * AB-3A: real Ed25519 verification on both Core pause instruction and
 * Jarvis acknowledgement BEFORE calling the existing independent-review
 * gate. This is a candidate private composition, NOT a deployed gateway
 * route and NOT authority to send, resume or take over conversations.
 */
import {verify,createPublicKey} from "node:crypto";
import {riyaPauseCanonicalBody} from "./riyaF1SignedDurablePause.mjs";
import {prepareVerifiedHumanHandover} from "./ab2HumanHandoverGate.mjs";
const BASE=/^[A-Za-z0-9_-]{80,140}$/;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const deny=reason=>Object.freeze({ok:false,reason,
 takeoverAuthorized:false,replyAuthorized:false,providerMessagesSent:0});
const validSig=(pem,bytes,signature)=>{
 if(typeof pem!=="string"||typeof signature!=="string"||!BASE.test(signature))
  return false;
 try{
  const sig=Buffer.from(signature,"base64url");
  return sig.length===64&&verify(null,bytes,createPublicKey(pem),sig);
 }catch{return false;}
};
export async function prepareAb3SignedHumanCase({
 environment="off",staff,reviewer,command,coreSignature,ack,
 corePublicKeyPem,jarvisPublicKeyPem,consent,now=Date.now(),
 verifyCurrentCoreGrant,verifyCurrentConsent,
 verifyIndependentHumanReview,registerPendingHumanCase
}={}){
 if(environment!=="staging"||!command||!ack||!ack.receipt||
  !staff||!reviewer||!consent||
  !Number.isSafeInteger(now)||now<=0||
  command.schema!=="qf.vox.riya.pause.command.v1"||
  typeof command.jti!=="string"||!UUID.test(command.jti)||
  typeof command.staffId!=="string"||!UUID.test(command.staffId)||
  !Number.isSafeInteger(command.consentRevision)||command.consentRevision<1||
  !Number.isSafeInteger(command.revision)||command.revision<0||
  !Number.isSafeInteger(command.issuedAtMs)||
  !Number.isSafeInteger(command.expiresAtMs)||
  command.issuedAtMs>now+30000||command.issuedAtMs<now-60000||
  command.expiresAtMs<=now||command.expiresAtMs>now+60000||
  consent.revision!==command.consentRevision||
  ack.ok!==true||ack.paused!==true||
  ack.takeoverExecuted!==false||ack.replyAuthorized!==false||
  ack.providerMessagesSent!==0||
  ack.receipt.schema!=="qfj.vox.riya.pause-ack.v1"||
  ack.receipt.state!=="PAUSED_ACK"||ack.receipt.actor!=="RIYA"||
  ack.receipt.conversationId!==command.conversationId||
  ack.receipt.clientId!==command.clientId||
  ack.receipt.projectId!==command.projectId||
  ack.receipt.revision!==command.revision||
  ack.receipt.pauseRevision!==command.revision+1||
  !Number.isSafeInteger(ack.receipt.issuedAtMs)||
  !Number.isSafeInteger(ack.receipt.expiresAtMs)||
  ack.receipt.issuedAtMs>now+30000||ack.receipt.expiresAtMs<=now||
  ack.receipt.expiresAtMs>ack.receipt.issuedAtMs+30000)
  return deny("CURRENT_MATCHING_SIGNED_CORE_AND_JARVIS_REQUIRED");
 let coreBytes;
 try{coreBytes=Buffer.from(riyaPauseCanonicalBody(command));}
 catch{return deny("CORE_PAUSE_SCHEMA_REJECTED");}
 const receiptKeys=[
  "schema","conversationId","clientId","projectId","revision",
  "pauseRevision","ackNonce","issuedAtMs","expiresAtMs","state","actor"
 ];
 const actualKeys=Object.keys(ack.receipt).sort();
 if(actualKeys.length!==receiptKeys.length||
  actualKeys.some((k,i)=>k!==receiptKeys.slice().sort()[i])||
  typeof ack.receipt.ackNonce!=="string"||
  !UUID.test(ack.receipt.ackNonce))
  return deny("JARVIS_ACK_SHAPE_DENIED");
 if(!validSig(corePublicKeyPem,coreBytes,coreSignature)||
  !validSig(jarvisPublicKeyPem,
   Buffer.from(JSON.stringify(ack.receipt)),ack.signature))
  return deny("SENDER_SIGNATURE_INVALID");
 // Separate human reviewer must make an independent decision; no auto-accept.
 return prepareVerifiedHumanHandover({
  environment,staff,reviewer,
  pause:{conversationId:command.conversationId,projectId:command.projectId,
   jti:command.jti,staffId:command.staffId,paused:true,
   replyAuthorized:false,takeoverExecuted:false,
   pauseRevision:ack.receipt.pauseRevision},
  consent,now,
  verifySignedJarvisAck:async()=>true,
  verifyCurrentCoreGrant,verifyCurrentConsent,
  verifyIndependentHumanReview,registerPendingHumanCase
 });
}
