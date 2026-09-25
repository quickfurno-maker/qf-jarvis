import Link from 'next/link';

import { Panel } from '@/components/primitives/Panel';
import { PageHeader } from '@/components/shell/PageHeader';
import { StatusPill, Tag } from '@/components/system/StatusPill';
import { controlPlane } from '@/lib/control-plane';
import { answerFromControlPlane } from '@/lib/control-plane/operator-intelligence';
import { runtimeCapabilities } from '@/lib/control-plane/proactive';
import { operatorBootstrap } from '@/server/operator/bootstrap';

const SUGGESTED_QUESTIONS = Object.freeze([
  'What needs my attention right now?',
  'Why is Riya degraded?',
  'Are models healthy?',
  'What failed in execution?',
  'Is QuickFurno Core available?',
  'Which capabilities are not available?',
]);

export default async function IntelligencePage({
  searchParams,
}: {
  readonly searchParams: Promise<{ readonly query?: string | string[] | undefined }>;
}) {
  const params = await searchParams;
  const query = typeof params.query === 'string' ? params.query.trim().slice(0, 500) : '';
  const plane = await controlPlane();
  const bootstrap = operatorBootstrap();
  const answer = query.length === 0 ? undefined : answerFromControlPlane(query, plane, bootstrap);
  const fabric = runtimeCapabilities(plane, bootstrap).filter((capability) =>
    [
      'intelligence.proactive',
      'intelligence.correlation',
      'knowledge.rag',
      'memory.governed',
      'context.semantic-cache',
      'simulation.digital-twin',
      'recovery.certified-fallback',
      'evaluation.continuous',
      'release.certification',
      'interface.voice',
    ].includes(capability.id),
  );

  return (
    <>
      <PageHeader
        breadcrumb={['Intelligence', 'Jarvis']}
        title="Jarvis Intelligence"
        purpose="Ask operational questions against the governed control-plane snapshot. Read-only by design; answers explain and navigate but never authorize or execute."
      />

      <div className="space-y-5">
        <Panel
          title="Ask Jarvis"
          subtitle="Use ⌘K anywhere, choose a prompt, or use Jarvis Voice. All three call the same read-only intelligence contract."
        >
          <div className="flex flex-wrap gap-2">
            {SUGGESTED_QUESTIONS.map((question) => (
              <Link
                key={question}
                href={'/intelligence?query=' + encodeURIComponent(question)}
                className="rounded-[var(--radius-control)] border border-[var(--color-line)] px-3 py-2 text-[11px] text-[var(--color-ink-muted)] transition-colors hover:border-[var(--color-line-strong)] hover:text-[var(--color-ink)]"
              >
                {question}
              </Link>
            ))}
          </div>
        </Panel>

        <Panel
          title="Intelligence fabric"
          subtitle="Implementation readiness versus effective runtime state. LiveKit voice stays disconnected until credentials and the agent runtime are provisioned."
        >
          <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-5">
            {fabric.map((capability) => (
              <Link
                key={capability.id}
                href="/governance"
                className="rounded-[var(--radius-control)] border border-[var(--color-line)] px-3.5 py-3 transition-colors hover:border-[var(--color-line-strong)]"
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="text-[11px] font-semibold leading-snug text-[var(--color-ink)]">
                    {capability.label}
                  </p>
                  <StatusPill state={capability.effective} />
                </div>
                <p className="mt-2 text-[9.5px] tracking-[0.06em] text-[var(--color-ink-faint)] uppercase">
                  {capability.source.replaceAll('_', ' ')}
                </p>
                <p className="mt-1.5 line-clamp-3 text-[10.5px] leading-relaxed text-[var(--color-ink-faint)]">
                  {capability.note}
                </p>
              </Link>
            ))}
          </div>
        </Panel>

        {answer === undefined ? (
          <Panel title="Operating intelligence" subtitle="No question selected.">
            <p className="text-[12px] leading-relaxed text-[var(--color-ink-muted)]">
              Ask a question through the command palette or choose a prompt above. Jarvis reads the
              current governed snapshot and refuses to infer missing operational evidence.
            </p>
          </Panel>
        ) : (
          <Panel
            title={answer.headline}
            subtitle={answer.summary}
            action={<Tag tone="info">{answer.topic.replaceAll('_', ' ')}</Tag>}
          >
            <div className="space-y-4">
              <div className="rounded-[var(--radius-control)] border border-[var(--color-line)] bg-[var(--color-base-850)] px-4 py-3">
                <p className="text-[9.5px] font-semibold tracking-[0.08em] text-[var(--color-ink-faint)] uppercase">
                  Question
                </p>
                <p className="mt-1.5 text-[12.5px] text-[var(--color-ink)]">{query}</p>
              </div>

              {answer.facts.length === 0 ? null : (
                <ul className="grid gap-2 lg:grid-cols-2">
                  {answer.facts.map((fact, index) => (
                    <li
                      key={String(index) + ':' + fact}
                      className="rounded-[var(--radius-control)] border border-[var(--color-line)] px-3.5 py-3 text-[11px] leading-relaxed text-[var(--color-ink-muted)]"
                    >
                      {fact}
                    </li>
                  ))}
                </ul>
              )}

              <div className="flex flex-wrap items-center gap-2 border-t border-[var(--color-line)] pt-3">
                <Tag tone="offline">Read only</Tag>
                <span className="text-[10.5px] text-[var(--color-ink-faint)]">
                  Confidence: deterministic · execution authority: none · business effect: false
                </span>
              </div>

              {answer.routes.length === 0 ? null : (
                <div className="flex flex-wrap gap-2">
                  {answer.routes.map((href) => (
                    <Link
                      key={href}
                      href={href}
                      className="rounded-[var(--radius-control)] border border-[var(--color-accent)]/30 bg-[var(--color-accent)]/[0.05] px-3 py-2 text-[10.5px] font-semibold text-[var(--color-accent-bright)] hover:border-[var(--color-accent)]/60"
                    >
                      Investigate {href} →
                    </Link>
                  ))}
                </div>
              )}
            </div>
          </Panel>
        )}
      </div>
    </>
  );
}
