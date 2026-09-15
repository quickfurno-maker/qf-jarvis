/**
 * The JF-5B pacing sleeper must hold the event loop open (JF-5B-R7).
 *
 * ### The defect this closes, and why nothing caught it
 *
 * Run-9 reached phase 3 at exact head `52b4dbc` and the process died at the first pacing wait:
 *
 * ```
 * Warning: Detected unsettled top-level await at
 *   .../apps/api/dist/bin/run-jf5b-live-certification.js:13
 * const outcome = await runJf5bLiveCertificationCli(...)
 * ```
 *
 * No phase-3 certification evidence was produced. Not a provider failure, not a rate limit, not the
 * matcher and not routing: the real pacing sleeper called `timer.unref()`, and `unref` tells Node that
 * a timer must not keep the process alive. That is correct for a timer NOBODY awaits — the discovery
 * abort deadline in this same file, the spend gate in `riya-ai-synthetic-provider-adapters` — and it is
 * exactly wrong for a timer whose firing resolves the promise a top-level `await` is suspended on. Node
 * saw an event loop with nothing referenced in it, concluded the program had finished, and exited.
 *
 * Every JF-5B-R6 pacing spec passed, because every one of them injects a fake sleeper that returns
 * `Promise.resolve()`. A microtask resolves whether or not the loop has anything in it, so no existing
 * test could observe liveness at all. That is the gap this file fills.
 *
 * ### How this tests the real thing without widening any API
 *
 * `apps/api` exports nothing from its package root and the sleeper is an inline seam inside
 * `createDefaultJf5bCliDeps`, which needs a real terminal, network and filesystem. So rather than
 * export a helper nobody else should hold, these specs take the sleeper's OWN BYTES out of the
 * production source, run them in a real child `node` process under a real top-level `await`, and watch
 * what the process does. The bytes under test are the shipped bytes.
 *
 * A negative control re-inserts `.unref()` and asserts the harness then FAILS, so a green result here
 * means the defect is absent rather than that the test stopped looking.
 *
 * Cost: about a tenth of a second. No provider, no network, no credential, no TTY, and no 15-second
 * production delay — the child sleeps for milliseconds, because liveness does not care how long.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const COMPOSITION = fileURLToPath(
  new URL('../composition/jf5b-live-composition.ts', import.meta.url),
);

/** Strip documentation so a scan reads CODE. The same rule the containment suite uses. */
const codeOnly = (text: string): string =>
  text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !/^\s*\/\//.test(line))
    .join('\n');

/**
 * The production sleeper's arrow body, lifted verbatim from the source.
 *
 * Deliberately brittle: if the sleeper is renamed, restructured or moved, this throws and the suite
 * fails loudly rather than quietly testing nothing.
 */
function productionSleeperSource(): string {
  const text = readFileSync(COMPOSITION, 'utf8');
  const opensAt = text.indexOf('sleep: (ms: number): Promise<void> =>');
  if (opensAt === -1) {
    throw new Error('the JF-5B pacing sleeper is no longer where this spec reads it');
  }
  const body = text.slice(text.indexOf('=>', opensAt) + 2);
  const closesAt = body.indexOf('}),');
  if (closesAt === -1) {
    throw new Error('the JF-5B pacing sleeper has no recognisable arrow body');
  }
  // `(ms: number): Promise<void>` is the only annotation in the extracted region; dropping it makes
  // the bytes plain ESM without changing a single statement.
  return body.slice(0, closesAt + 2).trim();
}

interface ChildResult {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

/**
 * Run the given sleeper source under a REAL top-level `await` in a REAL node process.
 *
 * The child is the smallest possible model of `apps/api/dist/bin/run-jf5b-live-certification.js`: a
 * module whose last act depends on an awaited pacing delay. It prints its sentinel only after the sleep
 * resolves, and reports how long the sleep actually took.
 */
function runUnderTopLevelAwait(sleeperSource: string, requestedMs: number): ChildResult {
  const dir = mkdtempSync(join(tmpdir(), 'jf5b-liveness-'));
  try {
    const module = join(dir, 'liveness.mjs');
    writeFileSync(
      module,
      [
        `const sleep = (ms) => ${sleeperSource};`,
        'const started = Date.now();',
        `await sleep(${String(requestedMs)});`,
        "process.stdout.write('SENTINEL:' + String(Date.now() - started));",
        '',
      ].join('\n'),
      'utf8',
    );
    const child = spawnSync(process.execPath, [module], {
      encoding: 'utf8',
      timeout: 30_000,
      windowsHide: true,
    });
    return { status: child.status, stdout: child.stdout, stderr: child.stderr };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const elapsedMs = (stdout: string): number => Number(/^SENTINEL:(\d+)$/u.exec(stdout)?.[1] ?? '-1');

describe('JF-5B-R7 the pacing sleeper keeps the process alive while it paces', () => {
  it('resolves under a top-level await, and the process exits 0 having printed the sentinel', () => {
    const child = runUnderTopLevelAwait(productionSleeperSource(), 40);
    expect({
      status: child.status,
      sentinel: child.stdout.startsWith('SENTINEL:'),
      unsettled: child.stderr.includes('unsettled top-level await'),
    }).toEqual({ status: 0, sentinel: true, unsettled: false });
  });

  it('actually waits the delay it was asked for, rather than resolving immediately', () => {
    // A sleeper that resolved on a microtask would satisfy liveness and pace nothing. Timers may fire a
    // hair early, so the bound is just under the request rather than exactly it.
    const child = runUnderTopLevelAwait(productionSleeperSource(), 120);
    expect(elapsedMs(child.stdout)).toBeGreaterThanOrEqual(110);
  });

  it('arms exactly ONE timer per sleep, and never a repeating one', () => {
    const source = productionSleeperSource();
    expect(source.match(/setTimeout/gu)).toHaveLength(1);
    expect(source.match(/clearTimeout/gu)).toHaveLength(1);
    expect(source).not.toMatch(/setInterval|setImmediate|refresh\s*\(\s*\)/u);
  });

  it('NEGATIVE CONTROL: re-inserting `.unref()` makes this very harness fail', () => {
    // Without this, a harness that silently stopped exercising liveness would still report green. The
    // reinstated defect must reproduce run-9 exactly: no sentinel, and Node's own warning.
    const broken = productionSleeperSource().replace(
      '}, ms);',
      '}, ms);\n            timer.unref();',
    );
    expect(broken).toContain('timer.unref();');
    const child = runUnderTopLevelAwait(broken, 120);
    expect({
      sentinel: child.stdout.startsWith('SENTINEL:'),
      unsettled: child.stderr.includes('unsettled top-level await'),
    }).toEqual({ sentinel: false, unsettled: true });
  });
});

describe('JF-5B-R7 the source lock on the pacing timer', () => {
  it('the JF-5B composition unrefs no timer at all', () => {
    // Scoped deliberately, and NOT a repository-wide ban: `groq-staging-smoke/run-once.ts` and the Riya
    // spend gate both unref on purpose, and a spec there says so. The rule is about what a timer means,
    // not about the call. A timer nobody awaits must not hold a finished process open; a timer that
    // resolves an awaited promise must not pretend the process is finished.
    expect(codeOnly(readFileSync(COMPOSITION, 'utf8'))).not.toContain('.unref(');
  });

  it('carries the invariant in its own words, where the next editor will read it', () => {
    const text = readFileSync(COMPOSITION, 'utf8');
    expect(text).toContain(
      'The real JF-5B pacing timer stays referenced because the awaited pacing delay is part of',
    );
    expect(text).toContain('Tests inject fake sleepers, so CI does not wait.');
  });
});
