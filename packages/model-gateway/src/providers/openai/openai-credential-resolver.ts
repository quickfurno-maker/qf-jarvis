/**
 * Injected OpenAI credential resolver.
 *
 * The resolver accepts only an opaque reference and returns the redacting OpenAIApiKey holder.
 * It performs no ambient environment lookup and exposes no raw credential.
 */
import type { OpenAIApiKey } from './openai-secret.js';

export interface OpenAICredentialReference {
  readonly ref: string;
}

export interface OpenAICredentialResolver {
  resolve(reference: OpenAICredentialReference): Promise<OpenAIApiKey>;
}
