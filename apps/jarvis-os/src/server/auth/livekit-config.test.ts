import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { loadLiveKitOperatorConfig } from './config/loader';

const dirs: string[] = [];

function configFile(value: unknown, mode = 0o600): string {
  const dir = mkdtempSync(join(tmpdir(), 'qfj-livekit-'));
  dirs.push(dir);
  const path = join(dir, 'livekit.json');
  writeFileSync(path, JSON.stringify(value), { mode });
  return path;
}

const VALID = Object.freeze({
  protocol: 'qfj.jarvis-os.livekit.v1',
  serverUrl: 'wss://example.livekit.cloud',
  apiKey: 'test-api-key-placeholder',
  apiSecret: 'test-api-secret-placeholder-only',
  agentName: 'qfj-jarvis-operator-voice',
});

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('LiveKit operator configuration boundary', () => {
  it('accepts a bounded private file with a secure websocket endpoint', () => {
    const parsed = loadLiveKitOperatorConfig({
      path: configFile(VALID),
      platform: process.platform,
    });
    expect(parsed.protocol).toBe('qfj.jarvis-os.livekit.v1');
    expect(parsed.serverUrl).toBe('wss://example.livekit.cloud');
    expect(parsed.agentName).toBe('qfj-jarvis-operator-voice');
  });

  it('fails closed for plaintext signalling and overly open POSIX permissions', () => {
    expect(() =>
      loadLiveKitOperatorConfig({
        path: configFile({ ...VALID, serverUrl: 'https://example.livekit.cloud' }),
        platform: process.platform,
      }),
    ).toThrow();

    expect(() =>
      loadLiveKitOperatorConfig({
        path: configFile({ ...VALID, serverUrl: 'wss://voice.example.com' }),
        platform: process.platform,
      }),
    ).toThrow();

    if (process.platform !== 'win32') {
      expect(() =>
        loadLiveKitOperatorConfig({
          path: configFile(VALID, 0o644),
          platform: process.platform,
        }),
      ).toThrow();
    }
  });
});
