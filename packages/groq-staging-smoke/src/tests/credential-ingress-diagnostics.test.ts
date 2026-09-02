/**
 * QFJ-S1D-E — credential-ingress diagnostics.
 *
 * S1D-C failed locally with a bare `smoke-credential-invalid`, which collapsed six distinct causes into
 * one word and left the operator nothing to act on. These specs pin the closed `credentialOutcome` that
 * names the exact branch — and pin, just as hard, the two things that must NOT have moved: which values
 * are accepted, and everything the output is forbidden to carry.
 *
 * Every test is offline. No real stdin, no real TTY, no network, no provider endpoint, no database.
 */
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createGroqApiKey, createManualClock, type GroqApiKey } from '@qf-jarvis/model-gateway';
import { fakeGroqTransport } from '@qf-jarvis/model-gateway/testing';
import { describe, expect, it } from 'vitest';

import {
  CREDENTIAL_OUTCOMES,
  createDiagnosticRecorder,
  type CredentialOutcome,
  type MonotonicClock,
} from '../diagnostic-telemetry.js';
import { formatSanitizedSmokeResult, parseSmokeConfig, runGroqStagingSmokeOnce } from '../index.js';
import {
  createMaskedTtyCredentialResolver,
  MAX_CREDENTIAL_LENGTH,
  MaskedSecretReadError,
  MIN_CREDENTIAL_LENGTH,
  type MaskedSecretSource,
} from '../masked-tty-credential-resolver.js';
import type { SmokeRunResult } from '../run-once.js';
import {
  manualSmokeTimer,
  scriptedSecretSource,
  smokeProbeResponseBody,
  syntheticSmokeConfigInput,
} from '../testing/index.js';

const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const PKG_DIR = new URL('../../', import.meta.url);

/** A valid sentinel: 36 chars, all within the allowed charset. Never a real credential. */
const VALID_SENTINEL = 'FAKE-STAGING-SENTINEL-DO-NOT-USE-0000';

function manualMonotonic(): MonotonicClock & { advance: (ms: number) => void } {
  const state = { now: 0 };
  return {
    nowMs: () => state.now,
    advance: (ms: number) => {
      state.now += ms;
    },
  };
}

function validConfig() {
  const parsed = parseSmokeConfig(syntheticSmokeConfigInput());
  if (!parsed.ok) {
    throw new Error('the synthetic smoke fixture must be valid');
  }
  return parsed.config;
}

/** A source whose read resolves with a chosen value, or rejects with a chosen error. */
function sourceThat(
  behaviour: { readonly value: string } | { readonly reject: unknown },
  interactive = true,
): MaskedSecretSource & { readonly reads: () => number } {
  const state = { reads: 0 };
  return {
    isInteractive: () => interactive,
    readOnce: () => {
      state.reads += 1;
      if ('value' in behaviour) {
        return Promise.resolve(behaviour.value);
      }
      // Rejecting with a NON-Error is deliberate and load-bearing here: it is exactly the condition
      // the `read-unavailable` fallback must survive. The rule guards against doing this by accident.
      // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
      return Promise.reject(behaviour.reject);
    },
    reads: () => state.reads,
  };
}

/** Run the whole harness offline with a chosen credential source. Never touches the network. */
function runWith(source: MaskedSecretSource): Promise<SmokeRunResult> {
  return runGroqStagingSmokeOnce(validConfig(), {
    transport: fakeGroqTransport(smokeProbeResponseBody()),
    credentialSource: source,
    clock: createManualClock(),
    timer: manualSmokeTimer(),
    diagnostics: createDiagnosticRecorder(manualMonotonic()),
  });
}

