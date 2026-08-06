import { Cell, DataTable, Row } from '@/components/primitives/DataTable';
import { Notice, Panel } from '@/components/primitives/Panel';
import { PageHeader } from '@/components/shell/PageHeader';
import { CapabilityBadge, Tag } from '@/components/system/StatusPill';
import { CAPABILITY_SNAPSHOT } from '@/lib/capabilities/catalog';
import { controlPlane } from '@/lib/control-plane';
import type { RoadmapMarker } from '@/lib/control-plane/types';
import type { Tone } from '@/components/primitives/Panel';

/**
 * Governance (JOS-01A).
 *
 * The capability matrix and the roadmap position, in one place, rendered from the same
 * catalog every other screen reads. That is the point: a governance page assembled from its
 * own prose would be the first thing to drift, and the last thing anyone would check.
 */
/**
 * `current` is the slice this build IS, and it is rendered distinctly from `next`.
 *
 * Marking the running slice as "next" was the defect this replaces: it was false the day it
 * shipped, and it stayed false. `current` describes compiled-in software rather than a GitHub
 * merge state, so it does not invalidate itself when a pull request lands.
 */
const STATE_TONE: Readonly<Record<RoadmapMarker['state'], Tone>> = {
  merged: 'healthy',
  current: 'info',
  next: 'warning',
  planned: 'planned',
};

const STATE_LABEL: Readonly<Record<RoadmapMarker['state'], string>> = {
  merged: 'Merged',
  current: 'This build',
  next: 'Next',
  planned: 'Planned',
};

export default async function GovernancePage() {
  const roadmap = (await controlPlane()).roadmap();

  return (
    <>
      <PageHeader
        breadcrumb={['Boundary', 'Governance']}
        title="Governance & capability matrix"
        purpose="Where the roadmap stands, what each capability may do, and the standing rules that do not change between releases."
        status={<CapabilityBadge lifecycle="AVAILABLE" />}
      />

      <div className="space-y-5">
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
          <Statement title="Production rollout" value="OFF" tone="critical">
            Nothing reaches a real recipient from any surface, in any environment.
          </Statement>
          <Statement title="Latest merged" value="QFJ-P09.01" tone="healthy">
            Execution intent correlation. Validates a Core-issued intent; issues none.
          </Statement>
          <Statement title="Main resume point" value="QFJ-P09.02" tone="warning">
            Test-only authorized dispatch envelope and n8n bridge validation, after the Jarvis OS
            foundation track.
          </Statement>
        </div>

        <Notice tone="info" title="Approval is not communication authorization">
          They are separate artifacts and both must be yes. A founder&rsquo;s approval never
          overrides an opt-out, a suppression or a STOP, and eligibility is revalidated by
          QuickFurno Core at execution time — not carried forward from an earlier decision.
        </Notice>

        <Panel
          title="Roadmap position"
          subtitle="Read from the control-plane model. The two tracks advance independently, so each has its own next."
        >
          <DataTable
            caption="Roadmap markers, their track and their state."
            head={['Track', 'Phase', 'State', 'Detail']}
          >
            {roadmap.map((marker) => (
              <Row key={marker.id}>
                <Cell nowrap>
                  <Tag tone={marker.track === 'QFJ' ? 'info' : 'shadow'}>{marker.track}</Tag>
                </Cell>
                <Cell>{marker.label}</Cell>
                <Cell nowrap>
                  <Tag tone={STATE_TONE[marker.state]}>{STATE_LABEL[marker.state]}</Tag>
                </Cell>
                <Cell muted>{marker.detail}</Cell>
              </Row>
            ))}
          </DataTable>
        </Panel>

        <Panel
          title="Capability matrix"
          subtitle="Lifecycle states are presentation only — none of them confers authority"
        >
          <DataTable
            caption="Every capability Jarvis OS knows about, with its lifecycle state and reason."
            head={['Capability', 'Label', 'Lifecycle', 'Why']}
          >
            {CAPABILITY_SNAPSHOT.map((entry) => (
              <Row key={entry.id}>
                <Cell nowrap>
                  <span className="font-mono text-[11.5px]">{entry.id}</span>
                </Cell>
                <Cell muted nowrap>
                  {entry.label}
                </Cell>
                <Cell nowrap>
                  <CapabilityBadge lifecycle={entry.lifecycle} />
                </Cell>
                <Cell muted>{entry.note}</Cell>
              </Row>
            ))}
          </DataTable>
        </Panel>

        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          <Panel
            title="Authority, in one line each"
            subtitle="These do not change between releases"
          >
            <ul className="space-y-2.5 text-[12px] leading-relaxed text-[var(--color-ink-muted)]">
              <li>Jarvis recommends, reasons, correlates and observes.</li>
              <li>QuickFurno Core authorizes and records business truth.</li>
              <li>n8n executes approved intents and decides nothing.</li>
              <li>Providers deliver and decide nothing; results return to Core.</li>
              <li>No agent self-approves, at any confidence, in any circumstance.</li>
            </ul>
          </Panel>
          <Panel title="Audit readiness" subtitle="What is recorded, and by whom">
            <ul className="space-y-2.5 text-[12px] leading-relaxed text-[var(--color-ink-muted)]">
              <li>Approval asks and Core&rsquo;s answers are both durable and append-only.</li>
              <li>The audit trail is content-free: references, never business content.</li>
              <li>An approval decision cannot be edited after the fact.</li>
              <li>Jarvis OS writes nothing, so it adds no audit surface of its own.</li>
            </ul>
          </Panel>
        </div>
      </div>
    </>
  );
}

function Statement({
  title,
  value,
  tone,
  children,
}: {
  readonly title: string;
  readonly value: string;
  readonly tone: 'healthy' | 'warning' | 'critical';
  readonly children: string;
}) {
  const text =
    tone === 'healthy'
      ? 'text-[var(--color-healthy)]'
      : tone === 'warning'
        ? 'text-[var(--color-warning)]'
        : 'text-[var(--color-critical)]';

  return (
    <div className="surface-lift rounded-[var(--radius-panel)] border border-[var(--color-line)] bg-[var(--color-base-900)] px-5 py-4">
      <p className="text-[11px] font-medium tracking-[0.02em] text-[var(--color-ink-muted)] uppercase">
        {title}
      </p>
      <p className={`mt-2 font-mono text-[19px] leading-none font-semibold ${text}`}>{value}</p>
      <p className="mt-2.5 text-[11.5px] leading-relaxed text-[var(--color-ink-faint)]">
        {children}
      </p>
    </div>
  );
}
