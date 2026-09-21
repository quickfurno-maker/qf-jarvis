/** JF-5B-R25 Groq-only live CLI. Every test uses injected seams; zero real network. */
import { describe, expect, it } from 'vitest';

import {
  CERTIFIED_AGENTS,
  EXIT_CODES,
  GROQ_DATA_CONTROLS_REF,
  JF5B_EVALUATION_SUITE_ID,
  JF5B_EVALUATION_SUITE_VERSION,
  JF5B_FIXTURE_MANIFEST_ID,
  JF5B_PROVIDER_MODE,
  JF5B_RED_TEAM_SUITE_ID,
  LIVE_CONFIRMATION_PHRASE,
  PROMPT_BY_AGENT,
  createJf5bCoverageManifest,
  type ArtifactWriter,
  type ConfirmationReader,
  type OperatorIo,
  type RepositoryFacts,
} from '@qf-jarvis/jarvis-v1-provider-certification-live';
import { createGroqApiKey } from '@qf-jarvis/model-gateway';

import type { CertificationRunner, CertifyAllResult } from '../cli/jf5b-certification-runner.js';
import type { GroqConnectivityCheck } from '../cli/jf5b-live-deps.js';
import {
  runJf5bLiveCertificationCli,
  type Jf5bCliDeps,
} from '../cli/run-jf5b-live-certification.js';

const REPO = 'C:/repo/qf-jarvis-jf5b';
const OUTSIDE = 'D:/jarvis-certification/JF-5B/groq-only-test';
const REVIEW_DIGEST = 'c'.repeat(64);

const FULL_ARGV = [
  '--execute-live',
  '--output-dir',
  OUTSIDE,
  '--groq-smoke-config',
  'D:/certification/smoke.json',
] as const;

function manifest() {
  return createJf5bCoverageManifest({
    manifestVersion: 2,
    providerMode: JF5B_PROVIDER_MODE,
    runId: 'run.jf5b.groq-only.test',
    headSha: 'a'.repeat(40),
    createdAt: '2026-09-21T05:00:00Z',
    dataControlsRefs: [GROQ_DATA_CONTROLS_REF],
    entries: CERTIFIED_AGENTS.map((agent, index) => {
      const prompt = PROMPT_BY_AGENT[agent];
      return {
        provider: 'groq',
        agent,
        releaseId: 'rel.jf5b.groq.1',
        modelId: 'openai/gpt-oss-120b',
        modelVersion: 'certification-snapshot-2026-09-11',
        configDigest: 'b'.repeat(64),
        promptFamily: prompt.promptId,
        promptVersion: prompt.promptVersion,
        promptDigest: prompt.contentDigest,
        evaluationSuiteId: JF5B_EVALUATION_SUITE_ID,
        evaluationSuiteVersion: JF5B_EVALUATION_SUITE_VERSION,
        redTeamSuiteId: JF5B_RED_TEAM_SUITE_ID,
        fixtureManifestId: JF5B_FIXTURE_MANIFEST_ID,
        liveRunId: 'run.jf5b.groq-only.test',
        caseSetDigest: String(index + 1).repeat(64),
        resultDigest: String(index + 4).repeat(64),
        safety: 'PASS',
        qualityReview: 'REVIEW_PENDING',
        languageCounts: { EN: 1, HI: 1, HINGLISH: 1 },
        reviewBundleDigest: REVIEW_DIGEST,
      };
    }),
  });
}

function successResult(): CertifyAllResult {
  return {
    ok: true,
    reason: 'certified',
    cases: [],
    diagnostics: [],
    manifest: manifest(),
    rawBundle: JSON.stringify({ providerMode: 'GROQ_ONLY', outputs: [] }),
    reviewBundle: JSON.stringify({ providerMode: 'GROQ_ONLY', items: [] }),
  };
}

function failureResult(): CertifyAllResult {
  return {
    ok: false,
    reason: 'safety-incomplete',
    cases: [],
    diagnostics: [],
    manifest: undefined,
    rawBundle: '',
    reviewBundle: '',
  };
}

