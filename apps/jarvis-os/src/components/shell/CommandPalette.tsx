'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

import { NAV_ITEMS } from '@/lib/navigation/catalog';

interface SmartIntent {
  readonly href: string;
  readonly label: string;
  readonly reason: string;
  readonly keywords: readonly string[];
}

const SMART_INTENTS: readonly SmartIntent[] = Object.freeze([
  {
    href: '/approvals',
    label: 'Open approval desk',
    reason: 'Risk, pending decisions and Core-authorized approval requests.',
    keywords: ['approval', 'approve', 'reject', 'pending', 'risk', 'oldest', 'decision'],
  },
  {
    href: '/operations',
    label: 'Open human-control operations',
    reason: 'Takeovers, paused AI and operator control posture.',
    keywords: ['takeover', 'pause', 'resume', 'human', 'escalation', 'operator', 'control'],
  },
  {
    href: '/conversations',
    label: 'Open conversation inventory',
    reason: 'Current conversation ownership and control state.',
    keywords: ['conversation', 'customer', 'vendor', 'chat', 'thread', 'assigned'],
  },
  {
    href: '/agents/riya',
    label: 'Inspect Riya',
    reason: 'Customer-conversation scope, workload and live control posture.',
    keywords: ['riya', 'customer', 'qualification'],
  },
  {
    href: '/agents/anisha',
    label: 'Inspect Anisha',
    reason: 'Registered-vendor care, workload and control posture.',
    keywords: ['anisha', 'registered', 'vendor', 'success', 'support'],
  },
  {
    href: '/agents/aarohi',
    label: 'Inspect Aarohi',
    reason: 'Vendor-growth readiness and governed acquisition boundaries.',
    keywords: ['aarohi', 'acquisition', 'prospect', 'growth', 'outreach'],
  },
  {
    href: '/agents/jarvis',
    label: 'Inspect Jarvis',
    reason: 'Orchestration, coordination and system-level operating posture.',
    keywords: ['jarvis', 'orchestration', 'coordination', 'supervisor'],
  },
  {
    href: '/models',
    label: 'Inspect model gateway',
    reason: 'Provider state, latency, circuits and data-class routing.',
    keywords: ['model', 'provider', 'latency', 'circuit', 'fallback', 'routing', 'groq', 'nara'],
  },
  {
    href: '/voice',
    label: 'Open Jarvis Voice',
    reason: 'Start the read-only LiveKit operator voice channel.',
    keywords: ['voice', 'talk', 'speak', 'microphone', 'mic', 'listen', 'livekit'],
  },
  {
    href: '/intelligence',
    label: 'Ask Jarvis Intelligence',
    reason: 'Read-only proactive reasoning over the current governed operator snapshot.',
    keywords: ['jarvis', 'ask', 'why', 'attention', 'explain', 'intelligence'],
  },
  {
    href: '/memory',
    label: 'Inspect governed memory',
    reason: 'Long-term memory activation, retention and erasure posture.',
    keywords: ['memory', 'remember', 'retention', 'erasure', 'durable'],
  },
  {
    href: '/simulation',
    label: 'Open Digital Twin',
    reason: 'Zero-effect replay and candidate-change rehearsal.',
    keywords: ['simulation', 'simulate', 'twin', 'replay', 'rehearsal'],
  },
  {
    href: '/release',
    label: 'Open Release & Certification',
    reason: 'Release identity, assurance, evaluation, digital-twin and rollout gates.',
    keywords: ['release', 'certification', 'deploy', 'promotion', 'sha', 'build'],
  },
  {
    href: '/knowledge',
    label: 'Inspect governed knowledge',
    reason: 'RAG namespaces, grounding and knowledge availability.',
    keywords: ['rag', 'knowledge', 'retrieval', 'grounding', 'freshness', 'context'],
  },
  {
    href: '/evaluations',
    label: 'Inspect evaluations',
    reason: 'Quality, safety and certification evidence.',
    keywords: ['evaluation', 'eval', 'quality', 'safety', 'test', 'certify', 'regression'],
  },
  {
    href: '/execution',
    label: 'Inspect execution fabric',
    reason: 'Authorized execution outcomes, failed and uncertain jobs.',
    keywords: ['execution', 'failed', 'uncertain', 'dispatch', 'automation', 'job', 'effect'],
  },
  {
    href: '/core-sync',
    label: 'Inspect Core authority boundary',
    reason: 'Source-of-truth ownership and Core/Jarvis separation.',
    keywords: ['core', 'truth', 'authority', 'sync', 'disagree', 'ownership'],
  },
  {
    href: '/workers',
    label: 'Inspect worker fleet',
    reason: 'Worker health, node capacity and production observation.',
    keywords: ['worker', 'fleet', 'gpu', 'node', 'capacity'],
  },
  {
    href: '/analytics',
    label: 'Open intelligence & analytics',
    reason: 'Business aggregates beside operational trends.',
    keywords: ['analytics', 'trend', 'business', 'performance', 'metric', 'today', 'yesterday'],
  },
  {
    href: '/governance',
    label: 'Inspect governance',
    reason: 'Capability lifecycle, rollout and standing authority rules.',
    keywords: ['governance', 'rollout', 'capability', 'policy', 'authority', 'roadmap'],
  },
]);

function tokens(value: string): readonly string[] {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, ' ')
    .trim()
    .split(/\s+/u)
    .filter(Boolean);
}

