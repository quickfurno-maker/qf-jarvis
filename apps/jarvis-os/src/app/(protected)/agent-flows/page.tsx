import { AgentFlowCanvas } from '@/components/agent-flow/AgentFlowCanvas';
import { AgentFlowPhase2Governance } from '@/components/agent-flow/AgentFlowPhase2Governance';
import { Notice } from '@/components/primitives/Panel';
import { PageHeader } from '@/components/shell/PageHeader';

export default function AgentFlowsPage() {
  return (
    <>
      <PageHeader
        breadcrumb={['Agents', 'Agent Flow Studio']}
        title="Jarvis Agent Flow Studio"
        purpose="Live trace, historical replay, zero-effect regression and versioned safe configuration for code-backed agent journeys. Capability implementation and QuickFurno business authority remain locked underneath."
        status={
          <span className="rounded-full border border-[var(--color-line)] bg-[var(--color-base-850)] px-2.5 py-1 text-[9.5px] font-semibold tracking-[0.06em] text-[var(--color-healthy)] uppercase">
            Phase 2 · Guarded control
          </span>
        }
      />

      <Notice title="Guarded Flexibility">
        Observe and replay the real Riya journey, inspect versioned profiles and certify draft
        configuration against architecture lint and zero-effect regression. Production flow mutation,
        arbitrary code nodes and Core capability changes remain impossible here.
      </Notice>

      <div className="mt-5">
        <AgentFlowCanvas />
      </div>
      <AgentFlowPhase2Governance />
    </>
  );
}
