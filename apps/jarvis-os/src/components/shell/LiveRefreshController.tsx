'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

const REFRESH_INTERVAL_MS = 15_000;
const MIN_FOCUS_REFRESH_GAP_MS = 5_000;

export function LiveRefreshController() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [paused, setPaused] = useState(false);
  const [refreshCount, setRefreshCount] = useState(0);
  const lastRefreshAt = useRef(Date.now());

  const refresh = (): void => {
    if (pending) return;
    lastRefreshAt.current = Date.now();
    setRefreshCount((value) => value + 1);
    startTransition(() => {
      router.refresh();
    });
  };

  useEffect(() => {
    if (paused) return;

    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible' && navigator.onLine) {
        refresh();
      }
    }, REFRESH_INTERVAL_MS);

    const onVisibility = (): void => {
      if (
        document.visibilityState === 'visible' &&
        navigator.onLine &&
        Date.now() - lastRefreshAt.current >= MIN_FOCUS_REFRESH_GAP_MS
      ) {
        refresh();
      }
    };

    window.addEventListener('focus', onVisibility);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', onVisibility);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [paused, pending]);

  return (
    <div className="hidden items-center gap-1.5 xl:flex">
      <button
        type="button"
        onClick={() => {
          setPaused((value) => !value);
        }}
        title={paused ? 'Resume automatic refresh' : 'Pause automatic refresh'}
        className={
          'rounded-[var(--radius-pill)] border px-2.5 py-[3px] text-[9.5px] font-semibold tracking-[0.06em] uppercase transition-colors ' +
          (paused
            ? 'border-[var(--color-warning)]/35 text-[var(--color-warning)]'
            : 'border-[var(--color-line)] text-[var(--color-ink-faint)] hover:text-[var(--color-ink)]')
        }
      >
        {paused ? 'Refresh paused' : pending ? 'Refreshing' : 'Auto · 15s'}
      </button>
      <button
        type="button"
        onClick={refresh}
        disabled={pending}
        aria-label="Refresh Jarvis OS now"
        title={
          'Refresh now' + (refreshCount > 0 ? ' · refreshed ' + String(refreshCount) + '×' : '')
        }
        className="rounded-[var(--radius-control)] border border-[var(--color-line)] px-2 py-[3px] text-[11px] text-[var(--color-ink-muted)] transition-colors hover:border-[var(--color-line-strong)] hover:text-[var(--color-ink)] disabled:opacity-50"
      >
        ↻
      </button>
    </div>
  );
}
