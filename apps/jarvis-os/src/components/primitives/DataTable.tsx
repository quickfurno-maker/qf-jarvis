import type { ReactNode } from 'react';

/**
 * The table primitive (JOS-01A).
 *
 * A real `<table>` with a real `<caption>` and real header scopes, wrapped in a horizontal
 * scroll container. Narrow screens scroll the table rather than reflowing it into cards: an
 * approval desk is compared column-by-column, and a card stack destroys exactly that.
 *
 * The caption is visually hidden but present — a screen reader user should learn what a
 * table holds before its first cell.
 */
export function DataTable({
  caption,
  head,
  children,
}: {
  readonly caption: string;
  readonly head: readonly string[];
  readonly children: ReactNode;
}) {
  return (
    <div className="-mx-5 overflow-x-auto px-5">
      <table className="w-full min-w-[720px] border-collapse text-left">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="border-b border-[var(--color-line)]">
            {head.map((column) => (
              <th
                key={column}
                scope="col"
                className="px-3 py-2 text-[10.5px] font-semibold tracking-[0.08em] whitespace-nowrap text-[var(--color-ink-faint)] uppercase first:pl-0 last:pr-0"
              >
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

export function Row({ children }: { readonly children: ReactNode }) {
  return (
    <tr className="border-b border-[var(--color-line)] last:border-0 hover:bg-[var(--color-base-850)]/60">
      {children}
    </tr>
  );
}

export function Cell({
  children,
  muted = false,
  nowrap = false,
}: {
  readonly children: ReactNode;
  readonly muted?: boolean;
  readonly nowrap?: boolean;
}) {
  return (
    <td
      className={`px-3 py-2.5 align-middle text-[12px] first:pl-0 last:pr-0 ${
        muted ? 'text-[var(--color-ink-muted)]' : 'text-[var(--color-ink)]'
      } ${nowrap ? 'whitespace-nowrap' : ''}`}
    >
      {children}
    </td>
  );
}
