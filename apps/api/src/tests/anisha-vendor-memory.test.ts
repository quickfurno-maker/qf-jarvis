import { describe, expect, it, vi } from 'vitest';
import type { AgentMemoryRecordV1 } from '@qf-jarvis/contracts';
import type { ProposedReplyJarvisRuntime } from '@qf-jarvis/jarvis-runtime';
import type { QuickFurnoWhatsAppTurnMaterialV2 } from '../quickfurno-whatsapp/contracts.js';
import {
  composeAnishaVendorMemoryHint,
  createAnishaVendorMemoryReader,
} from '../quickfurno-whatsapp/anisha-vendor-memory.js';
import { createQuickFurnoWhatsAppSpecialistRuntime } from '../quickfurno-whatsapp/specialist-runtime.js';

const now = '2026-10-12T04:00:00.000Z';
const vendorId = '44444444-4444-4444-8444-444444444444';
const anotherVendorId = '88888888-8888-4888-8888-888888888888';

function vendor(
  overrides: Partial<QuickFurnoWhatsAppTurnMaterialV2> = {},
): QuickFurnoWhatsAppTurnMaterialV2 {
  return {
    protocol: 'qfj.whatsapp.turn-material',
    version: 2,
    requestId: '11111111-1111-4111-8111-111111111111',
    tenantId: 'quickfurno',
    conversationId: '22222222-2222-4222-8222-222222222222',
    revision: 9,
    assignedActor: 'ANISHA',
    subjectType: 'vendor',
    partyType: 'VENDOR',
    conversationState: 'OPEN',
    jarvisAllowed: true,
    dataClass: 'HOSTED_ALLOWED',
    humanTakeover: false,
    aiPaused: false,
    cancelled: false,
    subjectStatus: 'clear',
    subjectRef: vendorId,
    observedAt: now,
    inboundMessageId: '33333333-3333-4333-8333-333333333333',
    receivedAt: now,
    normalizedText: 'Hinglish mein jawab dena',
    inbound: { version: 1, messageType: 'text', normalizedText: 'Hinglish mein jawab dena' },
    ...overrides,
  };
}
function record(overrides: Partial<AgentMemoryRecordV1> = {}): AgentMemoryRecordV1 {
  return {
    memoryRecordId: 'c2000004-0000-4000-8000-000000000004',
    contractVersion: 1,
    ownerAgent: 'anisha',
    subjectReferences: [{ entityType: 'vendor', entityId: vendorId }],
    sourceEventIds: ['c2000005-0000-4000-8000-000000000005'],
    derivedSummary: 'Vendor prefers short Hinglish onboarding guidance.',
    createdAt: '2026-10-10T04:00:00.000Z',
    updatedAt: '2026-10-11T04:00:00.000Z',
    expiresAt: '2026-10-20T04:00:00.000Z',
    policy: { policyId: 'anisha-memory', policyVersion: 1 },
    dataClassification: 'personal',
    rebuildable: true,
    authoritative: false,
    erasureState: 'none',
    reasonCode: 'language-preference',
    correlationId: 'c2000006-0000-4000-8000-000000000006',
    ...overrides,
  };
}

function approved(readActive = vi.fn(async () => [record()])) {
  const reader = createAnishaVendorMemoryReader({
    policy: { enabled: true, ownerApprovalRef: 'approved.anisha.read.v1', maxRecordAgeDays: 30 },
    memory: { readActive },
    consent: {
      read: vi.fn(async () => ({
        source: 'QUICKFURNO_CORE' as const,
        vendorId,
        decision: 'GRANTED' as const,
        observedAt: now,
      })),
    },
    clock: () => now,
  });
  return { reader, readActive };
}

