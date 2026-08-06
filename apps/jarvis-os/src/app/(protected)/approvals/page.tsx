import { StackedShare } from '@/components/charts/Charts';
import { Cell, DataTable, Row } from '@/components/primitives/DataTable';
import { Notice, Panel, SectionHeading } from '@/components/primitives/Panel';
import type { Tone } from '@/components/primitives/Panel';
import { PageHeader } from '@/components/shell/PageHeader';
import { CapabilityBadge, Tag } from '@/components/system/StatusPill';
import { SectionBody, SourceBadge } from '@/components/system/Provenance';
import { controlPlane } from '@/lib/control-plane';
import type { ApprovalQueueRow } from '@/lib/control-plane/types';

/**
 * The approval desk (JOS-01A).
 *
 * Designed as the operator's primary working surface: a dense table where risk and requested
 * authority are COLUMNS rather than badges hidden in a detail pane. An approver decides by
 * comparing rows, so the row is the unit of design.
 *
 * ### Nothing here approves anything
 *
 * The Approve and Reject controls exist so the layout is proved at real width, and each is
 * disabled with a stated reason. That is the honest rendering: a desk drawn without its
 * controls would only be redesigned later, and a desk whose controls silently did nothing
 * would be far worse.
 *
 * The boundary they will eventually cross is worth stating on the page itself. A click in
 * Jarvis is a REQUEST for authorization, never an authorization — QuickFurno Core validates
 * identity, authority, current state, risk, expiry and eligibility, and may refuse what a
 * founder just asked for.
 */
const RISK_TONE: Readonly<Record<ApprovalQueueRow['risk'], Tone>> = {
  informational: 'offline',
  'low-risk-reversible': 'info',
  'client-or-vendor-facing': 'warning',
  'money-related': 'critical',
  'high-risk': 'critical',
};

const RISK_LABEL: Readonly<Record<ApprovalQueueRow['risk'], string>> = {
  informational: 'Informational',
  'low-risk-reversible': 'Low risk',
  'client-or-vendor-facing': 'Client/vendor',
  'money-related': 'Money-related',
  'high-risk': 'High risk',
};

const SLA_TONE: Readonly<Record<ApprovalQueueRow['slaState'], Tone>> = {
  ok: 'healthy',
  due: 'warning',
  breached: 'critical',
};

const SLA_LABEL: Readonly<Record<ApprovalQueueRow['slaState'], string>> = {
  ok: 'On time',
  due: 'Due',
  breached: 'Breached',
};

const STATE_LABEL: Readonly<Record<ApprovalQueueRow['state'], string>> = {
  'awaiting-operator': 'Awaiting operator',
  'awaiting-core': 'Awaiting Core',
  answered: 'Answered',
};

export default async function ApprovalsPage() {
  const plane = await controlPlane();
  const queue = plane.approvalQueue();

  return (
    <>
      <PageHeader
        breadcrumb={['Operate', 'Approvals']}
        title="Approval desk"
        purpose="Every ask awaiting a human or awaiting QuickFurno Core. A click here is a request for authorization — Core decides, and may refuse."
        status={<CapabilityBadge lifecycle="NOT_CONNECTED" />}
      />

      <div className="space-y-5">
        <Notice tone="offline" title="Backend unavailable — this desk is read-only">
          The durable approval queue and the Core submission adapter are merged, and Jarvis OS has
          no control-plane API to reach them. Approve and Reject are disabled everywhere on this
          page, and no approval decision can be created from this surface.
        </Notice>

        <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,2.4fr)_minmax(0,1fr)]">
          <Panel
            title="Pending queue"
            subtitle="Ordered by age. Risk and requested authority are columns, not footnotes."
            action={<SourceBadge availability={queue.availability} />}
          >
            <SectionBody section={queue}>
              {(rows) => (
                <DataTable
                  caption="Pending approval requests, with risk class, requested authority, source agent, age and state."
                  head={[
                    'Request',
                    'Risk',
                    'Authority',
                    'Agent',
                    'Subject',
                    'Age',
                    'SLA',
                    'State',
                    'Actions',
                  ]}
                >
                  {rows.map((row) => (
                    <Row key={row.id}>
                      <Cell>
                        <span className="block max-w-[30ch] truncate">{row.requestedAction}</span>
                        <span className="tabular mt-0.5 block text-[10.5px] text-[var(--color-ink-faint)]">
                          {row.id}
                        </span>
                      </Cell>
                      <Cell nowrap>
                        <Tag tone={RISK_TONE[row.risk]}>{RISK_LABEL[row.risk]}</Tag>
                      </Cell>
                      <Cell muted nowrap>
                        {row.requestedAuthority}
                      </Cell>
                      <Cell muted nowrap>
                        {row.sourceAgent}
                      </Cell>
                      <Cell muted nowrap>
                        {row.subject}
                      </Cell>
                      <Cell muted nowrap>
                        <span className="tabular">{row.age}</span>
                      </Cell>
                      <Cell nowrap>
                        <Tag tone={SLA_TONE[row.slaState]}>{SLA_LABEL[row.slaState]}</Tag>
                      </Cell>
                      <Cell muted nowrap>
                        {STATE_LABEL[row.state]}
                      </Cell>
                      <Cell nowrap>
                        <span className="flex gap-1.5">
                          <DisabledAction label="Approve" />
                          <DisabledAction label="Reject" />
                        </span>
                      </Cell>
                    </Row>
                  ))}
                </DataTable>
              )}
            </SectionBody>
          </Panel>

          <div className="space-y-5">
            <Panel
              title="Queue mix"
              subtitle="Pending states and outcomes"
              action={<SourceBadge availability={plane.approvalBreakdown().availability} />}
            >
              <SectionBody section={plane.approvalBreakdown()} compact>
                {(slices) => <StackedShare slices={slices} />}
              </SectionBody>
            </Panel>

            <Panel title="Inspector" subtitle="Detail pane — arrives with the control-plane API">
              <SectionHeading
                title="No request selected"
                caption="Row selection arrives with the authenticated control-plane API."
              />
              <p className="text-[12px] leading-relaxed text-[var(--color-ink-faint)]">
                The inspector will show the recommendation an ask was made about, the recomputed
                action fingerprint, the requested authority and the policy cited — the evidence an
                approver needs, rendered beside the decision rather than behind it.
              </p>
            </Panel>

            <Panel title="What an approval is not" subtitle="Two separate yeses are required">
              <ul className="space-y-2.5 text-[12px] leading-relaxed text-[var(--color-ink-muted)]">
                <li>An approval is not permission to contact anyone.</li>
                <li>Founder approval does not override an opt-out, a suppression or a STOP.</li>
                <li>
                  Communication eligibility is a separate Core artifact, revalidated at execution
                  time.
                </li>
              </ul>
            </Panel>
          </div>
        </div>
      </div>
    </>
  );
}

function DisabledAction({ label }: { readonly label: string }) {
  return (
    <button
      type="button"
      disabled
      title="Backend unavailable — no control-plane API in JOS-01A"
      className="rounded-[var(--radius-control)] border border-[var(--color-line)] px-2 py-[3px] text-[11px] text-[var(--color-ink-faint)] disabled:cursor-not-allowed"
    >
      {label}
      <span className="sr-only"> — disabled, backend unavailable</span>
    </button>
  );
}
