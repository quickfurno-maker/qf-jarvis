/**
 * Stage 3.4.5B (F1 correction) — apps/worker is the direct Node production entry.
 *
 * Proves the worker application activates the projection worker IN-PROCESS by importing the internal
 * composition root — no `pnpm`/package-manager delegation — so signals reach the Node process that owns
 * the AbortController and pool. These tests use injected lifecycle seams and never start a real worker.
 */
import { readFileSync } from 'node:fs';

import { describe, expect, it, vi } from 'vitest';

import * as eventBackbone from '@qf-jarvis/event-backbone';
import type { ProjectionWorkerCliDeps } from '@qf-jarvis/event-backbone/internal/projection-worker-cli';

import { runWorkerEntry } from '../worker-entry.js';

/** A benign, fully-injected deps object; `runWorker` is overridden per test. Cast once at the boundary. */
function fakeDeps(overrides: Partial<ProjectionWorkerCliDeps> = {}): ProjectionWorkerCliDeps {
  const base = {
    resolveConfig: () => Promise.resolve({}),
    createPool: () => ({}),
    closePool: () => Promise.resolve(),
    buildRegistry: () => ({ list: () => [], get: () => undefined, has: () => false, size: 0 }),
    runWorker: () => Promise.resolve({ cycles: 0, succeeded: 0, stoppedBy: 'max-cycles' }),
    now: () => '2026-07-20T00:00:00.000Z',
    registerShutdownSignals: () => () => undefined,
    writeOut: () => undefined,
    writeErr: () => undefined,
    // QFJ-P03.07G seams. The schema probe reports a complete schema so these entry tests keep
    // exercising the invocation path itself; the startup gate has its own coverage.
    probeSchema: () => Promise.resolve(true),
    createLogger: () => ({ projectionEvent: () => undefined, workerEvent: () => undefined }),
    metrics: {
      increment: () => undefined,
      setGauge: () => undefined,
      replaceGauge: () => undefined,
      observe: () => undefined,
      snapshot: () => [],
      rejectedSamples: () => 0,
      reset: () => undefined,
    },
  } as unknown as ProjectionWorkerCliDeps;
  return { ...base, ...overrides };
}

function readWorkerManifest(): { readonly scripts: Record<string, string> } {
  const raw = readFileSync(new URL('../../package.json', import.meta.url), 'utf8');
  return JSON.parse(raw) as { readonly scripts: Record<string, string> };
}

describe('apps/worker direct entry — invokes the internal worker CLI in-process', () => {
  it('imports and explicitly invokes the internal worker entry, returning its exit code (success)', async () => {
    const runWorker = vi.fn(() =>
      Promise.resolve({ cycles: 1, succeeded: 0, stoppedBy: 'max-cycles' }),
    ) as unknown as ProjectionWorkerCliDeps['runWorker'];
    const code = await runWorkerEntry(fakeDeps({ runWorker }));
    expect(code).toBe(0);
    expect(runWorker).toHaveBeenCalledTimes(1); // the entry reached runProjectionWorkerCli → the worker
  });

  it('propagates a non-zero exit code on failure', async () => {
    const runWorker = vi.fn(() =>
      Promise.reject(new Error('boom')),
    ) as unknown as ProjectionWorkerCliDeps['runWorker'];
    const code = await runWorkerEntry(fakeDeps({ runWorker }));
    expect(code).toBe(1);
  });

  it('is opt-in: importing this module does not auto-run the worker', () => {
    // Reaching this line at all proves import had no side effect: if importing worker-entry started the
    // worker it would call the REAL default seams (reading DATABASE_URL and opening a pool), which would
    // fail or hang the suite. runWorkerEntry must be called explicitly.
    expect(runWorkerEntry).toBeTypeOf('function');
  });
});

describe('apps/worker production start command — direct Node, no package-manager delegation', () => {
  it('start is exactly `node ./dist/index.js`', () => {
    const { scripts } = readWorkerManifest();
    expect(scripts['start']).toBe('node ./dist/index.js');
  });

  it('start interposes no pnpm/package-manager wrapper (no signal-forwarding hop)', () => {
    const scripts = JSON.stringify(readWorkerManifest().scripts);
    expect(scripts).not.toContain('pnpm');
    expect(scripts).not.toContain('--filter');
    expect(scripts).not.toContain('worker:start');
  });
});

describe('apps/worker consumer view — event-backbone root surface stays 39', () => {
  it('sees exactly 39 runtime exports from the @qf-jarvis/event-backbone root', () => {
    expect(Object.keys(eventBackbone)).toHaveLength(39);
  });
});
