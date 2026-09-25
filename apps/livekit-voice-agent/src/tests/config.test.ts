import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { loadVoiceAgentConfig } from '../config.js';

const dirs: string[] = [];

function configFile(value: unknown, mode = 0o600): string {
  const dir = mkdtempSync(join(tmpdir(), 'qfj-livekit-agent-'));
  dirs.push(dir);
  const path = join(dir, 'voice-agent.json');
  writeFileSync(path, JSON.stringify(value), { mode });
  return path;
}

const VALID = Object.freeze({
  protocol: 'qfj.livekit.operator-voice-agent.v1',
  livekit: {
    wsUrl: 'wss://example.livekit.cloud',
    apiKey: 'test-api-key-placeholder',
    apiSecret: 'test-api-secret-placeholder-only',
    agentName: 'qfj-jarvis-operator-voice',
  },
  inference: {
    sttModel: 'assemblyai/universal-3-5-pro',
    language: 'en',
    llmModel: 'google/gemma-4-31b-it',
    ttsModel: 'fishaudio/s2.1-pro',
    ttsVoice: 'voice-id',
  },
});

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('LiveKit voice-agent configuration boundary', () => {
  it('accepts a private bounded file with secure websocket transport', () => {
    const value = loadVoiceAgentConfig(configFile(VALID));
    expect(value.livekit.wsUrl).toBe('wss://example.livekit.cloud');
    expect(value.livekit.agentName).toBe('qfj-jarvis-operator-voice');
  });

  it('refuses plaintext signalling', () => {
    expect(() =>
      loadVoiceAgentConfig(
        configFile({
          ...VALID,
          livekit: { ...VALID.livekit, wsUrl: 'https://example.livekit.cloud' },
        }),
      ),
    ).toThrow('voice-agent-config-invalid');
  });

  it('refuses group/world-readable POSIX secret files', () => {
    if (process.platform === 'win32') return;
    expect(() => loadVoiceAgentConfig(configFile(VALID, 0o644))).toThrow(
      'voice-agent-config-permissions-too-open',
    );
  });

  it('does not accept unknown configuration fields', () => {
    expect(() => loadVoiceAgentConfig(configFile({ ...VALID, extra: 'nope' }))).toThrow(
      'voice-agent-config-invalid',
    );
  });
});
