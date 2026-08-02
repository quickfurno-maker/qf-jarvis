/**
 * QFJ-P05.05 — the canonical action content fingerprint (ADR-0079).
 *
 * The digest is what will let a human approving an action later be told, mechanically, whether the
 * action still says what it said when it was proposed. So these specs are less about "does SHA-256
 * work" and more about the two properties that make the value meaningful:
 *
 *   1. it binds CONTENT, so identity may change without changing it;
 *   2. it binds ALL the content, so nothing in it may change without changing it.
 *
 * The golden vector at the bottom locks the exact bytes. Changing the canonicalization, the covered
 * field set, or the domain separator produces different digests for unchanged actions — which would
 * silently invalidate every fingerprint already stored in an approval record. That is a governed
 * contract change, and this test is the thing that refuses to let it happen quietly.
 */
import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import type { ProposedAction } from '@qf-jarvis/contracts';

import { RecommendationRuntimeError, fingerprintProposedAction } from '../index.js';
import { ACTION_CONTENT_DOMAIN_SEPARATOR, actionContentPreimage } from '../internal/fingerprint.js';
import { canonicalJson } from '../internal/canonical-json.js';

/** The GOLDEN action. Nested objects, a nested array, mixed key order, and non-ASCII text. */
const GOLDEN: ProposedAction = {
  actionId: '3f2b1c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d',
  actionType: 'schedule.follow-up',
  actionContractVersion: 1,
  summary: 'Schedule a follow-up with the vendor about the delayed sample.',
  parameters: {
    zeta: true,
    alpha: { nested: ['b', 'a', { y: 2, x: 1 }], count: 3 },
    channel: 'whatsapp',
    delayHours: 48,
    beta: null,
    unicode: 'café — naïve',
  },
};

/** The exact canonical JSON of the GOLDEN action's content. Locked. */
const GOLDEN_CANONICAL_JSON =
  '{"actionContractVersion":1,"actionType":"schedule.follow-up","parameters":' +
  '{"alpha":{"count":3,"nested":["b","a",{"x":1,"y":2}]},"beta":null,"channel":"whatsapp",' +
  '"delayHours":48,"unicode":"café — naïve","zeta":true},' +
  '"summary":"Schedule a follow-up with the vendor about the delayed sample."}';

/** The exact lowercase SHA-256 digest. Locked. Computed, never hand-written. */
const GOLDEN_DIGEST = '0d07abff3f73037b3e4424574e93ae3db0c47c5aeea0140f93a5f408c37950e5';

function action(over: Partial<ProposedAction> = {}): ProposedAction {
  return { ...GOLDEN, ...over };
}

describe('the golden vector', () => {
  it('locks the exact canonical JSON, preimage and digest', () => {
    expect(ACTION_CONTENT_DOMAIN_SEPARATOR).toBe('qf-jarvis.proposed-action-content.v1\n');
    expect(actionContentPreimage(GOLDEN)).toBe(
      `${ACTION_CONTENT_DOMAIN_SEPARATOR}${GOLDEN_CANONICAL_JSON}`,
    );
    expect(fingerprintProposedAction(GOLDEN)).toBe(GOLDEN_DIGEST);
  });

  it('is reproducible by anyone with the preimage and a SHA-256', () => {
    // The digest is not a secret and not a signature: it is publicly computable by construction.
    const independent = createHash('sha256')
      .update(`${ACTION_CONTENT_DOMAIN_SEPARATOR}${GOLDEN_CANONICAL_JSON}`, 'utf8')
      .digest('hex');
    expect(independent).toBe(GOLDEN_DIGEST);
  });

  it('is 64 lowercase hex characters', () => {
    expect(fingerprintProposedAction(GOLDEN)).toMatch(/^[a-f0-9]{64}$/);
  });
});