describe('(1) TTY refusal', () => {
  it('reports tty-required with zero attempts and zero resolutions', async () => {
    const transport = fakeGroqTransport(smokeProbeResponseBody());
    const result = await runGroqStagingSmokeOnce(validConfig(), {
      transport,
      credentialSource: scriptedSecretSource({ interactive: false }),
      clock: createManualClock(),
      timer: manualSmokeTimer(),
      diagnostics: createDiagnosticRecorder(manualMonotonic()),
    });
    expect(result.diagnostics.credentialOutcome).toBe('tty-required');
    expect(result.diagnostics.credentialReadAttempts).toBe(0);
    expect(result.diagnostics.credentialResolutions).toBe(0);
    expect(result.counters.invocations).toBe(0);
    expect(transport.calls()).toBe(0);
    // The gate ran before any read, so no read ever settled.
    expect(result.diagnostics.credentialReadSettledMs).toBeUndefined();
  });

  it('the resolver alone reports tty-required and counts no attempt', async () => {
    const source = sourceThat({ value: VALID_SENTINEL }, false);
    const resolver = createMaskedTtyCredentialResolver(source);
    await expect(resolver.resolve({ ref: 'r' })).rejects.toThrow();
    expect(resolver.outcome()).toBe('tty-required');
    expect(resolver.readAttempts()).toBe(0);
    expect(resolver.resolutions()).toBe(0);
    expect(source.reads()).toBe(0);
  });
});

describe('(2, 3) source failures are classified by TYPED identity, never by message', () => {
  it('(2) an explicit abort reports read-aborted with a settled milestone', async () => {
    const result = await runWith(sourceThat({ reject: new MaskedSecretReadError('aborted') }));
    expect(result.diagnostics.credentialOutcome).toBe('read-aborted');
    expect(result.diagnostics.credentialReadAttempts).toBe(1);
    expect(result.diagnostics.credentialResolutions).toBe(0);
    expect(typeof result.diagnostics.credentialReadSettledMs).toBe('number');
    expect(result.counters.invocations).toBe(0);
  });

  it('(3) a typed unavailable failure reports read-unavailable', async () => {
    const result = await runWith(sourceThat({ reject: new MaskedSecretReadError('unavailable') }));
    expect(result.diagnostics.credentialOutcome).toBe('read-unavailable');
    expect(result.diagnostics.credentialReadAttempts).toBe(1);
    expect(result.diagnostics.credentialResolutions).toBe(0);
    expect(result.counters.invocations).toBe(0);
  });

  it('(3) a FOREIGN rejection falls back to read-unavailable, never to read-aborted', async () => {
    // An error whose message says "aborted" must NOT be trusted — classification is typed only.
    const liar = new Error('the source aborted; Ctrl-C; ABORT_ERR');
    liar.name = 'AbortError';
    const result = await runWith(sourceThat({ reject: liar }));
    expect(result.diagnostics.credentialOutcome).toBe('read-unavailable');
    expect(result.diagnostics.credentialReadAttempts).toBe(1);
  });

  it('(3) a non-Error rejection also falls back to read-unavailable', async () => {
    const result = await runWith(sourceThat({ reject: 'aborted' }));
    expect(result.diagnostics.credentialOutcome).toBe('read-unavailable');
  });

  it('the production source raises the typed error and nothing else', () => {
    const source = readFileSync(
      fileURLToPath(new URL('src/masked-tty-credential-resolver.ts', PKG_DIR)),
      'utf8',
    );
    expect(source).toContain("reject(new MaskedSecretReadError('aborted'))");
    expect(source.match(/new MaskedSecretReadError\('unavailable'\)/g)).toHaveLength(2);
    // Classification never parses text.
    expect(source).not.toMatch(/\.message\b/);
    expect(source).toContain('error instanceof MaskedSecretReadError');
  });
});

