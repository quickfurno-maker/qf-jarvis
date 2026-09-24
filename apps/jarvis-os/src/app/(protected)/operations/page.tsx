import { ConversationCommandControls } from '@/components/operator/OperatorControls';
import { Cell, DataTable, Row } from '@/components/primitives/DataTable';
import { ActivityFeed } from '@/components/operations/ActivityFeed';
import { Notice, Panel } from '@/components/primitives/Panel';
import { PageHeader } from '@/components/shell/PageHeader';
import { Tag } from '@/components/system/StatusPill';
import { SectionBody, SourceBadge } from '@/components/system/Provenance';
import { controlPlane } from '@/lib/control-plane';
import { isReadable } from '@/lib/control-plane/types';

/**
 * Operations Center.
 *
 * Reads durable conversation-control state through the governed snapshot and submits only
 * versioned operator commands. QuickFurno Core owns the compare-and-set mutation and may refuse
 * any stale or ineligible request; the UI never carries an authorization bit.
 */
export default async function OperationsPage() {
  const plane = await controlPlane();
  const control = plane.conversationControl();
  // A dash, not a zero. "0 conversations under human takeover" is a measurement; this surface has
  // not measured anything, and an operator reading a confident zero would stop looking.
  const readable = isReadable(control.availability);
  const takeovers = readable
    ? String(control.items.filter((row) => row.humanTakeover).length)
    : '—';
  const paused = readable ? String(control.items.filter((row) => row.aiPaused).length) : '—';
  const tracked = readable ? String(control.items.length) : '—';

  return (
    <>
      <PageHeader
        breadcrumb={['Operate', 'Operations Center']}
        title="Operations center"
        purpose="Human takeover, AI pause/resume and recent operator activity across conversations. QuickFurno Core remains authoritative for every state change."
        status={<SourceBadge availability={control.availability} />}
      />

      <div className="space-y-5">
        <Notice
          tone={control.availability === 'AVAILABLE' ? 'info' : 'offline'}
          title={control.availability === 'AVAILABLE' ? 'Conversation control connected' : 'Conversation control not connected'}
        >
          Jarvis OS submits signed, revision-bound operator commands. QuickFurno Core validates the
          current conversation state and may refuse a stale or ineligible command; Jarvis OS never
          grants itself conversation authority.
        </Notice>

        <div className="grid grid-cols-1 gap-px overflow-hidden rounded-[var(--radius-panel)] border border-[var(--color-line)] bg-[var(--color-line)] sm:grid-cols-3">
          <Summary
            label="Human takeover"
            value={takeovers}
            caption="Conversations an operator holds"
          />
          <Summary
            label="AI paused"
            value={paused}
            caption="Automation suspended pending a human"
          />
          <Summary
            label="Tracked"
            value={tracked}
            caption="Conversations with durable control state"
          />
        </div>

        <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,2.2fr)_minmax(0,1fr)]">
          <Panel
            title="Conversation control"
            subtitle="Durable control state per conversation"
            action={<SourceBadge availability={control.availability} />}
          >
            <SectionBody section={control}>
              {(rows) => (
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
                        <ConversationCommandControls
                          conversationId={row.id}
                          revision={row.revision}
                          humanTakeover={row.humanTakeover}
                          aiPaused={row.aiPaused}
                        />
                      </Cell>
                    </Row>
                  ))}
                </DataTable>
              )}
            </SectionBody>
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

            <Panel
              title="Recent milestones"
              subtitle="Merged repository and governance events"
              action={<SourceBadge availability={plane.activity().availability} />}
            >
              <SectionBody section={plane.activity()} compact>
                {(entries) => <ActivityFeed entries={entries.slice(0, 5)} />}
              </SectionBody>
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
