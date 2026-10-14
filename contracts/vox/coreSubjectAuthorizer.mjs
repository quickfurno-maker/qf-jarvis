// Trusted Jarvis SERVER ONLY -> QuickFurno Core subject-authorization contract.
// Never send service-role keys, raw transcripts, phone data or memory to Core.
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const BEARER=/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
const SCHEMA="qf.vox.agent.subject.access.v1";
const ACCEPTED=new Set(["ok","schema","allowed","agent","subjectType","subjectId",
 "revision","staffUserId","aal2Verified","objectScopeActive","cityScopeActive",
 "humanTakeoverAllowed","permissions"]);
export function createVoxCoreSubjectAuthorizer({
 coreOrigin,fetchImpl=globalThis.fetch,timeoutMs=2500
}){
 let parsed;
 try{parsed=new URL(coreOrigin);}catch{throw Error("CORE_ORIGIN_REQUIRED");}
 if(parsed.protocol!=="https:"||parsed.hostname!=="staging-core.quickfurno.in"||
   parsed.port!==""||parsed.pathname!=="/"||parsed.search||parsed.hash||
   parsed.username||parsed.password)throw Error("CORE_ORIGIN_NOT_ALLOWED");
 if(typeof fetchImpl!=="function"||!Number.isInteger(timeoutMs)||
    timeoutMs<500||timeoutMs>5000)throw Error("CORE_TRANSPORT_INVALID");
 return async function authorizeCoreSubject({
  requesterBearer,agent,channel,subjectType,subjectId,revision
 }){
  if(typeof requesterBearer!=="string"||requesterBearer.length<100||
   requesterBearer.length>8192||!BEARER.test(requesterBearer)||
   !UUID.test(subjectId??"")||!Number.isSafeInteger(revision)||
   revision<0||revision>2147483647||
   !((agent==="AAROHI"&&channel==="ACQUISITION"&&subjectType==="prospect")||
     (agent==="ANISHA"&&channel==="VENDOR_SERVICE"&&subjectType==="vendor")))
    throw Error("CORE_SUBJECT_REQUEST_INVALID");
  let response;
  try{
   response=await fetchImpl("https://staging-core.quickfurno.in/api/vox/v1/agent-subject-access",{
    method:"POST",headers:{"authorization":"Bearer "+requesterBearer,
      "content-type":"application/json","accept":"application/json"},
    body:JSON.stringify({agent,subjectType,subjectId,revision}),
    cache:"no-store",redirect:"error",signal:AbortSignal.timeout(timeoutMs)});
  }catch{throw Error("CORE_SUBJECT_UNAVAILABLE");}
  if(response?.ok!==true||response.status!==200||
   !response.headers?.get("content-type")?.startsWith("application/json"))
   throw Error("CORE_SUBJECT_DENIED_OR_INVALID");
  let data;
  try{data=await response.json();}catch{throw Error("CORE_SUBJECT_INVALID_JSON");}
  if(!data||typeof data!=="object"||Array.isArray(data)||
   Object.keys(data).some(k=>!ACCEPTED.has(k))||
   data.ok!==true||data.schema!==SCHEMA||data.allowed!==true||
   data.agent!==agent||data.subjectType!==subjectType||
   data.subjectId!==subjectId||data.revision!==revision||
   typeof data.staffUserId!=="string"||!UUID.test(data.staffUserId)||
   data.aal2Verified!==true||data.objectScopeActive!==true||
   data.cityScopeActive!==true||data.humanTakeoverAllowed!==true||
   !Array.isArray(data.permissions)||data.permissions.length!==1||
   data.permissions[0]!=="READ_ONLY")
    throw Error("CORE_SUBJECT_RESPONSE_DENIED");
  // Return only the exact internally required proof to Jarvis verifier.
  return Object.freeze({allowed:true,agent,subjectType,subjectId,
   staffUserId:data.staffUserId,aal2Verified:true,objectScopeActive:true,
   cityScopeActive:true,humanTakeoverAllowed:true});
 };
}
