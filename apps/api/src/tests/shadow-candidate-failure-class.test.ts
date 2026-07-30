/**
 * QFJ-S2-E-C-R1 — the closed candidate failure class.
 *
 * The first correctly formed live SHADOW run returned `provider-unavailable` and could not be acted on,
 * because four operationally different candidate failures fold into that one reason. This suite pins the
 * class that separates them, and pins that `reason` is unchanged by it.
 *
 * Every test is offline: fake providers, synthetic transports that perform no I/O, a synthetic
 * credential. **No network, no real credential, no live runner.**
 */
import type { ModelProvider, ProviderInvocationResult } from '@qf-jarvis/model-gateway';
import { describe, expect, it } from 'vitest';

import { runControlledShadowOnce } from '../shadow/create-controlled-shadow-runner.js';
import {
  classifyCandidateFailure,
  countTransport,
  type TransportOutcome,
} from '../shadow/shadow-provider-metrics.js';
import { createShadowCounters } from '../shadow/shadow-counters.js';
import {
  SHADOW_CANDIDATE_FAILURE_CLASSES,
  SHADOW_RESULT_KEYS,
  formatShadowRunResult,
} from '../shadow/shadow-result.js';
import {
  CANDIDATE_SENTINEL,
  STABLE_SENTINEL,
  completedOk,
  completedWithSentinel,
  fakeCredentialReader,
  fakeLegProvider,
  missingCredentialReader,
  rejectingTransport,
  respondingTransport,
  shadowConfigWithEvidence,
  unreachableTransport,
} from './shadow-test-support.js';

const CREDENTIAL_PATH = '/synthetic/qfj/shadow-credential.key';

/** Drive one run, optionally giving the candidate leg a transport that responds or rejects. */
async function runWith(options: {
  readonly stable: ProviderInvocationResult;
  readonly candidate: ProviderInvocationResult;
  /** `responds` = the server answered; `rejects` = nothing came back; omitted = never sent. */
  readonly candidateTransport?: 'responds' | 'rejects';
}) {
  const { config, evidence } = shadowConfigWithEvidence();
  // The factory decides what the wire does; the fake calls the COUNTED transport it is handed, which is
  // the only object that records the outcome. Handing the fake a separate transport would bypass it.
  const transportFactory =
    options.candidateTransport === 'responds'
      ? respondingTransport
      : options.candidateTransport === 'rejects'
        ? rejectingTransport
        : unreachableTransport;
  const result = await runControlledShadowOnce({
    config,
    evidence: evidence.evidence,
    credentialFilePath: CREDENTIAL_PATH,
    seams: {
      credentialFileReader: fakeCredentialReader(),
      transportFactory,
      providerFactory: ({ release, leg, transport }): ModelProvider =>
        fakeLegProvider({
          release,
          script: { result: leg === 'stable' ? options.stable : options.candidate },
          ...(leg === 'candidate' && options.candidateTransport !== undefined ? { transport } : {}),
        }),
    },
  });
  return result;
}

