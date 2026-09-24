import { Notice, Panel } from '@/components/primitives/Panel';
import { PageHeader } from '@/components/shell/PageHeader';
import { StatusPill } from '@/components/system/StatusPill';
import { SourceBadge } from '@/components/system/Provenance';
import { controlPlane } from '@/lib/control-plane';
import { isReadable } from '@/lib/control-plane/types';
import type { SectionAvailability } from '@/lib/control-plane/types';

/**
 * coreAutomation / Integrations (JOS-01A).
 *
 * The sentence this page exists to make unmissable: **coreAutomation is the execution fabric, not the
 * brain.** It validates an authorized intent and performs exactly what that intent says. An
 * coreAutomation that decided whether an action should happen would be an authorization system holding
 * every provider credential in the business — the worst available arrangement of those three
 * properties.
 *
 * No credential, workflow definition or endpoint appears here, and nothing on this page can
 * be edited or triggered.
 */
export default async function IntegrationsPage() {
  const plane = await controlPlane();
  const execution = plane.coreAutomationExecution();
  const workers = plane.workers();
  const models = plane.models();
  const knowledge = plane.knowledge();
  const anyLive =
    isReadable(execution.availability) ||
    isReadable(workers.availability) ||
    isReadable(models.availability) ||
    isReadable(knowledge.availability);

  return (
    <>
      <PageHeader
        breadcrumb={['Boundary', 'coreAutomation / Integrations']}
        title="Execution fabric"
        purpose="Where an authorized intent goes after Core issues it — and why nothing on that path is a decision-maker."
        status={<StatusPill state={anyLive ? 'CONNECTED' : 'NOT_CONNECTED'} />}
      />

      <div className="space-y-5">
        <Notice tone="critical" title="Jarvis never calls coreAutomation, Meta or a provider">
          There is no client, no workflow definition, no webhook and no credential anywhere in
          Jarvis OS or in the Jarvis backend. QuickFurno&rsquo;s existing approved Meta WhatsApp and
          coreAutomation infrastructure is untouched by this application.
        </Notice>

        <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
          <Boundary
            title="coreAutomation"
            role="Executes approved intents"
            forbidden="Authorizes nothing. Holds no business truth. Is not conversational intelligence."
            availability={execution.availability}
          />
          <Boundary
            title="QF Communications Runtime"
            role="Validates and dispatches"
            forbidden="Re-validates consent and eligibility at execution time. Belongs to neither Jarvis nor coreAutomation alone."
            availability={workers.availability}
          />
          <Boundary
            title="Meta / providers"
            role="Deliver"
            forbidden="Decide nothing. Outcomes return to QuickFurno Core, which records them."
            availability={execution.availability}
          />
        </div>

        <Panel title="Integration status" subtitle="Observed through bounded read contracts">
          <ul className="divide-y divide-[var(--color-line)]">
            <IntegrationRow
              label="QuickFurno automation execution"
              detail="Aggregate job state from QuickFurno Core; no workflow body or provider credential crosses into Jarvis OS."
              availability={execution.availability}
            />
            <IntegrationRow
              label="Jarvis production worker"
              detail="Content-free worker health from the dedicated observation file."
              availability={workers.availability}
            />
            <IntegrationRow
              label="Model provider path"
              detail="Provider/gateway health from worker observation; provider keys never enter Jarvis OS."
              availability={models.availability}
            />
            <IntegrationRow
              label="Governed knowledge"
              detail="Exact knowledge-mode observation. Disabled remains a valid, explicit production state."
              availability={knowledge.availability}
            />
          </ul>
        </Panel>

        <Panel title="Why the fabric holds no discretion" subtitle="The property being protected">
          <p className="max-w-[86ch] text-[12px] leading-relaxed text-[var(--color-ink-muted)]">
            coreAutomation&rsquo;s safety property is that it has none. It checks an intent&rsquo;s
            authenticity, integrity, freshness and bounds, and then does precisely what the intent
            says. Give it the ability to decide <em>whether</em> an action should happen and it
            becomes an authorization system that also holds every provider credential —
            concentrating the power to decide and the power to act in one component, with the
            secrets. That is why the decision stays in QuickFurno Core, and why this page is a
            status view rather than an editor.
          </p>
        </Panel>
      </div>
    </>
  );
}

function Boundary({
  title,
  role,
  forbidden,
  availability,
}: {
  readonly title: string;
  readonly role: string;
  readonly forbidden: string;
  readonly availability: SectionAvailability;
}) {
  return (
    <div className="surface-lift rounded-[var(--radius-panel)] border border-[var(--color-line)] bg-[var(--color-base-900)] px-5 py-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-[13px] font-semibold text-[var(--color-ink)]">{title}</p>
        <SourceBadge availability={availability} />
      </div>
      <p className="mt-2.5 text-[12px] text-[var(--color-accent)]">{role}</p>
      <p className="mt-1.5 text-[11.5px] leading-relaxed text-[var(--color-ink-faint)]">
        {forbidden}
      </p>
    </div>
  );
}

function IntegrationRow({
  label,
  detail,
  availability,
}: {
  readonly label: string;
  readonly detail: string;
  readonly availability: SectionAvailability;
}) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
      <div className="min-w-0">
        <p className="text-[12.5px] text-[var(--color-ink)]">{label}</p>
        <p className="mt-0.5 text-[11.5px] text-[var(--color-ink-faint)]">{detail}</p>
      </div>
      <SourceBadge availability={availability} />
    </li>
  );
}
