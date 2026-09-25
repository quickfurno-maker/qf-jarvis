import { Cell, DataTable, Row } from '@/components/primitives/DataTable';
import { Notice, Panel } from '@/components/primitives/Panel';
import { PageHeader } from '@/components/shell/PageHeader';
import { StatusPill, Tag } from '@/components/system/StatusPill';
import { controlPlane } from '@/lib/control-plane';
import { runtimeCapabilities } from '@/lib/control-plane/proactive';
import { isReadable } from '@/lib/control-plane/types';
import { readReleaseShaFromEnvironment } from '@/server/auth/config/loader';
import { operatorBootstrap } from '@/server/operator/bootstrap';

const RELEASE_CAPABILITIES = new Set([
  'evaluation.continuous',
  'simulation.digital-twin',
  'release.certification',
  'recovery.certified-fallback',
]);

export default async function ReleasePage() {
  const plane = await controlPlane();
  const evaluations = plane.evaluations();
  const releaseSha = readReleaseShaFromEnvironment();
  const capabilities = runtimeCapabilities(plane, operatorBootstrap()).filter((capability) =>
    RELEASE_CAPABILITIES.has(capability.id),
  );

  return (
    <>
      <PageHeader
        breadcrumb={['Boundary', 'Release']}
        title="Release & Certification"
        purpose="Exact release identity, assurance evidence, continuous evaluation posture, digital-twin readiness and rollout separation."
      />

      <div className="space-y-5">
        <div className="grid gap-5 lg:grid-cols-4">
          <Fact
            label="Running release"
            value={releaseSha === undefined ? 'Not exposed' : releaseSha.slice(0, 12)}
            detail={
              releaseSha === undefined
                ? 'QFJ_JOS_RELEASE_SHA is not available to this process. Jarvis does not guess the running revision.'
                : 'Public release identity supplied by the reviewed deployment boundary.'
            }
          />
          <Fact
            label="Assurance evidence"
            value={evaluations.availability.replaceAll('_', ' ')}
            detail={evaluations.reason}
          />
          <Fact
            label="Production rollout"
            value="OFF"
            detail="Passing assurance evidence never activates rollout by itself."
          />
          <Fact
            label="Observation"
            value={plane.provenance().liveOperationalData ? 'Live' : 'Build declaration'}
            detail="Release conclusions are only as fresh as the evidence shown on this page."
          />
        </div>

        <Notice tone="info" title="Certification is evidence, not authority">
          Tests, evaluations, simulations and smoke checks may prove that a release is eligible for
          review. They never authorize a customer-facing effect or change QuickFurno Core business
          truth.
        </Notice>

        <Panel
          title="Certification fabric"
          subtitle="The gates Jarvis can reason about before a production promotion."
        >
          <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
            {capabilities.map((capability) => (
              <div
                key={capability.id}
                className="rounded-[var(--radius-control)] border border-[var(--color-line)] px-3.5 py-3"
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="text-[11.5px] font-semibold leading-snug text-[var(--color-ink)]">
                    {capability.label}
                  </p>
                  <StatusPill state={capability.effective} />
                </div>
                <p className="mt-2 text-[9.5px] tracking-[0.06em] text-[var(--color-ink-faint)] uppercase">
                  {capability.source.replaceAll('_', ' ')}
                </p>
                <p className="mt-1.5 text-[10.5px] leading-relaxed text-[var(--color-ink-faint)]">
                  {capability.note}
                </p>
              </div>
            ))}
          </div>
        </Panel>

        <Panel
          title="Observed assurance dimensions"
          subtitle="Exact-release evidence from the release-assurance observation boundary when connected."
        >
          {!isReadable(evaluations.availability) ? (
            <p className="text-[12px] leading-relaxed text-[var(--color-ink-muted)]">
              {evaluations.reason} Expected source: {evaluations.expectedSource}.
            </p>
          ) : (
            <DataTable
              caption="Current release assurance dimensions."
              head={['Dimension', 'State', 'Evidence']}
            >
              {evaluations.items.map((dimension) => (
                <Row key={dimension.id}>
                  <Cell>{dimension.label}</Cell>
                  <Cell nowrap>
                    <StatusPill state={dimension.state} />
                  </Cell>
                  <Cell muted>{dimension.detail}</Cell>
                </Row>
              ))}
            </DataTable>
          )}
        </Panel>

        <div className="grid gap-5 lg:grid-cols-2">
          <Panel
            title="Continuous evaluation"
            subtitle="Current repository automation versus the target production loop."
          >
            <ul className="space-y-2.5 text-[11.5px] leading-relaxed text-[var(--color-ink-muted)]">
              <li>
                <Tag tone="healthy">Implemented</Tag> Change-triggered CI evaluates
                agent/model/RAG/memory/intelligence regressions.
              </li>
              <li>
                <Tag tone="shadow">Shadow</Tag> Production sampling and labelled real-world outcome
                evaluation are not yet connected.
              </li>
              <li>
                Any critical regression or stale evidence must produce a HOLD posture; quality
                evidence cannot self-promote a release.
              </li>
            </ul>
          </Panel>

          <Panel title="Promotion rule" subtitle="The release path Jarvis must preserve.">
            <ol className="space-y-2 text-[11.5px] leading-relaxed text-[var(--color-ink-muted)]">
              <li>1. Build + static assurance passes.</li>
              <li>2. Governed evaluations pass with fresh evidence.</li>
              <li>3. Digital twin replays the candidate with zero effects.</li>
              <li>4. Staging / external smoke verifies the immutable release.</li>
              <li>5. A human-owned release boundary decides whether to promote.</li>
              <li>6. Rollout remains independently killable and observable after promotion.</li>
            </ol>
          </Panel>
        </div>
      </div>
    </>
  );
}

function Fact({
  label,
  value,
  detail,
}: {
  readonly label: string;
  readonly value: string;
  readonly detail: string;
}) {
  return (
    <div className="surface-lift rounded-[var(--radius-panel)] border border-[var(--color-line)] bg-[var(--color-base-900)] px-4 py-4">
      <p className="text-[9.5px] font-semibold tracking-[0.08em] text-[var(--color-ink-faint)] uppercase">
        {label}
      </p>
      <p className="mt-2 font-mono text-[17px] font-semibold text-[var(--color-ink)]">{value}</p>
      <p className="mt-2 text-[10.5px] leading-relaxed text-[var(--color-ink-faint)]">{detail}</p>
    </div>
  );
}
