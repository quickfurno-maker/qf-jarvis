import { AOS_DETECTOR_CATALOG_V1, aosDetectorCoverageSummary } from '@qf-jarvis/aos-intelligence';

import { Panel } from '@/components/primitives/Panel';
import { Tag } from '@/components/system/StatusPill';

const TONE = {
  IMPLEMENTED: 'healthy',
  SOURCE_PARTIAL: 'info',
  SOURCE_REQUIRED: 'warning',
  PLANNED: 'offline',
} as const;

export function AosCoveragePanel() {
  const summary = aosDetectorCoverageSummary();

  return (
    <Panel
      title="Detector coverage"
      subtitle="Code capability and live-source availability are shown separately. A contract that Core does not emit yet is not reported as live coverage."
      action={<Tag tone="shadow">DETERMINISTIC FIRST</Tag>}
    >
      <div className="grid gap-px overflow-hidden rounded-[var(--radius-control)] border border-[var(--color-line)] bg-[var(--color-line)] sm:grid-cols-2 xl:grid-cols-4">
        {Object.entries(summary).map(([state, count]) => (
          <div key={state} className="bg-[var(--color-base-850)] px-4 py-3">
            <p className="text-[9px] font-semibold tracking-[0.08em] text-[var(--color-ink-faint)] uppercase">
              {state.replaceAll('_', ' ')}
            </p>
            <p className="mt-1 text-[18px] font-semibold tabular-nums text-[var(--color-ink)]">
              {count}
            </p>
          </div>
        ))}
      </div>

      <div className="mt-4 overflow-hidden rounded-[var(--radius-control)] border border-[var(--color-line)]">
        <div className="grid grid-cols-[minmax(170px,1.1fr)_120px_130px_minmax(220px,1.5fr)] gap-3 border-b border-[var(--color-line)] bg-[var(--color-base-800)] px-3 py-2 text-[9px] font-semibold tracking-[0.06em] text-[var(--color-ink-faint)] uppercase">
          <span>Detector</span>
          <span>Domain</span>
          <span>Coverage</span>
          <span>Source</span>
        </div>
        {AOS_DETECTOR_CATALOG_V1.map((detector) => (
          <div
            key={detector.detectorId}
            className="grid grid-cols-[minmax(170px,1.1fr)_120px_130px_minmax(220px,1.5fr)] gap-3 border-b border-[var(--color-line)] bg-[var(--color-base-850)] px-3 py-2.5 text-[10px] last:border-0"
          >
            <div>
              <p className="font-semibold text-[var(--color-ink)]">{detector.label}</p>
              <p className="mt-0.5 font-mono text-[8.5px] text-[var(--color-ink-faint)]">
                {detector.detectorId}
              </p>
            </div>
            <span className="text-[var(--color-ink-muted)]">
              {detector.domain.replaceAll('_', ' ')}
            </span>
            <span>
              <Tag tone={TONE[detector.coverage]}>{detector.coverage}</Tag>
            </span>
            <span className="text-[var(--color-ink-faint)]">{detector.sourceRefs.join(' · ')}</span>
          </div>
        ))}
      </div>
    </Panel>
  );
}
