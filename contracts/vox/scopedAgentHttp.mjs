// A validated server-owned read-only Jarvis VOX envelope, not a provider API.
const token=/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
export const VOX_AGENT_HTTP_PATH='/internal/vox/v1/agent-view';
export function normalizeVoxAgentHttpRequest(data,authorization){
 if(!data||typeof data!=='object'||Array.isArray(data)||
   Object.keys(data).length!==1||!Object.hasOwn(data,'agentViewToken')||
   typeof data.agentViewToken!=='string'||data.agentViewToken.length<64||
   data.agentViewToken.length>6000)return null;
 if(typeof authorization!=='string'||!authorization.startsWith('Bearer ')||
    authorization.length<108||authorization.length>8200)return null;
 const requesterBearer=authorization.slice(7);
 if(!token.test(requesterBearer))return null;
 return Object.freeze({agentViewToken:data.agentViewToken,requesterBearer});
}
export function sanitizeVoxAgentHttpResponse(v){
 if(!v||v.proofConsumed!==true||v.permissions?.length!==1||
    v.permissions[0]!=='READ_ONLY'||!['AAROHI','ANISHA'].includes(v.agent)||
    !['prospect','vendor'].includes(v.subjectType)||
    typeof v.subjectId!=='string'||typeof v.revision!=='number')
    throw Error('VOX_AGENT_RESPONSE_DENIED');
 return Object.freeze({schema:'qf.vox.agent.view.v1',agent:v.agent,
  channel:v.channel,subjectType:v.subjectType,subjectId:v.subjectId,revision:v.revision,
  memoryStatus:v.memoryStatus,humanTakeover:v.humanTakeover,lastEvent:v.lastEvent,
  proofConsumed:true,permissions:['READ_ONLY']});
}
