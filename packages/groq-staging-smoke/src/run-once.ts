/**
 * The one-shot staging smoke run (QFJ-S1A, ADR-0061 §C, §G) — the closure of QFJ-S1-BLOCK-002 and
 * QFJ-S1-BLOCK-003.
 *
 * ONE bind, ONE invocation, ONE HTTP request, ZERO retries, and a harness-owned `AbortController` plus a
 * single bounded timer. There is no loop anywhere in this module and no second-invocation surface: the
 * function returns a frozen terminal result and the caller exits. Nothing here can send, deliver,
 * persist, register a provider, promote a rollout, or reach QuickFurno Core, the Jarvis runtime, n8n, or
 * WhatsApp — none of those are imported, and the only capability this module has is the one injected
 * transport.
 *
 * Retry/timeout/circuit ownership is unchanged for gateway-routed traffic: the GATEWAY owns it. This
 * harness deliberately does not route through the gateway, so it owns the abort and the timer for its
 * single invocation — and owns nothing else.
 *
 * The Groq answer is a DISCARDED staging draft. It is validated structurally and then thrown away; its
 * content is never returned, printed, or recorded. QuickFurno Core remains the final business authority.
 */
import {
  bindGroqStagingProvider,
  createProviderReleaseRef,
  type GatewayClock,
  type GroqCredentialReference,
  type GroqStagingBindReason,
  type GroqTransport,
  type ModelUsage,
  type ProviderInvocationInput,
} from '@qf-jarvis/model-gateway';

import type { SmokeConfig } from './config.js';
import {
  createDiagnosticRecorder,
  createSystemMonotonicClock,
  type DiagnosticRecorder,
  type SmokeDiagnostics,
} from './diagnostic-telemetry.js';
import {
  createMaskedTtyCredentialResolver,
  type MaskedSecretSource,
  type StagingCredentialResolver,
} from './masked-tty-credential-resolver.js';
import { SMOKE_SUCCESS_REASON, type SmokeFailureReason } from './smoke-reasons.js';
import {
  isSyntheticSmokeResponse,
  SYNTHETIC_SMOKE_JSON_SCHEMA,
  SYNTHETIC_SMOKE_MESSAGES,
} from './synthetic-prompt.js';

/** The narrow timer seam. Production arms a real `setTimeout`; tests fire it deterministically. */
export interface SmokeTimer {
  /** Arm a one-shot timer. Returns the cancel function the harness calls in its `finally`. */
  arm(ms: number, onFire: () => void): () => void;
}

/** The production timer. One `setTimeout`, one `clearTimeout`, nothing else. */
export function createSystemSmokeTimer(): SmokeTimer {
  return {
    arm(ms: number, onFire: () => void): () => void {
      const handle = setTimeout(onFire, ms);
      // Keeps a still-armed timer from holding the one-shot process open after the result is printed.
      handle.unref();
      return () => {
        clearTimeout(handle);
      };
    },
  };
}

/** Everything the run needs from the outside world. All injected; none reached for. */
export interface SmokeRunDeps {
  /** Production: `createFetchGroqTransport()`. Tests: a deterministic fake. Never both. */
  readonly transport: GroqTransport;
  /** Production: the masked TTY. Tests: a scripted fake that touches no real terminal. */
  readonly credentialSource: MaskedSecretSource;
  readonly clock: GatewayClock;
  readonly timer: SmokeTimer;
  /**
   * QFJ-S1D-B. The run-local diagnostic recorder. Optional so every pre-existing composition keeps
   * working unchanged; production supplies the SAME recorder the instrumented transport holds, which
   * is what lets the wire milestones and the run milestones share one timeline.
   */
  readonly diagnostics?: DiagnosticRecorder;
}

/** The one-request counters. They are the proof that "exactly once" held, not a claim that it did. */
export interface SmokeCounters {
  readonly binds: number;
  readonly credentialReads: number;
  readonly invocations: number;
  readonly timersArmed: number;
  readonly timersCleared: number;
}

/** The safe reference set echoed on every outcome. Identifiers only — never the credential reference. */
export interface SmokeReferences {
  readonly releaseId: string;
  readonly providerId: string;
  readonly modelId: string;
  readonly modelVersion: string;
  readonly configDigest: string;
  readonly capabilityProfileRef: string;
  readonly evaluationRef: string;
  readonly dataControlsAttestationRef: string;
  readonly promptFamily: string;
  readonly promptVersion: number;
  readonly schemaRevision: string;
}

/** The frozen terminal outcome. Nothing here can carry a key, a prompt, an output, or a raw error. */
export type SmokeRunResult =
  | {
      readonly ok: true;
      readonly reason: typeof SMOKE_SUCCESS_REASON;
      readonly references: SmokeReferences;
      readonly latencyMs: number;
      readonly usage: ModelUsage;
      readonly counters: SmokeCounters;
      readonly diagnostics: SmokeDiagnostics;
    }
  | {
      readonly ok: false;
      readonly reason: SmokeFailureReason;
      readonly references: SmokeReferences;
      /** The sanitized gateway bind reason, when the bind itself refused. */
      readonly bindReason?: GroqStagingBindReason;
      /** The normalized provider retryability, when the provider refused. Never acted upon here. */
      readonly retryable?: boolean;
      readonly counters: SmokeCounters;
      readonly diagnostics: SmokeDiagnostics;
    };

