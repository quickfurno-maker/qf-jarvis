import { AreaTrend, BarDistribution, StackedShare } from '@/components/charts/Charts';
import { MetricStrip } from '@/components/analytics/MetricStrip';
import { Notice, Panel } from '@/components/primitives/Panel';
import { PageHeader } from '@/components/shell/PageHeader';
import { CapabilityBadge } from '@/components/system/StatusPill';
import { controlPlane } from '@/lib/control-plane';

/**
 * Analytics (JOS-01A).
 *
 * The same charts as Overview, given room to breathe. Overview answers "is anything wrong
 * right now"; this answers "what has been happening" — so the trends are full-width and the
 * action rail is deliberately absent.
 */
export default function AnalyticsPage() {
  const plane = controlPlane();

  return (
    <>
      <PageHeader
        breadcrumb={['Boundary', 'Analytics']}
        title="Operational analytics"
        purpose="Trends across workload, latency and approval outcomes. Operational signal only — never a business or commercial figure."
        status={<CapabilityBadge lifecycle="AVAILABLE" />}
      />

      <div className="space-y-5">
        <Notice tone="warning" title="Demo data — and operational metrics only">
          Every figure is synthetic. Jarvis measures its own behaviour; revenue, conversion and
          commercial outcomes are QuickFurno Core&rsquo;s to report, and none appears here.
        </Notice>

        <MetricStrip metrics={plane.headlineMetrics()} />

        <Panel title="Conversation activity" subtitle="Last 24 hours, hourly">
          <AreaTrend series={plane.activitySeries()} />
        </Panel>

        <Panel title="Model latency p95" subtitle="Gateway-observed across shadow traffic">
          <AreaTrend series={plane.latencySeries()} valueSuffix=" ms" />
        </Panel>

        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          <Panel title="Agent workload" subtitle="Share of handled conversations">
            <BarDistribution slices={plane.agentWorkload()} />
          </Panel>
          <Panel title="Approval outcomes" subtitle="Queue mix and 24-hour results">
            <StackedShare slices={plane.approvalBreakdown()} />
          </Panel>
        </div>
      </div>
    </>
  );
}
