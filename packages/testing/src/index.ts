import { Writable } from 'node:stream';

/**
 * @qf/testing — deliberately minimal for Phase 0A.
 *
 * It currently provides a single helper that more than one package genuinely
 * needs, rather than a speculative test framework. As real cross-cutting test
 * needs appear in later phases (fixtures, fake clocks, event builders), they
 * belong here so they are written once.
 */

export interface LogCapture {
  /** A writable stream to hand to `createLogger(config, stream)`. */
  readonly stream: Writable;
  /** Parse everything written so far into one object per JSON log line. */
  records(): Array<Record<string, unknown>>;
}

/**
 * Capture structured (line-delimited JSON) log output in memory.
 *
 * This makes logger-dependent behaviour assertable deterministically — no real
 * stdout, no files, no timers. Used by the observability, API, and worker test
 * suites.
 */
export function createLogCapture(): LogCapture {
  const chunks: string[] = [];

  const stream = new Writable({
    write(
      chunk: Buffer | string,
      _encoding: BufferEncoding,
      callback: (error?: Error | null) => void,
    ): void {
      chunks.push(typeof chunk === 'string' ? chunk : chunk.toString('utf8'));
      callback();
    },
  });

  return {
    stream,
    records(): Array<Record<string, unknown>> {
      return chunks
        .join('')
        .split('\n')
        .filter((line) => line.length > 0)
        .map((line) => JSON.parse(line) as Record<string, unknown>);
    },
  };
}
