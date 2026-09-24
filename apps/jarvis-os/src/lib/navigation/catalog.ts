import { OPERATOR_MODULES } from '@qf-jarvis/operator-api-contract';

/**
 * One information architecture for web and future native clients.
 *
 * The framework-neutral operator contract owns module identity, scope and ordering. This web
 * adapter adds only presentation group labels; it does not redefine what modules exist.
 */
export interface NavItem {
  readonly href: string;
  readonly label: string;
  readonly scope: string;
}

export interface NavGroup {
  readonly id: string;
  readonly label: string;
  readonly items: readonly NavItem[];
}

const GROUPS = [
  ['CONTROL', 'primary', 'Control'],
  ['AGENTS', 'agents', 'Agents'],
  ['OPERATE', 'operate', 'Operate'],
  ['INTELLIGENCE', 'intelligence', 'Intelligence'],
  ['BOUNDARY', 'boundary', 'Boundary'],
] as const;

export const NAV_GROUPS: readonly NavGroup[] = Object.freeze(
  GROUPS.map(([contractGroup, id, label]) => Object.freeze({
    id,
    label,
    items: Object.freeze(
      OPERATOR_MODULES
        .filter((module) => module.group === contractGroup)
        .map((module) => Object.freeze({
          href: module.webPath,
          label: module.label,
          scope: module.scope,
        })),
    ),
  })),
);

export const NAV_ITEMS: readonly NavItem[] = Object.freeze(
  NAV_GROUPS.flatMap((group) => group.items),
);

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