/** The outcome BEFORE counters are attached, so the `finally` cleanup is reflected in what is reported. */
type SmokeOutcome =
  | { readonly ok: true; readonly latencyMs: number; readonly usage: ModelUsage }
  | {
      readonly ok: false;
      readonly reason: SmokeFailureReason;
      readonly bindReason?: GroqStagingBindReason;
      readonly retryable?: boolean;
    };

interface MutableCounters {
  binds: number;
  credentialReads: number;
  invocations: number;
  timersArmed: number;
  timersCleared: number;
}

function referencesOf(config: SmokeConfig): SmokeReferences {
  return Object.freeze({
    releaseId: config.release.releaseId,
    providerId: config.release.providerId,
    modelId: config.release.modelId,
    modelVersion: config.release.modelVersion,
    configDigest: config.release.configDigest,
    capabilityProfileRef: config.capabilityProfileRef,
    evaluationRef: config.evaluationRef,
    dataControlsAttestationRef: config.dataControlsAttestationRef,
    promptFamily: config.promptFamily,
    promptVersion: config.promptVersion,
    schemaRevision: config.schemaRevision,
  });
}

/** Bind once, invoke once, classify. Never loops, never retries, never calls anything else. */
async function bindAndInvokeOnce(
  config: SmokeConfig,
  deps: SmokeRunDeps,
  resolver: StagingCredentialResolver,
  controller: AbortController,
  timedOut: { value: boolean },
  counters: MutableCounters,
  recorder: DiagnosticRecorder,
): Promise<SmokeOutcome> {
  counters.binds += 1;
  recorder.mark('bindStarted');
  const bind = await bindGroqStagingProvider({
    stagingRelease: {
      release: createProviderReleaseRef(config.release),
      dataClass: config.dataClass,
      maxInputTokens: config.maxInputTokens,
      maxCompletionTokens: config.maxCompletionTokens,
      supportsStrictJsonSchema: config.supportsStrictJsonSchema,
      dataControlsAttested: config.dataControlsAttested,
      capabilityProfileRef: config.capabilityProfileRef,
      evaluationRef: config.evaluationRef,
      dataControlsAttestationRef: config.dataControlsAttestationRef,
      promptFamily: config.promptFamily,
      promptVersion: config.promptVersion,
    },
    credentialReference: { ref: config.credentialReference },
    credentialResolver: resolver,
    transport: deps.transport,
    clock: deps.clock,
  });

  if (!bind.ok) {
    // The gateway collapses every resolver rejection to `groq-bind-credential-unavailable`. The
    // resolver's own sanitized code is more specific, so prefer it when that is why we failed.
    const credentialCode = resolver.lastFailure();
    const reason: SmokeFailureReason =
      bind.reason === 'groq-bind-credential-unavailable' && credentialCode !== undefined
        ? credentialCode
        : 'smoke-bind-refused';
    return { ok: false, reason, bindReason: bind.reason };
  }

  // The ONE invocation. There is no loop and no second call site anywhere in this package.
  const input: ProviderInvocationInput = {
    runId: `${config.promptFamily}.v${String(config.promptVersion)}`,
    messages: SYNTHETIC_SMOKE_MESSAGES,
    resultMode: 'STRUCTURED',
    structuredJsonSchema: SYNTHETIC_SMOKE_JSON_SCHEMA,
    timeoutMs: config.timeoutMs,
    signal: controller.signal,
  };
  // The smoke has finished building the single invocation input. The gateway serialises the wire body
  // itself, so this marks OUR construction, not the HTTP payload.
  recorder.mark('requestConstructed');

  counters.invocations += 1;
  if (counters.invocations > 1) {
    // Unreachable by construction; present so a future edit that introduced a loop fails loudly.
    return { ok: false, reason: 'smoke-invariant' };
  }

  let result;
  try {
    recorder.mark('invokeStarted');
    result = await bind.provider.invoke(input);
  } catch {
    // A provider signals a normal failure by RETURNING a status; a throw is an adapter/harness invariant.
    return { ok: false, reason: 'smoke-invariant' };
  }

  switch (result.status) {
    case 'completed': {
      if (result.output.mode !== 'STRUCTURED' || !isSyntheticSmokeResponse(result.output.value)) {
        return { ok: false, reason: 'smoke-provider-malformed' };
      }
      // The value satisfied the strict shape. It is now DISCARDED — never returned or printed.
      return { ok: true, latencyMs: result.latencyMs, usage: result.usage ?? {} };
    }
    case 'timeout':
      return { ok: false, reason: 'smoke-timeout' };
    case 'cancelled':
      return { ok: false, reason: timedOut.value ? 'smoke-timeout' : 'smoke-cancelled' };
    case 'unavailable':
      return {
        ok: false,
        reason: 'smoke-provider-unavailable',
        retryable: result.retryable ?? false,
      };
    case 'failed':
      return { ok: false, reason: 'smoke-provider-failed', retryable: result.retryable ?? false };
    case 'malformed':
      return { ok: false, reason: 'smoke-provider-malformed' };
    default:
      return { ok: false, reason: 'smoke-invariant' };
  }
}

