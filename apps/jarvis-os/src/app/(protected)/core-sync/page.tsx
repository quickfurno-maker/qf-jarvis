import { Cell, DataTable, Row } from '@/components/primitives/DataTable';
import { Notice, Panel } from '@/components/primitives/Panel';
import { PageHeader } from '@/components/shell/PageHeader';
import { CapabilityBadge, Tag } from '@/components/system/StatusPill';
import { SourceBadge } from '@/components/system/Provenance';
import { controlPlane } from '@/lib/control-plane';

/**
 * QuickFurno Core Sync (JOS-01A).
 *
 * The boundary screen. Its job is to make the source-of-truth split impossible to misread,
 * because every serious failure this architecture guards against begins with someone
 * assuming Jarvis owns something Core owns.
 *
 * The ownership table is rendered from data rather than prose so it can be asserted by a
 * test, and the three standing rules — Core wins, fail closed, no direct business mutation —
 * are stated as headings rather than buried in a paragraph.
 */
export default async function CoreSyncPage() {
  const rowsSection = (await controlPlane()).ownership();
  // Ownership is STATIC_BASELINE: declared by governance, not read from Core. It genuinely has
  // rows, so it renders normally -- with a badge saying where they came from.
  const rows = rowsSection.items;
  const core = rows.filter((row) => row.owner === 'QuickFurno Core');
  const jarvis = rows.filter((row) => row.owner === 'QF Jarvis');

  return (
    <>
      <PageHeader
        breadcrumb={['Boundary', 'QuickFurno Core Sync']}
        title="QuickFurno Core boundary"
        purpose="What Core owns, what Jarvis derives, and what happens when they disagree. Jarvis never creates a second business truth."
        status={<CapabilityBadge lifecycle="NOT_CONNECTED" />}
      />

      <div className="space-y-5">
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
          <Rule title="CORE WINS" tone="healthy">
            Where Core and Jarvis disagree about a business fact, Core is right. Jarvis re-reads; it
            never reconciles in its own favour.
          </Rule>
          <Rule title="FAIL CLOSED" tone="warning">
            No capability, no consent, no approval, or no answer at all — each means no action. An
            unreachable Core is never read as permission.
          </Rule>
          <Rule title="NO DIRECT BUSINESS MUTATION" tone="critical">
            Jarvis writes no vendor, customer, package, price, payment or consent record. It
            recommends; Core decides and records.
          </Rule>
        </div>

        <Notice tone="offline" title="No Jarvis↔Core transport has been adopted">
          Core remains authoritative regardless. This surface shows the boundary, not a live
          connection, and no endpoint, credential format or auth protocol has been invented here.
        </Notice>

        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          <Panel
            title="QuickFurno Core is authoritative"
            subtitle="Business truth. Jarvis reads it and never writes it."
            action={<SourceBadge availability={rowsSection.availability} />}
          >
            <DataTable caption="Subjects QuickFurno Core owns." head={['Subject', 'Detail']}>
              {core.map((row) => (
                <Row key={row.id}>
                  <Cell nowrap>
                    <span className="flex items-center gap-2">
                      <Tag tone="healthy">CORE</Tag>
                      {row.subject}
                    </span>
                  </Cell>
                  <Cell muted>{row.detail}</Cell>
                </Row>
              ))}
            </DataTable>
          </Panel>

          <Panel
            title="QF Jarvis derives"
            subtitle="Interpretation and coordination. Powerless by construction."
          >
            <DataTable caption="Subjects QF Jarvis derives." head={['Subject', 'Detail']}>
              {jarvis.map((row) => (
                <Row key={row.id}>
                  <Cell nowrap>
                    <span className="flex items-center gap-2">
                      <Tag tone="info">JARVIS</Tag>
                      {row.subject}
                    </span>
                  </Cell>
                  <Cell muted>{row.detail}</Cell>
                </Row>
              ))}
            </DataTable>
          </Panel>
        </div>

        <Panel title="The permanent flow" subtitle="Every arrow, in order">
          <ol className="flex flex-wrap items-center gap-2 text-[11.5px]">
            {[
              'QuickFurno Core',
              'signed events',
              'Jarvis',
              'recommendation / approval request',
              'Core authorizes',
              'n8n executes',
              'provider delivers',
              'result → Core',
              'reflected to Jarvis',
            ].map((step, index) => (
              <li key={step} className="flex items-center gap-2">
                {index > 0 ? (
                  <span aria-hidden="true" className="text-[var(--color-ink-faint)]">
                    →
                  </span>
                ) : null}
                <span className="rounded-[var(--radius-control)] border border-[var(--color-line)] bg-[var(--color-base-850)] px-2.5 py-1.5 text-[var(--color-ink-muted)]">
                  {step}
                </span>
              </li>
            ))}
          </ol>
        </Panel>
      </div>
    </>
  );
}

function Rule({
  title,
  tone,
  children,
}: {
  readonly title: string;
  readonly tone: 'healthy' | 'warning' | 'critical';
  readonly children: string;
}) {
  const border =
    tone === 'healthy'
      ? 'border-[var(--color-healthy)]/30'
      : tone === 'warning'
        ? 'border-[var(--color-warning)]/30'
        : 'border-[var(--color-critical)]/30';
  const text =
    tone === 'healthy'
      ? 'text-[var(--color-healthy)]'
      : tone === 'warning'
        ? 'text-[var(--color-warning)]'
        : 'text-[var(--color-critical)]';

  return (
    <div
      className={`surface-lift rounded-[var(--radius-panel)] border ${border} bg-[var(--color-base-900)] px-5 py-4`}
    >
      <p className={`text-[12px] font-semibold tracking-[0.08em] ${text}`}>{title}</p>
      <p className="mt-2 text-[12px] leading-relaxed text-[var(--color-ink-muted)]">{children}</p>
    </div>
  );
}