describe('(4, 5, 6, 7) value rejections name the exact failing clause', () => {
  const cases: readonly { readonly why: CredentialOutcome; readonly value: string }[] = [
    { why: 'rejected-empty', value: '' },
    { why: 'rejected-too-short', value: 'a'.repeat(MIN_CREDENTIAL_LENGTH - 1) },
    { why: 'rejected-too-long', value: 'a'.repeat(MAX_CREDENTIAL_LENGTH + 1) },
    { why: 'rejected-charset', value: `${'a'.repeat(20)} ${'b'.repeat(10)}` },
  ];

  for (const { why, value } of cases) {
    it(`reports ${why}`, async () => {
      const result = await runWith(sourceThat({ value }));
      expect(result.diagnostics.credentialOutcome).toBe(why);
      expect(result.diagnostics.credentialReadAttempts).toBe(1);
      expect(result.diagnostics.credentialResolutions).toBe(0);
      expect(result.counters.invocations).toBe(0);
      expect(result.diagnostics.transportErrorCode).toBe('NONE');
      if (!result.ok) {
        // The existing sanitized reason and bind reason are unchanged.
        expect(result.reason).toBe('smoke-credential-invalid');
        expect(result.bindReason).toBe('groq-bind-credential-unavailable');
      }
    });
  }

  it('charset rejection covers quotes, brackets and tildes as well as spaces', async () => {
    for (const value of [
      `"${'a'.repeat(30)}"`,
      `[200~${'a'.repeat(30)}`,
      `${'a'.repeat(30)}.${'b'.repeat(5)}`,
    ]) {
      const result = await runWith(sourceThat({ value }));
      expect(result.diagnostics.credentialOutcome).toBe('rejected-charset');
    }
  });
});

describe('(8) holder rejection', () => {
  it('reports rejected-holder using an injected refusing holder', async () => {
    // This branch is unreachable with the real holder, because MAX (200) is far below the holder's
    // own 512 bound. The holder is injected here rather than weakening any production guard.
    const resolver = createMaskedTtyCredentialResolver(sourceThat({ value: VALID_SENTINEL }), {
      createHolder: () => {
        throw new Error('SYNTHETIC-HOLDER-REFUSAL');
      },
    });
    await expect(resolver.resolve({ ref: 'r' })).rejects.toThrow();
    expect(resolver.outcome()).toBe('rejected-holder');
    expect(resolver.readAttempts()).toBe(1);
    expect(resolver.resolutions()).toBe(0);
    expect(resolver.lastFailure()).toBe('smoke-credential-invalid');
  });

  it('the production holder is the default and is NOT weakened', () => {
    const source = readFileSync(
      fileURLToPath(new URL('src/masked-tty-credential-resolver.ts', PKG_DIR)),
      'utf8',
    );
    expect(source).toContain('options.createHolder ?? createGroqApiKey');
    // A value that passes the bounds always satisfies the real holder, which is why the branch is
    // unreachable in production — asserted rather than assumed.
    expect(() => createGroqApiKey(VALID_SENTINEL)).not.toThrow();
  });
});

describe('(9, 10) a resolved credential', () => {
  it('(9) reports resolved with one attempt and one resolution, offline', async () => {
    const transport = fakeGroqTransport(smokeProbeResponseBody());
    const result = await runGroqStagingSmokeOnce(validConfig(), {
      transport,
      credentialSource: sourceThat({ value: VALID_SENTINEL }),
      clock: createManualClock(),
      timer: manualSmokeTimer(),
      diagnostics: createDiagnosticRecorder(manualMonotonic()),
    });
    expect(result.ok).toBe(true);
    expect(result.diagnostics.credentialOutcome).toBe('resolved');
    expect(result.diagnostics.credentialReadAttempts).toBe(1);
    expect(result.diagnostics.credentialResolutions).toBe(1);
    expect(typeof result.diagnostics.credentialReadSettledMs).toBe('number');
    expect(typeof result.diagnostics.credentialResolvedMs).toBe('number');
    // Exactly one bind, one invocation, one fake-transport call. No network was reachable.
    expect(result.counters.binds).toBe(1);
    expect(result.counters.invocations).toBe(1);
    expect(transport.calls()).toBe(1);
  });

  it('(10) credentialReads equals credentialReadAttempts on every path', async () => {
    const sources: readonly MaskedSecretSource[] = [
      sourceThat({ value: VALID_SENTINEL }),
      sourceThat({ value: '' }),
      sourceThat({ value: 'short' }),
      sourceThat({ reject: new MaskedSecretReadError('aborted') }),
      sourceThat({ reject: new MaskedSecretReadError('unavailable') }),
      scriptedSecretSource({ interactive: false }),
    ];
    for (const source of sources) {
      const result = await runWith(source);
      expect(result.counters.credentialReads).toBe(result.diagnostics.credentialReadAttempts);
    }
  });

  it('a refused re-entry does not overwrite the first recorded outcome', async () => {
    const resolver = createMaskedTtyCredentialResolver(sourceThat({ value: VALID_SENTINEL }));
    await resolver.resolve({ ref: 'r' });
    expect(resolver.outcome()).toBe('resolved');
    await expect(resolver.resolve({ ref: 'r' })).rejects.toThrow();
    expect(resolver.outcome()).toBe('resolved');
    expect(resolver.readAttempts()).toBe(1);
    expect(resolver.resolutions()).toBe(1);
  });

  it('not-attempted is the default when the resolver is never entered', () => {
    expect(createDiagnosticRecorder(manualMonotonic()).snapshot().credentialOutcome).toBe(
      'not-attempted',
    );
  });
});

