/**
 * The REQUIRED server-side data classification policy (ADR-0097, implementing ADR-0094 §dataClass).
 *
 * ### Why there is no default
 *
 * `RuntimeDataClass` decides whether a turn's content may leave a hosted boundary. A default would be
 * a guess about somebody's data made by whoever wired the ingress and forgot. If the default were
 * permissive it would route material to a hosted model that should never have gone there; if it were
 * restrictive it would look like the feature was broken and the first fix anybody tried would be to
 * loosen it. Both are worse than refusing to construct.
 *
 * So the policy is injected, required, and has no fallback anywhere in this module.
 *
 * ### Why it is synchronous
 *
 * A `Promise`-returning classifier invites exactly the implementation this boundary must not have:
 * one that asks a model, or a network service, what class a person's words are. That would send the
 * content somewhere BEFORE it had been classified — deciding whether material may leave a boundary by
 * first letting it leave. Synchronous is not a style preference; it is the shape that makes the wrong
 * implementation hard to write.
 *
 * ### What it may see
 *
 * Only signed fields, and only after the request is authenticated. A browser cannot reach it: the
 * wire schema has no `dataClass`, no header or query parameter is consulted, and an unauthenticated
 * request is refused before the policy is invoked at all.
 */
import { RUNTIME_DATA_CLASSES } from '@qf-jarvis/agent-runtime';
import type { RuntimeDataClass } from '@qf-jarvis/agent-runtime';

/** The signed facts a classifier may consider. Deliberately a subset of the validated request. */
export interface RiyaWebIngressClassificationInput {
  readonly tenantId: string;
  readonly conversationId: string;
  readonly messageId: string;
  readonly subjectRef?: string;
  readonly normalizedText?: string;
}

/**
 * The injected policy. One synchronous method, no default, no I/O.
 *
 * An implementation that needs external data must resolve it BEFORE the handler is constructed and
 * close over it — not fetch it per turn.
 */
export interface RiyaWebIngressDataClassPolicy {
  classify(input: RiyaWebIngressClassificationInput): RuntimeDataClass;
}

/** `true` iff `value` is a member of the closed runtime vocabulary. */
export function isRuntimeDataClass(value: unknown): value is RuntimeDataClass {
  return typeof value === 'string' && (RUNTIME_DATA_CLASSES as readonly string[]).includes(value);
}
