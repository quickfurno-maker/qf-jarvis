/**
 * Runner-owned hard counters (QFJ-S2-E-B, ADR-0065 §2, §11).
 *
 * These exist because the gateway CANNOT be asked. `runShadow` bypasses `runProviderLedger`, so neither
 * the `AttemptLedger` nor `provenance.attempts` counts the shadow invocation: a runner that trusted
 * provenance would under-report by exactly the call this slice exists to make.
 *
 * Every counter has a hard maximum and {@link ShadowCounters.claim} REFUSES before the budget is
 * exceeded rather than recording an overrun after the fact. A refused claim means the wrapper never
 * delegates, so a third provider call cannot reach a transport.
 */

/** The counted operations. Closed, so a new call site cannot be added without deciding its budget. */
const COUNTED = [
  'credentialReads',
  'credentialResolveAttempts',
  'credentialResolveSuccesses',
  'refreshes',
  'providerConstructions',
  'healthChecks',
  'stableInvocations',
  'candidateInvocations',
  'transportRequests',
  'retries',
  'fallbacks',
  'transitions',
  'timersArmed',
  'timersCleared',
  'timeouts',
  'cancellations',
  'outputsRetained',
] as const;

export type CountedOperation = (typeof COUNTED)[number];

/**
 * The exact PASS budget (ADR-0065 §11).
 *
 * `retries`, `fallbacks`, `refreshes` and `outputsRetained` are zero-ceiling: claiming one at all is a
 * refusal, which is how "no retry" becomes enforced rather than merely intended.
 */
export const SHADOW_CALL_BUDGET: Readonly<Record<CountedOperation, number>> = Object.freeze({
  credentialReads: 1,
  credentialResolveAttempts: 1,
  credentialResolveSuccesses: 1,
  refreshes: 0,
  providerConstructions: 2,
  healthChecks: 2,
  stableInvocations: 1,
  candidateInvocations: 1,
  transportRequests: 2,
  retries: 0,
  fallbacks: 0,
  transitions: 2,
  timersArmed: 1,
  timersCleared: 1,
  // Bounded but not budget-relevant: a timeout or cancellation is an outcome, not an allowance.
  timeouts: 4,
  cancellations: 4,
  outputsRetained: 0,
});

export interface ShadowCounters {
  /** Reserve one unit. Returns false — and counts nothing — when the budget would be exceeded. */
  claim(operation: CountedOperation): boolean;
  get(operation: CountedOperation): number;
  /** True once any claim has been refused. A run that saw one must FAIL. */
  exceeded(): boolean;
  snapshot(): Readonly<Record<CountedOperation, number>>;
}

export function createShadowCounters(
  budget: Readonly<Record<CountedOperation, number>> = SHADOW_CALL_BUDGET,
): ShadowCounters {
  const counts: Record<CountedOperation, number> = {} as Record<CountedOperation, number>;
  for (const operation of COUNTED) {
    counts[operation] = 0;
  }
  const state = { exceeded: false };

  return Object.freeze({
    claim(operation: CountedOperation): boolean {
      if (counts[operation] + 1 > budget[operation]) {
        state.exceeded = true;
        return false;
      }
      counts[operation] += 1;
      return true;
    },
    get: (operation: CountedOperation): number => counts[operation],
    exceeded: (): boolean => state.exceeded,
    snapshot: (): Readonly<Record<CountedOperation, number>> => Object.freeze({ ...counts }),
  });
}
