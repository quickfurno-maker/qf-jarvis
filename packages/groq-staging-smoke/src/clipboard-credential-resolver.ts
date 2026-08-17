/**
 * The one-shot WINDOWS CLIPBOARD credential ingress (MVP-P2A.2 HF4-R5).
 *
 * ### What the owner asked for, and why it is not just convenience
 *
 * The masked-TTY ingress asks for the credential TWICE in a full run — once for the smoke, once for
 * the candidate — because reusing the first read would mean holding it across the whole run. That was
 * the right trade when the alternative was persistence. It is a worse trade than it looked: two
 * hand-typed entries at a raw-mode prompt is two chances to mistype under a live authorization that
 * cannot be re-run, and RUN S4 spent its whole request budget on the time between the prompt appearing
 * and a human finishing with it.
 *
 * So this ingress reads ONCE, from a place the operator has already put the value, and reuses the
 * resulting opaque holder. The credential is not held any longer than before — a full TTY run holds a
 * key from the first prompt to process exit too. What changes is that it is read once instead of
 * twice, and that the raw string's lifetime is a single expression rather than a terminal session.
 *
 * ### The clipboard is CONSUMED, not merely read
 *
 * The helper OVERWRITES the credential-bearing clipboard entry BEFORE the captured text is written
 * back to this process. That ordering is the security property: if the parent dies, is killed, or
 * overruns its output bound partway through, the credential is already out of the clipboard. And if
 * the OS refuses the overwrite, this process never receives the value at all — the refusal arrives
 * instead, and the run fails closed.
 *
 * Continuing after a failed overwrite was considered and rejected. The operator explicitly asked for
 * clipboard ingestion; proceeding while knowingly leaving a live API key resident in the clipboard
 * would be the one outcome nobody would choose if asked.
 *
 * ### HF4-R6 — why the removal is an overwrite and not an empty clear
 *
 * R5 removed the credential with `Set-Clipboard -Value ''`. RUN S7 spent its one live authorization
 * proving that does not work here: the helper reached the clipboard, the clear step failed, and the
 * run stopped at `credentialOutcome=clipboard-clear-failed` with zero holders, zero provider requests
 * and exit code 12. Nothing about Groq or the model was measured — the run never got that far.
 *
 * Empty-string support in `Set-Clipboard` was added in PowerShell 7.2, and PowerShell 7.x changes are
 * not back-ported to Windows PowerShell 5.1. This helper deliberately runs `powershell.exe`, which IS
 * Windows PowerShell 5.1 on the owner's machine, so the R5 form was asking for a capability that
 * release does not have.
 *
 * The pre-merge check that missed it is worth naming: the `-Value` parameter carries
 * `AllowEmptyStringAttribute`, so an empty string BINDS. Binding is not execution — the cmdlet body
 * still refuses. A metadata probe could not have caught this, and the fix is to stop depending on the
 * behaviour at all rather than to probe it better.
 *
 * So the credential entry is now replaced by a FIXED, non-secret {@link CLIPBOARD_CLEARED_SENTINEL}.
 * Writing a real string is the operation Windows PowerShell 5.1 has always supported. Microsoft also
 * documents that a clipboard write can rarely fail while the clipboard is still in use, and names a
 * short delay as the mitigation — hence ONE fixed {@link CLIPBOARD_PREWRITE_DELAY_MS} pause before the
 * single write. That is a pre-write delay, not a retry: there is still exactly one `Set-Clipboard`.
 *
 * ### What the removal does and does NOT guarantee
 *
 * It replaces the CURRENT clipboard entry so that entry no longer holds the credential. It does NOT
 * leave the clipboard empty — it leaves the sentinel — and it does not, and this module never claims
 * it does, purge Windows Clipboard History (Win+V) or a cloud-synced clipboard. An owner who has
 * either feature enabled must clear that history themselves. Nothing here mutates a registry key or a
 * system setting to try — silently disabling an operating-system feature is not a credential
 * resolver's business.
 *
 * ### The sentinel is refused as an ingress value
 *
 * The sentinel is 21 characters of the allowed charset, so the shared credential policy would ACCEPT
 * it — which would turn a second clipboard run into a run that resolved a holder from the marker this
 * ingress itself wrote. It is therefore refused explicitly, before any holder exists, as
 * `clipboard-sentinel-present`. That guard belongs to this ingress alone: the TTY policy is not
 * widened to know about a value only clipboard mode can produce.
 *
 * ### The helper carries no secret
 *
 * The child is launched with `execFile` — no shell, a fixed executable, and a CONSTANT argument list.
 * The PowerShell text is a compile-time literal that reads a variable the child itself assigns; the
 * value never appears in an argument, an environment variable, a temporary file, or a command line
 * that a process listing could show. Child stderr is captured and DISCARDED without inspection, so a
 * hostile or merely chatty helper cannot push text into a diagnostic. Output is bounded and the child
 * is killed on overflow or timeout. There is no retry.
 */
