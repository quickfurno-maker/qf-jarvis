// VOX-10B: Jarvis read-only human takeover observation. It DOES NOT pause
// Riya or acknowledge an action. Existing signed Core->Jarvis transport must
// verify Core identity AND canonical subject before providing readCurrentState.
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const deny=error=>Object.freeze({ok:false,error,mode:"READ_ONLY",
 stateChanged:false,providerMessagesSent:0});
export async function readRiyaHandoverObservation({
  proof,verifyCoreRequest,readCurrentState,now=Date.now()
}={}){
 if(!proof||typeof proof!=="object"||Array.isArray(proof)||
   Object.keys(proof).sort().join("|")!==
    ["schema","conversationId","clientId","projectId","revision","expiresAtMs","jti"].sort().join("|")||
   proof.schema!=="qf.vox.riya.handover.read-request.v1"||
   ![proof.conversationId,proof.clientId,proof.projectId,proof.jti].every(
    x=>typeof x==="string"&&UUID.test(x))||
   !Number.isSafeInteger(proof.revision)||proof.revision<0||
   !Number.isSafeInteger(proof.expiresAtMs)||proof.expiresAtMs<=now||
   proof.expiresAtMs>now+120000||
   typeof verifyCoreRequest!=="function"||
   typeof readCurrentState!=="function")
  return deny("CORE_SIGNED_SUBJECT_REQUIRED");
 let verified=false;
 try{verified=(await verifyCoreRequest(proof))===true;}catch{}
 if(!verified)return deny("CORE_REQUEST_SIGNATURE_OR_REPLAY_DENIED");
 let current;
 try{current=await readCurrentState({
  conversationId:proof.conversationId,clientId:proof.clientId,
  projectId:proof.projectId,revision:proof.revision});}
 catch{return deny("RIYA_CURRENT_STATE_UNAVAILABLE");}
 if(!current||typeof current!=="object"||Array.isArray(current)||
   Object.keys(current).sort().join("|")!==
   ["conversationId","clientId","projectId","revision","state","source"].sort().join("|")||
   current.source!=="JARVIS_DURABLE_RIYA_STATE"||
   current.conversationId!==proof.conversationId||
   current.clientId!==proof.clientId||
   current.projectId!==proof.projectId||
   current.revision!==proof.revision||
   !["AI","TAKEOVER_PENDING","HUMAN","CLOSED"].includes(current.state))
  return deny("RIYA_CURRENT_STATE_UNVERIFIED");
 return Object.freeze({
  schema:"qfj.vox.riya.handover.observation.v1",
  conversationId:proof.conversationId,
  clientId:proof.clientId,projectId:proof.projectId,
  revision:current.revision,state:current.state,
  providerMessagesSent:0,origin:"JARVIS_READ_ONLY",
  observedAt:new Date(now).toISOString()
 });
 // Caller signs this observation through existing Jarvis service transport.
}
