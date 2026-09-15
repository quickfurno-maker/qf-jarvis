/**
 * WHERE authenticated Nara discovery threw, said safely (JF-5B-R11).
 *
 * ### The gap
 *
 * Run-13 and run-14 both stopped at the same line on the same head:
 *
 * ```
 * nara discovery failed: discovery-transport-failed
 * ```
 *
 * `fetchNaraModelCatalogue` collapses every thrown transport exception to that one token, and that
 * decision is RIGHT and stays: a fetch error can quote the request it failed on, and that request
 * carries an `Authorization` header. Discarding it is what keeps a credential out of a terminal.
 *
 * But the owner then proved, with no real key, that the path is healthy: DNS resolves, TCP 443 connects,
 * `curl` without auth returns 401, Node without auth returns 401 in 625 ms, and Node with a FAKE bearer
 * returns 401 in 637 ms. So DNS, TLS, Node's fetch and the presence of an `Authorization` header are all
 * fine. Whatever fails is specific to the real authenticated call or to reading its body — and two
 * identical runs cannot say which, because the one fact that distinguishes them was thrown away.
 *
 * ### What this may say
 *
 * WHERE, and a CLOSED normalized token for what kind of error it was. Nothing else.
 *
 * `errorName` comes from `Error.name` only when it already matches a strict identifier pattern, and is
 * `OTHER` otherwise. `causeCode` comes from `error.cause.code` under the same discipline, and is
 * `OTHER_OR_ABSENT` otherwise. Both are pattern-GATED rather than trimmed: a value that does not match
 * is replaced, never shortened, because a shortened message is still a message.
 *
 * Never a message, a cause message, a stack, a URL, a header, a key, a response header, a body, a body
 * prefix, a socket address or a request id. The resulting object contains no free text at all, and a
 * sentinel-driven spec proves it for each of those.
 *
 * ### What it may decide
 *
 * Nothing. `discovery-transport-failed` is still the failure, the exit code is unchanged, and the
 * existing `nara discovery failed: discovery-transport-failed` line is printed verbatim as before. This
 * adds one line after it, and only for that one failure.
 */

/** WHERE the throw happened. Closed, and deliberately small. */
export type DiscoveryStage =
  /** `fetch()` itself threw: no `Response` was ever obtained. */
  | 'FETCH_REJECTED'
  /** A `Response` arrived and `response.text()` threw while reading it. */
  | 'RESPONSE_BODY_READ_FAILED'
  /** The controller aborted — the 20s timer fired — while awaiting either step. */
  | 'DISCOVERY_ABORTED'
  /** Something threw and the facts do not single out a stage. The honest answer. */
  | 'DISCOVERY_TRANSPORT_UNKNOWN';

/** The sanitized record. Every field is a closed token, a bounded integer or a boolean. */
export interface DiscoveryDiagnostic {
  readonly stage: DiscoveryStage;
  readonly elapsedMs: number;
  readonly errorName: string;
  readonly causeCode: string;
  /** Present only when a `Response` had already been obtained. */
  readonly responseStatus: number | undefined;
  readonly bodyReadStarted: boolean;
  readonly aborted: boolean;
}

/** What an `Error.name` must look like to be repeated. Anything else becomes `OTHER`. */
const ERROR_NAME_PATTERN = /^[A-Za-z0-9_.-]{1,64}$/u;

/** What a `cause.code` must look like. Upper-case tokens only: `UND_ERR_CONNECT_TIMEOUT`, `ECONNRESET`. */
const CAUSE_CODE_PATTERN = /^[A-Z0-9_.-]{1,64}$/u;

export const UNKNOWN_ERROR_NAME = 'OTHER';
export const UNKNOWN_CAUSE_CODE = 'OTHER_OR_ABSENT';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

/**
 * The error's `name`, if it is already a bare identifier.
 *
 * GATED, not trimmed. A name like `TypeError: fetch failed for https://…?key=…` is replaced wholesale,
 * because taking the first 64 characters of it would publish the first 64 characters of a URL.
 */
function safeErrorName(error: unknown): string {
  if (!isRecord(error)) {
    return UNKNOWN_ERROR_NAME;
  }
  const name: unknown = error['name'];
  return typeof name === 'string' && ERROR_NAME_PATTERN.test(name) ? name : UNKNOWN_ERROR_NAME;
}

