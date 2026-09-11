/**
 * The JF-5B live CLI, driven end to end with fakes and ZERO network.
 *
 * ### What these prove
 *
 * The phase ORDER is the safety property, and order is exactly what a spec can pin: preflight before
 * any credential, the typed confirmation before any credential, Groq before Nara, discovery before
 * selection. Each fake records whether it was touched, so "no credential was requested" is a
 * measurement rather than a claim.
 *
 * Every seam is injected, so none of this needs a terminal, a socket or a disk.
 */
import {
  EXIT_CODES,
  JF5B_BUDGET,
  LIVE_CONFIRMATION_PHRASE,
} from '@qf-jarvis/jarvis-v1-provider-certification-live';
import type {
  ArtifactWriter,
  ConfirmationReader,
  DiscoveryHttpResponse,
  NaraDiscoveryTransport,
  OperatorIo,
  RepositoryFacts,
} from '@qf-jarvis/jarvis-v1-provider-certification-live';
import { createGroqApiKey, createNaraApiKey } from '@qf-jarvis/model-gateway';

import { MODEL_REQUIRED_CASES } from '../composition/jf5b-case-corpus.js';
import { describe, expect, it } from 'vitest';

import type { CertificationRunner } from '../cli/jf5b-certification-runner.js';
import type { GroqConnectivityCheck, NaraCredentialGate } from '../cli/jf5b-live-deps.js';
import { runJf5bLiveCertificationCli } from '../cli/run-jf5b-live-certification.js';
import type { Jf5bCliDeps } from '../cli/run-jf5b-live-certification.js';

const REPO = 'C:/repo/qf-jarvis-jf5b';
const OUTSIDE = 'D:/jarvis-certification/JF-5B/run-1';

