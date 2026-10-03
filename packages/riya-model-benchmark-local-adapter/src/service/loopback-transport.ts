/**
 * The only component in this package that opens a socket (AS4-PREP-A).
 *
 * ### It cannot reach a remote host, and the argument is structural
 *
 * It is constructed with a proved `RiyaLocalEngineEndpointV1` -- a value only the endpoint constructor
 * can produce, which cannot name anything but `127.0.0.1`, `localhost` or `[::1]` on an explicit port
 * over plain `http`. Callers hand it a PATH from a closed list, never a URL. So there is no argument,
 * no option and no configuration field through which a request could be aimed off the loopback
 * interface, and the URL is re-proved immediately before the socket opens.
 *
 * ### Redirects are refused, not followed
 *
 * `redirect: 'manual'` turns off the runtime's automatic following, and a 3xx is then REFUSED here
 * rather than returned. Automatic following is the exact mechanism by which a loopback-only guarantee
 * becomes untrue at run time: the check passes on the first URL, and the second one -- chosen by
 * whatever answered -- was never checked at all. The adapter above refuses a 3xx as well, which is what
 * keeps the rule provable when the transport is a fake.
 *
 * ### There is no credential surface
 *
 * No `apiKey` parameter, no `authorization` header, no bearer token, no header input of any kind, and
 * no environment read. Not "unused" -- absent, so there is no field a future slice could fill without
 * changing a signature and a reviewer's mind. The headers sent are two fixed ones that describe the
 * body and the expected response, and nothing else. `credentials: 'omit'` says the same thing to the
 * runtime about cookies.
 *
 * ### Cancellation reaches the socket
 *
 * The composed signal goes straight to `fetch`, so a per-request deadline or a suite cancellation
 * closes the connection instead of abandoning a promise while a machine keeps generating.
 */
import type {
  RiyaLocalEngineHttpRequest,
  RiyaLocalEngineHttpResponse,
  RiyaLocalEngineTransportPort,
} from '../contracts/engine-ports.js';
import type { RiyaLocalEnginePath, RiyaLocalEngineEndpointV1 } from '../contracts/endpoint.js';
import { RIYA_LOCAL_ENGINE_PATHS, riyaLocalEngineRequestUrl } from '../contracts/endpoint.js';
import { RiyaLocalBenchmarkError } from '../contracts/errors.js';

/**
 * Decode a byte stream to text, chunk by chunk, without waiting for the whole body.
 *
 * Streaming decode is load-bearing rather than tidy: a multi-byte character split across two network
 * chunks would decode to a replacement character under a per-chunk `TextDecoder`, and the surrounding
 * JSON would stop parsing. `{ stream: true }` carries the partial sequence into the next call.
 */
async function* decodeStream(
  stream: ReadableStream<Uint8Array> | null,
): AsyncGenerator<string, void, undefined> {
  if (stream === null) {
    return;
  }
  const reader = stream.getReader();
  const decoder = new TextDecoder('utf-8');
  try {
    for (;;) {
      const step = await reader.read();
      if (step.done) {
        const tail = decoder.decode();
        if (tail !== '') {
          yield tail;
        }
        return;
      }
      const text = decoder.decode(step.value, { stream: true });
      if (text !== '') {
        yield text;
      }
    }
  } finally {
    // Reached when the consumer closes the generator too -- which is how an aborted invocation
    // guarantees the underlying connection is released before it settles.
    try {
      await reader.cancel();
    } catch {
      // A connection torn down by the abort that caused this cancel has nothing left to say.
    }
    reader.releaseLock();
  }
}

/** Build a transport bound to one proved loopback endpoint. */
export function createRiyaLoopbackEngineTransport(options: {
  readonly endpoint: RiyaLocalEngineEndpointV1;
}): RiyaLocalEngineTransportPort {
  const { endpoint } = options;

  const request = async (
    engineRequest: RiyaLocalEngineHttpRequest,
  ): Promise<RiyaLocalEngineHttpResponse> => {
    if (!(RIYA_LOCAL_ENGINE_PATHS as readonly string[]).includes(engineRequest.path)) {
      throw new RiyaLocalBenchmarkError('ENDPOINT_INVALID');
    }
    // Re-proves the endpoint and the path, and returns the exact string the socket will be opened to.
    const url = riyaLocalEngineRequestUrl(endpoint, engineRequest.path as RiyaLocalEnginePath);

    const response = await fetch(url, {
      method: engineRequest.method,
      // Never follow. See the header.
      redirect: 'manual',
      credentials: 'omit',
      signal: engineRequest.signal,
      headers:
        engineRequest.body === undefined
          ? { accept: 'application/json' }
          : { 'content-type': 'application/json', accept: 'text/event-stream' },
      ...(engineRequest.body === undefined ? {} : { body: engineRequest.body }),
    });

    if (response.status >= 300 && response.status < 400) {
      // Fail closed at the boundary that owns the socket. Whatever the redirect pointed at was never
      // checked against the loopback rule, and asking where it pointed would already be too much
      // curiosity about a destination this package refuses to reach.
      await response.body?.cancel();
      throw new RiyaLocalBenchmarkError('ENGINE_REDIRECT_REFUSED');
    }

    return { status: response.status, body: decodeStream(response.body) };
  };

  return Object.freeze({ request });
}
