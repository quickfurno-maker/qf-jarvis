import {
  AarohiSocialProviderError,
  type AarohiSocialChannel,
  type AarohiSocialContinuationProvider,
  type AarohiSocialDispatchWork,
  type AarohiSocialReplyKind,
  type AarohiSocialReplySignal,
} from './social-provider-port.js';

export interface HttpJsonAarohiSocialProviderConfig {
  readonly key: string;
  readonly channel: AarohiSocialChannel;
  readonly endpoint: string;
  readonly bearerToken: string;
  readonly allowedHosts: readonly string[];
  readonly enableContinuation?: boolean;
  readonly enableReplyPolling?: boolean;
  readonly timeoutMs?: number;
  readonly fetchImpl?: typeof fetch;
}
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const REF=/^[A-Za-z0-9._:-]{1,300}$/u;
const E164=/^\+[1-9][0-9]{7,14}$/u;
const REPLY_KINDS:readonly AarohiSocialReplyKind[]=['INTERESTED','WHATSAPP_SHARED','STOP','OTHER'];

function endpoint(config:HttpJsonAarohiSocialProviderConfig):URL{
  let url:URL;
  try{url=new URL(config.endpoint);}catch{throw new Error('aarohi-social-provider-config-invalid');}
  const allowed=new Set(config.allowedHosts.map((host)=>host.toLowerCase()));
  if(url.protocol!=='https:'||url.username||url.password||url.hash||!allowed.has(url.hostname.toLowerCase())){
    throw new Error('aarohi-social-provider-config-invalid');
  }
  return url;
}
function record(value:unknown):Record<string,unknown>|null{
  return !!value&&typeof value==='object'&&!Array.isArray(value)
    ?value as Record<string,unknown>:null;
}
function parseReply(value:unknown,channel:AarohiSocialChannel):AarohiSocialReplySignal{
  const one=record(value);
  if(!one) throw new AarohiSocialProviderError('DEFINITIVE_FAILURE','SOCIAL_REPLY_INVALID');
  const prospectId=one['prospectId'];
  const threadRef=one['threadRef'];
  const messageRef=one['messageRef'];
  const replyKind=one['replyKind'];
  const safeSummary=one['safeSummary'];
  const occurredAt=one['occurredAt'];
  const phoneE164=one['phoneE164'];
  if(
    typeof prospectId!=='string'||!UUID.test(prospectId)||
    typeof threadRef!=='string'||!REF.test(threadRef)||
    typeof messageRef!=='string'||!REF.test(messageRef)||
    typeof replyKind!=='string'||!REPLY_KINDS.includes(replyKind as AarohiSocialReplyKind)||
    typeof safeSummary!=='string'||safeSummary.trim().length<1||safeSummary.length>500||
    typeof occurredAt!=='string'||!Number.isFinite(Date.parse(occurredAt))||
    !(phoneE164===undefined||phoneE164===null||(typeof phoneE164==='string'&&E164.test(phoneE164)))
  ) throw new AarohiSocialProviderError('DEFINITIVE_FAILURE','SOCIAL_REPLY_INVALID');
  if(replyKind==='WHATSAPP_SHARED'&&typeof phoneE164!=='string'){
    throw new AarohiSocialProviderError('DEFINITIVE_FAILURE','SOCIAL_REPLY_PHONE_REQUIRED');
  }
  return Object.freeze({
    prospectId,channel,threadRef,messageRef,
    replyKind:replyKind as AarohiSocialReplyKind,
    safeSummary:safeSummary.trim(),occurredAt:new Date(occurredAt).toISOString(),
    ...(typeof phoneE164==='string'?{phoneE164}:{}),
  });
}

export function createHttpJsonAarohiSocialProvider(
  config:HttpJsonAarohiSocialProviderConfig,
):AarohiSocialContinuationProvider{
  const url=endpoint(config);
  if(!config.bearerToken||config.bearerToken.length<8||config.bearerToken.length>4096){
    throw new Error('aarohi-social-provider-config-invalid');
  }
  const timeoutMs=config.timeoutMs??10_000;
  if(!Number.isInteger(timeoutMs)||timeoutMs<500||timeoutMs>30_000){
    throw new Error('aarohi-social-provider-config-invalid');
  }
  const doFetch=config.fetchImpl??fetch;

  async function request(body:Record<string,unknown>,maxBytes:number){
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),timeoutMs);
    try{
      const response=await doFetch(url,{
        method:'POST',redirect:'error',signal:controller.signal,
        headers:{'content-type':'application/json',authorization:'Bearer '+config.bearerToken},
        body:JSON.stringify(body),
      });
      const raw=await response.text();
      if(raw.length>maxBytes) throw new AarohiSocialProviderError('UNCERTAIN','SOCIAL_RESPONSE_OVERSIZED');
      let decoded:unknown;
      try{decoded=raw?JSON.parse(raw):{};}catch{
        throw new AarohiSocialProviderError(
          response.status>=400&&response.status<500?'DEFINITIVE_FAILURE':'UNCERTAIN',
          'SOCIAL_RESPONSE_INVALID',
        );
      }
      if(!response.ok){
        const value=record(decoded);
        const safe=typeof value?.['code']==='string'?value['code']:'HTTP_'+String(response.status);
        throw new AarohiSocialProviderError(
          response.status>=400&&response.status<500?'DEFINITIVE_FAILURE':'UNCERTAIN',safe,
        );
      }
      return decoded;
    }catch(error){
      if(error instanceof AarohiSocialProviderError) throw error;
      throw new AarohiSocialProviderError('UNCERTAIN','SOCIAL_PROVIDER_REQUEST_UNCERTAIN');
    }finally{clearTimeout(timer);}
  }

  const provider:AarohiSocialContinuationProvider={
    key:config.key,
    channel:config.channel,
    async sendContinuation(work:AarohiSocialDispatchWork){
      if(config.enableContinuation===false||
         work.channel!==config.channel||
         work.messageKind!=='system:request-whatsapp-continuation'){
        throw new AarohiSocialProviderError('DEFINITIVE_FAILURE','SOCIAL_WORK_NOT_PERMITTED');
      }
      const decoded=await request({
        version:1,operation:'SOCIAL_CONTINUATION',jobId:work.jobId,channel:work.channel,
        externalReference:work.externalReference,messageKind:work.messageKind,
      },64_000);
      const value=record(decoded);
      const ref=value?.['providerMessageRef'];
      if(value?.['version']!==1||value?.['status']!=='accepted'||typeof ref!=='string'||!REF.test(ref)){
        throw new AarohiSocialProviderError('UNCERTAIN','SOCIAL_ACCEPT_RESPONSE_INVALID');
      }
      return Object.freeze({providerMessageRef:ref});
    },
  };
  if(config.enableReplyPolling===true){
    provider.pollReplies=async(limit:number)=>{
      const safe=Math.max(1,Math.min(50,Math.round(limit)));
      const decoded=await request({
        version:1,operation:'SOCIAL_REPLY_POLL',channel:config.channel,limit:safe,
      },256_000);
      const value=record(decoded);
      if(value?.['version']!==1||value?.['status']!=='ok'||!Array.isArray(value?.['replies'])||
         value['replies'].length>safe){
        throw new AarohiSocialProviderError('UNCERTAIN','SOCIAL_REPLY_RESPONSE_INVALID');
      }
      return Object.freeze(value['replies'].map((one)=>parseReply(one,config.channel)));
    };
  }
  return Object.freeze(provider);
}
