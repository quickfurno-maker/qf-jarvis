/**
 * JF-5B-R25: historical Nara discovery remains auditable, but the current live executable has no
 * discovery transport, credential seam, diagnostics recorder, or network call for Nara.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  NARA_MODELS_ENDPOINT,
  fetchNaraModelCatalogue,
} from '@qf-jarvis/jarvis-v1-provider-certification-live';
import type { NaraDiscoveryTransport } from '@qf-jarvis/jarvis-v1-provider-certification-live';
import { createNaraApiKey } from '@qf-jarvis/model-gateway';
import { describe, expect, it } from 'vitest';

const read = (rel: string): string =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

const KEY = createNaraApiKey('ZZNARAKEYSENTINEL');
const ok = (bodyText: string, status = 200) =>
  Promise.resolve({ status, redirected: false, bodyBytes: bodyText.length, bodyText });
const discover = (transport: NaraDiscoveryTransport) =>
  fetchNaraModelCatalogue(transport, KEY, () => true);
describe('historical Nara discovery library remains reproducible', () => {
  it('keeps the historical endpoint identity', () => {
    expect(NARA_MODELS_ENDPOINT).toBe('https://router.bynara.id/v1/models');
  });

  it.each([
    [401, 'discovery-unauthorized'],
    [403, 'discovery-unauthorized'],
    [500, 'discovery-http-error'],
  ] as const)('classifies HTTP %s without retrying', async (status, reason) => {
    let calls = 0;
    const result = await discover({
      get: () => {
        calls += 1;
        return ok('{}', status);
      },
    });
    expect(result.ok).toBe(false);
    expect(result.ok ? undefined : result.failure).toBe(reason);
    expect(calls).toBe(1);
  });

  it('still parses a successful historical catalogue through the library seam', async () => {
    const result = await discover({
      get: () => ok('{"data":[{"id":"historical/model"}]}'),
    });
    expect(result.ok).toBe(true);
    expect(result.calls).toBe(1);
  });
});
describe('JF-5B-R25 current live composition contains no Nara discovery surface', () => {
  const composition = () => read('../composition/jf5b-live-composition.ts');
  const cli = () => read('../cli/run-jf5b-live-certification.ts');

  it('contains no Nara discovery transport or endpoint reference', () => {
    expect(composition()).not.toContain('systemDiscoveryTransport');
    expect(composition()).not.toContain('NARA_MODELS_ENDPOINT');
    expect(composition()).not.toContain('fetchNaraModelCatalogue');
    expect(composition()).not.toContain('createNaraApiKey');
  });

  it('contains no direct fetch in the certification composition', () => {
    const token = ['fet', 'ch('].join('');
    expect(composition()).not.toContain(token);
  });

  it('carries no discovery diagnostic dependency into the live CLI', () => {
    expect(cli()).not.toContain('discoveryDiagnostics');
    expect(cli()).not.toContain('discovery-transport-failed');
    expect(cli()).not.toContain('NARA_SELECTION');
  });

  it('states the release posture directly instead of retaining a dormant candidate path', () => {
    expect(cli()).toContain('provider mode GROQ_ONLY; Nara is disabled and was not contacted.');
  });
});
