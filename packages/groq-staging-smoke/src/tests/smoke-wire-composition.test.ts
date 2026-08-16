/**
 * MVP-P2A.2 HF4-R4 — the smoke WIRE MILESTONE composition gap that RUN S5 exposed.
 *
 * ### What S5 printed
 *
 *     phase=smoke status=PASS requests=1
 *     credentialEntryMs=4151
 *     fetchStartedMs=ABSENT headersReceivedMs=ABSENT
 *     responseBodyStartedMs=ABSENT responseBodyCompletedMs=ABSENT networkElapsedMs=ABSENT
 *
 * A PASS is proof that a provider request happened and a response came back. So those five milestones
 * were not absent because nothing was sent — they were absent because nothing marked them. The
 * diagnostics were fine; the COMPOSITION was not.
 *
 * ### The mechanism, pinned in both directions
 *
 * The four wire milestones are marked by `createInstrumentedGroqTransport`, which must hold the SAME
 * recorder the runner was given. That pairing is one object used twice, and it was written out by
 * hand in two separate composition roots. This package's executable got it right. The candidate
 * evidence operator — the other root — passed a plain transport and no recorder, so the runner built
 * a private recorder that nothing on the wire could reach.
 *
 * Both halves are asserted below. The unpaired composition reproduces S5's ABSENT block exactly, and
 * the paired one produces the milestones, on a healthy PASS in both cases — because "it failed" is
 * not why the numbers were missing, and a spec that only proved the happy path would not have caught
 * this.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { createManualClock } from '@qf-jarvis/model-gateway';
import { fakeGroqTransport } from '@qf-jarvis/model-gateway/testing';
import { describe, expect, it } from 'vitest';

import { createDiagnosticRecorder, type MonotonicClock } from '../diagnostic-telemetry.js';
import { createInstrumentedGroqTransport, type FetchLike } from '../instrumented-transport.js';
import { parseSmokeConfig, runGroqStagingSmokeOnce } from '../index.js';
import type { SmokeRunResult } from '../run-once.js';
import {
  manualSmokeTimer,
  scriptedSecretSource,
  smokeProbeResponseBody,
  syntheticSmokeConfigInput,
} from '../testing/index.js';

const WIRE_MILESTONES = [
  'fetchStartedMs',
  'headersReceivedMs',
  'responseBodyStartedMs',
  'responseBodyCompletedMs',
] as const;

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
  const parsed = parseSmokeConfig(syntheticSmokeConfigInput({}));
  if (!parsed.ok) {
    throw new Error('the synthetic smoke fixture must be valid');
  }
  return parsed.config;
}

/** A fetch seam that advances the manual clock at each stage, so every milestone is exact. */
function steppingFetch(clock: ReturnType<typeof manualMonotonic>): FetchLike {
  return () => {
    clock.advance(5);
    return Promise.resolve({
      status: 200,
      headers: { get: () => null },
      text: () => {
        clock.advance(7);
        return Promise.resolve(smokeProbeResponseBody());
      },
    });
  };
}

/** THE PRE-R4 CANDIDATE-OPERATOR COMPOSITION: a plain transport, and no shared recorder. */
function runUnpaired(): Promise<SmokeRunResult> {
  return runGroqStagingSmokeOnce(validConfig(), {
    transport: fakeGroqTransport(smokeProbeResponseBody()),
    credentialSource: scriptedSecretSource(),
    clock: createManualClock(),
    timer: manualSmokeTimer(),
  });
}

/** THE CORRECT COMPOSITION: the instrumented transport and the runner share ONE recorder. */
function runPaired(): Promise<SmokeRunResult> {
  const monotonic = manualMonotonic();
  const recorder = createDiagnosticRecorder(monotonic);
  return runGroqStagingSmokeOnce(validConfig(), {
    transport: createInstrumentedGroqTransport({ fetchLike: steppingFetch(monotonic), recorder }),
    credentialSource: scriptedSecretSource(),
    clock: createManualClock(),
    timer: manualSmokeTimer(),
    diagnostics: recorder,
  });
}

