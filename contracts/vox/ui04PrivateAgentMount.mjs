/**
 * UI-04 T3 candidate integration mount for the existing Jarvis gateway.
 * This module DOES NOT register a public route or deploy any service. The
 * caller must inject a private-only server route registrar and existing QFJ
 * m2m verifier; no WhatsApp or conversation messages are sent.
 */
import {createF1RiyaPauseHttpHandler,F1_RIYA_PAUSE_PATH}
 from "./riyaF1PauseHttpHandler.mjs";
const expectedGates=["consentRead","coreTransport","privateRiyaPause"];
const exact=(v,k)=>v!==null&&typeof v==="object"&&!Array.isArray(v)&&
 Object.keys(v).sort().join("|")===k.slice().sort().join("|");
const reject=reason=>Object.freeze({ok:false,reason,routesRegistered:0,
 externalMessagesSent:0,productionCertified:false});

export async function preparePrivateAgentPauseRoute({
 environment="off",featureGates,registerPrivatePost,verifyPrivateGatewayRequest,
 handlerDependencies
}={}){
 if(environment!=="staging"||!exact(featureGates,expectedGates)||
  expectedGates.some(k=>featureGates[k]!=="staging"))
  return reject("PRIVATE_STAGE_FEATURES_NOT_ENABLED");
 if(typeof registerPrivatePost!=="function"||
  typeof verifyPrivateGatewayRequest!=="function"||
  !handlerDependencies||typeof handlerDependencies!=="object"||
  ![
   "verifyQfjSignedRequest","verifyCurrentCoreGrant",
   "verifyCurrentClientConsent","pauseTransaction"
  ].every(k=>typeof handlerDependencies[k]==="function")||
  typeof handlerDependencies.corePublicKeyPem!=="string"||
  typeof handlerDependencies.jarvisPrivateKeyPem!=="string")
  return reject("EXISTING_CORE_JARVIS_TRUST_REQUIRED");
 const handle=createF1RiyaPauseHttpHandler({
  environment:"staging",...handlerDependencies
 });
 const privateOnly=async(req,res)=>{
  let verified;
  try{verified=await verifyPrivateGatewayRequest({
    method:req.method,url:req.url,headers:req.headers
  });}catch{verified=false;}
  if(verified!==true){
   res.writeHead(403,{"content-type":"application/json",
    "cache-control":"private, no-store, max-age=0"});
   return res.end(JSON.stringify({error:"private_gateway_required"}));
  }
  return handle(req,res);
 };
 try{
  const receipt=await registerPrivatePost({
   method:"POST",path:F1_RIYA_PAUSE_PATH,handler:privateOnly,
   privateIngressOnly:true,exposeViaPublicTraefik:false
  });
  if(!exact(receipt,["path","method","registered","privateIngressOnly",
   "publicIngressEnabled"])||
   receipt.path!==F1_RIYA_PAUSE_PATH||receipt.method!=="POST"||
   receipt.registered!==true||receipt.privateIngressOnly!==true||
   receipt.publicIngressEnabled!==false)
   return reject("PRIVATE_ROUTE_REGISTRATION_UNVERIFIED");
  return Object.freeze({ok:true,reason:"PRIVATE_ROUTE_CANDIDATE_READY",
   route:F1_RIYA_PAUSE_PATH,routesRegistered:1,
   externalMessagesSent:0,productionCertified:false,
   coreSignedPauseStillRequired:true,
   staffTakeoverApproved:false});
 }catch{return reject("PRIVATE_ROUTE_REGISTRATION_FAILED");}
}