describe('(11, 12) nothing credential-derived can reach the output', () => {
  it('(11) no emitted surface carries length, prefix, suffix, hash, message, or the value', async () => {
    const distinctive = 'ZZPROBEVALUE0123456789ABCDEFGHIJ';
    const result = await runWith(sourceThat({ value: `${distinctive} bad` }));
    const surfaces = [
      JSON.stringify(result.diagnostics),
      JSON.stringify(result),
      formatSanitizedSmokeResult(result, '2026-07-29T00:00:00.000Z'),
    ];
    for (const surface of surfaces) {
      expect(surface).not.toContain(distinctive);
      expect(surface).not.toContain('ZZPROBE');
      expect(surface).not.toContain('SYNTHETIC-HOLDER-REFUSAL');
      expect(surface).not.toContain('QFJ_SMOKE_CREDENTIAL_REFUSED');
      expect(surface).not.toContain('QFJ_SMOKE_SECRET_READ_FAILED');
      expect(surface).not.toContain('Bearer');
      expect(surface.toLowerCase()).not.toContain('authorization');
      expect(surface).not.toContain('at Object.');
      // No length is derivable: the value was 36 chars, and no such count appears.
      expect(surface).not.toMatch(/credentialLength/);
      expect(surface).not.toMatch(/credentialPrefix|credentialSuffix|credentialHash/);
    }
  });

  it('(11) the label-vs-secret comparison result is never emitted', async () => {
    const result = await runWith(sourceThat({ value: 'qf-jarvis-staging-smoke-v1' }));
    const surface = formatSanitizedSmokeResult(result, 'T');
    expect(surface).not.toContain('qf-jarvis-staging-smoke-v1');
    expect(surface).not.toMatch(/label/i);
  });

  it('(12) the printed credential fields are exactly the approved names and scalar values', async () => {
    const result = await runWith(sourceThat({ value: VALID_SENTINEL }));
    const report = formatSanitizedSmokeResult(result, 'T');
    const credentialLines = report
      .split('\n')
      .filter((line) => line.toLowerCase().startsWith('credential'));
    const names = credentialLines.map((line) => line.split('=')[0]);
    expect(names.sort()).toEqual(
      [
        'credentialReads',
        'credentialReadSettledMs',
        'credentialResolvedMs',
        'credentialEntryMs',
        'credentialOutcome',
        'credentialReadAttempts',
        'credentialResolutions',
      ].sort(),
    );
    for (const line of credentialLines) {
      const [name, value] = line.split('=');
      expect(value).toBeDefined();
      if (name === 'credentialOutcome') {
        expect(CREDENTIAL_OUTCOMES).toContain(value as CredentialOutcome);
      } else {
        expect(value).toMatch(/^\d+$/);
      }
    }
  });
});

