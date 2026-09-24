import { createHash, createPrivateKey, randomUUID, sign } from 'node:crypto';
import { isAbsolute } from 'node:path';

import {
  QUICKFURNO_OPERATOR_PATH,
  QUICKFURNO_OPERATOR_REQUEST_PROTOCOL,
  QUICKFURNO_OPERATOR_SIGNING_DOMAIN,
  parseQuickFurnoOperatorObservation,
} from '@qf-jarvis/quickfurno-operator-observation-contract';

import { loadCoreReadConfig } from '../../auth/config/loader';
import type {
  ControlPlaneSectionName,
  ReadSourceDescriptor,
  SectionContributions,
} from './read-source';

const MAX_RESPONSE_BYTES = 64 * 1024;
const OWNED_SECTIONS = [
  'approvalQueue',
  'approvalBreakdown',
  'conversationControl',
  'conversationActivity',
  'agentWorkload',
  'businessAnalytics',
  'coreAutomationExecution',
] as const satisfies readonly ControlPlaneSectionName[];

function digest(raw: Uint8Array): string {
  return createHash('sha256').update(raw).digest('base64url');
}

function signingInput(args: {
  readonly requestId: string;
  readonly issuedAt: string;
  readonly keyId: string;
  readonly bodyDigest: string;
}): string {
  return [
    QUICKFURNO_OPERATOR_SIGNING_DOMAIN,
    'POST',
    QUICKFURNO_OPERATOR_PATH,
    'qf-jarvis-os',
    'quickfurno-core',
    args.requestId,
    args.issuedAt,
    args.keyId,
    args.bodyDigest,
  ].join('\n');
}

export function createQuickFurnoOperatorReadSource(configPath: string): ReadSourceDescriptor {
  if (!isAbsolute(configPath)) {
    throw new TypeError('quickfurno-core-read-config-path-invalid');
  }

  return Object.freeze({
    id: 'quickfurno-operator-observation',
    label: 'QuickFurno operator observation',
    observedReason: 'Read from QuickFurno through a dedicated signed, read-only operator snapshot.',
    owns: Object.freeze(OWNED_SECTIONS),
    timeoutMs: 3_500,
    async acquire(signal: AbortSignal) {
      try {
        const config = loadCoreReadConfig({ path: configPath });
        const requestId = randomUUID();
        const issuedAt = new Date().toISOString();
        const body = new TextEncoder().encode(
          JSON.stringify({
            protocol: QUICKFURNO_OPERATOR_REQUEST_PROTOCOL,
            requestId,
            issuedAt,
          }),
        );
        const privateKey = createPrivateKey(config.privateKeyPem);
        if (privateKey.type !== 'private' || privateKey.asymmetricKeyType !== 'ed25519') {
          return Object.freeze({
            status: 'UNAVAILABLE' as const,
            reason: 'SOURCE_REJECTED_REQUEST' as const,
          });
        }
        const signature = sign(
          null,
          Buffer.from(
            signingInput({
              requestId,
              issuedAt,
              keyId: config.keyId,
              bodyDigest: digest(body),
            }),
            'utf8',
          ),
          privateKey,
        ).toString('base64url');

        // eslint-disable-next-line no-restricted-globals -- reviewed server-only QuickFurno read transport.
        const response = await fetch(new URL(QUICKFURNO_OPERATOR_PATH, config.baseUrl), {
          method: 'POST',
          signal,
          headers: {
            'content-type': 'application/json',
            'x-qfj-key-id': config.keyId,
            'x-qfj-signature': signature,
          },
          body,
          cache: 'no-store',
        });
        if (!response.ok) {
          return Object.freeze({
            status: 'UNAVAILABLE' as const,
            reason: 'SOURCE_REJECTED_REQUEST' as const,
          });
        }
        const bytes = new Uint8Array(await response.arrayBuffer());
        if (bytes.byteLength < 2 || bytes.byteLength > MAX_RESPONSE_BYTES) {
          return Object.freeze({
            status: 'UNAVAILABLE' as const,
            reason: 'SOURCE_RETURNED_UNUSABLE_DATA' as const,
          });
        }
        let json: unknown;
        try {
          json = JSON.parse(new TextDecoder().decode(bytes));
        } catch {
          return Object.freeze({
            status: 'UNAVAILABLE' as const,
            reason: 'SOURCE_RETURNED_UNUSABLE_DATA' as const,
          });
        }
        const observation = parseQuickFurnoOperatorObservation(json);
        const emitted = Date.parse(observation.emittedAt);
        const now = Date.now();
        if (!Number.isFinite(emitted) || emitted > now + 1_000 || now - emitted > 30_000) {
          return Object.freeze({
            status: 'UNAVAILABLE' as const,
            reason: 'SOURCE_RETURNED_UNUSABLE_DATA' as const,
          });
        }

        const sections: SectionContributions = Object.freeze({
          approvalQueue: { items: observation.approvalQueue },
          approvalBreakdown: { items: observation.approvalBreakdown },
          conversationControl: { items: observation.conversationControl },
          conversationActivity: {
            points: observation.conversationActivity,
          },
          agentWorkload: { items: observation.agentWorkload },
          businessAnalytics: { items: observation.businessAnalytics },
          coreAutomationExecution: { items: observation.coreAutomationExecution },
        });
        return Object.freeze({
          status: 'OBSERVED' as const,
          observedAt: observation.emittedAt,
          sections,
        });
      } catch {
        return Object.freeze({
          status: 'UNAVAILABLE' as const,
          reason: 'SOURCE_UNREACHABLE' as const,
        });
      }
    },
  });
}