function harness(
  over: {
    readonly facts?: Partial<RepositoryFacts>;
    readonly interactive?: boolean;
    readonly typed?: string;
    readonly groqOk?: boolean;
    readonly certification?: CertifyAllResult;
  } = {},
) {
  const seen = {
    lines: [] as string[],
    errors: [] as string[],
    confirmationReads: 0,
    groqRuns: 0,
    certifyGroqOnlyCalls: 0,
    historicalNaraCalls: 0,
    filesWritten: [] as string[],
    fileContents: new Map<string, string>(),
  };

  const io: OperatorIo = {
    out: (line) => seen.lines.push(line),
    err: (line) => seen.errors.push(line),
  };
  const confirmation: ConfirmationReader = {
    isInteractive: () => over.interactive ?? true,
    readLine: () => {
      seen.confirmationReads += 1;
      return Promise.resolve(over.typed ?? LIVE_CONFIRMATION_PHRASE);
    },
  };
  const facts: RepositoryFacts = {
    headSha: 'a'.repeat(40),
    worktreeClean: true,
    repositoryRoot: REPO,
    resolvedOutputDirectory: OUTSIDE,
    ...over.facts,
  };
  const groqConnectivity: GroqConnectivityCheck = {
    run: (input) => {
      seen.groqRuns += 1;
      const reserved = input.reserve();
      if (!reserved) return Promise.resolve({ ok: false as const, reason: 'budget-exhausted' });
      return Promise.resolve(
        over.groqOk === false
          ? { ok: false as const, reason: 'smoke-transport-failed' }
          : { ok: true as const, key: createGroqApiKey('gsk-synthetic-certification-key-0000') },
      );
    },
  };
  const runner: CertificationRunner = {
    certifyGroqOnly: () => {
      seen.certifyGroqOnlyCalls += 1;
      return Promise.resolve(over.certification ?? successResult());
    },
    selectNaraModel: () => {
      seen.historicalNaraCalls += 1;
      return Promise.resolve({ ok: false as const, reason: 'disabled', probes: [] });
    },
    certifyAllSix: () => {
      seen.historicalNaraCalls += 1;
      return Promise.resolve(failureResult());
    },
    certifyAutoRouting: () => {
      seen.historicalNaraCalls += 1;
      return Promise.resolve({
        ok: false,
        reason: 'disabled',
        groqSuccessNaraCalls: 0,
        forcedFallbackAttempts: 0,
        forcedFallbackNaraCalls: 0,
        nonFallbackNaraCalls: 0,
        retryCount: 0,
      });
    },
  };
  const artifacts: ArtifactWriter = {
    ensureDirectory: () => undefined,
    writeFile: (relativePath, value) => {
      seen.filesWritten.push(relativePath);
      seen.fileContents.set(relativePath, value);
    },
    digestOf: () => 'f'.repeat(64),
  };

  const deps: Jf5bCliDeps = {
    io,
    confirmation,
    facts,
    runId: 'run.jf5b.groq-only.test',
    groqConnectivity,
    runner,
    artifacts,
  };

  return { deps, seen };
}

describe('JF-5B-R25 Groq-only operator gates', () => {
  it('refuses without --execute-live before confirmation or provider work', async () => {
    const { deps, seen } = harness();
    const outcome = await runJf5bLiveCertificationCli(
      ['--output-dir', OUTSIDE, '--groq-smoke-config', 'D:/c.json'],
      deps,
    );
    expect(outcome.reason).toBe('execute-live-flag-absent');
    expect([seen.confirmationReads, seen.groqRuns, seen.certifyGroqOnlyCalls]).toEqual([0, 0, 0]);
  });

  it('refuses a credential-shaped argument rather than interpreting it', async () => {
    const { deps, seen } = harness();
    const outcome = await runJf5bLiveCertificationCli(
      [...FULL_ARGV, '--api-key', 'not-a-real-key'],
      deps,
    );
    expect(outcome.exitCode).toBe(EXIT_CODES.INVALID_USAGE);
    expect(outcome.reason).toBe('unknown-argument');
    expect(seen.groqRuns).toBe(0);
  });

  it('refuses the retired Nara candidate surface before any provider call', async () => {
    const { deps, seen } = harness();
    const outcome = await runJf5bLiveCertificationCli(
      [...FULL_ARGV, '--nara-candidate', 'agnes-2.5-flash'],
      deps,
    );
    expect(outcome.exitCode).toBe(EXIT_CODES.INVALID_USAGE);
    expect(outcome.reason).toBe('unknown-argument');
    expect([seen.groqRuns, seen.certifyGroqOnlyCalls, seen.historicalNaraCalls]).toEqual([0, 0, 0]);
  });

  it('refuses a dirty worktree and an in-repository output before credentials', async () => {
    const dirty = harness({ facts: { worktreeClean: false } });
    expect((await runJf5bLiveCertificationCli(FULL_ARGV, dirty.deps)).reason).toBe(
      'worktree-dirty',
    );
    expect(dirty.seen.groqRuns).toBe(0);

    const inside = harness({ facts: { resolvedOutputDirectory: `${REPO}/out` } });
    expect(
      (
        await runJf5bLiveCertificationCli(
          ['--execute-live', '--output-dir', `${REPO}/out`, '--groq-smoke-config', 'D:/c.json'],
          inside.deps,
        )
      ).reason,
    ).toBe('output-path-inside-repository');
    expect(inside.seen.groqRuns).toBe(0);
  });

  it('requires the interactive confirmation after the Groq-only preflight', async () => {
    const wrong = harness({ typed: 'yes' });
    const outcome = await runJf5bLiveCertificationCli(FULL_ARGV, wrong.deps);
    expect(outcome.reason).toBe('confirmation-phrase-mismatch');
    const text = wrong.seen.lines.join('\n');
    expect(text).toContain('provider mode          GROQ_ONLY');
    expect(text).toContain('nara                   DISABLED');
    expect(text).toContain('max nara calls         0');
    expect(wrong.seen.groqRuns).toBe(0);

    const nonTty = harness({ interactive: false });
    expect((await runJf5bLiveCertificationCli(FULL_ARGV, nonTty.deps)).reason).toBe('not-a-tty');
    expect(nonTty.seen.confirmationReads).toBe(0);
  });
});

