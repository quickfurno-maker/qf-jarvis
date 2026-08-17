/**
 * MVP-P2A.2 HF4-R5 — the one-shot Windows clipboard credential ingress.
 *
 * Matrix: a valid clipboard value produces exactly one helper invocation, one read, one clear and one
 * redacting holder, and every later phase gets that SAME holder without a second clipboard access; an
 * empty, short, long or wrongly-charactered value is refused by the SHARED policy with the clipboard
 * already cleared; a missing helper, a refused read, a refused CLEAR, a non-Windows platform, an
 * oversize capture and a refusing holder factory each fail closed with their own token and reach no
 * provider; the helper carries no secret in its arguments and its stderr can never reach a diagnostic;
 * and the whole ingress runs with no TTY while the masked-TTY ingress keeps refusing without one.
 *
 * NOTHING here reads or clears a real clipboard, spawns a real helper, or uses a real credential: the
 * OS seam is injected in every case and the value is an obvious synthetic sentinel.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import type { createGroqApiKey } from '@qf-jarvis/model-gateway';
import { describe, expect, it } from 'vitest';

import {
  CLIPBOARD_HELPER_CLEAR_FAILED_EXIT,
  CLIPBOARD_HELPER_READ_FAILED_EXIT,
  CLIPBOARD_HELPER_TIMEOUT_MS,
  CLIPBOARD_READ_FAILURE_KINDS,
  ClipboardReadError,
  createClipboardCredentialResolver,
  MAX_CLIPBOARD_OUTPUT_BYTES,
  type ClipboardReadFailureKind,
  type ClipboardTextSource,
} from '../clipboard-credential-resolver.js';
import { MAX_CREDENTIAL_LENGTH, MIN_CREDENTIAL_LENGTH } from '../credential-policy.js';
import { createDiagnosticRecorder } from '../diagnostic-telemetry.js';
import type { CredentialOutcome } from '../diagnostic-telemetry.js';
import { createMaskedTtyCredentialResolver } from '../masked-tty-credential-resolver.js';
import { runGroqStagingSmokeOnce } from '../run-once.js';

import { createManualClock } from '@qf-jarvis/model-gateway';
import { fakeGroqTransport } from '@qf-jarvis/model-gateway/testing';

import {
  manualSmokeTimer,
  scriptedSecretSource,
  smokeProbeResponseBody,
} from '../testing/index.js';
import { validConfig } from './smoke-test-support.js';

/**
 * An OBVIOUS synthetic sentinel that LOOKS like a credential — never a real Groq key.
 *
 * It is deliberately shaped like an accepted value (charset and length both inside the shared bounds)
 * so the containment assertions below are testing redaction rather than testing a value that would
 * have been refused anyway.
 */
const CLIPBOARD_SENTINEL = 'FAKE-CLIPBOARD-SENTINEL-NEVER-A-REAL-KEY-0000';

const REFERENCE = { ref: 'qfj.staging.groq.credential.v1' } as const;

/** A scripted clipboard. Records every entry; never touches a real clipboard. */
interface ScriptedClipboard extends ClipboardTextSource {
  readonly platformChecks: () => number;
  readonly reads: () => number;
}

function scriptedClipboard(
  options: {
    readonly supported?: boolean;
    readonly value?: string;
    readonly fail?: ClipboardReadFailureKind;
    readonly throwForeign?: boolean;
  } = {},
): ScriptedClipboard {
  const supported = options.supported ?? true;
  const state = { platformChecks: 0, reads: 0 };
  return Object.freeze({
    isSupportedPlatform(): boolean {
      state.platformChecks += 1;
      return supported;
    },
    readAndClearOnce(): Promise<string> {
      state.reads += 1;
      if (options.throwForeign === true) {
        // A foreign rejection: not a typed ClipboardReadError. It must be classified safely rather
        // than trusted, and its message must never reach an outcome.
        return Promise.reject(new Error('SYNTHETIC-FOREIGN-FAILURE-' + CLIPBOARD_SENTINEL));
      }
      if (options.fail !== undefined) {
        return Promise.reject(new ClipboardReadError(options.fail));
      }
      return Promise.resolve(options.value ?? CLIPBOARD_SENTINEL);
    },
    platformChecks: () => state.platformChecks,
    reads: () => state.reads,
  });
}

