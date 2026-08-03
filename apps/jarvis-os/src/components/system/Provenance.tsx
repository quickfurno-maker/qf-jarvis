import { toneDot, toneText } from '@/components/primitives/Panel';
import type { Tone } from '@/components/primitives/Panel';
import type {
  Provenance,
  Section,
  SectionAvailability,
  SeriesSection,
} from '@/lib/control-plane/types';
import { isReadable } from '@/lib/control-plane/types';

/**
 * Provenance and unavailable states (JOS-01B).
 *
 * ### The empty state IS the feature
 *
 * A control plane earns trust by being boring and exact about what it does not know. The failure
 * this file prevents is the one an operator cannot detect: a panel that renders `0` when the
 * honest answer is "nobody has connected this source". The first is a reading, the second is a
 * gap, and they must never look alike.
 *
 * So an unreadable section renders a deliberate, composed state — what it is, why, and what will
 * supply it — instead of an empty table, a zero, or a flat line at the bottom of a chart.
 */

const AVAILABILITY_PRESENTATION: Readonly<
  Record<SectionAvailability, { readonly label: string; readonly tone: Tone }>
> = Object.freeze({
  AVAILABLE: { label: 'Live', tone: 'healthy' },
  STATIC_BASELINE: { label: 'Static baseline', tone: 'info' },
  NOT_CONNECTED: { label: 'Not connected', tone: 'offline' },
  PLANNED: { label: 'Planned', tone: 'planned' },
  ROLLOUT_OFF: { label: 'Rollout off', tone: 'warning' },
});

/** A small badge naming where a panel's contents came from. Never colour alone. */
export function SourceBadge({ availability }: { readonly availability: SectionAvailability }) {
  const presentation = AVAILABILITY_PRESENTATION[availability];
  return (
    <span className="inline-flex items-center gap-1.5 rounded-[var(--radius-pill)] border border-[var(--color-line)] bg-[var(--color-base-850)] px-2 py-[3px] text-[10.5px] font-semibold tracking-[0.04em] whitespace-nowrap uppercase">
      <span
        aria-hidden="true"
        className={`h-1.5 w-1.5 rounded-full ${toneDot(presentation.tone)}`}
      />
      <span className={toneText(presentation.tone)}>{presentation.label}</span>
    </span>
  );
}

/**
 * The whole-snapshot provenance line.
 *
 * States the one thing an operator must never have to infer: whether anything on this screen is a
 * live operational reading. In this release it never is, and the surface says so rather than
 * leaving the absence of a warning to imply that it is.
 */
export function ProvenanceBar({ provenance }: { readonly provenance: Provenance }) {
  const live = provenance.liveOperationalData;
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-[var(--radius-panel)] border border-[var(--color-line)] bg-[var(--color-base-900)] px-4 py-2.5 text-[11.5px]">
      <span className="inline-flex items-center gap-1.5">
        <span
          aria-hidden="true"
          className={`h-1.5 w-1.5 rounded-full ${toneDot(live ? 'healthy' : 'info')}`}
        />
        <span className="font-semibold tracking-[0.04em] text-[var(--color-ink)] uppercase">
          {live ? 'Live data' : 'No live operational data'}
        </span>
      </span>
      <span className="text-[var(--color-ink-muted)]">
        {provenance.kind === 'REPOSITORY_BASELINE'
          ? 'Every figure is declared by merged repository and governance state.'
          : provenance.kind === 'DEMO_FIXTURE'
            ? 'Synthetic fixture. Not operational data, and never the default surface.'
            : 'Read from an adopted runtime source.'}
      </span>
      <span className="tabular ml-auto text-[var(--color-ink-faint)]">
        {/*
          Two different instants, stated as two different things. "Facts" is the freshness of the
          data; "snapshot" is when this JSON was produced. Collapsing them into one timestamp is
          how a week-old build starts looking freshly observed.
        */}
        Facts: {provenance.freshness === 'REQUEST_TIME' ? 'read this request' : 'declared at build'}{' '}
        · Snapshot {provenance.generatedAt.replace('T', ' ').replace('.000Z', 'Z')}
      </span>
    </div>
  );
}

/**
 * The composed unavailable state.
 *
 * Deliberately not a warning wall. It is the same visual weight as a populated panel, so a screen
 * of unconnected sources still reads as a designed surface rather than as a broken one — and an
 * operator scanning for the one section that DOES have data can find it.
 */
export function Unavailable({
  availability,
  reason,
  expectedSource,
  compact = false,
}: {
  readonly availability: SectionAvailability;
  readonly reason: string;
  readonly expectedSource: string;
  readonly compact?: boolean;
}) {
  return (
    <div
      className={`flex flex-col items-start gap-2 rounded-[var(--radius-control)] border border-dashed border-[var(--color-line-strong)] bg-[var(--color-base-850)]/40 ${
        compact ? 'px-4 py-4' : 'px-5 py-7'
      }`}
    >
      <SourceBadge availability={availability} />
      <p className={`${compact ? 'text-[12px]' : 'text-[12.5px]'} text-[var(--color-ink-muted)]`}>
        {reason}
      </p>
      <p className="text-[11.5px] text-[var(--color-ink-faint)]">
        <span className="text-[var(--color-ink-muted)]">Expected source:</span> {expectedSource}
      </p>
    </div>
  );
}

/**
 * Render a section's items, or its unavailable state.
 *
 * One helper so no page can forget the check. A page that maps `section.items` directly would
 * silently render nothing for an unconnected source, which is exactly the defect this phase fixes.
 */
export function SectionBody<T>({
  section,
  children,
  compact = false,
}: {
  readonly section: Section<T>;
  readonly children: (items: readonly T[]) => React.ReactNode;
  readonly compact?: boolean;
}) {
  if (!isReadable(section.availability) || section.items.length === 0) {
    return (
      <Unavailable
        availability={section.availability}
        reason={
          section.items.length === 0 && isReadable(section.availability)
            ? 'Nothing to show. This is a genuine empty result, not an unreadable source.'
            : section.reason
        }
        expectedSource={section.expectedSource}
        compact={compact}
      />
    );
  }
  return <>{children(section.items)}</>;
}

/** The same guard for a series. An unavailable chart never draws a zero line. */
export function SeriesBody({
  series,
  children,
}: {
  readonly series: SeriesSection;
  readonly children: (series: SeriesSection) => React.ReactNode;
}) {
  if (!isReadable(series.availability) || series.points.length < 2) {
    return (
      <Unavailable
        availability={series.availability}
        reason={series.reason}
        expectedSource={series.expectedSource}
      />
    );
  }
  return <>{children(series)}</>;
}
