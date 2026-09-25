import Link from 'next/link';

import { Panel } from '@/components/primitives/Panel';
import { StatusPill, Tag } from '@/components/system/StatusPill';
import type { AgentCockpitView } from '@/lib/control-plane/agent-live';

export function AgentCockpit({ cockpit }: { readonly cockpit: AgentCockpitView }) {
  return (
    <div className="space-y-5">
      <Panel
        title="Live agent cockpit"
        subtitle="Only signals attributable from the governed snapshot. Unknown stays unknown."
      >
        <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
          {cockpit.signals.map((signal) => (
            <Link
              key={signal.id}
              href={signal.href}
              title={signal.detail}
              className="rounded-[var(--radius-control)] border border-[var(--color-line)] bg-[var(--color-base-850)] px-3.5 py-3 transition-colors hover:border-[var(--color-line-strong)] hover:bg-[var(--color-base-800)]"
            >
              <p className="text-[9.5px] font-semibold tracking-[0.08em] text-[var(--color-ink-faint)] uppercase">
                {signal.label}
              </p>
              <p className="tabular mt-2 text-[22px] font-semibold tracking-[-0.03em] text-[var(--color-ink)]">
                {signal.value}
              </p>
              <p className="mt-2 line-clamp-2 text-[10.5px] leading-relaxed text-[var(--color-ink-faint)]">
                {signal.detail}
              </p>
            </Link>
          ))}
        </div>
      </Panel>

      <Panel
        title="Operating dependencies"
        subtitle="Agent-specific dependencies are separated from shared infrastructure."
      >
        <div className="grid gap-2 lg:grid-cols-3">
          {cockpit.dependencies.map((dependency) => (
            <Link
              key={dependency.id}
              href={dependency.href}
              className="rounded-[var(--radius-control)] border border-[var(--color-line)] px-3.5 py-3 transition-colors hover:border-[var(--color-line-strong)]"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-[12px] font-semibold text-[var(--color-ink)]">
                  {dependency.label}
                </p>
                <div className="flex items-center gap-1.5">
                  <Tag tone={dependency.scope === 'AGENT' ? 'info' : 'offline'}>
                    {dependency.scope === 'AGENT' ? 'Agent' : 'Shared'}
                  </Tag>
                  <StatusPill state={dependency.state} />
                </div>
              </div>
              <p className="mt-2 text-[10.5px] leading-relaxed text-[var(--color-ink-faint)]">
                {dependency.detail}
              </p>
            </Link>
          ))}
        </div>
      </Panel>
    </div>
  );
}
