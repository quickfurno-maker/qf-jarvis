import {
  AGENT_FLOW_ALL_VIEW_V1,
  PHASE3_ORCHESTRATION_PROFILES,
} from '@qf-jarvis/agent-flow-orchestration';
import {
  AAROHI_ACQUISITION_FLOW_V1,
  ANISHA_VENDOR_FLOW_V1,
  RIYA_PHASE3_CONTROLLED_FLOW_V2,
} from '@qf-jarvis/agent-flow-registry';

import { Panel } from '@/components/primitives/Panel';
import { Tag } from '@/components/system/StatusPill';

const FLOWS = [
  RIYA_PHASE3_CONTROLLED_FLOW_V2,
  ANISHA_VENDOR_FLOW_V1,
  AAROHI_ACQUISITION_FLOW_V1,
] as const;

export function AgentFlowPhase3Governance() {
  return (
    <div className="mt-5 space-y-5">
      <div className="grid gap-5 xl:grid-cols-2">
        <Panel
          title="Phase 3 orchestration boundary"
          subtitle="Soft flow control is typed and bounded; business capability implementation stays in code."
        >
          <div className="flex flex-wrap gap-2">
            <Tag tone="healthy">3 agent flows</Tag>
            <Tag tone="healthy">Typed conditions</Tag>
            <Tag tone="healthy">Bounded waits</Tag>
            <Tag tone="healthy">Event resume</Tag>
            <Tag tone="healthy">Safe retry plans</Tag>
          </div>
          <ul className="mt-4 space-y-2 text-[10px] leading-relaxed text-[var(--color-ink-muted)]">
            <li>
              • Conditions use a closed operator vocabulary; arbitrary expressions are not accepted.
            </li>
            <li>• Wait/retry plans compile to the existing durable orchestration contracts.</li>
            <li>
              • Generated wait/retry/handoff plans carry <code>canExecute: false</code>.
            </li>
            <li>
              • Effectful node selection is restricted to code-locked Core-governed capabilities.
            </li>
            <li>• QuickFurno Core remains the final business authority.</li>
          </ul>
        </Panel>

        <Panel
          title="Activation posture"
          subtitle="Implementation complete does not mean silently activated in production."
        >
          <div className="flex flex-wrap gap-2">
            <Tag tone="shadow">Orchestration nodes SHADOW</Tag>
            <Tag tone="shadow">Human action DISABLED</Tag>
            <Tag tone="healthy">Current runtime preserved</Tag>
          </div>
          <p className="mt-4 text-[10px] leading-relaxed text-[var(--color-ink-muted)]">
            The Phase 3 graph can model conditions, waits, event resumes, retries and handoffs, but
            deployment/activation remains a separate governed release decision. Existing customer,
            vendor and prospect turns continue to use their existing coded runtime paths.
          </p>
        </Panel>
      </div>

      <Panel
        title="Agent orchestration profiles"
        subtitle="One shared control model, agent-specific flow/profile definitions."
      >
        <div className="grid gap-3 lg:grid-cols-3">
          {PHASE3_ORCHESTRATION_PROFILES.map((profile) => {
            const flow = FLOWS.find((candidate) => candidate.actor === profile.actor);
            return (
              <div
                key={profile.profileId}
                className="rounded-[var(--radius-control)] border border-[var(--color-line)] bg-[var(--color-base-850)] p-3.5"
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[11px] font-semibold text-[var(--color-ink)]">
                    {profile.actor}
                  </p>
                  <span className="text-[8px] text-[var(--color-warning)]">{flow?.status}</span>
                </div>
                <code className="mt-2 block break-all text-[8.5px] text-[var(--color-cyan)]">
                  {profile.profileId}
                </code>
                <dl className="mt-3 grid grid-cols-2 gap-2">
                  <Metric label="Conditions" value={profile.conditions.length} />
                  <Metric label="Routes" value={profile.routes.length} />
                  <Metric label="Waits" value={profile.waits.length} />
                  <Metric label="Retries" value={profile.retries.length} />
                </dl>
              </div>
            );
          })}
        </div>
      </Panel>

      <div className="grid gap-5 xl:grid-cols-2">
        <Panel
          title="Human & recovery controls"
          subtitle="Human takeover remains proposal-gated through the existing action registry."
        >
          <ul className="space-y-2 text-[10px] leading-relaxed text-[var(--color-ink-muted)]">
            <li>
              • The existing <code>request_human_takeover</code> action remains disabled by default.
            </li>
            <li>
              • Even an eligible assessment produces a proposal only; it does not execute takeover.
            </li>
            <li>• Every wait and retry policy has a bounded fallback node.</li>
            <li>• Effectful blind retry is not introduced.</li>
          </ul>
        </Panel>

        <Panel
          title="Cross-agent ALL view"
          subtitle="Ownership handoffs require authoritative evidence, not canvas arrows."
        >
          <div className="flex flex-wrap gap-2">
            <Tag tone="healthy">{`${String(AGENT_FLOW_ALL_VIEW_V1.actors.length)} agents`}</Tag>
            <Tag tone="healthy">Core business authority</Tag>
            <Tag tone="healthy">Execution authority NONE</Tag>
          </div>
          {AGENT_FLOW_ALL_VIEW_V1.crossAgentLinks.map((link) => (
            <div
              key={link.linkId}
              className="mt-3 rounded-[8px] border border-[var(--color-line)] bg-[var(--color-base-850)] px-3 py-2.5"
            >
              <p className="text-[10px] font-semibold text-[var(--color-ink)]">
                {link.fromAgent} → {link.toAgent}
              </p>
              <p className="mt-1 text-[9px] leading-relaxed text-[var(--color-ink-faint)]">
                {link.reason}
              </p>
            </div>
          ))}
        </Panel>
      </div>
    </div>
  );
}

function Metric({ label, value }: { readonly label: string; readonly value: number }) {
  return (
    <div className="rounded-[7px] border border-[var(--color-line)] px-2 py-1.5">
      <dt className="text-[7.5px] font-semibold text-[var(--color-ink-faint)] uppercase">
        {label}
      </dt>
      <dd className="mt-0.5 font-mono text-[10px] text-[var(--color-ink-muted)]">{value}</dd>
    </div>
  );
}
