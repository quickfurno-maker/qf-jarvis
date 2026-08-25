/**
 * JAO-4 sandbox tool workbench, asserted as a CONTRACT and BEHAVIOUR proof (ADR-0118).
 *
 * The threat model gets its own file. This one proves the sandbox does what it claims: four static
 * tools, bounded results, deterministic listing, a real SHA-256, and refusals that happen before
 * anything is invoked.
 *
 * Every fixture is synthetic diagnostic text. No real log, no real config, no credential and no
 * conversation appears anywhere in this slice.
 */
import { describe, expect, it } from 'vitest';

import {
  JAO4_EXPECTED_TOOL_IDS,
  JAO4_LIMITS,
  JAO4_LIST_TOOL,
  JAO4_PRODUCTION_TOOLS,
  JAO4_READ_TOOL,
  JAO4_WORKBENCH_BOUNDS,
  createJao4ArtifactSandbox,
  createJao4ToolRegistry,
  jao4ArtifactBundleSchema,
  jao4RegisteredToolIds,
  jao4ToolDescriptorSchema,
  jao4WorkbenchRequestSchema,
  type Jao4Clock,
  type Jao4TelemetryEvent,
  type Jao4ToolDescriptor,
} from '../jao/sandbox-tool-workbench/index.js';
// Imported by DIRECT MODULE PATH, not through the barrel. The barrel deliberately does not carry
// the injection seam or the tool implementation type, and a threat-model spec asserts that.
import {
  runJao4WorkbenchInternal,
  type Jao4InternalWorkbenchDependencies,
} from '../jao/sandbox-tool-workbench/workbench.js';
import {
  createJao4Tools,
  type Jao4Tool,
  type Jao4ToolOutput,
} from '../jao/sandbox-tool-workbench/tools.js';

class FixedClock implements Jao4Clock {
  private value = 1_000;
  nowMs(): number {
    this.value += 5;
    return this.value;
  }
}

const API_LOG = ['boot ok', 'projection lag 42', 'projection lag 43', 'shutdown ok'].join('\n');
const RUNTIME_CONFIG = ['mode=shadow', 'workers=2', 'projection.batch=100'].join('\n');

function bundle(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    bundleId: 'jao4.bundle.001',
    dataClass: 'SYNTHETIC_OR_SANITIZED_OPERATIONAL_ARTIFACTS',
    containsSecrets: false,
    sourcePosture: 'INJECTED_OFFLINE',
    artifacts: [
      {
        artifactId: 'jao4.artifact.log',
        path: 'logs/api.log',
        contentClass: 'LOG_EXCERPT',
        content: API_LOG,
      },
      {
        artifactId: 'jao4.artifact.config',
        path: 'config/runtime.txt',
        contentClass: 'CONFIG_EXCERPT',
        content: RUNTIME_CONFIG,
      },
    ],
    ...over,
  };
}

function request(calls: readonly Record<string, unknown>[], over: Record<string, unknown> = {}) {
  return {
    sessionId: 'jao4.session.001',
    runId: 'jao4.run.001',
    mode: 'SHADOW',
    parentAutonomyLevel: 'L1_READ',
    requestedAutonomyLevel: 'L1_READ',
    businessEffectAllowed: false,
    artifactBundleId: 'jao4.bundle.001',
    artifactBundle: bundle(),
    calls,
    ...over,
  };
}

function listCall(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    callId: 'jao4.call.1',
    runId: 'jao4.run.001',
    toolId: 'artifact.list.v1',
    toolVersion: '1',
    ...over,
  };
}

function readCall(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    callId: 'jao4.call.2',
    runId: 'jao4.run.001',
    toolId: 'artifact.read.v1',
    toolVersion: '1',
    path: 'logs/api.log',
    maxChars: 512,
    ...over,
  };
}

function searchCall(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    callId: 'jao4.call.3',
    runId: 'jao4.run.001',
    toolId: 'artifact.search-literal.v1',
    toolVersion: '1',
    query: 'projection lag',
    caseSensitive: true,
    maxMatches: 10,
    ...over,
  };
}

function hashCall(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    callId: 'jao4.call.4',
    runId: 'jao4.run.001',
    toolId: 'artifact.sha256.v1',
    toolVersion: '1',
    path: 'config/runtime.txt',
    ...over,
  };
}

function deps(
  over: Partial<Jao4InternalWorkbenchDependencies> = {},
): Jao4InternalWorkbenchDependencies {
  return { clock: new FixedClock(), ...over };
}

/** A descriptor as UNTRUSTED RUNTIME DATA, for the binding proofs. */
function forgedDescriptor(raw: Record<string, unknown>): Jao4ToolDescriptor {
  return raw as unknown as Jao4ToolDescriptor;
}

/** A tool implementation carrying whatever descriptor a composition gave it, counting calls. */
function countingTools(descriptorOverride?: Jao4ToolDescriptor): {
  readonly tools: Readonly<Record<string, Jao4Tool>>;
  calls: () => number;
} {
  const real = createJao4Tools();
  let calls = 0;
  const wrapped: Record<string, Jao4Tool> = {};
  for (const [toolId, tool] of Object.entries(real)) {
    wrapped[toolId] = {
      descriptor: descriptorOverride ?? tool.descriptor,
      invoke: (sandbox, call) => {
        calls += 1;
        return tool.invoke(sandbox, call);
      },
    };
  }
  return { tools: Object.freeze(wrapped), calls: () => calls };
}

