import Link from 'next/link';

import { Notice, Panel } from '@/components/primitives/Panel';
import { PageHeader } from '@/components/shell/PageHeader';
import { Tag } from '@/components/system/StatusPill';
import { readAgniHealth, readAgniIncidents } from '@/server/agni/client';

type Health = 'HEALTHY' | 'DEGRADED' | 'UNHEALTHY' | 'UNKNOWN';

interface HealthView {
  readonly state: Health;
  readonly observedAt: string;
  readonly evidenceCount: number;
}
interface IncidentView {
  readonly incidentId: string;
  readonly category: string;
  readonly severity: string;
  readonly targetSystem: string;
  readonly targetService: string;
  readonly safeSummary: string;
  readonly detectedAt: string;
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function healthView(value: unknown): HealthView {
  const root = record(value);
  const health = record(root?.['health']);
  const state = health?.['health'];
  return {
    state:
      state === 'HEALTHY' || state === 'DEGRADED' || state === 'UNHEALTHY' || state === 'UNKNOWN'
        ? state
        : 'UNKNOWN',
    observedAt: typeof health?.['observedAt'] === 'string' ? health['observedAt'] : '—',
    evidenceCount: Array.isArray(health?.['evidenceRefs']) ? health['evidenceRefs'].length : 0,
  };
}

function safeText(value: unknown): string {
  return typeof value === 'string' ? value : 'UNKNOWN';
}

function incidentsView(value: unknown): readonly IncidentView[] {
  const root = record(value);
  const incidents = root?.['incidents'];
  if (!Array.isArray(incidents)) return [];
  return incidents.slice(0, 50).flatMap((one) => {
    const row = record(one);
    if (!row) return [];
    const incidentId = typeof row['incidentId'] === 'string' ? row['incidentId'] : '';
    if (!incidentId) return [];
    return [
      {
        incidentId,
        category: safeText(row['category']),
        severity: safeText(row['severity']),
        targetSystem: safeText(row['targetSystem']),
        targetService: safeText(row['targetService']),
        safeSummary: safeText(row['safeSummary']),
        detectedAt: typeof row['detectedAt'] === 'string' ? row['detectedAt'] : '—',
      },
    ];
  });
}

function tone(state: Health): 'healthy' | 'warning' | 'critical' | 'offline' {
  if (state === 'HEALTHY') return 'healthy';
  if (state === 'DEGRADED') return 'warning';
  if (state === 'UNHEALTHY') return 'critical';
  return 'offline';
}

async function safe<T>(work: Promise<T>): Promise<T | undefined> {
  try {
    return await work;
  } catch {
    return undefined;
  }
}

export default async function AgniPage() {
  const [qfRaw, jarvisRaw, incidentsRaw] = await Promise.all([
    safe(readAgniHealth('QUICKFURNO', 'quickfurno.web')),
    safe(readAgniHealth('JARVIS', 'qf-jarvis.quickfurno-gateway')),
    safe(readAgniIncidents(50)),
  ]);
  const qf = healthView(qfRaw);
  const jarvis = healthView(jarvisRaw);
  const incidents = incidentsView(incidentsRaw);
  const connected = qfRaw !== undefined || jarvisRaw !== undefined || incidentsRaw !== undefined;

  return (
    <>
      <PageHeader
        breadcrumb={['Operate', 'AGNI']}
        title="AGNI supervisory plane"
        purpose="Independent reliability, security and AI-SRE supervision for QuickFurno and Jarvis. Jarvis is the owner interface; AGNI remains a separate failure and execution domain."
        status={
          <Tag tone={connected ? 'healthy' : 'offline'}>
            {connected ? 'Connected' : 'Unavailable'}
          </Tag>
        }
      />
      <div className="space-y-5">
        <Notice
          tone={connected ? 'info' : 'offline'}
          title={connected ? 'Independent supervision connected' : 'AGNI not reachable'}
        >
          {connected
            ? 'AGNI observes both systems independently. AI analysis is bounded and on-demand; production changes still require QuickFurno Core policy/capability approval.'
            : 'Health is UNKNOWN while AGNI is unreachable. Jarvis does not infer that either supervised system is healthy.'}
        </Notice>

        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          <HealthPanel label="QuickFurno" service="quickfurno.web" value={qf} />
          <HealthPanel label="Jarvis" service="qf-jarvis.quickfurno-gateway" value={jarvis} />
        </div>

        <Panel
          title="Open AGNI incidents"
          subtitle="Content-safe reliability and security incidents from AGNI's independent state store"
          action={
            <Link className="text-[11px] text-[var(--color-accent-bright)]" href="/approvals">
              Open approvals →
            </Link>
          }
        >
          {incidents.length === 0 ? (
            <p className="text-[12px] text-[var(--color-ink-muted)]">
              {connected ? 'No open incidents were returned.' : 'Incident state unavailable.'}
            </p>
          ) : (
            <div className="space-y-2">
              {incidents.map((incident) => (
                <div
                  key={incident.incidentId}
                  className="rounded-[var(--radius-control)] border border-[var(--color-line)] p-3"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <Tag
                      tone={
                        incident.severity === 'EMERGENCY' || incident.severity === 'CRITICAL'
                          ? 'critical'
                          : incident.severity === 'WARNING'
                            ? 'warning'
                            : 'offline'
                      }
                    >
                      {incident.severity}
                    </Tag>
                    <span className="text-[12px] font-semibold text-[var(--color-ink)]">
                      {incident.safeSummary}
                    </span>
                  </div>
                  <p className="mt-2 text-[11px] text-[var(--color-ink-muted)]">
                    {incident.targetSystem} · {incident.targetService} · {incident.category}
                  </p>
                  <p className="mt-1 font-mono text-[10px] text-[var(--color-ink-faint)]">
                    {incident.incidentId} · {incident.detectedAt}
                  </p>
                </div>
              ))}
            </div>
          )}
        </Panel>

        <Panel
          title="Authority boundary"
          subtitle="AGNI cannot silently promote an AI recommendation into production"
        >
          <div className="grid grid-cols-1 gap-3 text-[12px] text-[var(--color-ink-muted)] md:grid-cols-4">
            <Boundary label="Observe" value="Automatic" />
            <Boundary label="Investigate" value="Bounded AI" />
            <Boundary label="High-risk fix" value="JEV + human" />
            <Boundary label="Execute" value="Capability-bound broker" />
          </div>
        </Panel>
      </div>
    </>
  );
}

function HealthPanel({
  label,
  service,
  value,
}: {
  readonly label: string;
  readonly service: string;
  readonly value: HealthView;
}) {
  return (
    <Panel
      title={label}
      subtitle={service}
      action={<Tag tone={tone(value.state)}>{value.state}</Tag>}
    >
      <div className="grid grid-cols-2 gap-4">
        <div>
          <p className="text-[10px] uppercase tracking-[0.12em] text-[var(--color-ink-faint)]">
            Observed
          </p>
          <p className="mt-1 text-[12px] text-[var(--color-ink-muted)]">{value.observedAt}</p>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-[0.12em] text-[var(--color-ink-faint)]">
            Evidence refs
          </p>
          <p className="mt-1 text-[12px] text-[var(--color-ink-muted)]">{value.evidenceCount}</p>
        </div>
      </div>
    </Panel>
  );
}

function Boundary({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <div className="rounded-[var(--radius-control)] border border-[var(--color-line)] p-3">
      <p className="text-[10px] uppercase tracking-[0.12em] text-[var(--color-ink-faint)]">
        {label}
      </p>
      <p className="mt-1 font-medium text-[var(--color-ink)]">{value}</p>
    </div>
  );
}
