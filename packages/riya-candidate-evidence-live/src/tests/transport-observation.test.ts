/**
 * MVP-P2A.2 HF4-R4 — candidate transport observability, case association, and body containment.
 *
 * ### The run this file is about
 *
 * RUN S5 made eleven provider requests: one smoke, and ten safety calls. Nine of the ten were ordinary
 * MODEL_REQUIRED cases and every one of them came back `gatewayErrorCode=provider-failed`. That is the
 * gateway's real closed vocabulary and it is not wrong — it is just the end of a funnel. Groq's
 * normalization already folds 400, 401, 403, 404, 413 and 422 into one `failed` status, so a rejected
 * request, a revoked credential and a model the project is not entitled to arrive at the terminal
 * wearing the same word. Three findings, three different next actions, one indistinguishable line.
 *
 * The observer added here does not repair the failure. It says what the failure WAS, in four
 * content-free fields, without letting a single byte of a provider body reach a diagnostic.
 *
 * ### On the hostile bodies below
 *
 * They are deliberately the worst case: fake credentials, header-shaped strings, prompt text, user
 * text, URLs, stack-shaped text. None of them is real, and the point is that the observer's output
 * has no field any of them could occupy — containment by shape, not by filtering.
 */
import { describe, expect, it } from 'vitest';

import type { GroqTransport } from '@qf-jarvis/model-gateway';

import {
  CANDIDATE_PROVIDER_ERROR_CODES,
  CANDIDATE_PROVIDER_ERROR_TYPES,
  CANDIDATE_PROVIDER_HTTP_CLASSES,
  classifyProviderHttpStatus,
  createCandidateTransportObservations,
  MAX_OBSERVED_ERROR_BODY_BYTES,
  NOT_REACHED_TRANSPORT_OBSERVATION,
  observeProviderResponse,
} from '../candidate-transport-observation.js';

/** A transport that answers with exactly what a test names, and records what it was handed. */
function respondingTransport(
  outcomes: readonly ({ readonly status: number; readonly bodyText: string } | Error)[],
): { readonly transport: GroqTransport; readonly sends: () => number } {
  let index = 0;
  return {
    sends: () => index,
    transport: {
      send: (): Promise<{
        status: number;
        retryAfterSeconds: number | null;
        bodyText: string;
      }> => {
        const outcome = outcomes[Math.min(index, outcomes.length - 1)];
        index += 1;
        if (outcome instanceof Error) {
          return Promise.reject(outcome);
        }
        return Promise.resolve({
          status: outcome?.status ?? 0,
          retryAfterSeconds: null,
          bodyText: outcome?.bodyText ?? '',
        });
      },
    },
  };
}

const REQUEST = Object.freeze({ url: 'x', headers: Object.freeze({}), body: '' });

/** Drive one observed send inside one case window. */
async function observeOnce(
  caseId: string,
  outcome: { readonly status: number; readonly bodyText: string } | Error,
): Promise<ReturnType<ReturnType<typeof createCandidateTransportObservations>['observationFor']>> {
  const observations = createCandidateTransportObservations();
  const observed = observations.observe(respondingTransport([outcome]).transport);
  await observations
    .duringCase(caseId, () => observed.send(REQUEST, new AbortController().signal))
    .catch(() => undefined);
  return observations.observationFor(caseId);
}

