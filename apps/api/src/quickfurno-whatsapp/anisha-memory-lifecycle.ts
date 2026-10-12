import { createHash } from 'node:crypto';
import type { AgentMemoryRecordV1 } from '@qf-jarvis/contracts';
import type { GovernedMemoryRuntime } from '@qf-jarvis/governed-memory-foundation';
import type { QuickFurnoWhatsAppTurnMaterialV2 } from './contracts.js';
import { type AnishaVendorMemoryConsentReader } from './anisha-vendor-memory.js';
import { assessAnishaWhatsAppPreflight } from './anisha-vendor-preflight.js';

/**
 * AN-A2b: structured, event-backed preferences only. There is no free-text
 * extraction, automatic model memory, wallet fact, transcript or new store.
 */
export type AnishaPreference =
  | { readonly kind: 'language'; readonly value: 'en' | 'hi' | 'hinglish' }
  | { readonly kind: 'reply-style'; readonly value: 'short' | 'detailed' };

export interface AnishaVendorMemoryLifecycle {
  recordExplicitPreference(
    material: QuickFurnoWhatsAppTurnMaterialV2,
    preference: AnishaPreference,
  ): Promise<'stored' | 'blocked' | 'unavailable'>;
  eraseVendorAfterCoreRevocation(input: {
    readonly vendorId: string;
    readonly erasureRequestId: string;
    readonly observedAt: string;
  }): Promise<{ readonly invalidatedCount: number }>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const RETENTION_DAYS = 30;
const MS_DAY = 86400000;
const DESCRIPTION: Record<string, string> = Object.freeze({
  'language:en': 'Vendor prefers English communication.',
  'language:hi': 'Vendor prefers Hindi communication.',
  'language:hinglish': 'Vendor prefers short Hinglish communication.',
  'reply-style:short': 'Vendor prefers concise support replies.',
  'reply-style:detailed': 'Vendor prefers detailed support guidance.',
});

function stableRecordId(eventId: string, kind: string, vendorId: string): string {
  const h = createHash('sha256')
    .update('anisha.preference.v1|' + vendorId + '|' + eventId + '|' + kind)
    .digest('hex')
    .slice(0, 32)
    .split('');
  h[12] = '5';
  h[16] = '8';
  const s = h.join('');
  return [s.slice(0, 8), s.slice(8, 12), s.slice(12, 16), s.slice(16, 20), s.slice(20)].join('-');
}
export function createAnishaVendorMemoryLifecycle(config: {
  readonly mode?: 'DISABLED' | 'STAGING_ONLY';
  readonly environment: 'local' | 'staging' | 'production';
  readonly ownerApprovalRef?: string;
  readonly memory?: Pick<GovernedMemoryRuntime, 'write' | 'invalidate'>;
  readonly consent?: AnishaVendorMemoryConsentReader;
  readonly clock?: () => string;
}): AnishaVendorMemoryLifecycle {
  const enabled = config.mode === 'STAGING_ONLY';
  if (enabled && config.environment !== 'staging') {
    throw new TypeError('anisha-memory-staging-only');
  }
  if (
    enabled &&
    (!config.ownerApprovalRef ||
      !/^[A-Za-z0-9._:-]{1,128}$/u.test(config.ownerApprovalRef) ||
      !config.memory ||
      !config.consent)
  ) {
    throw new TypeError('anisha-memory-policy-and-core-consent-required');
  }
  const clock = config.clock ?? (() => new Date().toISOString());

  return Object.freeze({
    async recordExplicitPreference(
      material: QuickFurnoWhatsAppTurnMaterialV2,
      preference: AnishaPreference,
    ): Promise<'stored' | 'blocked' | 'unavailable'> {
      if (!enabled || assessAnishaWhatsAppPreflight(material) !== 'ANISHA_TURN_READY')
        return 'blocked';
      const vendorId = material.subjectRef;
      if (!vendorId || !UUID.test(vendorId)) return 'blocked';
      const summary = DESCRIPTION[preference.kind + ':' + preference.value];
      if (!summary) return 'blocked';
      const nowString = clock();
      const now = Date.parse(nowString);
      const observed = Date.parse(material.observedAt);
      const created = Date.parse(material.receivedAt);
      if (
        !Number.isFinite(now) ||
        !Number.isFinite(observed) ||
        !Number.isFinite(created) ||
        Math.abs(now - observed) > 300000 ||
        created > now ||
        created + RETENTION_DAYS * MS_DAY <= now
      )
        return 'blocked';
      try {
        const check = await config.consent!.read({
          tenantId: 'quickfurno',
          vendorId,
          conversationId: material.conversationId,
          expectedRevision: material.revision,
        });
        const consentAt = Date.parse(check.observedAt);
        if (
          check.source !== 'QUICKFURNO_CORE' ||
          check.vendorId !== vendorId ||
          check.decision !== 'GRANTED' ||
          !Number.isFinite(consentAt) ||
          consentAt > now ||
          now - consentAt > 300000
        )
          return 'blocked';

        const record: AgentMemoryRecordV1 = {
          memoryRecordId: stableRecordId(material.inboundMessageId, preference.kind, vendorId),
          contractVersion: 1,
          ownerAgent: 'anisha',
          subjectReferences: [{ entityType: 'vendor', entityId: vendorId }],
          sourceEventIds: [material.inboundMessageId],
          derivedSummary: summary,
          createdAt: new Date(created).toISOString(),
          updatedAt: new Date(created).toISOString(),
          expiresAt: new Date(created + RETENTION_DAYS * MS_DAY).toISOString(),
          policy: { policyId: 'anisha.vendor.preference.30day', policyVersion: 1 },
          dataClassification: 'personal',
          rebuildable: true,
          authoritative: false,
          erasureState: 'none',
          reasonCode: preference.kind === 'language' ? 'language-preference' : 'support-preference',
          correlationId: material.requestId,
        };
        const write = await config.memory!.write(record);
        return write.decision === 'ALLOW_DURABLE' ? 'stored' : 'blocked';
      } catch {
        return 'unavailable';
      }
    },

    async eraseVendorAfterCoreRevocation(input: {
      readonly vendorId: string;
      readonly erasureRequestId: string;
      readonly observedAt: string;
    }): Promise<{ readonly invalidatedCount: number }> {
      // Only a caller that has independently authenticated a Core purge task
      // may invoke this method; NOT wired to an external HTTP endpoint.
      if (!enabled || !UUID.test(input.vendorId) || !UUID.test(input.erasureRequestId)) {
        throw new TypeError('anisha-memory-erasure-not-authorized');
      }
      const now = clock();
      if (Math.abs(Date.parse(now) - Date.parse(input.observedAt)) > 300000) {
        throw new TypeError('anisha-memory-erasure-task-stale');
      }
      const result = await config.memory!.invalidate({
        memoryInvalidationRequestId: input.erasureRequestId,
        contractVersion: 1,
        scope: 'subject',
        ownerAgent: 'anisha',
        subjectReference: { entityType: 'vendor', entityId: input.vendorId },
        erasureRequestId: input.erasureRequestId,
        requestedBy: {
          actorType: 'policy',
          policyId: 'quickfurno.core.vendor-memory-erasure',
          policyVersion: 1,
        },
        requestedAt: input.observedAt,
        reasonCode: 'vendor-consent-revoked',
        policy: { policyId: 'anisha.vendor.memory.erasure', policyVersion: 1 },
        correlationId: input.erasureRequestId,
      });
      return Object.freeze({ invalidatedCount: result.invalidatedCount });
    },
  });
}
