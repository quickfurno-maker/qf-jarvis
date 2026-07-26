/**
 * Shared, deterministic test support for the QFJ-S1A smoke suite.
 *
 * It lives under `src/tests/` (not `src/testing/`) so it is EXCLUDED from the emitting build and can
 * never reach `dist/`. It composes only the shipped fakes: a scripted terminal, a manual timer, a
 * deterministic transport, and a manual clock. No real terminal, no environment, no filesystem, no
 * network, no real credential.
 */
import {
  createManualClock,
  GROQ_CHAT_COMPLETIONS_ENDPOINT,
  type GroqTransport,
} from '@qf-jarvis/model-gateway';
import { fakeGroqTransport } from '@qf-jarvis/model-gateway/testing';

import {
  parseSmokeConfig,
  runGroqStagingSmokeOnce,
  type SmokeConfig,
  type SmokeRunResult,
  type SmokeTimer,
} from '../index.js';
import {
  manualSmokeTimer,
  scriptedSecretSource,
  smokeProbeResponseBody,
  syntheticSmokeConfigInput,
  type ScriptedSecretSource,
} from '../testing/index.js';

/** Re-exported so a spec can assert the endpoint without importing the gateway barrel itself. */
export const GROQ_CHAT_COMPLETIONS_ENDPOINT_FOR_TEST = GROQ_CHAT_COMPLETIONS_ENDPOINT;

/** Parse the synthetic fixture into a validated config, failing loudly if the fixture ever drifts. */
export function validConfig(over: Readonly<Record<string, unknown>> = {}): SmokeConfig {
  const parsed = parseSmokeConfig(syntheticSmokeConfigInput(over));
  if (!parsed.ok) {
    throw new Error('the synthetic smoke fixture must be valid');
  }
  return parsed.config;
}

/** Run the harness with deterministic defaults; override any single seam per test. */
export function runOnce(options: {
  readonly transport?: GroqTransport;
  readonly source?: ScriptedSecretSource;
  readonly timer?: SmokeTimer;
  readonly config?: SmokeConfig;
}): Promise<SmokeRunResult> {
  return runGroqStagingSmokeOnce(options.config ?? validConfig(), {
    transport: options.transport ?? fakeGroqTransport(smokeProbeResponseBody()),
    credentialSource: options.source ?? scriptedSecretSource(),
    clock: createManualClock(),
    timer: options.timer ?? manualSmokeTimer(),
  });
}