describe('(1-6) the six classes, end to end through the runner', () => {
  it('(1) a candidate that completes is `none`, and the run PASSes', async () => {
    const result = await runWith({ stable: completedOk(), candidate: completedOk() });
    expect(result.outcome).toBe('PASS');
    expect(result.reason).toBe('shadow-completed');
    expect(result.candidateFailureClass).toBe('none');
  });

  it('(2) a candidate never reached is `not-invoked`, and `reason` is unchanged', async () => {
    const result = await runWith({
      stable: { status: 'failed', retryable: false },
      candidate: completedOk(),
    });
    expect(result.outcome).toBe('FAIL');
    expect(result.reason).toBe('provider-unavailable');
    expect(result.candidateFailureClass).toBe('not-invoked');
    expect(result.candidateInvocations).toBe(0);
  });

  it('(3) a closed client rejection is `client-rejected`', async () => {
    const result = await runWith({
      stable: completedOk(),
      candidate: { status: 'failed', retryable: false },
      candidateTransport: 'responds',
    });
    expect(result.reason).toBe('provider-unavailable');
    expect(result.candidateFailureClass).toBe('client-rejected');
  });

  it('(4) an unavailable candidate whose server ANSWERED is `server-unavailable`', async () => {
    const result = await runWith({
      stable: completedOk(),
      candidate: { status: 'unavailable', retryable: true },
      candidateTransport: 'responds',
    });
    expect(result.reason).toBe('provider-unavailable');
    expect(result.candidateFailureClass).toBe('server-unavailable');
  });

  it('(5) an unavailable candidate whose transport REJECTED is `transport-error`', async () => {
    const result = await runWith({
      stable: completedOk(),
      candidate: { status: 'unavailable', retryable: true },
      candidateTransport: 'rejects',
    });
    expect(result.reason).toBe('provider-unavailable');
    expect(result.candidateFailureClass).toBe('transport-error');
  });

  it('(6) malformed candidate output is `output-invalid` — the previously untested branch', async () => {
    const result = await runWith({
      stable: completedOk(),
      candidate: { status: 'malformed', latencyMs: 44 },
      candidateTransport: 'responds',
    });
    expect(result.outcome).toBe('FAIL');
    expect(result.reason).toBe('provider-output-invalid');
    expect(result.candidateFailureClass).toBe('output-invalid');
    expect(result.finalMode).toBe('OFF');
    expect(result.finalPolicyRevision).toBe(2);
  });
});

describe('(7-9) reasons that were already precise are unchanged', () => {
  it('(7) a rate limit keeps reason `rate-limited` and classes as a client rejection', async () => {
    const result = await runWith({
      stable: completedOk(),
      candidate: { status: 'rate-limited' },
      candidateTransport: 'responds',
    });
    // The reason is authoritative and untouched; the class adds only that a response came back and
    // rejected the request. HTTP 429 is a 4xx, so no new enum value was invented for it.
    expect(result.reason).toBe('rate-limited');
    expect(result.candidateFailureClass).toBe('client-rejected');
  });

  it('(8) a timeout keeps reason `timeout`', async () => {
    const result = await runWith({
      stable: completedOk(),
      candidate: { status: 'timeout', latencyMs: 99 },
      candidateTransport: 'rejects',
    });
    expect(result.reason).toBe('timeout');
    expect(result.candidateFailureClass).toBe('transport-error');
  });

  it('(9) a cancellation keeps reason `cancelled`', async () => {
    const result = await runWith({
      stable: completedOk(),
      candidate: { status: 'cancelled' },
    });
    expect(result.reason).toBe('cancelled');
    expect(result.candidateFailureClass).toBe('transport-error');
  });
});

describe('(10) final OFF on every candidate failure path', () => {
  const CANDIDATES: readonly ProviderInvocationResult[] = [
    { status: 'failed', retryable: false },
    { status: 'unavailable', retryable: true },
    { status: 'rate-limited' },
    { status: 'timeout', latencyMs: 12 },
    { status: 'cancelled' },
    { status: 'malformed', latencyMs: 12 },
  ];

  it('every failure class still ends OFF at revision 2 with the timer cleared', async () => {
    for (const candidate of CANDIDATES) {
      for (const transport of ['responds', 'rejects'] as const) {
        const result = await runWith({
          stable: completedOk(),
          candidate,
          candidateTransport: transport,
        });
        expect(result.finalMode).toBe('OFF');
        expect(result.finalPolicyRevision).toBe(2);
        expect(result.transitions).toBe(2);
        expect(result.timersArmed).toBe(1);
        expect(result.timersCleared).toBe(1);
        expect(result.outcome).toBe('FAIL');
        expect(SHADOW_CANDIDATE_FAILURE_CLASSES).toContain(result.candidateFailureClass);
      }
    }
  });

  it('a pre-credential refusal reports `not-invoked`, and has no rollout to return to OFF', async () => {
    const { config, evidence } = shadowConfigWithEvidence();
    const result = await runControlledShadowOnce({
      config,
      evidence: evidence.evidence,
      credentialFilePath: CREDENTIAL_PATH,
      seams: {
        credentialFileReader: missingCredentialReader(),
        transportFactory: unreachableTransport,
      },
    });
    expect(result.reason).toBe('credential-unavailable');
    expect(result.candidateFailureClass).toBe('not-invoked');
    // Pre-existing, and correct: the rollout controller is constructed AFTER the credential resolves,
    // so a credential failure leaves no policy in existence. `UNKNOWN` says "there was nothing to
    // disable", which is honest; claiming OFF would assert a disable that never happened. This is not a
    // candidate-failure path, so the final-OFF-revision-2 rule does not apply to it.
    expect(result.finalMode).toBe('UNKNOWN');
    expect(result.finalPolicyRevision).toBe(0);
    expect(result.transitions).toBe(0);
    expect(result.providerConstructions).toBe(0);
  });
});

