import type { ReactNode } from 'react';

/**
 * Panels, rails and section headings (JOS-01A).
 *
 * The shell is built from open panels rather than nested cards. A card inside a card inside
 * a grid is the visual signature of an admin template; a control plane reads better as flat
 * surfaces separated by hairlines, with depth used once and sparingly.
 */

const TONE_TEXT = {
  healthy: 'text-[var(--color-healthy)]',
  warning: 'text-[var(--color-warning)]',
  critical: 'text-[var(--color-critical)]',
  offline: 'text-[var(--color-offline)]',
  info: 'text-[var(--color-info)]',
  planned: 'text-[var(--color-planned)]',
  shadow: 'text-[var(--color-shadow-state)]',
} as const;

const TONE_DOT = {
  healthy: 'bg-[var(--color-healthy)]',
  warning: 'bg-[var(--color-warning)]',
  critical: 'bg-[var(--color-critical)]',
  offline: 'bg-[var(--color-offline)]',
  info: 'bg-[var(--color-info)]',
  planned: 'bg-[var(--color-planned)]',
  shadow: 'bg-[var(--color-shadow-state)]',
} as const;

export type Tone = keyof typeof TONE_TEXT;

export function toneText(tone: Tone): string {
  return TONE_TEXT[tone];
}

export function toneDot(tone: Tone): string {
  return TONE_DOT[tone];
}

export function Panel({
  title,
  subtitle,
  action,
  children,
  padded = true,
  className = '',
}: {
  readonly title?: string;
  readonly subtitle?: string;
  readonly action?: ReactNode;
  readonly children: ReactNode;
  readonly padded?: boolean;
  readonly className?: string;
}) {
  return (
    <section
      className={`surface-lift rounded-[var(--radius-panel)] border border-[var(--color-line)] bg-[var(--color-base-900)] ${className}`}
    >
      {title === undefined ? null : (
        <header className="flex items-start justify-between gap-4 border-b border-[var(--color-line)] px-5 py-3.5">
          <div className="min-w-0">
            <h2 className="text-[13px] font-semibold tracking-[0.01em] text-[var(--color-ink)]">
              {title}
            </h2>
            {subtitle === undefined ? null : (
              <p className="mt-0.5 text-[11.5px] leading-relaxed text-[var(--color-ink-faint)]">
                {subtitle}
              </p>
            )}
          </div>
          {action === undefined ? null : <div className="shrink-0">{action}</div>}
        </header>
      )}
      <div className={padded ? 'p-5' : ''}>{children}</div>
    </section>
  );
}

/** A page-level section label — used above open content rather than around it. */
export function SectionHeading({
  title,
  caption,
  action,
}: {
  readonly title: string;
  readonly caption?: string;
  readonly action?: ReactNode;
}) {
  return (
    <div className="mb-3 flex items-end justify-between gap-4">
      <div className="min-w-0">
        <h2 className="text-[13px] font-semibold tracking-[0.01em] text-[var(--color-ink)]">
          {title}
        </h2>
        {caption === undefined ? null : (
          <p className="mt-0.5 text-[11.5px] text-[var(--color-ink-faint)]">{caption}</p>
        )}
      </div>
      {action === undefined ? null : <div className="shrink-0">{action}</div>}
    </div>
  );
}

/**
 * A short, prominent statement of fact.
 *
 * Used for the things an operator must not have to infer — rollout is off, this data is
 * synthetic, nothing here reaches a backend.
 */
export function Notice({
  tone = 'info',
  title,
  children,
}: {
  readonly tone?: Tone;
  readonly title: string;
  readonly children?: ReactNode;
}) {
  return (
    <div className="flex gap-3 rounded-[var(--radius-control)] border border-[var(--color-line)] bg-[var(--color-base-850)] px-4 py-3">
      <span
        aria-hidden="true"
        className={`mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full ${toneDot(tone)}`}
      />
      <div className="min-w-0">
        <p className={`text-[12px] font-semibold ${toneText(tone)}`}>{title}</p>
        {children === undefined ? null : (
          <p className="mt-1 text-[12px] leading-relaxed text-[var(--color-ink-muted)]">
            {children}
          </p>
        )}
      </div>
    </div>
  );
}
