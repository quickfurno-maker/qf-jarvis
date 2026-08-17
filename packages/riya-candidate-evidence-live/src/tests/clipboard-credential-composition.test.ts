/**
 * MVP-P2A.2 HF4-R5 — copy once, read once, reuse once.
 *
 * ### The property that is invisible from outside the process
 *
 * "The smoke and the safety phase used the SAME credential" cannot be observed from a terminal, a
 * receipt, or a provider. It is exactly the kind of claim HF3 learned to distrust: the ledger choice
 * was inline in `main()`, a mutation swapped it, and nothing failed. So the wiring lives in
 * `createCredentialComposition`, and these specs assert OBJECT IDENTITY across the two phases plus a
 * count of how many times the OS clipboard was entered.
 *
 * Matrix: clipboard mode reads once and hands the same holder to both phases; a failed smoke stops
 * before the candidate credential is ever requested, with the clipboard already cleared; TTY mode
 * still constructs two independent one-shot sources and is unchanged; preflight demands a terminal for
 * the TTY ingress and does not for the clipboard one; the CLI accepts exactly two reviewed modes and
 * refuses every other spelling; and the notice an owner reads never claims a second entry is coming
 * when none is.
 *
 * NOTHING here reads or clears a real clipboard, spawns a real helper, or uses a real credential.
 */
import {
  computeSmokeApprovalDigest,
  parseSmokeConfig,
  runGroqStagingSmokeOnce,
  SMOKE_PROMPT_FAMILY,
  SMOKE_PROMPT_VERSION,
  SMOKE_SCHEMA_REVISION,
} from '@qf-jarvis/groq-staging-smoke';
import type {
  ClipboardTextSource,
  MaskedSecretSource,
  SmokeRunResult,
} from '@qf-jarvis/groq-staging-smoke';
import { manualSmokeTimer, smokeProbeResponseBody } from '@qf-jarvis/groq-staging-smoke/testing';
import { createEvaluationBinding, createSuiteThresholds } from '@qf-jarvis/model-evaluation';
import { createManualClock } from '@qf-jarvis/model-gateway';
import { fakeGroqTransport } from '@qf-jarvis/model-gateway/testing';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it, vi } from 'vitest';

import { parseCliArgs } from '../bin.js';
import {
  CANDIDATE_CAPABILITY_PROFILE_REF,
  CANDIDATE_RELEASE,
  RIYA_CLIENT_PROMPT_DIGEST,
} from '../candidate-release.js';
import { createCredentialComposition } from '../credential-composition.js';
import {
  CREDENTIAL_SOURCE_MODES,
  DEFAULT_CREDENTIAL_SOURCE_MODE,
  isCredentialSourceMode,
} from '../credential-source.js';
import { REUSED_CREDENTIAL_NOTICES, SECOND_CREDENTIAL_NOTICES } from '../internal/run-goal.js';
import { runCandidateEvidenceOperator } from '../operator.js';
import type { OperatorDeps } from '../operator.js';
import type * as ActualPreflightModule from '../preflight.js';
import type { PreflightInput } from '../preflight.js';
import { createSafeConsole } from '../safe-console.js';
import { runPreflightForTesting } from './helpers/preflight-testing.js';

type ActualPreflight = typeof ActualPreflightModule;

const harnessState = vi.hoisted(() => ({ syntheticDigest: '' }));
vi.mock('../preflight.js', async (importOriginal) => {
  const actual = await importOriginal<ActualPreflight>();
  const helper = await import('./helpers/preflight-testing.js');
  return {
    ...actual,
    runPreflight: (input: PreflightInput) =>
      helper.runPreflightForTesting(input, harnessState.syntheticDigest),
  };
});

/** An OBVIOUS synthetic sentinel that LOOKS like a credential — never a real Groq key. */
const CLIPBOARD_SENTINEL = 'FAKE-CLIPBOARD-SENTINEL-NEVER-A-REAL-KEY-0000';
const TTY_SENTINEL = 'FAKE-TTY-SENTINEL-NEVER-A-REAL-KEY-0000';

const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const scratch: string[] = [];
afterAll(() => {
  for (const directory of scratch) {
    rmSync(directory, { recursive: true, force: true });
  }
});
function externalDir(): string {
  const directory = mkdtempSync(join(tmpdir(), 'riya-clipboard-'));
  scratch.push(directory);
  return directory;
}

interface ScriptedClipboard extends ClipboardTextSource {
  readonly reads: () => number;
  readonly constructions: () => number;
}

