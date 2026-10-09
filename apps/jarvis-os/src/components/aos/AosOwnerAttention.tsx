import type { AosOwnerAttentionObservation } from '@qf-jarvis/aos-intelligence';

import { Panel } from '@/components/primitives/Panel';
import { Tag } from '@/components/system/StatusPill';

type AttentionRead =
  | { readonly status: 'AVAILABLE'; readonly observation: AosOwnerAttentionObservation }
  | { readonly status: 'NOT_CONNECTED' | 'STALE' | 'UNUSABLE' };

const LANES = Object.freeze([
  {
    lane: 'NOW',
    purpose: 'Critical or high-scoring owner attention',
    behaviour: 'Surface first in Jarvis OS; urgent outbound remains separately Core-gated.',
  },
  {
    lane: 'SOON',
    purpose: 'Important review that does not justify interruption',
    behaviour: 'Keep visible in the operator queue and roll into the next owner review.',
  },
  {
    lane: 'DIGEST',
    purpose: 'Low-urgency patterns and opportunities',
    behaviour: 'Aggregate into a bounded daily digest instead of creating notification noise.',
  },
] as const);

function actionLabel(action: string | undefined): string {
  if (action === undefined) return 'Review case';
  return action
    .replace(/^REQUEST_/u, '')
    .toLowerCase()
    .replaceAll('_', ' ')
    .replace(/^./u, (value) => value.toUpperCase());
}

function sourceState(read: AttentionRead): {
  readonly label: string;
  readonly tone: 'healthy' | 'shadow' | 'warning' | 'offline';
  readonly detail: string;
} {
  switch (read.status) {
    case 'AVAILABLE':
      return {
        label: 'LIVE SHADOW',
        tone: 'healthy',
        detail: 'A current content-minimized AOS attention snapshot is connected to Jarvis OS.',
      };
    case 'STALE':
      return {
        label: 'STALE',
        tone: 'warning',
        detail: 'The last AOS attention snapshot is older than the accepted observation window.',
      };
    case 'UNUSABLE':
      return {
        label: 'REFUSED',
        tone: 'warning',
        detail:
          'Jarvis OS refused the AOS attention snapshot because its contract or timestamp was unusable.',
      };
    case 'NOT_CONNECTED':
      return {
        label: 'NOT CONNECTED',
        tone: 'offline',
        detail:
          'No current AOS attention snapshot is available. This does not imply there are zero AOS findings.',
      };
  }
}

export function AosOwnerAttention({ read }: { readonly read: AttentionRead }) {
  const source = sourceState(read);
  const items = read.status === 'AVAILABLE' ? read.observation.items : [];

  return (
    <Panel
      title="Owner attention"
      subtitle="AOS converts governed cases into ranked attention lanes. Jarvis OS can observe these findings; outbound notification still requires a separate governed channel."
      action={<Tag tone={source.tone}>{source.label}</Tag>}
    >
      <p className="mb-4 text-[10px] leading-relaxed text-[var(--color-ink-faint)]">
        {source.detail}
      </p>

      {items.length === 0 ? null : (
        <div className="mb-4 overflow-hidden rounded-[var(--radius-control)] border border-[var(--color-line)]">
          {items.slice(0, 12).map((item) => (
            <article
              key={item.caseId}
              className="grid gap-2 border-b border-[var(--color-line)] bg-[var(--color-base-900)] px-3.5 py-3 last:border-0 md:grid-cols-[90px_130px_minmax(0,1fr)_80px]"
            >
              <span>
                <Tag
                  tone={
                    item.priority === 'P0'
                      ? 'critical'
                      : item.priority === 'P1'
                        ? 'warning'
                        : 'info'
                  }
                >
                  {item.priority}
                </Tag>
              </span>
              <span className="text-[10px] font-semibold text-[var(--color-ink)]">
                {item.lane} · {String(item.attentionScore)}
              </span>
              <span className="text-[9.5px] leading-relaxed text-[var(--color-ink-muted)]">
                {actionLabel(item.recommendationAction)} · {item.reasonCodes.join(', ')}
              </span>
              <span className="text-right text-[9px] font-semibold tracking-[0.05em] text-[var(--color-warning)]">
                {item.requiresOwnerReview ? 'REVIEW' : 'WATCH'}
              </span>
            </article>
          ))}
        </div>
      )}

      <div className="grid gap-2 lg:grid-cols-3">
        {LANES.map((item) => (
          <article
            key={item.lane}
            className="rounded-[var(--radius-control)] border border-[var(--color-line)] bg-[var(--color-base-850)] px-3.5 py-3"
          >
            <div className="flex items-center justify-between gap-2">
              <p className="text-[11px] font-semibold text-[var(--color-ink)]">{item.lane}</p>
              <Tag
                tone={item.lane === 'NOW' ? 'warning' : item.lane === 'SOON' ? 'info' : 'shadow'}
              >
                RANKED
              </Tag>
            </div>
            <p className="mt-2 text-[10px] font-medium text-[var(--color-ink-muted)]">
              {item.purpose}
            </p>
            <p className="mt-1.5 text-[9.5px] leading-relaxed text-[var(--color-ink-faint)]">
              {item.behaviour}
            </p>
          </article>
        ))}
      </div>

      <div className="mt-4 overflow-hidden rounded-[var(--radius-control)] border border-[var(--color-line)]">
        {[
          [
            'Jarvis OS command center',
            read.status === 'AVAILABLE' ? 'CONNECTED' : 'CONTRACT READY',
            'Primary owner surface for every ranked AOS shadow case.',
          ],
          [
            'Owner WhatsApp — urgent only',
            'NOT CONNECTED',
            'Reserved for separately Core-authorized P0/P1 delivery; AOS itself cannot send.',
          ],
          [
            'Daily owner digest',
            'NOT CONNECTED',
            'Reserved for a separately authorized low-noise summary of SOON/DIGEST findings.',
          ],
        ].map(([channel, state, description]) => (
          <div
            key={channel}
            className="grid gap-2 border-b border-[var(--color-line)] bg-[var(--color-base-900)] px-3.5 py-3 last:border-0 md:grid-cols-[200px_130px_minmax(0,1fr)]"
          >
            <span className="text-[10px] font-semibold text-[var(--color-ink)]">{channel}</span>
            <span className="text-[9px] font-semibold tracking-[0.05em] text-[var(--color-warning)]">
              {state}
            </span>
            <span className="text-[9.5px] text-[var(--color-ink-faint)]">{description}</span>
          </div>
        ))}
      </div>

      <p className="mt-3 text-[9.5px] leading-relaxed text-[var(--color-ink-faint)]">
        Snapshot fields are content-minimized: case reference, priority, attention lane, score,
        bounded reason codes and optional recommendation action. No phone number, message body,
        consent claim or business authorization is carried into this channel.
      </p>
    </Panel>
  );
}
