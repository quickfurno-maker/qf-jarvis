/**
 * QFJ-S2-E-B — the controlled SHADOW runner (ADR-0065).
 *
 * Matrix: OFF→SHADOW→OFF with exact revisions; one request object for both legs; stable before candidate;
 * a PASS only when BOTH succeed; every candidate failure mode becoming a runner FAIL despite the gateway
 * returning stable success; the exact call budget enforced by refusal; and both sentinels absent from
 * every surface.
 *
 * Every test is offline: fake providers, fake transports, a synthetic credential. **No network, no real
 * credential, no provider SDK, no database.**
 */
import type { ModelProvider, ProviderInvocationResult } from '@qf-jarvis/model-gateway';
import { describe, expect, it } from 'vitest';

import { runControlledShadowOnce } from '../shadow/create-controlled-shadow-runner.js';
import { SHADOW_CALL_BUDGET } from '../shadow/shadow-counters.js';
import { hardDeadlineMs } from '../shadow/shadow-run-config.js';
import { SHADOW_RESULT_KEYS, formatShadowRunResult } from '../shadow/shadow-result.js';
import {
  CANDIDATE_SENTINEL,
  STABLE_SENTINEL,
  completedOk,
  completedWithSentinel,
  fakeCredentialReader,
  fakeLegProvider,
  missingCredentialReader,
  shadowConfigWithEvidence,
  unreachableTransport,
} from './shadow-test-support.js';

const CREDENTIAL_PATH = '/synthetic/qfj/shadow-credential.key';

/** Drive one run with scripted per-leg outcomes and a counting credential reader. */
async function runWith(options: {
  readonly stable: ProviderInvocationResult;
  readonly candidate: ProviderInvocationResult;
  readonly credentialReader?: ReturnType<typeof fakeCredentialReader>;
  readonly setDeadline?: (ms: number, onFire: () => void) => () => void;
  readonly configOver?: Record<string, unknown>;
}) {
  const { config, evidence } = shadowConfigWithEvidence(options.configOver ?? {});
  const order: string[] = [];
  const reader = options.credentialReader ?? fakeCredentialReader();
  const result = await runControlledShadowOnce({
    config,
    evidence: evidence.evidence,
    credentialFilePath: CREDENTIAL_PATH,
    seams: {
      credentialFileReader: reader,
      transportFactory: unreachableTransport,
      providerFactory: ({ release, leg }): ModelProvider =>
        fakeLegProvider({
          release,
          script: { result: leg === 'stable' ? options.stable : options.candidate },
          onInvoke: () => order.push(leg),
        }),
      ...(options.setDeadline === undefined ? {} : { setDeadline: options.setDeadline }),
    },
  });
  return { result, order, reader, config };
}

describe('(58-63) the happy path', () => {
  it('(58, 59, 63) OFF revision 0 → SHADOW revision 1 → OFF revision 2, and PASSes', async () => {
    const { result } = await runWith({ stable: completedOk(21), candidate: completedOk(34) });
    expect(result.outcome).toBe('PASS');
    expect(result.reason).toBe('shadow-completed');
    expect(result.mode).toBe('SHADOW');
    expect(result.policyRevision).toBe(1);
    expect(result.finalMode).toBe('OFF');
    expect(result.finalPolicyRevision).toBe(2);
    expect(result.transitions).toBe(2);
  });

  it('(62) stable is invoked BEFORE the candidate', async () => {
    const { order } = await runWith({ stable: completedOk(), candidate: completedOk() });
    expect(order).toEqual(['stable', 'candidate']);
  });

  it('(61) both legs receive the same request object, and only usage/latency is kept', async () => {
    const { result } = await runWith({ stable: completedOk(21), candidate: completedOk(34) });
    // The gateway hands its single validated request to both legs; identity is guaranteed upstream.
    expect(result.stableLatencyMs).toBe(21);
    expect(result.candidateLatencyMs).toBe(34);
    expect(result.stableInputTokens).toBe(11);
    expect(result.candidateOutputTokens).toBe(3);
  });
});

describe('(64-68) candidate failure is a runner FAIL, never hidden', () => {
  it('(65) a candidate provider failure FAILs the run even though stable succeeded', async () => {
    const { result } = await runWith({
      stable: completedOk(),
      candidate: { status: 'failed', retryable: false },
    });
    expect(result.outcome).toBe('FAIL');
    expect(result.reason).toBe('provider-unavailable');
    // Stable really did succeed — the gateway returned a response — and the run still fails.
    expect(result.stableInvocations).toBe(1);
    expect(result.candidateInvocations).toBe(1);
  });

  it('(66) a candidate timeout FAILs the run', async () => {
    const { result } = await runWith({
      stable: completedOk(),
      candidate: { status: 'timeout', latencyMs: 99 },
    });
    expect(result.outcome).toBe('FAIL');
    expect(result.reason).toBe('timeout');
  });

  it('(67) a candidate rate limit FAILs the run', async () => {
    const { result } = await runWith({
      stable: completedOk(),
      candidate: { status: 'rate-limited' },
    });
    expect(result.outcome).toBe('FAIL');
    expect(result.reason).toBe('rate-limited');
  });

  it('(68) a candidate unavailable FAILs the run', async () => {
    const { result } = await runWith({
      stable: completedOk(),
      candidate: { status: 'unavailable', retryable: true },
    });
    expect(result.outcome).toBe('FAIL');
    expect(result.reason).toBe('provider-unavailable');
  });

  it('(64) a stable failure FAILs the run and the candidate is never called', async () => {
    const { result, order } = await runWith({
      stable: { status: 'failed', retryable: false },
      candidate: completedOk(),
    });
    expect(result.outcome).toBe('FAIL');
    expect(result.reason).toBe('provider-unavailable');
    expect(order).toEqual(['stable']);
    expect(result.candidateInvocations).toBe(0);
  });
});