function scriptedClipboard(value: string = CLIPBOARD_SENTINEL): ScriptedClipboard {
  const state = { reads: 0 };
  return Object.freeze({
    isSupportedPlatform: (): boolean => true,
    readAndClearOnce: (): Promise<string> => {
      state.reads += 1;
      return Promise.resolve(value);
    },
    reads: (): number => state.reads,
    constructions: (): number => 0,
  });
}

function scriptedMaskedSource(): MaskedSecretSource {
  return {
    isInteractive: (): boolean => true,
    readOnce: (): Promise<string> => Promise.resolve(TTY_SENTINEL),
  };
}

/** A valid, secret-free synthetic smoke configuration, digest-consistent with the test seam. */
function writeSmokeConfig(directory: string): { readonly path: string; readonly digest: string } {
  const path = join(directory, 'groq-smoke-config.json');
  const draft = {
    credentialReference: 'secret.qfj-staging.groq.v1',
    release: {
      releaseId: 'rel.groq.qfj-staging.smoke.v1',
      providerId: 'groq',
      modelId: 'openai/gpt-oss-20b',
      modelVersion: 'groq-catalog-snapshot-2026-08-12',
      executionClass: 'HOSTED',
      configDigest: 'a'.repeat(64),
    },
    dataClass: 'HOSTED_ALLOWED',
    maxInputTokens: 4096,
    maxCompletionTokens: 512,
    supportsStrictJsonSchema: true,
    capabilityProfileRef: CANDIDATE_CAPABILITY_PROFILE_REF,
    evaluationRef: 'eval.groq.qfj-staging.smoke.v1',
    dataControlsAttestationRef: 'att.groq.qfj-staging.global-zdr.2026-07-28',
    dataControlsAttested: true,
    promptFamily: SMOKE_PROMPT_FAMILY,
    promptVersion: SMOKE_PROMPT_VERSION,
    schemaRevision: SMOKE_SCHEMA_REVISION,
    timeoutMs: 15_000,
  };
  const parsed = parseSmokeConfig(draft);
  if (!parsed.ok) {
    throw new Error(
      'The synthetic smoke configuration must parse, or this harness proves nothing.',
    );
  }
  const digest = computeSmokeApprovalDigest(parsed.config);
  writeFileSync(
    path,
    JSON.stringify({ ...draft, release: { ...draft.release, configDigest: digest } }),
    'utf8',
  );
  return { path, digest };
}

const REFERENCE = { ref: 'secret.qfj-staging.groq.v1' } as const;

describe('HF4-R5 R1 — one clipboard read, one holder, both phases', () => {
  it('hands the SAME holder to the smoke and to the candidate, reading the clipboard once', async () => {
    const clipboard = scriptedClipboard();
    let maskedSources = 0;
    const composition = createCredentialComposition('clipboard', {
      openMaskedSource: () => {
        maskedSources += 1;
        return scriptedMaskedSource();
      },
      openClipboard: () => clipboard,
    });

    // Nothing is read at construction — a run refused at preflight touches no clipboard at all.
    expect(clipboard.reads()).toBe(0);
    expect(composition.ingressCounters()).toBeUndefined();

    // PHASE ONE: the smoke opens the ingress and resolves through it.
    const smokeCredential = await composition.openSmokeCredential();
    expect(smokeCredential.credentialSource).toBeUndefined();
    const resolver = smokeCredential.credentialResolver;
    expect(resolver).toBeDefined();
    const smokeHolder = await resolver?.resolve(REFERENCE);

    // PHASE TWO: safety asks, and gets the very same object back.
    const safetyHolder = await composition.openCandidateCredential(REFERENCE);

    expect(safetyHolder).toBe(smokeHolder);
    expect(clipboard.reads()).toBe(1);
    // No masked terminal was constructed anywhere in a clipboard run.
    expect(maskedSources).toBe(0);

    const counters = composition.ingressCounters();
    expect(counters).toEqual({
      credentialClipboardReadAttempts: 1,
      credentialClipboardReads: 1,
      credentialClipboardCleared: true,
      credentialHolderCreations: 1,
      credentialReuseCount: 2,
    });
  });

  it('reuses ONE resolver object, so a later phase cannot start a second ingress', async () => {
    const clipboard = scriptedClipboard();
    const composition = createCredentialComposition('clipboard', {
      openMaskedSource: scriptedMaskedSource,
      openClipboard: () => clipboard,
    });
    const first = await composition.openSmokeCredential();
    const second = await composition.openSmokeCredential();
    expect(first.credentialResolver).toBe(second.credentialResolver);
    expect(clipboard.reads()).toBe(0);
  });

  it('the OS seam is built at most ONCE, so no second helper can be spawned', async () => {
    let clipboardsBuilt = 0;
    const clipboard = scriptedClipboard();
    const composition = createCredentialComposition('clipboard', {
      openMaskedSource: scriptedMaskedSource,
      openClipboard: () => {
        clipboardsBuilt += 1;
        return clipboard;
      },
    });
    await composition.openSmokeCredential();
    await composition.openCandidateCredential(REFERENCE);
    await composition.openCandidateCredential(REFERENCE);
    expect(clipboardsBuilt).toBe(1);
    expect(clipboard.reads()).toBe(1);
  });
});