describe('GOAL A — the provider failure class is observable, and content-free', () => {
  it('the three vocabularies are CLOSED and contain the reviewed members', () => {
    expect(CANDIDATE_PROVIDER_HTTP_CLASSES).toContain('NOT_REACHED');
    expect(CANDIDATE_PROVIDER_HTTP_CLASSES).toContain('TRANSPORT_THROW');
    expect(CANDIDATE_PROVIDER_ERROR_TYPES).toStrictEqual([
      'NONE',
      'INVALID_REQUEST_ERROR',
      'PERMISSIONS_ERROR',
      'OTHER_OR_ABSENT',
    ]);
    expect(CANDIDATE_PROVIDER_ERROR_CODES).toStrictEqual([
      'NONE',
      'JSON_VALIDATE_FAILED',
      'BLOCKED_API_ACCESS',
      'MODEL_PERMISSION_BLOCKED_ORG',
      'MODEL_PERMISSION_BLOCKED_PROJECT',
      'OTHER_OR_ABSENT',
    ]);
    // No duplicates: a vocabulary with a repeated member is one somebody edited without reading.
    for (const vocabulary of [
      CANDIDATE_PROVIDER_HTTP_CLASSES,
      CANDIDATE_PROVIDER_ERROR_TYPES,
      CANDIDATE_PROVIDER_ERROR_CODES,
    ]) {
      expect(new Set(vocabulary).size).toBe(vocabulary.length);
    }
  });

  it('the observer changes NOTHING about the response it observes', () => {
    // PASSIVE is the whole claim. The exact object the underlying transport returned is what the
    // gateway receives — same status, same body, same identity.
    const underlying = respondingTransport([{ status: 200, bodyText: '{"ok":true}' }]);
    const observations = createCandidateTransportObservations();
    const observed = observations.observe(underlying.transport);
    return observations
      .duringCase('c', () => observed.send(REQUEST, new AbortController().signal))
      .then((response) => {
        expect(response.status).toBe(200);
        expect(response.bodyText).toBe('{"ok":true}');
        expect(underlying.sends()).toBe(1);
      });
  });

  it('a transport THROW is rethrown unchanged, so the gateway normalises exactly what it always did', async () => {
    const thrown = new Error('the original error object');
    const observations = createCandidateTransportObservations();
    const observed = observations.observe(respondingTransport([thrown]).transport);
    await expect(
      observations.duringCase('c', () => observed.send(REQUEST, new AbortController().signal)),
    ).rejects.toBe(thrown);
    const observation = observations.observationFor('c');
    expect(observation.providerTransportStarted).toBe(true);
    expect(observation.providerHttpClass).toBe('TRANSPORT_THROW');
    // Not a single field could carry the message even if somebody wanted it to.
    expect(JSON.stringify(observation)).not.toContain('original error');
  });
});

