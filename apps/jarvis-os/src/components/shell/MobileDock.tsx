'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { OPERATOR_MODULES } from '@qf-jarvis/operator-api-contract';

const ICON: Readonly<Record<string, string>> = Object.freeze({
  overview: '◈',
  operations: '⌁',
  approvals: '✓',
  analytics: '⌇',
});

const ITEMS = Object.freeze(
  OPERATOR_MODULES.filter((module) => module.mobilePrimary).map((module) =>
    Object.freeze({
      href: module.webPath,
      label:
        module.id === 'operations'
          ? 'Operate'
          : module.id === 'approvals'
            ? 'Approve'
            : module.label,
      icon: ICON[module.id] ?? '·',
    }),
  ),
);

export function MobileDock() {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Primary mobile navigation"
      className="mobile-dock fixed inset-x-3 bottom-3 z-40 grid grid-cols-4 rounded-[16px] border border-[var(--color-line-strong)] p-1.5 backdrop-blur-xl lg:hidden"
    >
      {ITEMS.map((item) => {
        const active = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? 'page' : undefined}
            className={
              'flex min-w-0 flex-col items-center gap-1 rounded-[11px] px-1 py-2 text-[9.5px] font-medium ' +
              (active
                ? 'bg-[var(--color-base-750)] text-[var(--color-ink)]'
                : 'text-[var(--color-ink-faint)]')
            }
          >
            <span className="text-[15px]" aria-hidden="true">
              {item.icon}
            </span>
            <span className="truncate">{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
