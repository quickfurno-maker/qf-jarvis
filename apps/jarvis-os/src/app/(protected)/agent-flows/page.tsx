import { AgentFlowPhase3Governance } from '@/components/agent-flow/AgentFlowPhase3Governance';
import { AgentFlowPhase3Studio } from '@/components/agent-flow/AgentFlowPhase3Studio';
import { Notice } from '@/components/primitives/Panel';
import { PageHeader } from '@/components/shell/PageHeader';

export default function AgentFlowsPage() {
  return (
    <>
      <PageHeader
        breadcrumb={['Agents', 'Agent Flow Studio']}
        title="Jarvis Agent Flow Studio"
        purpose="Controlled Riya, Anisha and Aarohi journeys with typed branching, bounded waits, event resume, live trace/replay and governed cross-agent handoffs. Capability implementation stays in code and QuickFurno Core remains business authority."
        status={
          <span className="rounded-full border border-[var(--color-line)] bg-[var(--color-base-850)] px-2.5 py-1 text-[9.5px] font-semibold tracking-[0.06em] text-[var(--color-healthy)] uppercase">
            Phase 3 · Controlled orchestration
          </span>
        }
      />

      <Notice title="Guarded Flexibility">
        Inspect Riya, Anisha, Aarohi and the cross-agent ALL view. Phase 3 adds typed soft
        orchestration over approved code-backed capabilities; production activation, arbitrary code
        nodes and direct Core business-state mutation remain impossible here.
      </Notice>

      <div className="mt-5">
        <AgentFlowPhase3Studio />
      </div>
      <AgentFlowPhase3Governance />
    </>
  );
}
