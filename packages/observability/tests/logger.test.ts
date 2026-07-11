import { describe, expect, it } from 'vitest';
import { createLogCapture } from '@qf/testing';
import { createLogger, REDACTION_CENSOR } from '../src/index.js';

describe('createLogger', () => {
  it('defaults to the info level when none is provided', () => {
    const logger = createLogger({ service: 'svc', environment: 'test' });
    expect(logger.level).toBe('info');
  });

  it('honours an explicit level', () => {
    const logger = createLogger({ service: 'svc', environment: 'test', level: 'debug' });
    expect(logger.level).toBe('debug');
  });

  it('attaches service and environment to every record', () => {
    const capture = createLogCapture();
    const logger = createLogger({ service: 'qf-jarvis-api', environment: 'test' }, capture.stream);

    logger.info('startup');

    const [record] = capture.records();
    expect(record).toMatchObject({
      service: 'qf-jarvis-api',
      environment: 'test',
      level: 'info',
      msg: 'startup',
    });
  });

  it('emits the level as a name, not a numeric code', () => {
    const capture = createLogCapture();
    const logger = createLogger({ service: 'svc', environment: 'test' }, capture.stream);

    logger.warn('careful');

    expect(capture.records()[0]?.level).toBe('warn');
  });

  it('does not emit records below the configured level', () => {
    const capture = createLogCapture();
    const logger = createLogger(
      { service: 'svc', environment: 'test', level: 'warn' },
      capture.stream,
    );

    logger.info('suppressed');
    logger.warn('kept');

    const all = capture.records();
    expect(all).toHaveLength(1);
    expect(all[0]?.msg).toBe('kept');
  });

  it('redacts sensitive keys at the top level and one level deep', () => {
    const capture = createLogCapture();
    const logger = createLogger({ service: 'svc', environment: 'test' }, capture.stream);

    logger.info({ password: 'hunter2', db: { token: 'abc123' }, safe: 'visible' }, 'login');

    const record = capture.records()[0];
    expect(record?.password).toBe(REDACTION_CENSOR);
    expect((record?.db as Record<string, unknown>).token).toBe(REDACTION_CENSOR);
    expect(record?.safe).toBe('visible');
  });

  it('supports child loggers that inherit base fields', () => {
    const capture = createLogCapture();
    const logger = createLogger({ service: 'svc', environment: 'test' }, capture.stream);

    const child = logger.child({ component: 'health' });
    child.info('ready');

    const record = capture.records()[0];
    expect(record).toMatchObject({ service: 'svc', component: 'health', msg: 'ready' });
  });

  it('serializes errors safely without throwing', () => {
    const capture = createLogCapture();
    const logger = createLogger({ service: 'svc', environment: 'test' }, capture.stream);

    logger.error({ err: new Error('boom') }, 'failure');

    const err = capture.records()[0]?.err as Record<string, unknown>;
    expect(err.type).toBe('Error');
    expect(err.message).toBe('boom');
    expect(typeof err.stack).toBe('string');
  });
});
