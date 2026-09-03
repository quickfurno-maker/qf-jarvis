/**
 * The local pilot artifact writer (AS3A, ADR-0143 §15).
 *
 * ### Pilot artifacts are EVIDENCE, not a corpus
 *
 * Everything written here lands in an ignored local directory and is read by a human deciding whether
 * the next stage is worth running. None of it is a production training corpus, none of it is
 * committed, and AS3A releases nothing.
 *
 * ### Three defences, because a path is the classic way out of a sandbox
 *
 * 1. **Name validation.** A relative name only: no absolute path, no drive letter, no `..` segment,
 *    no leading separator. Checked on the SEGMENTS, so `a/../../b` cannot slip past a substring test.
 * 2. **Resolved containment.** The base directory and the resolved target are both put through
 *    `realpath` where they exist, and the target must still sit under the base afterwards. This is
 *    what catches a SYMLINK: a name that is perfectly innocent while pointing at a link that leaves.
 * 3. **Atomic publish.** Content goes to a temporary file in the same directory and is then renamed.
 *    A reader never sees half a file, and a crash leaves the previous state rather than a truncated
 *    artifact that looks complete.
 *
 * ### No overwrite, by default
 *
 * A pilot run that silently replaced the previous run's evidence would destroy the comparison the
 * pilot exists to make. Overwriting is possible, but only when the caller says so in as many words.
 *
 * ### Digest-bound
 *
 * Every write returns the SHA-256 of the exact bytes written, so a manifest can bind to what is on
 * disk rather than to what the writer intended to put there.
 */
import { mkdir, realpath, rename, stat, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve, sep } from 'node:path';

import { RiyaSyntheticPilotError } from '../contracts/pilot-errors.js';
import { sha256Hex } from '../internal/digest.js';

export interface RiyaSyntheticArtifactWriteResultV1 {
  /** The name as requested, relative to the base. Never an absolute path — that could name a home. */
  readonly name: string;
  readonly bytes: number;
  readonly sha256: string;
}

export interface CreateArtifactWriterOptions {
  /** The one directory this writer may write into. Explicit — there is no default and no cwd guess. */
  readonly baseDirectory: string;
  /** Off unless the caller says otherwise, so a re-run cannot erase the run it is compared against. */
  readonly allowOverwrite?: boolean;
}

export interface RiyaSyntheticArtifactWriter {
  readonly write: (name: string, contents: string) => Promise<RiyaSyntheticArtifactWriteResultV1>;
  readonly baseDirectory: string;
}

/** Segment-wise validation. A substring check on the whole name is exactly what `a/../../b` defeats. */
function assertSafeName(name: string): void {
  if (name.length === 0 || name.length > 200) {
    throw new RiyaSyntheticPilotError('artifact-path-escape');
  }
  if (
    isAbsolute(name) ||
    /^[A-Za-z]:/u.test(name) ||
    name.startsWith('/') ||
    name.startsWith('\\')
  ) {
    throw new RiyaSyntheticPilotError('artifact-path-escape');
  }
  const segments = name.split(/[/\\]/u);
  for (const segment of segments) {
    if (segment === '' || segment === '.' || segment === '..') {
      throw new RiyaSyntheticPilotError('artifact-path-escape');
    }
    // Conservative on purpose. A false positive costs a rename; a false negative writes outside the
    // directory somebody thought they had confined this to.
    if (!/^[A-Za-z0-9._-]+$/u.test(segment)) {
      throw new RiyaSyntheticPilotError('artifact-path-escape');
    }
  }
}

/** The real path of `path` when it exists, and `path` itself when it does not. */
async function realpathIfPresent(path: string): Promise<string> {
  try {
    return await realpath(path);
  } catch {
    return path;
  }
}

/** True when `candidate` is `base` itself or sits underneath it. String compare, on resolved paths. */
function containedBy(base: string, candidate: string): boolean {
  const normalisedBase = base.endsWith(sep) ? base.slice(0, -sep.length) : base;
  return candidate === normalisedBase || candidate.startsWith(normalisedBase + sep);
}

export function createRiyaSyntheticArtifactWriter(
  options: CreateArtifactWriterOptions,
): RiyaSyntheticArtifactWriter {
  const baseDirectory = resolve(options.baseDirectory);
  const allowOverwrite = options.allowOverwrite === true;

  return {
    baseDirectory,

    async write(name: string, contents: string): Promise<RiyaSyntheticArtifactWriteResultV1> {
      assertSafeName(name);

      const target = resolve(baseDirectory, name);
      if (!containedBy(baseDirectory, target)) {
        throw new RiyaSyntheticPilotError('artifact-path-escape');
      }

      const parent = dirname(target);
      await mkdir(parent, { recursive: true });

      // The SYMLINK check, and it has to happen after mkdir: the directory that matters is the one
      // that now exists, and a link planted at any level of it resolves only once it is real.
      const realBase = await realpathIfPresent(baseDirectory);
      const realParent = await realpathIfPresent(parent);
      if (!containedBy(realBase, realParent)) {
        throw new RiyaSyntheticPilotError('artifact-path-escape');
      }

      if (!allowOverwrite) {
        try {
          await stat(target);
          throw new RiyaSyntheticPilotError('artifact-already-exists');
        } catch (error) {
          // ENOENT is the expected, good case. Anything else -- including the refusal just thrown --
          // is re-raised: a stat that failed for a reason other than absence has not proved absence.
          if (error instanceof RiyaSyntheticPilotError) throw error;
          const code = (error as { code?: unknown }).code;
          if (code !== 'ENOENT') throw error;
        }
      }

      const sha256 = sha256Hex(contents);
      // The temporary name carries the digest, so two concurrent writers of different content cannot
      // collide on it, and a leftover temp file says what it was.
      const temporary = join(parent, `.${sha256.slice(0, 16)}.tmp`);
      await writeFile(temporary, contents, 'utf8');
      await rename(temporary, target);

      return Object.freeze({
        name,
        bytes: Buffer.byteLength(contents, 'utf8'),
        sha256,
      });
    },
  };
}
