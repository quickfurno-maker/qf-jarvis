import { notFound } from 'next/navigation';

import { AgentOverview } from '@/components/agents/AgentOverview';
import { FunnelPreview } from '@/components/charts/Charts';
import { Notice, Panel } from '@/components/primitives/Panel';
import { CapabilityBadge } from '@/components/system/StatusPill';
import { controlPlane } from '@/lib/control-plane';

/**
 * Aarohi — Vendor Growth & Acquisition (QuickFurno Vendor Growth Engine).
 *
 * An OWNER-LOCKED product surface whose runtime is PLANNED and DISABLED. Every preview here
 * is empty on purpose: nothing has been sourced, researched, approved or contacted, and this
 * page must never imply otherwise.
 *
 * The separation notice is repeated on both vendor agent pages. Aarohi and Anisha are the
 * pair most likely to be conflated by a future contributor, and the cost of that mistake is
 * concrete — an acquisition agent reaching existing-vendor relationships, or a care agent
 * acquiring an outreach channel.
 */
export default function AarohiAgentPage() {
  const agent = controlPlane().agent('aarohi');
  if (agent === undefined) {
    notFound();
  }
  const funnel = controlPlane().vendorGrowthFunnel();

  return (
    <AgentOverview agent={agent}>
      <Notice tone="critical" title="No autonomous outreach exists">
        Aarohi has no runtime, no channel and no credential. It cannot contact a prospect, and it
        could not do so even if a human asked: outreach requires QuickFurno Core authorization, and
        live communication send is gated behind a rollout that is off.
      </Notice>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">
        <Panel
          title="Vendor acquisition funnel"
          subtitle="Planned stages. Every value is empty because nothing has run."
          action={<CapabilityBadge lifecycle="PLANNED" />}
        >
          <FunnelPreview stages={funnel} />
        </Panel>

        <div className="space-y-5">
          <Panel title="Prospect pipeline" subtitle="Preview — planned">
            <EmptyPreview
              label="No prospects"
              detail="Sourcing is a planned capability. Jarvis holds no vendor prospect list, and QuickFurno Core owns vendor identity."
            />
          </Panel>
          <Panel title="Research queue" subtitle="Preview — planned">
            <EmptyPreview
              label="No research items"
              detail="Enrichment would produce a powerless recommendation for a human to weigh. None exists."
            />
          </Panel>
          <Panel title="Outreach approvals" subtitle="Preview — planned">
            <EmptyPreview
              label="No outreach requests"
              detail="An approval would still not be permission to contact anyone: eligibility and consent are revalidated by Core at execution time."
            />
          </Panel>
          <Panel title="WhatsApp handoff" subtitle="Preview — planned">
            <EmptyPreview
              label="No channel attached"
              detail="QuickFurno's approved Meta WhatsApp infrastructure is untouched by Jarvis OS. Jarvis never calls Meta; n8n executes and providers deliver."
            />
          </Panel>
        </div>
      </div>

      <Notice tone="info" title="Aarohi is not Anisha">
        Aarohi acquires vendors who are <strong>not yet registered</strong>. Anisha supports vendors
        QuickFurno Core has <strong>already registered</strong>. They are separate agents with
        separate scopes, separate knowledge namespaces and separate capabilities. Registration,
        activation and paid-active status are recorded by Core, never by Jarvis.
      </Notice>
    </AgentOverview>
  );
}

function EmptyPreview({ label, detail }: { readonly label: string; readonly detail: string }) {
  return (
    <div className="rounded-[var(--radius-control)] border border-dashed border-[var(--color-line-strong)] bg-[var(--color-base-850)]/60 px-4 py-5 text-center">
      <p className="text-[12px] font-medium text-[var(--color-ink-muted)]">{label}</p>
      <p className="mx-auto mt-1.5 max-w-[52ch] text-[11.5px] leading-relaxed text-[var(--color-ink-faint)]">
        {detail}
      </p>
    </div>
  );
}
