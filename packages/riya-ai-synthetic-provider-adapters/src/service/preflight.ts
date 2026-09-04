/**
 * Real-provider preflight (AS3A, ADR-0143 §11).
 *
 * ### Everything that can be wrong is found before the first paid call
 *
 * A misconfiguration discovered on candidate forty has already been paid for thirty-nine times, and
 * the tokens are not refundable. So every check that can be made without a network is made here:
 * contracts re-proved, schema refs resolved, instruction digests matched, cross-family critique
 * resolved, generation identities proved unique, and every config mapped to an adapter that actually
 * exists.
 *
 * ### It reports credential PRESENCE and nothing else
 *
 * Two booleans. Not a value, not a prefix, not a length — a length narrows a key — and not a digest,
 * which is a confirmation oracle. Preflight also never reads a credential it does not need: a run
 * whose configs are all Anthropic does not require an OpenAI key, and demanding one would train
 * people to put keys where they are not used.
 *
 * ### A configured model that is unavailable FAILS here
 *
 * There is no substitution, no nearest match and no fallback family. A run that silently switched
 * model would produce a corpus whose provenance says something untrue, and provenance that is
 * sometimes untrue is provenance nobody can rely on. Preflight resolves the exact `modelRef` a config
 * names; whether that model answers is settled by the first real call, which fails closed.
 */
import {
  configFor,
  createRiyaSyntheticRoleAllocation,
  resolveRiyaSyntheticRoleAllocation,
  scheduleRiyaSyntheticScenarios,
} from '@qf-jarvis/riya-ai-synthetic-generation';
import type {
  RiyaSyntheticModelConfigV1,
  RiyaSyntheticRole,
  RiyaSyntheticRunItem,
} from '@qf-jarvis/riya-ai-synthetic-generation';

import { RiyaSyntheticPilotError } from '../contracts/pilot-errors.js';
import type { RiyaSyntheticPilotPlanV1 } from '../contracts/pilot-plan.js';
import { RIYA_SYNTHETIC_INSTRUCTION_INVENTORY } from '../prompts/instruction-inventory.js';
import {
  RIYA_SYNTHETIC_SUPPORTED_OUTPUT_SCHEMA_REFS,
  riyaSyntheticOutputSchemaRef,
} from '../prompts/output-schemas.js';
import { riyaSyntheticCredentialPresence } from './execution-guard.js';
import type {
  RiyaSyntheticCredentialPresenceV1,
  RiyaSyntheticEnvironment,
} from './execution-guard.js';

/** The two provider family handles this package can serve. Configuration values, not model names. */
export const RIYA_AS3_OPENAI_FAMILY_REF = 'openai';
export const RIYA_AS3_ANTHROPIC_FAMILY_REF = 'anthropic';

/** One config, reduced to what a sanitized summary may show. No adapter handle, no credential. */
export interface RiyaSyntheticPreflightConfigV1 {
  readonly configRef: string;
  readonly providerFamilyRef: string;
  readonly modelFamilyRef: string;
  readonly modelRef: string;
  readonly roles: readonly RiyaSyntheticRole[];
  readonly instructionRef: string;
}

export interface RiyaSyntheticPreflightResultV1 {
  readonly planRef: string;
  readonly scheduledScenarios: number;
  /** After the candidate ceiling is applied. What the run will actually attempt. */
  readonly plannedCandidates: number;
  readonly configs: readonly RiyaSyntheticPreflightConfigV1[];
  /** configRef to modelRef, per family. What each adapter is wired with. */
  readonly openaiModels: ReadonlyMap<string, string>;
  readonly anthropicModels: ReadonlyMap<string, string>;
  readonly requiresOpenaiCredential: boolean;
  readonly requiresAnthropicCredential: boolean;
  readonly credentials: RiyaSyntheticCredentialPresenceV1;
  readonly items: readonly RiyaSyntheticRunItem[];
}

export interface RiyaSyntheticPreflightInput {
  readonly plan: RiyaSyntheticPilotPlanV1;
  readonly environment: RiyaSyntheticEnvironment;
}

const reject = (): never => {
  throw new RiyaSyntheticPilotError('preflight-rejected');
};

/**
 * Prove a config's instruction identity is one this package actually serves.
 *
 * The config pins an `instructionRef` and an `instructionSha256`. Both must match an entry in the
 * inventory, and that entry's role must be one the config is allowed to serve. A config that pinned a
 * digest nobody holds would produce candidates attributed to text that does not exist here.
 */
function proveInstructionBinding(config: RiyaSyntheticModelConfigV1): void {
  const entry = RIYA_SYNTHETIC_INSTRUCTION_INVENTORY.find(
    (one) => one.identity.instructionRef === config.instructionRef,
  );
  if (entry === undefined) reject();
  if (entry?.identity.instructionSha256 !== config.instructionSha256) reject();
  if (entry !== undefined && !config.allowedRoles.includes(entry.identity.role)) reject();
}

