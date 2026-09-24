import { AreaTrend, BarDistribution, StackedShare } from '@/components/charts/Charts';
import { MetricStrip } from '@/components/analytics/MetricStrip';
import { Notice, Panel } from '@/components/primitives/Panel';
import { PageHeader } from '@/components/shell/PageHeader';
import { StatusPill } from '@/components/system/StatusPill';
import { SectionBody, SeriesBody, SourceBadge } from '@/components/system/Provenance';
import { controlPlane } from '@/lib/control-plane';
import { isReadable } from '@/lib/control-plane/types';

export default async function AnalyticsPage() {
  const plane = await controlPlane();
  const provenance = plane.provenance();
  const business = plane.businessAnalytics();
  const businessConnected = isReadable(business.availability);

  return (
    <>
      <PageHeader
        breadcrumb={['Boundary', 'Analytics']}
        title="Intelligence & analytics"
        purpose="Operational telemetry from Jarvis beside bounded business aggregates from QuickFurno Core. Provenance stays visible so operational inference never becomes business truth."
        status={<StatusPill state={provenance.liveOperationalData ? 'CONNECTED' : 'DEGRADED'} />}
      />

      <div className="space-y-5">
        <Notice
          tone={provenance.liveOperationalData ? 'healthy' : 'warning'}
          title={
            provenance.liveOperationalData
              ? 'Live analytics sources connected'
              : 'Analytics sources are partially connected'
          }
        >
          Jarvis telemetry explains system behavior. QuickFurno Core aggregates describe business
          outcomes. They are rendered together for decision support but never merged into one
          authority class.
        </Notice>

        <MetricStrip section={plane.headlineMetrics()} />

        <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
          <Panel
            title="Business pulse"
            subtitle="QuickFurno Core aggregates — authoritative business facts"
            action={<SourceBadge availability={business.availability} />}
          >
            <SectionBody section={business} compact>
              {(slices) => <BarDistribution slices={slices} />}
            </SectionBody>
          </Panel>

          <Panel
            title="Agent workload"
            subtitle="Operational share of currently tracked conversations"
            action={<SourceBadge availability={plane.agentWorkload().availability} />}
          >
            <SectionBody section={plane.agentWorkload()} compact>
              {(slices) => <BarDistribution slices={slices} />}
            </SectionBody>
          </Panel>
        </div>

        <Panel
          title="Conversation activity"
          subtitle="Bounded hourly inbound activity"
          action={<SourceBadge availability={plane.activitySeries().availability} />}
        >
          <SeriesBody series={plane.activitySeries()}>
            {(series) => <AreaTrend series={series} />}
          </SeriesBody>
        </Panel>

        <Panel
          title="Model latency p95"
          subtitle="Gateway-observed reasoning latency"
          action={<SourceBadge availability={plane.latencySeries().availability} />}
        >
          <SeriesBody series={plane.latencySeries()}>
            {(series) => <AreaTrend series={series} valueSuffix=" ms" />}
          </SeriesBody>
        </Panel>

        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          <Panel
            title="Approval outcomes"
            subtitle="Core decision queue and outcomes"
            action={<SourceBadge availability={plane.approvalBreakdown().availability} />}
          >
            <SectionBody section={plane.approvalBreakdown()} compact>
              {(slices) => <StackedShare slices={slices} />}
            </SectionBody>
          </Panel>

          <Panel
            title="Execution outcomes"
            subtitle="QuickFurno automation state"
            action={<SourceBadge availability={plane.coreAutomationExecution().availability} />}
          >
            <SectionBody section={plane.coreAutomationExecution()} compact>
              {(slices) => <StackedShare slices={slices} />}
            </SectionBody>
          </Panel>
        </div>

        {!businessConnected ? (
          <Notice tone="offline" title="Business source unavailable">
            No business value is substituted with zero. QuickFurno Core must be connected before
            this dashboard renders commercial or business counts.
          </Notice>
        ) : null}
      </div>
    </>
  );
}
