/**
 * QFJ-S2-E-C-R3 — `json_validate_failed` end to end through the SHADOW runner.
 *
 * The regression this pins: two live runs returned HTTP 400 `json_validate_failed` on the candidate leg
 * and surfaced as `provider-unavailable` / `client-rejected`, which reads as "the provider rejected your
 * credentials". It must read as an OUTPUT failure.
 *
 * Every test drives the REAL Groq provider through a synthetic transport that performs no I/O, with a
 * synthetic credential. **No network, no real credential, no live runner.**
 */
import { describe, expect, it } from 'vitest';

import { runControlledShadowOnce } from '../shadow/create-controlled-shadow-runner.js';
import {
  SHADOW_CANDIDATE_FAILURE_CLASSES,
  SHADOW_RESULT_KEYS,
  formatShadowRunResult,
} from '../shadow/shadow-result.js';
import { shadowConfigWithEvidence } from './shadow-test-support.js';

const CREDENTIAL_PATH = '/synthetic/qfj/shadow-credential.key';
const FAKE_CREDENTIAL = 'FAKE_QFJ_CREDENTIAL_DO_NOT_USE_S2ECR3';

const OK_BODY = JSON.stringify({
  choices: [{ message: { content: '{"status":"ok"}' }, finish_reason: 'stop' }],
  usage: { prompt_tokens: 247, completion_tokens: 69 },
});

/**
 * The exact shape Groq returned on both failed candidate legs: HTTP 400, the closed code, and the full
 * completion budget consumed. The message and failed_generation carry sentinels so a leak is provable.
 */
const JSON_VALIDATE_FAILED_BODY = JSON.stringify({
  error: {
    message: 'ZZGROQMESSAGESENTINEL',
    type: 'invalid_request_error',
    code: 'json_validate_failed',
    failed_generation: 'ZZFAILEDGENERATIONSENTINEL',
  },
});

/** Stable always answers 200; the candidate gets the scripted response. Factory call 1 = stable. */
function transportFactoryFor(candidate: { status: number; bodyText: string }) {
  let call = 0;
  return () => {
    call += 1;
    const isCandidate = call === 2;
    return {
      send: () =>
        Promise.resolve(
          isCandidate
            ? { status: candidate.status, retryAfterSeconds: null, bodyText: candidate.bodyText }
            : { status: 200, retryAfterSeconds: null, bodyText: OK_BODY },
        ),
    };
  };
}

async function runWithCandidateResponse(candidate: { status: number; bodyText: string }) {
  const { config, evidence } = shadowConfigWithEvidence();
  return runControlledShadowOnce({
    config,
    evidence: evidence.evidence,
    credentialFilePath: CREDENTIAL_PATH,
    seams: {
      credentialFileReader: {
        read: () => Promise.resolve({ ok: true as const, text: FAKE_CREDENTIAL }),
      },
      transportFactory: transportFactoryFor(candidate),
    },
  });
}

