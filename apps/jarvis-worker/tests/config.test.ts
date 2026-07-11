import { describe, expect, it } from 'vitest';
import { loadWorkerConfig } from '../src/config/index.js';

describe('loadWorkerConfig', () => {
  it('parses valid values', () => {
    expect(loadWorkerConfig({ NODE_ENV: 'test', LOG_LEVEL: 'debug' })).toEqual({
      nodeEnv: 'test',
      logLevel: 'debug',
      isProduction: false,
    });
  });

  it('applies safe defaults when values are absent', () => {
    const config = loadWorkerConfig({});
    expect(config.nodeEnv).toBe('development');
    expect(config.logLevel).toBe('info');
    expect(config.isProduction).toBe(false);
  });

  it('rejects an unknown NODE_ENV with a readable error', () => {
    expect(() => loadWorkerConfig({ NODE_ENV: 'staging' })).toThrowError(
      /environment configuration/i,
    );
  });

  it('rejects an unknown LOG_LEVEL', () => {
    expect(() => loadWorkerConfig({ LOG_LEVEL: 'loud' })).toThrow();
  });

  it('flags production mode', () => {
    expect(loadWorkerConfig({ NODE_ENV: 'production' }).isProduction).toBe(true);
  });
});
