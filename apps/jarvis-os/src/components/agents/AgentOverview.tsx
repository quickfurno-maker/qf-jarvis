import type { ReactNode } from 'react';

import { MetricStrip } from '@/components/analytics/MetricStrip';
import { Notice, Panel } from '@/components/primitives/Panel';
import { PageHeader } from '@/components/shell/PageHeader';
import { CapabilityBadge, StatusPill } from '@/components/system/StatusPill';
import { capability, LIFECYCLE_PRESENTATION } from '@/lib/capabilities/catalog';
import { HEALTH_PRESENTATION } from '@/lib/control-plane/types';
import type { AgentSummary } from '@/lib/control-plane/types';

/**
 * The reusable agent surface (JOS-01A).
 *
 * One component family for all four agents, so their pages cannot drift into four different
 * designs — and, more importantly, so the SCOPE line is rendered the same way every time.
 *
 * Each agent states its own boundary in `notes`, and the component simply prints them. That
 * is deliberate: an agent's scope is a governance fact from the constitution, not a UI
 * decision, so no component here composes, summarises or broadens one. Aarohi and Anisha are
 * rendered by the same code and remain entirely separate surfaces.
 */
export function AgentOverview({
  agent,
  children,
}: {
  readonly agent: AgentSummary;
  readonly children?: ReactNode;
}) {
  const entry = capability(agent.capabilityId);

  // The health pill and the capability badge are different facts, but for a PLANNED or
  // DISABLED agent they resolve to the same word -- and two identical pills side by side read
  // as a rendering bug rather than as two readings that happen to agree. Show one.
  const healthLabel = HEALTH_PRESENTATION[agent.state].label;
  const lifecycleLabel = LIFECYCLE_PRESENTATION[agent.lifecycle].label;
  const healthIsRedundant = healthLabel === lifecycleLabel;

  return (
    <>
      <PageHeader
        breadcrumb={['Agents', agent.name]}
        title={agent.name}
        purpose={agent.role}
        status={
          <>
            {healthIsRedundant ? null : <StatusPill state={agent.state} />}
            <CapabilityBadge lifecycle={agent.lifecycle} />
          </>
        }
      />

      <div className="space-y-5">
        {agent.lifecycle === 'PLANNED' ? (
          <Notice tone="planned" title="Planned surface — the runtime is disabled">
            {entry?.note ??
              'This agent has no runtime in this release. Nothing has been sourced, contacted or decided.'}
          </Notice>
        ) : (
          <Notice tone="shadow" title="Observed only — this agent authorizes nothing">
            {entry?.note ??
              'Behaviour is merged and runs in shadow. No output reaches a recipient or a business record.'}
          </Notice>
        )}

        <MetricStrip metrics={agent.metrics} />

        <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <Panel title="Scope and boundary" subtitle="What this agent may and may not do">
            <ul className="space-y-2.5">
              {agent.notes.map((note) => (
                <li key={note} className="flex gap-2.5">
                  <span
                    aria-hidden="true"
                    className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-[var(--color-accent)]"
                  />
                  <span className="text-[12.5px] leading-relaxed text-[var(--color-ink-muted)]">
                    {note}
                  </span>
                </li>
              ))}
            </ul>
          </Panel>

          <Panel title="Capability" subtitle="Presentation state only — this confers no authority">
            <dl className="space-y-3">
              <div className="flex items-start justify-between gap-4">
                <dt className="text-[12px] text-[var(--color-ink-muted)]">Capability</dt>
                <dd className="font-mono text-[11.5px] text-[var(--color-ink)]">
                  {agent.capabilityId}
                </dd>
              </div>
              <div className="flex items-start justify-between gap-4">
                <dt className="text-[12px] text-[var(--color-ink-muted)]">Lifecycle</dt>
                <dd>
                  <CapabilityBadge lifecycle={agent.lifecycle} />
                </dd>
              </div>
              <div className="border-t border-[var(--color-line)] pt-3">
                <dt className="text-[12px] text-[var(--color-ink-muted)]">Why</dt>
                <dd className="mt-1 text-[12px] leading-relaxed text-[var(--color-ink-faint)]">
                  {entry?.note ?? 'No capability entry is registered for this agent.'}
                </dd>
              </div>
            </dl>
          </Panel>
        </div>

        {children}
      </div>
    </>
  );
}
