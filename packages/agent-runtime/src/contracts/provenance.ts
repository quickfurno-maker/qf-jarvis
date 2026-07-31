/**
 * The runtime provenance envelope (QFJ-S3-B, ADR-0066).
 *
 * The one contract family ADR-0054 did not carry: a content-free record of WHICH agent acted, under
 * WHICH policy and contract version, against WHICH opaque model/provider/release/config references, at
 * WHICH canonical instant — and nothing else.
 *
 * It is deliberately a set of REFERENCES. A provenance record that could carry a prompt, a model
 * output, a credential, a URL, an HTTP status, a provider message or a stack would turn an audit
 * artefact into a disclosure surface, and would defeat the output-disposal guarantee the runtime exists
 * to hold. Every field below is an identifier, an enum, a bounded opaque reference, or a canonical
 * instant, and the schema is `.strict()` so an unknown key is a refusal rather than a passenger.
 *
 * `authority` and `modelOutputRetention` are literals, not inputs: QuickFurno Core is the only
 * authority this runtime may claim, and the runtime never retains model output.
 */
import { z } from 'zod';

import { AgentRuntimeError } from './errors.js';
import { isCanonicalInstant } from './instant.js';
import { RUNTIME_ACTORS } from './vocabularies.js';
import type { RuntimeActor } from './vocabularies.js';

/** The provenance contract version. Additive future versions get a new literal, not a migration framework. */
export const RUNTIME_PROVENANCE_VERSION = 1 as const;
export type RuntimeProvenanceVersion = typeof RUNTIME_PROVENANCE_VERSION;

/** The ONLY authority a runtime provenance record may claim. */
export const RUNTIME_PROVENANCE_AUTHORITY = 'QUICKFURNO_CORE' as const;
export type RuntimeProvenanceAuthority = typeof RUNTIME_PROVENANCE_AUTHORITY;

/** The ONLY model-output retention state the runtime may report. */
export const RUNTIME_MODEL_OUTPUT_RETENTION = 'DISCARDED' as const;
export type RuntimeModelOutputRetention = typeof RUNTIME_MODEL_OUTPUT_RETENTION;

/**
 * A bounded opaque reference: identifier characters only, no whitespace, no punctuation that could
 * carry a URL, a path, a header or a command. A reference names a thing; it never describes it.
 */
const OPAQUE_REFERENCE = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9._:-]+$/);

const CANONICAL_INSTANT = z.string().refine(isCanonicalInstant);

/** A frozen, content-free provenance record. */
export interface RuntimeProvenance {
  readonly contractVersion: RuntimeProvenanceVersion;
  readonly actor: RuntimeActor;
  /** The shared-runtime implementation reference, e.g. a build or slice identifier. */
  readonly runtimeRef: string;
  readonly policyRef: string;
  readonly promptRef: string | undefined;
  readonly modelRef: string | undefined;
  readonly providerRef: string | undefined;
  readonly releaseRef: string | undefined;
  readonly configRef: string | undefined;
  readonly correlationId: string;
  readonly occurredAt: string;
  readonly authority: RuntimeProvenanceAuthority;
  readonly modelOutputRetention: RuntimeModelOutputRetention;
}

/**
 * What a caller may supply.
 *
 * `authority` and `modelOutputRetention` are absent by design — they are not caller-settable, so a
 * caller cannot claim a different authority or assert that output was kept.
 */
export interface RuntimeProvenanceInput {
  readonly actor: RuntimeActor;
  readonly runtimeRef: string;
  readonly policyRef: string;
  readonly promptRef?: string;
  readonly modelRef?: string;
  readonly providerRef?: string;
  readonly releaseRef?: string;
  readonly configRef?: string;
  readonly correlationId: string;
  readonly occurredAt: string;
}

const provenanceInputSchema = z
  .object({
    actor: z.enum(RUNTIME_ACTORS),
    runtimeRef: OPAQUE_REFERENCE,
    policyRef: OPAQUE_REFERENCE,
    promptRef: OPAQUE_REFERENCE.optional(),
    modelRef: OPAQUE_REFERENCE.optional(),
    providerRef: OPAQUE_REFERENCE.optional(),
    releaseRef: OPAQUE_REFERENCE.optional(),
    configRef: OPAQUE_REFERENCE.optional(),
    correlationId: OPAQUE_REFERENCE,
    occurredAt: CANONICAL_INSTANT,
  })
  .strict();

/**
 * Build a frozen provenance record.
 *
 * Throws `AgentRuntimeError('invalid-provenance')` on any invalid or unknown field. The two literals are
 * stamped here and cannot be supplied, so no caller can weaken them.
 */
export function createRuntimeProvenance(input: RuntimeProvenanceInput): RuntimeProvenance {
  const parsed = provenanceInputSchema.safeParse(input);
  if (!parsed.success) {
    throw new AgentRuntimeError('invalid-provenance');
  }
  const value = parsed.data;
  return Object.freeze({
    contractVersion: RUNTIME_PROVENANCE_VERSION,
    actor: value.actor,
    runtimeRef: value.runtimeRef,
    policyRef: value.policyRef,
    promptRef: value.promptRef,
    modelRef: value.modelRef,
    providerRef: value.providerRef,
    releaseRef: value.releaseRef,
    configRef: value.configRef,
    correlationId: value.correlationId,
    occurredAt: value.occurredAt,
    authority: RUNTIME_PROVENANCE_AUTHORITY,
    modelOutputRetention: RUNTIME_MODEL_OUTPUT_RETENTION,
  });
}
