import type { HealthState, MetricSummary, Section } from './types';
import { isReadable } from './types';

export interface EfficiencySignal {
  readonly id: string;
  readonly label: string;
  readonly value: string;
  readonly state: HealthState;
  readonly detail: string;
  readonly route: string;
}

function metric(section: Section<MetricSummary>, id: string): MetricSummary | undefined {
  return section.items.find((entry) => entry.id === id);
}

export function efficiencySignals(headline: Section<MetricSummary>): readonly EfficiencySignal[] {
  if (!isReadable(headline.availability)) {
    return Object.freeze([
      {
        id: 'efficiency-observation',
        label: 'Efficiency observation',
        value: 'Unavailable',
        state: 'NOT_CONNECTED' as const,
        detail: headline.reason,
        route: '/workers',
      },
    ]);
  }

  const availability = metric(headline, 'model-availability');
  const fallback = metric(headline, 'model-fallback-rate');
  const tokens = metric(headline, 'model-total-tokens');
  const embedding = metric(headline, 'embedding-requests');
  const ragServed = metric(headline, 'rag-served');
  const ragRefused = metric(headline, 'rag-refused');
  const slo = metric(headline, 'engineering-slo-state');

  return Object.freeze([
    {
      id: 'model-availability',
      label: 'Model availability',
      value: availability?.value ?? '—',
      state: availability === undefined ? ('NOT_CONNECTED' as const) : ('AVAILABLE' as const),
      detail:
        availability?.caption ??
        'Worker telemetry does not expose validated model availability for this snapshot.',
      route: '/models',
    },
    {
      id: 'fallback',
      label: 'Fallback use',
      value: fallback?.value ?? '—',
      state: fallback === undefined ? ('NOT_CONNECTED' as const) : ('AVAILABLE' as const),
      detail:
        fallback?.caption ??
        'Fallback frequency is not exposed by the current worker observation version.',
      route: '/models',
    },
    {
      id: 'tokens',
      label: 'Provider tokens',
      value: tokens?.value ?? '—',
      state: tokens === undefined ? ('NOT_CONNECTED' as const) : ('AVAILABLE' as const),
      detail:
        tokens?.caption ??
        'Provider-reported token usage is not exposed by the current worker observation version.',
      route: '/models',
    },
    {
      id: 'rag',
      label: 'RAG outcomes',
      value:
        ragServed === undefined
          ? '—'
          : ragServed.value +
            ' served' +
            (ragRefused === undefined ? '' : ' · ' + ragRefused.value + ' refused'),
      state: ragServed === undefined ? ('NOT_CONNECTED' as const) : ('AVAILABLE' as const),
      detail:
        'Observed governed retrieval outcomes. No success percentage is invented because no-candidate results are a distinct outcome.',
      route: '/knowledge',
    },
    {
      id: 'embedding',
      label: 'Embedding usage',
      value: embedding?.value ?? '—',
      state: embedding === undefined ? ('NOT_CONNECTED' as const) : ('AVAILABLE' as const),
      detail:
        embedding?.caption ??
        'Embedding usage is not exposed by the current worker observation version.',
      route: '/knowledge',
    },
    {
      id: 'slo',
      label: 'Engineering SLO',
      value: slo?.value ?? '—',
      state:
        slo === undefined
          ? ('NOT_CONNECTED' as const)
          : slo.value === 'BREACH'
            ? ('DEGRADED' as const)
            : ('AVAILABLE' as const),
      detail:
        slo?.caption ??
        'No governed engineering SLO assessment is exposed by the current worker observation.',
      route: '/workers',
    },
    {
      id: 'cost',
      label: 'Cost attribution',
      value: 'Not connected',
      state: 'NOT_CONNECTED' as const,
      detail:
        'Cost estimators exist, but the live operator observation does not carry a certified provider price-card reference. Jarvis will not invent spend.',
      route: '/release',
    },
    {
      id: 'semantic-cache',
      label: 'Semantic cache',
      value: 'Inactive',
      state: 'DISABLED' as const,
      detail:
        'Public-knowledge semantic-cache primitives exist, but no serving-path cache store or hit telemetry is active.',
      route: '/knowledge',
    },
  ]);
}
