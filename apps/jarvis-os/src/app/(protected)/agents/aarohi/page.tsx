import { notFound } from 'next/navigation';

import { AgentOverview } from '@/components/agents/AgentOverview';
import { FunnelPreview } from '@/components/charts/Charts';
import { Notice, Panel } from '@/components/primitives/Panel';
import { CapabilityBadge, StatusPill } from '@/components/system/StatusPill';
import { SectionBody } from '@/components/system/Provenance';
import { controlPlane } from '@/lib/control-plane';
import type { AarohiReadinessKind, AarohiReadinessRow } from '@/lib/control-plane/types';

/**
 * Aarohi — Vendor Growth & Acquisition (QuickFurno Vendor Growth Engine).
 *
 * An OWNER-LOCKED product surface whose runtime is PLANNED and DISABLED. Nothing has been sourced,
 * researched, approved or contacted, and this page must never imply otherwise.
 *
 * ### What AVG-11 changed here, and why it is not a step towards a runtime
 *
 * The four panels this page used to carry were hand-written prose: "No prospects", "No research
 * items", "No outreach requests", "No channel attached". Every sentence was true, and none of it
 * came from anywhere — a contributor could have edited the text without editing a fact, and a
 * reader had no way to tell a designed empty state from a stale one.
 *
 * They are now one READINESS section read through the same `controlPlane()` seam as everything
 * else, so each row's provenance is the merged governance it describes. That is a read surface
 * becoming truthful, not a capability becoming available: the funnel is still `PLANNED` with no
 * stages, the lifecycle badge still says PLANNED, and there is still not one control on this page.
 *
 * ### There are no action buttons, and that is load-bearing
 *
 * No Contact, Send, Approve, Mark Registered, Mark Paid, Activate, Handoff, Assign Package, Grant
 * Credits or Retry Payment. A dashboard that could do any of those would be a second business
 * authority, and QuickFurno Core is the only one there is.
 *
 * The separation notice is repeated on both vendor agent pages. Aarohi and Anisha are the pair most
 * likely to be conflated by a future contributor, and the cost of that mistake is concrete — an
 * acquisition agent reaching existing-vendor relationships, or a care agent acquiring an outreach
 * channel.
 */
export default async function AarohiAgentPage() {
  const plane = await controlPlane();
  const agent = plane.agent('aarohi');
  if (agent === undefined) {
    notFound();
  }
  const funnelSection = plane.vendorGrowthFunnel();
  const readinessSection = plane.aarohiReadiness();

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
          subtitle="Certified stages. Every figure carries the authority entitled to state it."
          action={<CapabilityBadge lifecycle="PLANNED" />}
        >
          <SectionBody section={funnelSection}>
            {(stages) => <FunnelPreview stages={stages} />}
          </SectionBody>
        </Panel>

        <Panel
          title="Acquisition readiness"
          subtitle="What merged governance establishes — and the bridges it deliberately does not."
          action={<CapabilityBadge lifecycle="PLANNED" />}
        >
          <SectionBody section={readinessSection} compact>
            {(rows) => <ReadinessList rows={rows} />}
          </SectionBody>
        </Panel>
      </div>

      <Notice tone="warning" title="A prepared brief is not a business outcome">
        Registration assistance is not a registration. Payment follow-up is not a payment, and a
        payment is not an activation. A conversation, a provider receipt, a model reading and
        Aarohi&rsquo;s own case state each establish <strong>nothing</strong> about a QuickFurno
        business fact. Only Core&rsquo;s authoritative confirmation does, and Core is not connected
        — so every Core-owned figure reads <em>unknown</em> here, never zero.
      </Notice>

      <Notice tone="info" title="Aarohi is not Anisha">
        Aarohi acquires vendors who are <strong>not yet registered</strong>. Anisha supports vendors
        QuickFurno Core has <strong>already registered</strong>. They are separate agents with
        separate scopes, separate knowledge namespaces and separate capabilities. Registration,
        activation and paid-active status are recorded by Core, never by Jarvis.
      </Notice>
    </AgentOverview>
  );
}

/** How each readiness row is introduced. Presentation only; it decides nothing. */
const KIND_LABEL: Readonly<Record<AarohiReadinessKind, string>> = Object.freeze({
  'offline-domain': 'Offline domain',
  boundary: 'Authority boundary',
  blocker: 'Not built',
});

function ReadinessList({ rows }: { readonly rows: readonly AarohiReadinessRow[] }) {
  return (
    <ul className="space-y-2">
      {rows.map((row) => (
        <li
          key={row.id}
          className="rounded-[var(--radius-control)] border border-[var(--color-line)] bg-[var(--color-base-850)] px-3.5 py-2.5"
        >
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <span className="min-w-0 text-[12px] text-[var(--color-ink)]">{row.label}</span>
            <StatusPill state={row.state} />
          </div>
          <p className="mt-1.5 text-[11px] leading-relaxed text-[var(--color-ink-faint)]">
            <span className="text-[var(--color-ink-muted)]">{KIND_LABEL[row.kind]}</span> ·{' '}
            {row.detail}
          </p>
        </li>
      ))}
    </ul>
  );
}
