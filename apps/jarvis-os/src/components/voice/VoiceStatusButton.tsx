'use client';

import Link from 'next/link';

import { useVoiceSession } from './VoiceSessionProvider';

export function VoiceStatusButton() {
  const { state, muted, start } = useVoiceSession();

  if (state === 'DISCONNECTED' || state === 'ERROR') {
    return (
      <button
        type="button"
        onClick={() => void start()}
        title="Start Jarvis Voice"
        className="hidden rounded-[var(--radius-pill)] border border-[var(--color-line)] px-2.5 py-[3px] text-[9.5px] font-semibold tracking-[0.06em] text-[var(--color-ink-faint)] uppercase transition-colors hover:text-[var(--color-accent-bright)] sm:inline-flex"
      >
        Voice off
      </button>
    );
  }

  return (
    <Link
      href="/voice"
      title="Open Jarvis Voice"
      className="hidden items-center gap-1.5 rounded-[var(--radius-pill)] border border-[var(--color-accent)]/35 bg-[var(--color-accent)]/[0.06] px-2.5 py-[3px] text-[9.5px] font-semibold tracking-[0.06em] text-[var(--color-accent-bright)] uppercase sm:inline-flex"
    >
      <span
        className={
          'h-1.5 w-1.5 rounded-full ' +
          (state === 'CONNECTING' || state === 'WAITING_FOR_AGENT' || state === 'RECONNECTING'
            ? 'bg-[var(--color-warning)]'
            : muted
              ? 'bg-[var(--color-ink-faint)]'
              : 'bg-[var(--color-healthy)]')
        }
      />
      {state === 'CONNECTING'
        ? 'Voice…'
        : state === 'WAITING_FOR_AGENT'
          ? 'Joining…'
          : state === 'RECONNECTING'
            ? 'Reconnecting…'
            : muted
              ? 'Muted'
              : 'Voice live'}
    </Link>
  );
}