function recorderFor(): ReturnType<typeof createDiagnosticRecorder> {
  let now = 0;
  return createDiagnosticRecorder({
    nowMs: (): number => {
      now += 1;
      return now;
    },
  });
}

/** Every refusal reports the SAME closed reason; the precise identity lives in the outcome. */
async function refusalOf(
  clipboard: ClipboardTextSource,
  options: { readonly createHolder?: (value: string) => ReturnType<typeof createGroqApiKey> } = {},
): Promise<{ outcome: CredentialOutcome; message: string }> {
  const recorder = recorderFor();
  const resolver = createClipboardCredentialResolver(clipboard, {
    recorder,
    ...(options.createHolder === undefined ? {} : { createHolder: options.createHolder }),
  });
  let message = '';
  let threw = false;
  try {
    await resolver.resolve(REFERENCE);
  } catch (error: unknown) {
    threw = true;
    message = error instanceof Error ? error.message : String(error);
  }
  expect(threw).toBe(true);
  expect(resolver.holderCreations()).toBe(0);
  expect(resolver.resolutions()).toBe(0);
  expect(resolver.lastFailure()).toBe('smoke-credential-invalid');
  return { outcome: resolver.outcome(), message };
}

describe('HF4-R5 C1 — one read, one clear, one holder, reused', () => {
  it('resolves once and hands the SAME holder to every later phase', async () => {
    const clipboard = scriptedClipboard();
    const recorder = recorderFor();
    const resolver = createClipboardCredentialResolver(clipboard, { recorder });

    const first = await resolver.resolve(REFERENCE);
    const second = await resolver.resolve(REFERENCE);
    const third = await resolver.resolve(REFERENCE);

    // ONE OS clipboard entry, no matter how many phases asked.
    expect(clipboard.reads()).toBe(1);
    expect(resolver.clipboardReadAttempts()).toBe(1);
    expect(resolver.clipboardReads()).toBe(1);
    expect(resolver.clipboardCleared()).toBe(true);
    // ONE holder, by object identity — not an equal copy, and not a second holder built from a
    // retained raw string.
    expect(resolver.holderCreations()).toBe(1);
    expect(resolver.resolutions()).toBe(1);
    expect(first).toBe(second);
    expect(second).toBe(third);
    expect(resolver.reuses()).toBe(3);
    expect(resolver.outcome()).toBe('resolved');
    expect(resolver.lastFailure()).toBeUndefined();
    // The ingress milestone was stamped, and the run-level counters agree with the clipboard ones.
    const snapshot = recorder.snapshot();
    expect(snapshot.credentialOutcome).toBe('resolved');
    expect(snapshot.credentialReadAttempts).toBe(1);
    expect(snapshot.credentialResolutions).toBe(1);
  });

  it('strips only surrounding whitespace, which the shared charset already forbids', async () => {
    const resolver = createClipboardCredentialResolver(
      scriptedClipboard({ value: `\r\n  ${CLIPBOARD_SENTINEL}  \n` }),
    );
    await expect(resolver.resolve(REFERENCE)).resolves.toBeDefined();
    expect(resolver.holderCreations()).toBe(1);
  });

  it('does not rescue an interior separator — trimming cannot widen the policy', async () => {
    const { outcome } = await refusalOf(
      scriptedClipboard({ value: `${CLIPBOARD_SENTINEL} ${CLIPBOARD_SENTINEL}` }),
    );
    expect(outcome).toBe('rejected-charset');
  });
});

