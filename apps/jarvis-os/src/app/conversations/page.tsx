import { Cell, DataTable, Row } from '@/components/primitives/DataTable';
import { Notice, Panel } from '@/components/primitives/Panel';
import { PageHeader } from '@/components/shell/PageHeader';
import { CapabilityBadge, Tag } from '@/components/system/StatusPill';
import { SectionBody, SourceBadge } from '@/components/system/Provenance';
import { controlPlane } from '@/lib/control-plane';

/**
 * Conversations (JOS-01A).
 *
 * An inventory rather than a transcript viewer. Message content is deliberately absent: a
 * conversation list is read far more often than it is acted on, and every field it carries
 * ends up in a screenshot, a log or a support ticket. Identity here is an opaque reference.
 */
export default function ConversationsPage() {
  const rowsSection = controlPlane().conversationControl();

  return (
    <>
      <PageHeader
        breadcrumb={['Operate', 'Conversations']}
        title="Conversations"
        purpose="Inventory and control posture. No message content is shown, and no transcript is stored by this surface."
        status={<CapabilityBadge lifecycle="NOT_CONNECTED" />}
      />

      <div className="space-y-5">
        <Notice tone="info" title="No message content, by design">
          This surface shows opaque references and control state only. Conversation content belongs
          to the systems that govern it, and a list view is the wrong place to expose it.
        </Notice>

        <Panel
          title="Tracked conversations"
          subtitle="Those with durable control state"
          action={<SourceBadge availability={rowsSection.availability} />}
        >
          <SectionBody section={rowsSection}>
            {(rows) => (
              <DataTable
                caption="Conversations with their owning agent and current control posture."
                head={['Conversation', 'Subject', 'Agent', 'Posture', 'Last action', 'Revision']}
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
                      <span className="flex gap-1.5">
                        <Tag tone={row.humanTakeover ? 'warning' : 'offline'}>
                          {row.humanTakeover ? 'Operator' : 'Agent'}
                        </Tag>
                        <Tag tone={row.aiPaused ? 'critical' : 'healthy'}>
                          {row.aiPaused ? 'Paused' : 'Active'}
                        </Tag>
                      </span>
                    </Cell>
                    <Cell muted nowrap>
                      {row.lastOperatorAction}
                    </Cell>
                    <Cell muted nowrap>
                      <span className="tabular">{row.revision}</span>
                    </Cell>
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