describe('(13, 14) acceptance semantics are UNCHANGED', () => {
  it('(14) the bounds and charset predicate are byte-for-byte the baseline rule', () => {
    // MVP-P2A.2 HF4-R5 moved the rule into `credential-policy.ts` so the clipboard ingress applies
    // THIS predicate rather than a second copy of it. The rule itself did not change — the assertions
    // below are the same bytes they always were, read from where they now live. Two ingresses sharing
    // one predicate is the point: a value is accepted, or refused with the same token, whichever door
    // it arrived through.
    const source = readFileSync(
      fileURLToPath(new URL('src/credential-policy.ts', PKG_DIR)),
      'utf8',
    );
    // And the masked resolver still exposes the two constants, so its own surface is unchanged.
    const masked = readFileSync(
      fileURLToPath(new URL('src/masked-tty-credential-resolver.ts', PKG_DIR)),
      'utf8',
    );
    expect(masked).toContain('export { MAX_CREDENTIAL_LENGTH, MIN_CREDENTIAL_LENGTH };');
    expect(source).toContain('export const MIN_CREDENTIAL_LENGTH = 20;');
    expect(source).toContain('export const MAX_CREDENTIAL_LENGTH = 200;');
    expect(source).toContain('const CREDENTIAL_PATTERN = /^[A-Za-z0-9_-]+$/;');
    expect(source).toContain(`function isBoundedCredential(value: string): boolean {
  return (
    value.length >= MIN_CREDENTIAL_LENGTH &&
    value.length <= MAX_CREDENTIAL_LENGTH &&
    CREDENTIAL_PATTERN.test(value)
  );
}`);
    // No trim was introduced into the shared policy, and none into the masked ingress: a value typed
    // at the prompt is still accepted or refused exactly as it was entered. (The clipboard ingress
    // strips SURROUNDING whitespace before applying this predicate, which can only remove characters
    // the charset already forbids — it is asserted in that ingress's own suite, not smuggled here.)
    expect(source).not.toMatch(/\.\s*trim\(\)/);
    expect(masked).not.toMatch(/typed\s*\.\s*trim\(\)/);
  });

  it('(14) accept/reject decisions match the baseline predicate across a corpus', async () => {
    const baseline = (v: string): boolean =>
      v.length >= MIN_CREDENTIAL_LENGTH &&
      v.length <= MAX_CREDENTIAL_LENGTH &&
      /^[A-Za-z0-9_-]+$/.test(v);
    const corpus = [
      VALID_SENTINEL,
      '',
      'a'.repeat(19),
      'a'.repeat(20),
      'a'.repeat(200),
      'a'.repeat(201),
      `${'a'.repeat(30)} `,
      ` ${'a'.repeat(30)}`,
      `"${'a'.repeat(30)}"`,
      'qf-jarvis-staging-smoke-v1',
      'gsk_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789abcdefghij',
    ];
    for (const value of corpus) {
      const resolver = createMaskedTtyCredentialResolver(sourceThat({ value }));
      const accepted = await resolver
        .resolve({ ref: 'r' })
        .then(() => true)
        .catch(() => false);
      expect({ value: value.length, accepted }).toEqual({
        value: value.length,
        accepted: baseline(value),
      });
    }
  });

  it('(13) the key label is still ACCEPTED — no label-specific guard was added', async () => {
    // Recording the S1D-D finding as an executable fact: the label satisfies the bounds, so the code
    // still cannot distinguish it from a secret. Closing that gap is a separate, reviewed decision.
    const resolver = createMaskedTtyCredentialResolver(
      sourceThat({ value: 'qf-jarvis-staging-smoke-v1' }),
    );
    const holder: GroqApiKey = await resolver.resolve({ ref: 'r' });
    expect(holder).toBeInstanceOf(Object);
    expect(resolver.outcome()).toBe('resolved');
    const source = readFileSync(
      fileURLToPath(new URL('src/masked-tty-credential-resolver.ts', PKG_DIR)),
      'utf8',
    );
    expect(source).not.toContain('qf-jarvis-staging-smoke-v1');
  });
});

