/**
 * The validation API: how it fails, and what it refuses to say while failing.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  cloneFixture,
  validActionableRecommendation,
  validExecutionIntent,
} from '../fixtures/index.js';
import {
  ContractValidationError,
  parseExecutionIntent,
  parseRecommendation,
  safeParseExecutionIntent,
  safeParseRecommendation,
} from '../index.js';

describe('parse throws a structured error; safeParse returns one', () => {
  it('parse returns the value on success', () => {
    const parsed = parseRecommendation(cloneFixture(validActionableRecommendation));
    expect(parsed.producingSystem).toBe('qf-jarvis');
  });

  it('parse throws a ContractValidationError naming the contract and the issues', () => {
    let thrown: unknown;
    try {
      parseRecommendation({ nonsense: true });
    } catch (error: unknown) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(ContractValidationError);
    if (thrown instanceof ContractValidationError) {
      expect(thrown.contract).toBe('RecommendationV1');
      expect(thrown.issues.length).toBeGreaterThan(0);
      expect(thrown.name).toBe('ContractValidationError');
    }
  });

  it('safeParse never throws, and says explicitly whether it succeeded', () => {
    const ok = safeParseRecommendation(cloneFixture(validActionableRecommendation));
    expect(ok.success).toBe(true);

    const bad = safeParseRecommendation({ nonsense: true });
    expect(bad.success).toBe(false);
    if (!bad.success) {
      expect(bad.error).toBeInstanceOf(ContractValidationError);
    }
  });

  it('accepts unknown, which is honestly what arrives at a trust boundary', () => {
    const inputs: unknown[] = [null, undefined, 0, '', [], 'a string', { a: 1 }];

    for (const input of inputs) {
      expect(safeParseRecommendation(input).success).toBe(false);
    }
  });

  it('names the offending field by path', () => {
    const forged = { ...cloneFixture(validActionableRecommendation), confidence: 5 };

    const result = safeParseRecommendation(forged);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.path === 'confidence')).toBe(true);
    }
  });
});

describe('an error names the field, and never echoes the value', () => {
  it('does not leak a credential it just refused', () => {
    const secret = 'FAKE-CREDENTIAL-VALUE-b7f21c9e';

    const forged = {
      ...cloneFixture(validExecutionIntent),
      parameters: { templateId: 'client-followup-v2', apiKey: secret },
    };

    const result = safeParseExecutionIntent(forged);
    expect(result.success).toBe(false);

    if (!result.success) {
      // The validator that refuses a secret must not then record it. An exception
      // message becomes a log line, and a log line becomes a breach.
      const serialized = JSON.stringify(result.error.issues) + result.error.message;

      expect(serialized).not.toContain(secret);
      // It must still be useful: name the key, and the rule.
      expect(serialized).toContain('apiKey');
    }
  });

  it('does not leak a phone number it just refused', () => {
    const phone = '+919876543210';

    const forged = {
      ...cloneFixture(validExecutionIntent),
      parameters: { templateId: 'client-followup-v2', destination: phone },
    };

    const result = safeParseExecutionIntent(forged);
    expect(result.success).toBe(false);

    if (!result.success) {
      const serialized = JSON.stringify(result.error.issues) + result.error.message;
      expect(serialized).not.toContain(phone);
      expect(serialized).toContain('destination');
    }
  });

  it('does not dump the whole rejected payload into the error', () => {
    const marker = 'MARKER-VALUE-SHOULD-NOT-APPEAR-7f3a';

    const forged = { ...cloneFixture(validExecutionIntent), summaryNote: marker };

    const result = safeParseExecutionIntent(forged);
    expect(result.success).toBe(false);

    if (!result.success) {
      const serialized = JSON.stringify(result.error.issues) + result.error.message;
      // The unknown *key* is named — that is the finding. The *value* is not.
      expect(serialized).toContain('summaryNote');
      expect(serialized).not.toContain(marker);
    }
  });
});

describe('the package has no side effects', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('logs nothing while validating, on success or on failure', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => undefined);
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);

    safeParseRecommendation(cloneFixture(validActionableRecommendation));
    safeParseRecommendation({ nonsense: true });
    safeParseExecutionIntent({ parameters: { apiKey: 'FAKE' } });

    expect(log).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
    expect(debug).not.toHaveBeenCalled();
    expect(info).not.toHaveBeenCalled();
  });

  it('is deterministic: the same input yields the same issues, every time', () => {
    const forged = { ...cloneFixture(validExecutionIntent), issuer: 'qf-jarvis' };

    const first = safeParseExecutionIntent(cloneFixture(forged));
    const second = safeParseExecutionIntent(cloneFixture(forged));

    expect(first.success).toBe(false);
    expect(second.success).toBe(false);
    if (!first.success && !second.success) {
      expect(first.error.issues).toStrictEqual(second.error.issues);
    }
  });

  it('reads no clock: validation does not depend on now', () => {
    // An event that was valid when it was emitted must not become invalid because
    // it was replayed tomorrow. Replay is a first-class feature.
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2030-01-01T00:00:00Z'));

    const farFuture = safeParseExecutionIntent(cloneFixture(validExecutionIntent));

    vi.setSystemTime(new Date('2000-01-01T00:00:00Z'));
    const farPast = safeParseExecutionIntent(cloneFixture(validExecutionIntent));

    vi.useRealTimers();

    // The intent's expiry is in 2026 — long past in one run, far future in the
    // other. Both parse, because expiry is checked against issuance, not against
    // the wall clock. Whether an intent is *currently* expired is a runtime
    // decision, not a contract one.
    expect(farFuture.success).toBe(true);
    expect(farPast.success).toBe(true);
  });

  it('throws on a genuinely broken input rather than returning a half-parsed object', () => {
    expect(() => parseExecutionIntent(undefined)).toThrow(ContractValidationError);
  });
});
