import {
  AarohiSocialProviderError,
  type AarohiSocialChannel,
  type AarohiSocialContinuationProvider,
  type AarohiSocialDispatchWork,
} from './social-provider-port.js';

export interface HttpJsonAarohiSocialProviderConfig {
  readonly key: string;
  readonly channel: AarohiSocialChannel;
  readonly endpoint: string;
  readonly bearerToken: string;
  readonly allowedHosts: readonly string[];
  readonly timeoutMs?: number;
  readonly fetchImpl?: typeof fetch;
}
function endpoint(config: HttpJsonAarohiSocialProviderConfig): URL {
  let url: URL;
  try {
    url = new URL(config.endpoint);
  } catch {
    throw new Error('aarohi-social-provider-config-invalid');
  }
  const allowed = new Set(config.allowedHosts.map((host) => host.toLowerCase()));
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.hash ||
    !allowed.has(url.hostname.toLowerCase())
  ) {
    throw new Error('aarohi-social-provider-config-invalid');
  }
  return url;
}
function record(value: unknown): Record<string, unknown> | null {
  return !!value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
export function createHttpJsonAarohiSocialProvider(
  config: HttpJsonAarohiSocialProviderConfig,
): AarohiSocialContinuationProvider {
  const url = endpoint(config);
  if (!config.bearerToken || config.bearerToken.length < 8 || config.bearerToken.length > 4096) {
    throw new Error('aarohi-social-provider-config-invalid');
  }
  const timeoutMs = config.timeoutMs ?? 10_000;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 500 || timeoutMs > 30_000) {
    throw new Error('aarohi-social-provider-config-invalid');
  }
  const doFetch = config.fetchImpl ?? fetch;
  return Object.freeze({
    key: config.key,
    channel: config.channel,
    async sendContinuation(work: AarohiSocialDispatchWork) {
      if (
        work.channel !== config.channel ||
        work.messageKind !== 'system:request-whatsapp-continuation'
      ) {
        throw new AarohiSocialProviderError('DEFINITIVE_FAILURE', 'SOCIAL_WORK_NOT_PERMITTED');
      }
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await doFetch(url, {
          method: 'POST',
          redirect: 'error',
          signal: controller.signal,
          headers: {
            'content-type': 'application/json',
            authorization: 'Bearer ' + config.bearerToken,
          },
          body: JSON.stringify({
            version: 1,
            operation: 'SOCIAL_CONTINUATION',
            jobId: work.jobId,
            channel: work.channel,
            externalReference: work.externalReference,
            messageKind: work.messageKind,
          }),
        });
        const raw = await response.text();
        if (raw.length > 64_000)
          throw new AarohiSocialProviderError('UNCERTAIN', 'SOCIAL_RESPONSE_OVERSIZED');
        let decoded: unknown;
        try {
          decoded = raw ? JSON.parse(raw) : {};
        } catch {
          throw new AarohiSocialProviderError(
            response.status >= 400 && response.status < 500 ? 'DEFINITIVE_FAILURE' : 'UNCERTAIN',
            'SOCIAL_RESPONSE_INVALID',
          );
        }
        const value = record(decoded);
        if (response.ok) {
          const ref = value?.['providerMessageRef'];
          if (
            value?.['version'] !== 1 ||
            value?.['status'] !== 'accepted' ||
            typeof ref !== 'string' ||
            ref.trim().length < 1 ||
            ref.length > 300
          ) {
            throw new AarohiSocialProviderError('UNCERTAIN', 'SOCIAL_ACCEPT_RESPONSE_INVALID');
          }
          return Object.freeze({ providerMessageRef: ref.trim() });
        }
        const safe =
          typeof value?.['code'] === 'string' ? value['code'] : 'HTTP_' + String(response.status);
        throw new AarohiSocialProviderError(
          response.status >= 400 && response.status < 500 ? 'DEFINITIVE_FAILURE' : 'UNCERTAIN',
          safe,
        );
      } catch (error) {
        if (error instanceof AarohiSocialProviderError) throw error;
        throw new AarohiSocialProviderError('UNCERTAIN', 'SOCIAL_PROVIDER_REQUEST_UNCERTAIN');
      } finally {
        clearTimeout(timer);
      }
    },
  });
}
