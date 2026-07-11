import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config/index.js';

const validEnv = {
  NODE_ENV: 'test',
  LOG_LEVEL: 'info',
  JARVIS_API_HOST: '127.0.0.1',
  JARVIS_API_PORT: '8080',
} satisfies NodeJS.ProcessEnv;

describe('loadConfig', () => {
  it('parses a fully specified, valid environment', () => {
    expect(loadConfig(validEnv)).toEqual({
      nodeEnv: 'test',
      logLevel: 'info',
      host: '127.0.0.1',
      port: 8080,
      isProduction: false,
    });
  });

  it('applies safe development defaults when values are absent', () => {
    const config = loadConfig({});

    expect(config).toEqual({
      nodeEnv: 'development',
      logLevel: 'info',
      host: '127.0.0.1',
      port: 3000,
      isProduction: false,
    });
  });

  it('coerces the port from a string to a number', () => {
    expect(loadConfig({ ...validEnv, JARVIS_API_PORT: '3001' }).port).toBe(3001);
  });

  it('rejects a non-numeric port with a readable error', () => {
    expect(() => loadConfig({ ...validEnv, JARVIS_API_PORT: 'not-a-number' })).toThrowError(
      /environment configuration/i,
    );
  });

  it('rejects an out-of-range port', () => {
    expect(() => loadConfig({ ...validEnv, JARVIS_API_PORT: '70000' })).toThrow();
  });

  it('rejects an unknown log level', () => {
    expect(() => loadConfig({ ...validEnv, LOG_LEVEL: 'chatty' })).toThrow();
  });

  it('rejects an unknown NODE_ENV', () => {
    expect(() => loadConfig({ ...validEnv, NODE_ENV: 'staging' })).toThrow();
  });

  it('flags production mode', () => {
    expect(loadConfig({ ...validEnv, NODE_ENV: 'production' }).isProduction).toBe(true);
  });
});
