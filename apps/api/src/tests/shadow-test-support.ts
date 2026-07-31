/**
 * Deterministic offline fixtures for the QFJ-S2-E-B shadow specs.
 *
 * Every provider, transport and credential here is a fake with an unmistakably synthetic value. Nothing
 * touches the network, a real credential, a database or a container. Not a spec file, so vitest does not
 * collect it.
 */
import { contentDigest } from '@qf-jarvis/model-evaluation';
import type { ApprovalEvidence } from '@qf-jarvis/model-evaluation';
import type {
  GroqTransport,
  ModelProvider,
  ProviderInvocationInput,
  ProviderInvocationResult,
  ProviderReleaseRef,
} from '@qf-jarvis/model-gateway';
import { defineProviderCapabilities } from '@qf-jarvis/model-gateway';

import type { CredentialFileReader } from '../secrets/credential-file-reader.js';
import { generateShadowEvidence } from '../shadow/shadow-evidence-generator.js';
import type { ShadowJsonReader } from '../shadow/shadow-json-reader.js';
import { SHADOW_PROMPT_ID } from '../shadow/shadow-request.js';
import {
  canonicalConfigPayload,
  validateShadowRunConfig,
  type ShadowRunConfig,
} from '../shadow/shadow-run-config.js';

/** An unmistakable fake credential. It satisfies the local validator and nothing else. */
export const FAKE_CREDENTIAL = 'FAKE_QFJ_CREDENTIAL_DO_NOT_USE_S2EB';

/** Unique sentinels: if either ever appears in a surface, output disposal is broken. */
export const STABLE_SENTINEL = 'ZZSTABLESENTINEL0001';
export const CANDIDATE_SENTINEL = 'ZZCANDIDATESENTINEL0002';

export const MODEL_ID = 'synthetic/qfj-shadow-probe';
export const MODEL_VERSION = 'synthetic-catalog-2026-07-30';

/** A complete, valid non-secret run configuration built entirely from synthetic identities. */
export function rawShadowConfig(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: 1,
    ownerAuthorizationRef: 'auth.qfj.s2e.synthetic.v1',
    runId: 'run.qfj.s2e.shadow.1',
    rolloutId: 'roll.qfj.s2e.shadow',
    credentialReference: 'groq.qfj.shadow.synthetic.v1',
    stable: {
      providerId: 'groq.shadow.stable',
      releaseId: 'rel.qfj.s2e.stable.v1',
      configDigest: '0aaaaaaaaa0000000000000000000001',
    },
    candidate: {
      providerId: 'groq.shadow.candidate',
      releaseId: 'rel.qfj.s2e.candidate.v1',
      configDigest: '0bbbbbbbbb0000000000000000000002',
    },
    modelId: MODEL_ID,
    modelVersion: MODEL_VERSION,
    capabilityProfileRef: 'cap.qfj.s2e.shadow.strict-json.v1',
    dataControlsAttestationRef: 'att.qfj.s2e.shadow.zdr.v1',
    executionClass: 'HOSTED',
    dataClass: 'HOSTED_ALLOWED',
    agentScope: 'SYSTEM',
    promptId: SHADOW_PROMPT_ID,
    evidenceRef: 'evref-placeholder',
    evidenceDigest: '0cccccccccc000000000000000000003',
    maxInputTokens: 4096,
    maxCompletionTokens: 256,
    timeoutMs: 5_000,
    attestations: {
      zdrEnabled: true,
      modelPermissionScoped: true,
      syntheticPromptConfirmed: true,
      outputDiscardConfirmed: true,
      oneShotAuthorizationConfirmed: true,
    },
    ...over,
  };
}

/** Validate a raw config, throwing if the fixture itself is wrong. */
export function shadowConfig(over: Record<string, unknown> = {}): ShadowRunConfig {
  const result = validateShadowRunConfig(rawShadowConfig(over), {
    expectedPromptId: SHADOW_PROMPT_ID,
    digest: contentDigest,
  });
  if (!result.ok) {
    throw new Error(`the shadow fixture config must be valid (refused: ${result.reason})`);
  }
  return result.config;
}

/** The digest an operator would pin for a config. */
export function configDigestOf(config: ShadowRunConfig): string {
  return contentDigest(canonicalConfigPayload(config));
}

/** The narrowed success shape of the generator: a spec that got here knows generation succeeded. */
export interface GeneratedShadowEvidence {
  readonly evidence: ApprovalEvidence;
  readonly digest: string;
}

/**
 * A config plus matching generated evidence, with `evidenceRef`/`evidenceDigest` reconciled.
 *
 * Generated through `createApprovalEvidence`, never hand-written — the whole point of the generator.
 */
export function shadowConfigWithEvidence(over: Record<string, unknown> = {}): {
  readonly config: ShadowRunConfig;
  readonly evidence: GeneratedShadowEvidence;
} {
  const seed = shadowConfig(over);
  const generated = generateShadowEvidence(seed);
  if (!generated.ok) {
    throw new Error(`the fixture evidence must generate (refused: ${generated.reason})`);
  }
  const config = shadowConfig({
    ...over,
    evidenceRef: generated.evidence.evaluationRef,
    evidenceDigest: generated.digest,
  });
  return { config, evidence: { evidence: generated.evidence, digest: generated.digest } };
}

