'use client';

import { useState } from 'react';

import type { AttentionItem } from '@/lib/control-plane/types';

export function NotificationCenter({
  items,
}: {
  readonly items: readonly AttentionItem[];
}) {
  const [open, setOpen] = useState(false);
  const critical = items.filter((item) => item.severity === 'critical').length;
  const warning = items.filter((item) => item.severity === 'warning').length;

  return (
    <div className="relative">
      <button
        type="button"
        aria-label={`Notifications — ${items.length} items`}
        aria-expanded={open}
        onClick={() => { setOpen((value) => !value); }}
        className="relative rounded-[var(--radius-control)] border border-[var(--color-line)] p-2 text-[var(--color-ink-muted)] transition-colors hover:border-[var(--color-line-strong)] hover:text-[var(--color-ink)]"
      >
        <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path
            d="M8 2.5a3.5 3.5 0 0 0-3.5 3.5v2.2L3.4 10.3a.6.6 0 0 0 .5.9h8.2a.6.6 0 0 0 .5-.9L11.5 8.2V6A3.5 3.5 0 0 0 8 2.5Z"
            stroke="currentColor"
            strokeWidth="1.3"
            strokeLinejoin="round"
          />
          <path d="M6.6 13a1.5 1.5 0 0 0 2.8 0" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
        </svg>
        {items.length > 0 ? (
          <span className="absolute -right-1.5 -top-1.5 min-w-[16px] rounded-full border border-[var(--color-base-950)] bg-[var(--color-critical)] px-1 text-center text-[9px] font-bold leading-[15px] text-white">
            {items.length > 9 ? '9+' : items.length}
          </span>
        ) : null}
      </button>

      {open ? (
        <>
          <button
            type="button"
            aria-label="Close notifications"
            className="fixed inset-0 z-40 bg-black/20"
            onClick={() => { setOpen(false); }}
          />
          <section
            aria-label="Operator notifications"
            className="fixed inset-x-3 top-[68px] z-50 max-h-[70vh] overflow-hidden rounded-[16px] border border-[var(--color-line-strong)] bg-[var(--color-base-900)] shadow-2xl sm:absolute sm:inset-x-auto sm:right-0 sm:top-[42px] sm:w-[390px]"
          >
            <div className="border-b border-[var(--color-line)] px-4 py-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-[12.5px] font-semibold text-[var(--color-ink)]">Attention center</p>
                  <p className="mt-0.5 text-[10.5px] text-[var(--color-ink-faint)]">
                    {critical} critical · {warning} warning · {items.length} total
                  </p>
                </div>
                <span className="live-chip is-live">Governed</span>
              </div>
            </div>
            <div className="max-h-[58vh] overflow-y-auto p-2">
              {items.length === 0 ? (
                <p className="px-3 py-8 text-center text-[12px] text-[var(--color-ink-faint)]">
                  No current attention items.
                </p>
              ) : (
                items.map((item) => (
                  <article
                    key={item.id}
                    className="rounded-[11px] border border-[var(--color-line)] px-3.5 py-3 [&+&]:mt-2"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <p className="text-[12px] font-semibold text-[var(--color-ink)]">{item.title}</p>
                      <span
                        className={
                          'text-[9px] font-bold uppercase tracking-[0.08em] ' +
                          (item.severity === 'critical'
                            ? 'text-[var(--color-critical)]'
                            : item.severity === 'warning'
                              ? 'text-[var(--color-warning)]'
                              : 'text-[var(--color-accent-bright)]')
                        }
                      >
                        {item.severity}
                      </span>
                    </div>
                    <p className="mt-1.5 text-[11px] leading-relaxed text-[var(--color-ink-muted)]">
                      {item.context}
                    </p>
                    <p className="mt-2 font-mono text-[9.5px] text-[var(--color-ink-faint)]">
                      {item.kind} · {item.age}
                    </p>
                  </article>
                ))
              )}
            </div>
          </section>
        </>
      ) : null}
    </div>
  );
}
