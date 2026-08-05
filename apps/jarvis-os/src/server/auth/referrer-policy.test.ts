import { describe, expect, it } from 'vitest';

import { SECURITY_HEADERS } from '../../proxy';
import { READ_ONLY_HEADERS } from '../control-plane/route-response';
import { AUTH_RESPONSE_HEADERS } from './response-headers';

/**
 * One referrer policy across the whole application (JOS-01D, ADR-0087).
 *
 * ### The defect this locks out
 *
 * Firefox derives a form submission's `Origin` header from the document's referrer policy. Under
 * `Referrer-Policy: no-referrer` a genuinely same-origin login POST arrived as `Origin: null`,
 * `requireSameOriginMutation` correctly refused it, and the operator saw a generic
 * invalid-credentials outcome for a request that was never cross-origin.
 *
 * Chromium does not behave this way, which is why every automated check and every scripted request
 * passed while a real browser could not sign in. A header value is not a cosmetic choice here — it
 * decides whether authentication works at all in one major browser.
 *
 * ### Why the constants, and not a source scan
 *
 * Jarvis OS is a powerless read surface: no module in this app may import `node:fs`, and a test
 * that grepped the sources would have had to break that rule to assert a header. The routes now
 * spread ONE shared constant instead of repeating three literals four times, so consistency is a
 * property of the code rather than something a scan has to police.
 */
describe('the referrer policy', () => {
  it('is same-origin on the page security headers', () => {
    expect(SECURITY_HEADERS['Referrer-Policy']).toBe('same-origin');
  });

  it('is same-origin on every authentication response', () => {
    expect(AUTH_RESPONSE_HEADERS['Referrer-Policy']).toBe('same-origin');
  });

  it('is same-origin on the control-plane API responses', () => {
    expect(READ_ONLY_HEADERS['Referrer-Policy']).toBe('same-origin');
  });

  it('agrees across every response surface', () => {
    // A value that differed between two redirect paths would produce an intermittent,
    // browser-specific authentication failure that nobody could reproduce reliably.
    const policies = [
      SECURITY_HEADERS['Referrer-Policy'],
      AUTH_RESPONSE_HEADERS['Referrer-Policy'],
      READ_ONLY_HEADERS['Referrer-Policy'],
    ];
    expect(new Set(policies).size, `saw ${policies.join(', ')}`).toBe(1);
    expect(policies[0]).toBe('same-origin');
  });

  it('never reverts to no-referrer', () => {
    for (const headers of [SECURITY_HEADERS, AUTH_RESPONSE_HEADERS, READ_ONLY_HEADERS]) {
      expect(headers['Referrer-Policy']).not.toBe('no-referrer');
    }
  });

  it('leaks nothing off-site', () => {
    // The property that makes this safe. `same-origin` sends a referrer only to ourselves and
    // NOTHING to any other origin, so no operator URL leaves the application. Each rejected value
    // below would send something cross-origin.
    for (const headers of [SECURITY_HEADERS, AUTH_RESPONSE_HEADERS, READ_ONLY_HEADERS]) {
      const policy = headers['Referrer-Policy'] ?? '';
      for (const leaky of [
        'unsafe-url',
        'no-referrer-when-downgrade',
        'origin-when-cross-origin',
        'strict-origin-when-cross-origin',
        'origin',
      ]) {
        expect(policy, leaky).not.toBe(leaky);
      }
      expect(policy).toBe('same-origin');
    }
  });

  it('keeps authentication responses uncacheable and unsniffable', () => {
    // Guards the refactor that introduced the shared constant: these travelled with the referrer
    // policy in each hand-written block and must not have been dropped along the way.
    expect(AUTH_RESPONSE_HEADERS['Cache-Control']).toBe('no-store, private');
    expect(AUTH_RESPONSE_HEADERS['X-Content-Type-Options']).toBe('nosniff');
  });
});
