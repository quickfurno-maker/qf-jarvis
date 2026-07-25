/**
 * The injected async Groq credential resolver (QFJ-S1, ADR-0060 §D).
 *
 * The staging binding never holds a raw key: it holds an OPAQUE reference and an injected async
 * resolver that materializes a redacting {@link GroqApiKey} only at bind time. The reference is an
 * opaque identifier (e.g. a staging secret name/version) — NEVER the key value. There is no
 * `process.env` access anywhere in this package. A missing/unresolvable credential rejects, and the
 * binding fails closed BEFORE any transport. The only concrete resolver shipped is the deterministic
 * fake (an obvious sentinel key) under `./testing`.
 */
import type { GroqApiKey } from './groq-secret.js';

/** An OPAQUE reference to a Groq credential — never the key value. */
export interface GroqCredentialReference {
  readonly ref: string;
}

/** Resolves an opaque credential reference to a redacting key holder. Awaited; may reject. */
export interface GroqCredentialResolver {
  resolve(reference: GroqCredentialReference): Promise<GroqApiKey>;
}
