import {
  AOS_BEHAVIOUR_REGISTRY_V1,
  AOS_BUSINESS_GOALS,
  AOS_GOAL_PRECEDENCE,
} from '@qf-jarvis/aos-intelligence';

import { Panel } from '@/components/primitives/Panel';
import { Tag } from '@/components/system/StatusPill';

function conditionLabel(input: {
  readonly field: string;
  readonly operator: string;
  readonly value: number;
}): string {
  return input.field + ' ' + input.operator + ' ' + String(input.value);
}

export function AosBehaviourStudio() {
  const policies = AOS_BEHAVIOUR_REGISTRY_V1.policies;

  return (
    <div className="space-y-5">
      <Panel
        title="Behaviour control"
        subtitle="Capabilities stay code-backed; thresholds, timing, scope, cooldowns and approval posture are governed policy data."
        action={<Tag tone="shadow">SUGGEST ONLY</Tag>}
      >
        <div className="grid gap-px overflow-hidden rounded-[var(--radius-control)] border border-[var(--color-line)] bg-[var(--color-line)] md:grid-cols-2 xl:grid-cols-4">
          {[
            ['Policies', String(policies.length)],
            ['Max vendor exposure', '3 before owner approval'],
            ['Direct phone in reactivation', 'Never'],
            ['Policy activation', 'Simulation + Digital Twin + owner approval'],
          ].map(([label, value]) => (
            <div key={label} className="bg-[var(--color-base-850)] px-4 py-3">
              <p className="text-[9px] font-semibold tracking-[0.08em] text-[var(--color-ink-faint)] uppercase">
                {label}
              </p>
              <p className="mt-1 text-[11.5px] font-semibold text-[var(--color-ink)]">{value}</p>
            </div>
          ))}
        </div>
      </Panel>

      <Panel
        title="Business objective precedence"
        subtitle="A lower business goal cannot override a higher-priority trust or lead-delivery constraint."
      >
        <div className="flex flex-wrap gap-2">
          {[...AOS_BUSINESS_GOALS]
            .sort((a, b) => AOS_GOAL_PRECEDENCE[a] - AOS_GOAL_PRECEDENCE[b])
            .map((goal, index) => (
              <div
                key={goal}
                className="rounded-[var(--radius-control)] border border-[var(--color-line)] bg-[var(--color-base-850)] px-3 py-2"
              >
                <span className="mr-2 text-[9px] text-[var(--color-ink-faint)]">{index + 1}</span>
                <span className="text-[10.5px] font-semibold text-[var(--color-ink-muted)]">
                  {goal.replaceAll('_', ' ')}
                </span>
              </div>
            ))}
        </div>
      </Panel>

      <Panel
        title="Governed policy registry"
        subtitle="These are safe behaviour definitions, not arbitrary executable expressions. DRAFT/SHADOW/SUGGESTING/RETIRED are the only current lifecycles."
      >
        <div className="grid gap-3 lg:grid-cols-2">
          {policies.map((policy) => (
            <article
              key={policy.policyId + ':' + String(policy.version)}
              className="rounded-[var(--radius-control)] border border-[var(--color-line)] bg-[var(--color-base-850)] p-4"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-[12px] font-semibold text-[var(--color-ink)]">
                    {policy.title}
                  </p>
                  <p className="mt-1 font-mono text-[9px] text-[var(--color-ink-faint)]">
                    {policy.policyId} · v{policy.version}
                  </p>
                </div>
                <span className="rounded-full border border-[var(--color-line)] px-2 py-1 text-[8.5px] font-semibold text-[var(--color-warning)]">
                  {policy.lifecycle}
                </span>
              </div>

              <dl className="mt-3 grid grid-cols-[105px_minmax(0,1fr)] gap-x-3 gap-y-2 text-[10px]">
                <dt className="text-[var(--color-ink-faint)]">Trigger</dt>
                <dd className="text-[var(--color-ink-muted)]">{policy.trigger}</dd>
                <dt className="text-[var(--color-ink-faint)]">Action</dt>
                <dd className="break-words text-[var(--color-ink-muted)]">{policy.action}</dd>
                <dt className="text-[var(--color-ink-faint)]">Conditions</dt>
                <dd className="text-[var(--color-ink-muted)]">
                  {policy.conditions.length === 0
                    ? 'None'
                    : policy.conditions.map(conditionLabel).join(' · ')}
                </dd>
                <dt className="text-[var(--color-ink-faint)]">Cooldown</dt>
                <dd className="text-[var(--color-ink-muted)]">
                  {policy.communication.cooldownMinutes} min
                </dd>
                <dt className="text-[var(--color-ink-faint)]">Owner approval</dt>
                <dd className="text-[var(--color-ink-muted)]">
                  {policy.ownerApprovalRequired ? 'Required' : 'Not required for suggestion'}
                </dd>
              </dl>

              <div className="mt-3 flex flex-wrap gap-1.5 border-t border-[var(--color-line)] pt-3">
                <Tag tone="offline">NO EXECUTION AUTHORITY</Tag>
                {policy.communication.maskedOpportunityOnly ? (
                  <Tag tone="info">MASKED OPPORTUNITY</Tag>
                ) : null}
                {policy.coreDecisionRequired ? <Tag tone="healthy">CORE DECISION</Tag> : null}
              </div>
            </article>
          ))}
        </div>
      </Panel>
    </div>
  );
}
