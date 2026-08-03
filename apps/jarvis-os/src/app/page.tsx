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
import {
  ProvenanceBar,
  SectionBody,
  SeriesBody,
  SourceBadge,
} from '@/components/system/Provenance';
import { controlPlane } from '@/lib/control-plane';

/**
 * Overview — the signature screen (JOS-01A; made truthful in JOS-01B).
 *
 * The layout is a deliberate rhythm rather than a uniform card grid: a status strip, an
 * instrument cluster, then a wide analytical column beside a narrow operational rail. That
 * asymmetry is what makes it read as mission control instead of an admin template, and it is
 * also honest about priority — trends are scanned, the action rail is worked.
 *
 * What changed in JOS-01B is what fills it. JOS-01A drew this same layout from a synthetic
 * fixture: a conversation curve, a workload split, five approvals waiting. Every one of those
 * sources is unconnected, so every one now says so and draws nothing. A screen that admits it is
 * mostly unconnected is worth more than a screen that looks busy and means nothing.
 */
export default function OverviewPage() {
  const plane = controlPlane();
  const health = plane.systemHealth();
  const attention = plane.attention();

  return (
    <>
      <PageHeader
        breadcrumb={['Control', 'Overview']}
        title="Operational overview"
        purpose="System-wide picture across the control plane, agents and boundaries. Read-only: Jarvis OS observes, QuickFurno Core authorizes, n8n executes."
        status={<CapabilityBadge lifecycle="AVAILABLE" />}
      />

      <div className="space-y-5">
        <ProvenanceBar provenance={plane.provenance()} />

        <Notice tone="warning" title="Production rollout is OFF — and no live source is connected">
          No communication can reach a real recipient from anywhere in Jarvis. Every figure below is
          declared by merged repository and governance state; QuickFurno Core and n8n are both{' '}
          <span className="font-mono">NOT_CONNECTED</span>, so the sections that would depend on
          them show that rather than a zero.
        </Notice>

        <StatusStrip components={health.components} />

        <MetricStrip section={plane.headlineMetrics()} />

        <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.9fr)_minmax(0,1fr)]">
          <div className="space-y-5">
            <Panel
              title="Conversation activity"
              subtitle="Traffic across the Riya and Anisha surfaces"
              action={<SourceBadge availability={plane.activitySeries().availability} />}
            >
              <SeriesBody series={plane.activitySeries()}>
                {(series) => <AreaTrend series={series} />}
              </SeriesBody>
            </Panel>

            <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
              <Panel
                title="Agent workload"
                subtitle="Share of handled conversations"
                action={<SourceBadge availability={plane.agentWorkload().availability} />}
              >
                <SectionBody section={plane.agentWorkload()} compact>
                  {(slices) => <BarDistribution slices={slices} />}
                </SectionBody>
              </Panel>
              <Panel
                title="Approval states"
                subtitle="Queue mix and outcomes"
                action={<SourceBadge availability={plane.approvalBreakdown().availability} />}
              >
                <SectionBody section={plane.approvalBreakdown()} compact>
                  {(slices) => <StackedShare slices={slices} />}
                </SectionBody>
              </Panel>
            </div>

            <Panel
              title="Model latency"
              subtitle="Gateway-observed p95 across shadow traffic"
              action={<SourceBadge availability={plane.latencySeries().availability} />}
            >
              <SeriesBody series={plane.latencySeries()}>
                {(series) => <AreaTrend series={series} valueSuffix=" ms" />}
              </SeriesBody>
            </Panel>
          </div>

          <div className="space-y-5">
            <Panel
              title="Attention"
              subtitle="Repository and governance notices"
              action={<SourceBadge availability={attention.availability} />}
            >
              <SectionBody section={attention} compact>
                {(items) => <AttentionRail items={items} />}
              </SectionBody>
            </Panel>

            <Panel
              title="Recent milestones"
              subtitle="Merged repository and governance events — not a live stream"
              action={<SourceBadge availability={plane.activity().availability} />}
            >
              <SectionBody section={plane.activity()} compact>
                {(entries) => <ActivityFeed entries={entries} />}
              </SectionBody>
            </Panel>
          </div>
        </div>

        <Panel
          title="Aarohi — vendor growth funnel"
          subtitle="Preview of a planned surface. No runtime, no outreach, no channel."
          action={<CapabilityBadge lifecycle="PLANNED" />}
        >
          <SectionBody section={plane.vendorGrowthFunnel()}>
            {(stages) => (
              <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
                <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-2">
                  {stages.slice(0, 6).map((stage) => (
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
                <FunnelPreview stages={stages} />
              </div>
            )}
          </SectionBody>
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
