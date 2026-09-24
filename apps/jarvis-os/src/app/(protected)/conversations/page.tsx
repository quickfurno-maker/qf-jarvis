import { ConversationCommandControls } from '@/components/operator/OperatorControls';
import { Cell, DataTable, Row } from '@/components/primitives/DataTable';
import { Notice, Panel } from '@/components/primitives/Panel';
import { PageHeader } from '@/components/shell/PageHeader';
import { Tag } from '@/components/system/StatusPill';
import { SectionBody, SourceBadge } from '@/components/system/Provenance';
import { controlPlane } from '@/lib/control-plane';

export default async function ConversationsPage() {
  const plane = await controlPlane();
  const rowsSection = plane.conversationControl();

  return (
    <>
      <PageHeader
        breadcrumb={['Operate', 'Conversations']}
        title="Conversations"
        purpose="Live conversation inventory and control posture. Message content stays out of this surface; operator actions remain revision-bound and Core-authorized."
        status={<SourceBadge availability={rowsSection.availability} />}
      />

      <div className="space-y-5">
        <Notice
          tone={rowsSection.availability === 'AVAILABLE' ? 'healthy' : 'offline'}
          title={rowsSection.availability === 'AVAILABLE' ? 'Conversation inventory connected' : 'Conversation inventory not connected'}
        >
          Only minimized identity and durable control state are shown. Takeover, pause and resume are
          submitted as signed operator commands; QuickFurno Core validates the current revision before
          any state change is applied.
        </Notice>

        <Panel
          title="Tracked conversations"
          subtitle="Operational state with content minimized by design"
          action={<SourceBadge availability={rowsSection.availability} />}
        >
          <SectionBody section={rowsSection}>
            {(rows) => (
              <DataTable
                caption="Conversations with their owning agent, control posture and governed actions."
                head={['Conversation', 'Subject', 'Agent', 'Posture', 'Revision', 'Actions']}
              >
                {rows.map((row) => (
                  <Row key={row.id}>
                    <Cell nowrap>
                      <span className="tabular font-mono text-[10.5px]">{row.id}</span>
                    </Cell>
                    <Cell muted nowrap>{row.subject}</Cell>
                    <Cell muted nowrap>{row.agent}</Cell>
                    <Cell nowrap>
                      <span className="flex gap-1.5">
                        <Tag tone={row.humanTakeover ? 'warning' : 'info'}>
                          {row.humanTakeover ? 'Human' : 'Agent'}
                        </Tag>
                        <Tag tone={row.aiPaused ? 'critical' : 'healthy'}>
                          {row.aiPaused ? 'AI paused' : 'AI active'}
                        </Tag>
                      </span>
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
      </div>
    </>
  );
}
