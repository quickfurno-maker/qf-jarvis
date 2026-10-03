import type { AarohiPhase2CoreClient } from './core-client.js';
import type {
  AarohiDiscoveryProviderChannel,
  AarohiDiscoveryProviderRegistry,
  AarohiDiscoveryWorkItem,
} from './provider-port.js';
import { AAROHI_DISCOVERY_PROVIDER_CHANNELS, validateNormalizedCandidate } from './provider-port.js';
import {
  AarohiSocialProviderError,
  type AarohiSocialChannel,
  type AarohiSocialDispatchWork,
  type AarohiSocialProviderRegistry,
} from './social-provider-port.js';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const REF=/^[A-Za-z0-9._:-]{1,300}$/u;

export interface AarohiPhase2WorkerConfig {
  readonly workerRef:string;
  readonly core:AarohiPhase2CoreClient;
  readonly providers:AarohiDiscoveryProviderRegistry;
  readonly socialProviders?:AarohiSocialProviderRegistry;
}

export type AarohiPhase2CycleResult =
  | Readonly<{state:'idle'}>
  | Readonly<{state:'completed';runId:string;candidateCount:number}>
  | Readonly<{state:'social-completed';jobId:string;providerMessageRef:string}>
  | Readonly<{state:'refused';runId?:string;jobId?:string;code:string}>;

function workFromClaim(value:Readonly<Record<string,unknown>>):AarohiDiscoveryWorkItem|null{
  if(value['status']==='idle') return null;
  const run=value['run'];
  if(!run||typeof run!=='object'||Array.isArray(run)) throw new Error('aarohi-phase2-claim-invalid');
  const one=run as Record<string,unknown>;
  const channel=String(one['channel']) as AarohiDiscoveryProviderChannel;
  if(
    !UUID.test(String(one['runId']))||
    !UUID.test(String(one['connectorId']))||
    !AAROHI_DISCOVERY_PROVIDER_CHANNELS.includes(channel)||
    !REF.test(String(one['providerKey']))||
    !one['querySpec']||typeof one['querySpec']!=='object'||Array.isArray(one['querySpec'])
  ) throw new Error('aarohi-phase2-claim-invalid');
  return Object.freeze({
    runId:String(one['runId']),
    connectorId:String(one['connectorId']),
    channel,
    providerKey:String(one['providerKey']),
    querySpec:Object.freeze({...one['querySpec'] as Record<string,unknown>}),
  });
}

function socialWorkFromClaim(value:Readonly<Record<string,unknown>>):AarohiSocialDispatchWork|null{
  if(value['status']==='idle') return null;
  const job=value['job'];
  if(!job||typeof job!=='object'||Array.isArray(job)) throw new Error('aarohi-phase2-social-claim-invalid');
  const one=job as Record<string,unknown>;
  const channel=String(one['channel']) as AarohiSocialChannel;
  if(
    !UUID.test(String(one['jobId']))||
    !UUID.test(String(one['executionToken']))||
    !UUID.test(String(one['prospectId']))||
    !['INSTAGRAM','FACEBOOK','X'].includes(channel)||
    !REF.test(String(one['externalReference']))||
    one['messageKind']!=='system:request-whatsapp-continuation'||
    typeof one['coreAuthorizationRef']!=='string'||one['coreAuthorizationRef'].length<1||
    !Number.isSafeInteger(one['attemptCount'])||Number(one['attemptCount'])<1
  ) throw new Error('aarohi-phase2-social-claim-invalid');
  return Object.freeze({
    jobId:String(one['jobId']),
    executionToken:String(one['executionToken']),
    prospectId:String(one['prospectId']),
    channel,
    externalReference:String(one['externalReference']),
    messageKind:'system:request-whatsapp-continuation',
    coreAuthorizationRef:String(one['coreAuthorizationRef']),
    attemptCount:Number(one['attemptCount']),
  });
}

function safeCode(error:unknown):string{
  if(!(error instanceof Error)) return 'AAROHI_PHASE2_UNKNOWN';
  return error.message.replace(/[^A-Za-z0-9._:-]/g,'_').slice(0,120)||'AAROHI_PHASE2_ERROR';
}

