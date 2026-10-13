import assert from "node:assert/strict";
import {signAgentView,verifyAgentView,VOX_JARVIS_CONTRACT} from "../../contracts/vox/agentView.mjs";
const secret="validated-test-fixture--vox-jarvis-signing-key--not-a-production-secret";
const iat=Math.floor(Date.now()/1000);
const base={schema:VOX_JARVIS_CONTRACT,iss:"qf-jarvis",aud:"vox-web",agent:"ANISHA",channel:"VENDOR_SERVICE",
 subjectType:"vendor",subjectId:"f00dbabe-0000-4000-8000-000000000002",jti:"f00dbabe-0000-4000-8000-000000000003",
 revision:5,iat,exp:iat+120,memoryStatus:"CONSENTED",humanTakeover:false,lastEvent:"Onboarding"};
let n=0;const ok=(label,fn)=>{fn();console.log("PASS: "+label);n++};
ok("Anisha signed event verifies",()=>assert.equal(verifyAgentView(signAgentView(base,secret),secret,iat).agent,"ANISHA"));
ok("signed event is read only",()=>assert.deepEqual(verifyAgentView(signAgentView(base,secret),secret,iat).permissions,["READ_ONLY"]));
ok("expiring event rejected",()=>assert.throws(()=>verifyAgentView(signAgentView(base,secret),secret,iat+125),/EXPIRED/));
ok("bad secret rejected",()=>assert.throws(()=>signAgentView(base,"short"),/KEY_MISSING/));
ok("wrong audience rejected",()=>assert.throws(()=>signAgentView({...base,aud:"core-admin"},secret),/INVALID/));
ok("wrong channel rejected",()=>assert.throws(()=>signAgentView({...base,channel:"ACQUISITION"},secret),/INVALID/));
ok("wrong subject type rejected",()=>assert.throws(()=>signAgentView({...base,subjectType:"prospect"},secret),/INVALID/));
ok("raw memory prohibited",()=>assert.throws(()=>signAgentView({...base,rawMemory:"secret"},secret),/INVALID/));
ok("wallet and credits prohibited",()=>assert.throws(()=>signAgentView({...base,wallet:20},secret),/INVALID/));
ok("unknown confidential field denied",()=>assert.throws(()=>signAgentView({...base,rawTranscript:"private"},secret),/INVALID/));
ok("Aarohi prospective event permitted",()=>assert.equal(verifyAgentView(signAgentView({...base,agent:"AAROHI",channel:"ACQUISITION",subjectType:"prospect"},secret),secret,iat).agent,"AAROHI"));
ok("signature tamper rejected",()=>{const token=signAgentView(base,secret);assert.throws(()=>verifyAgentView(token.slice(0,-1)+(token.at(-1)==="A"?"B":"A"),secret),/SIGNATURE/);});
ok("future issued event rejected",()=>assert.throws(()=>verifyAgentView(signAgentView({...base,iat:iat+100,exp:iat+200},secret),secret,iat),/EXPIRED/));
ok("replay-store required hint",()=>assert.equal(verifyAgentView(signAgentView(base,secret),secret,iat).replayCheckRequired,true));
console.log("VOX_JARVIS_READ_ONLY_CONTRACT_PASS "+n+"/14");
