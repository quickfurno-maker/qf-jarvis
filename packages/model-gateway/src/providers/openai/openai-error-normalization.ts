import type { ProviderInvocationResult } from '../../contracts/provider.js';

export function normalizeOpenAIHttpStatus(status: number): ProviderInvocationResult {
  if (status === 429) {
    return { status: 'rate-limited' };
  }
  if (status === 499) {
    return { status: 'cancelled' };
  }
  if (status === 408 || status === 409 || (status >= 500 && status <= 599)) {
    return { status: 'unavailable', retryable: true };
  }
  return { status: 'failed', retryable: false };
}