export function createAarohiPhase2Worker(config:AarohiPhase2WorkerConfig){
  if(!REF.test(config.workerRef)) throw new Error('aarohi-phase2-worker-config-invalid');
  return Object.freeze({
    async runOnce():Promise<AarohiPhase2CycleResult>{
      let work:AarohiDiscoveryWorkItem|null=null;
      try{
        const claim=await config.core.call('CLAIM_DISCOVERY_RUN',{workerRef:config.workerRef});
        work=workFromClaim(claim);
        if(work===null) return Object.freeze({state:'idle' as const});
        const provider=config.providers.resolve(work.channel,work.providerKey);
        if(!provider){
          await config.core.call('COMPLETE_DISCOVERY_RUN',{
            runId:work.runId,state:'FAILED',candidateCount:0,promotedCount:0,
            errorCode:'PROVIDER_NOT_CONFIGURED',
          });
          return Object.freeze({state:'refused' as const,runId:work.runId,code:'PROVIDER_NOT_CONFIGURED'});
        }
        const discovered=await provider.discover(work);
        const candidates=discovered.slice(0,100).map(candidate=>validateNormalizedCandidate(candidate));
        if(candidates.length>0){
          await config.core.call('SUBMIT_DISCOVERY_CANDIDATES',{
            runId:work.runId,connectorId:work.connectorId,candidates,
          });
        }
        await config.core.call('COMPLETE_DISCOVERY_RUN',{
          runId:work.runId,state:'COMPLETED',candidateCount:candidates.length,promotedCount:0,
        });
        return Object.freeze({state:'completed' as const,runId:work.runId,candidateCount:candidates.length});
      }catch(error){
        const code=safeCode(error);
        if(work!==null){
          try{
            await config.core.call('COMPLETE_DISCOVERY_RUN',{
              runId:work.runId,state:'FAILED',candidateCount:0,promotedCount:0,errorCode:code,
            });
          }catch{
            // Execution uncertainty must never cause a second provider discovery attempt.
          }
          return Object.freeze({state:'refused' as const,runId:work.runId,code});
        }
        return Object.freeze({state:'refused' as const,code});
      }
    },
    async runSocialOnce():Promise<AarohiPhase2CycleResult>{
      let work:AarohiSocialDispatchWork|null=null;
      try{
        const claim=await config.core.call('CLAIM_SOCIAL_OUTREACH',{workerRef:config.workerRef});
        work=socialWorkFromClaim(claim);
        if(work===null) return Object.freeze({state:'idle' as const});
        const provider=config.socialProviders?.resolve(work.channel);
        if(!provider){
          await config.core.call('COMPLETE_SOCIAL_OUTREACH',{
            jobId:work.jobId,executionToken:work.executionToken,
            outcome:'DEFINITIVE_FAILURE',errorCode:'SOCIAL_PROVIDER_NOT_CONFIGURED',
          });
          return Object.freeze({state:'refused' as const,jobId:work.jobId,code:'SOCIAL_PROVIDER_NOT_CONFIGURED'});
        }
        let providerMessageRef:string;
        try{
          const result=await provider.sendContinuation(work);
          providerMessageRef=result.providerMessageRef;
        }catch(error){
          const certainty=error instanceof AarohiSocialProviderError?error.certainty:'UNCERTAIN';
          const code=error instanceof AarohiSocialProviderError?error.safeCode:safeCode(error);
          try{
            await config.core.call('COMPLETE_SOCIAL_OUTREACH',{
              jobId:work.jobId,executionToken:work.executionToken,
              outcome:certainty,errorCode:code,
            });
          }catch{
            // Never repeat a provider execution after an uncertain completion acknowledgement.
          }
          return Object.freeze({state:'refused' as const,jobId:work.jobId,code});
        }
        try{
          await config.core.call('COMPLETE_SOCIAL_OUTREACH',{
            jobId:work.jobId,executionToken:work.executionToken,
            outcome:'ACCEPTED',providerMessageRef,
          });
        }catch{
          return Object.freeze({
            state:'refused' as const,jobId:work.jobId,code:'SOCIAL_COMPLETION_ACK_UNCERTAIN',
          });
        }
        return Object.freeze({state:'social-completed' as const,jobId:work.jobId,providerMessageRef});
      }catch(error){
        return Object.freeze({
          state:'refused' as const,
          ...(work?{jobId:work.jobId}:{}),
          code:safeCode(error),
        });
      }
    },
  });
}
