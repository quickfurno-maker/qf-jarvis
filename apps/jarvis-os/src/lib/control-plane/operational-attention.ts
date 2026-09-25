import type { AttentionItem, ControlPlaneReadModel } from './types';
import { isReadable } from './types';

function item(
  id: string,
  kind: AttentionItem['kind'],
  title: string,
  context: string,
  severity: AttentionItem['severity'],
  href: string,
): AttentionItem {
  return { id, kind, title, context, severity, age: 'now', href };
}

export function operationalAttention(plane: ControlPlaneReadModel): readonly AttentionItem[] {
  const merged: AttentionItem[] = [...plane.attention().items];

  const approvals = plane.approvalQueue();
  if (isReadable(approvals.availability)) {
    const pending = approvals.items.filter((row) => row.state === 'awaiting-operator').length;
    if (pending > 0) {
      merged.unshift(
        item(
          'live-pending-approvals',
          'approval',
          String(pending) + ' approval' + (pending === 1 ? '' : 's') + ' awaiting operator',
          'QuickFurno Core is waiting for an operator decision on the signed approval queue.',
          pending >= 10 ? 'critical' : 'warning',
          '/approvals',
        ),
      );
    }
  }

  const conversations = plane.conversationControl();
  if (isReadable(conversations.availability)) {
    const takeovers = conversations.items.filter((row) => row.humanTakeover).length;
    const paused = conversations.items.filter((row) => row.aiPaused).length;
    if (takeovers > 0) {
      merged.unshift(
        item(
          'live-human-takeovers',
          'escalation',
          String(takeovers) +
            ' conversation' +
            (takeovers === 1 ? '' : 's') +
            ' under human control',
          'These conversations are currently held by a human operator in QuickFurno Core.',
          'warning',
          '/operations',
        ),
      );
    }
    if (paused > 0) {
      merged.unshift(
        item(
          'live-ai-paused',
          'warning',
          String(paused) + ' AI conversation' + (paused === 1 ? '' : 's') + ' paused',
          'Automation is suspended for these observed conversations until Core state changes.',
          'warning',
          '/operations',
        ),
      );
    }
  }

  const workers = plane.workers();
  if (!isReadable(workers.availability)) {
    merged.unshift(
      item(
        'live-worker-observation-missing',
        'worker',
        'Worker telemetry unavailable',
        'Jarvis OS cannot currently prove production worker health from the observation boundary.',
        'critical',
        '/workers',
      ),
    );
  } else if (workers.items.some((node) => node.state === 'DEGRADED')) {
    merged.unshift(
      item(
        'live-worker-degraded',
        'worker',
        'Production worker degraded',
        'At least one observed Jarvis worker is reporting a degraded health state.',
        'critical',
        '/workers',
      ),
    );
  }

  const models = plane.models();
  if (!isReadable(models.availability)) {
    merged.unshift(
      item(
        'live-model-observation-missing',
        'warning',
        'Model telemetry unavailable',
        'Provider/model health cannot currently be proven from the worker observation boundary.',
        'warning',
        '/models',
      ),
    );
  } else if (models.items.some((model) => model.state === 'DEGRADED')) {
    merged.unshift(
      item(
        'live-model-degraded',
        'warning',
        'Model gateway degraded',
        'The observed production model gateway is reporting a degraded state.',
        'critical',
        '/models',
      ),
    );
  }

  const execution = plane.coreAutomationExecution();
  if (isReadable(execution.availability)) {
    const failed = execution.items.find((slice) => slice.id === 'failed-24h')?.value ?? 0;
    const uncertain = execution.items.find((slice) => slice.id === 'uncertain-24h')?.value ?? 0;
    if (failed > 0 || uncertain > 0) {
      merged.unshift(
        item(
          'live-execution-attention',
          'blocked',
          'Automation execution needs attention',
          String(failed) +
            ' failed and ' +
            String(uncertain) +
            ' uncertain jobs were observed in the last 24 hours.',
          uncertain > 0 ? 'critical' : 'warning',
          '/execution',
        ),
      );
    }
  }

  const seen = new Set<string>();
  return merged
    .filter((entry) => {
      if (seen.has(entry.id)) return false;
      seen.add(entry.id);
      return true;
    })
    .slice(0, 24);
}
