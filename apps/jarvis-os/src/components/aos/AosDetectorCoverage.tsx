import { AOS_DETECTOR_CATALOG_V1, aosDetectorCoverageSummary } from '@qf-jarvis/aos-intelligence';

import { Panel } from '@/components/primitives/Panel';
import { Tag } from '@/components/system/StatusPill';

const COVERAGE_TONE = {
  IMPLEMENTED: 'healthy',
  SOURCE_PARTIAL: 'warning',
  SOURCE_REQUIRED: 'shadow',
  PLANNED: 'planned',
} as const;

export function AosDetectorCoverage() {
  const summary = aosDetectorCoverageSummary();

  return (
    <Panel
      title="Sentry coverage"
      subtitle="Code-backed detector inventory. Coverage state is explicit; AOS never pretends an unconnected source is live."
    >
      <div className="grid gap-2 md:grid-cols-4">
        {Object.entries(summary).map(([state, count]) => (
          <div
            key={state}
            className="rounded-[var(--radius-control)] border border-[var(--color-line)] bg-[var(--color-base-850)] px-3 py-2.5"
          >
            <p className="text-[8.5px] font-semibold tracking-[0.07em] text-[var(--color-ink-faint)] uppercase">
              {state.replaceAll('_', ' ')}
            </p>
            <p className="mt-1 text-[15px] font-semibold text-[var(--color-ink)]">{count}</p>
          </div>
        ))}
      </div>

      <div className="mt-4 grid gap-2 lg:grid-cols-2">
        {AOS_DETECTOR_CATALOG_V1.map((detector) => (
          <article
            key={detector.detectorId}
            className="rounded-[var(--radius-control)] border border-[var(--color-line)] bg-[var(--color-base-850)] px-3.5 py-3"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[11px] font-semibold text-[var(--color-ink)]">
                  {detector.label}
                </p>
                <p className="mt-0.5 font-mono text-[8.5px] text-[var(--color-ink-faint)]">
                  {detector.detectorId}
                </p>
              </div>
              <Tag tone={COVERAGE_TONE[detector.coverage]}>{detector.coverage}</Tag>
            </div>
            <p className="mt-2 text-[9.5px] leading-relaxed text-[var(--color-ink-muted)]">
              {detector.description}
            </p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              <Tag tone="info">{detector.domain}</Tag>
              <Tag tone="shadow">{detector.detectorType}</Tag>
              <Tag tone="offline">NO MODEL NEEDED TO DETECT</Tag>
            </div>
            <p className="mt-2 break-words text-[8.5px] text-[var(--color-ink-faint)]">
              Sources: {detector.sourceRefs.join(' · ')}
            </p>
          </article>
        ))}
      </div>
    </Panel>
  );
}