/**
 * Wrap the resolver so a SUCCESSFUL credential resolution stamps its milestone.
 *
 * It is a pass-through in every other respect: the resolved key is returned untouched and is never
 * inspected, copied, logged, or retained here, and `reads`/`lastFailure` delegate verbatim. A rejection
 * stamps nothing, so `credentialResolved` proves a real read rather than an attempt.
 */
function withCredentialMilestone(
  resolver: StagingCredentialResolver,
  recorder: DiagnosticRecorder,
): StagingCredentialResolver {
  return Object.freeze({
    async resolve(reference: GroqCredentialReference) {
      const key = await resolver.resolve(reference);
      recorder.mark('credentialResolved');
      return key;
    },
    reads: () => resolver.reads(),
    lastFailure: () => resolver.lastFailure(),
  });
}

/**
 * Run the single synthetic staging smoke.
 *
 * Ordering matters and is asserted by the tests: the TTY gate runs FIRST, so a non-interactive session
 * is refused before any credential read is attempted; the gateway's own fail-closed gates then run
 * before the credential is resolved; the timer is armed around the one invocation only; and the timer is
 * always cancelled in the `finally`, on every path including a thrown one.
 */
export async function runGroqStagingSmokeOnce(
  config: SmokeConfig,
  deps: SmokeRunDeps,
): Promise<SmokeRunResult> {
  const references = referencesOf(config);
  const recorder = deps.diagnostics ?? createDiagnosticRecorder(createSystemMonotonicClock());
  const counters: MutableCounters = {
    binds: 0,
    credentialReads: 0,
    invocations: 0,
    timersArmed: 0,
    timersCleared: 0,
  };

  // An interactive terminal is required. Refused BEFORE the resolver is even constructed, so a piped or
  // redirected session can never reach a prompt — and never leaves a key in a shell pipeline.
  if (!deps.credentialSource.isInteractive()) {
    return Object.freeze({
      ok: false as const,
      reason: 'smoke-tty-required' as const,
      references,
      counters: Object.freeze({ ...counters }),
      diagnostics: recorder.snapshot(),
    });
  }

  // The resolver is wrapped only to stamp the credential milestone. The wrapper adds no behaviour: it
  // never inspects, copies, or retains the key, and it forwards `reads`/`lastFailure` untouched.
  const resolver = withCredentialMilestone(
    createMaskedTtyCredentialResolver(deps.credentialSource),
    recorder,
  );

  // Exactly one AbortController and exactly one timer, both owned here. The arm order is UNCHANGED:
  // the timer is still armed before credential resolution, so the 30 s bound still covers typing time.
  const controller = new AbortController();
  const timedOut = { value: false };
  const cancelTimer = deps.timer.arm(config.timeoutMs, () => {
    timedOut.value = true;
    // Freeze the phase from the milestones proven at THIS instant, before the abort propagates.
    recorder.markAbort();
    controller.abort();
  });
  counters.timersArmed += 1;
  recorder.mark('timerArmed');

  let outcome: SmokeOutcome;
  try {
    outcome = await bindAndInvokeOnce(
      config,
      deps,
      resolver,
      controller,
      timedOut,
      counters,
      recorder,
    );
  } catch {
    outcome = { ok: false, reason: 'smoke-invariant' };
  } finally {
    // Always. On success, on refusal, and on a thrown path. A leaked timer would hold the process open,
    // and an un-cancelled abort would fire after the run had already reported its outcome.
    cancelTimer();
    counters.timersCleared += 1;
    recorder.mark('invokeSettled');
  }

  counters.credentialReads = resolver.reads();
  const finalCounters = Object.freeze({ ...counters });
  const diagnostics = recorder.snapshot();

  if (outcome.ok) {
    return Object.freeze({
      ok: true as const,
      reason: SMOKE_SUCCESS_REASON,
      references,
      latencyMs: outcome.latencyMs,
      usage: outcome.usage,
      counters: finalCounters,
      diagnostics,
    });
  }
  return Object.freeze({
    ok: false as const,
    reason: outcome.reason,
    references,
    ...(outcome.bindReason === undefined ? {} : { bindReason: outcome.bindReason }),
    ...(outcome.retryable === undefined ? {} : { retryable: outcome.retryable }),
    counters: finalCounters,
    diagnostics,
  });
}
