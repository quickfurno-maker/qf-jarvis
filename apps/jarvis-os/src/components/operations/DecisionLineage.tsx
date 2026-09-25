import Link from 'next/link';

import { Panel } from '@/components/primitives/Panel';
import { StatusPill } from '@/components/system/StatusPill';
import type { DecisionLineageStage } from '@/lib/control-plane/decision-lineage';

export function DecisionLineage({ stages }: { readonly stages: readonly DecisionLineageStage[] }) {
  const correlationReady = stages.every((stage) => stage.state !== 'NOT_CONNECTED');

  return (
    <Panel
      title="Decision lineage"
      subtitle="Observe → recommend → authorize → execute → deliver. Missing correlation is shown, never reconstructed."
      action={
        <span
          className={
            'text-[9.5px] font-semibold tracking-[0.08em] uppercase ' +
            (correlationReady ? 'text-[var(--color-healthy)]' : 'text-[var(--color-warning)]')
          }
        >
          {correlationReady ? 'Trace ready' : 'Partial trace'}
        </span>
      }
    >
      <div className="grid gap-2 md:grid-cols-5">
        {stages.map((stage, index) => (
          <Link
            key={stage.id}
            href={stage.href}
            className="group relative rounded-[var(--radius-control)] border border-[var(--color-line)] bg-[var(--color-base-850)] px-3.5 py-3 transition-colors hover:border-[var(--color-line-strong)]"
          >
            {index < stages.length - 1 ? (
              <span
                aria-hidden="true"
                className="absolute top-1/2 -right-[9px] z-10 hidden -translate-y-1/2 text-[13px] text-[var(--color-ink-faint)] md:block"
              >
                ›
              </span>
            ) : null}
            <div className="flex items-start justify-between gap-2">
              <p className="text-[11.5px] font-semibold leading-snug text-[var(--color-ink)]">
                {stage.label}
              </p>
              <StatusPill state={stage.state} />
            </div>
            <p className="mt-2 text-[10.5px] leading-relaxed text-[var(--color-ink-faint)]">
              {stage.detail}
            </p>
          </Link>
        ))}
      </div>
      {!correlationReady ? (
        <p className="mt-3 border-t border-[var(--color-line)] pt-3 text-[10.5px] leading-relaxed text-[var(--color-ink-faint)]">
          Exact “why did this happen?” replay needs a shared event/correlation contract spanning the
          recommendation, Core decision and execution receipts. Until that contract is observed,
          Jarvis OS shows stage readiness only.
        </p>
      ) : null}
    </Panel>
  );
}
