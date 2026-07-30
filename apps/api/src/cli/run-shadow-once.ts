/**
 * The controlled SHADOW one-shot CLI (QFJ-S2-E-B, ADR-0065).
 *
 * Importing this module runs nothing. `runShadowOnceCli` is invoked by the bin entry, and every failure
 * is caught: an arbitrary `Error`, its `cause` and its stack are discarded, and exactly one closed JSON
 * line is written. No path, digest, reference, prompt or model output can appear in it.
 *
 * This CLI performs a REAL provider call when given a real credential. It is executed only under a fresh,
 * single-use owner authorisation (S2-E-C); nothing here schedules, retries, or repeats a run.
 */
import { contentDigest } from '@qf-jarvis/model-evaluation';
import type { ApprovalEvidence } from '@qf-jarvis/model-evaluation';

import { runControlledShadowOnce } from '../shadow/create-controlled-shadow-runner.js';
import {
  createShadowConfigReader,
  createShadowEvidenceReader,
  type ShadowJsonReader,
} from '../shadow/shadow-json-reader.js';
import { SHADOW_PROMPT_ID } from '../shadow/shadow-request.js';
import { validateShadowRunConfig } from '../shadow/shadow-run-config.js';
import {
  formatShadowRunResult,
  SHADOW_RESULT_KEYS,
  type ShadowReason,
  type ShadowRunResult,
} from '../shadow/shadow-result.js';
import { parseShadowArgs } from './shadow-cli-args.js';

/** Where the one line goes. Injected so a spec can capture it without touching a real stream. */
export interface ShadowCliIo {
  write(line: string): void;
  nowIso(): string;
}

/** Internal seams for offline specs. Never CLI-configurable. */
export interface ShadowCliSeams {
  readonly configReader?: ShadowJsonReader;
  readonly evidenceReader?: ShadowJsonReader;
  readonly runner?: typeof runControlledShadowOnce;
  readonly runnerSeams?: Parameters<typeof runControlledShadowOnce>[0]['seams'];
}

/** A pre-run refusal: everything a run needs was not in place, so nothing was touched. */
function refusal(io: ShadowCliIo, reason: ShadowReason): 1 {
  const blank: ShadowRunResult = Object.freeze({
    timestamp: io.nowIso(),
    outcome: 'FAIL',
    reason,
    mode: 'SHADOW',
    finalMode: 'OFF',
    policyRevision: 0,
    finalPolicyRevision: 0,
    stableProviderId: 'not-configured',
    stableReleaseId: 'not-configured',
    candidateProviderId: 'not-configured',
    candidateReleaseId: 'not-configured',
    credentialBackend: 'file',
    credentialResolveAttempts: 0,
    credentialResolveSuccesses: 0,
    credentialReads: 0,
    providerConstructions: 0,
    healthChecks: 0,
    stableInvocations: 0,
    candidateInvocations: 0,
    transportRequests: 0,
    stableLatencyMs: 0,
    candidateLatencyMs: 0,
    totalElapsedMs: 0,
    stableInputTokens: 0,
    stableOutputTokens: 0,
    candidateInputTokens: 0,
    candidateOutputTokens: 0,
    timeouts: 0,
    cancellations: 0,
    retries: 0,
    fallbacks: 0,
    refreshes: 0,
    transitions: 0,
    timersArmed: 0,
    timersCleared: 0,
    modelOutput: 'DISCARDED',
    authority: 'QUICKFURNO_CORE',
  });
  io.write(formatShadowRunResult(blank));
  return 1;
}

/** True iff the parsed value has the shape of an `ApprovalEvidence`. Structure only, never content. */
function looksLikeEvidence(value: unknown): value is ApprovalEvidence {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  // Indexed through `unknown` rather than `Partial<ApprovalEvidence>`: the declared field types would
  // make each guard look impossible to the type checker, and these values came from a JSON file.
  const candidate: Record<string, unknown> = value as Record<string, unknown>;
  return (
    typeof candidate['evaluationRef'] === 'string' &&
    typeof candidate['target'] === 'string' &&
    typeof candidate['binding'] === 'object' &&
    candidate['binding'] !== null &&
    typeof candidate['synthetic'] === 'boolean' &&
    typeof candidate['productionApproval'] === 'boolean'
  );
}

/**
 * Run one controlled SHADOW validation and return a process exit code.
 *
 * Every refusal happens before the credential is read, so a misconfigured invocation never opens the
 * credential file.
 */
export async function runShadowOnceCli(
  argv: readonly string[],
  io: ShadowCliIo,
  seams: ShadowCliSeams = {},
): Promise<number> {
  const parsed = parseShadowArgs(argv, [
    '--config',
    '--evidence',
    '--credential-file',
    '--expected-config-digest',
    '--expected-evidence-digest',
  ]);
  if (!parsed.ok) {
    return refusal(io, 'config-invalid');
  }
  const configPath = parsed.args['--config'];
  const evidencePath = parsed.args['--evidence'];
  const credentialPath = parsed.args['--credential-file'];
  const expectedConfigDigest = parsed.args['--expected-config-digest'];
  const expectedEvidenceDigest = parsed.args['--expected-evidence-digest'];
  if (
    configPath === undefined ||
    evidencePath === undefined ||
    credentialPath === undefined ||
    expectedConfigDigest === undefined ||
    expectedEvidenceDigest === undefined
  ) {
    return refusal(io, 'config-invalid');
  }

  const configRead = await (seams.configReader ?? createShadowConfigReader(configPath)).read();
  if (!configRead.ok) {
    return refusal(io, 'config-invalid');
  }
  const validated = validateShadowRunConfig(configRead.value, {
    expectedPromptId: SHADOW_PROMPT_ID,
    expectedDigest: expectedConfigDigest,
    digest: contentDigest,
  });
  if (!validated.ok) {
    return refusal(io, 'config-invalid');
  }
  const config = validated.config;

  const evidenceRead = await (
    seams.evidenceReader ?? createShadowEvidenceReader(evidencePath)
  ).read();
  if (!evidenceRead.ok || !looksLikeEvidence(evidenceRead.value)) {
    return refusal(io, 'evidence-refused');
  }
  const evidence = evidenceRead.value;
  // The supplied digest is a CLAIM: it is recomputed from the loaded artifact and compared.
  if (contentDigest(evidence) !== expectedEvidenceDigest) {
    return refusal(io, 'evidence-refused');
  }
  if (config.evidenceDigest !== expectedEvidenceDigest) {
    return refusal(io, 'evidence-refused');
  }

  let result: ShadowRunResult;
  try {
    result = await (seams.runner ?? runControlledShadowOnce)({
      config,
      evidence,
      credentialFilePath: credentialPath,
      ...(seams.runnerSeams === undefined ? {} : { seams: seams.runnerSeams }),
    });
  } catch {
    // Nothing from the thrown value is retained.
    return refusal(io, 'internal-invariant');
  }

  // Defence in depth: emit only the declared keys, whatever the runner returned.
  const emitted: Record<string, unknown> = {};
  for (const key of SHADOW_RESULT_KEYS) {
    emitted[key] = result[key];
  }
  io.write(JSON.stringify(emitted));
  return result.outcome === 'PASS' ? 0 : 1;
}

/** The real process seams. Only this object touches a stream. */
export function defaultShadowCliIo(): ShadowCliIo {
  return {
    write: (line: string): void => {
      process.stdout.write(`${line}\n`);
    },
    nowIso: (): string => new Date().toISOString(),
  };
}
