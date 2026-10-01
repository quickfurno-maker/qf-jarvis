import { Panel } from '@/components/primitives/Panel';
import { Tag } from '@/components/system/StatusPill';

const STACK = Object.freeze([
  {
    capability: 'JAO-5 / proactive worker',
    state: 'INTEGRATED',
    tone: 'healthy' as const,
    detail:
      'Shared SHADOW cadence, sequential cycles and failure budget. JAO-5 business scope itself is not widened.',
  },
  {
    capability: 'Model Intelligence Control',
    state: 'INTEGRATED',
    tone: 'healthy' as const,
    detail:
      'Exact verifier-backed certified release selection for model cases; deterministic cases remain NO_MODEL.',
  },
  {
    capability: 'Decision Intelligence / Jev',
    state: 'OPTIONAL SHADOW',
    tone: 'shadow' as const,
    detail:
      'Second opinion only for novel, conflicting, low-confidence or high-review cases. Disagreement creates a hold.',
  },
  {
    capability: 'Digital Twin',
    state: 'REQUIRED FOR POLICY CHANGE',
    tone: 'info' as const,
    detail:
      'Zero-effect rehearsal is required before a policy revision can even become eligible for owner review.',
  },
  {
    capability: 'Canonical Recommendation Runtime',
    state: 'INTEGRATED',
    tone: 'healthy' as const,
    detail:
      'Accepted AOS advice can become an inert fingerprintable recommendation; it still carries no approval or execution authority.',
  },
  {
    capability: 'JAO-6',
    state: 'FUTURE CLASS REVIEW',
    tone: 'shadow' as const,
    detail:
      'Existing offline vendor-follow-up proof is not generalized to the AOS action vocabulary without a separate review.',
  },
  {
    capability: 'JAO-2 / JAO-7',
    state: 'NOT ACTIVATED',
    tone: 'offline' as const,
    detail: 'No agent delegation or advanced autonomy is granted by AOS v2.',
  },
]);

export function AosGovernanceStack() {
  return (
    <Panel
      title="Jarvis capability integration"
      subtitle="AOS reuses existing governed capabilities instead of creating another autonomy framework."
      action={<Tag tone="shadow">SHADOW / SUGGEST</Tag>}
    >
      <div className="overflow-hidden rounded-[var(--radius-control)] border border-[var(--color-line)]">
        {STACK.map((item) => (
          <div
            key={item.capability}
            className="grid gap-2 border-b border-[var(--color-line)] bg-[var(--color-base-850)] px-3.5 py-3 last:border-0 lg:grid-cols-[220px_180px_minmax(0,1fr)]"
          >
            <span className="text-[10.5px] font-semibold text-[var(--color-ink)]">
              {item.capability}
            </span>
            <span>
              <Tag tone={item.tone}>{item.state}</Tag>
            </span>
            <span className="text-[9.5px] leading-relaxed text-[var(--color-ink-faint)]">
              {item.detail}
            </span>
          </div>
        ))}
      </div>
      <p className="mt-3 text-[9.5px] leading-relaxed text-[var(--color-ink-faint)]">
        Core evidence → AOS detection/correlation → certified model reasoning when needed → optional
        Jev adjudication → critic → Digital Twin governance → canonical recommendation → owner/Core.
        There is no AOS-to-execution edge.
      </p>
    </Panel>
  );
}
