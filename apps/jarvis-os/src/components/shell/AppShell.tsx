'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { usePathname } from 'next/navigation';

import { OperatorMenu } from '@/components/shell/OperatorMenu';
import { SideNav } from '@/components/navigation/SideNav';
import { BrandLockup } from '@/components/shell/Brand';
import { ENVIRONMENT_LABEL } from '@/lib/environment';
import type { OperatorSessionView } from '@/server/auth/dal';

/**
 * The application shell (JOS-01A).
 *
 * Desktop-first: a fixed rail from `lg` upward, and a dismissible drawer below it. The
 * drawer is the only stateful thing in the shell, and it closes on route change so a mobile
 * operator is never left staring at a menu over the page they just opened.
 *
 * The top bar carries the two facts that must never require a click to discover: which
 * environment this is, and that production rollout is OFF.
 */
export function AppShell({
  children,
  operator,
  csrfToken,
}: {
  readonly children: ReactNode;
  readonly operator: OperatorSessionView;
  /**
   * Passed straight into the logout form's hidden input and nowhere else.
   *
   * It is NOT part of `operator`, so it cannot end up in a component that renders session details.
   * This is the only value in the client tree that came from inside the encrypted token.
   */
  readonly csrfToken: string;
}) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const pathname = usePathname();

  // Close on navigation. Without this the drawer stays open over the new page on mobile.
  useEffect(() => {
    setDrawerOpen(false);
  }, [pathname]);

  // Escape closes it, because a full-screen overlay with no keyboard exit is a trap.
  useEffect(() => {
    if (!drawerOpen) {
      return;
    }
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        setDrawerOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, [drawerOpen]);

  return (
    <div className="flex min-h-screen bg-[var(--color-base-950)]">
      <a
        href="#jos-main"
        className="sr-only focus:not-sr-only focus:absolute focus:top-3 focus:left-3 focus:z-50 focus:rounded-[var(--radius-control)] focus:bg-[var(--color-base-800)] focus:px-3 focus:py-2 focus:text-[12px] focus:text-[var(--color-ink)]"
      >
        Skip to content
      </a>

      {/* Fixed rail — desktop and up. */}
      <aside className="hidden w-[248px] shrink-0 border-r border-[var(--color-line)] bg-[var(--color-base-900)] lg:block">
        <div className="sticky top-0 h-screen">
          <SideNav />
        </div>
      </aside>

      {/* Drawer — below lg. */}
      {drawerOpen ? (
        <div className="fixed inset-0 z-40 lg:hidden">
          <button
            type="button"
            aria-label="Close navigation"
            onClick={() => {
              setDrawerOpen(false);
            }}
            className="absolute inset-0 bg-black/70"
          />
          <div className="absolute inset-y-0 left-0 w-[268px] border-r border-[var(--color-line)] bg-[var(--color-base-900)]">
            <SideNav
              onNavigate={() => {
                setDrawerOpen(false);
              }}
            />
          </div>
        </div>
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar
          onOpenDrawer={() => {
            setDrawerOpen(true);
          }}
          operator={operator}
          csrfToken={csrfToken}
        />
        <main id="jos-main" className="min-w-0 flex-1 px-4 py-5 sm:px-6 lg:px-8 lg:py-7">
          <div className="mx-auto w-full max-w-[1560px]">{children}</div>
        </main>
      </div>
    </div>
  );
}

function TopBar({
  onOpenDrawer,
  operator,
  csrfToken,
}: {
  readonly onOpenDrawer: () => void;
  readonly operator: OperatorSessionView;
  readonly csrfToken: string;
}) {
  return (
    <header className="sticky top-0 z-30 border-b border-[var(--color-line)] bg-[var(--color-base-950)]/92 backdrop-blur">
      <div className="flex h-14 items-center gap-3 px-4 sm:px-6 lg:px-8">
        <button
          type="button"
          onClick={onOpenDrawer}
          aria-label="Open navigation"
          className="rounded-[var(--radius-control)] border border-[var(--color-line)] p-2 text-[var(--color-ink-muted)] transition-colors hover:text-[var(--color-ink)] lg:hidden"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
            <path
              d="M2 4h12M2 8h12M2 12h12"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </svg>
        </button>

        <div className="lg:hidden">
          <BrandLockup />
        </div>

        {/* Command affordance — a LOCAL shell only. It performs no search and reaches nothing. */}
        <div className="ml-auto hidden min-w-0 flex-1 justify-center lg:flex">
          <div
            className="flex w-full max-w-[420px] items-center gap-2 rounded-[var(--radius-control)] border border-[var(--color-line)] bg-[var(--color-base-900)] px-3 py-1.5 text-[12px] text-[var(--color-ink-faint)]"
            aria-hidden="true"
          >
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none" focusable="false">
              <circle cx="7" cy="7" r="4.5" stroke="currentColor" strokeWidth="1.4" />
              <path
                d="m10.5 10.5 3 3"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinecap="round"
              />
            </svg>
            <span className="flex-1 truncate">Search — available in a later JOS phase</span>
            <kbd className="rounded border border-[var(--color-line)] px-1.5 py-[1px] text-[10px]">
              ⌘K
            </kbd>
          </div>
        </div>

        <div className="ml-auto flex items-center gap-2.5 lg:ml-0">
          <span className="hidden items-center gap-1.5 rounded-[var(--radius-pill)] border border-[var(--color-warning)]/35 bg-[var(--color-warning)]/10 px-2.5 py-[3px] text-[10.5px] font-semibold tracking-[0.05em] text-[var(--color-warning)] uppercase sm:inline-flex">
            Rollout off
          </span>
          <span className="hidden rounded-[var(--radius-pill)] border border-[var(--color-line)] bg-[var(--color-base-900)] px-2.5 py-[3px] text-[10.5px] font-semibold tracking-[0.05em] text-[var(--color-ink-muted)] uppercase md:inline-flex">
            {ENVIRONMENT_LABEL}
          </span>

          <button
            type="button"
            disabled
            aria-label="Notifications — available in a later JOS phase"
            title="Notifications — available in a later JOS phase"
            className="rounded-[var(--radius-control)] border border-[var(--color-line)] p-2 text-[var(--color-ink-faint)] disabled:cursor-not-allowed"
          >
            <svg
              width="15"
              height="15"
              viewBox="0 0 16 16"
              fill="none"
              aria-hidden="true"
              focusable="false"
            >
              <path
                d="M8 2.5a3.5 3.5 0 0 0-3.5 3.5v2.2L3.4 10.3a.6.6 0 0 0 .5.9h8.2a.6.6 0 0 0 .5-.9L11.5 8.2V6A3.5 3.5 0 0 0 8 2.5Z"
                stroke="currentColor"
                strokeWidth="1.3"
                strokeLinejoin="round"
              />
              <path
                d="M6.6 13a1.5 1.5 0 0 0 2.8 0"
                stroke="currentColor"
                strokeWidth="1.3"
                strokeLinecap="round"
              />
            </svg>
          </button>

          <OperatorMenu operator={operator} csrfToken={csrfToken} />
        </div>
      </div>
    </header>
  );
}