/** Prove every role this config may serve has an output schema at the config's declared version. */
function proveOutputSchemas(config: RiyaSyntheticModelConfigV1): void {
  for (const role of config.allowedRoles) {
    // SCENARIO_PLANNER is never invoked -- the scheduler is deterministic -- so a config may list it
    // without this package needing to serve it.
    if (role === 'SCENARIO_PLANNER') continue;
    const ref = riyaSyntheticOutputSchemaRef(role, config.outputSchemaVersion);
    if (!RIYA_SYNTHETIC_SUPPORTED_OUTPUT_SCHEMA_REFS.includes(ref)) reject();
  }
}

/**
 * Deep-validate a pilot plan against this package's capabilities and the environment.
 *
 * Throws `preflight-rejected` on any violation, before a transport is constructed.
 */
export function preflightRiyaSyntheticPilot(
  input: RiyaSyntheticPreflightInput,
): RiyaSyntheticPreflightResultV1 {
  const { plan, environment } = input;

  const scenarios = scheduleRiyaSyntheticScenarios(plan.runPlan);
  if (scenarios.length === 0) reject();

  // The candidate ceiling binds the SCHEDULE, not just the run loop: a plan asking for four hundred
  // scenarios under a budget of six attempts six, and the summary says six.
  const plannedCandidates = Math.min(scenarios.length, plan.budget.maxCandidates);

  const openaiModels = new Map<string, string>();
  const anthropicModels = new Map<string, string>();
  const configs: RiyaSyntheticPreflightConfigV1[] = [];

  for (const config of plan.inventory.configs) {
    if (!config.activeForGeneration) {
      // Present in the inventory and switched off. Auditable, and not wired to an adapter.
      continue;
    }
    proveInstructionBinding(config);
    proveOutputSchemas(config);

    if (config.providerFamilyRef === RIYA_AS3_OPENAI_FAMILY_REF) {
      openaiModels.set(config.configRef, config.modelRef);
    } else if (config.providerFamilyRef === RIYA_AS3_ANTHROPIC_FAMILY_REF) {
      anthropicModels.set(config.configRef, config.modelRef);
    } else {
      // A family this package holds no adapter for. Failing is the only honest answer: quietly
      // skipping it would leave a role unserved and surface as a candidate failure much later.
      reject();
    }

    configs.push(
      Object.freeze({
        configRef: config.configRef,
        providerFamilyRef: config.providerFamilyRef,
        modelFamilyRef: config.modelFamilyRef,
        modelRef: config.modelRef,
        roles: config.allowedRoles,
        instructionRef: config.instructionRef,
      }),
    );
  }

  if (configs.length === 0) reject();

  // Build the run items: allocations cycle across the schedule, each with its own derived generation
  // identity. AS2 re-proves all of this again; doing it here is what makes a bad plan free.
  const items: RiyaSyntheticRunItem[] = [];
  for (let index = 0; index < plannedCandidates; index += 1) {
    const scenario = scenarios[index];
    const template = plan.allocations[index % plan.allocations.length];
    /* c8 ignore next 3 -- both indices are bounded by the loop and by a non-empty allocation list */
    if (scenario === undefined || template === undefined) {
      reject();
      continue;
    }
    const { version: _templateVersion, ...fields } = template;
    const allocation = createRiyaSyntheticRoleAllocation({
      ...fields,
      generationRef: `${template.generationRef}.s${String(index)}`,
    });

    // Cross-family critique, teacher-is-not-its-own-critic and every other allocation rule, resolved
    // through AS2's own function against the inventory that owns model family. Resolving it here
    // means a same-family critic set costs nothing instead of being discovered ten turns in.
    resolveRiyaSyntheticRoleAllocation(allocation, plan.inventory, plan.policy);

    // Every config an item names must be active and wired. `configFor` throws if it is not present.
    for (const ref of [
      allocation.customerSimulatorConfigRef,
      allocation.riyaTeacherConfigRef,
      allocation.annotationVerifierConfigRef,
      ...allocation.criticConfigRefs,
    ]) {
      const config = configFor(plan.inventory, ref);
      if (!config.activeForGeneration) reject();
      if (!openaiModels.has(ref) && !anthropicModels.has(ref)) reject();
    }

    items.push({ scenario, allocation });
  }

  const generationRefs = items.map((item) => item.allocation.generationRef);
  if (new Set(generationRefs).size !== generationRefs.length) reject();
  const scenarioRefs = items.map((item) => item.scenario.scenarioRef);
  if (new Set(scenarioRefs).size !== scenarioRefs.length) reject();

  // Only the families this run actually uses are required. Demanding an unused key teaches people to
  // put credentials where they are not needed.
  const requiresOpenaiCredential = openaiModels.size > 0;
  const requiresAnthropicCredential = anthropicModels.size > 0;

  return Object.freeze({
    planRef: plan.planRef,
    scheduledScenarios: scenarios.length,
    plannedCandidates,
    configs: Object.freeze(configs),
    openaiModels,
    anthropicModels,
    requiresOpenaiCredential,
    requiresAnthropicCredential,
    credentials: riyaSyntheticCredentialPresence(environment),
    items: Object.freeze(items),
  });
}