describe('HF4-R5 R5 — the masked-TTY ingress is unchanged', () => {
  it('supplies a SOURCE, not a resolver, and constructs one per read', async () => {
    let maskedSources = 0;
    let clipboardsBuilt = 0;
    const composition = createCredentialComposition('tty', {
      openMaskedSource: () => {
        maskedSources += 1;
        return scriptedMaskedSource();
      },
      openClipboard: () => {
        clipboardsBuilt += 1;
        return scriptedClipboard();
      },
    });

    const smokeCredential = await composition.openSmokeCredential();
    expect(smokeCredential.credentialSource).toBeDefined();
    expect(smokeCredential.credentialResolver).toBeUndefined();
    expect(maskedSources).toBe(1);

    await composition.openCandidateCredential(REFERENCE);
    // TWO independent one-shot sources, exactly as before HF4-R5. Nothing is reused across the phases.
    expect(maskedSources).toBe(2);
    // And a TTY run never constructs a clipboard seam at all.
    expect(clipboardsBuilt).toBe(0);
    expect(composition.ingressCounters()).toBeUndefined();
  });

  it('the two TTY phases produce DIFFERENT holders — no accidental reuse crept in', async () => {
    const composition = createCredentialComposition('tty', {
      openMaskedSource: scriptedMaskedSource,
      openClipboard: () => scriptedClipboard(),
    });
    const first = await composition.openCandidateCredential(REFERENCE);
    const second = await composition.openCandidateCredential(REFERENCE);
    expect(first).not.toBe(second);
  });
});

describe('HF4-R5 — preflight gates the ingress that actually reads a terminal', () => {
  const baseInput = (over: Partial<PreflightInput>): PreflightInput => {
    const { path, digest } = writeSmokeConfig(externalDir());
    harnessState.syntheticDigest = digest;
    return {
      smokeConfigPath: path,
      reviewOutputPath: join(externalDir(), 'bundle.json'),
      repoRoot: REPO_ROOT,
      interactive: true,
      ...over,
    };
  };

  it('R4 TTY mode without a terminal is refused, exactly as before', () => {
    const input = baseInput({ interactive: false, credentialSource: 'tty' });
    const result = runPreflightForTesting(input, harnessState.syntheticDigest);
    expect(result.ok).toBe(false);
    expect(result.ok ? undefined : result.failure).toBe('tty-unavailable');
  });

  it('absence still means TTY, so a pre-HF4-R5 caller is gated identically', () => {
    const input = baseInput({ interactive: false });
    const result = runPreflightForTesting(input, harnessState.syntheticDigest);
    expect(result.ok).toBe(false);
    expect(result.ok ? undefined : result.failure).toBe('tty-unavailable');
  });

  it('R3 clipboard mode without a terminal PASSES — it reads no stdin', () => {
    const input = baseInput({ interactive: false, credentialSource: 'clipboard' });
    const result = runPreflightForTesting(input, harnessState.syntheticDigest);
    expect(result.ok).toBe(true);
  });
});

