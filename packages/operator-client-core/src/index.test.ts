import { describe, expect, it } from 'vitest';

import { createOperatorClient, type OperatorClientError } from './index.js';

const snapshot = {
  contractVersion: '2',
  generatedAt: '2026-09-24T12:00:00.000Z',
  mode: 'READ_ONLY',
  source: {
    kind: 'REPOSITORY_BASELINE',
    freshness: 'BUILD_DECLARATION',
    liveOperationalData: false,
  },
  authority: {
    jarvis: 'RECOMMENDS_AND_OBSERVES',
    quickfurnoCore: 'AUTHORIZES_AND_OWNS_BUSINESS_TRUTH',
    coreAutomation: 'EXECUTES_ONLY',
    provider: 'DELIVERS_ONLY',
  },
  rollout: { enabled: false, state: 'ROLLOUT_OFF' },
  system: [],
  capabilities: [],
  agents: [],
  roadmap: [],
  sections: {
    headlineMetrics: {
      availability: 'STATIC_BASELINE',
      reason: 'r',
      expectedSource: 's',
      items: [],
    },
    attention: { availability: 'STATIC_BASELINE', reason: 'r', expectedSource: 's', items: [] },
    activity: { availability: 'STATIC_BASELINE', reason: 'r', expectedSource: 's', items: [] },
    approvalQueue: { availability: 'NOT_CONNECTED', reason: 'r', expectedSource: 's', items: [] },
    approvalBreakdown: {
      availability: 'NOT_CONNECTED',
      reason: 'r',
      expectedSource: 's',
      items: [],
    },
    conversationControl: {
      availability: 'NOT_CONNECTED',
      reason: 'r',
      expectedSource: 's',
      items: [],
    },
    conversationActivity: {
      availability: 'NOT_CONNECTED',
      reason: 'r',
      expectedSource: 's',
      id: 'conversation-activity',
      label: 'Conversation activity',
      points: [],
    },
    modelLatency: {
      availability: 'NOT_CONNECTED',
      reason: 'r',
      expectedSource: 's',
      id: 'model-latency',
      label: 'Model latency',
      points: [],
    },
    agentWorkload: { availability: 'NOT_CONNECTED', reason: 'r', expectedSource: 's', items: [] },
    vendorGrowthFunnel: { availability: 'PLANNED', reason: 'r', expectedSource: 's', items: [] },
    aarohiAcquisitionReadiness: {
      availability: 'STATIC_BASELINE',
      reason: 'r',
      expectedSource: 's',
      items: [],
    },
    workers: { availability: 'PLANNED', reason: 'r', expectedSource: 's', items: [] },
    models: { availability: 'NOT_CONNECTED', reason: 'r', expectedSource: 's', items: [] },
    knowledge: { availability: 'NOT_CONNECTED', reason: 'r', expectedSource: 's', items: [] },
    evaluations: { availability: 'NOT_CONNECTED', reason: 'r', expectedSource: 's', items: [] },
    coreSync: { availability: 'STATIC_BASELINE', reason: 'r', expectedSource: 's', items: [] },
    businessAnalytics: {
      availability: 'NOT_CONNECTED',
      reason: 'r',
      expectedSource: 's',
      items: [],
    },
    coreAutomationExecution: {
      availability: 'NOT_CONNECTED',
      reason: 'r',
      expectedSource: 's',
      items: [],
    },
  },
} as const;

describe('operator client core', () => {
  it('parses the shared v2 snapshot without platform code', async () => {
    const client = createOperatorClient({
      platform: 'ANDROID',
      transport: { request: () => Promise.resolve({ status: 200, body: snapshot }) },
    });
    await expect(client.snapshot()).resolves.toMatchObject({ contractVersion: '2' });
  });

  it('refuses a command created for another client platform', async () => {
    const client = createOperatorClient({
      platform: 'IOS',
      transport: { request: () => Promise.resolve({ status: 500, body: {} }) },
    });
    const command = {
      protocol: 'qfj.operator.command.v1',
      commandId: '2c405a7e-8e3e-4b6d-a0b7-e5ca6b9b6597',
      issuedAt: '2026-09-24T12:00:00.000Z',
      idempotencyKey: 'mobile-test-1',
      clientPlatform: 'ANDROID',
      action: 'CONVERSATION_TAKEOVER',
      payload: { conversationId: '2c405a7e-8e3e-4b6d-a0b7-e5ca6b9b6598', expectedRevision: 1 },
    } as const;
    await expect(client.command(command)).rejects.toMatchObject({
      code: 'PLATFORM_MISMATCH',
    } satisfies Partial<OperatorClientError>);
  });
});