describe('HF4-R5 C2-C5, C12 — the SHARED policy refuses, with the clipboard already cleared', () => {
  const cases: readonly {
    readonly name: string;
    readonly value: string;
    readonly outcome: CredentialOutcome;
  }[] = [
    { name: 'C2 empty', value: '', outcome: 'rejected-empty' },
    { name: 'C2 whitespace only', value: '   \r\n ', outcome: 'rejected-empty' },
    {
      name: 'C3 too short',
      value: 'A'.repeat(MIN_CREDENTIAL_LENGTH - 1),
      outcome: 'rejected-too-short',
    },
    {
      name: 'C4 too long',
      value: 'A'.repeat(MAX_CREDENTIAL_LENGTH + 1),
      outcome: 'rejected-too-long',
    },
    { name: 'C5 bad charset', value: `${CLIPBOARD_SENTINEL}!!`, outcome: 'rejected-charset' },
  ];

  for (const one of cases) {
    it(`${one.name} fails closed as ${one.outcome} and leaves the clipboard cleared`, async () => {
      const clipboard = scriptedClipboard({ value: one.value });
      const recorder = recorderFor();
      const resolver = createClipboardCredentialResolver(clipboard, { recorder });

      await expect(resolver.resolve(REFERENCE)).rejects.toThrow('QFJ_SMOKE_CREDENTIAL_REFUSED');

      expect(resolver.outcome()).toBe(one.outcome);
      // The value was captured, so the helper had already cleared the clipboard before refusing.
      expect(resolver.clipboardReads()).toBe(1);
      expect(resolver.clipboardCleared()).toBe(true);
      // And nothing was built from it.
      expect(resolver.holderCreations()).toBe(0);
      expect(recorder.snapshot().credentialResolutions).toBe(0);
    });
  }

  it('C12 a refusing holder factory reports rejected-holder and keeps the clipboard cleared', async () => {
    const clipboard = scriptedClipboard();
    const resolver = createClipboardCredentialResolver(clipboard, {
      createHolder: () => {
        throw new Error('SYNTHETIC-HOLDER-REFUSAL');
      },
    });
    await expect(resolver.resolve(REFERENCE)).rejects.toThrow('QFJ_SMOKE_CREDENTIAL_REFUSED');
    expect(resolver.outcome()).toBe('rejected-holder');
    expect(resolver.clipboardCleared()).toBe(true);
    expect(resolver.holderCreations()).toBe(0);
  });

  it('the shared policy is the SAME one the masked TTY ingress applies', async () => {
    // A value the TTY ingress refuses is refused identically here, with the same closed token. Two
    // ingresses that disagreed about what a credential looks like would be two credential policies.
    const tooShort = 'A'.repeat(MIN_CREDENTIAL_LENGTH - 1);
    const tty = createMaskedTtyCredentialResolver(
      scriptedSecretSource({ interactive: true, value: tooShort }),
    );
    await expect(tty.resolve(REFERENCE)).rejects.toThrow();
    const { outcome } = await refusalOf(scriptedClipboard({ value: tooShort }));
    expect(outcome).toBe(tty.outcome());
    expect(outcome).toBe('rejected-too-short');
  });
});

describe('HF4-R5 C6-C9 — the ingress itself fails closed, each with its own token', () => {
  const kinds: readonly {
    readonly kind: ClipboardReadFailureKind;
    readonly outcome: CredentialOutcome;
  }[] = [
    { kind: 'helper-failed', outcome: 'clipboard-helper-failed' },
    { kind: 'read-refused', outcome: 'clipboard-unavailable' },
    { kind: 'clear-refused', outcome: 'clipboard-clear-failed' },
    { kind: 'unsupported-platform', outcome: 'clipboard-platform-unsupported' },
  ];

  for (const one of kinds) {
    it(`${one.kind} reports ${one.outcome} and creates no holder`, async () => {
      const { outcome } = await refusalOf(scriptedClipboard({ fail: one.kind }));
      expect(outcome).toBe(one.outcome);
    });
  }

  it('C8 a refused CLEAR fails closed — the run does not continue with a live key in the clipboard', async () => {
    const clipboard = scriptedClipboard({ fail: 'clear-refused' });
    const resolver = createClipboardCredentialResolver(clipboard);
    await expect(resolver.resolve(REFERENCE)).rejects.toThrow('QFJ_SMOKE_CREDENTIAL_REFUSED');
    expect(resolver.outcome()).toBe('clipboard-clear-failed');
    // The helper clears BEFORE returning the value, so a refused clear means this process never even
    // received one. Nothing was captured and nothing was built.
    expect(resolver.clipboardReads()).toBe(0);
    expect(resolver.clipboardCleared()).toBe(false);
    expect(resolver.holderCreations()).toBe(0);
  });

  it('C9 a non-Windows platform is refused BEFORE any helper is entered', async () => {
    const clipboard = scriptedClipboard({ supported: false });
    const resolver = createClipboardCredentialResolver(clipboard);
    await expect(resolver.resolve(REFERENCE)).rejects.toThrow('QFJ_SMOKE_CREDENTIAL_REFUSED');
    expect(resolver.outcome()).toBe('clipboard-platform-unsupported');
    // The gate ran before the read was entered, so no attempt was counted and nothing was spawned.
    expect(clipboard.reads()).toBe(0);
    expect(resolver.clipboardReadAttempts()).toBe(0);
  });

  it('a FOREIGN rejection is classified safely rather than trusted', async () => {
    const { outcome, message } = await refusalOf(scriptedClipboard({ throwForeign: true }));
    expect(outcome).toBe('clipboard-helper-failed');
    // And the foreign message — which carries the sentinel — never becomes the thrown error.
    expect(message).toBe('QFJ_SMOKE_CREDENTIAL_REFUSED');
    expect(message).not.toContain(CLIPBOARD_SENTINEL);
  });

  it('a refusal is PERMANENT — a later phase gets the same refusal without a second clipboard entry', async () => {
    const clipboard = scriptedClipboard({ fail: 'read-refused' });
    const resolver = createClipboardCredentialResolver(clipboard);
    await expect(resolver.resolve(REFERENCE)).rejects.toThrow();
    await expect(resolver.resolve(REFERENCE)).rejects.toThrow();
    // One entry, and the first recorded outcome was not overwritten by the replay.
    expect(clipboard.reads()).toBe(1);
    expect(resolver.outcome()).toBe('clipboard-unavailable');
    expect(resolver.holderCreations()).toBe(0);
  });
});