/** The `cause.code`, under the same gate. Undici puts `UND_ERR_*` and libuv `E*` codes here. */
function safeCauseCode(error: unknown): string {
  if (!isRecord(error)) {
    return UNKNOWN_CAUSE_CODE;
  }
  const cause: unknown = error['cause'];
  if (!isRecord(cause)) {
    return UNKNOWN_CAUSE_CODE;
  }
  const code: unknown = cause['code'];
  return typeof code === 'string' && CAUSE_CODE_PATTERN.test(code) ? code : UNKNOWN_CAUSE_CODE;
}

/** Did this throw come from the abort? Node names it `AbortError`; the signal is the second witness. */
function looksAborted(error: unknown, signalAborted: boolean): boolean {
  if (signalAborted) {
    return true;
  }
  return safeErrorName(error) === 'AbortError';
}

export interface DiscoveryThrowFacts {
  readonly error: unknown;
  readonly elapsedMs: number;
  /** The status of a `Response` already in hand, if `fetch()` had resolved. */
  readonly responseStatus: number | undefined;
  /** Whether `response.text()` had been entered when the throw happened. */
  readonly bodyReadStarted: boolean;
  /** Whether the AbortController's signal was already aborted. */
  readonly signalAborted: boolean;
}

/**
 * Classify one thrown discovery exception.
 *
 * ABORT WINS, and is checked first. A timer-driven abort surfaces as a rejection of whichever await was
 * in flight, so classifying it as `FETCH_REJECTED` would report a network refusal for what is really a
 * 20-second deadline — the single most misleading thing this diagnostic could say. `responseStatus` and
 * `bodyReadStarted` are still carried alongside, so an abort DURING a body read is distinguishable from
 * an abort before a response ever arrived.
 */
export function classifyDiscoveryThrow(facts: DiscoveryThrowFacts): DiscoveryDiagnostic {
  const aborted = looksAborted(facts.error, facts.signalAborted);
  const stage: DiscoveryStage = aborted
    ? 'DISCOVERY_ABORTED'
    : facts.bodyReadStarted
      ? 'RESPONSE_BODY_READ_FAILED'
      : facts.responseStatus === undefined
        ? 'FETCH_REJECTED'
        : 'DISCOVERY_TRANSPORT_UNKNOWN';
  return Object.freeze({
    stage,
    elapsedMs: Math.max(0, Math.round(facts.elapsedMs)),
    errorName: safeErrorName(facts.error),
    causeCode: safeCauseCode(facts.error),
    responseStatus: facts.responseStatus,
    bodyReadStarted: facts.bodyReadStarted,
    aborted,
  });
}

/** The one operator line. Only defined fields are rendered, so it never claims to know a status it lacks. */
export function renderDiscoveryDiagnostic(diagnostic: DiscoveryDiagnostic): string {
  const parts = [
    `stage=${diagnostic.stage}`,
    `elapsedMs=${String(diagnostic.elapsedMs)}`,
    `errorName=${diagnostic.errorName}`,
    `causeCode=${diagnostic.causeCode}`,
  ];
  if (diagnostic.responseStatus !== undefined) {
    parts.push(`responseStatus=${String(diagnostic.responseStatus)}`);
  }
  parts.push(`bodyReadStarted=${diagnostic.bodyReadStarted ? 'yes' : 'no'}`);
  parts.push(`aborted=${diagnostic.aborted ? 'yes' : 'no'}`);
  return `nara discovery diagnostic: ${parts.join(' ')}`;
}

/**
 * Holds the last classified throw, in memory, for the length of one run.
 *
 * The transport records into it and RETHROWS unchanged; nothing reads it unless the top-level failure is
 * `discovery-transport-failed`. A run in which discovery succeeds never consults it at all.
 */
export interface DiscoveryDiagnosticRecorder {
  record(facts: DiscoveryThrowFacts): void;
  latest(): DiscoveryDiagnostic | undefined;
}

export function createDiscoveryDiagnosticRecorder(): DiscoveryDiagnosticRecorder {
  let latest: DiscoveryDiagnostic | undefined;
  return Object.freeze({
    record: (facts: DiscoveryThrowFacts): void => {
      latest = classifyDiscoveryThrow(facts);
    },
    latest: (): DiscoveryDiagnostic | undefined => latest,
  });
}