describe('THE S5 WIRE-MILESTONE GAP, REPRODUCED AND CLOSED', () => {
  it('the UNPAIRED composition PASSES with every wire milestone ABSENT — exactly RUN S5', () => {
    return runUnpaired().then((result) => {
      // The run succeeded. That is the whole difficulty: nothing failed, and nothing was measured.
      expect(result.ok).toBe(true);
      expect(result.counters.invocations).toBe(1);
      for (const milestone of WIRE_MILESTONES) {
        expect(result.diagnostics[milestone], `${milestone} must be absent`).toBeUndefined();
      }
      expect(result.diagnostics.networkElapsedMs).toBeUndefined();
      // And the credential milestone WAS present, which is why S5's output looked partially healthy
      // rather than obviously broken.
      expect(result.diagnostics.credentialEntryMs).toBeTypeOf('number');
    });
  });

  it('the PAIRED composition PASSES with all four milestones and a derived elapsed', () => {
    return runPaired().then((result) => {
      expect(result.ok).toBe(true);
      expect(result.counters.invocations).toBe(1);
      for (const milestone of WIRE_MILESTONES) {
        expect(result.diagnostics[milestone], `${milestone} must be present`).toBeTypeOf('number');
      }
      // `networkElapsedMs` is derived only when BOTH ends are proven, never estimated.
      expect(result.diagnostics.networkElapsedMs).toBe(12);
    });
  });

  it('the milestones are ORDERED, which is what makes them a timeline rather than four numbers', () => {
    return runPaired().then((result) => {
      const { fetchStartedMs, headersReceivedMs, responseBodyStartedMs, responseBodyCompletedMs } =
        result.diagnostics;
      expect(fetchStartedMs).toBeLessThanOrEqual(headersReceivedMs ?? -1);
      expect(headersReceivedMs).toBeLessThanOrEqual(responseBodyStartedMs ?? -1);
      expect(responseBodyStartedMs).toBeLessThanOrEqual(responseBodyCompletedMs ?? -1);
    });
  });

  it('pairing changes NOTHING about the request, the timer, the credential or the retries', () => {
    // The fix is a composition change and must be nothing else. Every counter the two runs produce
    // is identical: one bind, one credential read, one invocation, one timer armed and cleared.
    return Promise.all([runUnpaired(), runPaired()]).then(([unpaired, paired]) => {
      expect(paired.counters).toStrictEqual(unpaired.counters);
      expect(paired.ok).toBe(unpaired.ok);
      expect(paired.reason).toBe(unpaired.reason);
      expect(paired.references).toStrictEqual(unpaired.references);
    });
  });

  it('BOTH composition roots reach the pairing through the ONE named helper', () => {
    // The structural half. A convention duplicated across two files is what failed; a function is
    // what replaced it. The `system-wire.ts` module is asserted by `containment` and
    // `blocker-closure`; this pins that neither root rebuilds the pairing by hand instead.
    //
    // Read as text rather than imported: importing it would construct a real network client inside
    // the suite, which is the one thing this package's specs never do.
    const bin = readSource('../bin.ts');
    expect(bin).toContain('createSystemSmokeWireDeps()');
    expect(bin).not.toContain('createInstrumentedGroqTransport({');
    expect(bin).not.toContain('createDiagnosticRecorder(');
  });

  it('the helper builds ONE recorder and gives it to BOTH the transport and the run', () => {
    // The whole defect in one assertion. Two recorders — or a transport handed one and a run handed
    // another — reproduces S5 exactly: a passing smoke with nothing measured. Pinned structurally
    // because the helper cannot be imported here without constructing a real network client.
    const wire = readSource('../system-wire.ts');
    expect(wire.match(/createDiagnosticRecorder\(/gu)).toHaveLength(1);
    expect(wire).toContain('createInstrumentedGroqTransport({');
    expect(wire).toContain('recorder,');
    expect(wire).toContain('diagnostics: recorder,');
    // No second clock either: two origins would put the wire and the run on different timelines.
    expect(wire.match(/createSystemMonotonicClock\(\)/gu)).toHaveLength(1);
  });
});

/** Read a source file beside this spec, without importing it. */
function readSource(relative: string): string {
  return readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8');
}
