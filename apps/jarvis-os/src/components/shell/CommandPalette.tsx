'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

import { NAV_ITEMS } from '@/lib/navigation/catalog';

export function CommandPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setOpen((value) => !value);
      } else if (event.key === 'Escape') {
        setOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('keydown', onKey); };
  }, []);

  useEffect(() => {
    if (open) {
      requestAnimationFrame(() => inputRef.current?.focus());
    } else {
      setQuery('');
    }
  }, [open]);

  const items = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return NAV_ITEMS;
    return NAV_ITEMS.filter((item) =>
      (item.label + ' ' + item.scope + ' ' + item.href).toLowerCase().includes(q),
    );
  }, [query]);

  const navigate = (href: string): void => {
    setOpen(false);
    router.push(href);
  };

  return (
    <>
      <button
        type="button"
        onClick={() => { setOpen(true); }}
        className="command-trigger flex w-full max-w-[460px] items-center gap-2 rounded-[var(--radius-control)] border border-[var(--color-line)] px-3 py-2 text-left text-[12px] text-[var(--color-ink-faint)]"
      >
        <span aria-hidden="true">⌕</span>
        <span className="flex-1 truncate">Navigate Jarvis OS</span>
        <kbd className="rounded border border-[var(--color-line)] px-1.5 py-[1px] text-[10px]">
          ⌘K
        </kbd>
      </button>

      {open ? (
        <div className="fixed inset-0 z-[80] flex items-start justify-center bg-black/70 px-4 pt-[12vh] backdrop-blur-sm">
          <button
            type="button"
            aria-label="Close command palette"
            className="absolute inset-0"
            onClick={() => { setOpen(false); }}
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Jarvis OS command palette"
            className="relative z-10 w-full max-w-2xl overflow-hidden rounded-[16px] border border-[var(--color-line-strong)] bg-[var(--color-base-900)] shadow-2xl"
          >
            <div className="border-b border-[var(--color-line)] p-3">
              <input
                ref={inputRef}
                value={query}
                onChange={(event) => { setQuery(event.target.value); }}
                placeholder="Search modules, agents, analytics, controls…"
                className="w-full rounded-[10px] border border-[var(--color-line)] bg-[var(--color-base-850)] px-3 py-3 text-[13px] text-[var(--color-ink)] outline-none placeholder:text-[var(--color-ink-faint)]"
              />
            </div>
            <div className="max-h-[56vh] overflow-y-auto p-2">
              {items.length === 0 ? (
                <p className="px-3 py-6 text-center text-[12px] text-[var(--color-ink-faint)]">
                  No matching Jarvis OS module.
                </p>
              ) : (
                items.map((item) => (
                  <button
                    key={item.href}
                    type="button"
                    onClick={() => { navigate(item.href); }}
                    className="group flex w-full items-center justify-between gap-4 rounded-[10px] px-3 py-2.5 text-left hover:bg-[var(--color-base-800)]"
                  >
                    <span className="min-w-0">
                      <span className="block text-[12.5px] font-semibold text-[var(--color-ink)]">
                        {item.label}
                      </span>
                      <span className="mt-0.5 block truncate text-[11px] text-[var(--color-ink-faint)]">
                        {item.scope}
                      </span>
                    </span>
                    <span className="font-mono text-[10px] text-[var(--color-ink-faint)]">
                      {item.href}
                    </span>
                  </button>
                ))
              )}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
