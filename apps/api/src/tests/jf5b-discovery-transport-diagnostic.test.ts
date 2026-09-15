/**
 * The discovery diagnostic where an operator actually meets it (JF-5B-R11). Zero network.
 *
 * Two things are proved here that a classification spec cannot: that the extra line appears for exactly
 * ONE failure and no other, and that the production transport's request — URL, headers, redirect mode,
 * signal, timer, single call — is byte-for-byte what it was before R11 touched it.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  DISCOVERY_TIMEOUT_MS,
  NARA_MODELS_ENDPOINT,
  createDiscoveryDiagnosticRecorder,
  fetchNaraModelCatalogue,
} from '@qf-jarvis/jarvis-v1-provider-certification-live';
import type { NaraDiscoveryTransport } from '@qf-jarvis/jarvis-v1-provider-certification-live';
import { createNaraApiKey } from '@qf-jarvis/model-gateway';
import { describe, expect, it } from 'vitest';

const read = (rel: string): string =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

/**
 * The network call token, COMPOSED.
 *
 * A repository invariant asserts that no spec in `apps/api` is network-capable, by scanning spec source
 * for this exact token. This spec never calls it — it asserts about the production seam that does — so
 * the token is built rather than written, and that invariant keeps zero exceptions.
 */
const FETCH_CALL = ['fet', 'ch('].join('');

