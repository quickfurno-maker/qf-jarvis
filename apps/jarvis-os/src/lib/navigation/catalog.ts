/**
 * The navigation catalog (JOS-01A, docs/architecture/jarvis-os.md).
 *
 * One declarative source for the information architecture, so the sidebar, the mobile
 * drawer and the tests all read the same list. A second hand-written copy in a component is
 * how a module quietly disappears from one surface and not another.
 *
 * The agent group is ordered and worded deliberately: **Aarohi and Anisha are separate
 * entries with separate scopes**, and neither description may be broadened here. Aarohi
 * acquires vendors who are not yet registered; Anisha cares for vendors who already are.
 * Collapsing them — visually or in wording — is the specific mistake this catalog exists to
 * prevent, because a UI that implies one agent does both is a UI that will eventually be
 * built that way.
 */
export interface NavItem {
  readonly href: string;
  readonly label: string;
  /** Short scope line, shown in the drawer and used by tests to pin the boundary. */
  readonly scope: string;
}

export interface NavGroup {
  readonly id: string;
  readonly label: string;
  readonly items: readonly NavItem[];
}

export const NAV_GROUPS: readonly NavGroup[] = Object.freeze([
  {
    id: 'primary',
    label: 'Control',
    items: Object.freeze([
      { href: '/', label: 'Overview', scope: 'System-wide operational picture' },
    ]),
  },
  {
    id: 'agents',
    label: 'Agents',
    items: Object.freeze([
      { href: '/agents/jarvis', label: 'Jarvis', scope: 'Orchestration and coordination' },
      { href: '/agents/riya', label: 'Riya', scope: 'Customer conversation and qualification' },
      {
        href: '/agents/aarohi',
        label: 'Aarohi — Vendor Growth',
        scope: 'Vendor acquisition — not yet registered vendors',
      },
      {
        href: '/agents/anisha',
        label: 'Anisha',
        scope: 'Registered-vendor relationship and success',
      },
    ]),
  },
  {
    id: 'operate',
    label: 'Operate',
    items: Object.freeze([
      { href: '/operations', label: 'Operations Center', scope: 'Human control and safety state' },
      { href: '/approvals', label: 'Approvals', scope: 'Operator approval desk' },
      { href: '/conversations', label: 'Conversations', scope: 'Conversation inventory' },
      { href: '/execution', label: 'Execution', scope: 'Execution intent and dispatch readiness' },
    ]),
  },
  {
    id: 'intelligence',
    label: 'Intelligence',
    items: Object.freeze([
      { href: '/knowledge', label: 'Knowledge', scope: 'Governed knowledge namespaces' },
      { href: '/evaluations', label: 'Evaluations', scope: 'Suite health and readiness' },
      { href: '/models', label: 'Models & Providers', scope: 'Provider-neutral gateway' },
      { href: '/workers', label: 'Workers', scope: 'Fleet topology and capacity' },
    ]),
  },
  {
    id: 'boundary',
    label: 'Boundary',
    items: Object.freeze([
      { href: '/core-sync', label: 'QuickFurno Core Sync', scope: 'Source-of-truth boundary' },
      { href: '/integrations', label: 'n8n / Integrations', scope: 'Execution fabric status' },
      { href: '/analytics', label: 'Analytics', scope: 'Operational trends' },
      { href: '/governance', label: 'Governance', scope: 'Roadmap, authority and audit posture' },
      { href: '/settings', label: 'Settings', scope: 'Operator preferences' },
    ]),
  },
]);

/** Every item, flattened — for lookups and for tests that assert coverage. */
export const NAV_ITEMS: readonly NavItem[] = Object.freeze(
  NAV_GROUPS.flatMap((group) => group.items),
);

/**
 * The most specific navigation item matching a pathname.
 *
 * Longest-prefix rather than `startsWith` on the first hit, so `/agents/aarohi` does not
 * light up `/agents/jarvis` and `/` does not light up everything.
 */
export function activeHref(pathname: string): string | undefined {
  let best: string | undefined;
  for (const item of NAV_ITEMS) {
    const matches = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
    if (matches && (best === undefined || item.href.length > best.length)) {
      best = item.href;
    }
  }
  return best;
}
