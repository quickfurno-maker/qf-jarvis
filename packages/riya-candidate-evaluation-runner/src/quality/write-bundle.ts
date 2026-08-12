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
import {
  lstatSync,
  mkdtempSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';

import { RiyaCandidateRunnerError } from '../contracts/errors.js';
import type { RiyaQualityReviewBundle } from './review-bundle.js';

/** What the caller learns. Counts and a path — never a case, a turn or a reply. */
export interface RiyaReviewBundleWriteReceipt {
  readonly outputPath: string;
  readonly caseCount: number;
  readonly requiredReviewsPerCase: number;
}

/**
 * Refuse a destination at or below `repoRoot`, by REAL location rather than by spelling.
 *
 * A lexical comparison answers "does this path look external", and an external-looking directory can
 * be a symlink or a junction that resolves straight back into the repository. This file holds every
 * synthetic client turn and every candidate reply, so the question that matters is where the bytes
 * actually land.
 *
 * Only the PARENT is resolved, and it must already exist. Nothing is created to find out.
 */
function assertOutsideRepository(outputPath: string, repoRoot: string): void {
  const realRepoRoot = realpathSync(resolve(repoRoot));
  let realParent: string;
  try {
    realParent = realpathSync(dirname(outputPath));
  } catch {
    // A parent that cannot be resolved is a parent that does not exist, which is refused anyway.
    throw new RiyaCandidateRunnerError('OUTPUT_PATH_REFUSED');
  }
  const realTarget = join(realParent, basename(outputPath));
  for (const candidate of [outputPath, realTarget]) {
    const relation = relative(realRepoRoot, candidate);
    const insideRepo = relation === '' || (!relation.startsWith('..') && !isAbsolute(relation));
    if (insideRepo) {
      throw new RiyaCandidateRunnerError('OUTPUT_PATH_REFUSED');
    }
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
  const directory = dirname(outputPath);
  if (!exists(directory)) {
    throw new RiyaCandidateRunnerError('OUTPUT_PATH_REFUSED');
  }
  assertOutsideRepository(outputPath, options.repoRoot);
  if (exists(outputPath)) {
    if (options.overwrite !== true) {
      throw new RiyaCandidateRunnerError('OUTPUT_PATH_REFUSED');
    }
    // Overwriting a LINK writes through it, wherever it points. Replacing a regular file is the only
    // overwrite this grants.
    if (!lstatSync(outputPath).isFile()) {
      throw new RiyaCandidateRunnerError('OUTPUT_PATH_REFUSED');
    }
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
