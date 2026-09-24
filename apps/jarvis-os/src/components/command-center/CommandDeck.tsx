import type { OperatorBootstrap, OperatorCapability } from '@qf-jarvis/operator-api-contract';

import { Panel } from '@/components/primitives/Panel';

const LABEL: Readonly<Record<OperatorCapability['action'], string>> = Object.freeze({
  APPROVAL_DECIDE: 'Approval decisions',
  CONVERSATION_TAKEOVER: 'Human takeover',
  CONVERSATION_RESUME_AI: 'Resume AI',
  CONVERSATION_PAUSE_AI: 'Pause AI',
  AGENT_SET_ENABLED: 'Agent enablement',
  KNOWLEDGE_SET_MODE: 'Knowledge mode',
  ROLLOUT_REQUEST_CHANGE: 'Production rollout',
});

function stateClass(state: OperatorCapability['state']): string {
  return state === 'AVAILABLE'
    ? 'text-[var(--color-healthy)]'
    : state === 'LOCKED'
      ? 'text-[var(--color-warning)]'
      : 'text-[var(--color-offline)]';
}

export function CommandDeck({ bootstrap }: { readonly bootstrap: OperatorBootstrap }) {
  const available = bootstrap.capabilities.filter((item) => item.state === 'AVAILABLE').length;

  return (
    <Panel
      title="Command authority"
      subtitle="Same versioned capability catalog for web and the future mobile app."
      className="command-deck"
      action={
        <span className="tabular text-[11px] text-[var(--color-ink-faint)]">
          API v{bootstrap.apiVersion} · {available}/{bootstrap.capabilities.length} live
        </span>
      }
    >
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {bootstrap.capabilities.map((capability) => (
          <div
            key={capability.action}
            className="command-cell rounded-[var(--radius-control)] border border-[var(--color-line)] px-3.5 py-3"
          >
            <div className="flex items-center justify-between gap-3">
              <p className="text-[12px] font-semibold text-[var(--color-ink)]">
                {LABEL[capability.action]}
              </p>
              <span
                className={"text-[9.5px] font-semibold tracking-[0.08em] uppercase " + stateClass(capability.state)}
              >
                {capability.state.replace('_', ' ')}
              </span>
            </div>
            <p className="mt-2 text-[11px] leading-relaxed text-[var(--color-ink-faint)]">
              {capability.reason}
            </p>
            <p className="mt-2 font-mono text-[9.5px] tracking-[0.05em] text-[var(--color-ink-faint)] uppercase">
              Authority · {capability.authority.replace('_', ' ')}
            </p>
          </div>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-[var(--color-line)] pt-3 text-[10.5px] text-[var(--color-ink-faint)]">
        <span>Web session adapter · ready</span>
        <span>Snapshot contract · v2</span>
        <span>Mobile device session · next</span>
      </div>
    </Panel>
  );
}
