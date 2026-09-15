/**
 * The declared executable EXISTS — as source, and as the file the manifest points at.
 *
 * ### Why this spec is not paranoid
 *
 * It is the spec the previous lane needed and did not have. `@qf-jarvis/jarvis-v1-provider-certification-live`
 * declared `"bin": { "qfj-jf5b-certify": "./dist/cli/bin.js" }` while `src/cli/` contained only
 * `preflight.ts`. Nothing was wrong with the code that existed; what was wrong was that a manifest
 * claimed an executable, a report repeated the claim, and no check could tell the difference between
 * a bin that runs and a bin that is a string in a JSON file.
 *
 * So the rule is: every declared bin maps to a real emitted file, and that file maps back to a real
 * source file. Both directions, because either one alone can drift.
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const APP_DIR = fileURLToPath(new URL('../../', import.meta.url));
const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));

const manifest = JSON.parse(readFileSync(join(APP_DIR, 'package.json'), 'utf8')) as {
  bin?: Record<string, string>;
};

describe('every declared bin is a real file, in both directions', () => {
  it('each bin path points at an emitted file, and at a source file that produced it', () => {
    const bins = Object.entries(manifest.bin ?? {});
    expect(bins.length).toBeGreaterThan(0);
    for (const [name, relative] of bins) {
      // The emitted file. `pnpm run build` must have produced it; a bin that only exists after a
      // manual step is a bin that does not exist on a fresh checkout.
      const emitted = join(APP_DIR, relative);
      expect({ name, emitted: existsSync(emitted) }).toEqual({ name, emitted: true });
      expect({ name, empty: statSync(emitted).size === 0 }).toEqual({ name, empty: false });

      // And back: the source that produced it, derived from the declared path rather than guessed.
      const source = join(
        APP_DIR,
        relative.replace(/^\.\/dist\//u, 'src/').replace(/\.js$/u, '.ts'),
      );
      expect({ name, source: existsSync(source) }).toEqual({ name, source: true });
    }
  });

  it('the JF-5B certification bin is among them, and starts nothing on import', () => {
    expect(manifest.bin?.['qfj-jf5b-certify']).toBe('./dist/bin/run-jf5b-live-certification.js');
    const source = readFileSync(join(APP_DIR, 'src/bin/run-jf5b-live-certification.ts'), 'utf8');
    // A process boundary and nothing more: parse argv, compose, run, set an exit code.
    expect(source).toContain('process.argv.slice(2)');
    expect(source).toContain('process.exitCode');
    // It binds no socket, starts no server and opens no database.
    for (const forbidden of ['listen(', 'createServer', 'Pool(', 'setInterval']) {
      expect({ forbidden, present: source.includes(forbidden) }).toEqual({
        forbidden,
        present: false,
      });
    }
  });

  it('the evaluation-only harness declares NO bin of its own', () => {
    // Option A, recorded as a check rather than as a sentence. The harness cannot reach Mastra or the
    // Jarvis runtime by design, so an executable there could never drive a governed turn — which is
    // exactly what the removed declaration promised it would.
    const harness = JSON.parse(
      readFileSync(
        join(REPO_ROOT, 'packages/jarvis-v1-provider-certification-live/package.json'),
        'utf8',
      ),
    ) as { bin?: unknown };
    expect(harness.bin).toBeUndefined();
  });
});
