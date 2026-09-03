/**
 * The offline model configuration inventory (AS2, ADR-0143 §9).
 *
 * ### The inventory is the authority on model family, not the model
 *
 * Cross-family critique only means something if "which family produced this" is a fact the harness
 * knows independently. Asking a model what it is would make the whole arrangement self-reported: a
 * misconfigured teacher could answer "claude", satisfy the cross-family rule on paper, and the corpus
 * would carry an untrue independence claim that nothing could later detect.
 *
 * So `modelFamilyRef` lives HERE, on a configuration a person wrote down, and the orchestrator reads
 * it from the inventory rather than from any response.
 *
 * ### It is content-free, and that is enforced
 *
 * No key, no token, no bearer, no base URL, no account or organisation id. A config is a set of
 * opaque refs plus bounded integers. Where an endpoint genuinely has to be named, it is named by an
 * `adapterRef` that means something to whatever wiring resolves it — this package never learns what
 * is behind it, and so cannot leak it.
 *
 * The constructor actively refuses values that LOOK like credentials or URLs. That check exists
 * because the failure it prevents is silent: a config carrying a key would be committed, digested
 * into a run manifest, and copied into every artifact that cites the run.
 */
import { z } from 'zod';

import { RiyaSyntheticGenerationError } from './errors.js';

/** The five roles a configuration may be permitted to serve. */
export const RIYA_SYNTHETIC_ROLES = [
  'SCENARIO_PLANNER',
  'CUSTOMER_SIMULATOR',
  'RIYA_TEACHER',
  'ANNOTATION_VERIFIER',
  'CRITIC',
] as const;
export type RiyaSyntheticRole = (typeof RIYA_SYNTHETIC_ROLES)[number];

export interface RiyaSyntheticModelConfigV1 {
  readonly version: 1;
  readonly configRef: string;
  /** Opaque family handles. `openai`/`anthropic` are values a caller supplies, not names in code. */
  readonly providerFamilyRef: string;
  readonly modelFamilyRef: string;
  readonly modelRef: string;
  /** An opaque handle to whatever wiring resolves transport. Never a URL. */
  readonly adapterRef: string;
  readonly allowedRoles: readonly RiyaSyntheticRole[];
  readonly instructionRef: string;
  readonly instructionSha256: string;
  readonly outputSchemaVersion: number;
  readonly maxOutputTokens: number;
  readonly samplingPolicyRef: string;
  readonly retryPolicyRef: string;
  /** A config present in the inventory but switched off is still auditable. */
  readonly activeForGeneration: boolean;
}

export type RiyaSyntheticModelConfigInput = Omit<RiyaSyntheticModelConfigV1, 'version'> & {
  readonly version?: 1;
};

const REF = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9._:-]+$/);

const SHA256_HEX = /^[0-9a-f]{64}$/;

/**
 * Shapes that must never appear in a configuration value.
 *
 * Deliberately blunt. A false positive costs somebody a rename; a false negative commits a
 * credential to a repository and digests it into every artifact that cites the run.
 */
const CREDENTIAL_SHAPES: readonly RegExp[] = Object.freeze([
  /^https?:\/\//iu,
  /\bsk-[A-Za-z0-9_-]{8,}/u,
  /\bBearer\s+/iu,
  /\bapi[_-]?key\b/iu,
  /\bsecret\b/iu,
  /\btoken\b/iu,
  /\beyJ[A-Za-z0-9_-]{8,}/u,
]);

const configSchema = z
  .object({
    version: z.literal(1).optional(),
    configRef: REF,
    providerFamilyRef: REF,
    modelFamilyRef: REF,
    modelRef: REF,
    adapterRef: REF,
    allowedRoles: z.array(z.enum(RIYA_SYNTHETIC_ROLES)).min(1).max(RIYA_SYNTHETIC_ROLES.length),
    instructionRef: REF,
    instructionSha256: z.string().regex(SHA256_HEX),
    outputSchemaVersion: z.int().min(1).max(1_000_000),
    maxOutputTokens: z.int().min(1).max(200_000),
    samplingPolicyRef: REF,
    retryPolicyRef: REF,
    activeForGeneration: z.boolean(),
  })
  .strict();

