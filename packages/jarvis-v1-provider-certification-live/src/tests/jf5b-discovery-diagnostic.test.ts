/**
 * The sanitized Nara discovery-throw diagnostic (JF-5B-R11). Zero network, zero credentials.
 *
 * ### What two runs could not say
 *
 * Run-13 and run-14 both stopped on the same head with the same line and nothing else:
 * `nara discovery failed: discovery-transport-failed`. The owner then proved the path healthy without a
 * real key — DNS resolves, TCP 443 connects, `curl` and Node both get HTTP 401 in ~630 ms, with and
 * without a fake bearer — so DNS, TLS, Node's fetch and the mere presence of an `Authorization` header
 * are all fine. What fails is specific to the real authenticated call or to reading its body, and the
 * one fact that separates those two was thrown away on purpose.
 *
 * ### What these specs protect
 *
 * That the stage is knowable; that an abort is never reported as a network refusal; and — with more
 * assertions than anything else here — that a message, a stack, a URL, a header, a key, a body or a
 * request id can never reach a terminal through it.
 */
import { describe, expect, it } from 'vitest';

import {
  UNKNOWN_CAUSE_CODE,
  UNKNOWN_ERROR_NAME,
  classifyDiscoveryThrow,
  createDiscoveryDiagnosticRecorder,
  renderDiscoveryDiagnostic,
} from '../index.js';
import type { DiscoveryThrowFacts } from '../index.js';

const KEY_SENTINEL = 'ZZNARAKEYSENTINEL';
const AUTH_SENTINEL = 'Bearer ZZAUTHHEADERSENTINEL';
const URL_SENTINEL = 'https://router.bynara.id/v1/models?zzurlsentinel=1';
const BODY_SENTINEL = 'ZZRESPONSEBODYSENTINEL';
const MESSAGE_SENTINEL = 'ZZEXCEPTIONMESSAGESENTINEL';
const STACK_SENTINEL = 'ZZSTACKSENTINEL';
const REQUEST_ID_SENTINEL = 'ZZREQUESTIDSENTINEL';

const ALL_SENTINELS = [
  KEY_SENTINEL,
  AUTH_SENTINEL,
  URL_SENTINEL,
  BODY_SENTINEL,
  MESSAGE_SENTINEL,
  STACK_SENTINEL,
  REQUEST_ID_SENTINEL,
];

const facts = (over: Partial<DiscoveryThrowFacts> = {}): DiscoveryThrowFacts => ({
  error: new TypeError('fetch failed'),
  elapsedMs: 100,
  responseStatus: undefined,
  bodyReadStarted: false,
  signalAborted: false,
  ...over,
});

const errorWith = (name: string, causeCode: unknown, message = 'fetch failed'): unknown =>
  Object.assign(new Error(message), { name, cause: { code: causeCode } });

