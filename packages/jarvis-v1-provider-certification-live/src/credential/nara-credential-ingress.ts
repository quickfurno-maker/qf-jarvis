/**
 * Nara credential ingress: the existing masked-TTY primitive, wrapped in the Nara-specific holder.
 *
 * ### What is reused, and what is deliberately not
 *
 * `createNodeMaskedSecretSource` already exists in `@qf-jarvis/groq-staging-smoke` and already does the
 * hard part: echo disabled, one-shot read, bounded length, sanitized failures, buffer cleared as far as
 * JavaScript permits. Writing a second one for Nara would be a second credential policy, and the two
 * would drift.
 *
 * What is NOT reused is `GroqApiKey`. A Nara secret held in a Groq holder is a secret whose redaction,
 * provenance and provider association all say the wrong thing, and one careless pass-through later it
 * would be sent to the wrong host. The value goes straight into `createNaraApiKey`, which redacts on
 * `toString`, `toJSON` and Node's inspect.
 *
 * ### Why this lives here and not in the gateway
 *
 * `@qf-jarvis/model-gateway` is production source. It accepts an injected `NaraApiKey` and reads no
 * environment, no file and no terminal, and widening it into a secret-ingress package would give
 * production code a way to obtain a credential on its own. Ingress belongs to the evaluation-only
 * operator that a person runs deliberately.
 */
import { createNodeMaskedSecretSource } from '@qf-jarvis/groq-staging-smoke';
import type { MaskedSecretSource } from '@qf-jarvis/groq-staging-smoke';
import { createNaraApiKey } from '@qf-jarvis/model-gateway';
import type { NaraApiKey } from '@qf-jarvis/model-gateway';

/** What the operator prints while the secret is typed. Names the provider; reveals nothing. */
export const NARA_CREDENTIAL_PROMPT_LABEL = 'NaraRouter API key (input hidden): ';

/** Bounds. A value outside them is refused without echoing any part of it. */
export const MIN_NARA_CREDENTIAL_LENGTH = 16;
export const MAX_NARA_CREDENTIAL_LENGTH = 512;

export const NARA_CREDENTIAL_FAILURES = [
  'nara-credential-not-a-tty',
  'nara-credential-empty',
  'nara-credential-too-short',
  'nara-credential-too-long',
  'nara-credential-invalid-characters',
  'nara-credential-source-failed',
] as const;
export type NaraCredentialFailure = (typeof NARA_CREDENTIAL_FAILURES)[number];

export type NaraCredentialResult =
  | { readonly ok: true; readonly key: NaraApiKey }
  | { readonly ok: false; readonly failure: NaraCredentialFailure };

/**
 * Printable ASCII without whitespace.
 *
 * Narrow on purpose: a pasted value carrying a newline or a stray quote is far more likely to be a
 * paste accident than a real key, and accepting it would put the accident in an Authorization header.
 */
const CREDENTIAL_CHARSET = /^[\x21-\x7e]+$/u;

/** Read one Nara credential, once, from a masked terminal. Returns a redacting holder or a failure. */
export async function readNaraCredential(
  source: MaskedSecretSource,
  isTty: boolean,
): Promise<NaraCredentialResult> {
  if (!isTty) {
    return Object.freeze({ ok: false as const, failure: 'nara-credential-not-a-tty' as const });
  }
  // The source's OWN interactivity check as well as the caller's: stdin and stdout must both be a real
  // terminal, and only this module knows to ask before reading.
  if (!source.isInteractive()) {
    return Object.freeze({ ok: false as const, failure: 'nara-credential-not-a-tty' as const });
  }
  let raw: string;
  try {
    raw = await source.readOnce(NARA_CREDENTIAL_PROMPT_LABEL);
  } catch {
    // The underlying error is deliberately discarded: it can carry a partial read.
    return Object.freeze({ ok: false as const, failure: 'nara-credential-source-failed' as const });
  }
  const value = raw.trim();
  if (value.length === 0) {
    return Object.freeze({ ok: false as const, failure: 'nara-credential-empty' as const });
  }
  if (value.length < MIN_NARA_CREDENTIAL_LENGTH) {
    return Object.freeze({ ok: false as const, failure: 'nara-credential-too-short' as const });
  }
  if (value.length > MAX_NARA_CREDENTIAL_LENGTH) {
    return Object.freeze({ ok: false as const, failure: 'nara-credential-too-long' as const });
  }
  if (!CREDENTIAL_CHARSET.test(value)) {
    return Object.freeze({
      ok: false as const,
      failure: 'nara-credential-invalid-characters' as const,
    });
  }
  // Straight into the Nara holder. The plain string is not returned, stored or logged anywhere.
  return Object.freeze({ ok: true as const, key: createNaraApiKey(value) });
}

/** The Node masked source, re-exported so the operator has one ingress and not two. */
export { createNodeMaskedSecretSource };
export type { MaskedSecretSource };