/** A JSON reader that returns a fixed parsed value. */
export function jsonReaderFor(value: unknown): ShadowJsonReader {
  return { read: () => Promise.resolve({ ok: true as const, value }) };
}

/** A JSON reader that always refuses. */
export function failingJsonReader(): ShadowJsonReader {
  return { read: () => Promise.resolve({ ok: false as const, failure: 'unreadable' as const }) };
}

/** A credential reader returning the synthetic fake, counting reads. */
export function fakeCredentialReader(
  text: string = FAKE_CREDENTIAL,
): CredentialFileReader & { readonly reads: () => number } {
  const state = { n: 0 };
  return {
    read: () => {
      state.n += 1;
      return Promise.resolve({ ok: true as const, text });
    },
    reads: () => state.n,
  };
}

/** A credential reader that always fails. */
export function missingCredentialReader(): CredentialFileReader {
  return {
    read: () => Promise.resolve({ ok: false as const, code: 'credential-not-found' as const }),
  };
}

/** A transport that must never be reached; reaching it fails the spec loudly. */
export function unreachableTransport(): GroqTransport {
  return {
    send: () => Promise.reject(new Error('QFJ_TEST_TRANSPORT_MUST_NOT_BE_REACHED')),
  };
}

/**
 * A transport that RESOLVES a synthetic response without performing any I/O.
 *
 * Used to reproduce the "the server answered" half of the QFJ-S2-E-C-R1 split: an HTTP 5xx is a
 * delivered response, so the leg must classify as `server-unavailable` rather than `transport-error`.
 */
export function respondingTransport(): GroqTransport {
  return {
    send: () => Promise.resolve({ status: 503, retryAfterSeconds: null, bodyText: '' }),
  };
}

/**
 * A transport that REJECTS, standing in for a DNS/connect/TLS/socket failure.
 *
 * The rejection value is deliberately opaque: the wrapper records only that a rejection happened.
 */
export function rejectingTransport(): GroqTransport {
  return {
    send: () => Promise.reject(new Error('QFJ_TEST_SYNTHETIC_TRANSPORT_REJECTION')),
  };
}

/** A scripted provider outcome per leg. */
export interface LegScript {
  readonly result: ProviderInvocationResult;
}

/**
 * A fake provider for one leg, embedding a leg-specific sentinel in its structured output so a spec can
 * prove the sentinel never escapes.
 */
export function fakeLegProvider(args: {
  readonly release: ProviderReleaseRef;
  readonly script: LegScript;
  readonly onInvoke?: () => void;
  /**
   * When supplied, the fake calls this transport before returning its scripted result, exactly as the
   * real Groq adapter does. That is what lets a spec drive the `responded` / `rejected` distinction.
   */
  readonly transport?: GroqTransport;
}): ModelProvider {
  const capabilities = defineProviderCapabilities({
    providerId: args.release.providerId,
    modelId: args.release.modelId,
    modelVersion: args.release.modelVersion,
    executionClass: 'HOSTED',
    supportsStructuredOutput: true,
    supportsStrictJsonSchema: true,
    maxInputTokens: 4096,
    supportsTimeout: true,
    supportsCancellation: true,
    supportsNonStreaming: true,
    supportsStreaming: false,
  });
  return {
    descriptor: { providerId: args.release.providerId, executionClass: 'HOSTED' },
    capabilities: () => capabilities,
    health: () => Promise.resolve({ available: true }),
    invoke: async (input: ProviderInvocationInput): Promise<ProviderInvocationResult> => {
      args.onInvoke?.();
      if (args.transport !== undefined) {
        try {
          await args.transport.send(
            { url: 'https://example.invalid/never-fetched', headers: {}, body: '{}' },
            input.signal,
          );
        } catch {
          // The adapter collapses a transport rejection into `unavailable`; the scripted result stands
          // in for whatever the adapter would have returned.
        }
      }
      return args.script.result;
    },
  };
}

/** A completed STRUCTURED result whose value satisfies the strict shadow schema. */
export function completedOk(latencyMs = 12): ProviderInvocationResult {
  return {
    status: 'completed',
    output: { mode: 'STRUCTURED', value: { status: 'ok' } },
    usage: { inputTokens: 11, outputTokens: 3 },
    latencyMs,
  };
}

/**
 * A completed STRUCTURED result carrying an EXTRA sentinel field.
 *
 * The strict schema rejects unknown keys, so this doubles as the malformed-output case — and either way
 * the sentinel must never appear in any surface.
 */
export function completedWithSentinel(sentinel: string, latencyMs = 12): ProviderInvocationResult {
  return {
    status: 'completed',
    output: { mode: 'STRUCTURED', value: { status: 'ok', probe: sentinel } },
    usage: { inputTokens: 11, outputTokens: 3 },
    latencyMs,
  };
}