import { execFile } from 'node:child_process';

import {
  classifyRejection,
  isBoundedCredential,
  MAX_CREDENTIAL_LENGTH,
} from './credential-policy.js';
import type { CredentialOutcome } from './diagnostic-telemetry.js';
import type {
  CredentialIngressRecorder,
  StagingCredentialResolver,
} from './masked-tty-credential-resolver.js';
import type { SmokeFailureReason } from './smoke-reasons.js';

import { createGroqApiKey, type GroqApiKey } from '@qf-jarvis/model-gateway';
import type { GroqCredentialReference } from '@qf-jarvis/model-gateway';

/**
 * How a clipboard ingest failed, as TYPED identity rather than a parsed message.
 *
 * Four members, and the split between them is the diagnosis an owner needs: a platform that was never
 * eligible, a helper that could not run, a clipboard the OS would not read, and a clipboard the OS
 * would not clear. Collapsing any pair would hide a different next action behind a shared token.
 */
export const CLIPBOARD_READ_FAILURE_KINDS = [
  'unsupported-platform',
  'helper-failed',
  'read-refused',
  'clear-refused',
] as const;
export type ClipboardReadFailureKind = (typeof CLIPBOARD_READ_FAILURE_KINDS)[number];

/**
 * The FIXED, non-secret marker that replaces the credential in the current clipboard entry (HF4-R6).
 *
 * Every property of it is deliberate. It is a compile-time constant, so no operator, flag, file or
 * environment variable can choose it — a configurable marker would be one more place a value could be
 * smuggled in. It is not derived from the captured credential in any way, so it leaks nothing: the
 * same nineteen bytes are written whether the clipboard held a key, a shopping list, or nothing. And
 * it is written rather than cleared because writing a real string is the operation Windows PowerShell
 * 5.1 actually supports.
 *
 * It is safe to leave as the current clipboard value: it names what happened, in a form an owner who
 * pastes it somewhere will recognise rather than mistake for data.
 */
export const CLIPBOARD_CLEARED_SENTINEL = 'QFJ_CLIPBOARD_CLEARED';

/**
 * The ONE fixed pause before the single clipboard write.
 *
 * Microsoft's own `Set-Clipboard` guidance notes that a write can rarely fail while the clipboard is
 * still in use, and names a short delay as the mitigation. This is that delay and nothing more: it
 * runs once, before the one write, and no failure re-enters it. A retry would be a second write, and
 * the one-write contract is what makes "the credential was removed exactly once" checkable.
 */
export const CLIPBOARD_PREWRITE_DELAY_MS = 100;

/** The one typed rejection the production source raises. Carries a kind, never a value or a cause. */
export class ClipboardReadError extends Error {
  public readonly kind: ClipboardReadFailureKind;

  public constructor(kind: ClipboardReadFailureKind) {
    // A fixed message. It quotes no path, no cause, no helper output, and no clipboard character.
    super('QFJ_SMOKE_CLIPBOARD_READ_FAILED');
    this.name = 'ClipboardReadError';
    this.kind = kind;
  }
}

/**
 * The narrow OS clipboard seam. Production spawns one child; tests inject a deterministic fake, so no
 * test ever reads or clears a real clipboard.
 */
export interface ClipboardTextSource {
  /** True only on a platform this ingress supports. Checked before any helper is spawned. */
  isSupportedPlatform(): boolean;
  /**
   * Capture the current clipboard text AND overwrite that entry, in ONE helper invocation.
   *
   * Called at most once per process. The overwrite happens BEFORE the text is handed back, so a
   * refused overwrite resolves to no value at all rather than to a value plus a warning.
   *
   * HF4-R6: the removal is an overwrite with a fixed non-secret sentinel, not an empty clear — see
   * the module header for why Windows PowerShell 5.1 cannot do the latter. The method name is kept so
   * no consumer signature churns; what it guarantees is that the credential is no longer the current
   * clipboard entry, never that the clipboard is empty.
   */
  readAndClearOnce(): Promise<string>;
}

/**
 * A `StagingCredentialResolver` that loads once and then hands the SAME holder to every later caller.
 *
 * The extra counters are the proof of the contract rather than a claim about it: one clipboard read,
 * one holder, and however many reuses the run needed.
 */
