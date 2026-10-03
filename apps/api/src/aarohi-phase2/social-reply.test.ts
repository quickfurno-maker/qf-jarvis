import { describe, expect, it, vi } from 'vitest';

import type { AarohiPhase2CoreClient } from './core-client.js';
import { createHttpJsonAarohiSocialProvider } from './http-json-social-provider.js';
import { createAarohiDiscoveryProviderRegistry } from './provider-port.js';
import { createAarohiSocialProviderRegistry } from './social-provider-port.js';
import { createAarohiPhase2Worker } from './worker.js';

const PROSPECT='11111111-1111-4111-8111-111111111111';

describe('Aarohi Phase 2 social reply ingestion',()=>{
  it('accepts only structured reply signals and never raw transcript fields',async()=>{
    const fetchImpl=vi.fn(async()=>new Response(JSON.stringify({
      version:1,status:'ok',replies:[{
        prospectId:PROSPECT,
        threadRef:'thread.1',
        messageRef:'message.1',
        replyKind:'WHATSAPP_SHARED',
        safeSummary:'Prospect asked to continue on WhatsApp.',
        occurredAt:'2026-10-03T05:00:00Z',
        phoneE164:'+919876543210',
      }],
    }),{status:200,headers:{'content-type':'application/json'}}));
    const provider=createHttpJsonAarohiSocialProvider({
      key:'meta.instagram',
      channel:'INSTAGRAM',
      endpoint:'https://social.example.test/aarohi',
      bearerToken:'test-secret-token',
      allowedHosts:['social.example.test'],
      enableContinuation:false,
      enableReplyPolling:true,
      fetchImpl:fetchImpl as unknown as typeof fetch,
    });
    await expect(provider.pollReplies?.(25)).resolves.toEqual([{
      prospectId:PROSPECT,
      channel:'INSTAGRAM',
      threadRef:'thread.1',
      messageRef:'message.1',
      replyKind:'WHATSAPP_SHARED',
      safeSummary:'Prospect asked to continue on WhatsApp.',
      occurredAt:'2026-10-03T05:00:00.000Z',
      phoneE164:'+919876543210',
    }]);
    const body=JSON.parse(String((fetchImpl.mock.calls[0]?.[1] as RequestInit)?.body));
    expect(body).toEqual({
      version:1,operation:'SOCIAL_REPLY_POLL',channel:'INSTAGRAM',limit:25,
    });
    expect(JSON.stringify(body).toLowerCase()).not.toContain('transcript');
    expect(JSON.stringify(body).toLowerCase()).not.toContain('messagebody');
  });

  it('forwards every structured reply through the signed Core client',async()=>{
    const calls:{kind:string;payload:Readonly<Record<string,unknown>>}[]=[];
    const core:AarohiPhase2CoreClient={
      async call(kind,payload){
        calls.push({kind,payload});
        return {status:'recorded'};
      },
    };
    const social=createAarohiSocialProviderRegistry([{
      key:'x.official',
      channel:'X',
      async sendContinuation(){throw new Error('not-used');},
      async pollReplies(){
        return [{
          prospectId:PROSPECT,
          channel:'X',
          threadRef:'thread.x',
          messageRef:'message.x',
          replyKind:'INTERESTED',
          safeSummary:'Prospect is interested in QuickFurno.',
          occurredAt:'2026-10-03T05:02:00.000Z',
        }];
      },
    }]);
    const worker=createAarohiPhase2Worker({
      workerRef:'worker.social',
      core,
      providers:createAarohiDiscoveryProviderRegistry([]),
      socialProviders:social,
    });
    await expect(worker.runSocialInboxOnce()).resolves.toEqual({
      state:'social-ingested',replyCount:1,providerCount:1,
    });
    expect(calls).toEqual([{
      kind:'SUBMIT_SOCIAL_REPLY',
      payload:{
        prospectId:PROSPECT,
        channel:'X',
        threadRef:'thread.x',
        messageRef:'message.x',
        replyKind:'INTERESTED',
        safeSummary:'Prospect is interested in QuickFurno.',
        occurredAt:'2026-10-03T05:02:00.000Z',
      },
    }]);
  });

  it('refuses raw or oversized provider reply payloads',async()=>{
    const provider=createHttpJsonAarohiSocialProvider({
      key:'meta.facebook',
      channel:'FACEBOOK',
      endpoint:'https://social.example.test/aarohi',
      bearerToken:'test-secret-token',
      allowedHosts:['social.example.test'],
      enableReplyPolling:true,
      fetchImpl:(async()=>new Response(JSON.stringify({
        version:1,status:'ok',replies:[{
          prospectId:PROSPECT,
          threadRef:'thread.1',
          messageRef:'message.1',
          replyKind:'OTHER',
          safeSummary:'x'.repeat(501),
          occurredAt:'2026-10-03T05:00:00Z',
          transcript:'must never be accepted',
        }],
      }),{status:200})) as typeof fetch,
    });
    await expect(provider.pollReplies?.(10)).rejects.toMatchObject({
      safeCode:'SOCIAL_REPLY_INVALID',
      certainty:'DEFINITIVE_FAILURE',
    });
  });
});