describe('Anisha A2 governed vendor memory isolation', () => {
  it('defaults to OFF without constructing or consulting a store', async () => {
    const readActive = vi.fn();
    const reader = createAnishaVendorMemoryReader({ memory: { readActive } });
    expect(await reader.readForTurn(vendor())).toEqual({ status: 'disabled' });
    expect(readActive).not.toHaveBeenCalled();
  });

  it('requires owner approval AND the existing governed runtime for enabled reads', () => {
    expect(() =>
      createAnishaVendorMemoryReader({
        policy: { enabled: true },
        memory: { readActive: vi.fn() },
      }),
    ).toThrow('anisha-memory-owner-approval-required');
    expect(() =>
      createAnishaVendorMemoryReader({
        policy: { enabled: true, ownerApprovalRef: 'approved.anisha.read.v1' },
      }),
    ).toThrow('anisha-governed-memory-runtime-required');
  });

  it('requires Core consent adapter as well as an owner policy', () => {
    expect(() =>
      createAnishaVendorMemoryReader({
        policy: { enabled: true, ownerApprovalRef: 'approved.anisha.read.v1' },
        memory: { readActive: vi.fn() },
      }),
    ).toThrow('anisha-core-vendor-consent-required');
  });

  it.each([
    {
      label: 'explicit denial',
      decision: 'DENIED' as const,
      observedAt: now,
      subject: vendorId,
      expected: 'blocked',
    },
    {
      label: 'unknown consent',
      decision: 'UNKNOWN' as const,
      observedAt: now,
      subject: vendorId,
      expected: 'blocked',
    },
    {
      label: 'wrong vendor',
      decision: 'GRANTED' as const,
      observedAt: now,
      subject: anotherVendorId,
      expected: 'unavailable',
    },
    {
      label: 'stale consent',
      decision: 'GRANTED' as const,
      observedAt: '2026-10-11T04:00:00.000Z',
      subject: vendorId,
      expected: 'unavailable',
    },
  ])(
    'does not read governed memory on $label',
    async ({ decision, observedAt, subject, expected }) => {
      const readActive = vi.fn();
      const consent = vi.fn(async () => ({
        source: 'QUICKFURNO_CORE' as const,
        vendorId: subject,
        decision,
        observedAt,
      }));
      const reader = createAnishaVendorMemoryReader({
        policy: { enabled: true, ownerApprovalRef: 'approved.anisha.read.v1' },
        consent: { read: consent },
        memory: { readActive },
        clock: () => now,
      });
      await expect(reader.readForTurn(vendor())).resolves.toEqual({ status: expected });
      expect(consent).toHaveBeenCalledOnce();
      expect(readActive).not.toHaveBeenCalled();
    },
  );

  it('reads only Anisha vendor memories for the exact signed Core subject', async () => {
    const { reader, readActive } = approved();
    await expect(reader.readForTurn(vendor())).resolves.toEqual({
      status: 'available',
      summary: '- Vendor prefers short Hinglish onboarding guidance.',
    });
    expect(readActive).toHaveBeenCalledOnce();
    expect(readActive).toHaveBeenCalledWith({
      ownerAgent: 'anisha',
      subjectReference: { entityType: 'vendor', entityId: vendorId },
      asOf: now,
      limit: 3,
    });
  });

  it.each([
    { label: 'wrong agent', overrides: { assignedActor: 'RIYA' as const } },
    { label: 'wrong party', overrides: { partyType: 'CLIENT' as const } },
    { label: 'no vendor reference', overrides: { subjectRef: undefined as never } },
    { label: 'paused', overrides: { conversationState: 'PAUSED' as const } },
    { label: 'taken over by human', overrides: { humanTakeover: true } },
    { label: 'AI disabled', overrides: { jarvisAllowed: false } },
    { label: 'erased vendor', overrides: { subjectStatus: 'erased' as const } },
    { label: 'private local media', overrides: { dataClass: 'LOCAL_ONLY' as const } },
  ])('never consults memory for $label', async ({ overrides }) => {
    const { reader, readActive } = approved();
    await expect(reader.readForTurn(vendor(overrides))).resolves.toEqual({ status: 'blocked' });
    expect(readActive).not.toHaveBeenCalled();
  });

  it('refuses to use stale signed Core snapshot', async () => {
    const { reader, readActive } = approved();
    await expect(
      reader.readForTurn(vendor({ observedAt: '2026-09-01T04:00:00.000Z' })),
    ).resolves.toEqual({ status: 'unavailable' });
    expect(readActive).not.toHaveBeenCalled();
  });

  it('suppresses cross-vendor, cross-agent, multi-subject and unsanctioned memory', async () => {
    const records = [
      record({ ownerAgent: 'riya' }),
      record({ subjectReferences: [{ entityType: 'vendor', entityId: anotherVendorId }] }),
      record({
        subjectReferences: [
          { entityType: 'vendor', entityId: vendorId },
          { entityType: 'vendor', entityId: anotherVendorId },
        ],
      }),
    ];
    const { reader } = approved(vi.fn(async () => records));
    await expect(reader.readForTurn(vendor())).resolves.toEqual({ status: 'empty' });
  });

  it('excludes expired, future-updated and over-age memories', async () => {
    const records = [
      record({ expiresAt: '2026-10-11T04:00:00.000Z' }),
      record({ updatedAt: '2026-10-13T04:00:00.000Z' }),
      record({ updatedAt: '2026-08-01T04:00:00.000Z' }),
    ];
    const { reader } = approved(vi.fn(async () => records));
    await expect(reader.readForTurn(vendor())).resolves.toEqual({ status: 'empty' });
  });

  it('excludes financial, phone, email and long unreviewed summaries', async () => {
    const records = [
      record({ derivedSummary: 'Vendor has 9 credits left.' }),
      record({ derivedSummary: 'Contact vendor at 9876543210.' }),
      record({ derivedSummary: 'Vendor email x@example.com' }),
    ];
    const { reader } = approved(vi.fn(async () => records));
    await expect(reader.readForTurn(vendor())).resolves.toEqual({ status: 'empty' });
  });

  it('fails closed on unavailable memory without aborting an authorized vendor turn', async () => {
    const readActive = vi.fn(async (): Promise<AgentMemoryRecordV1[]> => {
      throw new Error('db down');
    });
    const { reader } = approved(readActive);
    const result = await reader.readForTurn(vendor());
    expect(result).toEqual({ status: 'unavailable' });
    expect(composeAnishaVendorMemoryHint('Current user message', result)).toBe(
      'Current user message',
    );
  });

  it('injects only optional, non-authoritative preference hints to Anisha; never into Riya', async () => {
    const { reader } = approved();
    const model = vi.fn(async (_envelope: { normalizedText: string; partyType: string }) => ({
      runtimeResult: {
        outcome: 'MODEL_DRAFTED',
        modelDrafted: true,
        coreConsulted: false,
        proposalId: 'a2-proposal',
        boundRevision: 9,
      },
      proposedReply: {
        version: 1,
        proposalId: 'a2-proposal',
        boundRevision: 9,
        proposalKind: 'REPLY',
        authorityStatus: 'PENDING_CORE_VALIDATION',
        replyBody: 'Hinglish mein aapko guide karungi.',
      },
    }));
    const runtime = createQuickFurnoWhatsAppSpecialistRuntime({
      runtimeId: 'qfj.anisha.a2',
      jarvisRuntime: {
        processInboundForProposedReply: model,
      } as unknown as ProposedReplyJarvisRuntime,
      anishaMemoryReader: reader,
    });
    expect(await runtime.process(vendor())).toMatchObject({ actor: 'ANISHA' });
    expect(model).toHaveBeenCalledOnce();
    const input = model.mock.calls[0]?.[0];
    expect(input?.partyType).toBe('VENDOR');
    expect(input?.normalizedText).toContain('Optional vendor preference memory');
    expect(input?.normalizedText).toContain('Vendor prefers short Hinglish onboarding guidance.');
    expect(input?.normalizedText).toContain('Hinglish mein jawab dena');
    expect(input?.normalizedText).toContain('Core remains authoritative');
  });

  it('does not inject memory into the model if the turn is unauthorized', async () => {
    const reader = {
      readForTurn: vi.fn(async () => ({
        status: 'available' as const,
        summary: 'Should never be seen',
      })),
    };
    const model = vi.fn();
    const runtime = createQuickFurnoWhatsAppSpecialistRuntime({
      runtimeId: 'qfj.anisha.a2',
      jarvisRuntime: {
        processInboundForProposedReply: model,
      } as unknown as ProposedReplyJarvisRuntime,
      anishaMemoryReader: reader,
    });
    expect(await runtime.process(vendor({ humanTakeover: true }))).toBeNull();
    expect(reader.readForTurn).not.toHaveBeenCalled();
    expect(model).not.toHaveBeenCalled();
  });
});
