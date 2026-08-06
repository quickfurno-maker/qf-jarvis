import { Cell, DataTable, Row } from '@/components/primitives/DataTable';
import { Notice, Panel } from '@/components/primitives/Panel';
import { PageHeader } from '@/components/shell/PageHeader';
import { CapabilityBadge, Tag } from '@/components/system/StatusPill';
import { capability } from '@/lib/capabilities/catalog';
import { controlPlane } from '@/lib/control-plane';

/**
 * Execution (JOS-01A).
 *
 * This screen is the project's explicit resume marker. Anyone opening Jarvis OS after a gap
 * should be able to read, without asking: what merged, what is next, and whether anything can
 * be sent. So the phase markers are rendered as data from the read model rather than written
 * into prose that would quietly go stale.
 *
 * The one line that must never be ambiguous appears twice — as a banner and as a capability
 * row: **live communication send is off, everywhere, for everyone.**
 */
export default async function ExecutionPage() {
  const roadmap = (await controlPlane()).roadmap();
  const intent = capability('execution.intent.validate');
  const bridge = capability('execution.n8n.bridge');
  const send = capability('communication.live-send');

  return (
    <>
      <PageHeader
        breadcrumb={['Operate', 'Execution']}
        title="Execution readiness"
        purpose="What Jarvis can prove about an execution intent, and everything it still cannot do. Core issues intents, n8n executes them, providers deliver."
        status={<CapabilityBadge lifecycle="ROLLOUT_OFF" />}
      />

      <div className="space-y-5">
        <Notice tone="critical" title="LIVE SEND IS OFF">
          No communication can reach a real recipient. There is no n8n bridge, no provider client
          and no credential anywhere in Jarvis, and production rollout is disabled independently of
          all three.
        </Notice>

        <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
          <PhaseCard
            marker="QFJ-P09.01"
            title="Execution intent correlation"
            state="MERGED"
            tone="healthy"
            detail={
              intent?.note ??
              'Validates a Core-issued ExecutionIntentV1 against re-proved approval evidence.'
            }
          />
          <PhaseCard
            marker="QFJ-P09.02"
            title="Authorized dispatch envelope / n8n bridge"
            state="NEXT — NOT IMPLEMENTED"
            tone="warning"
            detail={
              bridge?.note ??
              'The next main-track slice. Test-only bridge validation; nothing dispatches.'
            }
          />
          <PhaseCard
            marker="Rollout"
            title="Live communication send"
            state="OFF"
            tone="critical"
            detail={send?.note ?? 'Production rollout is off. No provider is reachable.'}
          />
        </div>

        <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
          <Panel
            title="What the correlation runtime proves"
            subtitle="QFJ-P09.01 — merged, and deliberately narrow"
          >
            <ul className="space-y-2.5 text-[12px] leading-relaxed text-[var(--color-ink-muted)]">
              <li>The intent names the same recommendation, Core decision, action and thread.</li>
              <li>
                The action it would run reproduces the approved action exactly — same type, same
                contract version, structurally identical governed parameters.
              </li>
              <li>
                The per-action approval verdict is <em>approved</em>, not merely the overall
                outcome.
              </li>
              <li>
                The intent does not predate the decision it cites, and does not outlive the
                recommendation whose action it runs.
              </li>
            </ul>
            <p className="mt-4 border-t border-[var(--color-line)] pt-3 text-[11.5px] leading-relaxed text-[var(--color-ink-faint)]">
              It reads no clock, so it proves provenance rather than freshness. Whether an intent is
              still live <em>now</em> is a dispatch-time question for the execution side, against a
              trusted execution-side clock.
            </p>
          </Panel>

          <Panel
            title="Communication authorization is separate"
            subtitle="Two artifacts, both required, neither substituting for the other"
          >
            <ul className="space-y-2.5 text-[12px] leading-relaxed text-[var(--color-ink-muted)]">
              <li>
                An execution intent answers <em>which approved action</em> is being run.
              </li>
              <li>
                A communication authorization answers{' '}
                <em>whether this recipient may be contacted</em>.
              </li>
              <li>
                The communication artifact carries no approved-action id, so action identity is
                never inferred from it.
              </li>
              <li>
                Consent, opt-out, suppression and STOP are QuickFurno Core&rsquo;s, revalidated at
                execution time.
              </li>
            </ul>
          </Panel>
        </div>

        <Panel title="Phase markers" subtitle="Read from the control-plane model, not from prose">
          <DataTable
            caption="Execution phase markers and their states."
            head={['Phase', 'State', 'Detail']}
          >
            {roadmap.map((marker) => (
              <Row key={marker.id}>
                <Cell>{marker.label}</Cell>
                <Cell nowrap>
                  <Tag
                    tone={
                      marker.state === 'merged'
                        ? 'healthy'
                        : marker.state === 'next'
                          ? 'warning'
                          : 'planned'
                    }
                  >
                    {marker.state === 'merged'
                      ? 'Merged'
                      : marker.state === 'next'
                        ? 'Next'
                        : 'Planned'}
                  </Tag>
                </Cell>
                <Cell muted>{marker.detail}</Cell>
              </Row>
            ))}
          </DataTable>
        </Panel>

        <Notice tone="info" title="Main Jarvis resume point — QFJ-P09.02">
          After the Jarvis OS foundation track (JOS-01A through JOS-01E), backend work resumes at
          QFJ-P09.02 — the test-only authorized dispatch envelope and n8n bridge validation.
        </Notice>
      </div>
    </>
  );
}

function PhaseCard({
  marker,
  title,
  state,
  tone,
  detail,
}: {
  readonly marker: string;
  readonly title: string;
  readonly state: string;
  readonly tone: 'healthy' | 'warning' | 'critical';
  readonly detail: string;
}) {
  return (
    <div className="surface-lift rounded-[var(--radius-panel)] border border-[var(--color-line)] bg-[var(--color-base-900)] px-5 py-4">
      <div className="flex items-center justify-between gap-3">
        <span className="font-mono text-[11px] tracking-[0.04em] text-[var(--color-ink-faint)]">
          {marker}
        </span>
        <Tag tone={tone}>{state}</Tag>
      </div>
      <p className="mt-2.5 text-[13px] font-semibold text-[var(--color-ink)]">{title}</p>
      <p className="mt-1.5 text-[11.5px] leading-relaxed text-[var(--color-ink-faint)]">{detail}</p>
    </div>
  );
}