describe('(11, 12) the result contract is exactly 38 keys in a fixed order', () => {
  it('(11) the key count is 38 and the vocabulary has exactly six values', () => {
    expect(SHADOW_RESULT_KEYS).toHaveLength(38);
    expect(SHADOW_CANDIDATE_FAILURE_CLASSES).toHaveLength(6);
    expect([...SHADOW_CANDIDATE_FAILURE_CLASSES]).toEqual([
      'none',
      'not-invoked',
      'client-rejected',
      'server-unavailable',
      'transport-error',
      'output-invalid',
    ]);
    expect(Object.isFrozen(SHADOW_CANDIDATE_FAILURE_CLASSES)).toBe(true);
  });

  it('(12) the new key sits at a fixed position, immediately after `reason`', async () => {
    const result = await runWith({ stable: completedOk(), candidate: completedOk() });
    const emitted = Object.keys(JSON.parse(formatShadowRunResult(result)) as object);
    expect(emitted).toEqual([...SHADOW_RESULT_KEYS]);
    expect(emitted.slice(0, 5)).toEqual([
      'timestamp',
      'outcome',
      'reason',
      'candidateFailureClass',
      'mode',
    ]);
    expect(Object.keys(result).sort()).toEqual([...SHADOW_RESULT_KEYS].sort());
  });

  it('the field is always present and never null or undefined', async () => {
    for (const candidate of [completedOk(), { status: 'failed' as const, retryable: false }]) {
      const result = await runWith({ stable: completedOk(), candidate });
      expect(result.candidateFailureClass).not.toBeUndefined();
      expect(result.candidateFailureClass).not.toBeNull();
      expect(typeof result.candidateFailureClass).toBe('string');
    }
  });
});

describe('(13-15) the line stays one line, leaks nothing, and disposes output', () => {
  it('(13, 14) one line, no forbidden value, no exact HTTP status', async () => {
    const result = await runWith({
      stable: completedOk(),
      candidate: { status: 'unavailable', retryable: true },
      candidateTransport: 'responds',
    });
    const line = formatShadowRunResult(result);
    expect(line.split('\n')).toHaveLength(1);
    for (const forbidden of [
      '503',
      '429',
      '500',
      'Bearer',
      'authorization',
      'QFJ_TEST_SYNTHETIC_TRANSPORT_REJECTION',
      'example.invalid',
      'https://',
      'retryable',
      'Error',
      'stack',
      '.key',
    ]) {
      expect(line).not.toContain(forbidden);
    }
    expect(line.toLowerCase()).not.toContain('authorization');
  });

  it('(15) both sentinels stay absent, and output disposal is unchanged', async () => {
    const result = await runWith({
      stable: completedWithSentinel(STABLE_SENTINEL),
      candidate: completedWithSentinel(CANDIDATE_SENTINEL),
    });
    const line = formatShadowRunResult(result);
    expect(line).not.toContain(STABLE_SENTINEL);
    expect(line).not.toContain(CANDIDATE_SENTINEL);
    expect(result.modelOutput).toBe('DISCARDED');
    expect(Object.keys(result)).not.toContain('outputDigest');
    expect(Object.keys(result)).not.toContain('outputLength');
  });
});

