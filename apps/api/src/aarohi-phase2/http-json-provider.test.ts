import { describe, expect, it, vi } from 'vitest';

import { createHttpJsonAarohiDiscoveryProvider } from './http-json-provider.js';

const work={
  runId:'11111111-1111-4111-8111-111111111111',
  connectorId:'22222222-2222-4222-8222-222222222222',
  channel:'GOOGLE' as const,
  providerKey:'provider.g',
  querySpec:{city:'Pune'},
};

describe('Aarohi Phase 2 HTTP discovery provider',()=>{
  it('rejects non-HTTPS and non-allowlisted endpoints',()=>{
    expect(()=>createHttpJsonAarohiDiscoveryProvider({
      key:'provider.g',channel:'GOOGLE',endpoint:'http://example.com/discover',
      bearerToken:'secret-token',allowedHosts:['example.com'],
    })).toThrow('aarohi-provider-config-invalid');
    expect(()=>createHttpJsonAarohiDiscoveryProvider({
      key:'provider.g',channel:'GOOGLE',endpoint:'https://evil.example/discover',
      bearerToken:'secret-token',allowedHosts:['api.example.com'],
    })).toThrow('aarohi-provider-config-invalid');
  });

  it('sends only the bounded work envelope and validates normalized candidates',async()=>{
    const fetchImpl=vi.fn(async(_url:URL|string|Request,init?:RequestInit)=>{ void init; return new Response(JSON.stringify({
      version:1,
      candidates:[{
        externalReference:'place.123',
        businessName:'Studio One',
        cityHint:'Pune',
        categoryHint:'Interior Designer',
        confidence:88,
        metadata:{rating:4.7,source:'official'},
      }],
    }),{status:200,headers:{'content-type':'application/json'}}); });
    const provider=createHttpJsonAarohiDiscoveryProvider({
      key:'provider.g',channel:'GOOGLE',endpoint:'https://api.example.com/discover',
      bearerToken:'secret-token',allowedHosts:['api.example.com'],fetchImpl,
    });
    const rows=await provider.discover(work);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      sourceType:'GOOGLE',externalReference:'place.123',businessName:'Studio One',confidence:88,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const init=fetchImpl.mock.calls[0]?.[1] as RequestInit;
    expect(String((init.headers as Record<string,string>)['authorization'])).toBe('Bearer secret-token');
    expect(String(init.body)).not.toContain('secret-token');
  });

  it('rejects sensitive provider metadata instead of forwarding it to Core',async()=>{
    const fetchImpl=vi.fn(async()=>new Response(JSON.stringify({
      version:1,
      candidates:[{
        externalReference:'place.123',
        businessName:'Studio One',
        metadata:{messageText:'private transcript'},
      }],
    }),{status:200}));
    const provider=createHttpJsonAarohiDiscoveryProvider({
      key:'provider.g',channel:'GOOGLE',endpoint:'https://api.example.com/discover',
      bearerToken:'secret-token',allowedHosts:['api.example.com'],fetchImpl,
    });
    await expect(provider.discover(work)).rejects.toThrow('aarohi-discovery-candidate-sensitive-metadata');
  });
});
