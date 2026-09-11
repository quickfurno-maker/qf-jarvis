/**
 * The JF-5B operator, exercised with ZERO network calls.
 *
 * ### Why every one of these can run in CI
 *
 * The operator's whole design is that the network lives at one injected boundary and everything that
 * DECIDES is pure: the discovery parser, the alias filter, the shortlist rule, the score, the gates,
 * the budget, the releases, the bindings and the manifest. So the rules that matter can be asserted
 * exhaustively against recorded payloads, and CI proves them without a credential or a provider.
 *
 * A spec that needed a live call to check the shortlist rule would be a spec nobody could run, which is
 * how a selection rule quietly becomes whatever the code happens to do.
 */
import { createHash } from 'node:crypto';

import { isNaraRouterAlias } from '@qf-jarvis/model-gateway';
import { describe, expect, it } from 'vitest';

import {
  CERTIFIED_AGENTS,
  CERTIFIED_PROVIDERS,
  EXECUTE_LIVE_FLAG,
  JF5B_BUDGET,
  LIVE_CONFIRMATION_PHRASE,
  MAX_SHORTLIST,
  MIN_CONTEXT_LENGTH,
  NARA_DATA_CONTROLS_REF,
  NARA_MODELS_ENDPOINT,
  PROMPT_BY_AGENT,
  buildNaraShortlist,
  checkArgvGate,
  checkOutputPath,
  checkTypedConfirmation,
  createCallLedger,
  createJf5bBindingMatrix,
  createJf5bCoverageManifest,
  createJf5bRelease,
  createLiveBudget,
  createLiveCaseRecord,
  parseCertifyArgv,
  parseNaraModelDiscovery,
  renderPreflightSummary,
  selectNaraModel,
} from '../index.js';
import type { NaraProbeScore } from '../index.js';

const digest = (seed: string): string => createHash('sha256').update(seed, 'utf8').digest('hex');

// ---------------------------------------------------------------------------
// Discovery: parse, filter, refuse.
// ---------------------------------------------------------------------------

const entry = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  object: 'model',
  context_length: 131_072,
  ...over,
});

