import { Cell, DataTable, Row } from '@/components/primitives/DataTable';
import { Notice, Panel } from '@/components/primitives/Panel';
import { PageHeader } from '@/components/shell/PageHeader';
import { CapabilityBadge, StatusPill, Tag } from '@/components/system/StatusPill';
import { controlPlane } from '@/lib/control-plane';

/**
 * Models & Providers (JOS-01A).
 *
 * The gateway is provider-neutral by design, so the table's first job is to make the DATA
 * CLASS of each profile obvious — whether a request would leave the estate at all. That is
 * the column an operator needs before latency or cost, and it is the one an admin template
 * would omit.
 *
 * No live call is made from this page, and no credential is read anywhere in Jarvis OS.
 */
export default function ModelsPage() {
  const models = controlPlane().models();

  return (
    <>
      <PageHeader
        breadcrumb={['Intelligence', 'Models & Providers']}
        title="Model gateway"
        purpose="Provider-neutral routing, with the data class of each profile stated first. Shadow evaluation only — no candidate output is delivered."
        status={<CapabilityBadge lifecycle="SHADOW" />}
      />

      <div className="space-y-5">
        <Notice tone="shadow" title="Shadow only — and no credential lives here">
          The gateway compares a candidate against a stable profile and discards the
          candidate&rsquo;s output. Jarvis OS makes no provider call, holds no API key, and reads no
          secret.
        </Notice>

        <Panel title="Profiles" subtitle="Routing targets and their current posture">
          <DataTable
            caption="Model profiles with provider, data class, latency, circuit state and status."
            head={[
              'Profile',
              'Provider',
              'Data class',
              'Latency p95',
              'Circuit',
              'State',
              'Detail',
            ]}
          >
            {models.map((model) => (
              <Row key={model.id}>
                <Cell nowrap>{model.label}</Cell>
                <Cell muted nowrap>
                  {model.provider}
                </Cell>
                <Cell nowrap>
                  <Tag tone={model.dataClass === 'local-only' ? 'healthy' : 'warning'}>
                    {model.dataClass === 'local-only' ? 'Local only' : 'External provider'}
                  </Tag>
                </Cell>
                <Cell muted nowrap>
                  <span className="tabular">{model.latencyP95}</span>
                </Cell>
                <Cell nowrap>
                  <Tag
                    tone={
                      model.circuit === 'closed'
                        ? 'healthy'
                        : model.circuit === 'half-open'
                          ? 'warning'
                          : 'critical'
                    }
                  >
                    {model.circuit}
                  </Tag>
                </Cell>
                <Cell nowrap>
                  <StatusPill state={model.state} />
                </Cell>
                <Cell muted>{model.detail}</Cell>
              </Row>
            ))}
          </DataTable>
        </Panel>

        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          <Panel title="Provider independence" subtitle="Why the gateway exists">
            <ul className="space-y-2.5 text-[12px] leading-relaxed text-[var(--color-ink-muted)]">
              <li>No agent imports a provider SDK. Routing is one seam, not many.</li>
              <li>A provider can be replaced without touching agent behaviour.</li>
              <li>Budget, latency and circuit state are observed at the seam.</li>
              <li>Local inference becomes another profile, not a second architecture.</li>
            </ul>
          </Panel>
          <Panel title="Data class" subtitle="What leaves the estate">
            <ul className="space-y-2.5 text-[12px] leading-relaxed text-[var(--color-ink-muted)]">
              <li>
                <strong className="text-[var(--color-ink)]">External provider</strong> — the request
                leaves the estate. Governed content rules apply.
              </li>
              <li>
                <strong className="text-[var(--color-ink)]">Local only</strong> — inference stays on
                a node we operate. Planned, not attached.
              </li>
            </ul>
          </Panel>
        </div>
      </div>
    </>
  );
}
