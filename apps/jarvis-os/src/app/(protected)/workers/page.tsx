import { Cell, DataTable, Row } from '@/components/primitives/DataTable';
import { Notice, Panel } from '@/components/primitives/Panel';
import { PageHeader } from '@/components/shell/PageHeader';
import { CapabilityBadge, StatusPill, Tag } from '@/components/system/StatusPill';
import { SectionBody, SourceBadge } from '@/components/system/Provenance';
import { controlPlane } from '@/lib/control-plane';

/**
 * Workers (JOS-01A).
 *
 * Fleet topology as a read surface. No discovery runs from this page: the node list is part of
 * the demo snapshot, and an offline node is shown as offline rather than omitted — a fleet
 * view that hides what it cannot see is the one that gets trusted at the wrong moment.
 */
export default function WorkersPage() {
  const workersSection = controlPlane().workers();

  return (
    <>
      <PageHeader
        breadcrumb={['Intelligence', 'Workers']}
        title="Worker fleet"
        purpose="Control plane, projection workers and future local/GPU nodes. No network discovery runs from this surface."
        status={<CapabilityBadge lifecycle="PLANNED" />}
      />

      <div className="space-y-5">
        <Notice tone="offline" title="No discovery, no credential">
          Jarvis OS performs no network scan and holds no node credential. Local inference is a
          planned capability; the node below is shown offline because it is.
        </Notice>

        <SectionBody section={workersSection}>
          {(workers) => (
            <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
              {workers.map((worker) => (
                <div
                  key={worker.id}
                  className="surface-lift rounded-[var(--radius-panel)] border border-[var(--color-line)] bg-[var(--color-base-900)] px-5 py-4"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-[13px] font-semibold text-[var(--color-ink)]">
                        {worker.label}
                      </p>
                      <p className="tabular mt-0.5 text-[10.5px] text-[var(--color-ink-faint)]">
                        {worker.id}
                      </p>
                    </div>
                    <StatusPill state={worker.state} live={worker.state === 'HEALTHY'} />
                  </div>
                  <p className="mt-3">
                    <Tag tone={worker.kind === 'control-plane' ? 'info' : 'planned'}>
                      {worker.kind}
                    </Tag>
                  </p>
                  <p className="tabular mt-3 text-[12px] text-[var(--color-ink-muted)]">
                    {worker.capacity}
                  </p>
                  <p className="mt-1.5 text-[11.5px] leading-relaxed text-[var(--color-ink-faint)]">
                    {worker.detail}
                  </p>
                </div>
              ))}
            </div>
          )}
        </SectionBody>

        <Panel
          title="Topology"
          subtitle="Where each node sits relative to the boundary"
          action={<SourceBadge availability={workersSection.availability} />}
        >
          <SectionBody section={workersSection}>
            {(workers) => (
              <DataTable
                caption="Worker nodes and their role."
                head={['Node', 'Kind', 'Capacity', 'State', 'Detail']}
              >
                {workers.map((worker) => (
                  <Row key={worker.id}>
                    <Cell nowrap>{worker.label}</Cell>
                    <Cell muted nowrap>
                      {worker.kind}
                    </Cell>
                    <Cell muted nowrap>
                      <span className="tabular">{worker.capacity}</span>
                    </Cell>
                    <Cell nowrap>
                      <StatusPill state={worker.state} />
                    </Cell>
                    <Cell muted>{worker.detail}</Cell>
                  </Row>
                ))}
              </DataTable>
            )}
          </SectionBody>
        </Panel>
      </div>
    </>
  );
}
