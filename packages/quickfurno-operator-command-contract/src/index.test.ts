import { describe, expect, it } from 'vitest';
import { parseQuickFurnoOperatorCommand } from './index.js';

const base = {
  protocol: 'qfj.operator.command.v1',
  commandId: '11111111-1111-4111-8111-111111111111',
  issuedAt: '2026-09-24T12:00:00.000Z',
  idempotencyKey: 'test-command',
  clientPlatform: 'ANDROID',
} as const;

describe('QuickFurno operator command contract', () => {
  it('accepts Core-owned conversation control', () => {
    expect(
      parseQuickFurnoOperatorCommand({
        ...base,
        action: 'CONVERSATION_PAUSE_AI',
        payload: { conversationId: '22222222-2222-4222-8222-222222222222', expectedRevision: 4 },
      }).action,
    ).toBe('CONVERSATION_PAUSE_AI');
  });

  it('refuses Jarvis-governance commands', () => {
    expect(() =>
      parseQuickFurnoOperatorCommand({
        ...base,
        action: 'KNOWLEDGE_SET_MODE',
        payload: { mode: 'HYBRID', expectedRevision: 2 },
      }),
    ).toThrow();
  });
});
