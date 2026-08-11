/**
 * Writing the review bundle OUTSIDE the repository (MVP-P2A.1).
 *
 * ### The bundle is the one content-bearing artifact in this workstream
 *
 * It holds seventy-two synthetic client turns and seventy-two candidate replies. Everything else here
 * is counts and identifiers. So it gets the treatment the Groq smoke configuration already established:
 * an explicit operator-supplied path, a refusal to write anywhere at or below the repository root, a
 * refusal to overwrite without being told twice, an atomic replace, and a console line that names the
 * path and the counts and nothing else.
 *
 * No environment discovery, no default home directory, no temp fallback. A default path is how a
 * content artifact ends up somewhere nobody remembers, and "somewhere nobody remembers" is where it
 * stays until it is copied into a ticket.
 */
import { mkdtempSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';

import { RiyaCandidateRunnerError } from '../contracts/errors.js';
import type { RiyaQualityReviewBundle } from './review-bundle.js';

/** What the caller learns. Counts and a path — never a case, a turn or a reply. */
export interface RiyaReviewBundleWriteReceipt {
  readonly outputPath: string;
  readonly caseCount: number;
  readonly requiredReviewsPerCase: number;
}

/** Refuse a path at or below `repoRoot`. A content artifact does not belong in version control. */
function assertOutsideRepository(outputPath: string, repoRoot: string): void {
  const relation = relative(resolve(repoRoot), outputPath);
  const insideRepo = relation === '' || (!relation.startsWith('..') && !isAbsolute(relation));
  if (insideRepo) {
    throw new RiyaCandidateRunnerError('OUTPUT_PATH_REFUSED');
  }
}

function exists(path: string): boolean {
  try {
    statSync(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Write the bundle atomically to an explicit external path.
 *
 * Atomic because a half-written bundle that a reviewer opens is worse than none: they would review the
 * cases that made it to disk and nobody would know the set was short.
 */
export function writeRiyaQualityReviewBundle(options: {
  readonly bundle: RiyaQualityReviewBundle;
  /** An absolute path OUTSIDE the repository. Required; there is no default. */
  readonly outputPath: string;
  /** The repository root this must stay out of. */
  readonly repoRoot: string;
  readonly overwrite?: boolean;
}): RiyaReviewBundleWriteReceipt {
  const outputPath = resolve(options.outputPath);
  if (!isAbsolute(options.outputPath)) {
    throw new RiyaCandidateRunnerError('OUTPUT_PATH_REFUSED');
  }
  assertOutsideRepository(outputPath, options.repoRoot);
  if (options.overwrite !== true && exists(outputPath)) {
    throw new RiyaCandidateRunnerError('OUTPUT_PATH_REFUSED');
  }

  const directory = dirname(outputPath);
  if (!exists(directory)) {
    throw new RiyaCandidateRunnerError('OUTPUT_PATH_REFUSED');
  }

  const staging = mkdtempSync(join(directory, '.riya-review-'));
  const temporary = join(staging, 'bundle.json');
  try {
    writeFileSync(temporary, `${JSON.stringify(options.bundle, undefined, 2)}\n`, 'utf8');
    renameSync(temporary, outputPath);
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }

  return Object.freeze({
    outputPath,
    caseCount: options.bundle.cases.length,
    requiredReviewsPerCase: options.bundle.requiredReviewsPerCase,
  });
}
