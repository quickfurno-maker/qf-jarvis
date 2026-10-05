import { describe, expect, it } from 'vitest';

import { QfjIsolationFailure, QfjIsolationGate } from '../index.js';

describe('QFJ cross-system isolation', () => {
  it('admits only the configured concurrency and queues nothing', async () => {
    const gate = new QfjIsolationGate({
      maxConcurrent: 2,
      breakerFailureThreshold: 10,
      breakerOpenMs: 1_000,
    });
    const releases: (() => void)[] = [];
    let active = 0;
    let maxActive = 0;

    const task = async (signal: AbortSignal): Promise<string> =>
      await new Promise<string>((resolve, reject) => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        let settled = false;
        const finish = (fn: () => void): void => {
          if (settled) return;
          settled = true;
          active -= 1;
          fn();
        };
        releases.push(() => {
          finish(() => {
            resolve('ok');
          });
        });
        signal.addEventListener(
          'abort',
          () => {
            finish(() => {
              reject(new Error('aborted'));
            });
          },
          { once: true },
        );
      });

    const deadlineAt = new Date(Date.now() + 1_000).toISOString();
    const first = gate.run({ deadlineAt, task });
    const second = gate.run({ deadlineAt, task });
    await expect(gate.run({ deadlineAt, task })).rejects.toMatchObject({
      errorClass: 'QFJ_BACKPRESSURE',
      retryable: true,
    });
    expect(releases).toHaveLength(2);
    expect(maxActive).toBe(2);
    releases.splice(0).forEach((release) => {
      release();
    });
    await expect(Promise.all([first, second])).resolves.toEqual(['ok', 'ok']);
  });

  it('opens after bounded retryable failures and then fails fast', async () => {
    const gate = new QfjIsolationGate({
      maxConcurrent: 8,
      breakerFailureThreshold: 2,
      breakerOpenMs: 10_000,
    });
    let calls = 0;
    const task = (): Promise<never> => {
      calls += 1;
      return Promise.reject(new Error('down'));
    };
    const deadline = (): string => new Date(Date.now() + 500).toISOString();

    await expect(gate.run({ deadlineAt: deadline(), task })).rejects.toBeInstanceOf(
      QfjIsolationFailure,
    );
    await expect(gate.run({ deadlineAt: deadline(), task })).rejects.toBeInstanceOf(
      QfjIsolationFailure,
    );
    await expect(gate.run({ deadlineAt: deadline(), task })).rejects.toMatchObject({
      errorClass: 'QFJ_CIRCUIT_OPEN',
    });
    expect(calls).toBe(2);
  });

  it('converts a slow upstream into a bounded retryable timeout', async () => {
    const gate = new QfjIsolationGate({
      maxConcurrent: 1,
      breakerFailureThreshold: 10,
      breakerOpenMs: 1_000,
    });
    const task = async (signal: AbortSignal): Promise<string> =>
      await new Promise<string>((resolve, reject) => {
        const timer = setTimeout(() => {
          resolve('too-late');
        }, 1_000);
        signal.addEventListener(
          'abort',
          () => {
            clearTimeout(timer);
            reject(new Error('aborted'));
          },
          { once: true },
        );
      });

    await expect(
      gate.run({ deadlineAt: new Date(Date.now() + 100).toISOString(), task }),
    ).rejects.toMatchObject({
      errorClass: 'QFJ_UPSTREAM_TIMEOUT',
      retryable: true,
    });
  });
});
