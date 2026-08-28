import { toneDot, toneText } from '@/components/primitives/Panel';
import type { Tone } from '@/components/primitives/Panel';
import type {
  DistributionSlice,
  FunnelStage,
  NamedSeries,
  ResolvedMetricAuthority,
} from '@/lib/control-plane/types';
import { formatCount, formatShare } from '@/lib/formatting/number';

/**
 * Who is entitled to be believed about a figure, in words (AVG-11, ADR-0128).
 *
 * Printed on every funnel stage rather than only on the unavailable ones. An operator who has to
 * remember which stages Core owns will eventually stop remembering, and a Jarvis-derived count
 * standing unlabelled beside a Core-authoritative one is how the two get read as the same kind of
 * fact.
 */
const AUTHORITY_LABEL: Readonly<Record<ResolvedMetricAuthority, string>> = Object.freeze({
  JARVIS_WORKFLOW_DERIVED: 'Jarvis workflow',
  CORE_AUTHORITATIVE: 'QuickFurno Core',
});

/**
 * Code-native charts (JOS-01A).
 *
 * Hand-written SVG rather than a charting library, for three reasons that all matter at this
 * size: a library would be the largest dependency in the repository for four small
 * visualizations; every one of them would need overriding to match these tokens anyway; and
 * a chart that renders on the server with no runtime JavaScript is simply better here.
 *
 * Each chart carries a text alternative. An SVG that conveys a trend only through its shape
 * is unreadable to a screen reader, so the figure is labelled and the underlying numbers stay
 * available as text beside it.
 */

const TONE_STROKE: Readonly<Record<Tone, string>> = {
  healthy: 'var(--color-healthy)',
  warning: 'var(--color-warning)',
  critical: 'var(--color-critical)',
  offline: 'var(--color-offline)',
  info: 'var(--color-accent)',
  planned: 'var(--color-planned)',
  shadow: 'var(--color-shadow-state)',
};

/** An area trend over a fixed-width viewBox, scaled to the series' own range. */
export function AreaTrend({
  series,
  height = 132,
  valueSuffix = '',
}: {
  readonly series: NamedSeries;
  readonly height?: number;
  readonly valueSuffix?: string;
}) {
  const points = series.points;
  if (points.length < 2) {
    return <p className="text-[12px] text-[var(--color-ink-faint)]">Not enough data to plot.</p>;
  }

  const width = 720;
  const values = points.map((point) => point.value);
  const max = Math.max(...values);
  const min = Math.min(...values);
  const span = max - min || 1;
  const step = width / (points.length - 1);
  const stroke = TONE_STROKE[series.tone];
  const gradientId = `grad-${series.id}`;

  const coords = points.map((point, index) => {
    const x = index * step;
    const y = height - ((point.value - min) / span) * (height - 16) - 8;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });

  const line = `M ${coords.join(' L ')}`;
  const area = `${line} L ${String(width)},${String(height)} L 0,${String(height)} Z`;

  // `noUncheckedIndexedAccess` cannot see that the length guard above makes this safe, and a
  // non-null assertion would be the wrong way to tell it. Read it once, honestly.
  const first = points[0];
  if (first === undefined) {
    return null;
  }
  const peak = points.reduce((a, b) => (b.value > a.value ? b : a), first);
  const low = points.reduce((a, b) => (b.value < a.value ? b : a), first);

  return (
    <figure className="m-0">
      <svg
        viewBox={`0 0 ${String(width)} ${String(height)}`}
        preserveAspectRatio="none"
        className="h-[132px] w-full"
        role="img"
        aria-label={`${series.label}. Peak ${String(peak.value)}${valueSuffix} at ${peak.label}, low ${String(low.value)}${valueSuffix} at ${low.label}.`}
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={stroke} stopOpacity="0.28" />
            <stop offset="100%" stopColor={stroke} stopOpacity="0" />
          </linearGradient>
        </defs>
        {[0.25, 0.5, 0.75].map((fraction) => (
          <line
            key={fraction}
            x1="0"
            x2={width}
            y1={height * fraction}
            y2={height * fraction}
            stroke="var(--color-line)"
            strokeWidth="1"
            vectorEffect="non-scaling-stroke"
          />
        ))}
        <path d={area} fill={`url(#${gradientId})`} />
        <path
          d={line}
          fill="none"
          stroke={stroke}
          strokeWidth="1.75"
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      <figcaption className="mt-2 flex items-center justify-between text-[11px] text-[var(--color-ink-faint)]">
        <span>{points[0]?.label}</span>
        <span className="tabular">
          peak {formatCount(peak.value)}
          {valueSuffix} · low {formatCount(low.value)}
          {valueSuffix}
        </span>
        <span>{points[points.length - 1]?.label}</span>
      </figcaption>
    </figure>
  );
}

