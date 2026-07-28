/**
 * QFJ-S1A — sanitized output and authority (ADR-0061 §H, §I).
 *
 * Matrix: a success prints sanitized references and counters only; a failure prints a closed sanitized
 * code only; no prompt text, model output, raw body/header/error, key, PII, or chain-of-thought can
 * appear; the Groq answer is discarded; the harness imports nothing that could send, persist, activate,
 * or reach QuickFurno Core / the Jarvis runtime / n8n / WhatsApp; and Core remains the final authority.
 */
import { describe, expect, it } from 'vitest';

import { runOnce } from './smoke-test-support.js';
import {
  formatSanitizedPreRunFailure,
  formatSanitizedSmokeResult,
  isSmokeReason,
  parseSmokeArgv,
  runSmokeCli,
  SMOKE_FAILURE_REASONS,
  SMOKE_SUCCESS_REASON,
  SYNTHETIC_SMOKE_MESSAGES,
  type SmokeCliIo,
} from '../index.js';
import * as barrel from '../index.js';
import { fakeGroqTransport } from '@qf-jarvis/model-gateway/testing';
import { smokeProbeResponseBody } from '../testing/index.js';

const FIXED_TIMESTAMP = '2026-07-26T00:00:00.000Z';

function collectingIo(): SmokeCliIo & { readonly lines: () => string[] } {
  const written: string[] = [];
  return {
    write: (line: string): void => {
      written.push(line);
    },
    nowIso: () => FIXED_TIMESTAMP,
    lines: () => written,
  };
}

describe('(38) a successful run prints sanitized references and counters only', () => {
  it('emits the closed field set and nothing else', async () => {
    const result = await runOnce({ transport: fakeGroqTransport(smokeProbeResponseBody()) });
    expect(result.ok).toBe(true);
    const report = formatSanitizedSmokeResult(result, FIXED_TIMESTAMP);
    const keys = report
      .split('\n')
      .slice(1)
      .map((line) => line.split('=')[0]);

    expect(keys).toEqual([
      'timestamp',
      'outcome',
      'reason',
      'releaseId',
      'providerId',
      'modelId',
      'modelVersion',
      'configDigest',
      'capabilityProfileRef',
      'evaluationRef',
      'dataControlsAttestationRef',
      'promptFamily',
      'promptVersion',
      'schemaRevision',
      'latencyMs',
      'inputTokens',
      'outputTokens',
      'totalTokens',
      'binds',
      'credentialReads',
      'invocations',
      'timersArmed',
      'timersCleared',
      // QFJ-S1D-B diagnostics. Numbers and closed enums only; a milestone never reached is omitted,
      // which is itself the signal. `fetchStarted`..`responseBodyCompleted` are absent here because
      // this run uses a fake transport that never touches the instrumented wire seam.
      'timerArmedMs',
      'bindStartedMs',
      'credentialResolvedMs',
      'requestConstructedMs',
      'invokeStartedMs',
      'invokeSettledMs',
      'credentialEntryMs',
      'totalElapsedMs',
      'timeoutPhase',
      'transportErrorCode',
      'modelOutput',
      'authority',
    ]);
    expect(report).toContain('outcome=PASS');
    expect(report).toContain(`reason=${SMOKE_SUCCESS_REASON}`);
    expect(report).toContain('promptFamily=qfj.s1a.synthetic.smoke');
    expect(report).toContain('promptVersion=1');
  });
});

