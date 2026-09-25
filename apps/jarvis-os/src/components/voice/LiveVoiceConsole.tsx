'use client';

import { useVoiceSession } from './VoiceSessionProvider';

export function LiveVoiceConsole() {
  const { state, muted, error, start, stop, toggleMute } = useVoiceSession();

  return (
    <div className="space-y-4">
      <div className="rounded-[16px] border border-[var(--color-line)] bg-[var(--color-base-850)] p-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-[10px] font-semibold tracking-[0.1em] text-[var(--color-accent-bright)] uppercase">
              LiveKit operator voice
            </p>
            <h2 className="mt-2 text-[22px] font-semibold tracking-[-0.03em] text-[var(--color-ink)]">
              {state === 'CONNECTED'
                ? muted
                  ? 'Connected · muted'
                  : 'Connected · mic streaming'
                : state === 'WAITING_FOR_AGENT'
                  ? 'Room connected · transport joining'
                  : state === 'RECONNECTING'
                    ? 'Reconnecting…'
                    : state === 'CONNECTING'
                      ? 'Connecting…'
                      : state === 'ERROR'
                        ? 'Voice unavailable'
                        : 'Voice offline'}
            </h2>
            <p className="mt-2 max-w-2xl text-[11.5px] leading-relaxed text-[var(--color-ink-muted)]">
              Once started, LiveKit keeps the realtime operator audio transport connected while you
              navigate Jarvis OS. This phase carries microphone audio only; speech understanding,
              speech generation and Jarvis reasoning remain separate capabilities.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            {state === 'CONNECTED' || state === 'WAITING_FOR_AGENT' || state === 'RECONNECTING' ? (
              <>
                <button
                  type="button"
                  onClick={() => void toggleMute()}
                  className="rounded-[var(--radius-control)] border border-[var(--color-line)] px-4 py-2.5 text-[11px] font-semibold text-[var(--color-ink)]"
                >
                  {muted ? 'Unmute' : 'Mute'}
                </button>
                <button
                  type="button"
                  onClick={() => void stop()}
                  className="rounded-[var(--radius-control)] border border-[var(--color-danger)]/35 px-4 py-2.5 text-[11px] font-semibold text-[var(--color-danger)]"
                >
                  Disconnect
                </button>
              </>
            ) : (
              <button
                type="button"
                disabled={state === 'CONNECTING'}
                onClick={() => void start()}
                className="rounded-[var(--radius-control)] border border-[var(--color-accent)]/40 bg-[var(--color-accent)]/[0.08] px-4 py-2.5 text-[11px] font-semibold text-[var(--color-accent-bright)] disabled:opacity-50"
              >
                {state === 'CONNECTING' ? 'Connecting…' : 'Start voice'}
              </button>
            )}
          </div>
        </div>

        {error === undefined ? null : (
          <p className="mt-4 rounded-[var(--radius-control)] border border-[var(--color-warning)]/25 bg-[var(--color-warning)]/[0.05] px-3 py-2.5 text-[11px] text-[var(--color-warning)]">
            {error}
          </p>
        )}
      </div>

      <div className="grid gap-2 md:grid-cols-3">
        {[
          ['Authority', 'None', 'Voice transport cannot authorize a Core mutation.'],
          ['Inference', 'None', 'LiveKit carries audio only; no STT, LLM or TTS runs here.'],
          [
            'Microphone',
            'User initiated',
            'The browser requests mic access only after Start voice.',
          ],
        ].map(([label, value, detail]) => (
          <div
            key={label}
            className="rounded-[var(--radius-control)] border border-[var(--color-line)] px-3.5 py-3"
          >
            <p className="text-[9.5px] font-semibold tracking-[0.08em] text-[var(--color-ink-faint)] uppercase">
              {label}
            </p>
            <p className="mt-1.5 text-[13px] font-semibold text-[var(--color-ink)]">{value}</p>
            <p className="mt-1 text-[10.5px] leading-relaxed text-[var(--color-ink-faint)]">
              {detail}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
