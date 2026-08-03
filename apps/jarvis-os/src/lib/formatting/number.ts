/**
 * Presentation formatting (JOS-01A).
 *
 * Pure and locale-fixed. `en-IN` is pinned deliberately: a metric that renders differently
 * depending on the operator's machine is a metric two people cannot discuss.
 */

const INTEGER = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });

export function formatCount(value: number): string {
  return INTEGER.format(value);
}

/** A share of a total, to one decimal place. Returns `0.0%` for an empty total. */
export function formatShare(value: number, total: number): string {
  if (total <= 0) {
    return '0.0%';
  }
  return `${((value / total) * 100).toFixed(1)}%`;
}