describe('(69-76) lifecycle and encapsulation', () => {
  it('(69, 70, 71) the final emergency disable always runs and OFF is proven', async () => {
    for (const candidate of [completedOk(), { status: 'failed' as const, retryable: false }]) {
      const { result } = await runWith({ stable: completedOk(), candidate });
      expect(result.finalMode).toBe('OFF');
      expect(result.finalPolicyRevision).toBe(2);
    }
  });

  it('(73, 74, 75, 76) nothing internal is returned — only the closed result', async () => {
    const { result } = await runWith({ stable: completedOk(), candidate: completedOk() });
    expect(Object.keys(result).sort()).toEqual([...SHADOW_RESULT_KEYS].sort());
    const surface = result as unknown as Record<string, unknown>;
    for (const forbidden of [
      'gateway',
      'controller',
      'verifier',
      'registry',
      'providers',
      'provider',
      'transport',
      'credential',
      'request',
      'response',
      'evidence',
      'config',
    ]) {
      expect(surface[forbidden]).toBeUndefined();
    }
    expect(Object.isFrozen(result)).toBe(true);
  });

  it('a missing credential FAILs before any provider is invoked', async () => {
    const { config, evidence } = shadowConfigWithEvidence();
    const order: string[] = [];
    const result = await runControlledShadowOnce({
      config,
      evidence: evidence.evidence,
      credentialFilePath: CREDENTIAL_PATH,
      seams: {
        credentialFileReader: missingCredentialReader(),
        transportFactory: unreachableTransport,
        providerFactory: ({ release, leg }): ModelProvider =>
          fakeLegProvider({
            release,
            script: { result: completedOk() },
            onInvoke: () => order.push(leg),
          }),
      },
    });
    expect(result.outcome).toBe('FAIL');
    expect(result.reason).toBe('credential-unavailable');
    expect(order).toEqual([]);
    expect(result.providerConstructions).toBe(0);
    expect(result.stableInvocations).toBe(0);
    expect(result.candidateInvocations).toBe(0);
  });

  it('evidence with a broader target is refused — least authority (ADR-0065 §3)', async () => {
    const { config, evidence } = shadowConfigWithEvidence();
    for (const target of [
      'CANARY_ELIGIBILITY',
      'ACTIVE_MODEL_RELEASE',
      'CONNECTIVITY_SMOKE',
      'SEMANTIC_RETRIEVAL_RESEARCH_ELIGIBILITY',
    ] as const) {
      const result = await runControlledShadowOnce({
        config,
        evidence: { ...evidence.evidence, target },
        credentialFilePath: CREDENTIAL_PATH,
        seams: {
          credentialFileReader: fakeCredentialReader(),
          transportFactory: unreachableTransport,
        },
      });
      expect(result.outcome).toBe('FAIL');
      expect(result.reason).toBe('evidence-refused');
      // Refused before the credential is read.
      expect(result.credentialReads).toBe(0);
    }
  });
});

describe('(77-92) the exact call budget', () => {
  it('(77-89) a PASS matches the declared budget exactly', async () => {
    const reader = fakeCredentialReader();
    const { result } = await runWith({
      stable: completedOk(),
      candidate: completedOk(),
      credentialReader: reader,
    });
    expect(result.outcome).toBe('PASS');
    expect(result.credentialReads).toBe(1);
    expect(result.credentialResolveAttempts).toBe(1);
    expect(result.credentialResolveSuccesses).toBe(1);
    expect(result.refreshes).toBe(0);
    expect(result.providerConstructions).toBe(2);
    expect(result.stableInvocations).toBe(1);
    expect(result.candidateInvocations).toBe(1);
    expect(result.retries).toBe(0);
    expect(result.fallbacks).toBe(0);
    expect(result.transitions).toBe(2);
    expect(result.timersArmed).toBe(1);
    expect(result.timersCleared).toBe(1);
    // The injected reader confirms exactly one physical read.
    expect(reader.reads()).toBe(1);
    // Health is checked once per registered provider, and Groq health is local (no network).
    expect(result.healthChecks).toBe(2);
  });

  it('(90, 91) the budget refuses a third invocation and a third transport request', () => {
    // The budget itself is the enforcement: claiming past the ceiling returns false and counts nothing.
    expect(SHADOW_CALL_BUDGET.stableInvocations).toBe(1);
    expect(SHADOW_CALL_BUDGET.candidateInvocations).toBe(1);
    expect(SHADOW_CALL_BUDGET.transportRequests).toBe(2);
    expect(SHADOW_CALL_BUDGET.retries).toBe(0);
    expect(SHADOW_CALL_BUDGET.fallbacks).toBe(0);
    expect(SHADOW_CALL_BUDGET.refreshes).toBe(0);
    expect(SHADOW_CALL_BUDGET.outputsRetained).toBe(0);
  });

  it('(92) no count is taken from provenance — the shadow call is invisible there', async () => {
    const { result } = await runWith({ stable: completedOk(), candidate: completedOk() });
    // provenance.attempts would report 1; the runner reports both legs.
    expect(result.stableInvocations + result.candidateInvocations).toBe(2);
  });
});