describe('JF-5B-R25 Groq-only execution', () => {
  it('stops on Groq connectivity failure without reaching certification', async () => {
    const { deps, seen } = harness({ groqOk: false });
    const outcome = await runJf5bLiveCertificationCli(FULL_ARGV, deps);
    expect(outcome.exitCode).toBe(EXIT_CODES.GROQ_CONNECTIVITY_FAILED);
    expect(seen.groqRuns).toBe(1);
    expect(seen.certifyGroqOnlyCalls).toBe(0);
    expect(seen.historicalNaraCalls).toBe(0);
    expect(seen.filesWritten).toEqual(['receipt-failure.json']);
  });

  it('runs only the Groq-only runner and records zero Nara calls', async () => {
    const { deps, seen } = harness();
    const outcome = await runJf5bLiveCertificationCli(FULL_ARGV, deps);
    expect(outcome.exitCode).toBe(EXIT_CODES.OK);
    expect(outcome.groqCalls).toBe(1);
    expect(outcome.naraCalls).toBe(0);
    expect(seen.groqRuns).toBe(1);
    expect(seen.certifyGroqOnlyCalls).toBe(1);
    expect(seen.historicalNaraCalls).toBe(0);
    expect(seen.lines.join('\n')).toContain('Nara is disabled and was not contacted');
  });

  it('writes only Groq-only certification artifacts on success', async () => {
    const { deps, seen } = harness();
    await runJf5bLiveCertificationCli(FULL_ARGV, deps);
    expect(seen.filesWritten).toEqual([
      'raw/live-outputs.json',
      'review/blinded-review-bundle.json',
      'receipts/cases.json',
      'manifest.json',
    ]);
    const parsed = JSON.parse(seen.fileContents.get('manifest.json') ?? '{}') as {
      manifestVersion?: number;
      providerMode?: string;
      entries?: { provider?: string }[];
      dataControlsRefs?: string[];
    };
    expect(parsed.manifestVersion).toBe(2);
    expect(parsed.providerMode).toBe('GROQ_ONLY');
    expect(parsed.entries).toHaveLength(3);
    expect(parsed.entries?.every((entry) => entry.provider === 'groq')).toBe(true);
    expect(parsed.dataControlsRefs).toEqual([GROQ_DATA_CONTROLS_REF]);
  });

  it('fails closed on any non-PASS Groq certification and mints no manifest artifact', async () => {
    const { deps, seen } = harness({ certification: failureResult() });
    const outcome = await runJf5bLiveCertificationCli(FULL_ARGV, deps);
    expect(outcome.exitCode).toBe(EXIT_CODES.CERTIFICATION_FAILED);
    expect(outcome.reason).toBe('safety-incomplete');
    expect(seen.historicalNaraCalls).toBe(0);
    expect(seen.filesWritten).toEqual(['receipt-certification-failure.json']);
    const receipt = JSON.parse(
      seen.fileContents.get('receipt-certification-failure.json') ?? '{}',
    ) as {
      providerMode?: string;
      naraCalls?: number;
    };
    expect(receipt.providerMode).toBe('GROQ_ONLY');
    expect(receipt.naraCalls).toBe(0);
  });

  it('the output never asks for or names a Nara credential or discovery endpoint', async () => {
    const { deps, seen } = harness();
    await runJf5bLiveCertificationCli(FULL_ARGV, deps);
    const text = [...seen.lines, ...seen.errors].join('\n').toLowerCase();
    expect(text).not.toContain('nara api key');
    expect(text).not.toContain('/v1/models');
    expect(text).not.toContain('router.bynara.id');
  });
});
