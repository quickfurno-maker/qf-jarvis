import { Notice, Panel } from '@/components/primitives/Panel';
import { PageHeader } from '@/components/shell/PageHeader';
import { CapabilityBadge, StatusPill } from '@/components/system/StatusPill';

/**
 * n8n / Integrations (JOS-01A).
 *
 * The sentence this page exists to make unmissable: **n8n is the execution fabric, not the
 * brain.** It validates an authorized intent and performs exactly what that intent says. An
 * n8n that decided whether an action should happen would be an authorization system holding
 * every provider credential in the business — the worst available arrangement of those three
 * properties.
 *
 * No credential, workflow definition or endpoint appears here, and nothing on this page can
 * be edited or triggered.
 */
export default function IntegrationsPage() {
  return (
    <>
      <PageHeader
        breadcrumb={['Boundary', 'n8n / Integrations']}
        title="Execution fabric"
        purpose="Where an authorized intent goes after Core issues it — and why nothing on that path is a decision-maker."
        status={<CapabilityBadge lifecycle="NOT_CONNECTED" />}
      />

      <div className="space-y-5">
        <Notice tone="critical" title="Jarvis never calls n8n, Meta or a provider">
          There is no client, no workflow definition, no webhook and no credential anywhere in
          Jarvis OS or in the Jarvis backend. QuickFurno&rsquo;s existing approved Meta WhatsApp and
          n8n infrastructure is untouched by this application.
        </Notice>

        <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
          <Boundary
            title="n8n"
            role="Executes approved intents"
            forbidden="Authorizes nothing. Holds no business truth. Is not conversational intelligence."
          />
          <Boundary
            title="QF Communications Runtime"
            role="Validates and dispatches"
            forbidden="Re-validates consent and eligibility at execution time. Belongs to neither Jarvis nor n8n alone."
          />
          <Boundary
            title="Meta / providers"
            role="Deliver"
            forbidden="Decide nothing. Outcomes return to QuickFurno Core, which records them."
          />
        </div>

        <Panel title="Integration status" subtitle="What is attached today">
          <ul className="divide-y divide-[var(--color-line)]">
            <IntegrationRow
              label="n8n execution bridge"
              detail="QFJ-P09.02 — next main-track slice. Test-only bridge validation, not implemented."
            />
            <IntegrationRow
              label="Meta WhatsApp"
              detail="QuickFurno operates approved infrastructure. Jarvis has no path to it."
            />
            <IntegrationRow
              label="Flow execution metrics"
              detail="Arrives with the bridge. No workflow has ever been invoked from Jarvis."
            />
          </ul>
        </Panel>

        <Panel title="Why the fabric holds no discretion" subtitle="The property being protected">
          <p className="max-w-[86ch] text-[12px] leading-relaxed text-[var(--color-ink-muted)]">
            n8n&rsquo;s safety property is that it has none. It checks an intent&rsquo;s
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
}: {
  readonly title: string;
  readonly role: string;
  readonly forbidden: string;
}) {
  return (
    <div className="surface-lift rounded-[var(--radius-panel)] border border-[var(--color-line)] bg-[var(--color-base-900)] px-5 py-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-[13px] font-semibold text-[var(--color-ink)]">{title}</p>
        <StatusPill state="NOT_CONNECTED" />
      </div>
      <p className="mt-2.5 text-[12px] text-[var(--color-accent)]">{role}</p>
      <p className="mt-1.5 text-[11.5px] leading-relaxed text-[var(--color-ink-faint)]">
        {forbidden}
      </p>
    </div>
  );
}

function IntegrationRow({ label, detail }: { readonly label: string; readonly detail: string }) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
      <div className="min-w-0">
        <p className="text-[12.5px] text-[var(--color-ink)]">{label}</p>
        <p className="mt-0.5 text-[11.5px] text-[var(--color-ink-faint)]">{detail}</p>
      </div>
      <StatusPill state="NOT_CONNECTED" />
    </li>
  );
}
