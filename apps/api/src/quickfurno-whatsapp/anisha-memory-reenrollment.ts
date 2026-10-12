import type { QuickFurnoWhatsAppTurnMaterialV2 } from './contracts.js';
import type { AnishaVendorMemoryConsentReader } from './anisha-vendor-memory.js';
import { assessAnishaWhatsAppPreflight } from './anisha-vendor-preflight.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

/**
 * Explicit owner-operated staging-only re-enrollment. A Core GRANT alone does
 * NOT automatically unlock an erased vendor. No model or WhatsApp route can
 * call this; an authorized operator must separately invoke the gated port.
 */
export function createAnishaMemoryReenrollment(input: {
  readonly environment: 'local' | 'staging' | 'production';
  readonly mode: 'DISABLED' | 'STAGING_ONLY';
  readonly ownerApprovalRef?: string;
  readonly consent?: AnishaVendorMemoryConsentReader;
  readonly rearm?: (request: {
    vendorId: string;
    consentRevision: number;
    consentUpdatedAt: string;
    consentObservedAt: string;
    ownerApprovalRef: string;
    now: string;
  }) => Promise<{ cleared: boolean }>;
  readonly clock?: () => string;
}) {
  if (input.mode === 'STAGING_ONLY' && input.environment !== 'staging') {
    throw new TypeError('anisha-memory-rearm-staging-only');
  }
  if (
    input.mode === 'STAGING_ONLY' &&
    (!input.ownerApprovalRef || !input.consent || !input.rearm)
  ) {
    throw new TypeError('anisha-memory-rearm-requires-core-and-owner');
  }
  return Object.freeze({
    async execute(
      material: QuickFurnoWhatsAppTurnMaterialV2,
    ): Promise<'disabled' | 'blocked' | 'cleared' | 'no-fence' | 'unavailable'> {
      if (input.mode !== 'STAGING_ONLY') return 'disabled';
      if (
        assessAnishaWhatsAppPreflight(material) !== 'ANISHA_TURN_READY' ||
        !material.subjectRef ||
        !UUID.test(material.subjectRef)
      )
        return 'blocked';
      const now = input.clock?.() ?? new Date().toISOString();
      if (
        !Number.isFinite(Date.parse(now)) ||
        Math.abs(Date.parse(now) - Date.parse(material.observedAt)) > 30_000
      )
        return 'blocked';
      try {
        const proof = await requireAnishaPort(input.consent).read({
          tenantId: 'quickfurno',
          vendorId: material.subjectRef,
          conversationId: material.conversationId,
          expectedRevision: material.revision,
        });
        if (
          !Object.is(proof.source, 'QUICKFURNO_CORE') ||
          proof.vendorId !== material.subjectRef ||
          proof.decision !== 'GRANTED' ||
          proof.erasurePending ||
          !proof.consentUpdatedAt ||
          proof.consentRevision < 4 ||
          Math.abs(Date.parse(now) - Date.parse(proof.observedAt)) > 30_000
        )
          return 'blocked';
        const result = await requireAnishaPort(input.rearm)({
          vendorId: material.subjectRef,
          consentRevision: proof.consentRevision,
          consentUpdatedAt: proof.consentUpdatedAt,
          consentObservedAt: proof.observedAt,
          ownerApprovalRef: requireAnishaPort(input.ownerApprovalRef),
          now,
        });
        return result.cleared ? 'cleared' : 'no-fence';
      } catch {
        return 'unavailable';
      }
    },
  });
}

function requireAnishaPort<T>(value: T | undefined | null): NonNullable<T> {
  if (value === undefined || value === null) {
    throw new TypeError('anisha-required-gated-port-missing');
  }
  return value;
}