describe('SECTION 12 — the safe Groq classification table', () => {
  const CASES: readonly (readonly [number, string])[] = [
    [200, 'SUCCESS_2XX'],
    [201, 'SUCCESS_2XX'],
    [400, 'BAD_REQUEST_400'],
    [401, 'UNAUTHORIZED_401'],
    [403, 'FORBIDDEN_403'],
    [404, 'NOT_FOUND_404'],
    [413, 'PAYLOAD_TOO_LARGE_413'],
    [422, 'UNPROCESSABLE_422'],
    [429, 'RATE_LIMITED_429'],
    [498, 'CAPACITY_498'],
    [499, 'CANCELLED_499'],
    [500, 'SERVER_5XX'],
    [502, 'SERVER_5XX'],
    [503, 'SERVER_5XX'],
    [418, 'OTHER_HTTP'],
    [451, 'OTHER_HTTP'],
  ];

  it.each(CASES)('HTTP %i classifies as %s', (status, expected) => {
    expect(classifyProviderHttpStatus(status)).toBe(expected);
  });

  it('a status outside 100-599 is OTHER_HTTP and is never retained as a number', () => {
    for (const status of [0, 99, 600, -1, 1.5, Number.NaN]) {
      expect(classifyProviderHttpStatus(status)).toBe('OTHER_HTTP');
      expect(observeProviderResponse(status, '').providerHttpStatus).toBe(0);
    }
  });

  it('400 json_validate_failed is named, and the message beside it is not', () => {
    const observation = observeProviderResponse(
      400,
      JSON.stringify({
        error: {
          message: 'the generated text did not satisfy the schema',
          type: 'invalid_request_error',
          code: 'json_validate_failed',
          failed_generation: '{"replyBody":"a real model output",',
        },
      }),
    );
    expect(observation.providerHttpClass).toBe('BAD_REQUEST_400');
    expect(observation.providerErrorType).toBe('INVALID_REQUEST_ERROR');
    expect(observation.providerErrorCode).toBe('JSON_VALIDATE_FAILED');
    const serialized = JSON.stringify(observation);
    expect(serialized).not.toContain('generated text');
    expect(serialized).not.toContain('replyBody');
    expect(serialized).not.toContain('failed_generation');
  });

  it('400 blocked_api_access is named', () => {
    const observation = observeProviderResponse(
      400,
      JSON.stringify({ error: { type: 'invalid_request_error', code: 'blocked_api_access' } }),
    );
    expect(observation.providerHttpClass).toBe('BAD_REQUEST_400');
    expect(observation.providerErrorCode).toBe('BLOCKED_API_ACCESS');
  });

  it('400 with no recognised code is BAD_REQUEST_400 with OTHER_OR_ABSENT, never a guess', () => {
    const observation = observeProviderResponse(
      400,
      JSON.stringify({ error: { type: 'server_error', code: 'something_new_and_unreviewed' } }),
    );
    expect(observation.providerHttpClass).toBe('BAD_REQUEST_400');
    expect(observation.providerErrorType).toBe('OTHER_OR_ABSENT');
    expect(observation.providerErrorCode).toBe('OTHER_OR_ABSENT');
    expect(JSON.stringify(observation)).not.toContain('something_new');
  });

  it('401 carries the class even with an empty body', () => {
    const observation = observeProviderResponse(401, '');
    expect(observation.providerHttpClass).toBe('UNAUTHORIZED_401');
    expect(observation.providerHttpStatus).toBe(401);
    expect(observation.providerErrorCode).toBe('OTHER_OR_ABSENT');
  });

  it('403 distinguishes generic from ORG and PROJECT model-permission blocks', () => {
    const generic = observeProviderResponse(403, JSON.stringify({ error: { type: 'other' } }));
    expect(generic.providerHttpClass).toBe('FORBIDDEN_403');
    expect(generic.providerErrorCode).toBe('OTHER_OR_ABSENT');

    const org = observeProviderResponse(
      403,
      JSON.stringify({
        error: { type: 'permissions_error', code: 'model_permission_blocked_org' },
      }),
    );
    expect(org.providerErrorType).toBe('PERMISSIONS_ERROR');
    expect(org.providerErrorCode).toBe('MODEL_PERMISSION_BLOCKED_ORG');

    const project = observeProviderResponse(
      403,
      JSON.stringify({
        error: { type: 'permissions_error', code: 'model_permission_blocked_project' },
      }),
    );
    expect(project.providerErrorCode).toBe('MODEL_PERMISSION_BLOCKED_PROJECT');
    // The three 403s differ, which is the entire point: S5 could not have told them apart.
    expect(new Set([generic, org, project].map((one) => one.providerErrorCode)).size).toBe(3);
  });

  it('404, 413, 422, 429, 498, 499 and 5xx each keep their own class and exact status', () => {
    for (const [status, expected] of [
      [404, 'NOT_FOUND_404'],
      [413, 'PAYLOAD_TOO_LARGE_413'],
      [422, 'UNPROCESSABLE_422'],
      [429, 'RATE_LIMITED_429'],
      [498, 'CAPACITY_498'],
      [499, 'CANCELLED_499'],
      [500, 'SERVER_5XX'],
      [502, 'SERVER_5XX'],
      [503, 'SERVER_5XX'],
    ] as const) {
      const observation = observeProviderResponse(status, '{}');
      expect(observation.providerHttpClass).toBe(expected);
      expect(observation.providerHttpStatus).toBe(status);
    }
  });

  it('200 does not parse the body at all', async () => {
    // A success has no error envelope to read, so a hostile 200 body is never even given to a parser.
    const observation = observeProviderResponse(200, '{"error":{"code":"json_validate_failed"}}');
    expect(observation.providerErrorType).toBe('NONE');
    expect(observation.providerErrorCode).toBe('NONE');
    expect(await observeOnce('c', { status: 200, bodyText: 'not json at all' })).toMatchObject({
      providerHttpClass: 'SUCCESS_2XX',
      providerErrorCode: 'NONE',
    });
  });

  it('an unparseable body and an oversized body both refuse to guess', () => {
    expect(observeProviderResponse(400, 'not json').providerErrorCode).toBe('OTHER_OR_ABSENT');
    expect(observeProviderResponse(400, '[]').providerErrorCode).toBe('OTHER_OR_ABSENT');
    expect(observeProviderResponse(400, 'null').providerErrorCode).toBe('OTHER_OR_ABSENT');
    // Past the bound nothing is parsed. A real envelope is hundreds of bytes; this is not one.
    const oversized = `${'x'.repeat(MAX_OBSERVED_ERROR_BODY_BYTES)}{"error":{"code":"json_validate_failed"}}`;
    expect(observeProviderResponse(400, oversized).providerErrorCode).toBe('OTHER_OR_ABSENT');
  });

  it('a body naming a PROTOTYPE member reaches no inherited value', () => {
    for (const hostile of ['constructor', '__proto__', 'toString', 'hasOwnProperty', 'valueOf']) {
      const observation = observeProviderResponse(
        400,
        JSON.stringify({ error: { type: hostile, code: hostile } }),
      );
      expect(observation.providerErrorType).toBe('OTHER_OR_ABSENT');
      expect(observation.providerErrorCode).toBe('OTHER_OR_ABSENT');
    }
  });
});

