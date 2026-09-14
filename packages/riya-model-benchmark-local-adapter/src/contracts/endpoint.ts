/**
 * The LOOPBACK-ONLY engine endpoint (AS4-PREP-A).
 *
 * ### Why the containment lives in a value rather than in a review rule
 *
 * This is the first package in the repository that benchmarks a real model, and the shortest path from
 * "measure the local engine" to "measure a hosted API" is one character in a base URL. A hosted call
 * needs a credential, a credential needs an environment variable, and an environment variable is how a
 * benchmark harness quietly becomes a second production caller nobody reviews.
 *
 * So a destination is not a string here. It is a value only this constructor can produce, it cannot
 * name a remote host, and every request path is JOINED onto it rather than supplied whole -- which
 * means the adapter above has no way to express a remote destination even if it wanted one.
 *
 * ### What is accepted, exhaustively
 *
 * `http://127.0.0.1:<port>`, `http://localhost:<port>`, `http://[::1]:<port>`, each optionally with a
 * short path prefix such as `/v1`. That is the entire set.
 *
 * Refused: `https` (a local engine on the same machine needs no TLS, and allowing the scheme is how a
 * public host eventually arrives), any other hostname, LAN and public addresses, `0.0.0.0` as a
 * destination, a URL carrying a username or password, a URL carrying a query string or fragment, a
 * missing port, and any path segment that is not a plain name.
 *
 * ### The honest limit
 *
 * `localhost` is a NAME, and a name is resolved by the operating system. A machine whose hosts file
 * maps it elsewhere would send the request elsewhere, and no amount of parsing here can see that. The
 * two literal forms have no such gap. The name is accepted anyway, because refusing the spelling every
 * local engine prints on startup pushes an operator toward editing the check rather than the URL --
 * but `hostForm` records which spelling was used, so a run can say what it actually trusted.
 */
import { z } from 'zod';

import { RiyaLocalBenchmarkError } from './errors.js';

/** Which loopback spelling the operator supplied. Recorded, never inferred. */
export const RIYA_LOCAL_ENDPOINT_HOST_FORMS = [
  'IPV4_LOOPBACK',
  'IPV6_LOOPBACK',
  'LOCALHOST_NAME',
] as const;
export type RiyaLocalEndpointHostForm = (typeof RIYA_LOCAL_ENDPOINT_HOST_FORMS)[number];

export interface RiyaLocalEngineEndpointV1 {
  readonly version: 1;
  /** `http://127.0.0.1:8000`. Scheme, host and port only. */
  readonly origin: string;
  /** `''` or `/v1`. Never a trailing slash, never a traversal segment. */
  readonly basePath: string;
  readonly hostForm: RiyaLocalEndpointHostForm;
}

/** The exact hostnames a benchmark request may reach. There is no fourth entry and no config for it. */
const LOOPBACK_HOSTS: Readonly<Record<string, RiyaLocalEndpointHostForm>> = Object.freeze({
  '127.0.0.1': 'IPV4_LOOPBACK',
  '[::1]': 'IPV6_LOOPBACK',
  localhost: 'LOCALHOST_NAME',
});

/**
 * The complete set of request paths this adapter may ask a transport for.
 *
 * Closed on purpose. A transport accepting an arbitrary path would let a caller reach an engine's
 * admin, shutdown or model-loading routes through the one component allowed to open a socket.
 */
export const RIYA_LOCAL_ENGINE_PATHS = ['/chat/completions', '/models'] as const;
export type RiyaLocalEnginePath = (typeof RIYA_LOCAL_ENGINE_PATHS)[number];

const rawSchema = z
  .string()
  .min(1)
  .max(256)
  // Printable ASCII only: no whitespace, no control character. A URL carrying either is a paste
  // accident at best.
  .regex(/^[!-~]+$/u);

/** One segment of a base prefix: a plain name, never `.`, `..` or a percent escape. */
const SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]*$/u;

