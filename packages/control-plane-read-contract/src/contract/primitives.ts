import { z } from 'zod';

/**
 * Contract primitives (JOS-01B, ADR-0086).
 *
 * Everything here is bounded on purpose. A read contract that accepts an unbounded string or an
 * unbounded array is a contract that will eventually carry a stack trace, a raw message body or a
 * whole database page into an operator's browser — and later into an Android client that trusts it.
 * Bounds are cheap to state now and impossible to retrofit once something depends on the slack.
 */

/** The single contract version this package speaks. Not a range, not a minimum. */
export const CONTROL_PLANE_READ_CONTRACT_VERSION = '1' as const;

/**
 * A canonical UTC instant.
 *
 * Strict by construction: `2026-08-03T12:00:00.000Z` and nothing else. Local offsets, missing
 * milliseconds and `Z`-less strings are all rejected, because two clients disagreeing about what
 * an instant means is precisely the bug an operator surface must not have. The regex is checked
 * first so the shape is exact, then `Date.parse` rejects impossible dates the regex would accept
 * (month 13, 31 February).
 */
export const canonicalInstantSchema = z
  .string()
  .regex(
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u,
    'must be a canonical UTC instant: YYYY-MM-DDTHH:mm:ss.sssZ',
  )
  .refine((value) => {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
  }, 'must be a real calendar instant');

export type CanonicalInstant = z.infer<typeof canonicalInstantSchema>;

/** A short identifier used to key a row or a component. */
export const identifierSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9][a-z0-9._-]*$/u, 'must be lowercase kebab/dot/underscore');

/** A short human label. */
export const labelSchema = z.string().min(1).max(80);

/** One clause of operator-facing explanation. Never a stack trace, never an identifier dump. */
export const sentenceSchema = z.string().min(1).max(240);

/** A rendered value ("1,284", "842", "—"). Pre-formatted so clients never re-derive meaning. */
export const displayValueSchema = z.string().min(1).max(32);

/**
 * How a section's data came to be — and whether it is live.
 *
 * `STATIC_BASELINE` is the honest description of most of this release: facts declared by merged
 * repository governance, true at build time, and not an observation of a running system.
 */
export const SECTION_AVAILABILITIES = [
  /** Backed by a source this build genuinely reads, and currently readable. */
  'AVAILABLE',
  /** Declared by merged repository/governance state. True, but not a live reading. */
  'STATIC_BASELINE',
  /** A real source exists or will exist, and this build has no adopted protocol to reach it. */
  'NOT_CONNECTED',
  /** Designed and owner-approved, not implemented. There is nothing to read yet. */
  'PLANNED',
  /** Gated behind production rollout, which is off. */
  'ROLLOUT_OFF',
] as const;

export const sectionAvailabilitySchema = z.enum(SECTION_AVAILABILITIES);
export type SectionAvailability = (typeof SECTION_AVAILABILITIES)[number];

/**
 * The wrapper every operational section uses.
 *
 * This shape exists to make one specific lie impossible. An empty `items` array on its own is
 * ambiguous — it reads as "we looked and there were none" — and for an unconnected source that is
 * false in the most dangerous direction: an operator concludes there is nothing awaiting them.
 * Pairing the items with an availability, the reason and the source that will eventually supply it
 * means "zero" and "not connected" can never render the same way.
 */
export function sectionSchema<T extends z.ZodType>(
  item: T,
  maxItems: number,
): z.ZodObject<{
  availability: typeof sectionAvailabilitySchema;
  reason: typeof sentenceSchema;
  expectedSource: typeof sentenceSchema;
  items: z.ZodArray<T>;
}> {
  return z
    .object({
      availability: sectionAvailabilitySchema,
      reason: sentenceSchema,
      expectedSource: sentenceSchema,
      items: z.array(item).max(maxItems),
    })
    .strict();
}

/**
 * Does this section carry items it has no right to carry?
 *
 * The invariant is checked once at the top level rather than per-section, so a violation reports
 * the section's own path instead of a generic message from inside a helper — and so the rule lives
 * in exactly one place. `unreadable is not empty` is the whole point of the contract.
 */
export function sectionCarriesUnearnedItems(section: {
  readonly availability: SectionAvailability;
  readonly items: readonly unknown[];
}): boolean {
  const readable =
    section.availability === 'AVAILABLE' || section.availability === 'STATIC_BASELINE';
  return !readable && section.items.length > 0;
}

/** A coarse operational reading, rendered as text and never as colour alone. */
export const HEALTH_STATES = [
  'HEALTHY',
  'AVAILABLE',
  'DEGRADED',
  'OFFLINE',
  'SHADOW',
  'ROLLOUT_OFF',
  'PLANNED',
  'DISABLED',
  'NOT_CONNECTED',
] as const;

export const healthStateSchema = z.enum(HEALTH_STATES);
export type HealthState = (typeof HEALTH_STATES)[number];

/** The capability lifecycle vocabulary, shared verbatim with any future client. */
export const CAPABILITY_LIFECYCLES = [
  'AVAILABLE',
  'PLANNED',
  'DISABLED',
  'SHADOW',
  'NOT_CONNECTED',
  'ROLLOUT_OFF',
] as const;

export const capabilityLifecycleSchema = z.enum(CAPABILITY_LIFECYCLES);
export type CapabilityLifecycle = (typeof CAPABILITY_LIFECYCLES)[number];

/** The four governed agents (ADR-0085). Aarohi and Anisha are separate and always will be. */
export const AGENT_IDS = ['jarvis', 'riya', 'aarohi', 'anisha'] as const;
export const agentIdSchema = z.enum(AGENT_IDS);
export type AgentId = (typeof AGENT_IDS)[number];
