import { AgentFlowCanvas } from '@/components/agent-flow/AgentFlowCanvas';
import { Notice } from '@/components/primitives/Panel';
import { PageHeader } from '@/components/shell/PageHeader';

export default function AgentFlowsPage() {
  return (
    <>
      <PageHeader
        breadcrumb={['Agents', 'Agent Flow Studio']}
        title="Jarvis Agent Flow Studio"
        purpose="Read-only architecture mirror of code-backed agent journeys. Flow visibility is flexible; capability implementation and QuickFurno business authority remain locked underneath."
        status={
          <span className="rounded-full border border-[var(--color-line)] bg-[var(--color-base-850)] px-2.5 py-1 text-[9.5px] font-semibold tracking-[0.06em] text-[var(--color-healthy)] uppercase">
            Phase 1 · Read only
          </span>
        }
      />

      <Notice title="Guarded Flexibility">
        Pan, zoom and inspect the real Riya journey. This release cannot create connections, mutate
        production flows or change Core capabilities. Anisha and Aarohi will reuse this same engine
        after the Riya framework is certified.
      </Notice>

      <div className="mt-5">
        <AgentFlowCanvas />
      </div>
    </>
  );
}
