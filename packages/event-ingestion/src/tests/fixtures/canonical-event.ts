/**
 * A **test-only** valid canonical event (`qf.recommendation.created@2`), copied from the
 * `@qf-jarvis/contracts` valid-fixture set so this package can exercise validated-event
 * preparation without importing test material across package boundaries.
 *
 * It carries no real data: every identifier is a fixed, obviously-synthetic UUID and every
 * subject is an opaque Core reference. `prepare-validated-event.test.ts` guards its validity
 * against the authoritative `safeParseCanonicalEvent` before relying on it, so a drift from the
 * contract fails loudly rather than silently.
 */

/** A known-valid canonical event, as a plain JSON value ready to serialise and sign. */
export const VALID_CANONICAL_EVENT = {
  eventId: '4f6b1e2a-0c3d-4e5f-8a9b-1c2d3e4f5a6b',
  eventType: 'qf.recommendation.created',
  eventVersion: 2,
  occurredAt: '2026-07-11T09:00:00Z',
  emittedAt: '2026-07-11T09:00:05Z',
  source: 'quickfurno-core',
  subject: { entityType: 'client', entityId: 'CORE-CLIENT-00311' },
  correlationId: 'b0328f91-73a4-45c6-9b02-8d9eafb0c1d2',
  payload: {
    recommendation: {
      recommendationId: '6b8d3a4c-2e5f-4071-8cbd-3e4f5a6b7c8d',
      contractVersion: 1,
      recommendationType: 'client.follow-up',
      createdAt: '2026-07-11T09:00:00Z',
      expiresAt: '2026-07-11T17:00:00Z',
      producingSystem: 'qf-jarvis',
      producingAgent: 'riya',
      producingAgentVersion: 'riya.2',
      subject: { entityType: 'client', entityId: 'CORE-CLIENT-00311' },
      priority: 'high',
      confidence: 0.81,
      risk: 'client-or-vendor-facing-communication',
      requiredApproval: 'authorized-team-human',
      summary: 'Follow up with a client who has gone quiet on a high-value requirement.',
      rationale:
        'The requirement was submitted four days ago, contacted once, and has been silent since. The category has a long consideration cycle, so silence is not yet disinterest.',
      evidence: [
        {
          evidenceType: 'canonical-event',
          eventId: '5a7c2f3b-1d4e-4f60-9bac-2d3e4f5a6b7c',
          eventType: 'qf.recommendation.created',
          description: 'The requirement was submitted and recorded by QuickFurno Core.',
        },
        {
          evidenceType: 'derived-signal',
          signalCode: 'client.silent-since-first-contact',
          description: 'No inbound activity for four days after a single outbound contact.',
          value: { daysSilent: 4, contactAttempts: 1 },
        },
      ],
      proposedActions: [
        {
          actionId: 'c1439002-84b5-46d7-8c13-9eafb0c1d2e3',
          actionType: 'communication.send-whatsapp',
          actionContractVersion: 1,
          summary: 'Send an approved follow-up template about the outstanding requirement.',
          parameters: { templateId: 'client-followup-v2', channel: 'whatsapp' },
        },
      ],
      composite: false,
      correlationId: 'b0328f91-73a4-45c6-9b02-8d9eafb0c1d2',
    },
  },
} as const;
