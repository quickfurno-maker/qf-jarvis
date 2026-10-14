// VOX-14: Core-authorized, replay-safe READ_ONLY Jarvis advisory composition.
// No HTTP route. Caller injects a genuine Core bearer verifier; never accept a
// browser-supplied role/city/verifiedByCore flag as an authorization substitute.
import {verifyAgentView} from './agentView.mjs';
import {createDatabaseBackedVoxAgentVerifier} from './durableAgentVerifier.mjs';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function createScopedVoxAdvisoryReader({pool,secret,authorizeCoreSubject,clock=()=>Math.floor(Date.now()/1000)}){
 if(typeof authorizeCoreSubject!=='function')throw Error('CORE_AUTHORIZATION_VERIFIER_REQUIRED');
 if(typeof clock!=='function')throw Error('CLOCK_REQUIRED');
 const verifier=createDatabaseBackedVoxAgentVerifier({pool,secret,clock});
 return Object.freeze({async verifyForStaff({agentViewToken,requesterBearer}){
  if(typeof requesterBearer!=='string'||requesterBearer.length<100||requesterBearer.length>8192||
    !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(requesterBearer))
   throw Error('STAFF_AUTH_REQUIRED');
  const now=clock();
  // Validate HMAC / TTL / agent-type mapping BEFORE Core lookup or replay claim.
  const pre=verifyAgentView(agentViewToken,secret,now);
  // Core authorization is MUST be server side with current user, team, city,
  // subject assignment, AAL2, consent and revocation recheck.
  let auth;
  try{
   auth=await authorizeCoreSubject(Object.freeze({
    requesterBearer,subjectType:pre.subjectType,subjectId:pre.subjectId,
    agent:pre.agent,channel:pre.channel,revision:pre.revision}));
  }catch{throw Error('CORE_AUTHORIZATION_UNAVAILABLE');}
  if(!auth||auth.allowed!==true||auth.agent!==pre.agent||
   auth.subjectType!==pre.subjectType||auth.subjectId!==pre.subjectId||
   typeof auth.staffUserId!=='string'||!UUID.test(auth.staffUserId)||
   auth.aal2Verified!==true||auth.objectScopeActive!==true||
   auth.cityScopeActive!==true||auth.humanTakeoverAllowed!==true)
   throw Error('CORE_SUBJECT_SCOPE_DENIED');
  // Authorize first; denied users must not consume the one-time replay token.
  const safe=await verifier.verifySignedView(agentViewToken);
  if(safe.agent!==pre.agent||safe.subjectId!==pre.subjectId||
   safe.revision!==pre.revision||safe.proofConsumed!==true||
   safe.permissions?.length!==1||safe.permissions[0]!=='READ_ONLY')
   throw Error('INVALID_SCOPE_PROJECTION');
  return Object.freeze({schema:safe.schema,agent:safe.agent,channel:safe.channel,
   subjectType:safe.subjectType,subjectId:safe.subjectId,revision:safe.revision,
   memoryStatus:safe.memoryStatus,humanTakeover:safe.humanTakeover,
   lastEvent:safe.lastEvent,proofConsumed:true,permissions:Object.freeze(['READ_ONLY'])});
 }});
}
