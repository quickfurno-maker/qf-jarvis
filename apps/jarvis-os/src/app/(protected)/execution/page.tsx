import { StackedShare } from '@/components/charts/Charts';
import { Cell, DataTable, Row } from '@/components/primitives/DataTable';
import { Notice, Panel } from '@/components/primitives/Panel';
import { PageHeader } from '@/components/shell/PageHeader';
import { StatusPill, Tag } from '@/components/system/StatusPill';
import { SectionBody, SourceBadge } from '@/components/system/Provenance';
import { controlPlane } from '@/lib/control-plane';
import { isReadable } from '@/lib/control-plane/types';

export default async function ExecutionPage() {
  const plane = await controlPlane();
  const execution = plane.coreAutomationExecution();
  const workers = plane.workers();
  const models = plane.models();
  const readable = isReadable(execution.availability);
  const failed = readable
    ? (execution.items.find((item) => item.id === 'failed-24h')?.value ?? 0)
    : null;
  const uncertain = readable
    ? (execution.items.find((item) => item.id === 'uncertain-24h')?.value ?? 0)
    : null;
  const state = !readable
    ? 'NOT_CONNECTED'
    : failed && failed > 0
      ? 'DEGRADED'
      : uncertain && uncertain > 0
        ? 'DEGRADED'
        : 'CONNECTED';

  return (
    <>
      <PageHeader
        breadcrumb={['Operate', 'Execution']}
        title="Execution fabric"
        purpose="Authoritative execution outcomes and readiness after Core authorization. Jarvis observes and proposes; QuickFurno Core authorizes; execution workers act; providers deliver."
        status={<StatusPill state={state} />}
      />

      <div className="space-y-5">
        <Notice
          tone={readable ? (state === 'CONNECTED' ? 'healthy' : 'warning') : 'offline'}
          title={
            readable
              ? 'QuickFurno execution telemetry connected'
              : 'Execution telemetry not connected'
          }
        >
          This page reports execution state only from governed observations. A successful UI command
          is never rendered as delivered: delivery appears only after the authoritative execution
          system reports it.
        </Notice>

        <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
          <Panel
            title="Automation execution"
            subtitle="Current queue plus bounded 24-hour outcomes"
            action={<SourceBadge availability={execution.availability} />}
          >
            <SectionBody section={execution} compact>
              {(items) => <StackedShare slices={items} />}
            </SectionBody>
          </Panel>

          <Panel title="Execution chain" subtitle="Authority and responsibility stay separated">
            <ol className="space-y-2 text-[11.5px] text-[var(--color-ink-muted)]">
              {[
                ['1', 'Jarvis', 'Recommends or prepares an operator request.'],
                ['2', 'QuickFurno Core', 'Authorizes or refuses using current business truth.'],
                ['3', 'Automation runtime', 'Executes only an authorized request.'],
                ['4', 'Provider', 'Delivers and returns an outcome.'],
                ['5', 'Core ledger', 'Records the authoritative result.'],
              ].map(([index, title, detail]) => (
                <li
                  key={index}
                  className="flex gap-3 rounded-[var(--radius-control)] border border-[var(--color-line)] px-3 py-2.5"
                >
                  <span className="font-mono text-[var(--color-accent)]">{index}</span>
                  <span>
                    <b className="block text-[var(--color-ink)]">{title}</b>
                    <span className="mt-0.5 block text-[var(--color-ink-faint)]">{detail}</span>
                  </span>
                </li>
              ))}
            </ol>
          </Panel>
        </div>

        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          <Panel
            title="Worker readiness"
            subtitle="Content-free operational worker observations"
            action={<SourceBadge availability={workers.availability} />}
          >
            <SectionBody section={workers}>
              {(items) => (
                <DataTable
                  caption="Execution worker readiness."
                  head={['Worker', 'State', 'Capacity', 'Detail']}
                >
                  {items.map((item) => (
                    <Row key={item.id}>
                      <Cell>{item.label}</Cell>
                      <Cell nowrap>
                        <Tag
                          tone={
                            item.state === 'HEALTHY' || item.state === 'CONNECTED'
                              ? 'healthy'
                              : item.state === 'DEGRADED'
                                ? 'warning'
                                : 'offline'
                          }
                        >
                          {item.state.replaceAll('_', ' ')}
                        </Tag>
                      </Cell>
                      <Cell muted nowrap>
                        {item.capacity}
                      </Cell>
                      <Cell muted>{item.detail}</Cell>
                    </Row>
                  ))}
                </DataTable>
              )}
            </SectionBody>
          </Panel>

          <Panel
            title="Model/provider readiness"
            subtitle="Reasoning path health, not provider credentials"
            action={<SourceBadge availability={models.availability} />}
          >
            <SectionBody section={models}>
              {(items) => (
                <DataTable
                  caption="Model and provider readiness."
                  head={['Profile', 'Provider', 'State', 'Detail']}
                >
                  {items.map((item) => (
                    <Row key={item.id}>
                      <Cell>{item.label}</Cell>
                      <Cell muted nowrap>
                        {item.provider}
                      </Cell>
                      <Cell nowrap>
                        <Tag
                          tone={
                            item.state === 'HEALTHY' || item.state === 'AVAILABLE'
                              ? 'healthy'
                              : item.state === 'DEGRADED'
                                ? 'warning'
                                : 'offline'
                          }
                        >
                          {item.state.replaceAll('_', ' ')}
                        </Tag>
                      </Cell>
                      <Cell muted>{item.detail}</Cell>
                    </Row>
                  ))}
                </DataTable>
              )}
            </SectionBody>
          </Panel>
        </div>

        <Notice tone="info" title="Rollout authority remains separate">
          Execution telemetry becoming live does not enable production rollout. Agent enablement,
          knowledge mode, provider credentials and production activation remain separately governed
          and are intentionally not mutable through this page. Historical lineage is preserved:
          QFJ-P09.02 was the authorized-dispatch bridge milestone; the live observations above are
          the current operational view and do not imply rollout activation.
        </Notice>
      </div>
    </>
  );
}
