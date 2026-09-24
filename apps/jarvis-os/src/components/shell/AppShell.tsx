'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { usePathname } from 'next/navigation';

import { NotificationCenter } from '@/components/shell/NotificationCenter';
import { OperatorMenu } from '@/components/shell/OperatorMenu';
import { OperatorCommandProvider } from '@/components/operator/OperatorCommandProvider';
import { CommandPalette } from '@/components/shell/CommandPalette';
import { MobileDock } from '@/components/shell/MobileDock';
import { SideNav } from '@/components/navigation/SideNav';
import { BrandLockup } from '@/components/shell/Brand';
import type { AttentionItem } from '@/lib/control-plane/types';
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
  attention,
}: {
  readonly children: ReactNode;
  readonly operator: OperatorSessionView;
  readonly attention: readonly AttentionItem[];
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
    <OperatorCommandProvider csrfToken={csrfToken}>
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
            attention={attention}
          />
          <main
            id="jos-main"
            className="min-w-0 flex-1 px-4 py-5 pb-24 sm:px-6 lg:px-8 lg:py-7 lg:pb-7"
          >
            <div className="mx-auto w-full max-w-[1600px]">{children}</div>
          </main>
          <MobileDock />
        </div>
      </div>
    </OperatorCommandProvider>
  );
}

function TopBar({
  onOpenDrawer,
  operator,
  csrfToken,
  attention,
}: {
  readonly onOpenDrawer: () => void;
  readonly operator: OperatorSessionView;
  readonly csrfToken: string;
  readonly attention: readonly AttentionItem[];
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

        <div className="ml-auto hidden min-w-0 flex-1 justify-center lg:flex">
          <CommandPalette />
        </div>

        <div className="ml-auto flex items-center gap-2.5 lg:ml-0">
          <span className="hidden items-center gap-1.5 rounded-[var(--radius-pill)] border border-[var(--color-warning)]/35 bg-[var(--color-warning)]/10 px-2.5 py-[3px] text-[10.5px] font-semibold tracking-[0.05em] text-[var(--color-warning)] uppercase sm:inline-flex">
            Rollout off
          </span>
          <span className="hidden rounded-[var(--radius-pill)] border border-[var(--color-line)] bg-[var(--color-base-900)] px-2.5 py-[3px] text-[10.5px] font-semibold tracking-[0.05em] text-[var(--color-ink-muted)] uppercase md:inline-flex">
            {ENVIRONMENT_LABEL}
          </span>

          <NotificationCenter items={attention} />

          <OperatorMenu operator={operator} csrfToken={csrfToken} />
        </div>
      </div>
    </header>
  );
}
