import { Notice, Panel } from '@/components/primitives/Panel';
import { PageHeader } from '@/components/shell/PageHeader';
import { StatusPill, Tag } from '@/components/system/StatusPill';
import { controlPlane } from '@/lib/control-plane';
import { runtimeCapabilities } from '@/lib/control-plane/proactive';
import { operatorBootstrap } from '@/server/operator/bootstrap';

export default async function SimulationPage() {
  const plane = await controlPlane();
  const capability = runtimeCapabilities(plane, operatorBootstrap()).find(
    (entry) => entry.id === 'simulation.digital-twin',
  );

  return (
    <>
      <PageHeader
        breadcrumb={['Intelligence', 'Digital Twin']}
        title="Digital Twin"
        purpose="Replay candidate behavior against controlled scenarios before production changes, with zero provider/Core/channel/workflow/database effects."
        status={<StatusPill state={capability?.effective ?? 'NOT_CONNECTED'} />}
      />

      <div className="space-y-5">
        <Notice tone="healthy" title="Simulation is available; effects are not">
          The digital twin can compare baseline and candidate behavior. A scenario that attempts an
          external or business effect is a failed simulation, not a successful action.
        </Notice>

        <Panel
          title="Change rehearsal pipeline"
          subtitle="The path every meaningful AI behavior change should eventually follow."
        >
          <div className="grid gap-2 md:grid-cols-5">
            {[
              ['1', 'Baseline', 'Current governed behavior and evidence.'],
              ['2', 'Candidate', 'Prompt/model/RAG/routing/policy candidate.'],
              ['3', 'Replay', 'Sanitized or synthetic scenarios only.'],
              ['4', 'Compare', 'Quality, safety, latency and cost evidence.'],
              ['5', 'Gate', 'Recommend hold/review; never self-promote.'],
            ].map(([step, label, detail]) => (
              <div
                key={step}
                className="rounded-[var(--radius-control)] border border-[var(--color-line)] px-3.5 py-3"
              >
                <p className="font-mono text-[10px] text-[var(--color-accent-bright)]">{step}</p>
                <p className="mt-1 text-[11.5px] font-semibold text-[var(--color-ink)]">{label}</p>
                <p className="mt-1.5 text-[10.5px] leading-relaxed text-[var(--color-ink-faint)]">
                  {detail}
                </p>
              </div>
            ))}
          </div>
        </Panel>

        <div className="grid gap-5 lg:grid-cols-2">
          <Panel
            title="Zero-effect guarantees"
            subtitle="A twin is safe because these are structural."
          >
            <div className="flex flex-wrap gap-2">
              <Tag tone="healthy">Provider calls 0</Tag>
              <Tag tone="healthy">Core mutations 0</Tag>
              <Tag tone="healthy">Channel sends 0</Tag>
              <Tag tone="healthy">Workflow effects 0</Tag>
              <Tag tone="healthy">Database effects 0</Tag>
            </div>
            <p className="mt-3 text-[11.5px] leading-relaxed text-[var(--color-ink-muted)]">
              Simulation output is evidence for evaluation and human review. It is not authorization
              and it does not become production state.
            </p>
          </Panel>

          <Panel
            title="Next connection"
            subtitle="What is still needed for a production-grade replay center."
          >
            <ul className="space-y-2 text-[11.5px] leading-relaxed text-[var(--color-ink-muted)]">
              <li>Sanitized recent-case corpus with lineage and privacy controls.</li>
              <li>Per-release candidate bindings for model, prompt, RAG and routing changes.</li>
              <li>Comparable quality, safety, latency and cost metrics.</li>
              <li>Stored evidence digests surfaced in Release & Certification.</li>
              <li>Automatic HOLD when the candidate regresses a protected dimension.</li>
            </ul>
          </Panel>
        </div>
      </div>
    </>
  );
}