/** Every fake records whether it was reached, which is how "was not touched" becomes assertable. */
function harness(
  over: {
    readonly facts?: Partial<RepositoryFacts>;
    readonly interactive?: boolean;
    readonly typed?: string;
    readonly groqOk?: boolean;
    readonly credentialOk?: boolean;
    readonly discovery?: DiscoveryHttpResponse | Error;
  } = {},
) {
  const seen = {
    lines: [] as string[],
    errors: [] as string[],
    confirmationReads: 0,
    groqRuns: 0,
    credentialReads: 0,
    discoveryCalls: 0,
    runnerCalls: 0,
    probedShortlist: [] as readonly string[],
    probedObjects: [] as readonly { readonly modelId: string }[],
    filesWritten: [] as string[],
  };

  const io: OperatorIo = {
    out: (line) => seen.lines.push(line),
    err: (line) => seen.errors.push(line),
  };
  const confirmation: ConfirmationReader = {
    isInteractive: () => over.interactive ?? true,
    readLine: (): Promise<string> => {
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
      input.reserve();
      return Promise.resolve(
        over.groqOk === false
          ? { ok: false as const, reason: 'smoke-transport-failed' }
          : // The holder the connectivity phase resolved, handed on to the certification phases. A
            // synthetic value, and still a redacting holder rather than a string.
            { ok: true as const, key: createGroqApiKey('gsk-synthetic-certification-key-0000') },
      );
    },
  };
  const naraCredential: NaraCredentialGate = {
    read: () => {
      seen.credentialReads += 1;
      return Promise.resolve(
        over.credentialOk === false
          ? { ok: false as const, failure: 'nara-credential-not-a-tty' }
          : { ok: true as const, key: createNaraApiKey('nara-synthetic-certification-key-000') },
      );
    },
  };
  const discoveryTransport: NaraDiscoveryTransport = {
    get: (): Promise<DiscoveryHttpResponse> => {
      seen.discoveryCalls += 1;
      const configured = over.discovery;
      if (configured instanceof Error) {
        return Promise.reject(configured);
      }
      return Promise.resolve(
        configured ?? {
          status: 200,
          redirected: false,
          bodyText: JSON.stringify({
            data: [
              { id: 'vendor-a/model-one', context_length: 131_072 },
              { id: 'auto' },
              { id: 'vendor-b/combo/mix', context_length: 99_000 },
            ],
          }),
          bodyBytes: 160,
        },
      );
    },
  };
  const runner: CertificationRunner = {
    selectNaraModel: (input) => {
      seen.runnerCalls += 1;
      // Recorded, not merely counted: what reaches the probes is the whole question in JF-5B-R3.
      seen.probedShortlist = input.shortlist.map((one) => one.modelId);
      seen.probedObjects = input.shortlist;
      return Promise.resolve({ ok: false as const, reason: 'stub' });
    },
    certifyAllSix: () => {
      seen.runnerCalls += 1;
      return Promise.resolve({
        ok: false,
        reason: 'stub',
        cases: [],
        manifest: undefined,
        rawBundle: '',
        reviewBundle: '',
      });
    },
    certifyAutoRouting: () => {
      seen.runnerCalls += 1;
      return Promise.resolve({
        ok: false,
        reason: 'stub',
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
    writeFile: (relativePath) => seen.filesWritten.push(relativePath),
    digestOf: () => 'f'.repeat(64),
  };

  const deps: Jf5bCliDeps = {
    io,
    confirmation,
    facts,
    runId: 'run.jf5b.test',
    groqConnectivity,
    naraCredential,
    discoveryTransport,
    runner,
    artifacts,
  };
  return { deps, seen };
}

/** The exact five the owner selected from the authenticated eligible list. */
const OWNER_SET: readonly string[] = Object.freeze([
  'gpt-5.6-luna',
  'qwen3.8-flash',
  'deepseek-v4.1-flash',
  'glm-5.3-flash',
  'mimo-v2.5',
]);

/**
 * A discovery body shaped like the one the live run actually received: eligible aliases, and NOT ONE
 * context length. That is what made the automatic rule refuse, and what the owner channel exists for.
 */
const ownerDiscovery = (): DiscoveryHttpResponse => {
  const body = JSON.stringify({
    data: [{ id: 'vendor-x/something-else' }, ...OWNER_SET.map((id) => ({ id })), { id: 'auto' }],
  });
  return { status: 200, redirected: false, bodyText: body, bodyBytes: body.length };
};

const withCandidates = (...aliases: readonly string[]): readonly string[] =>
  aliases.flatMap((alias) => ['--nara-candidate', alias]);

const FULL_ARGV = [
  '--execute-live',
  '--output-dir',
  OUTSIDE,
  '--groq-smoke-config',
  'D:/certification/smoke.json',
];

describe('JF-5B (0) the gates refuse before anything is read', () => {
  it('without --execute-live: no confirmation, no credential, no network', async () => {
    const { deps, seen } = harness();
    const outcome = await runJf5bLiveCertificationCli(
      ['--output-dir', OUTSIDE, '--groq-smoke-config', 'D:/c.json'],
      deps,
    );
    expect(outcome.exitCode).toBe(EXIT_CODES.GATE_REFUSED);
    expect(outcome.reason).toBe('execute-live-flag-absent');
    expect([
      seen.confirmationReads,
      seen.groqRuns,
      seen.credentialReads,
      seen.discoveryCalls,
    ]).toEqual([0, 0, 0, 0]);
  });

  it('with the confirmation phrase in argv: refused, because two gates with one key is one gate', async () => {
    const { deps, seen } = harness();
    const outcome = await runJf5bLiveCertificationCli(
      [...FULL_ARGV, LIVE_CONFIRMATION_PHRASE],
      deps,
    );
    // It lands as an unknown argument first, which is itself the refusal; either way nothing ran.
    expect(outcome.exitCode).not.toBe(EXIT_CODES.OK);
    expect([seen.credentialReads, seen.discoveryCalls]).toEqual([0, 0]);
  });

  it('an unknown credential-shaped flag is refused, never interpreted', async () => {
    const { deps, seen } = harness();
    const outcome = await runJf5bLiveCertificationCli(
      ['--execute-live', '--api-key', 'sk-not-real', '--output-dir', OUTSIDE],
      deps,
    );
    expect(outcome.exitCode).toBe(EXIT_CODES.INVALID_USAGE);
    expect(outcome.reason).toBe('unknown-argument');
    expect(seen.credentialReads).toBe(0);
  });

  it('a dirty worktree stops before any credential', async () => {
    const { deps, seen } = harness({ facts: { worktreeClean: false } });
    const outcome = await runJf5bLiveCertificationCli(FULL_ARGV, deps);
    expect(outcome.reason).toBe('worktree-dirty');
    expect([seen.confirmationReads, seen.groqRuns, seen.credentialReads]).toEqual([0, 0, 0]);
  });

  it('an output path inside the repository stops before any credential', async () => {
    const { deps, seen } = harness({
      facts: { resolvedOutputDirectory: `${REPO}/out` },
    });
    const outcome = await runJf5bLiveCertificationCli(
      ['--execute-live', '--output-dir', `${REPO}/out`, '--groq-smoke-config', 'D:/c.json'],
      deps,
    );
    expect(outcome.reason).toBe('output-path-inside-repository');
    expect([seen.confirmationReads, seen.credentialReads]).toEqual([0, 0]);
  });

  it('a wrong typed confirmation stops after the summary and before any credential', async () => {
    const { deps, seen } = harness({ typed: 'yes' });
    const outcome = await runJf5bLiveCertificationCli(FULL_ARGV, deps);
    expect(outcome.exitCode).toBe(EXIT_CODES.GATE_REFUSED);
    expect(outcome.reason).toBe('confirmation-phrase-mismatch');
    // The summary WAS printed: that is what the person was meant to read before typing.
    expect(seen.lines.join('\n')).toContain('PREFLIGHT');
    expect(seen.confirmationReads).toBe(1);
    expect([seen.groqRuns, seen.credentialReads, seen.discoveryCalls]).toEqual([0, 0, 0]);
  });

  it('a non-interactive session stops without reading anything', async () => {
    const { deps, seen } = harness({ interactive: false });
    const outcome = await runJf5bLiveCertificationCli(FULL_ARGV, deps);
    expect(outcome.reason).toBe('not-a-tty');
    expect([seen.confirmationReads, seen.groqRuns, seen.credentialReads]).toEqual([0, 0, 0]);
  });
});

describe('JF-5B (1,2) the phases run in order, and a failure stops the next one', () => {
  it('the preflight summary is printed BEFORE the confirmation is requested', async () => {
    const { deps, seen } = harness({ groqOk: false });
    await runJf5bLiveCertificationCli(FULL_ARGV, deps);
    const summaryIndex = seen.lines.findIndex((line) => line.includes('PREFLIGHT'));
    expect(summaryIndex).toBeGreaterThanOrEqual(0);
    expect(seen.confirmationReads).toBe(1);
    // All three prompt digests appear in what the person was shown.
    const text = seen.lines.join('\n');
    expect(text).toContain('riya.client-sales');
    expect(text).toContain('anisha.vendor-journey');
    expect(text).toContain('aarohi.acquisition');
  });

  it('a Groq connectivity failure stops the run and requests NO Nara credential', async () => {
    const { deps, seen } = harness({ groqOk: false });
    const outcome = await runJf5bLiveCertificationCli(FULL_ARGV, deps);
    expect(outcome.exitCode).toBe(EXIT_CODES.GROQ_CONNECTIVITY_FAILED);
    expect(outcome.phaseReached).toBe('GROQ_CONNECTIVITY');
    expect(seen.groqRuns).toBe(1);
    // The whole point of the ordering: a Groq failure costs nothing on the Nara side.
    expect([seen.credentialReads, seen.discoveryCalls]).toEqual([0, 0]);
    // And a sanitized failure receipt is written; no manifest.
    expect(seen.filesWritten).toEqual(['receipt-failure.json']);
  });

  it('a Nara credential refusal stops before discovery', async () => {
    const { deps, seen } = harness({ credentialOk: false });
    const outcome = await runJf5bLiveCertificationCli(FULL_ARGV, deps);
    expect(outcome.exitCode).toBe(EXIT_CODES.CREDENTIAL_REFUSED);
    expect(seen.credentialReads).toBe(1);
    expect(seen.discoveryCalls).toBe(0);
  });

  it('discovery makes EXACTLY ONE call in the normal case', async () => {
    const { deps, seen } = harness();
    await runJf5bLiveCertificationCli(FULL_ARGV, deps);
    expect(seen.discoveryCalls).toBe(1);
  });

  it('a redirect is REFUSED rather than followed', async () => {
    const { deps, seen } = harness({
      discovery: { status: 302, redirected: true, bodyText: '', bodyBytes: 0 },
    });
    const outcome = await runJf5bLiveCertificationCli(FULL_ARGV, deps);
    expect(outcome.exitCode).toBe(EXIT_CODES.NARA_DISCOVERY_FAILED);
    expect(outcome.reason).toBe('discovery-redirect-refused');
    expect(seen.discoveryCalls).toBe(1);
    expect(seen.runnerCalls).toBe(0);
  });

  it('an unparseable body selects nothing', async () => {
    const { deps, seen } = harness({
      discovery: { status: 200, redirected: false, bodyText: 'not json', bodyBytes: 8 },
    });
    const outcome = await runJf5bLiveCertificationCli(FULL_ARGV, deps);
    expect(outcome.reason).toBe('discovery-invalid-json');
    expect(seen.runnerCalls).toBe(0);
  });

  it('a transport failure is sanitized and never retried', async () => {
    const { deps, seen } = harness({ discovery: new Error('connect ECONNREFUSED 1.2.3.4:443') });
    const outcome = await runJf5bLiveCertificationCli(FULL_ARGV, deps);
    expect(outcome.reason).toBe('discovery-transport-failed');
    // ONE call. A failure is a failure; the operator does not try again.
    expect(seen.discoveryCalls).toBe(1);
    // And the sanitized reason carries no host, no address and no header.
    expect(JSON.stringify(outcome)).not.toContain('ECONNREFUSED');
  });

  it('metadata too thin to rank STOPS and prints the eligible aliases', async () => {
    const { deps, seen } = harness({
      discovery: {
        status: 200,
        redirected: false,
        bodyText: JSON.stringify({ data: [{ id: 'vendor-a/one' }, { id: 'vendor-b/two' }] }),
        bodyBytes: 60,
      },
    });
    const outcome = await runJf5bLiveCertificationCli(FULL_ARGV, deps);
    expect(outcome.exitCode).toBe(EXIT_CODES.NARA_SELECTION_REFUSED);
    expect(outcome.reason).toBe('metadata-insufficient-for-truthful-shortlist');
    // The owner is shown what was eligible, so the decision can be made rather than guessed.
    expect(seen.lines.join('\n')).toContain('eligible: vendor-a/one');
    // Nothing was probed: a stop is a stop.
    expect(seen.runnerCalls).toBe(0);
  });

  it('router aliases and combo models never reach the shortlist', async () => {
    const { deps, seen } = harness();
    await runJf5bLiveCertificationCli(FULL_ARGV, deps);
    const text = seen.lines.join('\n');
    expect(text).toContain('shortlisted: vendor-a/model-one');
    expect(text).not.toContain('shortlisted: auto');
    expect(text).not.toContain('combo');
  });
});

describe('JF-5B-R3 (CLI) the owner candidate set travels through the whole sequence', () => {
  const ARGV = [...FULL_ARGV, ...withCandidates(...OWNER_SET)];

  it('renders the candidates BEFORE the confirmation is requested', async () => {
    const { deps, seen } = harness({ typed: 'no', discovery: ownerDiscovery() });
    await runJf5bLiveCertificationCli(ARGV, deps);
    const text = seen.lines.join('\n');
    expect(text).toContain('nara candidate source  OWNER_EXPLICIT');
    for (const [position, alias] of OWNER_SET.entries()) {
      expect(text).toContain(`nara candidate ${String(position + 1)}       ${alias}`);
    }
    // The run stopped at the wrong phrase, so the set was shown and nothing else happened.
    expect(seen.confirmationReads).toBe(1);
    expect([seen.credentialReads, seen.discoveryCalls, seen.runnerCalls]).toEqual([0, 0, 0]);
  });

  it('still performs authenticated discovery, and resolves the owner set from it', async () => {
    const { deps, seen } = harness({ discovery: ownerDiscovery() });
    await runJf5bLiveCertificationCli(ARGV, deps);
    // Discovery is NOT skipped: the account is re-asked what it may use, every run.
    expect(seen.discoveryCalls).toBe(1);
    // And the probes receive the owner's five, in the owner's order.
    expect(seen.probedShortlist).toEqual([...OWNER_SET]);
    expect(seen.lines.join('\n')).toContain('candidate source       OWNER_EXPLICIT');
  });

  it('hands the probes the DISCOVERED objects, never ones synthesised from argv', async () => {
    const { deps, seen } = harness({ discovery: ownerDiscovery() });
    await runJf5bLiveCertificationCli(ARGV, deps);
    for (const model of seen.probedObjects) {
      // A synthesised `{ modelId }` would have none of the fields the parser normalises.
      expect(Object.keys(model).sort()).toEqual([
        'capabilities',
        'contextLength',
        'modality',
        'modelId',
        'reasoning',
      ]);
    }
  });

  it('refuses a candidate the account was not offered, AFTER discovery and BEFORE any probe', async () => {
    const { deps, seen } = harness({ discovery: ownerDiscovery() });
    const outcome = await runJf5bLiveCertificationCli(
      [...FULL_ARGV, ...withCandidates('gpt-5.6-luna', 'not/offered')],
      deps,
    );
    expect(outcome.exitCode).toBe(EXIT_CODES.NARA_SELECTION_REFUSED);
    expect(outcome.reason).toBe('owner-candidate-not-currently-eligible');
    // Discovery HAPPENED — that is what made the refusal possible — and no chat probe followed it.
    expect(seen.discoveryCalls).toBe(1);
    expect(seen.runnerCalls).toBe(0);
    // The eligible list is printed, so the owner can correct the command.
    expect(seen.lines.join('\n')).toContain('eligible: gpt-5.6-luna');
  });

  it('refuses a sixth candidate before the credential and before the network', async () => {
    const { deps, seen } = harness({ discovery: ownerDiscovery() });
    const outcome = await runJf5bLiveCertificationCli(
      [...FULL_ARGV, ...withCandidates(...OWNER_SET, 'one-too-many')],
      deps,
    );
    expect(outcome.exitCode).toBe(EXIT_CODES.INVALID_USAGE);
    expect(outcome.reason).toBe('owner-candidate-too-many');
    expect([seen.confirmationReads, seen.credentialReads, seen.discoveryCalls]).toEqual([0, 0, 0]);
  });

  it('refuses a duplicate, a router alias and an empty value, all before the credential', async () => {
    for (const [aliases, refusal] of [
      [['gpt-5.6-luna', 'GPT-5.6-Luna'], 'owner-candidate-duplicate'],
      [['auto'], 'owner-candidate-router-alias'],
      [['  '], 'owner-candidate-empty'],
      [['has space'], 'owner-candidate-malformed'],
    ] as const) {
      const { deps, seen } = harness({ discovery: ownerDiscovery() });
      const outcome = await runJf5bLiveCertificationCli(
        [...FULL_ARGV, ...withCandidates(...aliases)],
        deps,
      );
      expect([refusal, outcome.reason]).toEqual([refusal, refusal]);
      expect([refusal, seen.credentialReads, seen.discoveryCalls]).toEqual([refusal, 0, 0]);
    }
  });

  it('with NO candidates the metadata rule still refuses the same list, unchanged', async () => {
    const { deps, seen } = harness({ discovery: ownerDiscovery() });
    const outcome = await runJf5bLiveCertificationCli(FULL_ARGV, deps);
    // The honest stop this lane did NOT remove.
    expect(outcome.reason).toBe('metadata-insufficient-for-truthful-shortlist');
    expect(seen.runnerCalls).toBe(0);
    expect(seen.lines.join('\n')).toContain('nara candidate source  DISCOVERY_METADATA');
  });

  it('with NO candidates and sufficient metadata the automatic shortlist still applies', async () => {
    const body = JSON.stringify({
      data: [
        { id: 'vendor-a/one', context_length: 131_072 },
        { id: 'vendor-b/two', context_length: 65_536 },
      ],
    });
    const { deps, seen } = harness({
      discovery: { status: 200, redirected: false, bodyText: body, bodyBytes: body.length },
    });
    await runJf5bLiveCertificationCli(FULL_ARGV, deps);
    // Ordered by stated context length, exactly as before.
    expect(seen.probedShortlist).toEqual(['vendor-a/one', 'vendor-b/two']);
  });
});

describe('JF-5B-R3 (CLI) the owner set fits inside the existing ceilings', () => {
  it('the worst-case call arithmetic stays under every budget', () => {
    // Stated as arithmetic rather than trusted: five candidates is the ceiling, and the probe count
    // per alias is unchanged at two.
    const candidates = OWNER_SET.length;
    const probesPerAlias = 2;
    const modelRequiredCases = MODEL_REQUIRED_CASES.length;

    const groqCalls = 1 /* smoke */ + modelRequiredCases + 1; /* AUTO healthy */
    const naraCalls =
      1 /* discovery */ +
      candidates * probesPerAlias +
      modelRequiredCases +
      1; /* AUTO forced fallback */
    const spendUsd = (groqCalls - 1 + naraCalls - 1) * 0.01 + 0.001;

    expect(candidates).toBe(5);
    expect(groqCalls).toBeLessThanOrEqual(JF5B_BUDGET.maxGroqCalls);
    expect(naraCalls).toBeLessThanOrEqual(JF5B_BUDGET.maxNaraCalls);
    expect(groqCalls + naraCalls).toBeLessThanOrEqual(JF5B_BUDGET.maxTotalCalls);
    expect(spendUsd).toBeLessThanOrEqual(JF5B_BUDGET.maxEstimatedSpendUsd);
    // The exact figures, so a corpus or candidate change that moves them is visible in a diff.
    expect([groqCalls, naraCalls, groqCalls + naraCalls]).toEqual([39, 49, 88]);
  });
});
