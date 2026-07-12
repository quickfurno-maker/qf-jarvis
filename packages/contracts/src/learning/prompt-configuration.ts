/**
 * PromptConfigurationReferenceV1 — which prompt, at which version.
 *
 * **References and versions. Nothing else, ever.**
 *
 * Every field on this contract is a machine token, an integer, or a hex digest.
 * There is no string field long enough to hold a prompt, and no field at all whose
 * name or type would invite one. That is not a coincidence; it is the design.
 *
 * ### What must never appear here, and why each one is dangerous
 *
 * - **The complete prompt text.** An assembled prompt contains the context the agent
 *   was given, and that context is drawn from real clients and real vendors. Storing
 *   it turns a provenance record into the single largest concentration of personal
 *   data in the system — and it would sit in a table nobody thinks of as sensitive.
 *
 * - **Private chain-of-thought or hidden reasoning.** Never stored, anywhere, at any
 *   time (agent-model.md). It is not evidence, it is not auditable, and it is exactly
 *   the kind of text that reads as authoritative while being unfalsifiable. The
 *   evidence a recommendation stands on is `EvidenceItem[]`, which points at facts a
 *   human can go and check.
 *
 * - **Raw model output.** Belongs to the run that produced it and to nothing else.
 *
 * - **Provider API keys.** Jarvis holds no credential of any kind
 *   (system-boundary.md).
 *
 * ### Agents do not rewrite their own prompts
 *
 * A prompt version is a thing a **human changed and a reviewer saw**. An agent that
 * can edit its own prompt, its own policy, or its own production configuration is an
 * agent whose behavior is no longer governed by anything a human approved — and every
 * subsequent audit of "why did it do that?" leads back to a change nobody made
 * deliberately. This contract *records* a version; it grants no ability to set one
 * (ADR-0016).
 */

import { z } from 'zod';

import { contractVersionSchema } from '../common/identifiers.js';
import { machineTokenSchema } from '../common/text.js';

export const PROMPT_CONFIGURATION_REFERENCE_CONTRACT_VERSION = 1;

/**
 * An optional integrity digest of the prompt template, as a lowercase hex SHA-256.
 *
 * A digest, not the text. It lets a later phase prove that the prompt in the registry
 * today is byte-for-byte the prompt that ran — without this record ever having held
 * the prompt itself. This package carries the digest; it does not compute one (it
 * imports no Node built-in and performs no I/O — ADR-0012).
 */
export const PROMPT_DIGEST_PATTERN = /^[a-f0-9]{64}$/;

export const promptDigestSchema = z
  .string()
  .regex(PROMPT_DIGEST_PATTERN, 'Must be a lowercase hex SHA-256 digest of the prompt template');

export const promptConfigurationReferenceV1Schema = z.strictObject({
  contractVersion: z.literal(PROMPT_CONFIGURATION_REFERENCE_CONTRACT_VERSION),

  /** Which prompt, by name. Not the prompt. */
  promptId: machineTokenSchema,
  promptVersion: contractVersionSchema,

  /** Which agent configuration was in force — thresholds, rule sets, routing. */
  configurationId: machineTokenSchema,
  configurationVersion: contractVersionSchema,

  /** Optional integrity digest. Proves *which* prompt ran without recording it. */
  promptDigest: promptDigestSchema.optional(),
});

export type PromptConfigurationReferenceV1 = z.infer<typeof promptConfigurationReferenceV1Schema>;
