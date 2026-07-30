/**
 * The offline SHADOW evidence-generator CLI (QFJ-S2-E-B, ADR-0065 §4).
 *
 * Reads one non-secret run configuration, builds `SHADOW_ELIGIBILITY` evidence through the existing
 * `@qf-jarvis/model-evaluation` gates, and emits the artifact plus its deterministic digest.
 *
 * It accesses no credential, constructs no provider, and makes no network call. Importing this module
 * runs nothing.
 */
import { contentDigest } from '@qf-jarvis/model-evaluation';

import { generateShadowEvidence } from '../shadow/shadow-evidence-generator.js';
import { createShadowConfigReader, type ShadowJsonReader } from '../shadow/shadow-json-reader.js';
import { SHADOW_PROMPT_ID } from '../shadow/shadow-request.js';
import { validateShadowRunConfig } from '../shadow/shadow-run-config.js';
import { parseShadowArgs } from './shadow-cli-args.js';

/** The closed generator outcomes. */
export type EvidenceCliReason =
  'evidence-generated' | 'config-invalid' | 'evidence-gate-blocked' | 'internal-invariant';

/**
 * The one emitted line.
 *
 * Deliberately narrow: an outcome, a reason, the target, the digest, and the authority. No path, no
 * credential reference, no config digest, no prompt, no evaluation content — the ARTIFACT is written to
 * a file by the operator, and this line is only how they learn the digest to pin.
 */
export interface EvidenceCliResult {
  readonly timestamp: string;
  readonly outcome: 'PASS' | 'FAIL';
  readonly reason: EvidenceCliReason;
  readonly evidenceTarget: 'SHADOW_ELIGIBILITY' | 'none';
  readonly evidenceDigest: string;
  readonly synthetic: boolean;
  readonly productionApproval: boolean;
  readonly authority: 'QUICKFURNO_CORE';
}

const KEYS: readonly (keyof EvidenceCliResult)[] = Object.freeze([
  'timestamp',
  'outcome',
  'reason',
  'evidenceTarget',
  'evidenceDigest',
  'synthetic',
  'productionApproval',
  'authority',
]);

export interface EvidenceCliIo {
  /** The one result line. */
  write(line: string): void;
  /** The evidence artifact itself, as canonical JSON. Separate sink so the two never mix. */
  writeArtifact(json: string): void;
  nowIso(): string;
}

export interface EvidenceCliSeams {
  readonly configReader?: ShadowJsonReader;
}

function emit(io: EvidenceCliIo, result: EvidenceCliResult): number {
  const ordered: Record<string, unknown> = {};
  for (const key of KEYS) {
    ordered[key] = result[key];
  }
  io.write(JSON.stringify(ordered));
  return result.outcome === 'PASS' ? 0 : 1;
}

function fail(io: EvidenceCliIo, reason: EvidenceCliReason): number {
  return emit(io, {
    timestamp: io.nowIso(),
    outcome: 'FAIL',
    reason,
    evidenceTarget: 'none',
    evidenceDigest: 'none',
    synthetic: false,
    productionApproval: false,
    authority: 'QUICKFURNO_CORE',
  });
}

/** Generate the evidence artifact for a run configuration. Returns a process exit code. */
export async function generateShadowEvidenceCli(
  argv: readonly string[],
  io: EvidenceCliIo,
  seams: EvidenceCliSeams = {},
): Promise<number> {
  const parsed = parseShadowArgs(argv, ['--config']);
  if (!parsed.ok) {
    return fail(io, 'config-invalid');
  }
  const configPath = parsed.args['--config'];
  if (configPath === undefined) {
    return fail(io, 'config-invalid');
  }

  const read = await (seams.configReader ?? createShadowConfigReader(configPath)).read();
  if (!read.ok) {
    return fail(io, 'config-invalid');
  }
  // The config digest is NOT asserted here: the generator's job is to produce the evidence digest the
  // operator will then pin. The runner is where both digests are matched.
  const validated = validateShadowRunConfig(read.value, {
    expectedPromptId: SHADOW_PROMPT_ID,
    digest: contentDigest,
  });
  if (!validated.ok) {
    return fail(io, 'config-invalid');
  }

  let generated;
  try {
    generated = generateShadowEvidence(validated.config);
  } catch {
    return fail(io, 'internal-invariant');
  }
  if (!generated.ok) {
    return fail(io, 'evidence-gate-blocked');
  }

  io.writeArtifact(JSON.stringify(generated.evidence, null, 2));
  return emit(io, {
    timestamp: io.nowIso(),
    outcome: 'PASS',
    reason: 'evidence-generated',
    evidenceTarget: 'SHADOW_ELIGIBILITY',
    evidenceDigest: generated.digest,
    synthetic: generated.evidence.synthetic,
    productionApproval: generated.evidence.productionApproval,
    authority: 'QUICKFURNO_CORE',
  });
}

/** The real process seams. The artifact goes to stdout so the operator redirects it deliberately. */
export function defaultEvidenceCliIo(): EvidenceCliIo {
  return {
    write: (line: string): void => {
      process.stderr.write(`${line}\n`);
    },
    writeArtifact: (json: string): void => {
      process.stdout.write(`${json}\n`);
    },
    nowIso: (): string => new Date().toISOString(),
  };
}