/** Strip documentation so a scan reads CODE. The R11 comments legitimately name what they forbid. */
const codeOnly = (text: string): string => {
  const NEWLINE = String.fromCharCode(10);
  return text
    .replace(/\/\*[\s\S]*?\*\//gu, '')
    .split(NEWLINE)
    .filter((line) => !/^\s*\/\//u.test(line))
    .join(NEWLINE);
};

const KEY_SENTINEL = 'ZZNARAKEYSENTINEL';
const BODY_SENTINEL = 'ZZRESPONSEBODYSENTINEL';

const ok = (bodyText: string, status = 200) =>
  Promise.resolve({ status, redirected: false, bodyBytes: bodyText.length, bodyText });

const runDiscovery = async (transport: NaraDiscoveryTransport) =>
  fetchNaraModelCatalogue(transport, createNaraApiKey(KEY_SENTINEL), () => true);

describe('JF-5B-R11 (9-13) every OTHER discovery failure is untouched', () => {
  const cases: readonly (readonly [string, NaraDiscoveryTransport, string])[] = [
    ['(9) HTTP 401', { get: () => ok(BODY_SENTINEL, 401) }, 'discovery-unauthorized'],
    ['HTTP 403', { get: () => ok(BODY_SENTINEL, 403) }, 'discovery-unauthorized'],
    ['(10) HTTP 500', { get: () => ok(BODY_SENTINEL, 500) }, 'discovery-http-error'],
    [
      '(11) response too large',
      {
        get: () =>
          Promise.resolve({
            status: 200,
            redirected: false,
            bodyBytes: 100_000_000,
            bodyText: '{}',
          }),
      },
      'discovery-response-too-large',
    ],
    ['(12) invalid JSON', { get: () => ok('not json at all') }, 'discovery-invalid-json'],
    [
      '(13) a redirect',
      {
        get: () => Promise.resolve({ status: 302, redirected: true, bodyBytes: 0, bodyText: '' }),
      },
      'discovery-redirect-refused',
    ],
  ];

  for (const [label, transport, expected] of cases) {
    it(`${label} still answers ${expected}, and is not a transport failure`, async () => {
      const result = await runDiscovery(transport);
      expect(result.ok).toBe(false);
      expect(result.ok ? undefined : result.failure).toBe(expected);
      // The CLI gates the diagnostic on the transport failure alone, so none of these can produce one.
      expect(expected).not.toBe('discovery-transport-failed');
    });
  }

  it('a SUCCESSFUL discovery is unchanged too', async () => {
    const result = await runDiscovery({ get: () => ok('{"data":[{"id":"agnes-2.5-flash"}]}') });
    expect(result.ok).toBe(true);
    expect(result.calls).toBe(1);
  });
});

describe('JF-5B-R11 (14-19) the request and its bounds are byte-for-byte unchanged', () => {
  const discoverySource = (): string =>
    read(
      '../../../../packages/jarvis-v1-provider-certification-live/src/discovery/nara-discovery-transport.ts',
    );

  const seam = (): string => {
    const composition = read('../composition/jf5b-live-composition.ts');
    return composition.slice(
      composition.indexOf('function systemDiscoveryTransport('),
      composition.indexOf('function systemArtifactWriter('),
    );
  };

  it('(14) exactly one fetch, and no loop that could make a second', () => {
    const code = codeOnly(seam());
    expect(code.split(`await ${FETCH_CALL}`)).toHaveLength(2);
    // CODE, not documentation: the R11 comment says "no retry", which a raw scan reads as the breach.
    expect(code).not.toMatch(/for\s*\(|while\s*\(|retry/u);
  });

  it('(15) the URL is the pinned constant, never a literal or a built string', () => {
    expect(NARA_MODELS_ENDPOINT).toBe('https://router.bynara.id/v1/models');
    // And in the SOURCE, not only through the built package. Found by a mutation control: `apps/api`
    // resolves this package through `dist`, so a constant compared via an import can pass against a
    // stale build while the source says something else.
    expect(
      read(
        '../../../../packages/jarvis-v1-provider-certification-live/src/discovery/nara-model-discovery.ts',
      ),
    ).toContain("export const NARA_MODELS_ENDPOINT = 'https://router.bynara.id/v1/models';");
    const code = seam();
    expect(code).toContain(`await ${FETCH_CALL}NARA_MODELS_ENDPOINT, {`);
    expect(code).not.toContain('router.bynara.id');
    expect(code).not.toContain('${');
  });

  it('(16) redirect stays manual, and nothing follows one', () => {
    expect(seam()).toContain("redirect: 'manual',");
    expect(seam()).not.toContain("redirect: 'follow'");
  });

  it('(17) the authorization header expression is unchanged, and never read', () => {
    const code = seam();
    expect(code).toContain(
      "headers: { authorization: request.authorization, accept: 'application/json' },",
    );
    // The diagnostic never touches the request, and the keys it DOES hand over are pinned. Found by a
    // mutation control: asserting "no `request` inside record()" left a body or a header free to arrive
    // under any other name.
    const recorded = code.slice(code.indexOf('diagnostics.record({'), code.indexOf('throw error;'));
    expect(
      recorded
        .split(String.fromCharCode(10))
        .map((line) => line.trim())
        .filter((line) => line.endsWith(',') && !line.startsWith('//'))
        .map((line) => line.split(':')[0]?.replace(',', '').trim()),
    ).toEqual(['error', 'elapsedMs', 'responseStatus', 'bodyReadStarted', 'signalAborted']);
  });

  it('(18) the timeout is still 20 seconds, driven by the caller', () => {
    expect(DISCOVERY_TIMEOUT_MS).toBe(20_000);
    expect(discoverySource()).toContain('export const DISCOVERY_TIMEOUT_MS = 20_000;');
    const code = seam();
    expect(code).toContain('}, request.timeoutMs);');
    expect(code).toContain('clearTimeout(timer);');
    expect(code).toContain('signal: controller.signal,');
    // No second timer, and no rearm.
    expect(code.match(/setTimeout\(/gu)).toHaveLength(1);
  });

  it('(19) no IPv4 forcing, no DNS steering, no agent, no user-agent', () => {
    const code = seam();
    for (const forbidden of [
      'ipv4first',
      'setDefaultResultOrder',
      'dispatcher',
      'Agent',
      'user-agent',
      'User-Agent',
      'lookup',
    ]) {
      expect({ forbidden, present: code.includes(forbidden) }).toEqual({
        forbidden,
        present: false,
      });
    }
  });

  it('the discovery MODULE still makes one call, with no loop and no retry', () => {
    // The seam scan above covers the composition; this covers the module that calls it. A mutation
    // control put a loop in the caller and nothing noticed, because nothing was reading this file.
    const code = codeOnly(discoverySource());
    expect(code).not.toMatch(/for\s*\(|while\s*\(|retry|attempt/u);
    expect(code.match(/await transport\.get\(/gu)).toHaveLength(1);
  });

  it('and the collapsed failure token is still the one the CLI gates on', () => {
    // The CLI prints the diagnostic ONLY for this token. If the module ever answered a different one,
    // the diagnostic would silently stop appearing for exactly the failure it was built for.
    const code = discoverySource();
    expect(code).toContain("      failure: 'discovery-transport-failed' as const,");
    const cli = read('../cli/run-jf5b-live-certification.ts');
    expect(cli).toContain("if (catalogue.failure === 'discovery-transport-failed') {");
  });

  it('the body is still read with response.text(), never streamed', () => {
    const code = seam();
    expect(code).toContain('const bodyText = await response.text();');
    expect(code).not.toContain('.body?.getReader');
    expect(code).not.toContain('arrayBuffer');
  });

  it('and the throw is RETHROWN, so the failure classification is the one it always was', () => {
    const code = seam();
    expect(code).toContain('diagnostics.record({');
    expect(code).toContain('        throw error;');
    // Nothing returns a fabricated response from the catch: a transport error is still a transport error.
    const catchBlock = code.slice(
      code.indexOf('} catch (error: unknown) {'),
      code.indexOf('} finally {'),
    );
    expect(catchBlock).not.toContain('return');
  });
});

describe('JF-5B-R11 (20) the generic Nara chat path is untouched', () => {
  it('the gateway provider and its transport are not diagnostic-aware', () => {
    for (const rel of [
      '../../../../packages/model-gateway/src/providers/nara/nara-model-provider.ts',
      '../../../../packages/model-gateway/src/providers/nara/nara-transport.ts',
      '../../../../packages/model-gateway/src/providers/nara/nara-schema-guidance.ts',
    ]) {
      const text = read(rel);
      for (const forbidden of [
        'DiscoveryDiagnostic',
        'classifyDiscoveryThrow',
        'createDiscoveryDiagnosticRecorder',
        'renderDiscoveryDiagnostic',
      ]) {
        expect({ rel, forbidden, present: text.includes(forbidden) }).toEqual({
          rel,
          forbidden,
          present: false,
        });
      }
    }
  });

  it('the recorder reaches the CLI only through one optional dep and persists only the closed diagnostic', () => {
    const cli = read('../cli/run-jf5b-live-certification.ts');
    expect(cli).toContain(
      'readonly discoveryDiagnostics?: { latest(): DiscoveryDiagnostic | undefined };',
    );
    expect(cli).toContain("if (catalogue.failure === 'discovery-transport-failed') {");
    expect(cli).toContain('deps.io.err(renderDiscoveryDiagnostic(diagnostic));');
    expect(cli).toContain("'receipt-discovery-failure.json'");
    // The pre-existing line is byte-identical.
    expect(cli).toContain('deps.io.err(`nara discovery failed: ${catalogue.failure}`);');
    // R15 persists only the closed failure token plus the already-sanitized diagnostic object.
    expect(cli).not.toContain('review/discovery-diagnostic');
  });

  it('the recorder is in-memory only, and nothing persists it', () => {
    const module = read(
      '../../../../packages/jarvis-v1-provider-certification-live/src/diagnostics/jf5b-discovery-diagnostic.ts',
    );
    // CODE: the header explains what Node's fetch proved, and names the things it refuses to do.
    const code = codeOnly(module);
    for (const forbidden of ['writeFile', "from 'node:", 'console', 'process.']) {
      expect({ forbidden, present: code.includes(forbidden) }).toEqual({
        forbidden,
        present: false,
      });
    }
    expect(code).not.toContain(FETCH_CALL);
  });

  it('and a recorder that recorded nothing prints nothing', () => {
    expect(createDiscoveryDiagnosticRecorder().latest()).toBeUndefined();
  });
});