function smartMatches(query: string): readonly SmartIntent[] {
  const queryTokens = tokens(query);
  if (queryTokens.length === 0) return [];
  return SMART_INTENTS.map((intent) => ({
    intent,
    score: queryTokens.reduce(
      (total, token) =>
        total +
        intent.keywords.reduce(
          (keywordScore, keyword) =>
            keyword === token
              ? keywordScore + 4
              : keyword.includes(token) || token.includes(keyword)
                ? keywordScore + 1
                : keywordScore,
          0,
        ),
      0,
    ),
  }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .map((entry) => entry.intent);
}

export function CommandPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setOpen((value) => !value);
      } else if (event.key === 'Escape') {
        setOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, []);

  useEffect(() => {
    if (open) requestAnimationFrame(() => inputRef.current?.focus());
    else setQuery('');
  }, [open]);

  const smart = useMemo(() => smartMatches(query), [query]);
  const items = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return NAV_ITEMS;
    return NAV_ITEMS.filter((item) =>
      (item.label + ' ' + item.scope + ' ' + item.href).toLowerCase().includes(q),
    );
  }, [query]);

  const navigate = (href: string): void => {
    setOpen(false);
    router.push(href);
  };

  const askJarvis = (): void => {
    const bounded = query.trim();
    if (bounded.length === 0 || bounded.length > 500) return;
    setOpen(false);
    router.push('/intelligence?query=' + encodeURIComponent(bounded));
  };

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setOpen(true);
        }}
        className="command-trigger flex w-full max-w-[500px] items-center gap-2 rounded-[var(--radius-control)] border border-[var(--color-line)] px-3 py-2 text-left text-[12px] text-[var(--color-ink-faint)]"
      >
        <span aria-hidden="true">⌕</span>
        <span className="flex-1 truncate">Search or describe what you need</span>
        <kbd className="rounded border border-[var(--color-line)] px-1.5 py-[1px] text-[10px]">
          ⌘K
        </kbd>
      </button>

      {open ? (
        <div className="fixed inset-0 z-[80] flex items-start justify-center bg-black/70 px-4 pt-[10vh] backdrop-blur-sm">
          <button
            type="button"
            aria-label="Close command palette"
            className="absolute inset-0"
            onClick={() => {
              setOpen(false);
            }}
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Jarvis OS intelligent navigator"
            className="relative z-10 w-full max-w-2xl overflow-hidden rounded-[16px] border border-[var(--color-line-strong)] bg-[var(--color-base-900)] shadow-2xl"
          >
            <div className="border-b border-[var(--color-line)] p-3">
              <div className="flex gap-2">
                <input
                  ref={inputRef}
                  value={query}
                  onChange={(event) => {
                    setQuery(event.target.value);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      askJarvis();
                    }
                  }}
                  maxLength={500}
                  placeholder={'Ask ?what needs me??, ?why is Riya degraded??, or ?model health??'}
                  className="min-w-0 flex-1 rounded-[10px] border border-[var(--color-line)] bg-[var(--color-base-850)] px-3 py-3 text-[13px] text-[var(--color-ink)] outline-none placeholder:text-[var(--color-ink-faint)]"
                />
                <button
                  type="button"
                  onClick={() => {
                    askJarvis();
                  }}
                  disabled={query.trim().length === 0}
                  className="rounded-[10px] border border-[var(--color-accent)]/40 bg-[var(--color-accent)]/10 px-3 text-[11px] font-semibold text-[var(--color-accent-bright)] disabled:opacity-40"
                >
                  Ask Jarvis
                </button>
              </div>
              <p className="mt-2 px-1 text-[10px] leading-relaxed text-[var(--color-ink-faint)]">
                Read-only operator intelligence from the current governed snapshot. It can explain
                and navigate; it never executes a command or changes authority.
              </p>
            </div>
            <div className="max-h-[62vh] overflow-y-auto p-2">
              {query.trim() && smart.length > 0 ? (
                <div className="mb-2 border-b border-[var(--color-line)] pb-2">
                  <p className="px-3 py-1.5 text-[9.5px] font-semibold tracking-[0.1em] text-[var(--color-accent-bright)] uppercase">
                    Suggested
                  </p>
                  {smart.map((intent) => (
                    <button
                      key={'smart:' + intent.href}
                      type="button"
                      onClick={() => {
                        navigate(intent.href);
                      }}
                      className="flex w-full items-start justify-between gap-4 rounded-[10px] px-3 py-2.5 text-left hover:bg-[var(--color-base-800)]"
                    >
                      <span className="min-w-0">
                        <span className="block text-[12.5px] font-semibold text-[var(--color-ink)]">
                          {intent.label}
                        </span>
                        <span className="mt-0.5 block text-[11px] leading-relaxed text-[var(--color-ink-faint)]">
                          {intent.reason}
                        </span>
                      </span>
                      <span className="font-mono text-[10px] text-[var(--color-ink-faint)]">
                        {intent.href}
                      </span>
                    </button>
                  ))}
                </div>
              ) : null}

              <p className="px-3 py-1.5 text-[9.5px] font-semibold tracking-[0.1em] text-[var(--color-ink-faint)] uppercase">
                Modules
              </p>
              {items.length === 0 ? (
                <p className="px-3 py-6 text-center text-[12px] text-[var(--color-ink-faint)]">
                  No matching Jarvis OS module.
                </p>
              ) : (
                items.map((item) => (
                  <button
                    key={item.href}
                    type="button"
                    onClick={() => {
                      navigate(item.href);
                    }}
                    className="group flex w-full items-center justify-between gap-4 rounded-[10px] px-3 py-2.5 text-left hover:bg-[var(--color-base-800)]"
                  >
                    <span className="min-w-0">
                      <span className="block text-[12.5px] font-semibold text-[var(--color-ink)]">
                        {item.label}
                      </span>
                      <span className="mt-0.5 block truncate text-[11px] text-[var(--color-ink-faint)]">
                        {item.scope}
                      </span>
                    </span>
                    <span className="font-mono text-[10px] text-[var(--color-ink-faint)]">
                      {item.href}
                    </span>
                  </button>
                ))
              )}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
