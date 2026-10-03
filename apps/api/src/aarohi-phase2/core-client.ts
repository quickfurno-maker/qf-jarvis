import { createHash, createPrivateKey, sign, type KeyObject } from 'node:crypto';

export const AAROHI_PHASE2_CORE_PATH = '/api/internal/jarvis/aarohi-phase2';
export const AAROHI_PHASE2_CORE_PROTOCOL = 'qfj.aarohi.phase2';
export const AAROHI_PHASE2_CORE_SIGNING_DOMAIN = 'qfj.aarohi.phase2.http.sig.v1';

export interface AarohiPhase2CoreClientConfig {
  readonly baseUrl: string;
  readonly keyId: string;
  readonly privateKeyPem: string;
  readonly clock: () => string;
  readonly requestId: () => string;
  readonly httpPost: (
    url: string,
    init: Readonly<{
      method: 'POST';
      headers: Readonly<Record<string,string>>;
      body: string;
      signal: AbortSignal;
      redirect: 'error';
    }>,
  ) => Promise<{readonly status:number;text():Promise<string>}>;
  readonly timeoutMs?: number;
}
export interface AarohiPhase2CoreClient {
  call(kind:string,payload:Readonly<Record<string,unknown>>):Promise<Readonly<Record<string,unknown>>>;
}

const KEY_ID=/^[A-Za-z0-9._:-]{1,64}$/u;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const MAX_RESPONSE=256_000;
const CALLER='qf-jarvis';
const AUDIENCE='quickfurno-core';

function endpoint(baseUrl:string):string{
  let url:URL;
  try{url=new URL(baseUrl);}catch{throw new Error('aarohi-phase2-core-config-invalid');}
  const loopback=['127.0.0.1','localhost','[::1]'].includes(url.hostname);
  if((url.protocol!=='https:'&&!(loopback&&url.protocol==='http:'))||url.username||url.password||url.search||url.hash||url.pathname!=='/'){
    throw new Error('aarohi-phase2-core-config-invalid');
  }
  return new URL(AAROHI_PHASE2_CORE_PATH,url).toString();
}
function key(config:AarohiPhase2CoreClientConfig):KeyObject{
  if(!KEY_ID.test(config.keyId)||!config.privateKeyPem.includes('PRIVATE KEY')) throw new Error('aarohi-phase2-core-config-invalid');
  const parsed=createPrivateKey(config.privateKeyPem);
  if(parsed.type!=='private'||parsed.asymmetricKeyType!=='ed25519') throw new Error('aarohi-phase2-core-config-invalid');
  return parsed;
}
function digest(body:string):string{
  return createHash('sha256').update(Buffer.from(body,'utf8')).digest('base64url');
}
function signingInput(requestId:string,issuedAt:string,keyId:string,bodyDigest:string):string{
  return [
    AAROHI_PHASE2_CORE_SIGNING_DOMAIN,'POST',AAROHI_PHASE2_CORE_PATH,
    CALLER,AUDIENCE,requestId,issuedAt,keyId,bodyDigest,
  ].join('\n');
}
function parseResponse(raw:string,status:number,requestId:string):Readonly<Record<string,unknown>>{
  if(raw.length>MAX_RESPONSE) throw new Error('aarohi-phase2-core-response-invalid');
  let value:unknown;
  try{value=JSON.parse(raw);}catch{throw new Error('aarohi-phase2-core-response-invalid');}
  if(!value||typeof value!=='object'||Array.isArray(value)) throw new Error('aarohi-phase2-core-response-invalid');
  const object=value as Record<string,unknown>;
  if(status>=200&&status<300){
    if(
      object.protocol!==AAROHI_PHASE2_CORE_PROTOCOL||
      object.version!==1||
      object.requestId!==requestId
    ) throw new Error('aarohi-phase2-core-response-invalid');
    return Object.freeze({...object});
  }
  const code=typeof object.code==='string'?object.code:'http-'+String(status);
  throw new Error('aarohi-phase2-core-refused:'+code);
}

export function createAarohiPhase2CoreClient(config:AarohiPhase2CoreClientConfig):AarohiPhase2CoreClient{
  const privateKey=key(config);
  const timeoutMs=config.timeoutMs??5000;
  if(!Number.isInteger(timeoutMs)||timeoutMs<100||timeoutMs>30000) throw new Error('aarohi-phase2-core-config-invalid');
  const url=endpoint(config.baseUrl);
  return Object.freeze({
    async call(kind:string,payload:Readonly<Record<string,unknown>>){
      const requestId=config.requestId();
      const issuedAt=config.clock();
      if(!UUID.test(requestId)||!Number.isFinite(Date.parse(issuedAt))) throw new Error('aarohi-phase2-core-config-invalid');
      const body=JSON.stringify({
        protocol:AAROHI_PHASE2_CORE_PROTOCOL,
        version:1,
        caller:CALLER,
        audience:AUDIENCE,
        requestId,
        issuedAt,
        tenantId:'quickfurno',
        operation:{kind,payload},
      });
      const signature=sign(null,Buffer.from(
        signingInput(requestId,issuedAt,config.keyId,digest(body)),'utf8'
      ),privateKey).toString('base64url');
      const controller=new AbortController();
      const timer=setTimeout(()=>controller.abort(),timeoutMs);
      try{
        const response=await config.httpPost(url,{
          method:'POST',redirect:'error',signal:controller.signal,body,
          headers:Object.freeze({
            'content-type':'application/json',
            'x-qfj-key-id':config.keyId,
            'x-qfj-signature':signature,
          }),
        });
        const raw=await response.text();
        return parseResponse(raw,response.status,requestId);
      }catch(error){
        if(error instanceof Error&&error.message.startsWith('aarohi-phase2-core-')) throw error;
        throw new Error('aarohi-phase2-core-request-failed');
      }finally{clearTimeout(timer);}
    },
  });
}
