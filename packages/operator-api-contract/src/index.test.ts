import { describe, expect, it } from 'vitest';
import {
  OPERATOR_MODULES,
  operatorBootstrapSchema,
  operatorVoiceRpcResponseSchema,
  operatorVoiceSessionSchema,
  parseOperatorCommand,
} from './index.js';

describe('operator api contract', () => {
  it('parses a mobile-safe command without carrying authority', () => {
    const value = parseOperatorCommand({
      protocol: 'qfj.operator.command.v1',
      commandId: '9b52422c-62f7-4e45-a3f4-3cbddfd6bbc6',
      issuedAt: '2026-09-24T12:00:00.000Z',
      idempotencyKey: 'mobile-test-1',
      clientPlatform: 'ANDROID',
      action: 'CONVERSATION_RESUME_AI',
      payload: {
        conversationId: '20ab5d4d-a308-43a6-a301-f8404d625d57',
        expectedRevision: 4,
      },
    });
    expect(value.action).toBe('CONVERSATION_RESUME_AI');
    expect('authorized' in value).toBe(false);
  });

  it('publishes client capability, never business authority', () => {
    const value = operatorBootstrapSchema.parse({
      apiVersion: '1',
      generatedAt: '2026-09-24T12:00:00.000Z',
      client: {
        minimumSnapshotVersion: 2,
        webSession: true,
        mobileDeviceSession: false,
      },
      modules: OPERATOR_MODULES,
      capabilities: [
        {
          action: 'APPROVAL_DECIDE',
          state: 'LOCKED',
          reason: 'Authority bridge is not connected.',
          authority: 'QUICKFURNO_CORE',
        },
      ],
    });
    expect(value.capabilities[0]?.state).toBe('LOCKED');
  });

  it('makes voice intelligence evidence structurally read-only', () => {
    const evidence = operatorVoiceRpcResponseSchema.parse({
      headline: 'Attention needed',
      summary: 'One approval is waiting.',
      facts: ['Approval queue: 1'],
      executionAuthority: 'NONE',
      businessEffect: false,
    });
    expect(evidence.executionAuthority).toBe('NONE');
    expect(evidence.businessEffect).toBe(false);
    expect(() =>
      operatorVoiceRpcResponseSchema.parse({
        ...evidence,
        executionAuthority: 'CORE',
      }),
    ).toThrow();
  });

  it('makes operator voice structurally read-only', () => {
    const value = operatorVoiceSessionSchema.parse({
      protocol: 'qfj.operator.voice.session.v1',
      serverUrl: 'wss://example.livekit.cloud',
      roomName: 'qfj-operator-voice-test',
      participantIdentity: 'operator-test',
      participantToken: 'opaque-token',
      agentName: 'qfj-jarvis-operator-voice',
      expiresInSeconds: 600,
      mode: 'READ_ONLY',
      executionAuthority: 'NONE',
      businessEffect: false,
    });
    expect(value.mode).toBe('READ_ONLY');
    expect(value.executionAuthority).toBe('NONE');
    expect(value.businessEffect).toBe(false);

    expect(() =>
      operatorVoiceSessionSchema.parse({
        ...value,
        businessEffect: true,
      }),
    ).toThrow();
  });
});