describe('SECTION 10 — a hostile provider body reaches nothing', () => {
  const HOSTILE_BODIES: readonly string[] = [
    JSON.stringify({
      error: {
        message: 'your key sk-SENTINEL-NEVER-A-REAL-KEY-0000 was rejected',
        type: 'invalid_request_error',
        code: 'json_validate_failed',
      },
    }),
    JSON.stringify({
      error: {
        message: 'Authorization: Bearer sk-live-abcdefghijklmnop',
        code: 'blocked_api_access',
      },
    }),
    JSON.stringify({
      error: {
        message: 'SENTINEL-SYSTEM-LINE-NEVER-REAL',
        failed_generation: 'the client asked about their apartment at 14 Marine Drive',
        code: 'model_permission_blocked_org',
      },
    }),
    JSON.stringify({
      error: { message: 'see https://api.groq.com/openai/v1/chat/completions?key=sk-leak' },
    }),
    JSON.stringify({ error: { message: 'at Object.<anonymous> (/app/src/secret.ts:1:1)' } }),
    JSON.stringify({ code: 'json_validate_failed', prompt: 'You are Riya, a sales agent.' }),
    '<html><body>proxy error for user keshav</body></html>',
  ];

  const FORBIDDEN: readonly string[] = [
    'SENTINEL-',
    'sk-',
    'Authorization',
    'Bearer',
    'GROQ_API_KEY',
    'https://',
    'api.groq.com',
    'at Object.',
    'failed_generation',
    'Marine Drive',
    'You are Riya',
    'keshav',
    'message',
    'prompt',
    'html',
  ];

  it.each(HOSTILE_BODIES)('body %# survives in no field of the observation', (bodyText) => {
    for (const status of [200, 400, 401, 403, 500]) {
      const serialized = JSON.stringify(observeProviderResponse(status, bodyText));
      for (const forbidden of FORBIDDEN) {
        expect(serialized, `observation must not contain ${forbidden}`).not.toContain(forbidden);
      }
      // Whatever survived is drawn from the reviewed vocabularies and nothing else.
      const observation = observeProviderResponse(status, bodyText);
      expect(CANDIDATE_PROVIDER_HTTP_CLASSES).toContain(observation.providerHttpClass);
      expect(CANDIDATE_PROVIDER_ERROR_TYPES).toContain(observation.providerErrorType);
      expect(CANDIDATE_PROVIDER_ERROR_CODES).toContain(observation.providerErrorCode);
    }
  });

  it('an observation has exactly five fields, and none of them is a string of provider origin', () => {
    const observation = observeProviderResponse(400, HOSTILE_BODIES[0] ?? '');
    expect(Object.keys(observation).sort()).toStrictEqual([
      'providerErrorCode',
      'providerErrorType',
      'providerHttpClass',
      'providerHttpStatus',
      'providerTransportStarted',
    ]);
    // Containment by SHAPE: there is no free-text field for a body to occupy, so the mapping cannot
    // be defeated by a body nobody anticipated.
    expect(typeof observation.providerTransportStarted).toBe('boolean');
    expect(typeof observation.providerHttpStatus).toBe('number');
  });
});

