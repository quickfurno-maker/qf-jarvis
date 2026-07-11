import { describe, expect, it } from 'vitest';
import { createLogger } from '@qf/observability';
import { createLogCapture, type LogCapture } from '@qf/testing';
import { startWorker } from '../src/index.js';
import type { WorkerConfig } from '../src/config/index.js';

const TEST_CONFIG: WorkerConfig = {
  nodeEnv: 'test',
  logLevel: 'info',
  isProduction: false,
};

function makeWorker(): { capture: LogCapture; worker: ReturnType<typeof startWorker> } {
  const capture = createLogCapture();
  const logger = createLogger({ service: 'qf-jarvis-worker', environment: 'test' }, capture.stream);
  return { capture, worker: startWorker({ config: TEST_CONFIG, logger }) };
}

describe('startWorker', () => {
  it('reports running and logs a structured startup event', async () => {
    const { capture, worker } = makeWorker();
    try {
      expect(worker.state()).toBe('running');

      const startup = capture.records().find((r) => r.msg === 'qf-jarvis-worker started');
      expect(startup).toBeDefined();
      expect(startup).toMatchObject({ service: 'qf-jarvis-worker', nodeEnv: 'test' });
      expect((startup?.health as Record<string, unknown>).status).toBe('ok');
    } finally {
      await worker.shutdown('test-cleanup');
    }
  });

  it('shuts down cleanly, reaches the stopped state, and resolves done', async () => {
    const { capture, worker } = makeWorker();

    await worker.shutdown('test');

    expect(worker.state()).toBe('stopped');
    await worker.done;
    expect(capture.records().some((r) => r.msg === 'qf-jarvis-worker stopped cleanly')).toBe(true);
  });

  it('is idempotent across concurrent shutdown calls', async () => {
    const { worker } = makeWorker();

    await Promise.all([worker.shutdown('a'), worker.shutdown('b'), worker.shutdown('c')]);

    expect(worker.state()).toBe('stopped');
  });
});