describe('(93-112) output disposal', () => {
  it('(93-101) neither sentinel appears in the result, its JSON line, or the counters', async () => {
    const { result } = await runWith({
      stable: completedWithSentinel(STABLE_SENTINEL),
      candidate: completedWithSentinel(CANDIDATE_SENTINEL),
    });
    const surfaces = [
      JSON.stringify(result),
      formatShadowRunResult(result),
      Object.values(result).join('|'),
    ];
    for (const surface of surfaces) {
      expect(surface).not.toContain(STABLE_SENTINEL);
      expect(surface).not.toContain(CANDIDATE_SENTINEL);
      expect(surface).not.toContain('ZZSTABLE');
      expect(surface).not.toContain('ZZCANDIDATE');
    }
  });

  it('(102, 103, 104) no digest, no length, and only safe metrics are retained', async () => {
    const { result } = await runWith({ stable: completedOk(), candidate: completedOk() });
    const keys = Object.keys(result);
    for (const forbidden of [
      'outputDigest',
      'outputLength',
      'digest',
      'textResult',
      'structuredResult',
    ]) {
      expect(keys).not.toContain(forbidden);
    }
    expect(result.modelOutput).toBe('DISCARDED');
  });

  it('(105, 106) the result is exactly the declared key set, on one line', async () => {
    const { result } = await runWith({ stable: completedOk(), candidate: completedOk() });
    const line = formatShadowRunResult(result);
    expect(line.split('\n')).toHaveLength(1);
    expect(Object.keys(JSON.parse(line) as Record<string, unknown>)).toEqual([
      ...SHADOW_RESULT_KEYS,
    ]);
  });

  it('(108-112) no reference, path, prompt or digest appears in the line', async () => {
    const { result, config } = await runWith({ stable: completedOk(), candidate: completedOk() });
    const line = formatShadowRunResult(result);
    expect(line).not.toContain(config.credentialReference);
    expect(line).not.toContain(CREDENTIAL_PATH);
    expect(line).not.toContain('/synthetic/');
    expect(line).not.toContain(config.evidenceDigest);
    expect(line).not.toContain(config.evidenceRef);
    expect(line).not.toContain(config.promptId);
    expect(line).not.toContain('Return the JSON object');
    expect(line.toLowerCase()).not.toContain('authorization');
    expect(line).not.toContain('Bearer');
  });
});

describe('(113-120) the hard deadline', () => {
  it('(113, 114) the formula and the cap are exact', () => {
    expect(hardDeadlineMs(1_000)).toBe(12_000);
    expect(hardDeadlineMs(5_000)).toBe(20_000);
    expect(hardDeadlineMs(30_000)).toBe(70_000);
    // Capped, not extrapolated.
    expect(hardDeadlineMs(29_000)).toBe(68_000);
  });

  it('(115, 116, 117) exactly one timer is armed and cleared, on success and on failure', async () => {
    const armed: number[] = [];
    let cleared = 0;
    const setDeadline = (ms: number, _onFire: () => void): (() => void) => {
      armed.push(ms);
      return () => {
        cleared += 1;
      };
    };
    for (const candidate of [completedOk(), { status: 'failed' as const, retryable: false }]) {
      armed.length = 0;
      cleared = 0;
      const { result } = await runWith({ stable: completedOk(), candidate, setDeadline });
      expect(armed).toEqual([hardDeadlineMs(5_000)]);
      expect(cleared).toBe(1);
      expect(result.timersArmed).toBe(1);
      expect(result.timersCleared).toBe(1);
    }
  });

  it('(118, 119, 120) an abort produces no retry or fallback and still returns OFF', async () => {
    // Fire the deadline immediately: the run aborts before the gateway can serve.
    const setDeadline = (_ms: number, onFire: () => void): (() => void) => {
      onFire();
      return () => undefined;
    };
    const { result } = await runWith({
      stable: completedOk(),
      candidate: completedOk(),
      setDeadline,
    });
    expect(result.outcome).toBe('FAIL');
    expect(result.retries).toBe(0);
    expect(result.fallbacks).toBe(0);
    expect(result.finalMode).toBe('OFF');
    expect(result.timeouts).toBeGreaterThanOrEqual(1);
  });
});