describe('GOAL B — one observation, claimed by exactly one case', () => {
  it('a case that never reached the boundary reports NOT_REACHED, not the previous case value', async () => {
    const observations = createCandidateTransportObservations();
    const observed = observations.observe(
      respondingTransport([{ status: 403, bodyText: '{}' }]).transport,
    );
    await observations.duringCase('first', () =>
      observed.send(REQUEST, new AbortController().signal),
    );
    // `second` opens a window and makes NO request.
    await observations.duringCase('second', () => Promise.resolve(undefined));

    expect(observations.observationFor('first').providerHttpClass).toBe('FORBIDDEN_403');
    expect(observations.observationFor('second')).toStrictEqual(NOT_REACHED_TRANSPORT_OBSERVATION);
    expect(observations.observationCountFor('first')).toBe(1);
    expect(observations.observationCountFor('second')).toBe(0);
    // A case nobody ever opened a window for is the same: absence, never inheritance.
    expect(observations.observationFor('never-run')).toStrictEqual(
      NOT_REACHED_TRANSPORT_OBSERVATION,
    );
  });

  it('SECTION 11-E — sequential cases with DIFFERENT classes never leak into each other', async () => {
    const observations = createCandidateTransportObservations();
    const outcomes = [
      { status: 400, bodyText: '{}' },
      { status: 401, bodyText: '{}' },
      { status: 403, bodyText: '{}' },
      { status: 429, bodyText: '{}' },
      { status: 200, bodyText: '{}' },
      { status: 500, bodyText: '{}' },
    ];
    const observed = observations.observe(respondingTransport(outcomes).transport);
    const ids = ['a.01', 'b.01', 'c.01', 'd.01', 'e.01', 'f.01'];
    for (const id of ids) {
      await observations.duringCase(id, () => observed.send(REQUEST, new AbortController().signal));
    }

    expect(ids.map((id) => observations.observationFor(id).providerHttpStatus)).toStrictEqual([
      400, 401, 403, 429, 200, 500,
    ]);
    expect(ids.map((id) => observations.observationFor(id).providerHttpClass)).toStrictEqual([
      'BAD_REQUEST_400',
      'UNAUTHORIZED_401',
      'FORBIDDEN_403',
      'RATE_LIMITED_429',
      'SUCCESS_2XX',
      'SERVER_5XX',
    ]);
    // Exactly one crossing per case. Not "at least one", which is what a leak looks like.
    for (const id of ids) {
      expect(observations.observationCountFor(id)).toBe(1);
    }
    expect(observations.unattributedObservations()).toBe(0);
    expect(observations.overlappingCaseWindows()).toBe(0);
  });

  it('a STALE crossing after a window closed is attributed to nobody', async () => {
    const observations = createCandidateTransportObservations();
    const observed = observations.observe(
      respondingTransport([{ status: 500, bodyText: '{}' }]).transport,
    );
    await observations.duringCase('closed', () => Promise.resolve(undefined));
    // The window is gone. Whatever this is, it is not the next case's.
    await observed.send(REQUEST, new AbortController().signal);

    expect(observations.observationFor('closed')).toStrictEqual(NOT_REACHED_TRANSPORT_OBSERVATION);
    expect(observations.unattributedObservations()).toBe(1);
    await observations.duringCase('next', () => Promise.resolve(undefined));
    expect(observations.observationFor('next')).toStrictEqual(NOT_REACHED_TRANSPORT_OBSERVATION);
  });

  it('OVERLAPPING windows suspend attribution rather than guessing', async () => {
    // The candidate gateway runs one request at a time today. That is a CONFIGURATION, and an
    // attribution scheme resting on it would misattribute silently the day it changes. So an overlap
    // is detected and refused: neither case claims the crossing, and the overlap is counted.
    const observations = createCandidateTransportObservations();
    const observed = observations.observe(
      respondingTransport([{ status: 400, bodyText: '{}' }]).transport,
    );
    await observations.duringCase('outer', () =>
      observations.duringCase('inner', () => observed.send(REQUEST, new AbortController().signal)),
    );

    expect(observations.overlappingCaseWindows()).toBe(1);
    expect(observations.unattributedObservations()).toBe(1);
    expect(observations.observationFor('outer')).toStrictEqual(NOT_REACHED_TRANSPORT_OBSERVATION);
    expect(observations.observationFor('inner')).toStrictEqual(NOT_REACHED_TRANSPORT_OBSERVATION);
  });

  it('SECTION 11-B — a cancelling case records a boundary crossing that then threw', async () => {
    // What a healthy cancellation looks like at this seam: the request LEFT, and was interrupted.
    // `NOT_REACHED` here would mean nothing was ever sent, which is a different case entirely.
    const observation = await observeOnce(
      'riya.safety.cancellation-ignored.01',
      Object.assign(new Error('This operation was aborted'), { name: 'AbortError' }),
    );
    expect(observation.providerTransportStarted).toBe(true);
    expect(observation.providerHttpClass).toBe('TRANSPORT_THROW');
    expect(observation.providerHttpStatus).toBe(0);
    expect(JSON.stringify(observation)).not.toContain('aborted');
  });

  it('a crossing that never settles is STARTED, which is not the same as NOT_REACHED', async () => {
    // The request left and nothing came back. Merging that with "nothing was sent" would hide the
    // one failure mode an owner most needs to see.
    const observations = createCandidateTransportObservations();
    let settle: (() => void) | undefined;
    const observed = observations.observe({
      send: () =>
        new Promise((resolve) => {
          settle = () => {
            resolve({ status: 200, retryAfterSeconds: null, bodyText: '{}' });
          };
        }),
    });
    const inFlight = observations.duringCase('hanging', () =>
      observed.send(REQUEST, new AbortController().signal),
    );
    // Observed WHILE the request is still open.
    expect(observations.observationFor('hanging')).toStrictEqual({
      providerTransportStarted: true,
      providerHttpStatus: 0,
      providerHttpClass: 'NONE',
      providerErrorType: 'NONE',
      providerErrorCode: 'NONE',
    });
    settle?.();
    await inFlight;
    expect(observations.observationFor('hanging').providerHttpClass).toBe('SUCCESS_2XX');
  });
});
