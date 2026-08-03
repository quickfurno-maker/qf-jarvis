import { Unavailable } from '@/components/system/Provenance';
import { isReadable } from '@/lib/control-plane/types';
import type { MetricSummary, Section } from '@/lib/control-plane/types';

/**
 * The metric strip (JOS-01A).
 *
 * A single hairline-separated row rather than a grid of rounded cards — it reads as one
 * instrument cluster, which is what it is.
 *
 * ### Direction is not sentiment
 *
 * A rising number is not automatically good. Escalations climbing is a warning; latency
 * falling is an improvement. So each metric declares `higherIsBetter`, and the arrow's
 * COLOUR comes from that judgement while the arrow's DIRECTION stays literal. The delta also
 * carries an accessible sentence, because an arrow glyph alone tells a screen reader nothing.
 */
/**
 * Column tracks by metric COUNT.
 *
 * A fixed six-column strip leaves empty cells whenever a surface has fewer than six metrics,
 * and because the grid gap is a hairline over a border-coloured background those cells render
 * as one large blank panel that reads as a loading failure. The classes are spelled out rather
 * than interpolated so Tailwind can actually see them.
 */
const WIDE_COLUMNS: Readonly<Record<number, string>> = {
  1: 'xl:grid-cols-1',
  2: 'xl:grid-cols-2',
  3: 'xl:grid-cols-3',
  4: 'xl:grid-cols-4',
  5: 'xl:grid-cols-5',
  6: 'xl:grid-cols-6',
};

export function MetricStrip({ section }: { readonly section: Section<MetricSummary> }) {
  const metrics = section.items;
  // An unreadable metric source renders its state, not a strip of dashes. A dash reads as "zero,
  // formatted"; the state reads as "nobody has connected this".
  if (!isReadable(section.availability) || metrics.length === 0) {
    return (
      <Unavailable
        availability={section.availability}
        reason={section.reason}
        expectedSource={section.expectedSource}
        compact
      />
    );
  }
  const wide = WIDE_COLUMNS[Math.min(metrics.length, 6)] ?? 'xl:grid-cols-6';
  return (
    <div
      className={`grid grid-cols-1 gap-px overflow-hidden rounded-[var(--radius-panel)] border border-[var(--color-line)] bg-[var(--color-line)] sm:grid-cols-2 lg:grid-cols-3 ${wide}`}
    >
      {metrics.map((metric) => (
        <MetricTile key={metric.id} metric={metric} />
      ))}
    </div>
  );
}

function MetricTile({ metric }: { readonly metric: MetricSummary }) {
  const direction = metric.deltaDirection ?? 'flat';
  const good =
    direction === 'flat' || metric.higherIsBetter === undefined
      ? undefined
      : (direction === 'up') === metric.higherIsBetter;

  const deltaClass =
    good === undefined
      ? 'text-[var(--color-ink-faint)]'
      : good
        ? 'text-[var(--color-healthy)]'
        : 'text-[var(--color-warning)]';

  const arrow = direction === 'up' ? '↑' : direction === 'down' ? '↓' : '→';

  return (
    <div className="surface-lift bg-[var(--color-base-900)] px-4 py-4">
      <p className="text-[11px] font-medium tracking-[0.02em] text-[var(--color-ink-muted)] uppercase">
        {metric.label}
      </p>
      <p className="mt-2 flex items-baseline gap-1.5">
        <span className="tabular text-[26px] leading-none font-semibold text-[var(--color-ink)]">
          {metric.value}
        </span>
        {metric.unit === undefined ? null : (
          <span className="text-[12px] text-[var(--color-ink-faint)]">{metric.unit}</span>
        )}
      </p>
      {metric.deltaLabel === undefined ? null : (
        <p className={`mt-1.5 text-[11.5px] ${deltaClass}`}>
          <span aria-hidden="true">{arrow} </span>
          {metric.deltaLabel}
          <span className="sr-only">
            {` — ${direction === 'flat' ? 'unchanged' : direction === 'up' ? 'increased' : 'decreased'}${
              good === undefined ? '' : good ? ', an improvement' : ', needs attention'
            }`}
          </span>
        </p>
      )}
      <p className="mt-2 text-[11px] leading-relaxed text-[var(--color-ink-faint)]">
        {metric.caption}
      </p>
    </div>
  );
}
