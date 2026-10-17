import test from "node:test";
import assert from "node:assert/strict";
import {preparePrivateAgentPauseRoute}
 from "./ui04PrivateAgentMount.mjs";
import {projectCurrentAgentDeskReadiness}
 from "./ui04AgentDeskReadiness.mjs";

const id=n=>"00000000-0000-4000-8000-"+String(n).padStart(12,"0");
const now=Date.parse("2026-10-17T10:00:00Z");
const scope={userId:id(1),teamId:id(2),cityId:id(3),
 currentAal:"aal2",canReadContent:true,canMutate:false,
 verifiedDepartments:["client_success","vendor_success","acquisition"]};
const observation=(lane,subjectKind,number)=>({
 lane,subjectKind,subjectId:id(number),conversationId:id(number+10),
 teamId:scope.teamId,cityId:scope.cityId,revision:3,state:"PAUSED",
 consent:"ALLOWED",updatedAt:"2026-10-17T09:20:00Z",humanTakeover:false
});
const rows=[observation("RIYA","client",30),
 observation("ANISHA","vendor",40),
 observation("AAROHI","prospect",50)];
const params=()=>({scope,observations:rows,now,
 verifyCurrentCoreScope:async()=>true,
 verifyEachSubject:async()=>true});
test("T3 exact Core-granted agent lanes display only safe conversation metadata",async()=>{
 const result=await projectCurrentAgentDeskReadiness(params());
 assert.equal(result.ok,true);assert.equal(result.agents.length,3);
 assert.equal(result.canReply,false);assert.equal(result.canTakeover,false);
 assert.equal(result.providerMessagesSent,0);
 assert.equal(result.agents.find(x=>x.lane==="RIYA").state,"PAUSED");
});
test("T3 Riya cannot be exposed by vendor-only Staff scope",async()=>{
 const r=await projectCurrentAgentDeskReadiness({...params(),
  scope:{...scope,verifiedDepartments:["vendor_success"]}});
 assert.equal(r.ok,false);assert.equal(r.agents.length,0);
});
test("T3 unknown agent, mismatched subject, city spoof and stale grant denied",async()=>{
 for(const patch of [
  {lane:"UNKNOWN"},{lane:"RIYA",subjectKind:"prospect"},
  {cityId:id(100)},{teamId:id(101)},
  {conversationId:id(50)},{revision:-2},
  {humanTakeover:true}
 ]){
  const obs=[{...rows[0],...patch},rows[1],rows[2]];
  assert.equal((await projectCurrentAgentDeskReadiness({
   ...params(),observations:obs})).ok,false);
 }
 for(const cb of ["verifyCurrentCoreScope","verifyEachSubject"]){
  assert.equal((await projectCurrentAgentDeskReadiness({
   ...params(),[cb]:async()=>false})).ok,false);
 }
});
test("T3 no consent status authorizes sending",async()=>{
 const r=await projectCurrentAgentDeskReadiness({
  ...params(),observations:rows.map(x=>({...x,consent:"WITHDRAWN"}))});
 assert.equal(r.ok,true);
 assert.ok(r.agents.every(x=>x.consentReadiness==="NOT_SEND_ELIGIBLE"));
 assert.ok(r.agents.every(x=>x.canReply===false));
});
test("T3 rejected invalid and future-dated observations",async()=>{
 for(const row of [
  {...rows[0],updatedAt:"2026-10-18T12:00:00Z"},
  {...rows[0],consent:"DISABLED"},
  {...rows[0],revision:"3"},
  {...rows[0],phone:"+919990000000"}
 ]){
  const r=await projectCurrentAgentDeskReadiness({
   ...params(),observations:[row]});
  if(row.phone){assert.equal(r.ok,true);
   assert.equal(JSON.stringify(r).includes("phone"),false);}
  else assert.equal(r.ok,false);
 }
});
const flags={consentRead:"staging",coreTransport:"staging",
 privateRiyaPause:"staging"};
function mountArgs(){
 let calls=0;let capture;
 const args={environment:"staging",featureGates:flags,
  verifyPrivateGatewayRequest:async()=>true,
  registerPrivatePost:async packet=>{
   calls++;capture=packet;
   return {method:"POST",path:packet.path,registered:true,
    privateIngressOnly:true,publicIngressEnabled:false};
  },
  handlerDependencies:{
   corePublicKeyPem:"TEST_KEY_NOT_INSTALLED",
   jarvisPrivateKeyPem:"TEST_KEY_NOT_INSTALLED",
   verifyQfjSignedRequest:async()=>false,
   verifyCurrentCoreGrant:async()=>true,
   verifyCurrentClientConsent:async()=>true,
   pauseTransaction:async()=>{throw Error("not installed");}
  }};
 return {args,get calls(){return calls},get capture(){return capture}};
}
test("T3 private Riya pause route candidate registers only with explicit staging gates",async()=>{
 const x=mountArgs();
 const r=await preparePrivateAgentPauseRoute(x.args);
 assert.equal(r.ok,true);assert.equal(x.calls,1);
 assert.equal(x.capture.privateIngressOnly,true);
 assert.equal(x.capture.exposeViaPublicTraefik,false);
 assert.equal(r.staffTakeoverApproved,false);
});
test("T3 private Jarvis route never registered when missing review gates",async()=>{
 for(const change of [
  {environment:"production"},
  {featureGates:{...flags,privateRiyaPause:"disabled"}},
  {featureGates:{...flags,coreTransport:"off"}},
  {handlerDependencies:{}},
  {registerPrivatePost:null},
  {verifyPrivateGatewayRequest:null}
 ]){
  const x=mountArgs();const r=await preparePrivateAgentPauseRoute({
   ...x.args,...change});
  assert.equal(r.ok,false);assert.equal(x.calls,0);
 }
});
test("T3 private gateway denies unknown ingress before hitting handler",async()=>{
 const x=mountArgs();
 x.args.verifyPrivateGatewayRequest=async()=>false;
 const r=await preparePrivateAgentPauseRoute(x.args);
 assert.equal(r.ok,true);
 const response={status:0,headers:{},body:"",writeHead(status,h){this.status=status;this.headers=h;},
  end(value){this.body=value;}};
 await x.capture.handler({method:"POST",url:"/internal/vox/v1/riya/pause",
  headers:{"content-type":"application/json"}},response);
 assert.equal(response.status,403);
 assert.match(response.body,/private_gateway_required/);
});
test("T3 registration receipt cannot claim public ingress enabled",async()=>{
 for(const change of [
  {publicIngressEnabled:true},{privateIngressOnly:false},
  {registered:false},{path:"/api/public/riya"}
 ]){
  const x=mountArgs();x.args.registerPrivatePost=async p=>({
   method:"POST",path:p.path,registered:true,privateIngressOnly:true,
   publicIngressEnabled:false,...change});
  assert.equal((await preparePrivateAgentPauseRoute(x.args)).ok,false);
 }
});
test("T3 failed private registration is treated as denied, not activated",async()=>{
 const x=mountArgs();x.args.registerPrivatePost=async()=>{
  throw Error("route not available")};
 assert.equal((await preparePrivateAgentPauseRoute(x.args)).ok,false);
});