/**
 * Validate and freeze a local engine endpoint. Throws `ENDPOINT_INVALID` or `ENDPOINT_NOT_LOOPBACK`.
 *
 * Two codes rather than one, because they mean different things to whoever reads the failure: a
 * malformed URL is a typo, and a well-formed URL pointing somewhere else is the containment rule doing
 * its job.
 */
export function createRiyaLocalEngineEndpoint(raw: string): RiyaLocalEngineEndpointV1 {
  if (!rawSchema.safeParse(raw).success) {
    throw new RiyaLocalBenchmarkError('ENDPOINT_INVALID');
  }

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new RiyaLocalBenchmarkError('ENDPOINT_INVALID');
  }

  // A credential in a URL is refused before the host is looked at. This adapter has no credential
  // concept at all, and the likeliest way one would arrive is inside a base URL copied from a hosted
  // provider's quickstart.
  if (url.username !== '' || url.password !== '') {
    throw new RiyaLocalBenchmarkError('ENDPOINT_INVALID');
  }
  // A query string or fragment on a BASE url is either a secret or a mistake, and this adapter appends
  // its own paths -- so either way it would be silently dropped rather than honoured.
  if (url.search !== '' || url.hash !== '') {
    throw new RiyaLocalBenchmarkError('ENDPOINT_INVALID');
  }
  if (url.protocol !== 'http:') {
    throw new RiyaLocalBenchmarkError('ENDPOINT_NOT_LOOPBACK');
  }
  const hostForm = LOOPBACK_HOSTS[url.hostname];
  if (hostForm === undefined) {
    throw new RiyaLocalBenchmarkError('ENDPOINT_NOT_LOOPBACK');
  }
  // An explicit port is REQUIRED. Every local engine prints one on startup, and defaulting to 80 would
  // mean a mistyped URL quietly reached whatever else is listening on the machine.
  if (!/^[0-9]{1,5}$/u.test(url.port)) {
    throw new RiyaLocalBenchmarkError('ENDPOINT_INVALID');
  }
  const port = Number(url.port);
  if (port < 1 || port > 65_535) {
    throw new RiyaLocalBenchmarkError('ENDPOINT_INVALID');
  }

  let basePath = '';
  if (url.pathname !== '' && url.pathname !== '/') {
    const trimmed = url.pathname.endsWith('/') ? url.pathname.slice(0, -1) : url.pathname;
    const segments = trimmed.split('/');
    // A leading slash makes the first segment empty; every other segment must be a plain name.
    if (segments.length < 2 || segments.length > 5 || segments[0] !== '') {
      throw new RiyaLocalBenchmarkError('ENDPOINT_INVALID');
    }
    for (const segment of segments.slice(1)) {
      if (!SEGMENT.test(segment)) {
        throw new RiyaLocalBenchmarkError('ENDPOINT_INVALID');
      }
    }
    basePath = trimmed;
  }

  return Object.freeze({
    version: 1 as const,
    origin: `http://${url.hostname}:${String(port)}`,
    basePath,
    hostForm,
  });
}

/**
 * The absolute URL for one adapter-owned path.
 *
 * The endpoint is RE-PROVED rather than trusted, and the path is checked against the closed list.
 * Both are deliberate: this function is the last thing that runs before a socket opens, and an
 * endpoint value that arrived through a cast, a deserialization or a future refactor would otherwise
 * be believed on the strength of its type.
 */
export function riyaLocalEngineRequestUrl(
  endpoint: RiyaLocalEngineEndpointV1,
  path: RiyaLocalEnginePath,
): string {
  if (!RIYA_LOCAL_ENGINE_PATHS.includes(path)) {
    throw new RiyaLocalBenchmarkError('ENDPOINT_INVALID');
  }
  const reproved = createRiyaLocalEngineEndpoint(`${endpoint.origin}${endpoint.basePath}`);
  if (reproved.origin !== endpoint.origin || reproved.basePath !== endpoint.basePath) {
    throw new RiyaLocalBenchmarkError('ENDPOINT_NOT_LOOPBACK');
  }
  return `${reproved.origin}${reproved.basePath}${path}`;
}
