/**
 * Deterministic smoke-harness fakes (QFJ-S1A, ADR-0061 §J).
 *
 * Shipped ONLY under `./testing` so they can never become a production default. Everything is synthetic:
 * an OBVIOUS fake sentinel credential (never a real key), a scripted terminal that touches no real
 * terminal and no real echo state, a manual timer that fires only when a test says so, and a valid
 * non-secret configuration document. No environment read, no secret store, no filesystem, no network.
 */
import type { MaskedSecretSource } from '../masked-tty-credential-resolver.js';
import type { SmokeTimer } from '../run-once.js';
import {
  SMOKE_PROMPT_FAMILY,
  SMOKE_PROMPT_VERSION,
  SMOKE_SCHEMA_REVISION,
} from '../synthetic-prompt.js';

/** An OBVIOUS fake sentinel — never a real Groq credential. Long enough to pass the bounded check. */
export const FAKE_SMOKE_SENTINEL_CREDENTIAL = 'FAKE-STAGING-SENTINEL-DO-NOT-USE-0000';

/** A scripted terminal. Records interactivity checks and reads; never touches a real terminal. */
export interface ScriptedSecretSource extends MaskedSecretSource {
  readonly interactiveChecks: () => number;
  readonly reads: () => number;
  readonly lastLabel: () => string | undefined;
}

/**
 * Build a scripted terminal.
 *
 * `interactive: false` models a piped/redirected stdin, and asserts the harness refuses BEFORE reading.
 * `value: null` models an aborted read (Ctrl-C).
 */
export function scriptedSecretSource(
  options: { readonly interactive?: boolean; readonly value?: string | null } = {},
): ScriptedSecretSource {
  const interactive = options.interactive ?? true;
  const value = options.value === undefined ? FAKE_SMOKE_SENTINEL_CREDENTIAL : options.value;
  const state = { interactiveChecks: 0, reads: 0, lastLabel: undefined as string | undefined };

  return Object.freeze({
    isInteractive(): boolean {
      state.interactiveChecks += 1;
      return interactive;
    },
    readOnce(label: string): Promise<string> {
      state.reads += 1;
      state.lastLabel = label;
      if (value === null) {
        return Promise.reject(new Error('SYNTHETIC-SECRET-READ-ABORTED'));
      }
      return Promise.resolve(value);
    },
    interactiveChecks: () => state.interactiveChecks,
    reads: () => state.reads,
    lastLabel: () => state.lastLabel,
  });
}

/** A timer a test drives by hand. Records arming/cancelling and never schedules real work. */
export interface ManualSmokeTimer extends SmokeTimer {
  readonly armed: () => number;
  readonly cancelled: () => number;
  readonly armedMs: () => number | undefined;
  /** Fire the currently armed timer, as the real one would on expiry. */
  readonly fire: () => void;
}

export function manualSmokeTimer(): ManualSmokeTimer {
  const state: {
    armed: number;
    cancelled: number;
    ms: number | undefined;
    onFire: (() => void) | undefined;
  } = { armed: 0, cancelled: 0, ms: undefined, onFire: undefined };

  return Object.freeze({
    arm(ms: number, onFire: () => void): () => void {
      state.armed += 1;
      state.ms = ms;
      state.onFire = onFire;
      return () => {
        state.cancelled += 1;
        state.onFire = undefined;
      };
    },
    armed: () => state.armed,
    cancelled: () => state.cancelled,
    armedMs: () => state.ms,
    fire: () => {
      state.onFire?.();
    },
  });
}

/** A valid, NON-SECRET configuration document. Override any field to build a rejection case. */
export function syntheticSmokeConfigInput(
  over: Readonly<Record<string, unknown>> = {},
): Record<string, unknown> {
  return {
    credentialReference: 'groq.staging.secret.v1',
    release: {
      releaseId: 'rel.groq.staging.1',
      providerId: 'groq.staging',
      modelId: 'llama-3.1-8b-instant',
      modelVersion: '2025-07',
      executionClass: 'HOSTED',
      configDigest: 'cfg-groq-0001',
    },
    dataClass: 'HOSTED_ALLOWED',
    maxInputTokens: 8192,
    maxCompletionTokens: 256,
    supportsStrictJsonSchema: true,
    capabilityProfileRef: 'cap.groq.reply.v1',
    evaluationRef: 'evref-groq-0001',
    dataControlsAttestationRef: 'zdr.groq.staging.0001',
    dataControlsAttested: true,
    promptFamily: SMOKE_PROMPT_FAMILY,
    promptVersion: SMOKE_PROMPT_VERSION,
    schemaRevision: SMOKE_SCHEMA_REVISION,
    timeoutMs: 30_000,
    ...over,
  };
}

/** A canned Groq Chat Completions body carrying the expected tiny probe object. */
export function smokeProbeResponseBody(
  value: unknown = { probe: 'ok' },
  model = 'llama-3.1-8b-instant',
): string {
  return JSON.stringify({
    id: 'chatcmpl-fake-smoke',
    model,
    choices: [
      {
        index: 0,
        message: { role: 'assistant', content: JSON.stringify(value) },
        finish_reason: 'stop',
      },
    ],
    usage: { prompt_tokens: 11, completion_tokens: 5, total_tokens: 16 },
  });
}