export interface ClipboardCredentialResolver extends StagingCredentialResolver {
  /** How many times the OS clipboard read was ENTERED. At most one, ever. */
  readonly clipboardReadAttempts: () => number;
  /** How many times the OS clipboard was successfully captured. At most one, ever. */
  readonly clipboardReads: () => number;
  /**
   * Whether the credential-bearing clipboard entry was successfully REMOVED before the value was
   * returned to this process — that is, replaced by {@link CLIPBOARD_CLEARED_SENTINEL}.
   *
   * It does NOT mean the clipboard is empty; it never did, and after HF4-R6 it demonstrably is not.
   * The name is kept because renaming a printed diagnostic field would churn every receipt an owner
   * has already read, and the meaning is stated here instead. False until a capture succeeds, and a
   * failed overwrite never sets it — the helper exits before emitting, so a run that could not remove
   * the credential returns no value to count.
   */
  readonly clipboardCleared: () => boolean;
  /** How many credential holders were constructed. At most one, ever. */
  readonly holderCreations: () => number;
  /** How many times a holder was handed out — one per phase that asked. Never a second read. */
  readonly reuses: () => number;
}

/** Injection points added for diagnostics and for testing the holder refusal. Neither changes acceptance. */
export interface ClipboardResolverOptions {
  readonly recorder?: CredentialIngressRecorder;
  /**
   * The credential holder factory. Production always uses `createGroqApiKey`. A test may inject a
   * refusing factory to exercise `rejected-holder`, which the real bounds make unreachable — the
   * production guards are NOT weakened to make that branch testable.
   */
  readonly createHolder?: (value: string) => GroqApiKey;
}

/** The closed outcome each typed failure kind maps to. A table, so no branch can invent a token. */
const OUTCOME_FOR_KIND: Readonly<Record<ClipboardReadFailureKind, CredentialOutcome>> =
  Object.freeze({
    'unsupported-platform': 'clipboard-platform-unsupported',
    'helper-failed': 'clipboard-helper-failed',
    'read-refused': 'clipboard-unavailable',
    'clear-refused': 'clipboard-clear-failed',
  });

/**
 * Build the clipboard resolver over an injected clipboard seam.
 *
 * `resolve` rejects with a FIXED, value-free error; the specific sanitized code is read from
 * `lastFailure()`, exactly as the masked resolver does, because the gateway binding collapses every
 * resolver rejection to `groq-bind-credential-unavailable`.
 *
 * The load happens on the FIRST `resolve` and never again. A second call returns the cached holder; a
 * call after a failed load replays the same refusal without touching the clipboard, so a run that was
 * refused once cannot quietly get a second attempt out of a later phase.
 */