describe('HF4-R5 — the CLI accepts a MODE and never a carrier', () => {
  it('accepts exactly the two reviewed spellings', () => {
    for (const mode of CREDENTIAL_SOURCE_MODES) {
      const parsed = parseCliArgs(['--credential-source', mode]);
      expect(parsed.ok).toBe(true);
      expect(parsed.ok ? parsed.args.credentialSource : undefined).toBe(mode);
    }
    expect(DEFAULT_CREDENTIAL_SOURCE_MODE).toBe('tty');
    expect([...CREDENTIAL_SOURCE_MODES]).toEqual(['tty', 'clipboard']);
  });

  it('absence leaves the mode unset, so the old command line is unchanged', () => {
    const parsed = parseCliArgs(['--run-goal', 'SAFETY_REPLICATION']);
    expect(parsed.ok).toBe(true);
    expect(parsed.ok ? parsed.args.credentialSource : 'set').toBeUndefined();
  });

  it('refuses an unknown mode, a duplicate, and a missing value', () => {
    expect(parseCliArgs(['--credential-source', 'CLIPBOARD'])).toEqual({
      ok: false,
      reason: 'invalid-credential-source',
    });
    expect(parseCliArgs(['--credential-source', 'env'])).toEqual({
      ok: false,
      reason: 'invalid-credential-source',
    });
    expect(
      parseCliArgs(['--credential-source', 'tty', '--credential-source', 'clipboard']),
    ).toEqual({ ok: false, reason: 'duplicate-credential-source' });
    expect(parseCliArgs(['--credential-source'])).toEqual({ ok: false, reason: 'missing-value' });
    expect(parseCliArgs(['--credential-source', '--run-goal'])).toEqual({
      ok: false,
      reason: 'missing-value',
    });
  });

  it('still refuses every flag whose VALUE would be the secret', () => {
    for (const flag of ['--credential', '--api-key', '--key', '--secret', '--token']) {
      expect(parseCliArgs([flag, CLIPBOARD_SENTINEL])).toEqual({
        ok: false,
        reason: 'unknown-argument',
      });
    }
  });

  it('narrows only the closed set', () => {
    expect(isCredentialSourceMode('tty')).toBe(true);
    expect(isCredentialSourceMode('clipboard')).toBe(true);
    expect(isCredentialSourceMode('env')).toBe(false);
    expect(isCredentialSourceMode('')).toBe(false);
  });
});

/** Drive the REAL operator with the REAL composition and a fake clipboard. */
async function runOperator(options: {
  readonly mode: 'tty' | 'clipboard';
  readonly clipboard?: ScriptedClipboard;
  readonly smoke?: SmokeRunResult;
}): Promise<{
  readonly lines: readonly string[];
  readonly notices: readonly string[];
  readonly candidateRequests: number;
  readonly smokeHolder: unknown;
  readonly safetyHolder: unknown;
  readonly outcome: string;
}> {
  const lines: string[] = [];
  const notices: string[] = [];
  const clipboard = options.clipboard ?? scriptedClipboard();
  const { path: smokeConfigPath, digest } = writeSmokeConfig(externalDir());
  harnessState.syntheticDigest = digest;

  const composition = createCredentialComposition(options.mode, {
    openMaskedSource: scriptedMaskedSource,
    openClipboard: () => clipboard,
  });

  let candidateRequests = 0;
  let smokeHolder: unknown;
  let safetyHolder: unknown;

  const console_ = createSafeConsole((line) => lines.push(line));
  const deps: OperatorDeps = {
    console: {
      line: (value) => {
        console_.line(value);
      },
      notice: (text: string) => {
        notices.push(text);
        console_.notice(text);
      },
    },
    preflight: {
      smokeConfigPath,
      reviewOutputPath: join(externalDir(), 'bundle.json'),
      repoRoot: REPO_ROOT,
      // Deliberately FALSE for the clipboard run: it must get past preflight without a terminal.
      interactive: options.mode === 'tty',
      credentialSource: options.mode,
    },
    runGoal: 'SAFETY_REPLICATION',
    credentialSource: options.mode,
    openSmokeCredential: composition.openSmokeCredential,
    ingressCounters: composition.ingressCounters,
    runSmoke: async (config, credential) => {
      if (options.smoke !== undefined) {
        // Model a run whose ingress succeeded and whose PROVIDER then failed: the credential is
        // resolved first, exactly as the real harness resolves it during the bind.
        smokeHolder = await credential.credentialResolver?.resolve(REFERENCE);
        return options.smoke;
      }
      const result = await runGroqStagingSmokeOnce(config, {
        transport: fakeGroqTransport(smokeProbeResponseBody()),
        ...credential,
        clock: createManualClock(),
        timer: manualSmokeTimer(),
      });
      smokeHolder = await credential.credentialResolver?.resolve(REFERENCE);
      return result;
    },
    openCandidateCredential: async (reference) => {
      candidateRequests += 1;
      safetyHolder = await composition.openCandidateCredential(reference);
      return safetyHolder;
    },
    // Refuse the candidate bind: this suite is about the credential, not about safety execution.
    openCandidate: () => Promise.reject(new Error('SYNTHETIC-BIND-STOP')),
    binding: createEvaluationBinding({
      evaluationSuiteId: 'riya.candidate.safety.suite.v1',
      evaluationSuiteVersion: 2,
      fixtureManifestId: 'riya.candidate.safety.v1',
      fixtureManifestVersion: 4,
      evaluatorImplId: 'qfj.eval.deterministic',
      evaluatorImplVersion: 1,
      release: CANDIDATE_RELEASE,
      promptFamily: 'riya.client-sales',
      promptVersion: 1,
      promptDigest: RIYA_CLIENT_PROMPT_DIGEST,
      capabilityProfileRef: CANDIDATE_CAPABILITY_PROFILE_REF,
      knowledgeRevision: 'know.rev.1',
      policyContractRevision: 'policy.rev.1',
      createdAt: '2026-08-12T00:00:00.000Z',
    }),
    thresholds: createSuiteThresholds({
      thresholdsId: 'riya.candidate.safety.thresholds.v1',
      thresholdsVersion: 1,
    }),
    repoRoot: REPO_ROOT,
  };

  const result = await runCandidateEvidenceOperator(deps);
  return {
    lines,
    notices,
    candidateRequests,
    smokeHolder,
    safetyHolder,
    outcome: result.outcome,
  };
}

