/**
 * The double opt-in and the credential boundary (AS3A, ADR-0143 §5, §13).
 *
 * ### Two independent switches, and a credential is neither of them
 *
 * A real call requires BOTH an explicit `--execute` flag AND the environment opt-in
 * `RIYA_AS3_ALLOW_REAL_CALLS=true`. Neither alone is enough, and — the important one — the mere
 * presence of `OPENAI_API_KEY` or `ANTHROPIC_API_KEY` is never enough either.
 *
 * That last rule is what keeps CI free. A machine with credentials in its environment is the normal
 * case, not the exception: a developer laptop, a shell that sourced a dotenv, a runner with secrets
 * attached to an unrelated job. If a present key could arm the network path, then "does this test
 * spend money" would depend on whose machine ran it. It cannot, because credentials are read only
 * AFTER authorization has already been decided, and the decision does not look at them.
 *
 * The two switches are deliberately of different kinds. A flag is what somebody typed; an environment
 * variable is what the machine was configured to allow. A slip in one place is not a spend.
 *
 * ### Presence, never value
 *
 * A credential is reported as a boolean and nothing else. Not the value, not a prefix, not a length,
 * not a digest — a length narrows a key and a digest is a confirmation oracle. It is read at the
 * moment a client is constructed and never stored, logged, serialized or attached to an error.
 */
import { RiyaSyntheticPilotError } from '../contracts/pilot-errors.js';

export const RIYA_AS3_EXECUTE_ENV = 'RIYA_AS3_ALLOW_REAL_CALLS';
export const OPENAI_CREDENTIAL_ENV = 'OPENAI_API_KEY';
export const ANTHROPIC_CREDENTIAL_ENV = 'ANTHROPIC_API_KEY';

export const RIYA_SYNTHETIC_EXECUTION_MODES = ['DRY_RUN', 'EXECUTE'] as const;
export type RiyaSyntheticExecutionMode = (typeof RIYA_SYNTHETIC_EXECUTION_MODES)[number];

/** A readonly view of the environment. Injected, so a spec never mutates the real one. */
export type RiyaSyntheticEnvironment = Readonly<Record<string, string | undefined>>;

export interface ResolveExecutionModeInput {
  /** The `--execute` flag, as typed. */
  readonly executeFlagPresent: boolean;
  readonly environment: RiyaSyntheticEnvironment;
}

/**
 * Decide DRY_RUN or EXECUTE.
 *
 * Defaults to DRY_RUN, and the environment value must be exactly `'true'` — not `'1'`, not `'yes'`,
 * not `'TRUE'`. A permissive parse here would let a value somebody set for something else arm a
 * spend, and there is no reader of this variable for whom being strict is inconvenient.
 *
 * This function never reads a credential. That is the property the whole guard rests on.
 */
export function resolveRiyaSyntheticExecutionMode(
  input: ResolveExecutionModeInput,
): RiyaSyntheticExecutionMode {
  const optedIn = input.environment[RIYA_AS3_EXECUTE_ENV] === 'true';
  return input.executeFlagPresent && optedIn ? 'EXECUTE' : 'DRY_RUN';
}

/** What preflight may say about credentials. Booleans, and nothing derived from a value. */
export interface RiyaSyntheticCredentialPresenceV1 {
  readonly openaiCredentialPresent: boolean;
  readonly anthropicCredentialPresent: boolean;
}

/** A credential counts as present when it is a non-empty, non-whitespace string. */
function present(value: string | undefined): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

export function riyaSyntheticCredentialPresence(
  environment: RiyaSyntheticEnvironment,
): RiyaSyntheticCredentialPresenceV1 {
  return Object.freeze({
    openaiCredentialPresent: present(environment[OPENAI_CREDENTIAL_ENV]),
    anthropicCredentialPresent: present(environment[ANTHROPIC_CREDENTIAL_ENV]),
  });
}

/**
 * Read a credential for client construction. Throws `missing-provider-credential`.
 *
 * The only function in this package that returns a secret value, and it returns it to exactly one
 * caller: the line that constructs an SDK client. The error carries the closed code and never the
 * variable's contents.
 */
export function readRiyaSyntheticProviderCredential(
  environment: RiyaSyntheticEnvironment,
  variable: typeof OPENAI_CREDENTIAL_ENV | typeof ANTHROPIC_CREDENTIAL_ENV,
): string {
  const value = environment[variable];
  if (!present(value) || value === undefined) {
    throw new RiyaSyntheticPilotError('missing-provider-credential');
  }
  return value;
}

/** Configured model identity, from the environment, with a documented default. Never a secret. */
export const RIYA_AS3_OPENAI_MODEL_ENV = 'RIYA_AS3_OPENAI_MODEL';
export const RIYA_AS3_CLAUDE_MODEL_ENV = 'RIYA_AS3_CLAUDE_MODEL';