describe('JF-5B-R11 (1-4) the stage, named', () => {
  it('(1) fetch itself throwing is FETCH_REJECTED', () => {
    const diagnostic = classifyDiscoveryThrow(
      facts({ error: errorWith('TypeError', 'ECONNRESET'), elapsedMs: 842 }),
    );
    expect(diagnostic.stage).toBe('FETCH_REJECTED');
    expect(diagnostic.errorName).toBe('TypeError');
    expect(diagnostic.causeCode).toBe('ECONNRESET');
    expect(diagnostic.elapsedMs).toBe(842);
    expect(diagnostic.responseStatus).toBeUndefined();
    expect(diagnostic.bodyReadStarted).toBe(false);
    expect(diagnostic.aborted).toBe(false);
  });

  it('(2) an AbortError is DISCOVERY_ABORTED, by name or by signal', () => {
    const byName = classifyDiscoveryThrow(
      facts({ error: errorWith('AbortError', undefined), elapsedMs: 20_001 }),
    );
    expect(byName.stage).toBe('DISCOVERY_ABORTED');
    expect(byName.aborted).toBe(true);
    // A runtime that names its abort something else is still caught by the signal itself.
    const bySignal = classifyDiscoveryThrow(
      facts({ error: errorWith('TypeError', 'UND_ERR_ABORTED'), signalAborted: true }),
    );
    expect(bySignal.stage).toBe('DISCOVERY_ABORTED');
    expect(bySignal.aborted).toBe(true);
  });

  it('(3) a body read throwing after a 200 is RESPONSE_BODY_READ_FAILED', () => {
    const diagnostic = classifyDiscoveryThrow(
      facts({
        error: errorWith('TypeError', 'UND_ERR_SOCKET'),
        responseStatus: 200,
        bodyReadStarted: true,
        elapsedMs: 3_120,
      }),
    );
    expect(diagnostic.stage).toBe('RESPONSE_BODY_READ_FAILED');
    expect(diagnostic.responseStatus).toBe(200);
    expect(diagnostic.bodyReadStarted).toBe(true);
    expect(diagnostic.causeCode).toBe('UND_ERR_SOCKET');
  });

  it('(4) an abort DURING a body read stays an abort, and keeps the status', () => {
    // ABORT WINS. Reporting a 20-second deadline as a body-read fault would be the single most
    // misleading thing this diagnostic could say, so the abort check runs first — and the status and
    // body flag still travel, so it is distinguishable from an abort before any response arrived.
    const diagnostic = classifyDiscoveryThrow(
      facts({
        error: errorWith('AbortError', undefined),
        responseStatus: 200,
        bodyReadStarted: true,
        signalAborted: true,
        elapsedMs: 20_001,
      }),
    );
    expect(diagnostic.stage).toBe('DISCOVERY_ABORTED');
    expect(diagnostic.responseStatus).toBe(200);
    expect(diagnostic.bodyReadStarted).toBe(true);
    expect(diagnostic.aborted).toBe(true);
    const line = renderDiscoveryDiagnostic(diagnostic);
    expect(line).toContain('responseStatus=200');
    expect(line).toContain('bodyReadStarted=yes');
    expect(line).toContain('aborted=yes');
  });

  it('an unclassifiable throw says so rather than guessing', () => {
    expect(
      classifyDiscoveryThrow(facts({ error: 'a bare string', responseStatus: 503 })).stage,
    ).toBe('DISCOVERY_TRANSPORT_UNKNOWN');
    expect(classifyDiscoveryThrow(facts({ error: undefined })).stage).toBe('FETCH_REJECTED');
  });
});

describe('JF-5B-R11 (5,6) free text is REPLACED, never trimmed', () => {
  it('(5) a name that is not a bare identifier becomes OTHER', () => {
    for (const name of [
      `TypeError: fetch failed for ${URL_SENTINEL}`,
      'has spaces',
      '',
      'x'.repeat(65),
      `${MESSAGE_SENTINEL}!`,
    ]) {
      const diagnostic = classifyDiscoveryThrow(facts({ error: errorWith(name, 'ECONNRESET') }));
      expect({ name, got: diagnostic.errorName }).toEqual({ name, got: UNKNOWN_ERROR_NAME });
    }
    // Trimming would have published the first 64 characters of a URL. Gating publishes none of it.
    expect(UNKNOWN_ERROR_NAME).toBe('OTHER');
  });

  it('(6) a cause code that is not an upper-case token becomes OTHER_OR_ABSENT', () => {
    for (const code of [
      `connect ECONNREFUSED for ${AUTH_SENTINEL}`,
      'lower_case',
      42,
      null,
      undefined,
      'Z'.repeat(65),
    ]) {
      const diagnostic = classifyDiscoveryThrow(facts({ error: errorWith('TypeError', code) }));
      expect({ code, got: diagnostic.causeCode }).toEqual({ code, got: UNKNOWN_CAUSE_CODE });
    }
    expect(UNKNOWN_CAUSE_CODE).toBe('OTHER_OR_ABSENT');
  });

  it('accepts the real undici and libuv codes verbatim', () => {
    for (const code of [
      'UND_ERR_CONNECT_TIMEOUT',
      'UND_ERR_SOCKET',
      'ECONNRESET',
      'ENETUNREACH',
      'ETIMEDOUT',
      'CERT_HAS_EXPIRED',
    ]) {
      expect(classifyDiscoveryThrow(facts({ error: errorWith('TypeError', code) })).causeCode).toBe(
        code,
      );
    }
  });

  it('an error with no cause at all is handled without inventing one', () => {
    const diagnostic = classifyDiscoveryThrow(facts({ error: new TypeError('fetch failed') }));
    expect(diagnostic.errorName).toBe('TypeError');
    expect(diagnostic.causeCode).toBe(UNKNOWN_CAUSE_CODE);
  });

  it('elapsedMs is a non-negative integer, whatever it is handed', () => {
    expect(classifyDiscoveryThrow(facts({ elapsedMs: -5 })).elapsedMs).toBe(0);
    expect(classifyDiscoveryThrow(facts({ elapsedMs: 12.7 })).elapsedMs).toBe(13);
  });
});

