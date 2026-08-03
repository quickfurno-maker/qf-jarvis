import { toneText } from '@/components/primitives/Panel';
import type { ActivityEntry } from '@/lib/control-plane/types';

/**
 * The activity feed (JOS-01A).
 *
 * Every entry is provenance-labelled. On a surface that shows Core's decisions beside
 * Jarvis's interpretations, "who said this" is not metadata — it is the difference between a
 * fact and a proposal, and an unlabelled feed is how those two blur.
 */
export function ActivityFeed({ entries }: { readonly entries: readonly ActivityEntry[] }) {
  return (
    <ol className="space-y-3.5">
      {entries.map((entry) => (
        <li key={entry.id} className="flex gap-3">
          <div className="flex w-[54px] shrink-0 flex-col items-start">
            <span
              className={`rounded-[var(--radius-control)] border border-[var(--color-line)] bg-[var(--color-base-850)] px-1.5 py-[2px] text-[9.5px] font-semibold tracking-[0.06em] ${toneText(entry.tone)}`}
            >
              {entry.source}
            </span>
          </div>
          <div className="min-w-0 flex-1 border-l border-[var(--color-line)] pb-1 pl-3">
            <p className="text-[12px] leading-relaxed text-[var(--color-ink-muted)]">
              {entry.message}
            </p>
          </div>
          <span className="tabular shrink-0 text-[11px] text-[var(--color-ink-faint)]">
            {entry.at}
          </span>
        </li>
      ))}
    </ol>
  );
}