describe('the live regression: HTTP 400 json_validate_failed', () => {
  it('reports an OUTPUT failure, not a client rejection', async () => {
    const result = await runWithCandidateResponse({
      status: 400,
      bodyText: JSON_VALIDATE_FAILED_BODY,
    });
    expect(result.outcome).toBe('FAIL');
    expect(result.reason).toBe('provider-output-invalid');
    expect(result.candidateFailureClass).toBe('output-invalid');
    expect(result.finalMode).toBe('OFF');
    expect(result.finalPolicyRevision).toBe(2);
  });

  it('keeps the exact call budget and adds no retry, fallback or refresh', async () => {
    const result = await runWithCandidateResponse({
      status: 400,
      bodyText: JSON_VALIDATE_FAILED_BODY,
    });
    expect(result.credentialReads).toBe(1);
    expect(result.credentialResolveAttempts).toBe(1);
    expect(result.credentialResolveSuccesses).toBe(1);
    expect(result.providerConstructions).toBe(2);
    expect(result.healthChecks).toBe(2);
    expect(result.stableInvocations).toBe(1);
    expect(result.candidateInvocations).toBe(1);
    expect(result.transportRequests).toBe(2);
    expect(result.retries).toBe(0);
    expect(result.fallbacks).toBe(0);
    expect(result.refreshes).toBe(0);
    expect(result.transitions).toBe(2);
    expect(result.timersArmed).toBe(1);
    expect(result.timersCleared).toBe(1);
  });

  it('leaks no provider message, generation, status or credential', async () => {
    const result = await runWithCandidateResponse({
      status: 400,
      bodyText: JSON_VALIDATE_FAILED_BODY,
    });
    const line = formatShadowRunResult(result);
    for (const forbidden of [
      'ZZGROQMESSAGESENTINEL',
      'ZZFAILEDGENERATIONSENTINEL',
      'json_validate_failed',
      'invalid_request_error',
      FAKE_CREDENTIAL,
      'Bearer',
      '400',
      'api.groq',
      'https://',
      CREDENTIAL_PATH,
    ]) {
      expect(line).not.toContain(forbidden);
    }
    expect(line.toLowerCase()).not.toContain('authorization');
    expect(result.modelOutput).toBe('DISCARDED');
    expect(line.split('\n')).toHaveLength(1);
  });

  it('keeps the result contract at 38 keys with the six-value vocabulary', async () => {
    const result = await runWithCandidateResponse({
      status: 400,
      bodyText: JSON_VALIDATE_FAILED_BODY,
    });
    expect(SHADOW_RESULT_KEYS).toHaveLength(38);
    expect(Object.keys(result).sort()).toEqual([...SHADOW_RESULT_KEYS].sort());
    expect(SHADOW_CANDIDATE_FAILURE_CLASSES).toHaveLength(6);
    expect(SHADOW_CANDIDATE_FAILURE_CLASSES).toContain(result.candidateFailureClass);
  });
});

describe('every other candidate response is classified exactly as before', () => {
  const CASES: readonly {
    label: string;
    status: number;
    bodyText: string;
    reason: string;
    cls: string;
  }[] = [
    {
      label: 'HTTP 400 without the closed code',
      status: 400,
      bodyText: JSON.stringify({ error: { code: 'some_other_code', message: 'x' } }),
      reason: 'provider-unavailable',
      cls: 'client-rejected',
    },
    {
      label: 'HTTP 401',
      status: 401,
      bodyText: '',
      reason: 'provider-unavailable',
      cls: 'client-rejected',
    },
    {
      label: 'HTTP 403',
      status: 403,
      bodyText: '',
      reason: 'provider-unavailable',
      cls: 'client-rejected',
    },
    {
      label: 'HTTP 429',
      status: 429,
      bodyText: '',
      reason: 'rate-limited',
      cls: 'client-rejected',
    },
    {
      label: 'HTTP 500',
      status: 500,
      bodyText: '',
      reason: 'provider-unavailable',
      cls: 'server-unavailable',
    },
    {
      label: 'HTTP 503',
      status: 503,
      bodyText: '',
      reason: 'provider-unavailable',
      cls: 'server-unavailable',
    },
    { label: 'HTTP 499', status: 499, bodyText: '', reason: 'cancelled', cls: 'transport-error' },
    {
      label: 'HTTP 200 with a malformed payload',
      status: 200,
      bodyText: JSON.stringify({
        choices: [{ message: { content: 'not the required json' }, finish_reason: 'stop' }],
        usage: {},
      }),
      reason: 'provider-output-invalid',
      cls: 'output-invalid',
    },
    {
      label: 'HTTP 200 valid',
      status: 200,
      bodyText: OK_BODY,
      reason: 'shadow-completed',
      cls: 'none',
    },
  ];

  it('preserves the full mapping table and always ends OFF at revision 2', async () => {
    for (const c of CASES) {
      const result = await runWithCandidateResponse({ status: c.status, bodyText: c.bodyText });
      expect(`${c.label}: ${result.reason}/${result.candidateFailureClass}`).toBe(
        `${c.label}: ${c.reason}/${c.cls}`,
      );
      expect(result.finalMode).toBe('OFF');
      expect(result.finalPolicyRevision).toBe(2);
      expect(result.retries).toBe(0);
      expect(result.fallbacks).toBe(0);
      expect(result.refreshes).toBe(0);
      expect(result.modelOutput).toBe('DISCARDED');
    }
  });

  it('a valid candidate still PASSes', async () => {
    const result = await runWithCandidateResponse({ status: 200, bodyText: OK_BODY });
    expect(result.outcome).toBe('PASS');
    expect(result.reason).toBe('shadow-completed');
    expect(result.candidateFailureClass).toBe('none');
  });
});
