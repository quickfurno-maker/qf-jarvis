export type AarohiSocialChannel = 'INSTAGRAM' | 'FACEBOOK' | 'X';
export type AarohiSocialMessageKind = 'system:request-whatsapp-continuation';
export type AarohiSocialReplyKind = 'INTERESTED' | 'WHATSAPP_SHARED' | 'STOP' | 'OTHER';

export interface AarohiSocialDispatchWork {
  readonly jobId: string;
  readonly executionToken: string;
  readonly prospectId: string;
  readonly channel: AarohiSocialChannel;
  readonly externalReference: string;
  readonly messageKind: AarohiSocialMessageKind;
  readonly coreAuthorizationRef: string;
  readonly attemptCount: number;
}
export interface AarohiSocialDispatchResult {
  readonly providerMessageRef: string;
}
export interface AarohiSocialReplySignal {
  readonly prospectId: string;
  readonly channel: AarohiSocialChannel;
  readonly threadRef: string;
  readonly messageRef: string;
  readonly replyKind: AarohiSocialReplyKind;
  readonly safeSummary: string;
  readonly occurredAt: string;
  readonly phoneE164?: string;
}
export interface AarohiSocialContinuationProvider {
  readonly key: string;
  readonly channel: AarohiSocialChannel;
  sendContinuation(work: AarohiSocialDispatchWork): Promise<AarohiSocialDispatchResult>;
  pollReplies?(limit: number): Promise<readonly AarohiSocialReplySignal[]>;
}
export class AarohiSocialProviderError extends Error {
  readonly certainty: 'DEFINITIVE_FAILURE' | 'UNCERTAIN';
  readonly safeCode: string;
  constructor(certainty: 'DEFINITIVE_FAILURE' | 'UNCERTAIN', safeCode: string) {
    super(safeCode);
    this.name = 'AarohiSocialProviderError';
    this.certainty = certainty;
    this.safeCode = safeCode.replace(/[^A-Za-z0-9._:-]/gu, '_').slice(0, 120);
  }
}
export interface AarohiSocialProviderRegistry {
  resolve(channel: AarohiSocialChannel): AarohiSocialContinuationProvider | undefined;
  polling(): readonly AarohiSocialContinuationProvider[];
}
export function createAarohiSocialProviderRegistry(
  providers: readonly AarohiSocialContinuationProvider[],
): AarohiSocialProviderRegistry {
  const map = new Map<AarohiSocialChannel, AarohiSocialContinuationProvider>();
  for (const provider of providers) {
    if (map.has(provider.channel)) throw new Error('aarohi-social-provider-duplicate');
    map.set(provider.channel, provider);
  }
  return Object.freeze({
    resolve(channel: AarohiSocialChannel) {
      return map.get(channel);
    },
    polling() {
      return Object.freeze([...map.values()].filter((provider) => provider.pollReplies !== undefined));
    },
  });
}
