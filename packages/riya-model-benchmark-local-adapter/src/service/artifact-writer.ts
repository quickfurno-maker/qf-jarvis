/**
 * Writing the two run artifacts to a local directory (AS4-PREP-A).
 *
 * ### Small, and deliberately not general
 *
 * It writes exactly two files with names this package chooses, into one directory the operator names.
 * There is no caller-supplied filename, so there is no traversal to defend against by string
 * inspection -- the defence is that the input never reaches the path. The resolved target is still
 * checked to be inside the directory, because "there is no way to get out" is a claim worth proving
 * rather than asserting.
 *
 * ### Atomic, and never a silent overwrite
 *
 * A temporary file in the same directory, then a rename. A crash mid-write leaves the old artifact or
 * no artifact, never half of one -- and a half-written result set is exactly the kind of file somebody
 * later reads with a JSON parser that happens to tolerate it. Overwriting an existing artifact needs an
 * explicit flag: benchmark evidence is the input to a decision, and quietly replacing yesterday's run
 * with today's is how the comparison stops being a comparison.
 *
 * ### What is written, and what cannot be
 *
 * An RMB-A result set and this package's sanitized manifest. Both are already content-free by shape.
 * There is no code path here that could write a prompt, a completion, a header, a response body or an
 * engine log, because no such value is ever passed in.
 */
import { randomUUID } from 'node:crypto';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { isAbsolute, join, resolve, sep } from 'node:path';

import { RiyaLocalBenchmarkError } from '../contracts/errors.js';

/** The two artifacts, named by this package. */
export const RIYA_LOCAL_RESULT_SET_FILENAME = 'benchmark-result-set.json';
export const RIYA_LOCAL_RUN_MANIFEST_FILENAME = 'benchmark-run-manifest.json';

export interface RiyaLocalArtifactWriter {
  write: (filename: string, value: unknown) => Promise<void>;
}

export interface CreateRiyaLocalArtifactWriterOptions {
  readonly directory: string;
  readonly allowOverwrite: boolean;
}

const ALLOWED_FILENAMES = new Set([
  RIYA_LOCAL_RESULT_SET_FILENAME,
  RIYA_LOCAL_RUN_MANIFEST_FILENAME,
]);

/** Build a writer for one output directory. */
export function createRiyaLocalArtifactWriter(
  options: CreateRiyaLocalArtifactWriterOptions,
): RiyaLocalArtifactWriter {
  const directory = resolve(options.directory);
  if (!isAbsolute(directory)) {
    throw new RiyaLocalBenchmarkError('ARTIFACT_WRITE_REFUSED');
  }

  const write = async (filename: string, value: unknown): Promise<void> => {
    if (!ALLOWED_FILENAMES.has(filename)) {
      throw new RiyaLocalBenchmarkError('ARTIFACT_WRITE_REFUSED');
    }
    const target = resolve(join(directory, filename));
    // The names are constants, so this cannot currently fail. It is here because the day somebody adds
    // a third artifact with a computed name, this is the line that refuses it rather than the review
    // that might not.
    if (target !== join(directory, filename) || !target.startsWith(directory + sep)) {
      throw new RiyaLocalBenchmarkError('ARTIFACT_WRITE_REFUSED');
    }

    await mkdir(directory, { recursive: true });

    // A unique temporary name, and `wx` on it. Two runs writing the same directory never collide, and
    // -- the reason this is not just `${target}.partial` -- a REFUSED run leaves nothing behind that
    // would make the next run fail for the wrong reason.
    const temporary = `${target}.${randomUUID()}.partial`;
    let renamed = false;
    try {
      await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, {
        encoding: 'utf8',
        flag: 'wx',
      });
      if (!options.allowOverwrite) {
        // Absence is proved by the write itself rather than by a preceding existence check: a check
        // followed by a rename is two operations with a gap between them.
        await writeFile(target, '', { encoding: 'utf8', flag: 'wx' });
      }
      await rename(temporary, target);
      renamed = true;
    } catch (error: unknown) {
      if (error instanceof RiyaLocalBenchmarkError) {
        throw error;
      }
      // A filesystem error message carries a path, and a path carries a username. It is replaced.
      throw new RiyaLocalBenchmarkError('ARTIFACT_WRITE_REFUSED');
    } finally {
      if (!renamed) {
        await rm(temporary, { force: true });
      }
    }
  };

  return Object.freeze({ write });
}
