import { HEALTH_PRESENTATION } from '@/lib/control-plane/types';
import type { HealthState, SystemComponentHealth } from '@/lib/control-plane/types';
import { LIFECYCLE_PRESENTATION } from '@/lib/capabilities/catalog';
import type { CapabilityLifecycle } from '@/lib/capabilities/catalog';
import { toneDot, toneText } from '@/components/primitives/Panel';
import type { Tone } from '@/components/primitives/Panel';

/**
 * Status indicators (JOS-01A).
 *
 * ### Colour is never the message
 *
 * Every indicator here renders its state as TEXT, with the colour as reinforcement. An
 * operator with a colour-vision difference, a monochrome screenshot in a ticket, or a
 * printout must all convey the same thing — and on a surface where "offline" and "healthy"
 * differ by one hue, a colour-only signal is a defect rather than a style choice.
 *
 * The live dot pulses only where liveness is genuinely the meaning, and stops entirely under
 * `prefers-reduced-motion`.
 */

export function StatusPill({
  state,
  live = false,
}: {
  readonly state: HealthState;
  readonly live?: boolean;
}) {
  const presentation = HEALTH_PRESENTATION[state];
  return (
    <span className="inline-flex items-center gap-1.5 rounded-[var(--radius-pill)] border border-[var(--color-line)] bg-[var(--color-base-850)] px-2 py-[3px] text-[10.5px] font-semibold tracking-[0.04em] whitespace-nowrap uppercase">
      <span
        aria-hidden="true"
        className={`h-1.5 w-1.5 rounded-full ${toneDot(presentation.tone)} ${live ? 'pulse-live' : ''}`}
      />
      <span className={toneText(presentation.tone)}>{presentation.label}</span>
    </span>
  );
}

export function CapabilityBadge({ lifecycle }: { readonly lifecycle: CapabilityLifecycle }) {
  const presentation = LIFECYCLE_PRESENTATION[lifecycle];
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

/** A small labelled tag used inside tables and rails. */
export function Tag({ tone, children }: { readonly tone: Tone; readonly children: string }) {
  return (
    <span
      className={`inline-flex items-center rounded-[var(--radius-control)] border border-[var(--color-line)] bg-[var(--color-base-850)] px-1.5 py-[2px] text-[10.5px] font-medium ${toneText(tone)}`}
    >
      {children}
    </span>
  );
}

/** Column tracks by component COUNT — see the note in MetricStrip; empty cells read as a fault. */
const STRIP_COLUMNS: Readonly<Record<number, string>> = {
  1: 'xl:grid-cols-1',
  2: 'xl:grid-cols-2',
  3: 'xl:grid-cols-3',
  4: 'xl:grid-cols-4',
  5: 'xl:grid-cols-5',
  6: 'xl:grid-cols-6',
  7: 'xl:grid-cols-7',
  8: 'xl:grid-cols-8',
};

/** The top status strip: one cell per system component, each with state text and a reason. */
export function StatusStrip({
  components,
}: {
  readonly components: readonly SystemComponentHealth[];
}) {
  return (
    <ul
      className={`grid grid-cols-1 gap-px overflow-hidden rounded-[var(--radius-panel)] border border-[var(--color-line)] bg-[var(--color-line)] sm:grid-cols-2 lg:grid-cols-3 ${STRIP_COLUMNS[Math.min(components.length, 8)] ?? 'xl:grid-cols-8'}`}
      aria-label="System status"
    >
      {components.map((component) => (
        <li key={component.id} className="surface-lift bg-[var(--color-base-900)] px-4 py-3.5">
          <p className="text-[11px] font-medium tracking-[0.02em] text-[var(--color-ink-muted)] uppercase">
            {component.label}
          </p>
          <p className="mt-2">
            <StatusPill state={component.state} live={component.state === 'HEALTHY'} />
          </p>
          <p className="mt-2 text-[11.5px] leading-relaxed text-[var(--color-ink-faint)]">
            {component.detail}
          </p>
        </li>
      ))}
    </ul>
  );
}
