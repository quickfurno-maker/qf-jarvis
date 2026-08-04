'use client';

import { useEffect, useRef, useState } from 'react';

import type { OperatorSessionView } from '@/server/auth/dal';

/**
 * The operator menu and sign-out control (JOS-01C, ADR-0087).
 *
 * ### The only newly enabled control in the application
 *
 * Every other action-looking button in Jarvis OS is `disabled` with a stated reason, and JOS-01C
 * does not change that. Sign-out is enabled because it is the one mutation this phase adds, and it
 * mutates browser authentication state alone: it clears a cookie. It grants nothing, approves
 * nothing and reaches no backend.
 *
 * ### Sign-out is a POST form, not a link
 *
 * A GET logout can be fired by an `<img src>`, a prefetcher or a link-scanning email client. This
 * posts, carries the session-bound CSRF token in a hidden field, and the route additionally
 * verifies the request origin.
 *
 * The CSRF token reaches exactly one place in the DOM — that hidden input. It is never stored, and
 * there is no readable cookie or `localStorage` entry an injected script could lift it from.
 */
export function OperatorMenu({
  operator,
  csrfToken,
}: {
  readonly operator: OperatorSessionView;
  readonly csrfToken: string;
}) {
  const [open, setOpen] = useState(false);
  const container = useRef<HTMLDivElement | null>(null);

  // Close on outside click and on Escape. A menu with no keyboard exit is a trap.
  useEffect(() => {
    if (!open) {
      return;
    }
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        setOpen(false);
      }
    };
    const onPointerDown = (event: MouseEvent): void => {
      if (container.current !== null && !container.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('mousedown', onPointerDown);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mousedown', onPointerDown);
    };
  }, [open]);

  const initials = operator.displayName
    .split(/\s+/u)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join('');

  return (
    <div className="relative" ref={container}>
      <button
        type="button"
        onClick={() => {
          setOpen((previous) => !previous);
        }}
        aria-expanded={open}
        aria-haspopup="menu"
        className="flex items-center gap-2 rounded-[var(--radius-control)] border border-[var(--color-line)] bg-[var(--color-base-900)] py-1 pr-2.5 pl-1.5 transition-colors hover:border-[var(--color-line-strong)]"
      >
        <span
          aria-hidden="true"
          className="grid h-6 w-6 place-items-center rounded-[5px] bg-[var(--color-accent-dim)] text-[10px] font-semibold text-[var(--color-ink)]"
        >
          {initials === '' ? 'OP' : initials}
        </span>
        <span className="hidden text-[11.5px] text-[var(--color-ink-muted)] sm:inline">
          {operator.displayName}
        </span>
      </button>

      {open ? (
        <div
          role="menu"
          className="absolute right-0 z-40 mt-2 w-[268px] rounded-[var(--radius-panel)] border border-[var(--color-line)] bg-[var(--color-base-900)] p-4 shadow-lg"
        >
          <p className="text-[12.5px] font-semibold text-[var(--color-ink)]">
            {operator.displayName}
          </p>
          <p className="tabular mt-0.5 text-[11px] text-[var(--color-ink-faint)]">
            {operator.operatorId}
          </p>

          <dl className="mt-3 space-y-1.5 border-t border-[var(--color-line)] pt-3 text-[11.5px]">
            <div className="flex items-baseline justify-between gap-3">
              <dt className="text-[var(--color-ink-muted)]">Role</dt>
              <dd className="font-semibold tracking-[0.04em] text-[var(--color-planned)] uppercase">
                {operator.role}
              </dd>
            </div>
            <div className="flex items-baseline justify-between gap-3">
              <dt className="text-[var(--color-ink-muted)]">Session expires</dt>
              <dd className="tabular text-[var(--color-ink)]">
                {new Date(operator.expiresAt * 1000).toISOString().slice(11, 16)} UTC
              </dd>
            </div>
          </dl>

          <p className="mt-3 border-t border-[var(--color-line)] pt-3 text-[11px] leading-relaxed text-[var(--color-ink-faint)]">
            This session permits viewing Jarvis OS. It confers no QuickFurno business authority.
          </p>

          <form method="post" action="/api/auth/logout" className="mt-3">
            <input type="hidden" name="csrfToken" value={csrfToken} />
            <button
              type="submit"
              className="w-full rounded-[var(--radius-control)] border border-[var(--color-line-strong)] bg-[var(--color-base-850)] px-3 py-2 text-[12px] font-medium text-[var(--color-ink)] transition-colors hover:border-[var(--color-critical)]/50 hover:text-[var(--color-critical)]"
            >
              Sign out
            </button>
          </form>
        </div>
      ) : null}
    </div>
  );
}
