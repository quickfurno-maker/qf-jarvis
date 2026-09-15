/**
 * The ONE bounded network seam, asserted against a deterministic transport.
 *
 * ### Why this spec lives beside the module and not only beside the CLI
 *
 * A mutation control found the gap: the redirect refusal was exercised only through the application's
 * CLI spec, so breaking it HERE — in the package that owns the rule — left this package's own suite
 * green. A rule proved only by a distant caller is a rule that can be deleted quietly.
 *
 * Every case below injects a transport that resolves a recorded response. Nothing opens a socket, and
 * the credential is a synthetic holder whose value has no accessor.
 */
import { createNaraApiKey } from '@qf-jarvis/model-gateway';
import { describe, expect, it } from 'vitest';

import {
  DISCOVERY_TIMEOUT_MS,
  fetchNaraModelCatalogue,
} from '../discovery/nara-discovery-transport.js';
import type {
  DiscoveryHttpResponse,
  NaraDiscoveryTransport,
} from '../discovery/nara-discovery-transport.js';
import { MAX_DISCOVERY_RESPONSE_BYTES } from '../discovery/nara-model-discovery.js';

const KEY = createNaraApiKey('nara-synthetic-certification-key-0000');

interface Probe {
  readonly transport: NaraDiscoveryTransport;
  readonly calls: () => number;
  readonly lastRequest: () => Record<string, unknown> | undefined;
}

function probe(answer: DiscoveryHttpResponse | Error): Probe {
  let calls = 0;
  let request: Record<string, unknown> | undefined;
  return {
    calls: () => calls,
    lastRequest: () => request,
    transport: {
      get(input): Promise<DiscoveryHttpResponse> {
        calls += 1;
        request = { ...input };
        return answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer);
      },
    },
  };
}

const ok = (over: Partial<DiscoveryHttpResponse> = {}): DiscoveryHttpResponse => ({
  status: 200,
  redirected: false,
  bodyText: JSON.stringify({ data: [{ id: 'vendor-a/one', context_length: 131_072 }] }),
  bodyBytes: 64,
  ...over,
});

const always = (): boolean => true;
const never = (): boolean => false;

describe('the discovery seam makes ONE call, under bounds it states', () => {
  it('passes the holder-built header, the timeout and the byte ceiling, and calls once', async () => {
    const one = probe(ok());
    const result = await fetchNaraModelCatalogue(one.transport, KEY, always);
    expect(result.ok).toBe(true);
    expect(one.calls()).toBe(1);
    const request = one.lastRequest() ?? {};
    expect(request['timeoutMs']).toBe(DISCOVERY_TIMEOUT_MS);
    expect(request['maxBytes']).toBe(MAX_DISCOVERY_RESPONSE_BYTES);
    // The header comes from the provider's own accessor, and carries the scheme it chose.
    expect(String(request['authorization'])).toMatch(/^Bearer /u);
  });

  it('reserves BEFORE the call, and makes none when the ceiling refuses', async () => {
    const one = probe(ok());
    const result = await fetchNaraModelCatalogue(one.transport, KEY, never);
    expect(result).toEqual({ ok: false, failure: 'discovery-budget-exhausted', calls: 0 });
    expect(one.calls()).toBe(0);
  });
});

describe('the discovery seam REFUSES rather than repairing', () => {
  it('refuses a redirect flagged by the transport', async () => {
    const one = probe(ok({ redirected: true }));
    const result = await fetchNaraModelCatalogue(one.transport, KEY, always);
    // A 302 is the endpoint telling us to send the credential somewhere the code did not pin.
    expect(result).toEqual({ ok: false, failure: 'discovery-redirect-refused', calls: 1 });
    expect(one.calls()).toBe(1);
  });

  it('refuses a 3xx status even when the transport did not flag it', async () => {
    for (const status of [301, 302, 307, 308]) {
      const one = probe(ok({ status, redirected: false }));
      const result = await fetchNaraModelCatalogue(one.transport, KEY, always);
      expect([status, result]).toEqual([
        status,
        { ok: false, failure: 'discovery-redirect-refused', calls: 1 },
      ]);
    }
  });

  it('separates an unauthorized answer from any other HTTP failure', async () => {
    for (const status of [401, 403]) {
      const result = await fetchNaraModelCatalogue(probe(ok({ status })).transport, KEY, always);
      expect([status, result]).toEqual([
        status,
        { ok: false, failure: 'discovery-unauthorized', calls: 1 },
      ]);
    }
    for (const status of [400, 429, 500, 503]) {
      const result = await fetchNaraModelCatalogue(probe(ok({ status })).transport, KEY, always);
      expect([status, result]).toEqual([
        status,
        { ok: false, failure: 'discovery-http-error', calls: 1 },
      ]);
    }
  });

  it('refuses an oversized body rather than truncating it', async () => {
    const one = probe(ok({ bodyBytes: MAX_DISCOVERY_RESPONSE_BYTES + 1 }));
    const result = await fetchNaraModelCatalogue(one.transport, KEY, always);
    // A truncated JSON list is a list we would be guessing at.
    expect(result).toEqual({ ok: false, failure: 'discovery-response-too-large', calls: 1 });
  });

  it('refuses an unparseable body', async () => {
    const result = await fetchNaraModelCatalogue(
      probe(ok({ bodyText: 'not json' })).transport,
      KEY,
      always,
    );
    expect(result).toEqual({ ok: false, failure: 'discovery-invalid-json', calls: 1 });
  });

  it('sanitizes a transport failure, and never retries it', async () => {
    const one = probe(new Error('connect ECONNREFUSED 1.2.3.4:443 authorization=Bearer secret'));
    const result = await fetchNaraModelCatalogue(one.transport, KEY, always);
    expect(result).toEqual({ ok: false, failure: 'discovery-transport-failed', calls: 1 });
    // ONE call. A failure is a failure; a person may start a new run after reading it.
    expect(one.calls()).toBe(1);
    // The underlying error is discarded, because a transport error can quote the request.
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('ECONNREFUSED');
    expect(serialized).not.toContain('Bearer');
  });
});
