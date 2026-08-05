import { Cell, DataTable, Row } from '@/components/primitives/DataTable';
import { Notice, Panel } from '@/components/primitives/Panel';
import { PageHeader } from '@/components/shell/PageHeader';
import { CapabilityBadge, StatusPill } from '@/components/system/StatusPill';
import { SectionBody, SourceBadge } from '@/components/system/Provenance';
import { controlPlane } from '@/lib/control-plane';

/**
 * Knowledge (JOS-01A).
 *
 * Namespaces are per-agent and deliberately not shared. Shared plumbing must not become a
 * shared identity: if Anisha's vendor-care material were reachable by Riya, four bounded
 * agents would quietly have become one unbounded agent with four names.
 *
 * Retrieval is off, and nothing on this page mutates a namespace.
 */
export default async function KnowledgePage() {
  const namespacesSection = (await controlPlane()).knowledge();

  return (
    <>
      <PageHeader
        breadcrumb={['Intelligence', 'Knowledge']}
        title="Governed knowledge"
        purpose="Per-agent namespaces with no shared identity. Retrieved content is untrusted reference material — never authority."
        status={<CapabilityBadge lifecycle="DISABLED" />}
      />

      <div className="space-y-5">
        <Notice tone="offline" title="Retrieval is off and nothing is provisioned">
          The provisioning contracts are merged; no namespace holds content, and this surface
          mutates nothing.
        </Notice>

        <Panel
          title="Namespaces"
          subtitle="One per agent, scoped to that agent's own material"
          action={<SourceBadge availability={namespacesSection.availability} />}
        >
          <SectionBody section={namespacesSection}>
            {(namespaces) => (
              <DataTable
                caption="Governed knowledge namespaces, their owning agent scope and readiness."
                head={['Namespace', 'Scope', 'State', 'Detail']}
              >
                {namespaces.map((namespace) => (
                  <Row key={namespace.id}>
                    <Cell nowrap>
                      <span className="font-mono text-[11.5px]">{namespace.label}</span>
                    </Cell>
                    <Cell muted nowrap>
                      {namespace.owner}
                    </Cell>
                    <Cell nowrap>
                      <StatusPill state={namespace.state} />
                    </Cell>
                    <Cell muted>{namespace.detail}</Cell>
                  </Row>
                ))}
              </DataTable>
            )}
          </SectionBody>
        </Panel>

        <Panel title="Retrieved content is not authority" subtitle="A standing rule">
          <p className="max-w-[80ch] text-[12px] leading-relaxed text-[var(--color-ink-muted)]">
            A retrieved passage is reference material an agent may reason with. It never becomes a
            permission, a price, a commitment or a business fact — those belong to QuickFurno Core.
            An agent that treated a document as authorization would be exactly the failure the
            namespace boundary exists to prevent.
          </p>
        </Panel>
      </div>
    </>
  );
}