describe('(15, 16, 17, 18, 19, 20, 21) behaviour locks', () => {
  it('(15) one read, one bind, one invocation, one fetch, zero retries', async () => {
    const transport = fakeGroqTransport(smokeProbeResponseBody());
    const result = await runGroqStagingSmokeOnce(validConfig(), {
      transport,
      credentialSource: sourceThat({ value: VALID_SENTINEL }),
      clock: createManualClock(),
      timer: manualSmokeTimer(),
      diagnostics: createDiagnosticRecorder(manualMonotonic()),
    });
    expect(result.counters.credentialReads).toBe(1);
    expect(result.counters.binds).toBe(1);
    expect(result.counters.invocations).toBe(1);
    expect(transport.calls()).toBe(1);
    expect(result.diagnostics.credentialResolutions).toBe(1);
  });

  it('(16) the timer is armed after credential resolution (HF4-R3)', async () => {
    const order: string[] = [];
    const timer = manualSmokeTimer();
    const result = await runGroqStagingSmokeOnce(validConfig(), {
      transport: fakeGroqTransport(smokeProbeResponseBody()),
      credentialSource: {
        isInteractive: () => true,
        readOnce: () => {
          order.push('read');
          return Promise.resolve(VALID_SENTINEL);
        },
      },
      clock: createManualClock(),
      timer: {
        arm: (ms, onFire) => {
          order.push(`armed:${String(ms)}`);
          return timer.arm(ms, onFire);
        },
      },
      diagnostics: createDiagnosticRecorder(manualMonotonic()),
    });
    // The read completes, THEN the request timer arms. RUN S4 proved the reverse order charges the
    // operator's typing time to the provider request budget.
    expect(order).toEqual(['read', 'armed:30000']);
    expect(result.counters.timersArmed).toBe(1);
    expect(result.counters.timersCleared).toBe(1);
  });

  it('(17) local rejection keeps transportErrorCode NONE and invocations 0', async () => {
    for (const source of [
      sourceThat({ value: '' }),
      sourceThat({ reject: new MaskedSecretReadError('aborted') }),
      scriptedSecretSource({ interactive: false }),
    ]) {
      const transport = fakeGroqTransport(smokeProbeResponseBody());
      const result = await runGroqStagingSmokeOnce(validConfig(), {
        transport,
        credentialSource: source,
        clock: createManualClock(),
        timer: manualSmokeTimer(),
        diagnostics: createDiagnosticRecorder(manualMonotonic()),
      });
      expect(result.diagnostics.transportErrorCode).toBe('NONE');
      expect(result.diagnostics.timeoutPhase).toBe('unknown');
      expect(result.counters.invocations).toBe(0);
      // No transport call means no provider object was ever exercised after the failed bind.
      expect(transport.calls()).toBe(0);
    }
  });

  it('(18) the S1D-B timeout and transport diagnostics still behave', async () => {
    const result = await runWith(sourceThat({ value: VALID_SENTINEL }));
    expect(result.diagnostics.timeoutPhase).toBe('unknown');
    expect(result.diagnostics.transportErrorCode).toBe('NONE');
    expect(typeof result.diagnostics.totalElapsedMs).toBe('number');
    expect(result.diagnostics.abortSignalledMs).toBeUndefined();
  });

  it('(19) modelOutput=DISCARDED and authority=QUICKFURNO_CORE remain present', async () => {
    const report = formatSanitizedSmokeResult(await runWith(sourceThat({ value: '' })), 'T');
    expect(report).toContain('modelOutput=DISCARDED');
    expect(report).toContain('authority=QUICKFURNO_CORE');
  });

  it('(20, 21) timeoutMs, modelId and configDigest are unchanged', () => {
    const approval = JSON.parse(
      readFileSync(
        join(REPO_ROOT, 'docs/approvals/groq-staging-smoke-v1/release-approval.json'),
        'utf8',
      ),
    ) as { timeoutMs: number; release: { configDigest: string; modelId: string } };
    expect(approval.timeoutMs).toBe(30_000);
    expect(approval.release.modelId).toBe('openai/gpt-oss-20b');
    expect(approval.release.configDigest).toBe(
      '4f97ef1e9e46905db253912bd56dab8aea4f38e4d606dfe93b16fc024f0c2be1',
    );
  });
});