export function createClipboardCredentialResolver(
  source: ClipboardTextSource,
  options: ClipboardResolverOptions = {},
): ClipboardCredentialResolver {
  const recorder = options.recorder;
  const createHolder = options.createHolder ?? createGroqApiKey;
  const state: {
    /** `undefined` until the one load has run; then either the holder or a permanent refusal. */
    loaded: { readonly ok: true; readonly holder: GroqApiKey } | { readonly ok: false } | undefined;
    readAttempts: number;
    reads: number;
    cleared: boolean;
    holders: number;
    reuses: number;
    failure: SmokeFailureReason | undefined;
    outcome: CredentialOutcome;
  } = {
    loaded: undefined,
    readAttempts: 0,
    reads: 0,
    cleared: false,
    holders: 0,
    reuses: 0,
    failure: undefined,
    outcome: 'not-attempted',
  };

  const record = (outcome: CredentialOutcome): void => {
    // First non-default wins locally, mirroring the recorder, so a replayed refusal cannot overwrite.
    if (state.outcome === 'not-attempted') {
      state.outcome = outcome;
    }
    recorder?.recordCredentialOutcome(outcome);
  };

  const fail = (outcome: CredentialOutcome): Promise<GroqApiKey> => {
    // Every clipboard refusal reports the EXISTING `smoke-credential-invalid` reason. The precise
    // identity lives in the closed `credentialOutcome`, which is where the TTY ingress already puts
    // it — adding a smoke failure reason per clipboard branch would grow a governed vocabulary to say
    // something the diagnostic already says exactly.
    state.loaded = { ok: false };
    state.failure = 'smoke-credential-invalid';
    record(outcome);
    // A fixed message. It quotes no path, no cause, no reference, and no clipboard character.
    return Promise.reject(new Error('QFJ_SMOKE_CREDENTIAL_REFUSED'));
  };

  const load = async (): Promise<GroqApiKey> => {
    // The platform gate runs BEFORE any attempt is counted, so a refusal on a machine this ingress
    // does not serve leaves the attempt counter at zero and spawns nothing.
    if (!source.isSupportedPlatform()) {
      return fail('clipboard-platform-unsupported');
    }

    // Counted immediately before the read is entered — an attempt, never a success.
    state.readAttempts += 1;
    recorder?.countCredentialReadAttempt();

    let captured: string;
    try {
      captured = await source.readAndClearOnce();
    } catch (error: unknown) {
      recorder?.mark('credentialReadSettled');
      // TYPED identity only. A kind is claimed solely when the source itself said so; every other
      // rejection, including a foreign one, falls back to `helper-failed`, the safe classification.
      const kind: ClipboardReadFailureKind =
        error instanceof ClipboardReadError ? error.kind : 'helper-failed';
      return fail(OUTCOME_FOR_KIND[kind]);
    }
    recorder?.mark('credentialReadSettled');
    // Reaching here means the helper cleared the clipboard before handing anything back.
    state.reads += 1;
    state.cleared = true;

    // Surrounding whitespace is stripped, and nothing else is. A password manager's copy commonly
    // carries a trailing newline, which the shared charset rule would refuse; trimming can only
    // REMOVE characters the policy already forbids, so it cannot turn a refused value into a
    // different accepted one. The bounds and the character class themselves are untouched.
    const value = captured.trim();
    // HF4-R6. The marker this ingress itself writes is refused BEFORE the shared policy runs, because
    // the shared policy would accept it: 21 characters, all inside the allowed charset. Without this
    // the second clipboard run of a session would build a holder out of "the credential was removed"
    // and carry it to a provider. Checked here rather than in `credential-policy.ts` on purpose — the
    // TTY ingress can never produce this value and must not be taught to care about it.
    if (value === CLIPBOARD_CLEARED_SENTINEL) {
      return fail('clipboard-sentinel-present');
    }
    if (!isBoundedCredential(value)) {
      return fail(classifyRejection(value));
    }

    // The holder wraps the value in the redacting type. From here the value has no accessor:
    // `toString`, `toJSON`, and the Node inspect hook all return the redaction marker. The raw string
    // is a local that falls out of scope on return — no field of this closure retains it.
    let holder: GroqApiKey;
    try {
      holder = createHolder(value);
    } catch {
      return fail('rejected-holder');
    }
    state.holders += 1;
    state.loaded = { ok: true, holder };
    recorder?.countCredentialResolution();
    record('resolved');
    return holder;
  };

  return Object.freeze({
    async resolve(_reference: GroqCredentialReference): Promise<GroqApiKey> {
      const loaded = state.loaded;
      if (loaded !== undefined) {
        if (!loaded.ok) {
          // A permanent refusal, replayed. The clipboard is NOT touched again and the first recorded
          // outcome is not overwritten.
          return Promise.reject(new Error('QFJ_SMOKE_CREDENTIAL_REFUSED'));
        }
        // The SAME holder object. Not a copy, not a re-read, and not a second holder built from a
        // retained raw string — there is no retained raw string.
        state.reuses += 1;
        return loaded.holder;
      }
      const holder = await load();
      state.reuses += 1;
      return holder;
    },
    reads: () => state.readAttempts,
    lastFailure: () => state.failure,
    outcome: () => state.outcome,
    readAttempts: () => state.readAttempts,
    resolutions: () => state.holders,
    clipboardReadAttempts: () => state.readAttempts,
    clipboardReads: () => state.reads,
    clipboardCleared: () => state.cleared,
    holderCreations: () => state.holders,
    reuses: () => state.reuses,
  });
}

/**
 * The helper's exit codes. Content-free integers, so the child never needs a channel for a reason.
 *
 * Anything not listed is `helper-failed`: a spawn error, a timeout, an output overrun, or an exit code
 * this module does not recognise are all "the helper did not do its job", and guessing further from a
 * number nobody assigned would be inventing a diagnosis.
 */
export const CLIPBOARD_HELPER_READ_FAILED_EXIT = 11;
export const CLIPBOARD_HELPER_CLEAR_FAILED_EXIT = 12;

/**
 * The strict bound on helper output.
 *
 * An accepted credential is at most {@link MAX_CREDENTIAL_LENGTH} characters. This is five times that
 * and still tiny: enough that a legitimate value plus surrounding whitespace always fits, small enough
 * that a clipboard holding a document is killed rather than buffered. The captured bytes are never
 * printed, hashed or forwarded on that path — the run simply refuses.
 */
