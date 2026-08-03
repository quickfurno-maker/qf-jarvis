import {
  AreaTrend,
  BarDistribution,
  FunnelPreview,
  StackedShare,
} from '@/components/charts/Charts';
import { MetricStrip } from '@/components/analytics/MetricStrip';
import { ActivityFeed } from '@/components/operations/ActivityFeed';
import { AttentionRail } from '@/components/operations/AttentionRail';
import { Notice, Panel } from '@/components/primitives/Panel';
import { PageHeader } from '@/components/shell/PageHeader';
import { CapabilityBadge, StatusStrip } from '@/components/system/StatusPill';
import { controlPlane } from '@/lib/control-plane';

/**
 * Overview — the signature screen (JOS-01A).
 *
 * The layout is a deliberate rhythm rather than a uniform card grid: a status strip, an
 * instrument cluster, then a wide analytical column beside a narrow operational rail. That
 * asymmetry is what makes it read as mission control instead of an admin template, and it is
 * also honest about priority — trends are scanned, the action rail is worked.
 *
 * Everything is server-rendered from the demo read model. Nothing on this page fetches, and
 * the two facts an operator must not have to hunt for — the data is synthetic, rollout is
 * off — are stated at the top rather than buried in a tooltip.
 */
export default function OverviewPage() {
  const plane = controlPlane();
  const health = plane.systemHealth();

  return (
    <>
      <PageHeader
        breadcrumb={['Control', 'Overview']}
        title="Operational overview"
        purpose="System-wide picture across the control plane, agents and boundaries. Read-only: Jarvis OS observes, QuickFurno Core authorizes, n8n executes."
        status={<CapabilityBadge lifecycle="AVAILABLE" />}
      />

      <div className="space-y-5">
        <Notice tone="warning" title="Production rollout is OFF — and this page shows demo data">
          No communication can reach a real recipient from anywhere in Jarvis. Every figure below
          comes from a local synthetic snapshot, not from a running system; identifiers carry a
          <span className="font-mono"> -DEMO- </span>
          segment so they cannot be mistaken for production records.
        </Notice>

        <StatusStrip components={health.components} />

        <MetricStrip metrics={plane.headlineMetrics()} />

        <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.9fr)_minmax(0,1fr)]">
          <div className="space-y-5">
            <Panel
              title="Conversation activity"
              subtitle="Demo workload across Riya and Anisha surfaces, last 24 hours"
            >
              <AreaTrend series={plane.activitySeries()} />
            </Panel>

            <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
              <Panel title="Agent workload" subtitle="Share of handled conversations">
                <BarDistribution slices={plane.agentWorkload()} />
              </Panel>
              <Panel title="Approval states" subtitle="Queue mix and 24-hour outcomes">
                <StackedShare slices={plane.approvalBreakdown()} />
              </Panel>
            </div>

            <Panel
              title="Model latency"
              subtitle="Gateway-observed p95 across shadow traffic, last 24 hours"
            >
              <AreaTrend series={plane.latencySeries()} valueSuffix=" ms" />
            </Panel>
          </div>

          <div className="space-y-5">
            <Panel
              title="Action required"
              subtitle="Ordered by urgency"
              action={
                <span className="tabular text-[11px] text-[var(--color-ink-faint)]">
                  {plane.attention().length} open
                </span>
              }
            >
              <AttentionRail items={plane.attention()} />
            </Panel>

            <Panel title="Live activity" subtitle="Provenance-labelled event stream">
              <ActivityFeed entries={plane.activity()} />
            </Panel>
          </div>
        </div>

        <Panel
          title="Aarohi — vendor growth funnel"
          subtitle="Preview of a planned surface. No runtime, no outreach, no channel."
          action={<CapabilityBadge lifecycle="PLANNED" />}
        >
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-2">
              {plane
                .vendorGrowthFunnel()
                .slice(0, 6)
                .map((stage) => (
                  <div
                    key={stage.id}
                    className="rounded-[var(--radius-control)] border border-[var(--color-line)] bg-[var(--color-base-850)] px-3 py-2.5"
                  >
                    <p className="text-[11px] text-[var(--color-ink-muted)]">{stage.label}</p>
                    <p className="tabular mt-1 text-[18px] leading-none font-semibold text-[var(--color-ink-faint)]">
                      —
                    </p>
                  </div>
                ))}
            </div>
            <FunnelPreview stages={plane.vendorGrowthFunnel()} />
          </div>
          <p className="mt-4 border-t border-[var(--color-line)] pt-3 text-[11.5px] leading-relaxed text-[var(--color-ink-faint)]">
            Aarohi acquires vendors who are not yet registered. Anisha cares for vendors who already
            are. They are separate agents with separate scopes, and neither performs the
            other&rsquo;s work. Registration, activation and paid-active status are recorded by
            QuickFurno Core.
          </p>
        </Panel>
      </div>
    </>
  );
}
