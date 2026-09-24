import type { Provenance, SystemHealth } from '@/lib/control-plane/types';

function liveCount(health: SystemHealth): number {
  return health.components.filter((component) =>
    ['HEALTHY', 'CONNECTED', 'AVAILABLE'].includes(component.state),
  ).length;
}

export function MissionControlHero({
  provenance,
  health,
}: {
  readonly provenance: Provenance;
  readonly health: SystemHealth;
}) {
  const live = provenance.liveOperationalData;
  const connected = liveCount(health);

  return (
    <section className="mission-hero relative overflow-hidden rounded-[18px] border border-[var(--color-line-strong)] px-5 py-5 sm:px-6 sm:py-6">
      <div className="mission-orb" aria-hidden="true" />
      <div className="relative z-10 grid gap-6 xl:grid-cols-[minmax(0,1.6fr)_minmax(320px,0.8fr)] xl:items-end">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="eyebrow">JARVIS OS / MISSION CONTROL</span>
            <span className={'live-chip ' + (live ? 'is-live' : 'is-static')}>
              <span className={live ? 'pulse-live' : ''} aria-hidden="true">
                ●
              </span>
              {live ? 'Live telemetry' : 'Governed baseline'}
            </span>
          </div>
          <h2 className="mt-4 max-w-[18ch] text-[30px] font-semibold leading-[1.05] tracking-[-0.035em] text-[var(--color-ink)] sm:text-[40px]">
            One operating surface for Jarvis intelligence, safety and execution readiness.
          </h2>
          <p className="mt-4 max-w-[76ch] text-[12.5px] leading-relaxed text-[var(--color-ink-muted)]">
            Web today, native mobile next. Every metric carries provenance; every control declares
            its authority boundary before it can become actionable.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <HeroStat label="Observed now" value={live ? 'YES' : 'NO'} />
          <HeroStat label="Healthy/connected" value={String(connected)} />
          <HeroStat label="System components" value={String(health.components.length)} />
          <HeroStat label="Rollout" value="OFF" />
        </div>
      </div>
    </section>
  );
}

function HeroStat({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <div className="hero-stat rounded-[12px] border border-[var(--color-line)] px-3.5 py-3">
      <p className="text-[9.5px] font-semibold tracking-[0.1em] text-[var(--color-ink-faint)] uppercase">
        {label}
      </p>
      <p className="tabular mt-2 text-[20px] font-semibold tracking-[-0.02em] text-[var(--color-ink)]">
        {value}
      </p>
    </div>
  );
}