export const MAX_CLIPBOARD_OUTPUT_BYTES = MAX_CREDENTIAL_LENGTH * 5;

/** How long the helper may take. A clipboard read is instant; this only bounds a wedged child. */
export const CLIPBOARD_HELPER_TIMEOUT_MS = 5_000;

/**
 * The CONSTANT PowerShell program. It contains no credential and no interpolation point.
 *
 * The value only ever lives in the child's own `$value` variable, which is assigned from the clipboard
 * and written to stdout at the end. It is never an argument, never an environment entry, never a file.
 * The only literals interpolated at module load are the two exit codes, the fixed delay and the fixed
 * sentinel — all compile-time constants, none derived from anything the clipboard held.
 *
 * The order is deliberate and is the security property: read, WAIT, OVERWRITE, then emit. An overwrite
 * that fails exits before the value is written, so this process cannot receive a credential it failed
 * to take out of the clipboard.
 *
 * HF4-R6 replaced `Set-Clipboard -Value ''` here. That form needs PowerShell 7.2 and this helper runs
 * Windows PowerShell 5.1, which is what RUN S7 hit; writing a real sentinel is supported everywhere.
 */
const CLIPBOARD_HELPER_PROGRAM = [
  "$ErrorActionPreference = 'Stop'",
  `try { $value = Get-Clipboard -Raw } catch { exit ${String(CLIPBOARD_HELPER_READ_FAILED_EXIT)} }`,
  "if ($null -eq $value) { $value = '' }",
  `Start-Sleep -Milliseconds ${String(CLIPBOARD_PREWRITE_DELAY_MS)}`,
  `try { Set-Clipboard -Value '${CLIPBOARD_CLEARED_SENTINEL}' } catch { exit ${String(CLIPBOARD_HELPER_CLEAR_FAILED_EXIT)} }`,
  '[Console]::Out.Write($value)',
  'exit 0',
].join('; ');

/**
 * The fixed argument list. `-NoProfile` is load-bearing, not hygiene: a user profile that printed
 * anything would prepend it to the captured value and silently corrupt the credential.
 */
const CLIPBOARD_HELPER_ARGS: readonly string[] = Object.freeze([
  '-NoProfile',
  '-NonInteractive',
  '-Command',
  CLIPBOARD_HELPER_PROGRAM,
]);

/** The fixed executable. Windows PowerShell ships with the OS, so nothing new is depended on. */
const CLIPBOARD_HELPER_EXECUTABLE = 'powershell.exe';

/**
 * The production clipboard seam: ONE `execFile`, no shell, constant arguments, bounded and timed.
 *
 * This function is never used by a test: the entire suite injects a fake source instead, so the suite
 * never reads and never clears a real clipboard.
 */
export function createWindowsPowerShellClipboardSource(): ClipboardTextSource {
  let consumed = false;

  return {
    isSupportedPlatform(): boolean {
      return process.platform === 'win32';
    },

    readAndClearOnce(): Promise<string> {
      if (consumed) {
        return Promise.reject(new ClipboardReadError('helper-failed'));
      }
      consumed = true;

      return new Promise<string>((resolve, reject) => {
        execFile(
          CLIPBOARD_HELPER_EXECUTABLE,
          [...CLIPBOARD_HELPER_ARGS],
          {
            // No shell. The executable is fixed and the arguments are a constant array, so there is
            // no string for an interpolated value to appear in.
            shell: false,
            windowsHide: true,
            timeout: CLIPBOARD_HELPER_TIMEOUT_MS,
            maxBuffer: MAX_CLIPBOARD_OUTPUT_BYTES,
            encoding: 'utf8',
          },
          (error, stdout) => {
            // `stderr` is deliberately not even bound. Nothing the child wrote there can reach a
            // diagnostic, a thrown error, or a terminal, because this callback never reads it.
            if (error !== null) {
              const code = (error as { code?: unknown }).code;
              if (code === CLIPBOARD_HELPER_READ_FAILED_EXIT) {
                reject(new ClipboardReadError('read-refused'));
                return;
              }
              if (code === CLIPBOARD_HELPER_CLEAR_FAILED_EXIT) {
                reject(new ClipboardReadError('clear-refused'));
                return;
              }
              // A spawn failure, a timeout kill, an output overrun, or any exit code nobody assigned.
              // The original error — which can carry a path or a command line — is DISCARDED here.
              reject(new ClipboardReadError('helper-failed'));
              return;
            }
            resolve(stdout);
          },
        );
      });
    },
  };
}