describe('(16, 17) the call budget and the no-retry guarantees are untouched', () => {
  it('(16) a PASS still matches the exact budget', async () => {
    const result = await runWith({ stable: completedOk(), candidate: completedOk() });
    expect(result.credentialReads).toBe(1);
    expect(result.credentialResolveAttempts).toBe(1);
    expect(result.credentialResolveSuccesses).toBe(1);
    expect(result.providerConstructions).toBe(2);
    expect(result.healthChecks).toBe(2);
    expect(result.stableInvocations).toBe(1);
    expect(result.candidateInvocations).toBe(1);
    expect(result.transitions).toBe(2);
  });

  it('(17) retries, fallbacks and refreshes remain zero on every path', async () => {
    for (const transport of ['responds', 'rejects'] as const) {
      const result = await runWith({
        stable: completedOk(),
        candidate: { status: 'unavailable', retryable: true },
        candidateTransport: transport,
      });
      expect(result.retries).toBe(0);
      expect(result.fallbacks).toBe(0);
      expect(result.refreshes).toBe(0);
    }
  });

  it('the transport wrapper still counts, still refuses a third, and now records its outcome', async () => {
    const counters = createShadowCounters();
    const responded = countTransport({ send: () => Promise.resolve('ok') }, counters);
    expect(responded.outcome()).toBe('not-sent');
    await responded.send('req', new AbortController().signal);
    expect(responded.outcome()).toBe('responded');

    const rejected = countTransport(
      { send: () => Promise.reject(new Error('QFJ_TEST_SYNTHETIC')) },
      counters,
    );
    await expect(rejected.send('req', new AbortController().signal)).rejects.toThrow();
    expect(rejected.outcome()).toBe('rejected');

    // The budget is 2 and both were spent; a third is refused, and that refusal is the RUNNER's, so it
    // must not be mistaken for a transport rejection.
    const third = countTransport({ send: () => Promise.resolve('ok') }, counters);
    await expect(third.send('req', new AbortController().signal)).rejects.toThrow();
    expect(third.outcome()).toBe('not-sent');
    expect(counters.exceeded()).toBe(true);
  });
});

describe('the classifier is total and derived only from closed values', () => {
  const OUTCOMES: readonly TransportOutcome[] = ['not-sent', 'responded', 'rejected'];
  const STATUSES = [
    'not-invoked',
    'refused-by-budget',
    'completed',
    'malformed',
    'failed',
    'rate-limited',
    'cancelled',
    'threw',
    'unavailable',
    'timeout',
  ] as const;

  it('every status × transport outcome yields a declared literal', () => {
    for (const status of STATUSES) {
      for (const transportOutcome of OUTCOMES) {
        for (const accepted of [true, false]) {
          const cls = classifyCandidateFailure({
            status,
            latencyMs: 10,
            transportOutcome,
            accepted,
            timeoutMs: 30_000,
          });
          expect(SHADOW_CANDIDATE_FAILURE_CLASSES).toContain(cls);
        }
      }
    }
  });

  it('a completed-but-rejected attempt separates lateness from a bad payload', () => {
    const base = {
      status: 'completed' as const,
      transportOutcome: 'responded' as const,
      accepted: false,
      timeoutMs: 1_000,
    };
    // Served within the bound but rejected by the gateway → the payload failed the contract.
    expect(classifyCandidateFailure({ ...base, latencyMs: 999 })).toBe('output-invalid');
    // Served after the bound → the server was too slow, not the payload's fault.
    expect(classifyCandidateFailure({ ...base, latencyMs: 1_001 })).toBe('server-unavailable');
    // Accepted → none, whatever the latency.
    expect(classifyCandidateFailure({ ...base, accepted: true, latencyMs: 5_000 })).toBe('none');
  });

  it('a budget refusal classes as not-invoked, never as a provider failure', () => {
    expect(
      classifyCandidateFailure({
        status: 'refused-by-budget',
        latencyMs: 0,
        transportOutcome: 'not-sent',
        accepted: false,
        timeoutMs: 30_000,
      }),
    ).toBe('not-invoked');
  });
});