describe('(22-27) package, repository, and hygiene invariants', () => {
  it('(22) the groq-staging-smoke package-root API is locked at 30', async () => {
    const barrel = (await import('../index.js')) as unknown as Record<string, unknown>;
    // 24 -> 27 for MVP-P2A.2 HF1: the semantic approval digest helper and its two readable parts.
    // 27 -> 28 for MVP-P2A.2 HF4-R4: `createSystemSmokeWireDeps`, the ONE pairing of the
    // instrumented transport with the recorder that owns its wire milestones. RUN S5's smoke PASSED
    // while printing every wire milestone ABSENT, because that pairing was a convention written out
    // in two composition roots and the other root got it wrong.
    // 28 -> 30 for MVP-P2A.2 HF4-R5: `createClipboardCredentialResolver` and
    // `createWindowsPowerShellClipboardSource`, the one-shot Windows clipboard credential ingress the
    // owner asked for. The candidate evidence operator is the composition root that selects an
    // ingress, so both have to be reachable from there; the helper program, its arguments, its exit
    // codes and its output bound all stay module-private.
    // Counted, not merely permitted -- the exact-set lock in containment names all six.
    expect(Object.keys(barrel)).toHaveLength(30);
    for (const internal of [
      'CREDENTIAL_OUTCOMES',
      'MaskedSecretReadError',
      'createDiagnosticRecorder',
      'classifyRejection',
    ]) {
      expect(barrel[internal]).toBeUndefined();
    }
  });

  it('(23) the model-evaluation package-root API lock remains 35', () => {
    const containment = readFileSync(
      join(REPO_ROOT, 'packages/model-evaluation/src/tests/containment.test.ts'),
      'utf8',
    );
    const block = /const EXPECTED = \[([\s\S]*?)\];/.exec(containment);
    const symbols = (block?.[1] ?? '')
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.startsWith("'"));
    // RMB-A: 33 -> 34 records ONE authorised addition, `createProviderReleaseRef` -- the release
    // grammar made independently constructible so the operational-benchmark package can NAME a
    // release without a second copy of the six fields. Still an EXACT count; it records an
    // authorised addition, it does not relax the assertion.
    expect(symbols).toHaveLength(35);
  });

  it('(24) the event-backbone package-root API lock remains 39', () => {
    expect(
      readFileSync(join(REPO_ROOT, 'packages/event-backbone/src/tests/public-api.test.ts'), 'utf8'),
    ).toContain('toHaveLength(38)');
  });

  it('(25) migrations 0001-0012 are byte-identical and 0013 is absent', () => {
    const LOCKED: Record<string, string> = {
      '0001_event_log.sql': 'dbca835c394dc67f015176af8ae0582faa78e0c1299593ac8970c5abf4389d6a',
      '0002_event_runtime_grants.sql':
        '4a6536afc23e53eb8f4ab91516e8bdc6700495a27ec386a99dbfb072719f736c',
      '0003_ingestion_rejection_and_event_conflict.sql':
        '407bea56929b592d93337892f6ee95ac006f3b4001dedb135151ccfb5b36ab0c',
      '0004_projection_foundation.sql':
        '148b31ea95f3ae90274cdc74381b8d1fb3be9caa0dfe7ff96771240a7c29cc30',
      '0005_projection_event_positions.sql':
        '96d641ad0c3ea47843ab9de00cf4ab9847fad6a0164bbacadf5c7ed439ccccae',
      '0006_projection_failure_operations.sql':
        'e97059a506ec4377fa39194de4fdc54e7d2f237941fb1e5243a0b01ff40a83d4',
      '0007_subject_activity_projection.sql':
        '8823b528d9e5aaccad7ddb6e16ebe254662c9759d14321fd3a6fa2e62b6dee49',
      '0008_conversation_control_persistence.sql':
        'e79f1f097407f4e630ce13858545dde80ec7ba5cc155bc117b1a62aa7d2b8a10',
      '0009_durable_approval_queue.sql':
        'e834bc3cd0bc8fd30b04f4849a00d29d49b5a19d1636b912535fdbd6d86f20f6',
      '0010_execution_replay_claim.sql':
        '1add85e08e43dafe85f124b886790cd3495d3f54b3579ad89efe40e2849a8b05',
      '0011_riya_conversation_continuity.sql':
        '80149f8d636aa85eaff7d98f924220107eaa3d539e5d13d5133873154926cc93',
      // RWC-P8 (ADR-0104): the ONE authorized addition. Durable logical-turn idempotency, sitting
      // BELOW the ingress transport replay guard rather than replacing it. Repository and
      // LOCAL/CI only; nothing is applied to a managed database.
      '0012_riya_logical_turn_idempotency.sql':
        '5d1b7fe68401a664cea3116ff0900499a1f20d659d4935c586b4ac0f923aaf3e',
      '0013_communication_state_projection.sql':
        '4f533fb60ea96bedd11bf2f5b3177376517c07633d3b7e71e0341b43c1a72919',
    };
    const dir = join(REPO_ROOT, 'packages/event-backbone/src/persistence/migrations');
    const sql = readdirSync(dir)
      .filter((name) => name.endsWith('.sql'))
      .sort();
    expect(sql).toEqual(Object.keys(LOCKED));
    for (const [name, hash] of Object.entries(LOCKED)) {
      expect(
        createHash('sha256')
          .update(readFileSync(join(dir, name)))
          .digest('hex'),
      ).toBe(hash);
    }
    // RWC-P8 (ADR-0104) RESTATED, not relaxed: 0012 is the ONE owner-authorized addition -- durable
    // logical-turn idempotency, repository and LOCAL/CI only. The bound moves to 0013, so the
    // lock still says what it always said: no unauthorized migration exists.
    expect(sql.some((name) => name.startsWith('0014'))).toBe(false);
  });

  it('(26) no S1D-E source references the protected reconciliation directory', () => {
    for (const file of [
      'src/masked-tty-credential-resolver.ts',
      'src/diagnostic-telemetry.ts',
      'src/run-once.ts',
      'src/format-sanitized-result.ts',
    ]) {
      expect(readFileSync(fileURLToPath(new URL(file, PKG_DIR)), 'utf8')).not.toContain(
        'qfj-managed-reconciliation',
      );
    }
  });

  it('(27) this spec touches no real stdin, TTY, network, database, or Docker', () => {
    const self = readFileSync(
      fileURLToPath(new URL('src/tests/credential-ingress-diagnostics.test.ts', PKG_DIR)),
      'utf8',
    );
    expect(self).not.toMatch(/\bfetch\s*\(/);
    expect(self).not.toMatch(/process\s*\.\s*stdin/);
    // Anchored to line starts: an unanchored `import` also matches `import.meta.url`, and the lazy
    // span then swallows this very assertion, which names the symbols it forbids.
    const specifiers = self.match(/^import[\s\S]*?from\s*['"][^'"]+['"]/gm) ?? [];
    expect(specifiers.length).toBeGreaterThan(0);
    for (const statement of specifiers) {
      expect(statement).not.toContain('createNodeMaskedSecretSource');
      expect(statement).not.toContain('createFetchGroqTransport');
      expect(statement).not.toMatch(/\b(pg|supabase|dockerode)\b/);
    }
  });

  it('the Model Gateway is untouched by this slice', () => {
    // The resolver still imports the gateway's holder and types; it modifies nothing there.
    const source = readFileSync(
      fileURLToPath(new URL('src/masked-tty-credential-resolver.ts', PKG_DIR)),
      'utf8',
    );
    expect(source).toContain("from '@qf-jarvis/model-gateway'");
    // 10 -> 14 for MVP-P2A.2 HF4-R5. The four additions all name a failure of the CLIPBOARD INGRESS
    // before a value is ever classified — an ineligible platform, a helper that could not run, a
    // refused read and a refused CLEAR. None of them describes a property of a credential, and the
    // shape classifications are deliberately SHARED rather than duplicated per ingress.
    // 14 -> 15 for MVP-P2A.2 HF4-R6: `clipboard-sentinel-present`. HF4-R6 removes the credential from
    // the clipboard by overwriting it with a fixed non-secret marker rather than by clearing it to
    // empty, because Windows PowerShell 5.1 cannot do the latter — which is exactly where RUN S7
    // stopped. That marker satisfies the shared credential shape, so a later run finding it must be
    // refused explicitly, and it deserves its own token: it is not a malformed credential, it is the
    // correct sign that a previous run removed one.
    expect(CREDENTIAL_OUTCOMES).toHaveLength(15);
    expect([...CREDENTIAL_OUTCOMES].filter((one) => one.startsWith('clipboard-'))).toEqual([
      'clipboard-platform-unsupported',
      'clipboard-helper-failed',
      'clipboard-unavailable',
      'clipboard-clear-failed',
      'clipboard-sentinel-present',
    ]);
  });
});
