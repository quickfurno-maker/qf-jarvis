/**
 * The local pilot artifact writer (AS3A, ADR-0143 §15, §24).
 *
 * Everything runs inside a throwaway directory under the system temp dir. Nothing here writes into
 * the repository tree — a transient file in a package's `src` is the repo-wide ENOENT race the
 * containment suites were repaired for, and re-introducing one to test a writer would be a poor
 * trade.
 */
import { mkdir, mkdtemp, readFile, readdir, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { RiyaSyntheticPilotError } from '../contracts/pilot-errors.js';
import { createRiyaSyntheticArtifactWriter } from '../service/artifact-writer.js';
import { sha256Hex } from '../internal/digest.js';

const created: string[] = [];

async function scratch(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'qfj-as3a-artifacts-'));
  created.push(directory);
  return directory;
}

afterEach(async () => {
  const { rm } = await import('node:fs/promises');
  for (const directory of created.splice(0)) {
    await rm(directory, { recursive: true, force: true });
  }
});

describe('the writer publishes atomically and binds to a digest', () => {
  it('writes the file and returns the digest of the exact bytes', async () => {
    const base = await scratch();
    const writer = createRiyaSyntheticArtifactWriter({ baseDirectory: base });

    const result = await writer.write('run-manifest.json', '{"planRef":"p"}');

    expect(result.name).toBe('run-manifest.json');
    expect(result.sha256).toBe(sha256Hex('{"planRef":"p"}'));
    expect(await readFile(join(base, 'run-manifest.json'), 'utf8')).toBe('{"planRef":"p"}');
  });

  it('leaves no temporary file behind', async () => {
    const base = await scratch();
    const writer = createRiyaSyntheticArtifactWriter({ baseDirectory: base });

    await writer.write('a.json', '{}');

    // Content goes to a temp name in the same directory and is then renamed, so a reader never sees
    // half a file. A leftover temp would mean the rename did not happen.
    expect(await readdir(base)).toStrictEqual(['a.json']);
  });

  it('creates nested directories under the base', async () => {
    const base = await scratch();
    const writer = createRiyaSyntheticArtifactWriter({ baseDirectory: base });

    await writer.write('reports/acceptance-report.json', '{}');

    expect(await readFile(join(base, 'reports', 'acceptance-report.json'), 'utf8')).toBe('{}');
  });
});

describe('the writer refuses to overwrite unless asked in as many words', () => {
  it('refuses a second write to the same name', async () => {
    // A pilot run that silently replaced the previous run's evidence would destroy the comparison the
    // pilot exists to make.
    const base = await scratch();
    const writer = createRiyaSyntheticArtifactWriter({ baseDirectory: base });
    await writer.write('a.json', '{"first":true}');

    await expect(writer.write('a.json', '{"second":true}')).rejects.toThrow(
      RiyaSyntheticPilotError,
    );
    expect(await readFile(join(base, 'a.json'), 'utf8')).toBe('{"first":true}');
  });

  it('overwrites when the caller opted in', async () => {
    const base = await scratch();
    const writer = createRiyaSyntheticArtifactWriter({ baseDirectory: base, allowOverwrite: true });
    await writer.write('a.json', '{"first":true}');

    await writer.write('a.json', '{"second":true}');

    expect(await readFile(join(base, 'a.json'), 'utf8')).toBe('{"second":true}');
  });
});

describe('the writer cannot be walked out of its base directory', () => {
  it.each([
    ['a parent segment', '../escape.json'],
    ['a nested parent segment', 'reports/../../escape.json'],
    ['a disguised parent segment', 'a/../../b.json'],
    ['a leading separator', '/escape.json'],
    ['a windows drive', 'C:/escape.json'],
    ['a backslash parent', '..\\escape.json'],
    ['a current-directory segment', './a.json'],
    ['an empty name', ''],
    ['a name with a separator only', '/'],
  ])('refuses %s', async (_label, name) => {
    const base = await scratch();
    const writer = createRiyaSyntheticArtifactWriter({ baseDirectory: base });

    await expect(writer.write(name, '{}')).rejects.toThrow(RiyaSyntheticPilotError);
  });

  it('refuses a name whose segment is not a plain artifact name', async () => {
    const base = await scratch();
    const writer = createRiyaSyntheticArtifactWriter({ baseDirectory: base });

    // Conservative: a false positive costs a rename, a false negative writes somewhere else.
    await expect(writer.write('a*.json', '{}')).rejects.toThrow(RiyaSyntheticPilotError);
    await expect(writer.write('a b.json', '{}')).rejects.toThrow(RiyaSyntheticPilotError);
  });

  it('refuses a write through a SYMLINKED directory that leaves the base', async () => {
    // The one a name check cannot catch: the name is innocent and the link is what escapes. This is
    // why containment is re-checked on the RESOLVED parent, after the directory exists.
    const base = await scratch();
    const outside = await scratch();
    await mkdir(join(outside, 'target'), { recursive: true });
    try {
      await symlink(join(outside, 'target'), join(base, 'reports'), 'dir');
    } catch {
      // Windows without developer mode refuses symlink creation for an unprivileged process. The
      // defence is still in the writer; this environment simply cannot stage the attack.
      return;
    }

    const writer = createRiyaSyntheticArtifactWriter({ baseDirectory: base });

    await expect(writer.write('reports/leak.json', '{}')).rejects.toThrow(RiyaSyntheticPilotError);
  });

  it('re-raises a stat failure that is not absence', async () => {
    // ENOENT is the good case. Anything else has not PROVED absence, and treating it as absence is
    // how an overwrite guard quietly stops guarding.
    const base = await scratch();
    await writeFile(join(base, 'occupied'), 'x', 'utf8');
    const writer = createRiyaSyntheticArtifactWriter({ baseDirectory: base });

    // `occupied` is a file, so using it as a directory fails with something other than ENOENT.
    await expect(writer.write('occupied/child.json', '{}')).rejects.toThrow();
  });
});
