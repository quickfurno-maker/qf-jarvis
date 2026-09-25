import Link from 'next/link';

import type {
  NowBrief as NowBriefModel,
  ProactivePriority,
} from '@qf-jarvis/proactive-intelligence';

import { Panel } from '@/components/primitives/Panel';
import { Tag } from '@/components/system/StatusPill';

const PRIORITY_TONE = {
  P0: 'critical',
  P1: 'warning',
  P2: 'info',
  P3: 'offline',
} as const satisfies Readonly<
  Record<ProactivePriority, 'critical' | 'warning' | 'info' | 'offline'>
>;

export function NowBrief({ brief }: { readonly brief: NowBriefModel }) {
  const visible = brief.findings.slice(0, 6);
  return (
    <Panel
      title="Jarvis · Now"
      subtitle="Proactive operating brief. Ranked from governed evidence; recommendations carry no execution authority."
      action={
        <span
          className={
            'text-[10px] font-semibold tracking-[0.08em] uppercase ' +
            (brief.posture === 'CRITICAL'
              ? 'text-[var(--color-critical)]'
              : brief.posture === 'ATTENTION'
                ? 'text-[var(--color-warning)]'
                : brief.posture === 'STABLE'
                  ? 'text-[var(--color-healthy)]'
                  : 'text-[var(--color-info)]')
          }
        >
          {brief.posture.replaceAll('_', ' ')}
        </span>
      }
    >
      <div className="grid gap-4 xl:grid-cols-[minmax(0,0.72fr)_minmax(0,2fr)]">
        <div className="rounded-[var(--radius-control)] border border-[var(--color-line)] bg-[var(--color-base-850)] px-4 py-4">
          <p className="text-[9.5px] font-semibold tracking-[0.1em] text-[var(--color-ink-faint)] uppercase">
            What needs you
          </p>
          <p className="mt-2 text-[16px] font-semibold leading-snug tracking-[-0.02em] text-[var(--color-ink)]">
            {brief.headline}
          </p>
          <div className="mt-4 grid grid-cols-4 gap-1.5">
            {(['P0', 'P1', 'P2', 'P3'] as const).map((priority) => (
              <div
                key={priority}
                className="rounded-[8px] border border-[var(--color-line)] px-2 py-2 text-center"
              >
                <p className="text-[9px] text-[var(--color-ink-faint)]">{priority}</p>
                <p className="tabular mt-1 text-[16px] font-semibold text-[var(--color-ink)]">
                  {brief.counts[priority]}
                </p>
              </div>
            ))}
          </div>
          <p className="mt-3 text-[10.5px] leading-relaxed text-[var(--color-ink-faint)]">
            Jarvis may observe, explain and recommend. Any business mutation still requires its
            governed authority path.
          </p>
        </div>

        <div>
          {visible.length === 0 ? (
            <div className="rounded-[var(--radius-control)] border border-[var(--color-line)] px-4 py-5">
              <p className="text-[12px] text-[var(--color-ink-muted)]">
                No proactive finding is visible in this snapshot.
              </p>
            </div>
          ) : (
            <ul className="grid gap-2 md:grid-cols-2">
              {visible.map((finding) => (
                <li key={finding.id}>
                  <Link
                    href={finding.route}
                    className="block h-full rounded-[var(--radius-control)] border border-[var(--color-line)] px-3.5 py-3 transition-colors hover:border-[var(--color-line-strong)] hover:bg-[var(--color-base-850)]"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <Tag tone={PRIORITY_TONE[finding.priority]}>{finding.priority}</Tag>
                      <span className="text-[9.5px] tracking-[0.07em] text-[var(--color-ink-faint)] uppercase">
                        {finding.domain.replaceAll('_', ' ')}
                      </span>
                    </div>
                    <p className="mt-2 text-[12.5px] font-semibold leading-snug text-[var(--color-ink)]">
                      {finding.title}
                    </p>
                    <p className="mt-1 text-[10.5px] leading-relaxed text-[var(--color-ink-faint)]">
                      {finding.summary}
                    </p>
                    <p className="mt-2 text-[10px] font-semibold text-[var(--color-accent-bright)]">
                      Investigate →
                    </p>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </Panel>
  );
}