describe('the fingerprint binds CONTENT, not identity', () => {
  it('is unchanged when only the actionId differs', () => {
    // The load-bearing property. `ApprovalRequestV1` carries `proposedActionId` separately, so
    // folding identity into the digest would make two identical actions incomparable -- and
    // comparing them is the only thing the digest is for.
    const other = action({ actionId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee' });
    expect(other.actionId).not.toBe(GOLDEN.actionId);
    expect(fingerprintProposedAction(other)).toBe(fingerprintProposedAction(GOLDEN));
  });

  it('is identical for two structurally identical actions', () => {
    expect(fingerprintProposedAction(action())).toBe(fingerprintProposedAction(action()));
  });
});

describe('the fingerprint binds ALL of the content', () => {
  it('changes when the action type, contract version or summary changes', () => {
    const base = fingerprintProposedAction(GOLDEN);
    expect(fingerprintProposedAction(action({ actionType: 'schedule.follow.up' }))).not.toBe(base);
    expect(fingerprintProposedAction(action({ actionContractVersion: 2 }))).not.toBe(base);
    // Trailing padding is refused by `boundedText` before it can reach a digest, so the summary
    // edit here is a legitimate one: a different sentence.
    expect(
      fingerprintProposedAction(
        action({ summary: 'Schedule a follow-up with the client about the delayed sample.' }),
      ),
    ).not.toBe(base);
  });

  it('changes on a whitespace-only summary edit', () => {
    // The quiet edit a reviewer would never spot by eye is exactly the one this must catch.
    const spaced = action({
      summary: 'Schedule a follow-up with the vendor  about the delayed sample.',
    });
    expect(fingerprintProposedAction(spaced)).not.toBe(fingerprintProposedAction(GOLDEN));
  });

  it('changes when any parameter value changes', () => {
    const base = fingerprintProposedAction(GOLDEN);
    for (const parameters of [
      { ...GOLDEN.parameters, delayHours: 49 },
      { ...GOLDEN.parameters, channel: 'sms' },
      { ...GOLDEN.parameters, zeta: false },
      { ...GOLDEN.parameters, beta: 'null' },
      { ...GOLDEN.parameters, alpha: { nested: ['b', 'a', { y: 2, x: 1 }], count: 4 } },
    ]) {
      expect(fingerprintProposedAction(action({ parameters }))).not.toBe(base);
    }
  });

  it('changes when a parameter is added or removed', () => {
    const base = fingerprintProposedAction(GOLDEN);
    expect(
      fingerprintProposedAction(action({ parameters: { ...GOLDEN.parameters, extra: 1 } })),
    ).not.toBe(base);
    const { zeta: _removed, ...without } = GOLDEN.parameters;
    expect(fingerprintProposedAction(action({ parameters: without }))).not.toBe(base);
  });

  it('changes on an exact Unicode difference', () => {
    // `café` composed (U+00E9) vs decomposed (e + U+0301) render identically and are different
    // bytes. The digest reports the difference rather than normalizing it away.
    const decomposed = action({
      parameters: { ...GOLDEN.parameters, unicode: 'café — naïve' },
    });
    expect(fingerprintProposedAction(decomposed)).not.toBe(fingerprintProposedAction(GOLDEN));
  });
});

describe('canonicalization', () => {
  it('is invariant to object key insertion order, including nested objects', () => {
    const reordered = action({
      parameters: {
        unicode: 'café — naïve',
        beta: null,
        delayHours: 48,
        channel: 'whatsapp',
        alpha: { count: 3, nested: ['b', 'a', { x: 1, y: 2 }] },
        zeta: true,
      },
    });
    expect(fingerprintProposedAction(reordered)).toBe(GOLDEN_DIGEST);
  });

  it('is SENSITIVE to array order, including nested arrays', () => {
    // Array order is meaning, not layout. Two steps in the other order are a different action.
    const swapped = action({
      parameters: { ...GOLDEN.parameters, alpha: { nested: ['a', 'b', { y: 2, x: 1 }], count: 3 } },
    });
    expect(fingerprintProposedAction(swapped)).not.toBe(GOLDEN_DIGEST);
  });

  it('sorts keys lexicographically and preserves strings exactly', () => {
    expect(canonicalJson({ b: 1, a: 2, C: 3 })).toBe('{"C":3,"a":2,"b":1}');
    expect(canonicalJson({ s: 'a"b\\c\nd' })).toBe('{"s":"a\\"b\\\\c\\nd"}');
    expect(canonicalJson([3, 1, 2])).toBe('[3,1,2]');
    expect(canonicalJson({ t: true, f: false, n: null })).toBe('{"f":false,"n":null,"t":true}');
  });

  it('refuses values that have no canonical form, rather than coercing them', () => {
    // Each of these is something `JSON.stringify` would silently turn into a different value.
    for (const value of [
      undefined,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      () => 1,
      1n,
      Symbol('x'),
    ]) {
      expect(() => canonicalJson({ v: value }), String(value)).toThrow();
    }
    expect(() => canonicalJson({ d: new Date() })).toThrow();
    const cyclic: Record<string, unknown> = {};
    cyclic['self'] = cyclic;
    expect(() => canonicalJson(cyclic)).toThrow();
  });
});

describe('input handling', () => {
  it('never mutates the action it is given', () => {
    const subject = action();
    const before = JSON.stringify(subject);
    fingerprintProposedAction(subject);
    expect(JSON.stringify(subject)).toBe(before);
    expect(Object.isFrozen(subject)).toBe(false);
  });

  it('refuses a malformed action rather than digesting it', () => {
    // A well-formed digest of malformed content is worse than a refusal: it looks correct.
    for (const bad of [
      { ...GOLDEN, actionId: 'not-a-uuid' },
      { ...GOLDEN, actionContractVersion: 0 },
      { ...GOLDEN, actionType: 'Not A Machine Token' },
      { ...GOLDEN, summary: '' },
      { ...GOLDEN, parameters: 'not an object' },
      { ...GOLDEN, extra: true },
      undefined,
      null,
      'action',
    ]) {
      expect(() => fingerprintProposedAction(bad as unknown as ProposedAction)).toThrow(
        RecommendationRuntimeError,
      );
    }
  });

  it('refuses governed content that a proposed action may never carry', () => {
    // The contracts scan is the authority here; this proves the runtime does not bypass it.
    for (const parameters of [
      { approved: true },
      { authorization: 'granted' },
      { apiKey: 'sk-live-abc' },
      { phone: '+919876543210' },
      { email: 'someone@example.com' },
      { transcript: 'the caller said...' },
      { systemPrompt: 'you are...' },
    ]) {
      const attempt = (): unknown => fingerprintProposedAction(action({ parameters }));
      expect(attempt, JSON.stringify(parameters)).toThrow(RecommendationRuntimeError);
      try {
        attempt();
      } catch (error) {
        // And the refusal says nothing about what it refused.
        const message = (error as Error).message;
        expect(message).toBe('A recommendation input is invalid.');
        for (const secret of ['sk-live-abc', '9876543210', 'someone@example.com', 'the caller']) {
          expect(message).not.toContain(secret);
        }
      }
    }
  });
});
