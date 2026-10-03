export const AAROHI_DISCOVERY_PROVIDER_CHANNELS = [
  'INSTAGRAM','FACEBOOK','X','GOOGLE','WEBSITE','JUSTDIAL','INDIAMART',
] as const;
export type AarohiDiscoveryProviderChannel = (typeof AAROHI_DISCOVERY_PROVIDER_CHANNELS)[number];

export interface AarohiDiscoveryWorkItem {
  readonly runId: string;
  readonly connectorId: string;
  readonly channel: AarohiDiscoveryProviderChannel;
  readonly providerKey: string;
  readonly querySpec: Readonly<Record<string,unknown>>;
}

export interface AarohiNormalizedDiscoveryCandidate {
  readonly sourceType: AarohiDiscoveryProviderChannel;
  readonly externalReference: string;
  readonly businessName: string;
  readonly profileUrl?: string;
  readonly cityHint?: string;
  readonly categoryHint?: string;
  readonly website?: string;
  readonly phoneE164?: string;
  readonly email?: string;
  readonly confidence?: number;
  readonly metadata?: Readonly<Record<string,string|number|boolean|null>>;
  readonly observedAt?: string;
}

export interface AarohiDiscoveryProvider {
  readonly key: string;
  readonly channel: AarohiDiscoveryProviderChannel;
  discover(work:AarohiDiscoveryWorkItem):Promise<readonly AarohiNormalizedDiscoveryCandidate[]>;
}

export interface AarohiDiscoveryProviderRegistry {
  resolve(channel:AarohiDiscoveryProviderChannel,providerKey:string):AarohiDiscoveryProvider|undefined;
}

const REF=/^[A-Za-z0-9._:-]{1,300}$/u;
const E164=/^\+[1-9][0-9]{7,14}$/u;

export function validateNormalizedCandidate(
  value:AarohiNormalizedDiscoveryCandidate,
):AarohiNormalizedDiscoveryCandidate{
  if(
    !AAROHI_DISCOVERY_PROVIDER_CHANNELS.includes(value.sourceType)||
    !REF.test(value.externalReference)||
    value.businessName.trim().length<2||
    value.businessName.length>240||
    (value.phoneE164!==undefined&&!E164.test(value.phoneE164))||
    (value.confidence!==undefined&&(!Number.isInteger(value.confidence)||value.confidence<0||value.confidence>100))
  ) throw new Error('aarohi-discovery-candidate-invalid');
  for(const [name,field,max] of [
    ['profileUrl',value.profileUrl,500],['cityHint',value.cityHint,120],
    ['categoryHint',value.categoryHint,160],['website',value.website,500],
    ['email',value.email,254],
  ] as const){
    if(field!==undefined&&field.length>max) throw new Error('aarohi-discovery-candidate-invalid:'+name);
  }
  if(value.metadata&&Object.keys(value.metadata).some(k=>/message|body|content|text|transcript|secret|token|password|cookie|authorization/i.test(k))){
    throw new Error('aarohi-discovery-candidate-sensitive-metadata');
  }
  return Object.freeze({...value,metadata:value.metadata?Object.freeze({...value.metadata}):undefined});
}

export function createAarohiDiscoveryProviderRegistry(
  providers:readonly AarohiDiscoveryProvider[],
):AarohiDiscoveryProviderRegistry{
  const map=new Map<string,AarohiDiscoveryProvider>();
  for(const provider of providers){
    if(!REF.test(provider.key)||!AAROHI_DISCOVERY_PROVIDER_CHANNELS.includes(provider.channel)){
      throw new Error('aarohi-discovery-provider-invalid');
    }
    const id=provider.channel+':'+provider.key;
    if(map.has(id)) throw new Error('aarohi-discovery-provider-duplicate');
    map.set(id,provider);
  }
  return Object.freeze({
    resolve(channel,providerKey){return map.get(channel+':'+providerKey);},
  });
}