describe('HF4-R5 R1/R2 — the real operator, end to end, with a fake clipboard', () => {
  it('R1 a passing smoke reaches safety with the SAME holder and one clipboard read', async () => {
    const clipboard = scriptedClipboard();
    const run = await runOperator({ mode: 'clipboard', clipboard });

    // It got past preflight with `interactive: false`, ran the real smoke, and reached the candidate.
    expect(run.candidateRequests).toBe(1);
    expect(run.smokeHolder).toBeDefined();
    expect(run.safetyHolder).toBe(run.smokeHolder);
    expect(clipboard.reads()).toBe(1);
    // The owner was told the credential is being REUSED, not asked for it again.
    expect(run.notices).toEqual([REUSED_CREDENTIAL_NOTICES.SAFETY_REPLICATION]);
    expect(run.notices[0]).not.toContain('Enter');
  });

  it('R2 a failed smoke stops before the candidate credential is ever requested', async () => {
    const clipboard = scriptedClipboard();
    const run = await runOperator({
      mode: 'clipboard',
      clipboard,
      smoke: {
        ok: false,
        reason: 'smoke-provider-failed',
        references: {},
        counters: {},
        diagnostics: {},
      } as unknown as SmokeRunResult,
    });

    expect(run.outcome).toBe('SMOKE_FAILED');
    // No second phase, and therefore no second ingress.
    expect(run.candidateRequests).toBe(0);
    expect(run.notices).toEqual([]);
    // The clipboard was read exactly once and is already cleared — the fact an owner needs after a
    // failure, because it says whether a live key is still sitting in their clipboard.
    expect(clipboard.reads()).toBe(1);
    const ingress = run.lines.filter((line) => line.includes('phase=credential-ingress'));
    expect(ingress).toHaveLength(1);
    expect(ingress[0]).toContain('credentialClipboardReads=1');
    expect(ingress[0]).toContain('credentialClipboardCleared=true');
  });

  it('the TTY run still asks for the credential a second time', async () => {
    const run = await runOperator({ mode: 'tty' });
    expect(run.candidateRequests).toBe(1);
    expect(run.notices).toEqual([SECOND_CREDENTIAL_NOTICES.SAFETY_REPLICATION]);
    // Two independent reads, so the two phases hold DIFFERENT holders — unchanged behaviour.
    expect(run.safetyHolder).not.toBe(run.smokeHolder);
  });
});

describe('HF4-R5 — nothing a run prints can carry the credential', () => {
  it('no emitted line contains the sentinel, a prefix, a suffix, or a length', async () => {
    const clipboard = scriptedClipboard();
    const run = await runOperator({ mode: 'clipboard', clipboard });
    const all = run.lines.join('\n') + '\n' + run.notices.join('\n');

    expect(all).not.toContain(CLIPBOARD_SENTINEL);
    expect(all).not.toContain(TTY_SENTINEL);
    // Not even a fragment of it.
    expect(all).not.toContain(CLIPBOARD_SENTINEL.slice(0, 8));
    expect(all).not.toContain(CLIPBOARD_SENTINEL.slice(-8));
    // And no field that narrows the value by stating its size.
    expect(all).not.toContain(String(CLIPBOARD_SENTINEL.length));
    expect(all).not.toMatch(/credentialLength|credentialHash|credentialFingerprint/i);

    // The ingress line reports the mode and the counts, and stops there.
    const ingress = run.lines.filter((line) => line.includes('phase=credential-ingress'));
    expect(ingress.length).toBeGreaterThan(0);
    for (const line of ingress) {
      expect(line).toContain('credentialSource=clipboard');
      expect(line).not.toMatch(/value|secret|key=|token|clipboardText/i);
    }
  });
});
