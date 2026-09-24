import { createHash, createPrivateKey, randomUUID, sign } from 'node:crypto';
import { isAbsolute } from 'node:path';

import {
  QUICKFURNO_OPERATOR_PATH,
  QUICKFURNO_OPERATOR_REQUEST_PROTOCOL,
  QUICKFURNO_OPERATOR_SIGNING_DOMAIN,
  parseQuickFurnoOperatorObservation,
  type QuickFurnoOperatorObservation,
} from '@qf-jarvis/quickfurno-operator-observation-contract';

import { loadCoreReadConfig } from '../../auth/config/loader';
import type {
  ControlPlaneSectionName,
  ReadSourceDescriptor,
  SectionContributions,
} from './read-source';

const MAX_RESPONSE_BYTES = 64 * 1024;

type OperatorSnapshotRequest = (
  input: URL,
  init: {
    readonly method: 'POST';
    readonly signal: AbortSignal;
    readonly headers: Readonly<Record<string, string>>;
    readonly body: string;
    readonly cache: 'no-store';
  },
) => Promise<Pick<Response, 'ok' | 'status' | 'arrayBuffer'>>;

const OWNED_SECTIONS = [
  'attention',
  'approvalQueue',
  'approvalBreakdown',
  'conversationControl',
  'conversationActivity',
  'agentWorkload',
  'businessAnalytics',
  'coreAutomationExecution',
] as const satisfies readonly ControlPlaneSectionName[];

const defaultOperatorSnapshotRequest: OperatorSnapshotRequest = (input, init) =>
  globalThis.fetch(input, init);

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

type AttentionItems = NonNullable<SectionContributions['attention']>['items'];

function deriveAttention(observation: QuickFurnoOperatorObservation): AttentionItems {
  const items: AttentionItems[number][] = [];
  const awaiting = observation.approvalQueue.filter(
    (approval) => approval.state === 'awaiting-operator',
  ).length;
  const takeovers = observation.conversationControl.filter(
    (conversation) => conversation.humanTakeover,
  ).length;
  const paused = observation.conversationControl.filter(
    (conversation) => conversation.aiPaused,
  ).length;
  const failed24h =
    observation.coreAutomationExecution.find((item) => item.id === 'failed-24h')?.value ?? 0;
  const uncertain24h =
    observation.coreAutomationExecution.find((item) => item.id === 'uncertain-24h')?.value ?? 0;

  if (awaiting > 0) {
    items.push({
      id: 'core-approvals-awaiting',
      kind: 'governance',
      title: awaiting + ' approval request' + (awaiting === 1 ? '' : 's') + ' need attention',
      context: 'QuickFurno Core reports operator decisions waiting in the governed approval queue.',
      severity: 'warning',
    });
  }
  if (takeovers > 0) {
    items.push({
      id: 'core-human-takeovers',
      kind: 'capability',
      title: takeovers + ' conversation' + (takeovers === 1 ? '' : 's') + ' under human control',
      context: 'QuickFurno Core reports active human takeover state on tracked conversations.',
      severity: 'warning',
    });
  }
  if (paused > 0) {
    items.push({
      id: 'core-ai-paused',
      kind: 'capability',
      title: paused + ' AI conversation' + (paused === 1 ? '' : 's') + ' paused',
      context: 'QuickFurno Core reports AI handling paused on tracked conversations.',
      severity: 'info',
    });
  }
  if (failed24h > 0) {
    items.push({
      id: 'core-automation-failed',
      kind: 'integration',
      title: failed24h + ' automation job' + (failed24h === 1 ? '' : 's') + ' failed in 24h',
      context: 'QuickFurno Core reports failed, dead-lettered or cancelled automation work in the last 24 hours.',
      severity: 'critical',
    });
  }
  if (uncertain24h > 0) {
    items.push({
      id: 'core-automation-uncertain',
      kind: 'integration',
      title: uncertain24h + ' automation outcome' + (uncertain24h === 1 ? '' : 's') + ' uncertain in 24h',
      context: 'QuickFurno Core reports automation outcomes requiring reconciliation in the last 24 hours.',
      severity: 'critical',
    });
  }

  return items;
}

export function createQuickFurnoOperatorReadSource(
  configPath: string,
  now: () => Date = () => new Date(),
  request: OperatorSnapshotRequest = defaultOperatorSnapshotRequest,
): ReadSourceDescriptor {
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
        const issuedAt = now().toISOString();
        const body = JSON.stringify({
          protocol: QUICKFURNO_OPERATOR_REQUEST_PROTOCOL,
          requestId,
          issuedAt,
        });
        const bodyBytes = new TextEncoder().encode(body);
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
              bodyDigest: digest(bodyBytes),
            }),
            'utf8',
          ),
          privateKey,
        ).toString('base64url');

        const response = await request(new URL(QUICKFURNO_OPERATOR_PATH, config.baseUrl), {
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
        const observedNow = now().getTime();
        if (
          !Number.isFinite(emitted) ||
          emitted > observedNow + 1_000 ||
          observedNow - emitted > 30_000
        ) {
          return Object.freeze({
            status: 'UNAVAILABLE' as const,
            reason: 'SOURCE_RETURNED_UNUSABLE_DATA' as const,
          });
        }

        const sections: SectionContributions = Object.freeze({
          attention: { items: deriveAttention(observation) },
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