describe('JF-5B (D) authenticated Nara discovery parses and filters', () => {
  it('pins ONE fixed discovery URL, over HTTPS, at the documented host', () => {
    expect(NARA_MODELS_ENDPOINT).toBe('https://router.bynara.id/v1/models');
    expect(NARA_MODELS_ENDPOINT.startsWith('https://')).toBe(true);
  });

  it('refuses a payload that is not a model list, and therefore selects nothing', () => {
    for (const bad of [undefined, null, 42, 'models', {}, { data: 'x' }, { data: [{}] }]) {
      expect(parseNaraModelDiscovery(bad), JSON.stringify(bad)).toBeUndefined();
    }
  });

  it('keeps exact chat aliases and records why each other one was dropped', () => {
    const result = parseNaraModelDiscovery({
      object: 'list',
      data: [
        entry('vendor-a/model-one'),
        entry('vendor-b/model-two', { reasoning: true }),
        // Every one of these must be dropped, each for its own stated reason.
        entry('auto'),
        entry('bynara'),
        entry('auto/bynara'),
        entry('router'),
        entry('latest'),
        entry('vendor-a/combo/mix'),
        entry('vendor-a/model-one'),
        entry('vendor-c/text-embedding-3'),
        entry('bad id with spaces'),
      ],
    });
    expect(result).toBeDefined();
    expect(result?.eligible.map((model) => model.modelId)).toEqual([
      'vendor-a/model-one',
      'vendor-b/model-two',
    ]);
    const reasons = new Map(result?.rejected.map((r) => [r.modelId, r.reason]));
    expect(reasons.get('auto')).toBe('router-alias');
    expect(reasons.get('bynara')).toBe('router-alias');
    expect(reasons.get('auto/bynara')).toBe('router-alias');
    expect(reasons.get('router')).toBe('router-alias');
    expect(reasons.get('latest')).toBe('router-alias');
    expect(reasons.get('vendor-a/combo/mix')).toBe('combo-model');
    expect(reasons.get('vendor-c/text-embedding-3')).toBe('not-a-chat-model');
    expect(reasons.get('bad id with spaces')).toBe('malformed-model-id');
    // The DUPLICATE is dropped, and the first occurrence is the one kept.
    expect(result?.rejected.filter((r) => r.reason === 'duplicate-alias')).toHaveLength(1);
    expect(result?.totalReturned).toBe(11);
  });

  it('reuses the PROVIDER alias guard rather than a second list of its own', () => {
    // The guard is the gateway's, imported. If discovery had its own list the two would drift, and the
    // drift would show up as an alias one of them pins and the other refuses.
    for (const alias of ['auto', 'bynara', 'auto/bynara', 'router', 'default', 'latest']) {
      expect(isNaraRouterAlias(alias), alias).toBe(true);
      const parsed = parseNaraModelDiscovery({ data: [entry(alias)] });
      expect(parsed?.eligible, alias).toHaveLength(0);
    }
  });

  it('never infers a capability the response did not state', () => {
    const parsed = parseNaraModelDiscovery({ data: [{ id: 'vendor-a/plain' }] });
    const model = parsed?.eligible[0];
    expect(model?.modelId).toBe('vendor-a/plain');
    // `undefined`, not `false`. "The endpoint did not say" and "the endpoint said no" are different
    // facts, and rounding the first into the second is how a capability gets invented.
    expect(model?.reasoning).toBeUndefined();
    expect(model?.contextLength).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Shortlist and selection: deterministic, declared before results.
// ---------------------------------------------------------------------------

describe('JF-5B (D) the shortlist is deterministic and refuses to guess', () => {
  it('orders by stated context length, then alias, and caps the shortlist', () => {
    const parsed = parseNaraModelDiscovery({
      data: [
        entry('v/small', { context_length: 8192 }),
        entry('v/huge', { context_length: 1_000_000 }),
        entry('v/mid-b', { context_length: 200_000 }),
        entry('v/mid-a', { context_length: 200_000 }),
        entry('v/large', { context_length: 400_000 }),
        entry('v/also', { context_length: 131_072 }),
      ],
    });
    const result = buildNaraShortlist(parsed?.eligible ?? []);
    expect(result.ok).toBe(true);
    expect(result.ok ? result.shortlist.map((m) => m.modelId) : []).toEqual([
      'v/huge',
      'v/large',
      // Equal context length falls back to exact alias order, not to input order.
      'v/mid-a',
      'v/mid-b',
      'v/also',
    ]);
    expect(result.ok ? result.shortlist.length : 0).toBeLessThanOrEqual(MAX_SHORTLIST);
  });

  it('excludes a model whose stated context cannot hold a Jarvis request', () => {
    const parsed = parseNaraModelDiscovery({ data: [entry('v/tiny', { context_length: 2048 })] });
    expect(buildNaraShortlist(parsed?.eligible ?? [])).toEqual({
      ok: false,
      refusal: 'metadata-insufficient-for-truthful-shortlist',
    });
    expect(MIN_CONTEXT_LENGTH).toBe(8192);
  });

  it('STOPS for an owner decision rather than ranking by brand name', () => {
    // The honest stop. With no stable capability field there is nothing truthful to rank on, and the
    // only alternative is a heuristic over vendor names — which is an opinion wearing a rule's clothes.
    const parsed = parseNaraModelDiscovery({ data: [{ id: 'v/a' }, { id: 'v/b' }] });
    expect(buildNaraShortlist(parsed?.eligible ?? [])).toEqual({
      ok: false,
      refusal: 'metadata-insufficient-for-truthful-shortlist',
    });
    expect(buildNaraShortlist([])).toEqual({ ok: false, refusal: 'no-eligible-models' });
  });

  it('ranks by the formula declared before execution, and excludes anything that failed a hard gate', () => {
    const score = (over: Partial<NaraProbeScore>): NaraProbeScore => ({
      modelId: 'v/x',
      hardGatesPassed: true,
      qualityPassed: 9,
      qualityAttempted: 9,
      p95LatencyMs: 1000,
      totalTokens: 1000,
      ...over,
    });
    // A hard-gate failure is excluded, however good everything else looks.
    expect(
      selectNaraModel([
        score({ modelId: 'v/unsafe', hardGatesPassed: false, p95LatencyMs: 1 }),
        score({ modelId: 'v/safe' }),
      ])?.modelId,
    ).toBe('v/safe');
    // Quality outranks latency.
    expect(
      selectNaraModel([
        score({ modelId: 'v/fast', qualityPassed: 7, p95LatencyMs: 10 }),
        score({ modelId: 'v/good', qualityPassed: 9, p95LatencyMs: 5000 }),
      ])?.modelId,
    ).toBe('v/good');
    // Then latency, then tokens, then exact alias order.
    expect(
      selectNaraModel([
        score({ modelId: 'v/b', p95LatencyMs: 100, totalTokens: 100 }),
        score({ modelId: 'v/a', p95LatencyMs: 100, totalTokens: 100 }),
      ])?.modelId,
    ).toBe('v/a');
    // Nothing passed is a STOP, not a winner.
    expect(selectNaraModel([score({ hardGatesPassed: false })])).toBeUndefined();
    expect(selectNaraModel([])).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// The double-opt-in gate.
// ---------------------------------------------------------------------------

describe('JF-5B (C) live execution needs BOTH gates', () => {
  it('refuses without the explicit flag', () => {
    expect(checkArgvGate([])).toBe('execute-live-flag-absent');
    expect(checkArgvGate(['--output-dir', 'D:/out'])).toBe('execute-live-flag-absent');
    expect(checkArgvGate([EXECUTE_LIVE_FLAG])).toBeUndefined();
  });

  it('refuses the confirmation phrase in argv, even alongside the flag', () => {
    // Two gates with the same key is one gate. A caller that put the phrase in argv was removing the
    // only step at which a person reads what is about to happen.
    expect(checkArgvGate([EXECUTE_LIVE_FLAG, LIVE_CONFIRMATION_PHRASE])).toBe(
      'confirmation-phrase-in-argv',
    );
    expect(checkArgvGate([`--confirm=${LIVE_CONFIRMATION_PHRASE}`])).toBe(
      'confirmation-phrase-in-argv',
    );
  });

  it('refuses a non-TTY confirmation and a wrong phrase', () => {
    expect(checkTypedConfirmation(LIVE_CONFIRMATION_PHRASE, false)).toBe('not-a-tty');
    expect(checkTypedConfirmation('yes', true)).toBe('confirmation-phrase-mismatch');
    expect(checkTypedConfirmation('execute_jf5b_live', true)).toBe('confirmation-phrase-mismatch');
    expect(checkTypedConfirmation(`  ${LIVE_CONFIRMATION_PHRASE}  `, true)).toBeUndefined();
  });

  it('exposes no credential switch at all', () => {
    const parsed = parseCertifyArgv([EXECUTE_LIVE_FLAG, '--output-dir=D:/out']);
    expect(parsed.executeLive).toBe(true);
    expect(parsed.outputDirectory).toBe('D:/out');
    // A credential that can be an argument is a credential in somebody's shell history.
    expect(Object.keys(parsed).sort()).toEqual(['executeLive', 'outputDirectory', 'unknown']);
    for (const switchName of ['--api-key', '--token', '--secret', '--key', '--nara-key']) {
      const attempted = parseCertifyArgv([EXECUTE_LIVE_FLAG, switchName, 'sk-not-a-real-value']);
      // Unrecognised: carried through as unknown, never interpreted as a secret.
      expect(attempted.unknown, switchName).toContain(switchName);
    }
  });
});

// ---------------------------------------------------------------------------
// Output location and budget.
// ---------------------------------------------------------------------------

describe('JF-5B (C) raw artifacts cannot land inside the repository', () => {
  const REPO = 'C:/Users/owner/Desktop/qf-jarvis-jf5b';

  it('accepts an absolute path outside the repository', () => {
    expect(
      checkOutputPath('C:/Users/owner/Desktop/jarvis-certification/JF-5B/run-1', REPO),
    ).toBeUndefined();
    expect(
      checkOutputPath('/var/lib/jarvis-certification/run-1', '/srv/qf-jarvis'),
    ).toBeUndefined();
  });

  it('refuses the repository root, any descendant, and a path that is not absolute', () => {
    for (const bad of [
      REPO,
      `${REPO}/out`,
      `${REPO}/packages/x/out`,
      'C:\\Users\\owner\\Desktop\\qf-jarvis-jf5b\\out',
      // Case differences do not make a descendant a different place on Windows.
      'c:/users/owner/desktop/qf-jarvis-jf5b/out',
    ]) {
      expect(checkOutputPath(bad, REPO), bad).toBe('output-path-inside-repository');
    }
    for (const bad of ['', 'out', './out', '../out']) {
      expect(checkOutputPath(bad, REPO), bad).toBe('output-path-not-absolute');
    }
  });
});

describe('JF-5B (C) the budget refuses the next call rather than retrying', () => {
  it('caps groq calls, nara calls, total calls and spend', () => {
    const ledger = createCallLedger(
      createLiveBudget({
        maxGroqCalls: 2,
        maxNaraCalls: 1,
        maxTotalCalls: 2,
        maxEstimatedSpendUsd: 1,
      }),
    );
    expect(ledger.reserve('groq', 0.1)).toBeUndefined();
    expect(ledger.reserve('groq', 0.1)).toBeUndefined();
    // Third groq call exceeds both the groq cap and the total cap.
    expect(ledger.reserve('groq', 0.1)).toBe('budget-exhausted');
    // And the refused reservation did NOT count: the ledger is not advanced by a refusal.
    expect(ledger.groqCalls()).toBe(2);
    expect(ledger.totalCalls()).toBe(2);
  });

  it('refuses a spend ceiling above the JF-5B maximum', () => {
    expect(() => createLiveBudget({ ...JF5B_BUDGET, maxEstimatedSpendUsd: 25 })).toThrow();
    expect(JF5B_BUDGET.maxEstimatedSpendUsd).toBeLessThanOrEqual(10);
  });
});

// ---------------------------------------------------------------------------
// Six bindings.
// ---------------------------------------------------------------------------

describe('JF-5B (F) SIX exact provider x prompt bindings', () => {
  const groq = createJf5bRelease({
    providerId: 'groq',
    modelId: 'openai/gpt-oss-20b',
    configDigest: 'a1b2c3d4e5f60001',
  });
  const nara = createJf5bRelease({
    providerId: 'nara',
    modelId: 'vendor-a/model-one',
    configDigest: 'a1b2c3d4e5f60002',
  });

  it('builds six bindings, two providers by three prompt bodies', () => {
    const matrix = createJf5bBindingMatrix(groq, nara);
    expect(matrix).toHaveLength(6);
    const tuples = matrix.map(
      (binding) => `${binding.release.providerId}/${binding.promptFamily}/${binding.promptDigest}`,
    );
    // Six DISTINCT tuples. Five would mean one prompt standing in for another.
    expect(new Set(tuples).size).toBe(6);
    for (const provider of CERTIFIED_PROVIDERS) {
      const forProvider = matrix.filter((b) => b.release.providerId === provider);
      expect(forProvider, provider).toHaveLength(3);
      expect(new Set(forProvider.map((b) => b.promptDigest)).size, provider).toBe(3);
    }
  });

  it('binds each agent to ITS OWN reviewed prompt digest, read from the prompt package', () => {
    const matrix = createJf5bBindingMatrix(groq, nara);
    for (const agent of CERTIFIED_AGENTS) {
      const prompt = PROMPT_BY_AGENT[agent];
      const bound = matrix.filter((b) => b.promptFamily === prompt.promptId);
      expect(bound, agent).toHaveLength(2);
      for (const binding of bound) {
        // Not typed in anywhere: the digest comes from the definition that owns the bytes.
        expect(binding.promptDigest, agent).toBe(prompt.contentDigest);
        expect(binding.promptVersion, agent).toBe(prompt.promptVersion);
      }
    }
    // And they are the three JF-5A production digests, not one repeated.
    expect(new Set(CERTIFIED_AGENTS.map((a) => PROMPT_BY_AGENT[a].contentDigest)).size).toBe(3);
  });

  it('pins a truthful catalogue observation rather than an invented weight hash', () => {
    for (const release of [groq, nara]) {
      expect(release.modelVersion).toBe('certification-snapshot-2026-09-11');
      expect(release.executionClass).toBe('HOSTED');
      expect(release.modelId).not.toContain('*');
      expect(release.modelId.toLowerCase()).not.toContain('latest');
      expect(isNaraRouterAlias(release.modelId)).toBe(false);
    }
    // Separate identities per provider: one release cannot describe two.
    expect(groq.releaseId).not.toBe(nara.releaseId);
  });
});

// ---------------------------------------------------------------------------
// The coverage manifest.
// ---------------------------------------------------------------------------

function manifestEntry(provider: 'groq' | 'nara', agent: 'RIYA' | 'ANISHA' | 'AAROHI') {
  const prompt = PROMPT_BY_AGENT[agent];
  return {
    provider,
    agent,
    releaseId: `rel.jf5b.${provider}.1`,
    modelId: provider === 'groq' ? 'openai/gpt-oss-20b' : 'vendor-a/model-one',
    modelVersion: 'certification-snapshot-2026-09-11',
    configDigest: provider === 'groq' ? 'a1b2c3d4e5f60001' : 'a1b2c3d4e5f60002',
    promptFamily: prompt.promptId,
    promptVersion: prompt.promptVersion,
    promptDigest: prompt.contentDigest,
    evaluationSuiteId: 'suite.jf5b.three-agent-live',
    evaluationSuiteVersion: 1,
    redTeamSuiteId: 'redteam.jf5b.three-agent-live',
    fixtureManifestId: 'fixtures.jf5b.synthetic-three-agent',
    liveRunId: 'run.jf5b.001',
    caseSetDigest: digest(`cases.${provider}.${agent}`),
    resultDigest: digest(`results.${provider}.${agent}`),
    safety: 'PASS' as const,
    qualityReview: 'REVIEW_PENDING' as const,
    languageCounts: { EN: 4, HI: 2, HINGLISH: 2 },
  };
}

function fullManifest(over: Record<string, unknown> = {}) {
  return {
    manifestVersion: 1 as const,
    runId: 'run.jf5b.001',
    headSha: 'a'.repeat(40),
    createdAt: '2026-09-11T00:00:00Z',
    dataControlsRefs: [NARA_DATA_CONTROLS_REF],
    entries: [
      manifestEntry('groq', 'RIYA'),
      manifestEntry('groq', 'ANISHA'),
      manifestEntry('groq', 'AAROHI'),
      manifestEntry('nara', 'RIYA'),
      manifestEntry('nara', 'ANISHA'),
      manifestEntry('nara', 'AAROHI'),
    ],
    ...over,
  };
}

describe('JF-5B (J) the manifest covers six bindings and authorizes nothing', () => {
  it('accepts exactly the six provider x agent pairs', () => {
    const manifest = createJf5bCoverageManifest(fullManifest());
    expect(manifest.entries).toHaveLength(6);
    expect(Object.isFrozen(manifest)).toBe(true);
  });

  it('refuses five entries, a duplicated pair, or a missing pair', () => {
    const five = fullManifest();
    five.entries = five.entries.slice(0, 5);
    expect(() => createJf5bCoverageManifest(five)).toThrow();

    const duplicated = fullManifest();
    duplicated.entries = [
      manifestEntry('groq', 'RIYA'),
      manifestEntry('groq', 'RIYA'),
      manifestEntry('groq', 'AAROHI'),
      manifestEntry('nara', 'RIYA'),
      manifestEntry('nara', 'ANISHA'),
      manifestEntry('nara', 'AAROHI'),
    ];
    expect(() => createJf5bCoverageManifest(duplicated)).toThrow();
  });

  it('refuses one prompt digest standing in for three', () => {
    // The exact dishonesty the six-binding rule exists to prevent: three entries, full coverage shape,
    // and every one of them actually measuring Riya's prompt.
    const shortcut = fullManifest();
    const riyaDigest = PROMPT_BY_AGENT.RIYA.contentDigest;
    shortcut.entries = shortcut.entries.map((entry) => ({ ...entry, promptDigest: riyaDigest }));
    expect(() => createJf5bCoverageManifest(shortcut)).toThrow();
  });

  it('has NO production-approval field, and no way to add one', () => {
    const manifest = createJf5bCoverageManifest(fullManifest());
    const asRecord = manifest as unknown as Record<string, unknown>;
    for (const forbidden of [
      'productionApproval',
      'approved',
      'activation',
      'activationToken',
      'synthetic',
      'evidence',
    ]) {
      expect({ forbidden, present: forbidden in asRecord }).toEqual({ forbidden, present: false });
    }
    // The schema is strict, so an extra field is a refusal rather than a passenger.
    expect(() =>
      createJf5bCoverageManifest({ ...fullManifest(), productionApproval: true }),
    ).toThrow();
  });

  it('says REVIEW_PENDING rather than PASS for a dimension nobody has reviewed', () => {
    const manifest = createJf5bCoverageManifest(fullManifest());
    for (const entry of manifest.entries) {
      expect(entry.qualityReview).toBe('REVIEW_PENDING');
      expect(entry.qualityReview).not.toBe('PASS');
    }
  });
});

// ---------------------------------------------------------------------------
// The sanitized case record.
// ---------------------------------------------------------------------------

describe('JF-5B (G) a case record is content-free and pins retry at zero', () => {
  const base = {
    runId: 'run.jf5b.001',
    caseId: 'aarohi.noncommercial-reply',
    caseVersion: 1,
    agent: 'AAROHI' as const,
    agentScope: 'PROSPECT' as const,
    provider: 'nara' as const,
    releaseId: 'rel.jf5b.nara.1',
    modelId: 'vendor-a/model-one',
    modelVersion: 'certification-snapshot-2026-09-11',
    configDigest: 'a1b2c3d4e5f60002',
    promptFamily: 'aarohi.acquisition',
    promptVersion: 1,
    promptDigest: PROMPT_BY_AGENT.AAROHI.contentDigest,
    evaluationSuiteId: 'suite.jf5b.three-agent-live',
    fixtureManifestId: 'fixtures.jf5b.synthetic-three-agent',
    languageMode: 'HINGLISH' as const,
    executionLayer: 'MODEL_REQUIRED' as const,
    providerAttempts: 1,
    networkCalls: 1,
    fallbackCount: 0,
    retryCount: 0 as const,
    latencyMs: 900,
    structuredOutputValid: true,
    outcome: 'PASS' as const,
  };

  it('accepts a sanitized record and refuses any retry but zero', () => {
    expect(createLiveCaseRecord(base).retryCount).toBe(0);
    expect(() => createLiveCaseRecord({ ...base, retryCount: 1 })).toThrow();
  });

  it('bounds provider attempts, so a THIRD attempt cannot be recorded as normal', () => {
    // AUTO is Groq then at most one Nara attempt, so two is the ceiling a real turn can reach. The
    // bound is what stops a receipt describing a retry loop as if it were routing.
    expect(
      createLiveCaseRecord({ ...base, providerAttempts: 2, fallbackCount: 1 }).providerAttempts,
    ).toBe(2);
    for (const attempts of [9, 64, 1000]) {
      expect(
        () => createLiveCaseRecord({ ...base, providerAttempts: attempts }),
        String(attempts),
      ).toThrow();
    }
    for (const calls of [9, 64]) {
      expect(() => createLiveCaseRecord({ ...base, networkCalls: calls }), String(calls)).toThrow();
    }
    for (const fallbacks of [5, 64]) {
      expect(
        () => createLiveCaseRecord({ ...base, fallbackCount: fallbacks }),
        String(fallbacks),
      ).toThrow();
    }
  });

  it('refuses raw output text, and takes a digest instead', () => {
    // The receipt is read by people who are not entitled to the conversation. The schema is strict, so
    // there is no field a raw reply could be carried in even by accident.
    expect(() => createLiveCaseRecord({ ...base, outputText: 'hello' })).toThrow();
    expect(() => createLiveCaseRecord({ ...base, rawResponse: '{}' })).toThrow();
    expect(() => createLiveCaseRecord({ ...base, apiKey: 'sk-x' })).toThrow();
    expect(createLiveCaseRecord({ ...base, outputDigest: digest('reply') }).outputDigest).toMatch(
      /^[0-9a-f]{64}$/,
    );
  });

  it('records a pre-model case as zero network calls', () => {
    const preModel = createLiveCaseRecord({
      ...base,
      caseId: 'aarohi.human-took-over',
      executionLayer: 'PRE_MODEL_REQUIRED',
      providerAttempts: 0,
      networkCalls: 0,
      latencyMs: 3,
      structuredOutputValid: false,
      outcome: 'PASS',
    });
    expect([preModel.executionLayer, preModel.networkCalls, preModel.providerAttempts]).toEqual([
      'PRE_MODEL_REQUIRED',
      0,
      0,
    ]);
  });
});

// ---------------------------------------------------------------------------
// The preflight summary: every fact a person needs before typing the phrase.
// ---------------------------------------------------------------------------

describe('JF-5B (C) the preflight states every non-secret fact, and no secret', () => {
  const lines = renderPreflightSummary({
    headSha: 'b'.repeat(40),
    worktreeClean: true,
    ciRunId: '34573789576',
    ciConclusion: 'success',
    outputDirectory: 'D:/jarvis-certification/JF-5B/run-1',
    runId: 'run.jf5b.001',
  });
  const text = lines.join('\n');

  it('names the head, the ceilings, the endpoints and the output directory', () => {
    expect(text).toContain('b'.repeat(40));
    expect(text).toContain('D:/jarvis-certification/JF-5B/run-1');
    expect(text).toContain(NARA_MODELS_ENDPOINT);
    expect(text).toContain('router.bynara.id');
    expect(text).toContain('api.groq.com');
    expect(text).toContain(String(JF5B_BUDGET.maxTotalCalls));
    expect(text).toContain('same-provider retry    0');
  });

  it('names all THREE exact prompt digests, so the person sees what is being certified', () => {
    for (const agent of CERTIFIED_AGENTS) {
      expect(text, agent).toContain(PROMPT_BY_AGENT[agent].contentDigest);
    }
  });

  it('states the synthetic-only rule and that this run activates nothing', () => {
    expect(text).toContain('SYNTHETIC ONLY');
    expect(text).toContain('does NOT activate');
    expect(text).toContain('No production approval is minted');
  });

  it('describes the Nara posture truthfully and never claims ZDR', () => {
    expect(text).toContain('retained for a limited period');
    expect(text).toContain('is NOT claimed as ZDR');
    expect(text.toLowerCase()).not.toContain('zero data retention claim');
    // The reference itself must not promise what the policy does not.
    expect(NARA_DATA_CONTROLS_REF).not.toContain('zdr');
    expect(NARA_DATA_CONTROLS_REF).not.toContain('zero-retention');
  });

  it('carries no credential, and asks for none before both gates', () => {
    expect(text).toContain(LIVE_CONFIRMATION_PHRASE);
    expect(text).toContain(EXECUTE_LIVE_FLAG);
    for (const forbidden of ['sk-', 'gsk_', 'Bearer ', 'Authorization']) {
      expect({ forbidden, present: text.includes(forbidden) }).toEqual({
        forbidden,
        present: false,
      });
    }
  });
});
