import { Notice, Panel } from '@/components/primitives/Panel';
import { PageHeader } from '@/components/shell/PageHeader';
import { CapabilityBadge } from '@/components/system/StatusPill';
import { controlPlane } from '@/lib/control-plane';
import { ENVIRONMENT_LABEL } from '@/lib/environment';

/**
 * Settings (JOS-01A).
 *
 * A shell. There is nothing to configure yet, and the honest rendering of that is an empty
 * screen that says why — not a page of switches that write to nothing.
 *
 * The one genuinely useful thing it does show is provenance: which read model this build is
 * rendering, so an operator never has to guess whether a number came from a system or a
 * fixture.
 */
export default async function SettingsPage() {
  const plane = await controlPlane();

  return (
    <>
      <PageHeader
        breadcrumb={['Boundary', 'Settings']}
        title="Settings"
        purpose="Operator preferences and build provenance. Nothing here is configurable in this release."
        status={<CapabilityBadge lifecycle="PLANNED" />}
      />

      <div className="space-y-5">
        <Notice tone="planned" title="No settings exist yet">
          Operator preferences arrive with the authenticated session boundary in JOS-01C. This
          release has no session, no stored preference and no writable setting.
        </Notice>

        <Panel title="Build provenance" subtitle="Where this screen's data comes from">
          <dl className="divide-y divide-[var(--color-line)]">
            <Entry
              label="Read model"
              value={plane.kind === 'demo' ? 'Demo (local fixture)' : 'Control-plane API'}
            />
            <Entry label="Environment" value={ENVIRONMENT_LABEL} />
            <Entry label="Production rollout" value="OFF" />
            <Entry label="Backend connection" value="None — no control-plane API in JOS-01A" />
            <Entry label="Credentials held" value="None" />
          </dl>
        </Panel>

        <Panel title="What this application can never do" subtitle="Independent of any setting">
          <ul className="space-y-2.5 text-[12px] leading-relaxed text-[var(--color-ink-muted)]">
            <li>Create or answer an approval.</li>
            <li>Send a communication, or reach a provider.</li>
            <li>Invoke n8n, or edit a workflow.</li>
            <li>Mutate QuickFurno Core or any Jarvis durable state.</li>
            <li>Read a secret, or reach a database.</li>
          </ul>
        </Panel>
      </div>
    </>
  );
}

function Entry({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
      <dt className="text-[12px] text-[var(--color-ink-muted)]">{label}</dt>
      <dd className="font-mono text-[11.5px] text-[var(--color-ink)]">{value}</dd>
    </div>
  );
}