/** A horizontal distribution. Each row states its own share as text. */
export function BarDistribution({ slices }: { readonly slices: readonly DistributionSlice[] }) {
  const total = slices.reduce((sum, slice) => sum + slice.value, 0);
  const max = Math.max(...slices.map((slice) => slice.value), 1);

  return (
    <ul className="space-y-3">
      {slices.map((slice) => (
        <li key={slice.id}>
          <div className="flex items-baseline justify-between gap-3">
            <span className="flex min-w-0 items-center gap-2 text-[12px] text-[var(--color-ink-muted)]">
              <span
                aria-hidden="true"
                className={`h-1.5 w-1.5 shrink-0 rounded-full ${toneDot(slice.tone)}`}
              />
              <span className="truncate">{slice.label}</span>
            </span>
            <span className="tabular shrink-0 text-[12px] text-[var(--color-ink)]">
              {formatCount(slice.value)}
              <span className="ml-1.5 text-[11px] text-[var(--color-ink-faint)]">
                {formatShare(slice.value, total)}
              </span>
            </span>
          </div>
          <div className="mt-1.5 h-1.5 overflow-hidden rounded-[var(--radius-pill)] bg-[var(--color-base-800)]">
            <div
              className={`h-full rounded-[var(--radius-pill)] ${toneDot(slice.tone)}`}
              style={{
                width: `${String(Math.max((slice.value / max) * 100, slice.value > 0 ? 3 : 0))}%`,
              }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

/** A compact stacked share bar with a text legend beneath it. */
export function StackedShare({ slices }: { readonly slices: readonly DistributionSlice[] }) {
  const total = slices.reduce((sum, slice) => sum + slice.value, 0) || 1;
  return (
    <div>
      <div
        className="flex h-2.5 overflow-hidden rounded-[var(--radius-pill)] bg-[var(--color-base-800)]"
        role="img"
        aria-label={slices.map((slice) => `${slice.label}: ${String(slice.value)}`).join(', ')}
      >
        {slices.map((slice) => (
          <div
            key={slice.id}
            className={toneDot(slice.tone)}
            style={{ width: `${String((slice.value / total) * 100)}%` }}
          />
        ))}
      </div>
      <ul className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2">
        {slices.map((slice) => (
          <li key={slice.id} className="flex items-center justify-between gap-2">
            <span className="flex min-w-0 items-center gap-2 text-[11.5px] text-[var(--color-ink-muted)]">
              <span
                aria-hidden="true"
                className={`h-1.5 w-1.5 shrink-0 rounded-full ${toneDot(slice.tone)}`}
              />
              <span className="truncate">{slice.label}</span>
            </span>
            <span className="tabular shrink-0 text-[11.5px] text-[var(--color-ink)]">
              {formatCount(slice.value)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * A funnel preview.
 *
 * Used for Aarohi, where every stage is legitimately zero. A funnel that drew nothing for a
 * zero stage would look broken rather than planned, so each stage keeps its rail and states
 * its caption — the emptiness is the information.
 */
/**
 * The acquisition funnel (AVG-11, ADR-0128).
 *
 * Two corrections live in this component, and both are about zero.
 *
 * An earlier version rendered `stage.value === 0 ? '—'`, which made a genuine zero look like a
 * missing reading. A count of zero is a real answer and now prints as `0`.
 *
 * A stage whose authority nobody has read carries no `value` at all — the type has no such key on
 * that branch — so it prints `Unknown` with the class that would own it, and draws no bar. A bar of
 * length zero beside "Core ACTIVE handoff" is the exact picture this phase exists to prevent.
 */
export function FunnelPreview({ stages }: { readonly stages: readonly FunnelStage[] }) {
  const max = Math.max(
    ...stages.map((stage) => (stage.authority === 'AUTHORITY_UNAVAILABLE' ? 0 : stage.value)),
    1,
  );
  return (
    <ol className="space-y-2.5">
      {stages.map((stage, index) => (
        <li
          key={stage.id}
          className="rounded-[var(--radius-control)] border border-[var(--color-line)] bg-[var(--color-base-850)] px-3.5 py-2.5"
        >
          <div className="flex items-baseline justify-between gap-3">
            <span className="flex min-w-0 items-baseline gap-2">
              <span className="tabular text-[10.5px] text-[var(--color-ink-faint)]">
                {String(index + 1).padStart(2, '0')}
              </span>
              <span className="truncate text-[12px] text-[var(--color-ink)]">{stage.label}</span>
            </span>
            <span className="tabular shrink-0 text-[12px] text-[var(--color-ink-muted)]">
              {stage.authority === 'AUTHORITY_UNAVAILABLE' ? 'Unknown' : formatCount(stage.value)}
            </span>
          </div>
          {stage.authority === 'AUTHORITY_UNAVAILABLE' ? null : (
            <div className="mt-2 h-1 overflow-hidden rounded-[var(--radius-pill)] bg-[var(--color-base-800)]">
              <div
                className="h-full rounded-[var(--radius-pill)] bg-[var(--color-planned)]"
                style={{ width: `${String((stage.value / max) * 100)}%` }}
              />
            </div>
          )}
          <p className="mt-1.5 text-[11px] text-[var(--color-ink-faint)]">
            <span className="text-[var(--color-ink-muted)]">
              {stage.authority === 'AUTHORITY_UNAVAILABLE'
                ? `${AUTHORITY_LABEL[stage.expectedAuthority]} · not read`
                : AUTHORITY_LABEL[stage.authority]}
            </span>{' '}
            · {stage.caption}
          </p>
        </li>
      ))}
    </ol>
  );
}

/** A tiny inline sparkline for metric tiles. Decorative: always paired with the number. */
export function Sparkline({
  points,
  tone,
}: {
  readonly points: readonly number[];
  readonly tone: Tone;
}) {
  if (points.length < 2) {
    return null;
  }
  const width = 88;
  const height = 24;
  const max = Math.max(...points);
  const min = Math.min(...points);
  const span = max - min || 1;
  const step = width / (points.length - 1);
  const d = points
    .map((value, index) => {
      const x = index * step;
      const y = height - ((value - min) / span) * (height - 4) - 2;
      return `${index === 0 ? 'M' : 'L'} ${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');

  return (
    <svg
      viewBox={`0 0 ${String(width)} ${String(height)}`}
      className="h-6 w-[88px]"
      aria-hidden="true"
      focusable="false"
    >
      <path
        d={d}
        fill="none"
        stroke={TONE_STROKE[tone]}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

export { toneText };