describe('JAO-4 sandbox tool workbench', () => {
  it('states its own class and posture as a machine-readable lock', () => {
    expect(JAO4_WORKBENCH_BOUNDS.sandboxClass).toBe('VIRTUAL_ARTIFACT_READ_ONLY');
    for (const denied of [
      'hostFilesystemAccess',
      'networkAccess',
      'secretSourceAccess',
      'processExecution',
      'shellExecution',
      'environmentAccess',
      'databaseAccess',
      'businessEffect',
      'productionMutation',
      'commandRunner',
      'dynamicToolInstall',
      'arbitraryRegex',
      'backgroundExecution',
      'mastraUsed',
    ] as const) {
      expect(JAO4_WORKBENCH_BOUNDS[denied], denied).toBe(false);
    }
    expect(JAO4_WORKBENCH_BOUNDS.modelCalls).toBe(0);
    expect(JAO4_WORKBENCH_BOUNDS.specialistCalls).toBe(0);
    expect(JAO4_WORKBENCH_BOUNDS.memoryWrites).toBe(0);
  });

  it('registers exactly the four static tools, all ACTIVE and all read-only', () => {
    const registry = createJao4ToolRegistry();
    expect(jao4RegisteredToolIds(registry)).toStrictEqual(JAO4_EXPECTED_TOOL_IDS);
    expect(JAO4_EXPECTED_TOOL_IDS).toStrictEqual([
      'artifact.list.v1',
      'artifact.read.v1',
      'artifact.search-literal.v1',
      'artifact.sha256.v1',
    ]);
    expect(JAO4_PRODUCTION_TOOLS).toHaveLength(4);

    // Every dangerous capability is a literal false/DENY, enforced by the parse that built them.
    for (const descriptor of JAO4_PRODUCTION_TOOLS) {
      expect(descriptor.availability).toBe('ACTIVE');
      expect(descriptor.readOnly).toBe(true);
      expect(descriptor.businessEffect).toBe(false);
      expect(descriptor.productionMutation).toBe(false);
      expect(descriptor.mayNetwork).toBe(false);
      expect(descriptor.mayAccessSecrets).toBe(false);
      expect(descriptor.mayAccessHostFilesystem).toBe(false);
      expect(descriptor.mayWriteVirtualFilesystem).toBe(false);
      expect(descriptor.mayExecuteProcess).toBe(false);
      expect(descriptor.mayUseShell).toBe(false);
      expect(descriptor.mayAccessEnvironment).toBe(false);
      expect(descriptor.mayAccessDatabase).toBe(false);
      expect(descriptor.networkPolicy).toBe('DENY');
      expect(descriptor.hostFilesystem).toBe('DENY');
      expect(descriptor.virtualFilesystem).toBe('READ_ONLY');
      expect(descriptor.processExecution).toBe('DENY');
      expect(descriptor.shell).toBe('DENY');
      expect(descriptor.environment).toBe('DENY');
      expect(descriptor.database).toBe('DENY');
      expect(descriptor.maxAutonomyLevel).toBe('L1_READ');
      expect(descriptor.approvalPosture).toBe('OFFLINE_SHADOW_ONLY');
    }

    // A descriptor claiming any dangerous capability cannot be constructed at all.
    for (const forbidden of [
      { mayNetwork: true },
      { mayAccessSecrets: true },
      { mayAccessHostFilesystem: true },
      { mayWriteVirtualFilesystem: true },
      { mayExecuteProcess: true },
      { mayUseShell: true },
      { mayAccessEnvironment: true },
      { mayAccessDatabase: true },
      { businessEffect: true },
      { productionMutation: true },
      { readOnly: false },
      { networkPolicy: 'ALLOW' },
      { hostFilesystem: 'ALLOW' },
      { virtualFilesystem: 'READ_WRITE' },
      { shell: 'ALLOW' },
      { maxAutonomyLevel: 'L2_WRITE' },
      { toolClass: 'HOST_COMMAND_EXECUTION' },
      { toolId: 'shell.exec.v1' },
    ]) {
      expect(
        jao4ToolDescriptorSchema.safeParse({ ...JAO4_READ_TOOL, ...forbidden }).success,
        JSON.stringify(forbidden),
      ).toBe(false);
    }
  });

  it('accepts a valid bundle and refuses every malformed one', () => {
    expect(jao4ArtifactBundleSchema.safeParse(bundle()).success).toBe(true);

    // Not a bundle at all.
    for (const notABundle of [{}, null, undefined, 'bundle', 42, []]) {
      expect(
        jao4ArtifactBundleSchema.safeParse(notABundle).success,
        JSON.stringify(notABundle),
      ).toBe(false);
    }

    for (const bad of [
      // Strict: an unsupported field is refused rather than ignored.
      { extra: true },
      { dataClass: 'BUSINESS_RECORD' },
      { sourcePosture: 'LIVE_PRODUCTION' },
      // The closed posture: `containsSecrets` can only ever be false.
      { containsSecrets: true },
      { artifacts: [] },
    ]) {
      expect(jao4ArtifactBundleSchema.safeParse(bundle(bad)).success, JSON.stringify(bad)).toBe(
        false,
      );
    }

    // Duplicate ids and duplicate paths: a path that names two artifacts has no honest answer to
    // "read this path".
    const artifact = {
      artifactId: 'jao4.artifact.log',
      path: 'logs/api.log',
      contentClass: 'LOG_EXCERPT',
      content: 'x',
    };
    // Identical twice: both id and path collide.
    expect(
      jao4ArtifactBundleSchema.safeParse(bundle({ artifacts: [artifact, artifact] })).success,
    ).toBe(false);
    // Same ID at a different path.
    expect(
      jao4ArtifactBundleSchema.safeParse(
        bundle({ artifacts: [artifact, { ...artifact, path: 'logs/other.log' }] }),
      ).success,
    ).toBe(false);
    // Same PATH under a different id -- the case that would make `read` a guess.
    expect(
      jao4ArtifactBundleSchema.safeParse(
        bundle({ artifacts: [artifact, { ...artifact, artifactId: 'jao4.artifact.other' }] }),
      ).success,
    ).toBe(false);

    // Content classes are closed, and the authority-bearing ones do not exist.
    for (const contentClass of [
      'BUSINESS_RECORD',
      'APPROVAL_GRANT',
      'SECRET',
      'CREDENTIAL',
      'RAW_DATABASE_DUMP',
      'RAW_USER_CONVERSATION',
    ]) {
      expect(
        jao4ArtifactBundleSchema.safeParse(bundle({ artifacts: [{ ...artifact, contentClass }] }))
          .success,
        contentClass,
      ).toBe(false);
    }
  });

  it('enforces the per-artifact, per-bundle and artifact-count ceilings', () => {
    const oversized = {
      artifactId: 'jao4.artifact.big',
      path: 'logs/big.log',
      contentClass: 'LOG_EXCERPT',
      content: 'x'.repeat(JAO4_LIMITS.maxArtifactChars + 1),
    };
    expect(jao4ArtifactBundleSchema.safeParse(bundle({ artifacts: [oversized] })).success).toBe(
      false,
    );

    // Too many artifacts.
    const many = Array.from({ length: JAO4_LIMITS.maxArtifacts + 1 }, (_unused, index) => ({
      artifactId: `jao4.artifact.${String(index)}`,
      path: `logs/a${String(index)}.log`,
      contentClass: 'LOG_EXCERPT',
      content: 'x',
    }));
    expect(jao4ArtifactBundleSchema.safeParse(bundle({ artifacts: many })).success).toBe(false);

    // Each artifact under its own ceiling, the bundle over the total.
    const perArtifact = JAO4_LIMITS.maxArtifactChars;
    const count = Math.ceil(JAO4_LIMITS.maxBundleChars / perArtifact) + 1;
    const fat = Array.from({ length: count }, (_unused, index) => ({
      artifactId: `jao4.artifact.f${String(index)}`,
      path: `logs/f${String(index)}.log`,
      contentClass: 'LOG_EXCERPT',
      content: 'y'.repeat(perArtifact),
    }));
    expect(fat.length).toBeLessThanOrEqual(JAO4_LIMITS.maxArtifacts);
    expect(jao4ArtifactBundleSchema.safeParse(bundle({ artifacts: fat })).success).toBe(false);
  });

  it('lists metadata only, deterministically, and honours a bounded prefix', () => {
    const spy = countingTools();
    const result = runJao4WorkbenchInternal(request([listCall()]), deps({ tools: spy.tools }));

    expect(result.outcome).toBe('COMPLETED');
    expect(spy.calls()).toBe(1);
    const evidence = result.toolCalls[0]?.evidence;
    expect(evidence?.kind).toBe('ARTIFACT_LIST');
    if (evidence?.kind !== 'ARTIFACT_LIST') {
      throw new Error('expected a listing');
    }
    // Deterministic path order, whatever order the bundle supplied.
    expect(evidence.artifacts.map((one) => one.path)).toStrictEqual([
      'config/runtime.txt',
      'logs/api.log',
    ]);
    // METADATA ONLY. No content, no preview, no first line -- a listing is not a read.
    expect(JSON.stringify(evidence)).not.toContain('projection lag');
    expect(JSON.stringify(evidence)).not.toContain('mode=shadow');
    for (const entry of evidence.artifacts) {
      expect(Object.keys(entry).sort()).toStrictEqual([
        'artifactId',
        'chars',
        'contentClass',
        'lines',
        'path',
      ]);
    }
    expect(result.toolCalls[0]?.untrustedEvidence).toBe(true);

    const narrowed = runJao4WorkbenchInternal(request([listCall({ pathPrefix: 'logs/' })]), deps());
    const narrowedEvidence = narrowed.toolCalls[0]?.evidence;
    if (narrowedEvidence?.kind !== 'ARTIFACT_LIST') {
      throw new Error('expected a listing');
    }
    expect(narrowedEvidence.artifacts.map((one) => one.path)).toStrictEqual(['logs/api.log']);
  });

  it('reads a bounded excerpt, never the whole artifact', () => {
    const windowed = runJao4WorkbenchInternal(
      request([readCall({ startLine: 2, maxLines: 2, maxChars: 512 })]),
      deps(),
    );
    const evidence = windowed.toolCalls[0]?.evidence;
    if (evidence?.kind !== 'ARTIFACT_EXCERPT') {
      throw new Error('expected an excerpt');
    }
    expect(evidence.startLine).toBe(2);
    expect(evidence.lineCount).toBe(2);
    expect(evidence.excerpt).toBe('projection lag 42\nprojection lag 43');
    // Line 4 was not read, and the result says so rather than looking complete.
    expect(evidence.truncated).toBe(true);
    expect(evidence.excerpt).not.toContain('shutdown ok');

    // The character ceiling clips independently of the line window.
    const clipped = runJao4WorkbenchInternal(request([readCall({ maxChars: 7 })]), deps());
    const clippedEvidence = clipped.toolCalls[0]?.evidence;
    if (clippedEvidence?.kind !== 'ARTIFACT_EXCERPT') {
      throw new Error('expected an excerpt');
    }
    expect(clippedEvidence.excerpt).toBe('boot ok');
    expect(clippedEvidence.truncated).toBe(true);

    // There is no "read everything": maxChars is required and bounded.
    expect(
      jao4WorkbenchRequestSchema.safeParse(request([readCall({ maxChars: undefined })])).success,
    ).toBe(false);
    expect(
      jao4WorkbenchRequestSchema.safeParse(
        request([readCall({ maxChars: JAO4_LIMITS.maxReadCharsPerCall + 1 })]),
      ).success,
    ).toBe(false);
  });

  it('fails closed on a missing artifact, invoking nothing further', () => {
    const spy = countingTools();
    const result = runJao4WorkbenchInternal(
      request([readCall({ path: 'logs/does-not-exist.log' })]),
      deps({ tools: spy.tools }),
    );
    expect(result.outcome).toBe('REFUSED');
    expect(result.toolCalls[0]?.refusalReason).toBe('ARTIFACT_NOT_FOUND');
    expect(result.toolCalls[0]?.evidence).toBeNull();
    expect(result.toolCalls[0]?.outputChars).toBe(0);
    // One call RECORD was processed, and ONE invocation is counted: a missing artifact is
    // discovered by the tool, inside `invoke`. The implementation was entered, looked, and
    // refused -- which is a different fact from a gate refusing before it ran, and the audit
    // record distinguishes them.
    expect(result.totalCalls).toBe(1);
    expect(result.toolInvocations).toBe(1);
  });

  it('searches for a LITERAL substring, not a pattern', () => {
    const found = runJao4WorkbenchInternal(request([searchCall()]), deps());
    const evidence = found.toolCalls[0]?.evidence;
    if (evidence?.kind !== 'LITERAL_SEARCH') {
      throw new Error('expected a search');
    }
    expect(evidence.matchCount).toBe(2);
    expect(evidence.matches.map((one) => one.line)).toStrictEqual([2, 3]);

    // A regex metacharacter is a CHARACTER. `.*` matches nothing here because nothing contains it.
    const asRegex = runJao4WorkbenchInternal(request([searchCall({ query: '.*' })]), deps());
    const regexEvidence = asRegex.toolCalls[0]?.evidence;
    if (regexEvidence?.kind !== 'LITERAL_SEARCH') {
      throw new Error('expected a search');
    }
    expect(regexEvidence.matchCount).toBe(0);

    // A literal that DOES appear is found, proving the previous case was not a parse failure.
    const literalDot = runJao4WorkbenchInternal(
      request([searchCall({ query: 'projection.batch' })]),
      deps(),
    );
    const dotEvidence = literalDot.toolCalls[0]?.evidence;
    if (dotEvidence?.kind !== 'LITERAL_SEARCH') {
      throw new Error('expected a search');
    }
    expect(dotEvidence.matchCount).toBe(1);

    // Case sensitivity is a boolean, not a flags string that could carry anything else.
    const insensitive = runJao4WorkbenchInternal(
      request([searchCall({ query: 'PROJECTION LAG', caseSensitive: false })]),
      deps(),
    );
    const insensitiveEvidence = insensitive.toolCalls[0]?.evidence;
    if (insensitiveEvidence?.kind !== 'LITERAL_SEARCH') {
      throw new Error('expected a search');
    }
    expect(insensitiveEvidence.matchCount).toBe(2);
  });

  it('bounds the match count and the snippet length', () => {
    const noisy = Array.from({ length: 60 }, () => 'projection lag 42').join('\n');
    const result = runJao4WorkbenchInternal(
      request([searchCall({ maxMatches: 3 })], {
        artifactBundle: bundle({
          artifacts: [
            {
              artifactId: 'jao4.artifact.noisy',
              path: 'logs/noisy.log',
              contentClass: 'LOG_EXCERPT',
              content: noisy,
            },
          ],
        }),
      }),
      deps(),
    );
    const evidence = result.toolCalls[0]?.evidence;
    if (evidence?.kind !== 'LITERAL_SEARCH') {
      throw new Error('expected a search');
    }
    expect(evidence.matchCount).toBe(3);
    expect(evidence.truncated).toBe(true);

    // The declared ceiling cannot be exceeded by asking for more.
    expect(
      jao4WorkbenchRequestSchema.safeParse(
        request([searchCall({ maxMatches: JAO4_LIMITS.maxSearchMatches + 1 })]),
      ).success,
    ).toBe(false);
    expect(
      jao4WorkbenchRequestSchema.safeParse(
        request([searchCall({ query: 'q'.repeat(JAO4_LIMITS.maxSearchQueryChars + 1) })]),
      ).success,
    ).toBe(false);

    const longLine = 'z'.repeat(JAO4_LIMITS.maxSnippetChars + 100);
    const snipped = runJao4WorkbenchInternal(
      request([searchCall({ query: 'zzz' })], {
        artifactBundle: bundle({
          artifacts: [
            {
              artifactId: 'jao4.artifact.long',
              path: 'logs/long.log',
              contentClass: 'LOG_EXCERPT',
              content: longLine,
            },
          ],
        }),
      }),
      deps(),
    );
    const snippedEvidence = snipped.toolCalls[0]?.evidence;
    if (snippedEvidence?.kind !== 'LITERAL_SEARCH') {
      throw new Error('expected a search');
    }
    expect(snippedEvidence.matches[0]?.snippet.length).toBe(JAO4_LIMITS.maxSnippetChars);
  });

  it('hashes an artifact to a known SHA-256 and returns no content', () => {
    const result = runJao4WorkbenchInternal(request([hashCall()]), deps());
    const evidence = result.toolCalls[0]?.evidence;
    if (evidence?.kind !== 'ARTIFACT_DIGEST') {
      throw new Error('expected a digest');
    }
    // The SHA-256 of the exact fixture text, pinned. A shape check alone would pass for any
    // 64-character hex string, including one produced by hashing the wrong thing.
    expect(evidence.sha256).toMatch(/^[0-9a-f]{64}$/u);
    expect(evidence.sha256).toBe(
      '4cd2c631f24a29db6a9d53272fa459a82c5423cca3ebdbb8aab71b1481237457',
    );

    // A different artifact hashes differently, so the digest is of THIS artifact.
    const other = runJao4WorkbenchInternal(request([hashCall({ path: 'logs/api.log' })]), deps());
    const otherEvidence = other.toolCalls[0]?.evidence;
    if (otherEvidence?.kind !== 'ARTIFACT_DIGEST') {
      throw new Error('expected a digest');
    }
    expect(otherEvidence.sha256).toBe(
      'ecbd55a6667a41a0ff0890735b6e7da2c57a8db45fe52d399580093c95f63acc',
    );
    // No content anywhere in a digest result: hashing must not become a way to read.
    expect(JSON.stringify(evidence)).not.toContain('mode=shadow');
    expect(evidence.chars).toBe(RUNTIME_CONFIG.length);
  });

  it('enforces the call budget and the total output budget, discarding over-budget results whole', () => {
    // Five calls cannot even be expressed: the request schema caps the array.
    expect(
      jao4WorkbenchRequestSchema.safeParse(
        request([
          listCall(),
          readCall(),
          searchCall(),
          hashCall(),
          listCall({ callId: 'jao4.call.5' }),
        ]),
      ).success,
    ).toBe(false);

    // Four is the ceiling and it works.
    const full = runJao4WorkbenchInternal(
      request([listCall(), readCall(), searchCall(), hashCall()]),
      deps(),
    );
    expect(full.outcome).toBe('COMPLETED');
    expect(full.totalCalls).toBe(4);
    expect(full.totalOutputChars).toBeLessThanOrEqual(JAO4_LIMITS.maxTotalOutputChars);
    expect(full.evidenceRefs).toHaveLength(4);

    // The tool's OWN governed ceiling is what a run-wide bound would not enforce: a tool registered
    // for one call per run gets one, even though three calls remain in the run budget.
    // The implementation carries the SAME descriptor -- otherwise the binding gate refuses first,
    // which is correct behaviour but would prove the wrong thing here.
    const oneCallOnly = jao4ToolDescriptorSchema.parse({
      ...JAO4_PRODUCTION_TOOLS[0],
      maxCallsPerRun: 1,
    });
    const strict = countingTools(oneCallOnly);
    const perTool = runJao4WorkbenchInternal(
      request([listCall({ callId: 'jao4.call.p1' }), listCall({ callId: 'jao4.call.p2' })]),
      deps({ tools: strict.tools, registry: createJao4ToolRegistry([oneCallOnly]) }),
    );
    expect(perTool.toolCalls[0]?.outcome).toBe('COMPLETED');
    expect(perTool.toolCalls[1]?.refusalReason).toBe('CALL_BUDGET_EXHAUSTED');
    expect(perTool.toolCalls[1]?.evidence).toBeNull();
    expect(strict.calls()).toBe(1);

    // A bundle large enough that reads exceed the total output ceiling.
    const wide = 'w'.repeat(JAO4_LIMITS.maxArtifactChars);
    const heavy = runJao4WorkbenchInternal(
      request(
        [
          readCall({
            callId: 'jao4.call.a',
            maxChars: JAO4_LIMITS.maxReadCharsPerCall,
            path: 'logs/wide.log',
          }),
          readCall({
            callId: 'jao4.call.b',
            maxChars: JAO4_LIMITS.maxReadCharsPerCall,
            path: 'logs/wide.log',
          }),
          readCall({
            callId: 'jao4.call.c',
            maxChars: JAO4_LIMITS.maxReadCharsPerCall,
            path: 'logs/wide.log',
          }),
          readCall({
            callId: 'jao4.call.d',
            maxChars: JAO4_LIMITS.maxReadCharsPerCall,
            path: 'logs/wide.log',
          }),
        ],
        {
          artifactBundle: bundle({
            artifacts: [
              {
                artifactId: 'jao4.artifact.wide',
                path: 'logs/wide.log',
                contentClass: 'LOG_EXCERPT',
                content: wide,
              },
            ],
          }),
        },
      ),
      deps(),
    );
    expect(heavy.outcome).toBe('REFUSED');
    const budgetRefusals = heavy.toolCalls.filter(
      (one) => one.refusalReason === 'OUTPUT_BUDGET_EXHAUSTED',
    );
    expect(budgetRefusals.length).toBeGreaterThan(0);
    // Discarded WHOLE: a refused call carries no partial excerpt.
    for (const refused of budgetRefusals) {
      expect(refused.evidence).toBeNull();
      expect(refused.outputChars).toBe(0);
    }
    expect(heavy.totalOutputChars).toBeLessThanOrEqual(JAO4_LIMITS.maxTotalOutputChars);
  });

  it('refuses an unknown, planned, disabled or version-mismatched tool before invoking anything', () => {
    // Unknown.
    const unknown = countingTools();
    const unknownResult = runJao4WorkbenchInternal(
      request([listCall({ toolId: 'shell.exec.v1' })]),
      deps({ tools: unknown.tools }),
    );
    // A tool id outside the closed vocabulary cannot even be parsed into a call.
    expect(unknownResult.outcome).toBe('REFUSED');
    expect(unknownResult.refusalReason).toBe('REQUEST_INVALID');
    expect(unknown.calls()).toBe(0);

    // A registered-but-unavailable tool.
    for (const [availability, reason] of [
      ['PLANNED', 'TOOL_PLANNED'],
      ['DISABLED', 'TOOL_DISABLED'],
    ] as const) {
      const spy = countingTools();
      const result = runJao4WorkbenchInternal(
        request([listCall()]),
        deps({
          tools: spy.tools,
          registry: createJao4ToolRegistry([
            jao4ToolDescriptorSchema.parse({
              ...JAO4_PRODUCTION_TOOLS[0],
              availability,
            }),
          ]),
        }),
      );
      expect(result.toolCalls[0]?.refusalReason, availability).toBe(reason);
      expect(spy.calls(), availability).toBe(0);
    }

    // Registered, but not at the version asked for.
    const versioned = countingTools();
    const versionResult = runJao4WorkbenchInternal(
      request([listCall({ toolVersion: '2' })]),
      deps({ tools: versioned.tools }),
    );
    expect(versionResult.outcome).toBe('REFUSED');
    expect(versioned.calls()).toBe(0);

    // Registry emptied entirely: no fallback, no nearest match, no dynamic install.
    const empty = countingTools();
    const emptyResult = runJao4WorkbenchInternal(
      request([listCall()]),
      deps({ tools: empty.tools, registry: createJao4ToolRegistry([]) }),
    );
    expect(emptyResult.toolCalls[0]?.refusalReason).toBe('TOOL_UNKNOWN');
    expect(empty.calls()).toBe(0);
  });

  it('refuses an implementation that is not the tool the registry authorized', () => {
    // The JAO-2 lesson: the registry authorizes a descriptor, the composition supplies an
    // implementation, and nothing else requires them to be the same tool.
    for (const forged of [
      { ...JAO4_READ_TOOL, governanceRef: 'ADR-9999.some-other-governance' },
      { ...JAO4_READ_TOOL, mayUseShell: true },
      { ...JAO4_READ_TOOL, mayAccessHostFilesystem: true },
      { ...JAO4_READ_TOOL, hostFilesystem: 'ALLOW' },
      { ...JAO4_READ_TOOL, toolClass: 'HOST_COMMAND_EXECUTION' },
      { toolId: 'artifact.read.v1' },
      {},
    ]) {
      const spy = countingTools(forgedDescriptor(forged));
      const result = runJao4WorkbenchInternal(request([readCall()]), deps({ tools: spy.tools }));
      expect(result.toolCalls[0]?.refusalReason, JSON.stringify(forged)).toBe(
        'TOOL_BINDING_MISMATCH',
      );
      expect(spy.calls(), JSON.stringify(forged)).toBe(0);
      expect(result.toolCalls[0]?.evidence).toBeNull();
    }
  });

  it('refuses authority escalation, and a request claiming business effect cannot be parsed', () => {
    const spy = countingTools();
    const escalated = runJao4WorkbenchInternal(
      request([listCall()], {
        parentAutonomyLevel: 'L0_REASON',
        requestedAutonomyLevel: 'L1_READ',
      }),
      deps({ tools: spy.tools }),
    );
    expect(escalated.toolCalls[0]?.refusalReason).toBe('AUTHORITY_ESCALATION');
    expect(spy.calls()).toBe(0);

    // Effect, production mode and a second autonomy tier cannot even be expressed.
    for (const forbidden of [
      { businessEffectAllowed: true },
      { mode: 'PRODUCTION' },
      { requestedAutonomyLevel: 'L2_WRITE' },
      { productionMutationAllowed: true },
      { networkAllowed: true },
    ]) {
      expect(
        jao4WorkbenchRequestSchema.safeParse(request([listCall()], forbidden)).success,
        JSON.stringify(forbidden),
      ).toBe(false);
    }
  });

  it('binds each call to the run executing it, and the bundle to the id that names it', () => {
    const spy = countingTools();
    const mismatchedRun = runJao4WorkbenchInternal(
      request([listCall({ runId: 'jao4.run.other' })]),
      deps({ tools: spy.tools }),
    );
    expect(mismatchedRun.toolCalls[0]?.refusalReason).toBe('RUN_ID_MISMATCH');
    expect(spy.calls()).toBe(0);

    const mismatchedBundle = runJao4WorkbenchInternal(
      request([listCall()], { artifactBundleId: 'jao4.bundle.other' }),
      deps({ tools: spy.tools }),
    );
    expect(mismatchedBundle.outcome).toBe('REFUSED');
    expect(mismatchedBundle.refusalReason).toBe('ARTIFACT_BUNDLE_INVALID');
    expect(spy.calls()).toBe(0);
  });

  it('invokes nothing when cancelled before the first call', () => {
    const spy = countingTools();
    const controller = new AbortController();
    controller.abort();

    const result = runJao4WorkbenchInternal(
      request([listCall(), readCall()]),
      deps({ tools: spy.tools }),
      controller.signal,
    );
    expect(result.outcome).toBe('REFUSED');
    expect(result.refusalReason).toBe('CANCELLED');
    expect(spy.calls()).toBe(0);
    expect(result.toolInvocations).toBe(0);
    expect(result.totalOutputChars).toBe(0);
  });

  it('reports a security posture that is literal, and evidence that carries no authority', () => {
    const events: Jao4TelemetryEvent[] = [];
    const result = runJao4WorkbenchInternal(
      request([listCall(), readCall()]),
      deps({ telemetry: { record: (event) => events.push(event) } }),
    );

    expect(result.networkAccess).toBe(false);
    expect(result.secretSourceAccess).toBe(false);
    expect(result.hostFilesystemAccess).toBe(false);
    expect(result.processExecution).toBe(false);
    expect(result.shellExecution).toBe(false);
    expect(result.environmentAccess).toBe(false);
    expect(result.databaseAccess).toBe(false);
    expect(result.businessEffect).toBe(false);
    expect(result.productionMutation).toBe(false);
    expect(result.modelCalls).toBe(0);
    expect(result.specialistCalls).toBe(0);
    expect(result.memoryWrites).toBe(0);

    // No authority-shaped field exists on any tool result.
    const serialised = JSON.stringify(result.toolCalls);
    for (const forbidden of [
      'isAuthorized',
      'authorized',
      'approved',
      'approvalGranted',
      'canExecute',
      'canSend',
      'executionAllowed',
      'businessEffect',
      'productionMutation',
      'recommendation',
    ]) {
      expect(serialised, forbidden).not.toContain(forbidden);
    }
    for (const call of result.toolCalls) {
      expect(call.untrustedEvidence).toBe(true);
    }

    // Telemetry is content-free: no excerpt, no snippet, no query, no artifact text.
    expect(events).toHaveLength(1);
    const telemetry = JSON.stringify(events[0]);
    expect(telemetry).not.toContain('projection lag');
    expect(telemetry).not.toContain('mode=shadow');
    expect(telemetry).not.toContain('boot ok');
    expect(events[0]?.modelCalls).toBe(0);
    expect(events[0]?.hostFilesystemAccess).toBe(false);
  });

  it('counts ZERO tool invocations for every pre-invocation refusal', () => {
    // The audit point is immediately before `invoke`. Everything decided above it leaves the count
    // at zero, so an auditor reading a refused run can tell that nothing ran.
    const refusals: {
      readonly label: string;
      readonly result: ReturnType<typeof runJao4WorkbenchInternal>;
    }[] = [
      {
        label: 'unknown tool',
        result: runJao4WorkbenchInternal(
          request([listCall()]),
          deps({ registry: createJao4ToolRegistry([]) }),
        ),
      },
      {
        label: 'PLANNED tool',
        result: runJao4WorkbenchInternal(
          request([listCall()]),
          deps({
            registry: createJao4ToolRegistry([
              jao4ToolDescriptorSchema.parse({
                ...JAO4_PRODUCTION_TOOLS[0],
                availability: 'PLANNED',
              }),
            ]),
          }),
        ),
      },
      {
        label: 'DISABLED tool',
        result: runJao4WorkbenchInternal(
          request([listCall()]),
          deps({
            registry: createJao4ToolRegistry([
              jao4ToolDescriptorSchema.parse({
                ...JAO4_PRODUCTION_TOOLS[0],
                availability: 'DISABLED',
              }),
            ]),
          }),
        ),
      },
      {
        label: 'version mismatch',
        result: runJao4WorkbenchInternal(request([listCall({ toolVersion: '2' })]), deps()),
      },
      {
        label: 'authority escalation',
        result: runJao4WorkbenchInternal(
          request([listCall()], {
            parentAutonomyLevel: 'L0_REASON',
            requestedAutonomyLevel: 'L1_READ',
          }),
          deps(),
        ),
      },
      {
        label: 'binding mismatch',
        result: runJao4WorkbenchInternal(
          request([readCall()]),
          deps({
            tools: countingTools(
              forgedDescriptor({ ...JAO4_READ_TOOL, governanceRef: 'ADR-9999.other' }),
            ).tools,
          }),
        ),
      },
      {
        label: 'run id mismatch',
        result: runJao4WorkbenchInternal(request([listCall({ runId: 'jao4.run.other' })]), deps()),
      },
    ];

    for (const { label, result } of refusals) {
      expect(result.outcome, label).toBe('REFUSED');
      expect(result.toolInvocations, label).toBe(0);
    }

    const controller = new AbortController();
    controller.abort();
    const cancelled = runJao4WorkbenchInternal(
      request([listCall(), readCall()]),
      deps(),
      controller.signal,
    );
    expect(cancelled.refusalReason).toBe('CANCELLED');
    expect(cancelled.toolInvocations).toBe(0);
  });

  it('counts an invocation that happened, whatever became of its output', () => {
    // The audit gap owner review found: an implementation that ran and then threw, or returned
    // refused evidence, or produced output the budget rejected, was counted nowhere. What a tool
    // DID is not undone by what happened to its result.
    const ok = runJao4WorkbenchInternal(request([listCall()]), deps());
    expect(ok.outcome).toBe('COMPLETED');
    expect(ok.toolInvocations).toBe(1);
    expect(ok.totalCalls).toBe(1);

    // Entered, then threw.
    const exploding: Readonly<Record<string, Jao4Tool>> = Object.freeze({
      'artifact.list.v1': {
        descriptor: JAO4_LIST_TOOL,
        invoke: (): never => {
          throw new Error('TOOL-INTERNAL-DETAIL-MUST-NOT-LEAK');
        },
      },
    });
    const threw = runJao4WorkbenchInternal(request([listCall()]), deps({ tools: exploding }));
    expect(threw.outcome).toBe('REFUSED');
    expect(threw.toolCalls[0]?.refusalReason).toBe('TOOL_FAILED');
    expect(threw.toolInvocations).toBe(1);
    // Normalised: nothing the thrown object carried reaches the record.
    expect(JSON.stringify(threw)).not.toContain('TOOL-INTERNAL-DETAIL-MUST-NOT-LEAK');

    // Entered, then returned evidence the contract refuses.
    const rogue: Readonly<Record<string, Jao4Tool>> = Object.freeze({
      'artifact.list.v1': {
        descriptor: JAO4_LIST_TOOL,
        invoke: (): Jao4ToolOutput =>
          ({
            evidence: { kind: 'ARTIFACT_LIST', artifacts: [{ nope: true }] },
            inputCharsExamined: 0,
          }) as unknown as Jao4ToolOutput,
      },
    });
    const invalid = runJao4WorkbenchInternal(request([listCall()]), deps({ tools: rogue }));
    expect(invalid.outcome).toBe('REFUSED');
    expect(invalid.toolCalls[0]?.refusalReason).toBe('TOOL_OUTPUT_INVALID');
    expect(invalid.toolCalls[0]?.evidence).toBeNull();
    expect(invalid.toolInvocations).toBe(1);

    // Valid evidence, rejected by the RUN's total output budget. The invocation still counts.
    const wide = 'w'.repeat(JAO4_LIMITS.maxArtifactChars);
    const wideBundle = bundle({
      artifacts: [
        {
          artifactId: 'jao4.artifact.wide',
          path: 'logs/wide.log',
          contentClass: 'LOG_EXCERPT',
          content: wide,
        },
      ],
    });
    const heavy = runJao4WorkbenchInternal(
      request(
        [
          readCall({
            callId: 'jao4.call.h1',
            path: 'logs/wide.log',
            maxChars: JAO4_LIMITS.maxReadCharsPerCall,
          }),
          readCall({
            callId: 'jao4.call.h2',
            path: 'logs/wide.log',
            maxChars: JAO4_LIMITS.maxReadCharsPerCall,
          }),
          readCall({
            callId: 'jao4.call.h3',
            path: 'logs/wide.log',
            maxChars: JAO4_LIMITS.maxReadCharsPerCall,
          }),
          readCall({
            callId: 'jao4.call.h4',
            path: 'logs/wide.log',
            maxChars: JAO4_LIMITS.maxReadCharsPerCall,
          }),
        ],
        { artifactBundle: wideBundle },
      ),
      deps(),
    );
    const rejected = heavy.toolCalls.filter(
      (one) => one.refusalReason === 'OUTPUT_BUDGET_EXHAUSTED',
    );
    expect(rejected.length).toBeGreaterThan(0);
    for (const one of rejected) {
      expect(one.evidence).toBeNull();
    }
    // Every planned call reached the implementation, including those whose output was discarded.
    expect(heavy.toolInvocations).toBe(heavy.toolCalls.length);
    expect(heavy.toolInvocations).toBeGreaterThan(
      heavy.toolCalls.filter((one) => one.outcome === 'COMPLETED').length,
    );
  });

  it('reports the same invocation count in telemetry as in the result', () => {
    const events: Jao4TelemetryEvent[] = [];
    const result = runJao4WorkbenchInternal(
      request([listCall(), readCall(), searchCall()]),
      deps({ telemetry: { record: (event) => events.push(event) } }),
    );
    expect(events).toHaveLength(1);
    expect(events[0]?.toolInvocations).toBe(result.toolInvocations);
    expect(result.toolInvocations).toBe(3);
    expect(events[0]?.totalCalls).toBe(result.totalCalls);
  });

  it('builds a sandbox that can only be read', () => {
    const sandbox = createJao4ArtifactSandbox(bundle());
    expect(sandbox.bundleId).toBe('jao4.bundle.001');
    expect(sandbox.entries()).toHaveLength(2);
    expect(sandbox.lookup('logs/api.log').artifact.artifactId).toBe('jao4.artifact.log');

    // The surface is enumeration and lookup. There is no write, put, delete, move or mkdir.
    expect(Object.keys(sandbox).sort()).toStrictEqual([
      'bundleId',
      'entries',
      'lookup',
      'totalChars',
    ]);
    expect(Object.isFrozen(sandbox)).toBe(true);
  });
});
