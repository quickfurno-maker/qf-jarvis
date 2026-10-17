/**
 * Private pause HTTP handler for integration into the existing Jarvis gateway.
 * NOT registered/deployed here; requires the existing QFJ service signature,
 * live Core grants, consent and a transactionally durable Jarvis adapter.
 */
import {processSignedRiyaPause} from "./riyaF1SignedDurablePause.mjs";
const PATH="/internal/vox/v1/riya/pause";
const json=(res,status,body)=>{
 res.writeHead(status,{"content-type":"application/json",
  "cache-control":"private, no-store, max-age=0",
  "x-content-type-options":"nosniff"});
 res.end(JSON.stringify(body));
};
export function createF1RiyaPauseHttpHandler({
 environment="off",verifyQfjSignedRequest,
 corePublicKeyPem,jarvisPrivateKeyPem,
 verifyCurrentCoreGrant,verifyCurrentClientConsent,pauseTransaction,
 now=Date.now
}={}){
 return async function handle(req,res){
  if(environment!=="staging")return json(res,503,{error:"riya_pause_disabled"});
  let url;
  try{url=new URL(req.url??"", "https://jarvis.invalid");}
  catch{return json(res,400,{error:"invalid_request"});}
  if(url.pathname!==PATH)return json(res,404,{error:"not_found"});
  if(req.method!=="POST")return json(res,405,{error:"method_not_allowed"});
  if(url.search||url.hash||!req.headers["content-type"]?.startsWith("application/json"))
   return json(res,400,{error:"invalid_request"});
  if(typeof verifyQfjSignedRequest!=="function"||
   typeof verifyCurrentCoreGrant!=="function"||
   typeof verifyCurrentClientConsent!=="function"||
   typeof pauseTransaction!=="function")
   return json(res,503,{error:"pause_trusted_backend_unavailable"});
  try{
   const chunks=[];let size=0;
   for await(const chunk of req){
    size+=chunk.length;
    if(size>2048)return json(res,413,{error:"request_too_large"});
    chunks.push(chunk);
   }
   if(size<10)return json(res,400,{error:"invalid_request"});
   const raw=Buffer.concat(chunks);
   // Only the existing QFJ Ed25519 machine identity/actor is accepted.
   const m2m=await verifyQfjSignedRequest({
    method:"POST",path:PATH,headers:req.headers,rawBody:raw,nowMs:now()
   });
   if(!m2m||m2m.ok!==true||m2m.actor!=="quickfurno-core")
    return json(res,403,{error:"unauthorized_core_transport"});
   let decoded;
   try{decoded=JSON.parse(raw.toString("utf8"));}
   catch{return json(res,400,{error:"invalid_request"});}
   if(!decoded||typeof decoded!=="object"||Array.isArray(decoded)||
    Object.keys(decoded).sort().join("|")!=="request|signature")
    return json(res,400,{error:"invalid_request"});
   const result=await processSignedRiyaPause({
    request:decoded.request,coreSignature:decoded.signature,
    corePublicKeyPem,jarvisPrivateKeyPem,verifyCurrentCoreGrant,
    verifyCurrentClientConsent,pauseTransaction,now:now()
   });
   if(!result.ok)return json(res,409,{error:"pause_denied_or_stale"});
   return json(res,202,result);
  }catch{return json(res,503,{error:"pause_source_unavailable"});}
 };
}
export const F1_RIYA_PAUSE_PATH=PATH;
