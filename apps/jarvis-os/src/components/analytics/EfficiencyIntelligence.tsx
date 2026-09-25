import Link from 'next/link';

import { Panel } from '@/components/primitives/Panel';
import { StatusPill } from '@/components/system/StatusPill';
import type { EfficiencySignal } from '@/lib/control-plane/efficiency';

export function EfficiencyIntelligence({
  signals,
}: {
  readonly signals: readonly EfficiencySignal[];
}) {
  return (
    <Panel
      title="Efficiency intelligence"
      subtitle="Observed model/RAG/embedding efficiency beside the telemetry that is still missing."
    >
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        {signals.map((signal) => (
          <Link
            key={signal.id}
            href={signal.route}
            className="rounded-[var(--radius-control)] border border-[var(--color-line)] px-3.5 py-3 transition-colors hover:border-[var(--color-line-strong)]"
          >
            <div className="flex items-start justify-between gap-2">
              <p className="text-[10.5px] font-semibold text-[var(--color-ink-muted)]">
                {signal.label}
              </p>
              <StatusPill state={signal.state} />
            </div>
            <p className="tabular mt-2 text-[18px] font-semibold tracking-[-0.02em] text-[var(--color-ink)]">
              {signal.value}
            </p>
            <p className="mt-2 text-[10.5px] leading-relaxed text-[var(--color-ink-faint)]">
              {signal.detail}
            </p>
          </Link>
        ))}
      </div>
    </Panel>
  );
}
