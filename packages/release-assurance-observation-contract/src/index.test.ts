import { describe, expect, it } from 'vitest';

import {
  RELEASE_ASSURANCE_OBSERVATION_PROTOCOL,
  parseReleaseAssuranceObservation,
} from './index.js';

function fixture() {
  return {
    protocol: RELEASE_ASSURANCE_OBSERVATION_PROTOCOL,
    emittedAt: '2026-09-24T19:30:00.000Z',
    releaseSha: 'a'.repeat(40),
    dimensions: [
      {
        id: 'release-identity',
        label: 'Exact release identity',
        state: 'HEALTHY',
        detail: 'Running image is bound to the exact reviewed Git revision.',
      },
    ],
  };
}

describe('release assurance observation contract', () => {
  it('accepts bounded content-free exact-release evidence', () => {
    expect(parseReleaseAssuranceObservation(fixture())).toEqual(fixture());
  });

  it('refuses content fields and non-exact revisions', () => {
    expect(() =>
      parseReleaseAssuranceObservation({
        ...fixture(),
        releaseSha: 'main',
      }),
    ).toThrow();

    expect(() =>
      parseReleaseAssuranceObservation({
        ...fixture(),
        rawLog: 'must never reach Jarvis OS',
      }),
    ).toThrow();
  });
});
