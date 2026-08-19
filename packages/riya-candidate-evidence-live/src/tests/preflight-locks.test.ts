/**
 * The identities preflight cannot usefully check at runtime.
 *
 * Preflight compares things that VARY: the operator's paths, the smoke config on disk, the prompt
 * bytes resolved out of the registry, the digest recomputed from the canonical object. It does not
 * compare a compile-time literal against itself, because that is dead code wearing the costume of a
 * guard — TypeScript already proves it, and the `if` could never fire.
 *
 * The locks belong here instead, where a drifted value fails something. This file is the reason it
 * was safe to delete those runtime checks.
 */
import {
  RIYA_SAFETY_FIXTURE_MANIFEST_VERSION,
  RIYA_SAFETY_SUITE_VERSION,
} from '@qf-jarvis/riya-candidate-evaluation-runner';
import {
  RIYA_QUALITY_GOLDEN_FIXTURE_MANIFEST_VERSION,
  RIYA_QUALITY_GOLDEN_SUITE_VERSION,
} from '@qf-jarvis/riya-quality-evaluation/testing';
import { describe, expect, it } from 'vitest';

import { MAX_ESTIMATED_COST_USD, MAX_PROVIDER_REQUESTS } from '../accounting.js';
import {
  CANDIDATE_ALLOW_FALLBACK,
  CANDIDATE_CAPABILITY_PROFILE_REF,
  CANDIDATE_CONFIG_DIGEST,
  CANDIDATE_DATA_CONTROLS_REF,
  CANDIDATE_MODEL_ID,
  CANDIDATE_RELEASE,
  CANDIDATE_RETRY_BUDGET,
  CANDIDATE_SUPPORTS_STRICT_JSON,
  RIYA_CLIENT_PROMPT_DIGEST,
} from '../candidate-release.js';
import { EXPECTED_SMOKE_CONFIG_DIGEST, WORST_CASE_REQUEST_USD } from '../preflight.js';

describe('the candidate identity is exact and has no wildcard in it', () => {
  it('names one release, one provider, one model and one catalogue snapshot', () => {
    expect(CANDIDATE_RELEASE.releaseId).toBe('rel.groq.qfj.riya-candidate.gpt-oss-20b.v1');
    expect(CANDIDATE_RELEASE.providerId).toBe('groq');
    expect(CANDIDATE_RELEASE.modelId).toBe('openai/gpt-oss-20b');
    expect(CANDIDATE_MODEL_ID).toBe('openai/gpt-oss-20b');
    expect(CANDIDATE_RELEASE.modelVersion).toBe('groq-catalog-snapshot-2026-08-12');
    expect(CANDIDATE_RELEASE.executionClass).toBe('HOSTED');
    expect(CANDIDATE_RELEASE.configDigest).toBe(CANDIDATE_CONFIG_DIGEST);
  });

  it('NO LATEST, NO WILDCARD, NO RANGE ANYWHERE IN THE IDENTITY', () => {
    // Evidence is only ever evidence about a named thing. A floating alias would let a suite pass
    // against one model and a rollout consume it against another.
    for (const value of Object.values(CANDIDATE_RELEASE)) {
      expect(value).not.toContain('latest');
      expect(value).not.toContain('*');
      expect(value).not.toMatch(/[~^]/u);
    }
  });

  it('the config digest is 64 lowercase hex characters, computed rather than typed', () => {
    expect(CANDIDATE_CONFIG_DIGEST).toMatch(/^[0-9a-f]{64}$/u);
  });

  it('binds the governed capability and data-controls references', () => {
    expect(CANDIDATE_CAPABILITY_PROFILE_REF).toBe(
      'cap.groq.openai-gpt-oss-20b.strict-json.2026-07-28',
    );
    expect(CANDIDATE_DATA_CONTROLS_REF).toBe('att.groq.qfj-staging.global-zdr.2026-07-28');
  });

  it('the reviewed Riya prompt digest is the one from PR #117', () => {
    expect(RIYA_CLIENT_PROMPT_DIGEST).toBe(
      'd0c2da57f53c2541274e090b8dec997c885f65f60c6bd8467e98d0be684b71fb',
    );
  });

  it('expects the governed smoke configuration by digest', () => {
    expect(EXPECTED_SMOKE_CONFIG_DIGEST).toBe(
      '4f97ef1e9e46905db253912bd56dab8aea4f38e4d606dfe93b16fc024f0c2be1',
    );
  });
});

describe('the governed corpus versions are pinned', () => {
  it('safety is manifest 4 / suite 2', () => {
    expect(RIYA_SAFETY_FIXTURE_MANIFEST_VERSION).toBe(4);
    expect(RIYA_SAFETY_SUITE_VERSION).toBe(2);
  });

  it('P10 is manifest 2 / suite 1, untouched by this phase', () => {
    expect(RIYA_QUALITY_GOLDEN_FIXTURE_MANIFEST_VERSION).toBe(2);
    expect(RIYA_QUALITY_GOLDEN_SUITE_VERSION).toBe(1);
  });
});

describe('the execution posture leaves no room for a retry or a second provider', () => {
  it('strict JSON required, fallback off, retry budget zero', () => {
    expect(CANDIDATE_SUPPORTS_STRICT_JSON).toBe(true);
    expect(CANDIDATE_ALLOW_FALLBACK).toBe(false);
    expect(CANDIDATE_RETRY_BUDGET).toBe(0);
  });

  it('the ceilings are 83 requests and USD 5.00', () => {
    expect(MAX_PROVIDER_REQUESTS).toBe(83);
    expect(MAX_ESTIMATED_COST_USD).toBe(5);
  });

  it('THE RESERVATION BOUND STILL FITS UNDER THE CEILING AT TODAY’S RATES', () => {
    // The one lock that can genuinely break without anybody editing this repository: a published
    // price rise. Preflight runs the same arithmetic and refuses before a credential is read.
    expect(WORST_CASE_REQUEST_USD).toBeCloseTo(0.0294912, 7);
    expect(WORST_CASE_REQUEST_USD * MAX_PROVIDER_REQUESTS).toBeLessThan(MAX_ESTIMATED_COST_USD);
  });
});