describe('(39) a failure prints a closed sanitized code only', () => {
  it('every failure path resolves to a member of the closed vocabulary', async () => {
    const transports = [
      fakeGroqTransport('{"error":"SECRET-BODY"}', 429),
      fakeGroqTransport('{"error":"SECRET-BODY"}', 401),
      fakeGroqTransport('{"error":"SECRET-BODY"}', 503),
      fakeGroqTransport('not-json'),
      fakeGroqTransport(smokeProbeResponseBody({ wrong: 'shape' })),
    ];
    for (const transport of transports) {
      const result = await runOnce({ transport });
      expect(result.ok).toBe(false);
      expect(isSmokeReason(result.reason)).toBe(true);
      expect(SMOKE_FAILURE_REASONS).toContain(result.reason);
      const report = formatSanitizedSmokeResult(result, FIXED_TIMESTAMP);
      expect(report).toContain('outcome=FAIL');
      expect(report).not.toContain('SECRET-BODY');
    }
  });

  it('a pre-run refusal prints a code without any reference set', () => {
    const parsed = parseSmokeArgv(['--key', 'NEVER-TYPE-A-KEY-HERE']);
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    const report = formatSanitizedPreRunFailure(parsed.reason, FIXED_TIMESTAMP);
    expect(report).toContain('reason=smoke-config-invalid');
    expect(report).toContain('modelOutput=NONE');
    expect(report).not.toContain('NEVER-TYPE-A-KEY-HERE');
  });

  it('the CLI refuses a bad argv with exit code 2 and never runs anything', async () => {
    const io = collectingIo();
    const transport = fakeGroqTransport(smokeProbeResponseBody());
    const exitCode = await runSmokeCli(['--key', 'NEVER-TYPE-A-KEY-HERE'], io, {
      transport,
      credentialSource: {
        isInteractive: () => {
          throw new Error('the terminal must never be consulted for a bad argv');
        },
        readOnce: () => Promise.reject(new Error('unreachable')),
      },
      clock: { now: () => 0 },
      timer: {
        arm: () => () => {
          /* never armed */
        },
      },
    });
    expect(exitCode).toBe(2);
    expect(transport.calls()).toBe(0);
    expect(io.lines().join('\n')).not.toContain('NEVER-TYPE-A-KEY-HERE');
  });

  it('the CLI refuses a missing configuration file with exit code 2', async () => {
    const io = collectingIo();
    const transport = fakeGroqTransport(smokeProbeResponseBody());
    const exitCode = await runSmokeCli(['--config', './does-not-exist-qfj-s1a.json'], io, {
      transport,
      credentialSource: {
        isInteractive: () => {
          throw new Error('the terminal must never be consulted for an unreadable config');
        },
        readOnce: () => Promise.reject(new Error('unreachable')),
      },
      clock: { now: () => 0 },
      timer: {
        arm: () => () => {
          /* never armed */
        },
      },
    });
    expect(exitCode).toBe(2);
    expect(transport.calls()).toBe(0);
    expect(io.lines().join('\n')).toContain('reason=smoke-config-invalid');
    // A filesystem error message could quote a path an operator did not intend to publish.
    expect(io.lines().join('\n')).not.toContain('does-not-exist-qfj-s1a.json');
  });
});

describe('(40, 41) nothing sensitive escapes, and the model output is discarded', () => {
  it('a completed run carries no prompt text and no model output anywhere', async () => {
    const secretish = 'THE-MODEL-SAID-SOMETHING-CONFIDENTIAL';
    const transport = fakeGroqTransport(smokeProbeResponseBody({ probe: secretish }));
    const result = await runOnce({ transport });
    expect(result.ok).toBe(true);

    const surfaces = [JSON.stringify(result), formatSanitizedSmokeResult(result, FIXED_TIMESTAMP)];
    for (const surface of surfaces) {
      // The model's own answer is validated structurally and then DISCARDED.
      expect(surface).not.toContain(secretish);
      // The prompt text never appears either.
      for (const message of SYNTHETIC_SMOKE_MESSAGES) {
        expect(surface).not.toContain(message.content);
      }
      expect(surface).not.toContain('connectivity probe');
      expect(surface.toLowerCase()).not.toContain('reasoning');
      expect(surface.toLowerCase()).not.toContain('chain-of-thought');
    }
    expect(formatSanitizedSmokeResult(result, FIXED_TIMESTAMP)).toContain('modelOutput=DISCARDED');
  });

  it('the successful result type carries no output field at all', async () => {
    const result = await runOnce({});
    expect(result.ok).toBe(true);
    expect(Object.keys(result).sort()).toEqual([
      'counters',
      // QFJ-S1D-B: milliseconds and closed enums only — asserted field-by-field in the S1D-B suite.
      'diagnostics',
      'latencyMs',
      'ok',
      'reason',
      'references',
      'usage',
    ]);
    const surface = result as unknown as Record<string, unknown>;
    for (const forbidden of ['output', 'value', 'text', 'content', 'messages', 'raw', 'body']) {
      expect(surface[forbidden]).toBeUndefined();
    }
  });
});

describe('(42, 43) authority: no send, persist, activate, Core, n8n, or WhatsApp surface', () => {
  it('the barrel exposes no delivery, persistence, activation, or authority symbol', () => {
    for (const name of Object.keys(barrel)) {
      const lowered = name.toLowerCase();
      for (const forbidden of [
        'send',
        'deliver',
        'persist',
        'store',
        'activate',
        'promote',
        'rollout',
        'register',
        'core',
        'n8n',
        'whatsapp',
        'approve',
        'accept',
      ]) {
        expect(lowered).not.toContain(forbidden);
      }
    }
  });

  it('the run result exposes no method that could act on the draft', async () => {
    const result = await runOnce({});
    const surface = result as unknown as Record<string, unknown>;
    for (const forbidden of [
      'send',
      'deliver',
      'execute',
      'persist',
      'callN8n',
      'authorize',
      'promote',
      'activate',
    ]) {
      expect(surface[forbidden]).toBeUndefined();
    }
  });

  it('every report names QuickFurno Core as the authority', async () => {
    const result = await runOnce({});
    expect(formatSanitizedSmokeResult(result, FIXED_TIMESTAMP)).toContain(
      'authority=QUICKFURNO_CORE',
    );
    expect(formatSanitizedPreRunFailure('smoke-config-invalid', FIXED_TIMESTAMP)).toContain(
      'authority=QUICKFURNO_CORE',
    );
  });
});
