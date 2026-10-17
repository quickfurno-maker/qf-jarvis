/**
 * UI-04 T3 merged agent desk readiness. Caller must retrieve independently
 * authenticated Core observations with exact actor/subject grants.
 * NEVER blends vendor/prospect CRM identity with a Riya client project.
 */
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const id=x=>typeof x==="string"&&UUID.test(x);
const lanes={RIYA:"client",ANISHA:"vendor",AAROHI:"prospect"};
const deny=reason=>Object.freeze({ok:false,reason,agents:[],
 canReply:false,canTakeover:false,providerMessagesSent:0});
export async function projectCurrentAgentDeskReadiness({
 scope,observations,verifyCurrentCoreScope,verifyEachSubject,
 now=Date.now()
}={}){
 if(!scope||!id(scope.userId)||!id(scope.teamId)||!id(scope.cityId)||
  scope.currentAal!=="aal2"||scope.canReadContent!==true||
  scope.canMutate!==false||!Array.isArray(observations)||
  observations.length>20||typeof verifyCurrentCoreScope!=="function"||
  typeof verifyEachSubject!=="function"||!Number.isSafeInteger(now))
  return deny("CURRENT_AAL2_CORE_SCOPE_REQUIRED");
 try{
  if(await verifyCurrentCoreScope(scope)!==true)
   return deny("REVOKED_AGENT_DESK_SCOPE");
  const seen=new Set(),safe=[];
  for(const r of observations){
   if(!r||!Object.hasOwn(lanes,r.lane)||!id(r.conversationId)||
    !id(r.subjectId)||!id(r.teamId)||!id(r.cityId)||
    r.subjectKind!==lanes[r.lane]||r.teamId!==scope.teamId||
    r.cityId!==scope.cityId||seen.has(r.conversationId)||
    !Number.isSafeInteger(r.revision)||r.revision<0||
    !["AI","PAUSED","HUMAN"].includes(r.state)||
    !["ALLOWED","WITHDRAWN","UNKNOWN"].includes(r.consent)||
    typeof r.updatedAt!=="string"||
    !Number.isFinite(Date.parse(r.updatedAt))||
    Date.parse(r.updatedAt)>now+30000||
    r.humanTakeover!==(r.state==="HUMAN"))
    return deny("AGENT_LANE_BOUNDARY_UNVERIFIED");
   if(r.lane==="RIYA"&&
     (!Array.isArray(scope.verifiedDepartments)||
      !scope.verifiedDepartments.includes("client_success")))
    return deny("INDEPENDENT_CLIENT_SCOPE_REQUIRED");
   const granted=await verifyEachSubject({scope,lane:r.lane,
    subjectKind:r.subjectKind,subjectId:r.subjectId,
    conversationId:r.conversationId,revision:r.revision});
   if(granted!==true)return deny("CURRENT_SUBJECT_GRANT_DENIED");
   seen.add(r.conversationId);
   safe.push(Object.freeze({lane:r.lane,conversationId:r.conversationId,
    state:r.state,revision:r.revision,updatedAt:r.updatedAt,
    consentReadiness:r.consent==="ALLOWED"?"CURRENT_READ_VERIFIED":"NOT_SEND_ELIGIBLE",
    canReply:false,canTakeover:false,canReadTranscript:false}));
  }
  safe.sort((a,b)=>Date.parse(b.updatedAt)-Date.parse(a.updatedAt)||
   a.conversationId.localeCompare(b.conversationId));
  return Object.freeze({ok:true,
   schema:"qfj.vox.ui04.agent-desk-readiness.v1",
   mode:"METADATA_ONLY",agents:Object.freeze(safe),
   canReply:false,canTakeover:false,providerMessagesSent:0,
   requiresSeparateSignedJarvisPause:true,
   requiresCoreAtomicConsentRecheck:true,
   requiresHumanHandoverApproval:true});
 }catch{return deny("AGENT_SCOPE_SOURCE_UNAVAILABLE");}
}