/** Validate and freeze a model configuration. Throws `invalid-model-config`. */
export function createRiyaSyntheticModelConfig(
  input: RiyaSyntheticModelConfigInput,
): RiyaSyntheticModelConfigV1 {
  const parsed = configSchema.safeParse(input);
  if (!parsed.success) {
    throw new RiyaSyntheticGenerationError('invalid-model-config');
  }
  const data = parsed.data;

  const roles = data.allowedRoles;
  if (new Set(roles).size !== roles.length) {
    throw new RiyaSyntheticGenerationError('invalid-model-config');
  }

  // The credential screen. `REF` already forbids `/` and whitespace, so a URL or a bearer header
  // cannot survive it -- this is the second layer, and it is the one that survives a REF change.
  for (const value of [
    data.configRef,
    data.providerFamilyRef,
    data.modelFamilyRef,
    data.modelRef,
    data.adapterRef,
    data.instructionRef,
    data.samplingPolicyRef,
    data.retryPolicyRef,
  ]) {
    if (CREDENTIAL_SHAPES.some((shape) => shape.test(value))) {
      throw new RiyaSyntheticGenerationError('invalid-model-config');
    }
  }

  return Object.freeze({
    version: 1 as const,
    configRef: data.configRef,
    providerFamilyRef: data.providerFamilyRef,
    modelFamilyRef: data.modelFamilyRef,
    modelRef: data.modelRef,
    adapterRef: data.adapterRef,
    allowedRoles: Object.freeze([...roles].sort()),
    instructionRef: data.instructionRef,
    instructionSha256: data.instructionSha256,
    outputSchemaVersion: data.outputSchemaVersion,
    maxOutputTokens: data.maxOutputTokens,
    samplingPolicyRef: data.samplingPolicyRef,
    retryPolicyRef: data.retryPolicyRef,
    activeForGeneration: data.activeForGeneration,
  });
}

export interface RiyaSyntheticConfigInventoryV1 {
  readonly version: 1;
  readonly inventoryRef: string;
  readonly configs: readonly RiyaSyntheticModelConfigV1[];
}

export interface RiyaSyntheticConfigInventoryInput {
  readonly inventoryRef: string;
  readonly configs: readonly RiyaSyntheticModelConfigInput[];
}

/** Validate and freeze an inventory. Throws `invalid-config-inventory`. */
export function createRiyaSyntheticConfigInventory(
  input: RiyaSyntheticConfigInventoryInput,
): RiyaSyntheticConfigInventoryV1 {
  const refParsed = REF.safeParse(input.inventoryRef);
  if (!refParsed.success || input.configs.length === 0 || input.configs.length > 64) {
    throw new RiyaSyntheticGenerationError('invalid-config-inventory');
  }
  // DEEP re-proof of every entry, through the constructor that owns its shape.
  const configs = input.configs.map((config) => createRiyaSyntheticModelConfig(config));
  const refs = configs.map((config) => config.configRef);
  if (new Set(refs).size !== refs.length) {
    throw new RiyaSyntheticGenerationError('invalid-config-inventory');
  }
  return Object.freeze({
    version: 1 as const,
    inventoryRef: refParsed.data,
    // Sorted by ref, so the inventory digest does not depend on declaration order.
    configs: Object.freeze(
      [...configs].sort((a, b) =>
        a.configRef < b.configRef ? -1 : a.configRef > b.configRef ? 1 : 0,
      ),
    ),
  });
}

/** Look one up, or throw `invalid-model-config`. The inventory is the only source of family. */
export function configFor(
  inventory: RiyaSyntheticConfigInventoryV1,
  configRef: string,
): RiyaSyntheticModelConfigV1 {
  const config = inventory.configs.find((one) => one.configRef === configRef);
  if (config === undefined) {
    throw new RiyaSyntheticGenerationError('invalid-model-config');
  }
  return config;
}

/** May this configuration serve this role, and is it switched on? */
export function configServesRole(
  config: RiyaSyntheticModelConfigV1,
  role: RiyaSyntheticRole,
): boolean {
  return config.activeForGeneration && config.allowedRoles.includes(role);
}
