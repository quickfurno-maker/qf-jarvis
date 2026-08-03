import { Tag } from '@/components/system/StatusPill';
import type { Tone } from '@/components/primitives/Panel';
import type { AttentionItem } from '@/lib/control-plane/types';

/**
 * The action-required rail (JOS-01A).
 *
 * A list, not a grid of cards: these are read top-down by urgency, and a grid destroys that
 * ordering the moment it wraps.
 *
 * Nothing here is actionable in this release, and the rail says so once at the bottom rather
 * than disabling a button on every row — a row of dead controls reads as a broken screen
 * rather than a deliberate boundary.
 */
const SEVERITY_TONE: Readonly<Record<AttentionItem['severity'], Tone>> = {
  critical: 'critical',
  warning: 'warning',
  info: 'info',
};

const KIND_LABEL: Readonly<Record<AttentionItem['kind'], string>> = {
  approval: 'Approval',
  escalation: 'Escalation',
  warning: 'Warning',
  worker: 'Worker',
  blocked: 'Blocked',
};

export function AttentionRail({ items }: { readonly items: readonly AttentionItem[] }) {
  return (
    <div>
      <ul className="divide-y divide-[var(--color-line)]">
        {items.map((item) => (
          <li key={item.id} className="flex gap-3 py-3 first:pt-0">
            <span
              aria-hidden="true"
              className={`mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full ${
                item.severity === 'critical'
                  ? 'bg-[var(--color-critical)]'
                  : item.severity === 'warning'
                    ? 'bg-[var(--color-warning)]'
                    : 'bg-[var(--color-info)]'
              }`}
            />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <Tag tone={SEVERITY_TONE[item.severity]}>{KIND_LABEL[item.kind]}</Tag>
                <span className="tabular text-[10.5px] text-[var(--color-ink-faint)]">
                  {item.id}
                </span>
              </div>
              <p className="mt-1.5 text-[12.5px] leading-snug text-[var(--color-ink)]">
                {item.title}
              </p>
              <p className="mt-1 text-[11.5px] leading-relaxed text-[var(--color-ink-faint)]">
                {item.context}
              </p>
            </div>
            <span className="tabular shrink-0 self-start text-[11px] text-[var(--color-ink-faint)]">
              {item.age}
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-4 border-t border-[var(--color-line)] pt-3 text-[11px] leading-relaxed text-[var(--color-ink-faint)]">
        Read-only. Jarvis OS has no control-plane API in this release, so no item here can be
        actioned from this surface.
      </p>
    </div>
  );
}
