import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {normalizeVoxAgentHttpRequest,sanitizeVoxAgentHttpResponse,VOX_AGENT_HTTP_PATH} from '../../contracts/vox/scopedAgentHttp.mjs';
const bearer='Bearer '+('a'.repeat(120)+'.'+'b'.repeat(110)+'.'+'c'.repeat(110));
const token='signed-short-lived-view.'+'x'.repeat(120);
const base={agentViewToken:token};
let n=0;function check(name,fn){fn();console.log('PASS',name);n++}
check('private-only endpoint name',()=>assert.equal(VOX_AGENT_HTTP_PATH,'/internal/vox/v1/agent-view'));
check('strict one-field agent request',()=>assert.equal(normalizeVoxAgentHttpRequest(base,bearer)?.agentViewToken,token));
check('reject missing staff auth',()=>assert.equal(normalizeVoxAgentHttpRequest(base,''),null));
check('reject malformed staff auth',()=>assert.equal(normalizeVoxAgentHttpRequest(base,'Bearer bad'),null));
check('reject extra caller role or city',()=>assert.equal(normalizeVoxAgentHttpRequest({...base,staffRole:'superadmin'},bearer),null));
check('reject very large token',()=>assert.equal(normalizeVoxAgentHttpRequest({agentViewToken:'x'.repeat(9000)},bearer),null));
check('reject bearer with extra whitespace',()=>assert.equal(normalizeVoxAgentHttpRequest(base,bearer+' xyz'),null));
const safe={schema:'qf.vox.agent.view.v1',agent:'AAROHI',channel:'ACQUISITION',
 subjectType:'prospect',subjectId:'00000000-0000-4000-8000-000000000001',
 revision:5,proofConsumed:true,permissions:['READ_ONLY'],memoryStatus:'PAUSED',
 humanTakeover:true,lastEvent:'HANDOVER'};
check('safe read-only response',()=>assert.deepEqual(sanitizeVoxAgentHttpResponse(safe).permissions,['READ_ONLY']));
check('no raw provider or phone from trusted adapter',()=>{const r=sanitizeVoxAgentHttpResponse({...safe,phone:'hidden',wallet:123});
 assert.ok(!('phone' in r));assert.ok(!('wallet' in r));});
check('deny unconsumed signed proof',()=>assert.throws(()=>sanitizeVoxAgentHttpResponse({...safe,proofConsumed:false}),/DENIED/));
check('deny unsafe permission',()=>assert.throws(()=>sanitizeVoxAgentHttpResponse({...safe,permissions:['SEND_MESSAGE']}),/DENIED/));
const gateway=readFileSync(resolve(import.meta.dirname,'../../apps/quickfurno-gateway/src/server.ts'),'utf8');
check('staging-only feature disabled by default',()=>assert.match(gateway,/process.env\['QFJ_VOX_ADVISORY_ENABLED'\] !== 'staging'/));
check('gateway requires injected trusted verifier',()=>assert.match(gateway,/dependencies.voxAdvisoryReader === undefined/));
check('gateway enforces bounded JSON',()=>assert.match(gateway,/readBoundedBody\(request\)/));
check('gateway consumes persisted Core-scoped replay verifier',()=>assert.match(gateway,/voxAdvisoryReader.verifyForStaff/));
console.log('VOX16B_JARVIS_PRIVATE_AGENT_HTTP_PASS '+n+'/'+n);
