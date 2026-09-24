import { CommandDeck } from '@/components/command-center/CommandDeck';
import { Notice, Panel } from '@/components/primitives/Panel';
import { PageHeader } from '@/components/shell/PageHeader';
import { StatusPill, Tag } from '@/components/system/StatusPill';
import { controlPlane } from '@/lib/control-plane';
import { ENVIRONMENT_LABEL } from '@/lib/environment';
import { operatorBootstrap } from '@/server/operator/bootstrap';

export default async function SettingsPage() {
  const plane = await controlPlane();
  const bootstrap = operatorBootstrap();
  const provenance = plane.provenance();
  const commandReady = bootstrap.capabilities.some(
    (capability) => capability.state === 'AVAILABLE',
  );

  return (
    <>
      <PageHeader
        breadcrumb={['Boundary', 'Settings']}
        title="Settings & authority"
        purpose="Operator preferences, command readiness and governed configuration boundaries shared by web today and native mobile next."
        status={<StatusPill state={commandReady ? 'AVAILABLE' : 'DEGRADED'} />}
      />

      <div className="space-y-5">
        <Notice tone="info" title="Configuration is split by authority">
          Operator UI preferences may be device-local. Business and runtime configuration is never
          changed by a cosmetic switch: it must cross the versioned operator command boundary and
          remain subject to QuickFurno Core or Jarvis governance.
        </Notice>

        <CommandDeck bootstrap={bootstrap} />

        <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
          <Panel title="Runtime provenance" subtitle="What this client is actually connected to">
            <dl className="divide-y divide-[var(--color-line)]">
              <Entry label="Operator API" value={'v' + bootstrap.apiVersion} />
              <Entry
                label="Snapshot contract"
                value={'v' + String(bootstrap.client.minimumSnapshotVersion)}
              />
              <Entry label="Environment" value={ENVIRONMENT_LABEL} />
              <Entry label="Source" value={provenance.kind.replaceAll('_', ' ')} />
              <Entry
                label="Live operational data"
                value={provenance.liveOperationalData ? 'YES' : 'NO'}
              />
              <Entry label="Web session" value="ACTIVE" />
              <Entry
                label="Native mobile session"
                value={bootstrap.client.mobileDeviceSession ? 'ACTIVE' : 'NEXT'}
              />
            </dl>
          </Panel>

          <Panel
            title="Governed configuration"
            subtitle="Visible now; mutable only after its authority path is certified"
          >
            <div className="space-y-3 text-[12px] text-[var(--color-ink-muted)]">
              <SettingRow label="Agent enablement" authority="Jarvis governance" state="LOCKED" />
              <SettingRow label="Knowledge mode" authority="Jarvis governance" state="LOCKED" />
              <SettingRow
                label="Production rollout"
                authority="Jarvis governance + owner"
                state="LOCKED"
              />
              <SettingRow
                label="Conversation takeover / pause"
                authority="QuickFurno Core"
                state={commandReady ? 'AVAILABLE' : 'NOT CONNECTED'}
              />
              <SettingRow
                label="Approval decisions"
                authority="QuickFurno Core"
                state={commandReady ? 'AVAILABLE' : 'NOT CONNECTED'}
              />
            </div>
          </Panel>
        </div>

        <Panel
          title="Mobile-ready contract"
          subtitle="No web business logic is required by the future app"
        >
          <ul className="grid gap-3 text-[12px] leading-relaxed text-[var(--color-ink-muted)] sm:grid-cols-2">
            <li>Bootstrap, snapshot and command APIs are versioned independently from React.</li>
            <li>Commands carry an explicit WEB / IOS / ANDROID client platform.</li>
            <li>Read and command trust use separate signing credentials.</li>
            <li>The shared client core parses the same outcomes on every platform.</li>
            <li>QuickFurno Core remains authoritative after a mobile command is submitted.</li>
            <li>Native secure-session storage can be added without changing domain contracts.</li>
          </ul>
        </Panel>
      </div>
    </>
  );
}

function SettingRow({
  label,
  authority,
  state,
}: {
  readonly label: string;
  readonly authority: string;
  readonly state: 'LOCKED' | 'AVAILABLE' | 'NOT CONNECTED';
}) {
  const tone = state === 'AVAILABLE' ? 'healthy' : state === 'LOCKED' ? 'warning' : 'offline';
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-control)] border border-[var(--color-line)] px-3.5 py-3">
      <div>
        <p className="text-[12.5px] font-medium text-[var(--color-ink)]">{label}</p>
        <p className="mt-0.5 text-[10.5px] text-[var(--color-ink-faint)]">{authority}</p>
      </div>
      <Tag tone={tone}>{state}</Tag>
    </div>
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
