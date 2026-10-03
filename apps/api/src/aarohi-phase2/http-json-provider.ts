import type {
  AarohiDiscoveryProvider,
  AarohiDiscoveryProviderChannel,
  AarohiDiscoveryWorkItem,
  AarohiNormalizedDiscoveryCandidate,
} from './provider-port.js';
import { validateNormalizedCandidate } from './provider-port.js';

export interface HttpJsonAarohiDiscoveryProviderConfig {
  readonly key:string;
  readonly channel:AarohiDiscoveryProviderChannel;
  readonly endpoint:string;
  readonly bearerToken:string;
  readonly allowedHosts:readonly string[];
  readonly timeoutMs?:number;
  readonly fetchImpl?:typeof fetch;
  readonly maxCandidates?:number;
}

function endpoint(config:HttpJsonAarohiDiscoveryProviderConfig):URL{
  let url:URL;
  try{url=new URL(config.endpoint);}catch{throw new Error('aarohi-provider-config-invalid');}
  const allowed=new Set(config.allowedHosts.map(host=>host.toLowerCase()));
  if(url.protocol!=='https:'||url.username||url.password||url.hash||!allowed.has(url.hostname.toLowerCase())){
    throw new Error('aarohi-provider-config-invalid');
  }
  return url;
}
function safeRecord(value:unknown):Record<string,unknown>{
  if(!value||typeof value!=='object'||Array.isArray(value)) throw new Error('aarohi-provider-response-invalid');
  return value as Record<string,unknown>;
}
function optionalString(value:unknown,max:number):string|undefined{
  return typeof value==='string'&&value.trim().length>0&&value.length<=max?value.trim():undefined;
}

export function createHttpJsonAarohiDiscoveryProvider(
  config:HttpJsonAarohiDiscoveryProviderConfig,
):AarohiDiscoveryProvider{
  const url=endpoint(config);
  if(!config.bearerToken||config.bearerToken.length<8||config.bearerToken.length>4096){
    throw new Error('aarohi-provider-config-invalid');
  }
  const timeoutMs=config.timeoutMs??10_000;
  const maxCandidates=config.maxCandidates??100;
  if(!Number.isInteger(timeoutMs)||timeoutMs<500||timeoutMs>30_000||!Number.isInteger(maxCandidates)||maxCandidates<1||maxCandidates>100){
    throw new Error('aarohi-provider-config-invalid');
  }
  const doFetch=config.fetchImpl??fetch;
  return Object.freeze({
    key:config.key,
    channel:config.channel,
    async discover(work:AarohiDiscoveryWorkItem){
      if(work.channel!==config.channel||work.providerKey!==config.key) throw new Error('aarohi-provider-work-mismatch');
      const controller=new AbortController();
      const timer=setTimeout(()=>controller.abort(),timeoutMs);
      try{
        const response=await doFetch(url,{
          method:'POST',
          redirect:'error',
          signal:controller.signal,
          headers:{
            'content-type':'application/json',
            'authorization':'Bearer '+config.bearerToken,
          },
          body:JSON.stringify({
            version:1,
            runId:work.runId,
            connectorId:work.connectorId,
            channel:work.channel,
            querySpec:work.querySpec,
            maxCandidates,
          }),
        });
        if(!response.ok) throw new Error('aarohi-provider-request-refused');
        const raw=await response.text();
        if(raw.length>512_000) throw new Error('aarohi-provider-response-invalid');
        let decoded:unknown;
        try{decoded=JSON.parse(raw);}catch{throw new Error('aarohi-provider-response-invalid');}
        const root=safeRecord(decoded);
        if(root['version']!==1||!Array.isArray(root['candidates'])||root['candidates'].length>maxCandidates){
          throw new Error('aarohi-provider-response-invalid');
        }
        return Object.freeze(root['candidates'].map((candidate)=>{
          const one=safeRecord(candidate);
          const metadata=safeRecord(one['metadata']??{});
          const normalized:AarohiNormalizedDiscoveryCandidate={
            sourceType:work.channel,
            externalReference:String(one['externalReference']??''),
            businessName:String(one['businessName']??''),
            ...(optionalString(one['profileUrl'],500)?{profileUrl:optionalString(one['profileUrl'],500)!}:{}),
            ...(optionalString(one['cityHint'],120)?{cityHint:optionalString(one['cityHint'],120)!}:{}),
            ...(optionalString(one['categoryHint'],160)?{categoryHint:optionalString(one['categoryHint'],160)!}:{}),
            ...(optionalString(one['website'],500)?{website:optionalString(one['website'],500)!}:{}),
            ...(optionalString(one['phoneE164'],20)?{phoneE164:optionalString(one['phoneE164'],20)!}:{}),
            ...(optionalString(one['email'],254)?{email:optionalString(one['email'],254)!}:{}),
            ...(typeof one['confidence']==='number'?{confidence:one['confidence']}:{}),
            metadata:Object.fromEntries(Object.entries(metadata).flatMap(([key,value])=>
              typeof value==='string'||typeof value==='number'||typeof value==='boolean'||value===null
                ? [[key,value] as const]:[]
            )),
            ...(optionalString(one['observedAt'],40)?{observedAt:optionalString(one['observedAt'],40)!}:{}),
          };
          return validateNormalizedCandidate(normalized);
        }));
      }catch(error){
        if(error instanceof Error&&error.message.startsWith('aarohi-provider-')) throw error;
        throw new Error('aarohi-provider-request-failed');
      }finally{clearTimeout(timer);}
    },
  });
}
