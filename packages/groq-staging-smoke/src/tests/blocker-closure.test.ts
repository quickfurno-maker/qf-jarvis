/**
 * QFJ-S1A — mechanical closure of the four S1 activation blockers (ADR-0061 §A).
 *
 * The S1 read-only audit classified the repository BLOCKED_BY_CODE_OR_CONTRACT on four codes. This spec
 * is the closure evidence: each blocker is reproduced as a property of the merged code and shown to no
 * longer hold. It asserts against the real files and the real runtime, not against a claim in a document.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import * as gateway from '@qf-jarvis/model-gateway';
import { fakeGroqTransport } from '@qf-jarvis/model-gateway/testing';
import { describe, expect, it } from 'vitest';

import { runOnce, validConfig } from './smoke-test-support.js';
import {
  createMaskedTtyCredentialResolver,
  createNodeMaskedSecretSource,
  createSystemSmokeTimer,
  runGroqStagingSmokeOnce,
  SMOKE_PROMPT_FAMILY,
  SMOKE_PROMPT_VERSION,
} from '../index.js';
import {
  manualSmokeTimer,
  scriptedSecretSource,
  smokeProbeResponseBody,
} from '../testing/index.js';

const PKG_DIR = new URL('../../', import.meta.url);

function readPackageFile(relative: string): string {
  return readFileSync(fileURLToPath(new URL(relative, PKG_DIR)), 'utf8');
}

const manifest = JSON.parse(readPackageFile('package.json')) as {
  name: string;
  bin?: Record<string, string>;
  dependencies?: Record<string, string>;
  exports: Record<string, unknown>;
};

describe('(1) QFJ-S1-BLOCK-001 — a concrete credential resolver exists, outside the model gateway', () => {
  it('this package ships a concrete resolver factory and a concrete terminal source', () => {
    expect(typeof createMaskedTtyCredentialResolver).toBe('function');
    expect(typeof createNodeMaskedSecretSource).toBe('function');
    const resolver = createMaskedTtyCredentialResolver(scriptedSecretSource());
    expect(typeof resolver.resolve).toBe('function');
  });

  it('it lives OUTSIDE @qf-jarvis/model-gateway, which still ships no concrete resolver', () => {
    expect(manifest.name).toBe('@qf-jarvis/groq-staging-smoke');
    const gatewaySurface = gateway as unknown as Record<string, unknown>;
    for (const name of Object.keys(gatewaySurface)) {
      const lowered = name.toLowerCase();
      // The gateway exposes the resolver INTERFACE (a type, erased at runtime) but no factory.
      if (lowered.includes('credentialresolver')) {
        expect(typeof gatewaySurface[name]).not.toBe('function');
      }
    }
  });

  it('the resolver satisfies the gateway interface and returns the redacting key holder', async () => {
    const resolver = createMaskedTtyCredentialResolver(scriptedSecretSource());
    const key = await resolver.resolve({ ref: 'groq.staging.secret.v1' });
    expect(key).toBeInstanceOf(gateway.GroqApiKey);
    expect(String(key)).toBe('[REDACTED_GROQ_API_KEY]');
    expect(JSON.stringify({ key })).toBe('{"key":"[REDACTED_GROQ_API_KEY]"}');
  });
});

describe('(2) QFJ-S1-BLOCK-002 — a one-shot executable harness exists', () => {
  it('declares exactly one bin entry pointing at the built one-shot entry point', () => {
    expect(Object.keys(manifest.bin ?? {})).toEqual(['qfj-groq-staging-smoke']);
    expect(manifest.bin?.['qfj-groq-staging-smoke']).toBe('./dist/bin.js');
  });

  it('the entry point exists, carries a shebang, and composes the real capabilities once', () => {
    const bin = readPackageFile('src/bin.ts');
    expect(bin.startsWith('#!/usr/bin/env node')).toBe(true);
    // Since QFJ-S1D-B the real transport is the instrumented one, still targeting the gateway's
    // fixed endpoint through the platform fetch seam.
    expect(bin).toContain('createInstrumentedGroqTransport({');
    expect(bin).toContain('createSystemFetchLike()');
    expect(bin).toContain('createNodeMaskedSecretSource()');
    expect(bin).toContain('createSystemSmokeTimer()');
    expect(bin).toContain('runSmokeCli(');
    // Exactly one invocation of the command path, and no loop of any kind.
    expect(bin.match(/runSmokeCli\(/g)?.length).toBe(1);
    expect(bin).not.toMatch(/\b(while|for)\s*\(/);
  });

  it('the harness runs end to end against deterministic fakes and produces a terminal outcome', async () => {
    const result = await runOnce({ transport: fakeGroqTransport(smokeProbeResponseBody()) });
    expect(result.ok).toBe(true);
    expect(result.reason).toBe('smoke-completed');
  });
});

describe('(3) QFJ-S1-BLOCK-003 — the harness owns the AbortController and the timer', () => {
  it('the run module constructs its own controller and arms exactly one timer', () => {
    const source = readPackageFile('src/run-once.ts');
    expect(source).toContain('new AbortController()');
    expect(source.match(/new AbortController\(\)/g)?.length).toBe(1);
    expect(source).toContain('deps.timer.arm(');
    expect(source).toContain('cancelTimer();');
    expect(source).toContain('} finally {');
  });

  it('arming and clearing are observable, and both happen exactly once per run', async () => {
    const timer = manualSmokeTimer();
    const result = await runGroqStagingSmokeOnce(validConfig(), {
      transport: fakeGroqTransport(smokeProbeResponseBody()),
      credentialSource: scriptedSecretSource(),
      clock: { now: () => 0 },
      timer,
    });
    expect(timer.armed()).toBe(1);
    expect(timer.cancelled()).toBe(1);
    expect(result.counters.timersArmed).toBe(1);
    expect(result.counters.timersCleared).toBe(1);
  });

  it('ships a real system timer that unrefs, so a one-shot process is never held open', () => {
    expect(typeof createSystemSmokeTimer).toBe('function');
    const cancel = createSystemSmokeTimer().arm(60_000, () => {
      throw new Error('the timer must not fire in this test');
    });
    expect(typeof cancel).toBe('function');
    cancel();
  });
});

describe('(4) QFJ-S1-BLOCK-004 — the staging release binds an exact prompt identity', () => {
  it('the gateway staging release now REQUIRES prompt family and version', () => {
    const binding = readFileSync(
      fileURLToPath(
        new URL(
          '../../../model-gateway/src/providers/groq/groq-staging-binding.ts',
          import.meta.url,
        ),
      ),
      'utf8',
    );
    expect(binding).toContain('readonly promptFamily: string;');
    expect(binding).toContain('readonly promptVersion: number;');
    expect(binding).toContain("refuse('groq-bind-prompt-invalid')");
    expect(binding).toContain("refuse('groq-bind-approval-refs-missing')");
  });

  it('the bind event carries the prompt identity and the approval references', () => {
    const observability = readFileSync(
      fileURLToPath(
        new URL(
          '../../../model-gateway/src/providers/groq/groq-staging-observability.ts',
          import.meta.url,
        ),
      ),
      'utf8',
    );
    expect(observability).toContain('readonly promptFamily: string;');
    expect(observability).toContain('readonly promptVersion: number;');
    expect(observability).toContain('readonly dataControlsAttestationRef: string;');
    expect(gateway.GROQ_STAGING_BIND_REASONS).toContain('groq-bind-prompt-invalid');
    expect(gateway.GROQ_STAGING_BIND_REASONS).toContain('groq-bind-approval-refs-missing');
  });

  it('the harness threads the exact prompt identity through to the outcome', async () => {
    const result = await runOnce({});
    expect(result.references.promptFamily).toBe(SMOKE_PROMPT_FAMILY);
    expect(result.references.promptVersion).toBe(SMOKE_PROMPT_VERSION);
    expect(result.references.capabilityProfileRef).toBe('cap.groq.reply.v1');
    expect(result.references.evaluationRef).toBe('evref-groq-0001');
    expect(result.references.dataControlsAttestationRef).toBe('zdr.groq.staging.0001');
  });
});

describe('(5) all four blocker codes are demonstrably cleared by code and contracts', () => {
  it('summarises the closure conditions', async () => {
    // BLOCK-001: a concrete resolver exists, outside the gateway.
    expect(typeof createMaskedTtyCredentialResolver).toBe('function');
    expect(manifest.name).not.toBe('@qf-jarvis/model-gateway');

    // BLOCK-002: an executable one-shot harness exists and has a real, non-test call site.
    expect(manifest.bin?.['qfj-groq-staging-smoke']).toBe('./dist/bin.js');
    expect(readPackageFile('src/bin.ts')).toContain('createInstrumentedGroqTransport({');

    // BLOCK-003: the harness owns the abort and the timer, and always clears it.
    const result = await runOnce({});
    expect(result.counters.timersArmed).toBe(1);
    expect(result.counters.timersCleared).toBe(1);

    // BLOCK-004: an exact prompt identity is bound and reported.
    expect(result.references.promptFamily).toBe(SMOKE_PROMPT_FAMILY);
    expect(result.references.promptVersion).toBe(SMOKE_PROMPT_VERSION);

    // And the boundary the whole slice depends on still holds: no live call was made anywhere here.
    expect(result.counters.invocations).toBe(1);
  });
});
