'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { BrandLockup } from '@/components/shell/Brand';
import { NAV_GROUPS, activeHref } from '@/lib/navigation/catalog';

/**
 * The primary navigation (JOS-01A).
 *
 * Rendered from `NAV_GROUPS` rather than hand-written here, so the sidebar, the mobile
 * drawer and the tests cannot disagree about what modules exist.
 *
 * It is a real `<nav>` containing real lists of real links: keyboard traversal, landmark
 * navigation and browser find all work without anything being re-implemented. The active
 * item carries `aria-current="page"` — the accent bar beside it is reinforcement, not the
 * signal.
 */
export function SideNav({
  // A no-op default rather than an optional handler: under `exactOptionalPropertyTypes` an
  // explicitly-undefined `onClick` is a type error, and threading a conditional spread through
  // every link would be noise in exchange for nothing.
  onNavigate = () => undefined,
}: {
  readonly onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const active = activeHref(pathname);

  return (
    <nav aria-label="Jarvis OS sections" className="flex h-full flex-col">
      <div className="px-5 py-5">
        <Link
          href="/"
          className="inline-block rounded-[var(--radius-control)]"
          onClick={onNavigate}
        >
          <BrandLockup />
        </Link>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-4">
        {NAV_GROUPS.map((group) => (
          <div key={group.id} className="mb-5">
            <p className="px-2 pb-2 text-[10px] font-semibold tracking-[0.14em] text-[var(--color-ink-faint)] uppercase">
              {group.label}
            </p>
            <ul className="space-y-0.5">
              {group.items.map((item) => {
                const isActive = active === item.href;
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      onClick={onNavigate}
                      aria-current={isActive ? 'page' : undefined}
                      className={`group relative flex items-center gap-2 rounded-[var(--radius-control)] px-2.5 py-[7px] text-[12.5px] transition-colors duration-150 ${
                        isActive
                          ? 'bg-[var(--color-base-800)] text-[var(--color-ink)]'
                          : 'text-[var(--color-ink-muted)] hover:bg-[var(--color-base-850)] hover:text-[var(--color-ink)]'
                      }`}
                    >
                      <span
                        aria-hidden="true"
                        className={`absolute top-1/2 left-0 h-4 w-[2px] -translate-y-1/2 rounded-full transition-opacity duration-150 ${
                          isActive ? 'bg-[var(--color-accent)] opacity-100' : 'opacity-0'
                        }`}
                      />
                      <span className="truncate">{item.label}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>

      <div className="border-t border-[var(--color-line)] px-5 py-3.5">
        <p className="text-[10.5px] leading-relaxed text-[var(--color-ink-faint)]">
          Jarvis recommends. QuickFurno Core authorizes. n8n executes.
        </p>
      </div>
    </nav>
  );
}