describe('JF-5B-R11 (7,8) no sentinel survives, by any route', () => {
  it('(7,8) not through name, message, cause, stack or any nested field', () => {
    const hostile: unknown = Object.assign(
      new Error(`${MESSAGE_SENTINEL} while GET ${URL_SENTINEL} auth=${AUTH_SENTINEL}`),
      {
        name: `TypeError ${KEY_SENTINEL}`,
        stack: `Error: ${STACK_SENTINEL}\n    at ${URL_SENTINEL}`,
        cause: {
          code: `ECONNRESET ${REQUEST_ID_SENTINEL}`,
          message: MESSAGE_SENTINEL,
          headers: { authorization: AUTH_SENTINEL },
          body: BODY_SENTINEL,
          address: '203.0.113.7',
          port: 443,
        },
        requestId: REQUEST_ID_SENTINEL,
        response: { body: BODY_SENTINEL },
      },
    );
    const diagnostic = classifyDiscoveryThrow(
      facts({ error: hostile, responseStatus: 200, bodyReadStarted: true }),
    );
    const serialised = JSON.stringify(diagnostic);
    const line = renderDiscoveryDiagnostic(diagnostic);
    for (const sentinel of ALL_SENTINELS) {
      expect({ sentinel, inObject: serialised.includes(sentinel) }).toEqual({
        sentinel,
        inObject: false,
      });
      expect({ sentinel, inLine: line.includes(sentinel) }).toEqual({ sentinel, inLine: false });
    }
    // Nor the socket address, the port, or any other field of the cause.
    expect(serialised).not.toContain('203.0.113.7');
    expect(serialised).not.toContain('authorization');
    expect(diagnostic.errorName).toBe(UNKNOWN_ERROR_NAME);
    expect(diagnostic.causeCode).toBe(UNKNOWN_CAUSE_CODE);
  });

  it('the object has exactly the approved keys, and no free text among them', () => {
    const diagnostic = classifyDiscoveryThrow(
      facts({ error: errorWith('TypeError', 'ECONNRESET'), responseStatus: 200 }),
    );
    expect(Object.keys(diagnostic).sort()).toEqual([
      'aborted',
      'bodyReadStarted',
      'causeCode',
      'elapsedMs',
      'errorName',
      'responseStatus',
      'stage',
    ]);
  });

  it('every rendered pair is a key=token shape', () => {
    const line = renderDiscoveryDiagnostic(
      classifyDiscoveryThrow(
        facts({ error: errorWith('AbortError', 'UND_ERR_CONNECT_TIMEOUT'), responseStatus: 200 }),
      ),
    );
    expect(line.startsWith('nara discovery diagnostic: ')).toBe(true);
    for (const pair of line.slice('nara discovery diagnostic: '.length).split(' ')) {
      expect({ pair, shaped: /^[A-Za-z]+=[A-Za-z0-9_.-]+$/u.test(pair) }).toEqual({
        pair,
        shaped: true,
      });
    }
  });
});

describe('JF-5B-R11 the recorder holds one throw, in memory', () => {
  it('answers undefined until something is recorded', () => {
    const recorder = createDiscoveryDiagnosticRecorder();
    expect(recorder.latest()).toBeUndefined();
  });

  it('keeps the LAST classified throw, and nothing raw', () => {
    const recorder = createDiscoveryDiagnosticRecorder();
    recorder.record(facts({ error: errorWith('TypeError', 'ECONNRESET') }));
    recorder.record(
      facts({ error: errorWith('AbortError', undefined), signalAborted: true, elapsedMs: 20_001 }),
    );
    const latest = recorder.latest();
    expect(latest?.stage).toBe('DISCOVERY_ABORTED');
    expect(latest?.elapsedMs).toBe(20_001);
    expect(JSON.stringify(latest)).not.toContain('fetch failed');
  });
});
