import type { ReactNode } from 'react';

/**
 * Page identity (JOS-01A).
 *
 * Breadcrumb, title, one-line purpose, and an optional status cluster. The purpose line is
 * not decoration: on a surface where several screens look alike, it is what tells an
 * operator which question this page answers.
 */
export function PageHeader({
  breadcrumb,
  title,
  purpose,
  status,
}: {
  readonly breadcrumb: readonly string[];
  readonly title: string;
  readonly purpose: string;
  readonly status?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
      <div className="min-w-0">
        <nav aria-label="Breadcrumb">
          <ol className="flex flex-wrap items-center gap-1.5 text-[10.5px] tracking-[0.08em] text-[var(--color-ink-faint)] uppercase">
            {breadcrumb.map((crumb, index) => (
              <li key={crumb} className="flex items-center gap-1.5">
                {index > 0 ? <span aria-hidden="true">/</span> : null}
                <span>{crumb}</span>
              </li>
            ))}
          </ol>
        </nav>
        <h1 className="mt-1.5 text-[22px] leading-tight font-semibold tracking-[-0.01em] text-[var(--color-ink)]">
          {title}
        </h1>
        <p className="mt-1.5 max-w-[76ch] text-[12.5px] leading-relaxed text-[var(--color-ink-muted)]">
          {purpose}
        </p>
      </div>
      {status === undefined ? null : (
        <div className="flex flex-wrap items-center gap-2">{status}</div>
      )}
    </div>
  );
}
