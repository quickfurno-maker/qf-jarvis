import { RIYA_WHATSAPP_CLIENT_FLOW_V1 } from '@qf-jarvis/agent-flow-registry';
import {
  AGENT_FLOW_LIFECYCLE_STAGES,
  RIYA_AGENT_FLOW_PROFILES_V1,
  RIYA_PHASE2_DRAFT_MANIFEST_V2,
  RIYA_PHASE2_REGRESSION_SCENARIOS,
  evaluateAgentFlowPromotion,
  lintAgentFlow,
} from '@qf-jarvis/agent-flow-governance';

import { Panel } from '@/components/primitives/Panel';
import { Tag } from '@/components/system/StatusPill';

export function AgentFlowPhase2Governance() {
  const lint = lintAgentFlow({
    flow: RIYA_WHATSAPP_CLIENT_FLOW_V1,
    manifest: RIYA_PHASE2_DRAFT_MANIFEST_V2,
    profiles: RIYA_AGENT_FLOW_PROFILES_V1,
  });
  const next = evaluateAgentFlowPromotion(RIYA_PHASE2_DRAFT_MANIFEST_V2, 'SIMULATION');

  return (
    <div className="mt-5 space-y-5">
      <div className="grid gap-5 xl:grid-cols-2">
        <Panel
          title="Version lifecycle"
          subtitle="Repository-governed configuration. No Draft → Live shortcut exists."
        >
          <div className="flex flex-wrap items-center gap-1.5">
            {AGENT_FLOW_LIFECYCLE_STAGES.map((stage, index) => (
              <div key={stage} className="flex items-center gap-1.5">
                <span
                  className={[
                    'rounded-full border px-2.5 py-1 text-[9px] font-semibold',
                    stage === RIYA_PHASE2_DRAFT_MANIFEST_V2.lifecycle
                      ? 'border-[var(--color-accent-dim)] text-[var(--color-accent-bright)]'
                      : 'border-[var(--color-line)] text-[var(--color-ink-faint)]',
                  ].join(' ')}
                >
                  {stage}
                </span>
                {index === AGENT_FLOW_LIFECYCLE_STAGES.length - 1 ? null : (
                  <span className="text-[var(--color-ink-faint)]">→</span>
                )}
              </div>
            ))}
          </div>
          <dl className="mt-4 grid gap-2 text-[10.5px] sm:grid-cols-2">
            <Fact label="Version" value={RIYA_PHASE2_DRAFT_MANIFEST_V2.versionId} />
            <Fact label="Registry baseline" value={RIYA_PHASE2_DRAFT_MANIFEST_V2.registryBaselineRef} />
            <Fact label="Configuration digest" value={RIYA_PHASE2_DRAFT_MANIFEST_V2.configurationDigest.slice(0, 24) + '…'} />
            <Fact
              label="Next gate"
              value={next.allowed ? 'DRAFT → SIMULATION allowed' : next.reasons.join(', ')}
            />
          </dl>
          <p className="mt-3 text-[10px] leading-relaxed text-[var(--color-ink-faint)]">
            LIVE requires fresh certification evidence, zero protected regression failures and an
            explicit rollback target. Promotion never grants QuickFurno business authority.
          </p>
        </Panel>

        <Panel
          title="Architecture lint"
          subtitle="Machine-checkable boundaries are evaluated before any promotion."
        >
          <div className="flex flex-wrap gap-2">
            <Tag tone={lint.errors === 0 ? 'healthy' : 'critical'}>{`${String(lint.errors)} errors`}</Tag>
            <Tag tone={lint.warnings === 0 ? 'healthy' : 'shadow'}>{`${String(lint.warnings)} warnings`}</Tag>
            <Tag tone={lint.promotable ? 'healthy' : 'critical'}>
              {lint.promotable ? 'Structurally promotable' : 'HOLD'}
            </Tag>
          </div>
          <div className="mt-3 space-y-2">
            {lint.issues.length === 0 ? (
              <p className="text-[10.5px] text-[var(--color-ink-muted)]">No lint findings.</p>
            ) : (
              lint.issues.slice(0, 5).map((item) => (
                <div
                  key={item.code + ':' + item.subjectRef}
                  className="rounded-[8px] border border-[var(--color-line)] px-3 py-2"
                >
                  <p className="text-[9px] font-semibold text-[var(--color-ink-muted)]">
                    {item.severity} · {item.code}
                  </p>
                  <p className="mt-1 text-[9.5px] leading-relaxed text-[var(--color-ink-faint)]">
                    {item.message}
                  </p>
                </div>
              ))
            )}
          </div>
        </Panel>
      </div>
      <Panel
        title="Approved configuration profiles"
        subtitle="The canvas may select reviewed profiles; it cannot rewrite the capability underneath."
      >
        <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
          {RIYA_AGENT_FLOW_PROFILES_V1.map((profile) => (
            <div
              key={profile.profileId}
              className="rounded-[var(--radius-control)] border border-[var(--color-line)] px-3.5 py-3"
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-[9px] font-semibold tracking-[0.07em] text-[var(--color-ink-faint)] uppercase">
                    {profile.kind}
                  </p>
                  <p className="mt-1 text-[11px] font-semibold text-[var(--color-ink)]">
                    {profile.label}
                  </p>
                </div>
                <span className="rounded-full border border-[var(--color-line)] px-2 py-0.5 text-[8px] text-[var(--color-ink-faint)]">
                  v{profile.version}
                </span>
              </div>
              <code className="mt-2 block break-all text-[9px] text-[var(--color-cyan)]">
                {profile.profileId}
              </code>
              <p className="mt-2 text-[9.5px] leading-relaxed text-[var(--color-ink-faint)]">
                {profile.description}
              </p>
              <p className="mt-2 text-[8.5px] font-semibold text-[var(--color-ink-muted)]">
                {profile.productionEligible ? 'Production-eligible reference' : 'Activation locked until Phase 3'}
              </p>
            </div>
          ))}
        </div>
      </Panel>
      <div className="grid gap-5 xl:grid-cols-2">
        <Panel
          title="Protected regression library"
          subtitle="Synthetic replay only. Any provider/Core/channel/workflow/database effect fails the scenario."
        >
          <div className="flex flex-wrap gap-2">
            <Tag tone="healthy">{`${String(RIYA_PHASE2_REGRESSION_SCENARIOS.length)} scenarios`}</Tag>
            <Tag tone="healthy">Zero-effect enforced</Tag>
            <Tag tone="healthy">Digital twin reused</Tag>
          </div>
          <div className="mt-3 grid gap-1.5 sm:grid-cols-2">
            {RIYA_PHASE2_REGRESSION_SCENARIOS.map((scenario) => (
              <div
                key={scenario.scenarioId}
                className="rounded-[7px] border border-[var(--color-line)] px-2.5 py-2"
              >
                <p className="text-[9.5px] font-medium text-[var(--color-ink-muted)]">
                  {scenario.label}
                </p>
                <p className="mt-0.5 text-[8px] text-[var(--color-ink-faint)]">
                  {scenario.category} · {scenario.expectedDecision}
                </p>
              </div>
            ))}
          </div>
        </Panel>

        <Panel
          title="Phase 2 safety posture"
          subtitle="What is deliberately still impossible from Agent Flow Studio."
        >
          <ul className="space-y-2 text-[10.5px] leading-relaxed text-[var(--color-ink-muted)]">
            <li>• Historical replay reads trace metadata; it never re-executes a node.</li>
            <li>• Simulation rejects provider, Core, channel, workflow and database effects.</li>
            <li>• No arbitrary JavaScript, SQL or unrestricted HTTP node exists.</li>
            <li>• Prompt/model/context/tool selection is profile-bound and versioned.</li>
            <li>• Wait, retry and human-handoff profiles are defined but activation-locked until Phase 3.</li>
            <li>• QuickFurno Core remains the final business authority.</li>
          </ul>
        </Panel>
      </div>
    </div>
  );
}

function Fact({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <div className="rounded-[8px] border border-[var(--color-line)] px-3 py-2">
      <dt className="text-[8.5px] font-semibold tracking-[0.06em] text-[var(--color-ink-faint)] uppercase">
        {label}
      </dt>
      <dd className="mt-1 break-all font-mono text-[9.5px] text-[var(--color-ink-muted)]">{value}</dd>
    </div>
  );
}
