import { Notice, Panel } from '@/components/primitives/Panel';
import { PageHeader } from '@/components/shell/PageHeader';
import { StatusPill, Tag } from '@/components/system/StatusPill';
import { controlPlane } from '@/lib/control-plane';
import { runtimeCapabilities } from '@/lib/control-plane/proactive';
import { operatorBootstrap } from '@/server/operator/bootstrap';

export default async function MemoryPage() {
  const plane = await controlPlane();
  const capability = runtimeCapabilities(plane, operatorBootstrap()).find(
    (entry) => entry.id === 'memory.governed',
  );

  return (
    <>
      <PageHeader
        breadcrumb={['Intelligence', 'Memory']}
        title="Governed long-term memory"
        purpose="Memory may improve continuity, but durable writes remain a governed capability with explicit owner, retention and erasure policy."
        status={<StatusPill state={capability?.effective ?? 'NOT_CONNECTED'} />}
      />

      <div className="space-y-5">
        <Notice tone="warning" title="Durable writes remain disabled">
          The memory runtime and PostgreSQL store exist, but Jarvis will not enable durable memory
          because code exists. Activation requires explicit owner approval, a retention policy and
          an erasure policy.
        </Notice>

        <div className="grid gap-5 lg:grid-cols-4">
          <Gate label="Runtime" state="Implemented">
            Policy-gated read/write runtime exists.
          </Gate>
          <Gate label="Store" state="Implemented">
            PostgreSQL memory adapter exists behind the runtime.
          </Gate>
          <Gate label="Durable writes" state="Disabled">
            No standing permission to persist new long-term memory.
          </Gate>
          <Gate label="Authority" state="Core-owned">
            Memory never becomes QuickFurno business truth.
          </Gate>
        </div>

        <Panel
          title="Activation gates"
          subtitle="Every gate must be satisfied before durable memory can be enabled."
        >
          <ol className="grid gap-2 md:grid-cols-2">
            {[
              'Named owner approval reference.',
              'Approved retention policy reference and bounded maximum retention.',
              'Approved erasure policy reference with deletion/revocation semantics.',
              'Production observation showing store health and memory read/write outcomes.',
              'Agent-specific scope rules proving cross-agent isolation.',
              'Continuous evaluation proving memory does not increase unsupported claims.',
            ].map((item, index) => (
              <li
                key={item}
                className="rounded-[var(--radius-control)] border border-[var(--color-line)] px-3.5 py-3 text-[11px] leading-relaxed text-[var(--color-ink-muted)]"
              >
                <span className="mr-2 font-mono text-[var(--color-accent-bright)]">
                  {String(index + 1).padStart(2, '0')}
                </span>
                {item}
              </li>
            ))}
          </ol>
        </Panel>

        <Panel
          title="Memory rule"
          subtitle="What Jarvis is allowed to remember is narrower than what it is able to process."
        >
          <div className="flex flex-wrap gap-2">
            <Tag tone="healthy">Policy-gated</Tag>
            <Tag tone="info">Agent-scoped</Tag>
            <Tag tone="warning">Retention-bound</Tag>
            <Tag tone="critical">Erasable</Tag>
            <Tag tone="offline">Not business authority</Tag>
          </div>
          <p className="mt-3 text-[11.5px] leading-relaxed text-[var(--color-ink-muted)]">
            Until the missing governance references and live store observation exist, the correct
            system behavior is to preserve continuity through bounded conversation state and
            governed knowledge rather than silently turn transient context into permanent memory.
          </p>
        </Panel>
      </div>
    </>
  );
}

function Gate({
  label,
  state,
  children,
}: {
  readonly label: string;
  readonly state: string;
  readonly children: string;
}) {
  return (
    <div className="surface-lift rounded-[var(--radius-panel)] border border-[var(--color-line)] bg-[var(--color-base-900)] px-4 py-4">
      <p className="text-[9.5px] font-semibold tracking-[0.08em] text-[var(--color-ink-faint)] uppercase">
        {label}
      </p>
      <p className="mt-2 text-[15px] font-semibold text-[var(--color-ink)]">{state}</p>
      <p className="mt-2 text-[10.5px] leading-relaxed text-[var(--color-ink-faint)]">{children}</p>
    </div>
  );
}
