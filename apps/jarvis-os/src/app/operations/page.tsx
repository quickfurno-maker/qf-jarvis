import { Cell, DataTable, Row } from '@/components/primitives/DataTable';
import { ActivityFeed } from '@/components/operations/ActivityFeed';
import { Notice, Panel } from '@/components/primitives/Panel';
import { PageHeader } from '@/components/shell/PageHeader';
import { CapabilityBadge, Tag } from '@/components/system/StatusPill';
import { controlPlane } from '@/lib/control-plane';

/**
 * Operations Center (JOS-01A).
 *
 * Human control state: who has taken over, where the AI is paused, and what an operator last
 * did. In this release it is a read surface — the takeover and resume controls are rendered
 * disabled, because `conversation.control.write` is deliberately DISABLED in Jarvis OS and a
 * control that appeared to work would be the single most dangerous thing on this screen.
 */
export default function OperationsPage() {
  const plane = controlPlane();
  const rows = plane.conversationControl();
  const takeovers = rows.filter((row) => row.humanTakeover).length;
  const paused = rows.filter((row) => row.aiPaused).length;

  return (
    <>
      <PageHeader
        breadcrumb={['Operate', 'Operations Center']}
        title="Operations center"
        purpose="Human takeover, AI pause state and recent operator activity across conversations. Read-only in this release."
        status={<CapabilityBadge lifecycle="DISABLED" />}
      />

      <div className="space-y-5">
        <Notice tone="offline" title="Control actions are disabled in Jarvis OS">
          Human takeover and pause/resume are durable, merged capabilities of the backend. This
          surface can read them once a control-plane API exists; it will never hold the authority
          itself. Every control below is disabled and labelled.
        </Notice>

        <div className="grid grid-cols-1 gap-px overflow-hidden rounded-[var(--radius-panel)] border border-[var(--color-line)] bg-[var(--color-line)] sm:grid-cols-3">
          <Summary
            label="Human takeover"
            value={String(takeovers)}
            caption="Conversations an operator holds"
          />
          <Summary
            label="AI paused"
            value={String(paused)}
            caption="Automation suspended pending a human"
          />
          <Summary
            label="Tracked"
            value={String(rows.length)}
            caption="Conversations with durable control state"
          />
        </div>

        <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,2.2fr)_minmax(0,1fr)]">
          <Panel title="Conversation control" subtitle="Durable control state per conversation">
            <DataTable
              caption="Conversation control state, including human takeover, AI pause and the last operator action."
              head={[
                'Conversation',
                'Subject',
                'Agent',
                'Takeover',
                'AI',
                'Last action',
                'Rev',
                'Actions',
              ]}
            >
              {rows.map((row) => (
                <Row key={row.id}>
                  <Cell nowrap>
                    <span className="tabular">{row.id}</span>
                  </Cell>
                  <Cell muted nowrap>
                    {row.subject}
                  </Cell>
                  <Cell muted nowrap>
                    {row.agent}
                  </Cell>
                  <Cell nowrap>
                    <Tag tone={row.humanTakeover ? 'warning' : 'offline'}>
                      {row.humanTakeover ? 'Operator' : 'Agent'}
                    </Tag>
                  </Cell>
                  <Cell nowrap>
                    <Tag tone={row.aiPaused ? 'critical' : 'healthy'}>
                      {row.aiPaused ? 'Paused' : 'Active'}
                    </Tag>
                  </Cell>
                  <Cell muted nowrap>
                    {row.lastOperatorAction}
                  </Cell>
                  <Cell muted nowrap>
                    <span className="tabular">{row.revision}</span>
                  </Cell>
                  <Cell nowrap>
                    <span className="flex gap-1.5">
                      <DisabledControl label="Take over" />
                      <DisabledControl label="Resume" />
                    </span>
                  </Cell>
                </Row>
              ))}
            </DataTable>
          </Panel>

          <div className="space-y-5">
            <Panel title="Safety posture" subtitle="Standing rules, not settings">
              <ul className="space-y-2.5 text-[12px] leading-relaxed text-[var(--color-ink-muted)]">
                <li>No capability → no action. A missing answer is a no.</li>
                <li>No consent → no outbound. Unknown or stale consent is not permission.</li>
                <li>No approval → no sensitive execution.</li>
                <li>Ambiguity escalates to a human rather than resolving itself.</li>
              </ul>
            </Panel>

            <Panel title="Recent operator activity" subtitle="Provenance-labelled">
              <ActivityFeed entries={plane.activity().slice(0, 5)} />
            </Panel>
          </div>
        </div>
      </div>
    </>
  );
}

function Summary({
  label,
  value,
  caption,
}: {
  readonly label: string;
  readonly value: string;
  readonly caption: string;
}) {
  return (
    <div className="surface-lift bg-[var(--color-base-900)] px-4 py-4">
      <p className="text-[11px] font-medium tracking-[0.02em] text-[var(--color-ink-muted)] uppercase">
        {label}
      </p>
      <p className="tabular mt-2 text-[26px] leading-none font-semibold text-[var(--color-ink)]">
        {value}
      </p>
      <p className="mt-2 text-[11px] text-[var(--color-ink-faint)]">{caption}</p>
    </div>
  );
}

function DisabledControl({ label }: { readonly label: string }) {
  return (
    <button
      type="button"
      disabled
      title="Disabled — Jarvis OS holds no conversation-control authority"
      className="rounded-[var(--radius-control)] border border-[var(--color-line)] px-2 py-[3px] text-[11px] text-[var(--color-ink-faint)] disabled:cursor-not-allowed"
    >
      {label}
      <span className="sr-only"> — disabled, no control authority in Jarvis OS</span>
    </button>
  );
}