describe('HF4-R5 C10, C11 — the helper carries no secret and its stderr reaches nothing', () => {
  const SOURCE = readFileSync(
    fileURLToPath(new URL('../clipboard-credential-resolver.ts', import.meta.url)),
    'utf8',
  );

  it('C10 the captured output is strictly bounded and the helper is timed', () => {
    // Bounded well above a legitimate credential and far below a document.
    expect(MAX_CLIPBOARD_OUTPUT_BYTES).toBe(MAX_CREDENTIAL_LENGTH * 5);
    expect(MAX_CLIPBOARD_OUTPUT_BYTES).toBeGreaterThan(MAX_CREDENTIAL_LENGTH);
    expect(MAX_CLIPBOARD_OUTPUT_BYTES).toBeLessThan(4096);
    expect(CLIPBOARD_HELPER_TIMEOUT_MS).toBeGreaterThan(0);
    // Both are handed to the child, so an overrun or a wedge kills it rather than buffering.
    expect(SOURCE).toContain('maxBuffer: MAX_CLIPBOARD_OUTPUT_BYTES');
    expect(SOURCE).toContain('timeout: CLIPBOARD_HELPER_TIMEOUT_MS');
  });

  it('C11 child stderr is never bound, forwarded, parsed, or thrown', () => {
    // The callback takes `(error, stdout)` and stops there: there is no third parameter to read, so
    // no helper output on stderr can reach a diagnostic, a thrown error, or a terminal.
    expect(SOURCE).toContain('(error, stdout) =>');
    expect(SOURCE).not.toMatch(/\bstderr\b\s*[),.]/);
    expect(SOURCE).not.toMatch(/console\s*\./);
    expect(SOURCE).not.toMatch(/process\s*\.\s*(stdout|stderr)\s*\.\s*write/);
  });

  it('the child is launched with no shell, a fixed executable, and CONSTANT arguments', () => {
    expect(SOURCE).toContain('shell: false');
    expect(SOURCE).toContain('windowsHide: true');
    expect(SOURCE).toContain("const CLIPBOARD_HELPER_EXECUTABLE = 'powershell.exe'");
    // `-NoProfile` is load-bearing: a profile that printed anything would corrupt the captured value.
    expect(SOURCE).toContain("'-NoProfile'");
    expect(SOURCE).toContain("'-NonInteractive'");
    // Exactly one child invocation, and no loop that could produce a second.
    expect(SOURCE.match(/execFile\(/g)).toHaveLength(1);
    expect(SOURCE).not.toMatch(/\b(while|for)\s*\(/);
    // No shell-executing or synchronous variant anywhere.
    expect(SOURCE).not.toMatch(/\b(exec|execSync|spawnSync|execFileSync)\s*\(/);
  });

  it('the argument list is EXACTLY the four reviewed entries', () => {
    // An exact-match lock. Appending anything — a value, a path, a switch — fails here, which is the
    // assertion that makes "the command line contains no secret" a fact rather than a convention.
    expect(SOURCE).toContain(`const CLIPBOARD_HELPER_ARGS: readonly string[] = Object.freeze([
  '-NoProfile',
  '-NonInteractive',
  '-Command',
  CLIPBOARD_HELPER_PROGRAM,
]);`);
    // And no environment is handed to the child, so a value cannot travel that way either.
    expect(SOURCE).not.toMatch(/\benv\s*:/);
    expect(SOURCE).not.toMatch(/process\s*\.\s*env/);
  });

  it('a refused CLEAR rejects — the production child never hands back an uncleared value', () => {
    expect(SOURCE).toContain("reject(new ClipboardReadError('clear-refused'))");
    expect(SOURCE).toContain("reject(new ClipboardReadError('read-refused'))");
    // `resolve` is reached on exactly one path: a clean exit.
    expect(SOURCE.match(/resolve\(stdout\)/g)).toHaveLength(1);
  });

  it('the helper program is EXACTLY the reviewed statements, in the reviewed order', () => {
    // An exact-match lock on the whole program. It is what makes M2 (never clear), M3 (clear last)
    // and M16 (a literal smuggled into the command) all fail loudly rather than silently.
    expect(SOURCE).toContain(`const CLIPBOARD_HELPER_PROGRAM = [
  "$ErrorActionPreference = 'Stop'",
  \`try { $value = Get-Clipboard -Raw } catch { exit \${String(CLIPBOARD_HELPER_READ_FAILED_EXIT)} }\`,
  "if ($null -eq $value) { $value = '' }",
  \`try { Set-Clipboard -Value '' } catch { exit \${String(CLIPBOARD_HELPER_CLEAR_FAILED_EXIT)} }\`,
  '[Console]::Out.Write($value)',
  'exit 0',
].join('; ');`);
  });

  it('the helper program is a constant with no interpolation point for a value', () => {
    // The PowerShell text is assembled from literals and two numeric exit codes — there is no
    // template hole a credential could occupy, and the value only ever lives in the child's own
    // variable. The command line a process listing would show therefore contains no secret.
    expect(SOURCE).toContain('$value = Get-Clipboard -Raw');
    expect(SOURCE).toContain("Set-Clipboard -Value ''");
    expect(SOURCE).toContain('[Console]::Out.Write($value)');
    // Read, then CLEAR, then emit — the ordering that makes a refused clear yield no value at all.
    const read = SOURCE.indexOf('$value = Get-Clipboard -Raw');
    const clear = SOURCE.indexOf("Set-Clipboard -Value ''");
    const emit = SOURCE.indexOf('[Console]::Out.Write($value)');
    expect(read).toBeLessThan(clear);
    expect(clear).toBeLessThan(emit);
    // The two exit codes are distinct, so a refused read and a refused clear stay different findings.
    expect(CLIPBOARD_HELPER_READ_FAILED_EXIT).not.toBe(CLIPBOARD_HELPER_CLEAR_FAILED_EXIT);
  });

  it('the ingress writes no file, reads no environment, and stores no value', () => {
    expect(SOURCE).not.toMatch(/process\s*\.\s*env/);
    expect(SOURCE).not.toMatch(/\bwriteFile(Sync)?\b/);
    expect(SOURCE).not.toMatch(/\bfrom ['"]node:fs['"]/);
    // No field of the closure can hold a raw credential: the only cached shape is `{ ok, holder }`.
    expect(SOURCE).not.toMatch(/state\.(value|raw|secret|credential)\s*=/);
  });

  it('the closed failure vocabulary is exactly the four reviewed kinds', () => {
    expect([...CLIPBOARD_READ_FAILURE_KINDS]).toEqual([
      'unsupported-platform',
      'helper-failed',
      'read-refused',
      'clear-refused',
    ]);
  });
});

describe('HF4-R5 R3/R4 — clipboard mode needs no TTY, and TTY mode still demands one', () => {
  const smokeDeps = (): {
    transport: ReturnType<typeof fakeGroqTransport>;
    clock: ReturnType<typeof createManualClock>;
    timer: ReturnType<typeof manualSmokeTimer>;
  } => ({
    transport: fakeGroqTransport(smokeProbeResponseBody()),
    clock: createManualClock(),
    timer: manualSmokeTimer(),
  });

  it('R4 TTY mode on a non-TTY still refuses BEFORE any read — unchanged', async () => {
    const source = scriptedSecretSource({ interactive: false });
    const result = await runGroqStagingSmokeOnce(validConfig(), {
      ...smokeDeps(),
      credentialSource: source,
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('smoke-tty-required');
    // Refused before the resolver existed: no read, no timer, no invocation.
    expect(source.reads()).toBe(0);
    expect(result.counters.credentialReads).toBe(0);
    expect(result.counters.timersArmed).toBe(0);
    expect(result.counters.invocations).toBe(0);
    expect(result.diagnostics.credentialOutcome).toBe('tty-required');
  });

  it('R3 clipboard mode PASSES with no TTY at all — the gate does not apply to it', async () => {
    const clipboard = scriptedClipboard();
    const recorder = recorderFor();
    // Wired exactly as the operator's composition root wires it: the ingress stamps its milestones on
    // the SAME recorder the run reports from.
    const resolver = createClipboardCredentialResolver(clipboard, { recorder });
    const result = await runGroqStagingSmokeOnce(validConfig(), {
      ...smokeDeps(),
      diagnostics: recorder,
      credentialResolver: resolver,
    });
    // A full PASS without a terminal anywhere in the composition. Nothing asked whether stdout was a
    // TTY, because this ingress never reads one.
    expect(result.ok).toBe(true);
    expect(result.reason).not.toBe('smoke-tty-required');
    expect(clipboard.reads()).toBe(1);
    expect(resolver.clipboardCleared()).toBe(true);
    expect(result.counters.credentialReads).toBe(1);
    expect(result.diagnostics.credentialOutcome).toBe('resolved');
    // HF4-R3 ownership is untouched: the timer still arms once, after the credential resolved.
    expect(result.counters.timersArmed).toBe(1);
    expect(result.counters.timersCleared).toBe(1);
    expect(result.counters.invocations).toBe(1);
    const { credentialResolvedMs, timerArmedMs } = result.diagnostics;
    expect(credentialResolvedMs).toBeDefined();
    expect(timerArmedMs).toBeDefined();
    expect(timerArmedMs ?? 0).toBeGreaterThanOrEqual(credentialResolvedMs ?? 0);
  });

  it('supplying BOTH ingresses, or neither, is a composition bug and reads nothing', async () => {
    const clipboard = scriptedClipboard();
    const source = scriptedSecretSource({ interactive: true });
    const both = await runGroqStagingSmokeOnce(validConfig(), {
      ...smokeDeps(),
      credentialSource: source,
      credentialResolver: createClipboardCredentialResolver(clipboard),
    });
    expect(both.ok).toBe(false);
    expect(both.reason).toBe('smoke-invariant');
    expect(clipboard.reads()).toBe(0);
    expect(source.reads()).toBe(0);

    const neither = await runGroqStagingSmokeOnce(validConfig(), smokeDeps());
    expect(neither.ok).toBe(false);
    expect(neither.reason).toBe('smoke-invariant');
    expect(neither.counters.invocations).toBe(0);
    expect(neither.counters.timersArmed).toBe(0);
  });
});

describe('HF4-R5 — no secret exposure regressions', () => {
  it('the sentinel never appears in any resolved surface a caller can read', async () => {
    const clipboard = scriptedClipboard();
    const recorder = recorderFor();
    const resolver = createClipboardCredentialResolver(clipboard, { recorder });
    const holder = await resolver.resolve(REFERENCE);

    // The holder redacts through every stringification path.
    expect(String(holder)).not.toContain(CLIPBOARD_SENTINEL);
    expect(JSON.stringify(holder)).not.toContain(CLIPBOARD_SENTINEL);
    // The diagnostics snapshot is numbers and closed enums; the sentinel cannot occupy any of them.
    expect(JSON.stringify(recorder.snapshot())).not.toContain(CLIPBOARD_SENTINEL);
    // Nor can the resolver's own reported surface.
    expect(
      JSON.stringify({
        outcome: resolver.outcome(),
        lastFailure: resolver.lastFailure() ?? null,
        reads: resolver.clipboardReads(),
        cleared: resolver.clipboardCleared(),
        holders: resolver.holderCreations(),
        reuses: resolver.reuses(),
      }),
    ).not.toContain(CLIPBOARD_SENTINEL);
  });
});
