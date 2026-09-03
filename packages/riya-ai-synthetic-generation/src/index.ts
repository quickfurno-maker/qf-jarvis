/**
 * `@qf-jarvis/riya-ai-synthetic-generation` — the offline generation harness (AS2, ADR-0143).
 *
 * ### OFFLINE, and unreachable from anything that serves a customer
 *
 * No app, runtime, WhatsApp path or model-gateway composition may import this package, and a
 * containment spec proves it. A serving path that could reach the generator is a path by which a live
 * conversation could become training data, and the direction has to be one-way as a fact rather than
 * as an intention.
 *
 * ### What is here
 *
 * A provider-independent invocation port, a content-free config inventory that is the authority on
 * model family, versioned role-instruction identities, invocation envelopes, a deterministic scenario
 * scheduler, deterministic fake adapters, and turn-by-turn candidate orchestration that ends in AS1's
 * own acceptance artifacts.
 *
 * ### What is NOT here
 *
 * No OpenAI or Anthropic network code, no credential, no base URL — GPT and Claude are configuration,
 * not dependency, and CI makes zero provider calls. No corpus: this slice generates candidates in
 * specs and commits none. No training of any kind. No second acceptance implementation — AS1's
 * validator is reused, and a candidate that clears it does so under the same gate every other row
 * faces.
 */

// Errors.
export {
  RIYA_SYNTHETIC_GENERATION_ERROR_CODES,
  RiyaSyntheticGenerationError,
} from './contracts/errors.js';
export type { RiyaSyntheticGenerationErrorCode } from './contracts/errors.js';

// The configuration inventory: the authority on model family.
export {
  RIYA_SYNTHETIC_ROLES,
  configFor,
  configServesRole,
  createRiyaSyntheticConfigInventory,
  createRiyaSyntheticModelConfig,
} from './contracts/model-config.js';
export type {
  RiyaSyntheticRole,
  RiyaSyntheticModelConfigV1,
  RiyaSyntheticModelConfigInput,
  RiyaSyntheticConfigInventoryV1,
  RiyaSyntheticConfigInventoryInput,
} from './contracts/model-config.js';

// Role instruction identity.
export {
  RIYA_SYNTHETIC_INSTRUCTION_PROHIBITIONS,
  createRiyaSyntheticRoleInstruction,
} from './contracts/role-instruction.js';
export type {
  RiyaSyntheticInstructionProhibition,
  RiyaSyntheticRoleInstructionV1,
  RiyaSyntheticRoleInstructionInput,
} from './contracts/role-instruction.js';

// Invocation envelopes.
export {
  RIYA_SYNTHETIC_ERROR_CLASSES,
  RIYA_SYNTHETIC_INVOCATION_STATUSES,
  createRiyaSyntheticInvocationRequest,
  createRiyaSyntheticInvocationResult,
} from './contracts/invocation.js';
export type {
  RiyaSyntheticErrorClass,
  RiyaSyntheticInvocationStatus,
  RiyaSyntheticInvocationRequestV1,
  RiyaSyntheticInvocationRequestInput,
  RiyaSyntheticInvocationResultV1,
  RiyaSyntheticInvocationResultInput,
  RiyaSyntheticUsageV1,
} from './contracts/invocation.js';

// The port.
export type {
  RiyaSyntheticModelInvoker,
  RiyaSyntheticInvocationOptions,
  RiyaSyntheticInvocationOutcome,
} from './ports/model-invoker.js';

// Policy.
export { createRiyaSyntheticGenerationPolicy } from './contracts/policy.js';
export type {
  RiyaSyntheticGenerationPolicyV1,
  RiyaSyntheticGenerationPolicyInput,
} from './contracts/policy.js';

// Role allocation and the cross-family lock.
export {
  createRiyaSyntheticRoleAllocation,
  resolveRiyaSyntheticRoleAllocation,
} from './contracts/role-allocation.js';
export type {
  RiyaSyntheticRoleAllocationV1,
  RiyaSyntheticRoleAllocationInput,
} from './contracts/role-allocation.js';

// What each role may see, and what each may return.
export type {
  RiyaSyntheticVisibleTurn,
  RiyaSyntheticCustomerSimulatorInput,
  RiyaSyntheticTeacherInput,
  RiyaSyntheticVerifierInput,
  RiyaSyntheticCriticInput,
} from './contracts/role-input.js';
export {
  RIYA_SYNTHETIC_MAX_PAYLOAD_CHARS,
  parseRiyaSyntheticModelOutput,
} from './contracts/model-output.js';
export type {
  RiyaSyntheticCustomerTurnOutput,
  RiyaSyntheticTeacherTurnOutput,
  RiyaSyntheticVerifierOutput,
  RiyaSyntheticCriticOutput,
} from './contracts/model-output.js';

// The deterministic scheduler.
export {
  createRiyaSyntheticRunPlan,
  riyaSyntheticRunPlanSha256,
  scheduleRiyaSyntheticScenarios,
} from './service/scenario-scheduler.js';
export type {
  RiyaSyntheticRunPlanV1,
  RiyaSyntheticRunPlanInput,
} from './service/scenario-scheduler.js';

// Candidate orchestration.
export { generateRiyaSyntheticCandidate } from './service/generate-candidate.js';
export type {
  GenerateRiyaSyntheticCandidateOptions,
  RiyaSyntheticCandidateV1,
  RiyaSyntheticInvokerRegistry,
} from './service/generate-candidate.js';

// Deterministic fakes. The reference implementation of the port, and what CI runs against.
export {
  createFakeClaudeInvoker,
  createFakeGptInvoker,
  createRiyaSyntheticFakeInvoker,
} from './adapters/fake-invoker.js';
export type { RiyaSyntheticFakeInvokerOptions } from './adapters/fake-invoker.js';
